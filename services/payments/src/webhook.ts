import type { Db, Runtime } from '@ams/runtime';
import { hmacSha256Hex, timingSafeEqualStr } from '@ams/shared';
import { z } from 'zod';
import { runActivation } from './activation.js';
import { PENDING_TOPUP_TTL_MS, extractPaymentCode, loadSecrets, loadSepayConfig } from './config.js';
import { creditTopup } from './ledger.js';
import { iso, n, notify, startOfVnDayIso } from './util.js';

export const MAX_SKEW_MS = 5 * 60_000;

export const sepayPayload = z
  .object({
    id: z.union([z.number(), z.string()]),
    gateway: z.string().nullish(),
    transactionDate: z.string().nullish(),
    accountNumber: z.string().nullish(),
    subAccount: z.string().nullish(),
    code: z.string().nullish(),
    content: z.string().nullish(),
    transferType: z.string(),
    description: z.string().nullish(),
    transferAmount: z.union([z.number(), z.string()]),
    accumulated: z.union([z.number(), z.string()]).nullish(),
    referenceCode: z.string().nullish(),
  })
  .passthrough();
export type SepayPayload = z.infer<typeof sepayPayload>;

export type AuthResult = { ok: true; via: 'hmac' | 'apikey' } | { ok: false; reason: 'no_secret_configured' | 'no_auth' | 'bad_signature' | 'stale_timestamp' | 'bad_timestamp' };

function parseTimestamp(raw: string): number | null {
  const t = raw.trim();
  if (/^\d+(\.\d+)?$/.test(t)) {
    const v = Number(t);
    return v > 1e12 ? v : v * 1000; // giay hoac mili giay
  }
  const d = Date.parse(t);
  return Number.isNaN(d) ? null : d;
}

/**
 * Xac thuc webhook SePay.
 *  - `Authorization: Apikey <key>`: so sanh hang thoi gian voi khoa cau hinh.
 *  - HMAC-SHA256: X-SePay-Signature: sha256=<hex>, X-SePay-Timestamp; lech > 5 phut -> tu choi.
 *    Chuoi duoc ky: `<timestamp>.<raw body>` (chap nhan them `<raw body>` thuan; XEM GHI CHU: chua doi chieu duoc voi tai lieu SePay that).
 */
export async function authenticateWebhook(rt: Runtime, headers: Headers, rawBody: string, db: Db = rt.db): Promise<AuthResult> {
  const { hmacSecret, apiKey } = await loadSecrets(rt, db);
  const auth = headers.get('authorization');
  const sigHdr = headers.get('x-sepay-signature');
  if (auth && /^apikey\s+/i.test(auth)) {
    const given = auth.replace(/^apikey\s+/i, '').trim();
    // luon so sanh hang thoi gian (voi chuoi rong neu chua cau hinh de khong lo thoi gian)
    const same = timingSafeEqualStr(given, apiKey ?? '');
    if (apiKey && same) return { ok: true, via: 'apikey' };
    // sai khoa: neu co kem chu ky HMAC thi con duoc thu che do HMAC; neu khong -> tu choi
    if (!sigHdr) return { ok: false, reason: apiKey ? 'bad_signature' : 'no_secret_configured' };
  }
  const sig = sigHdr;
  if (!sig) return { ok: false, reason: 'no_auth' };
  if (!hmacSecret) return { ok: false, reason: 'no_secret_configured' };
  const tsRaw = headers.get('x-sepay-timestamp');
  if (!tsRaw) return { ok: false, reason: 'bad_timestamp' };
  const ts = parseTimestamp(tsRaw);
  if (ts === null) return { ok: false, reason: 'bad_timestamp' };
  const hex = sig.trim().replace(/^sha256=/i, '').toLowerCase();
  const a = await hmacSha256Hex(hmacSecret, `${tsRaw.trim()}.${rawBody}`);
  const b = await hmacSha256Hex(hmacSecret, rawBody);
  // so sanh ca hai (khong thoat som) de khong ro ri thoi gian
  const okA = timingSafeEqualStr(a, hex);
  const okB = timingSafeEqualStr(b, hex);
  if (!(okA || okB)) return { ok: false, reason: 'bad_signature' };
  if (Math.abs(rt.clock.now().getTime() - ts) > MAX_SKEW_MS) return { ok: false, reason: 'stale_timestamp' };
  return { ok: true, via: 'hmac' };
}

/** Luu nguyen van webhook bi tu choi (event_id duy nhat rieng de ke gia mao khong the 'dau doc' id that). */
export async function storeRejected(rt: Runtime, rawBody: string, reason: string, headers?: Headers): Promise<void> {
  const claimed = headers?.get('x-forwarded-for') ?? '';
  const body = rawBody.length > 100_000 ? rawBody.slice(0, 100_000) : rawBody;
  await rt.db.run(
    'INSERT INTO payment_webhooks (id, provider, event_id, payload, signature_ok, result, received_at, processed_at, retry_count) VALUES (?,?,?,?,0,?,?,?,0)',
    [rt.id(), 'sepay', `rejected:${rt.id()}`, JSON.stringify({ raw: body, from: claimed }), `rejected:${reason}`, iso(rt), iso(rt)],
  );
}

export type ProcessResult = {
  result: string;
  customer_id: string | null;
  topup_id: string | null;
  duplicate: boolean;
  credited: boolean;
};

type Source = 'webhook' | 'simulate' | 'reconcile';

/**
 * Xu ly mot giao dich da xac thuc: khu trung -> chi nhan 'in' -> doi chieu ma khach -> cong vi -> kich hoat.
 * Moi buoc la UPDATE/INSERT co dieu kien + UNIQUE nen chay lai/dong thoi khong cong hai lan.
 */
export async function processIncoming(
  rt: Runtime,
  o: { payload: SepayPayload; raw: string; source: Source; eventPrefix?: string },
): Promise<ProcessResult> {
  const db = rt.db;
  const p = o.payload;
  const eventId = `${o.eventPrefix ?? ''}${String(p.id)}`;

  // 1) khu trung: dong dau tien cho event_id thang
  const ins = await db.run(
    'INSERT INTO payment_webhooks (id, provider, event_id, payload, signature_ok, result, received_at, retry_count) VALUES (?,?,?,?,?,NULL,?,0) ON CONFLICT (event_id) DO NOTHING',
    [rt.id(), 'sepay', eventId, o.raw, o.source === 'simulate' ? 0 : 1, iso(rt)],
  );
  if (ins.changes === 0) {
    const ex = (await db.query<{ result: string | null; processed_at: string | null; matched_customer_id: string | null; topup_id: string | null }>(
      'SELECT result, processed_at, matched_customer_id, topup_id FROM payment_webhooks WHERE event_id = ?', [eventId]))[0];
    if (ex && ex.processed_at) {
      // giu nguyen van ban gui lai nhung khong xu ly
      await db.run(
        'INSERT INTO payment_webhooks (id, provider, event_id, payload, signature_ok, result, matched_customer_id, topup_id, received_at, processed_at, retry_count) VALUES (?,?,?,?,?,?,?,?,?,?,0)',
        [rt.id(), 'sepay', `dup:${eventId}:${rt.id()}`, o.raw, o.source === 'simulate' ? 0 : 1, 'duplicate', ex.matched_customer_id, ex.topup_id, iso(rt), iso(rt)],
      );
      return { result: 'duplicate', customer_id: ex.matched_customer_id, topup_id: ex.topup_id, duplicate: true, credited: false };
    }
    await db.run('UPDATE payment_webhooks SET retry_count = retry_count + 1 WHERE event_id = ?', [eventId]);
  }

  let res: ProcessResult;
  try {
    res = await decide(rt, db, p, eventId, o.source);
  } catch (e) {
    await db.run("UPDATE payment_webhooks SET result = 'error' WHERE event_id = ? AND processed_at IS NULL", [eventId]);
    throw e;
  }
  // Chi ket qua that (khong phai 'duplicate') moi ghi vao dong chinh, va chi mot lan; con lai luu thanh dong rieng (nguyen van)
  let wrote = 0;
  if (res.result !== 'duplicate') {
    wrote = (await db.run('UPDATE payment_webhooks SET result = ?, matched_customer_id = ?, topup_id = ?, processed_at = ? WHERE event_id = ? AND processed_at IS NULL', [
      res.result, res.customer_id, res.topup_id, iso(rt), eventId,
    ])).changes;
  }
  if (!wrote) {
    await db.run(
      'INSERT INTO payment_webhooks (id, provider, event_id, payload, signature_ok, result, matched_customer_id, topup_id, received_at, processed_at, retry_count) VALUES (?,?,?,?,?,?,?,?,?,?,0)',
      [rt.id(), 'sepay', `dup:${eventId}:${rt.id()}`, o.raw, o.source === 'simulate' ? 0 : 1, 'duplicate', res.customer_id, res.topup_id, iso(rt), iso(rt)],
    );
    return { ...res, result: 'duplicate', duplicate: true, credited: false };
  }
  return res;
}

async function decide(rt: Runtime, db: Db, p: SepayPayload, eventId: string, source: Source): Promise<ProcessResult> {
  const base = { customer_id: null as string | null, topup_id: null as string | null, duplicate: false, credited: false };
  if (p.transferType.toLowerCase() !== 'in') return { ...base, result: 'ignored_out' };

  const amount = typeof p.transferAmount === 'string' ? Number(p.transferAmount) : p.transferAmount;
  if (!Number.isSafeInteger(amount) || amount <= 0) return { ...base, result: 'manual:invalid_amount' };

  const cfg = await loadSepayConfig(rt, db);
  if (cfg.account_number && p.accountNumber && p.accountNumber !== cfg.account_number) return { ...base, result: 'manual:account_mismatch' };

  const cands = [extractPaymentCode(cfg.prefix, p.content, p.description), extractPaymentCode(cfg.prefix, p.code), p.code?.toUpperCase() ?? null].filter((x): x is string => !!x);
  if (!cands.length) return { ...base, result: 'manual:no_code' };
  let cust: { id: string; state: string } | undefined;
  for (const code of cands) {
    cust = (await db.query<{ id: string; state: string }>('SELECT id, state FROM customers WHERE payment_code = ?', [code]))[0];
    if (cust) break;
  }
  if (!cust) return { ...base, result: 'manual:unknown_customer' };
  const withCust = { ...base, customer_id: cust.id };

  const raw = (p.content ?? '').slice(0, 500);
  const provTxn = eventId;

  // da co topup cho giao dich nay (gui lai sau khi lo do) -> dung lai
  let topup = (await db.query<{ id: string; status: string }>('SELECT id, status FROM topups WHERE provider_txn_id = ?', [provTxn]))[0];
  let reason: string | null = null;

  if (!topup) {
    if (cust.state === 'terminated' || cust.state === 'paused') reason = 'manual:customer_blocked';
    else if (cfg.daily_limit_vnd > 0) {
      const today = n((await db.query<{ s: unknown }>("SELECT COALESCE(SUM(amount_vnd),0) AS s FROM topups WHERE customer_id = ? AND status = 'credited' AND credited_at >= ?", [cust.id, startOfVnDayIso(rt.clock.now())]))[0]?.s);
      if (today + amount > cfg.daily_limit_vnd) reason = 'manual:daily_limit';
    }
    // doi chieu voi yeu cau nap dang cho (QR). Co yeu cau cho ma khong khop so tien -> thu cong.
    let matchedPending: string | null = null;
    if (!reason) {
      const since = new Date(rt.clock.now().getTime() - PENDING_TOPUP_TTL_MS).toISOString();
      const pend = await db.query<{ id: string; amount_vnd: unknown }>(
        "SELECT id, amount_vnd FROM topups WHERE customer_id = ? AND status = 'pending' AND provider_txn_id IS NULL AND requested_at >= ? ORDER BY requested_at ASC, id ASC",
        [cust.id, since],
      );
      if (pend.length) {
        const hit = pend.find((x) => n(x.amount_vnd) === amount);
        if (hit) matchedPending = hit.id;
        else reason = 'manual:amount_mismatch';
      }
    }
    if (matchedPending) {
      const claim = await db.run(
        "UPDATE topups SET provider = 'sepay', provider_txn_id = ?, matched_by = 'content+amount', raw_content = ? WHERE id = ? AND provider_txn_id IS NULL AND status = 'pending'",
        [provTxn, raw, matchedPending],
      );
      if (claim.changes === 1) topup = { id: matchedPending, status: 'pending' };
      else topup = (await db.query<{ id: string; status: string }>('SELECT id, status FROM topups WHERE provider_txn_id = ?', [provTxn]))[0];
    }
    if (!topup) {
      const id = rt.id();
      const status = reason ? 'unmatched' : 'pending';
      const r = await db.run(
        `INSERT INTO topups (id, code, customer_id, amount_vnd, method, provider, provider_txn_id, matched_by, raw_content, status, requested_at)
         VALUES (?,?,?,?, 'bank_transfer', 'sepay', ?, ?, ?, ?, ?) ON CONFLICT (provider_txn_id) DO NOTHING`,
        [id, `NAP-${id.slice(-8)}`, cust.id, amount, provTxn, source === 'simulate' ? 'simulate' : 'content', raw, status, iso(rt)],
      );
      topup = r.changes === 1 ? { id, status } : (await db.query<{ id: string; status: string }>('SELECT id, status FROM topups WHERE provider_txn_id = ?', [provTxn]))[0]!;
    }
  }

  if (reason) {
    await notify(db, rt, { kind: 'payment_manual_queue', title: 'Giao dịch cần xử lý thủ công', body: `${amount} ₫ · ${reason}`, refType: 'topup', refId: topup.id });
    return { ...withCust, topup_id: topup.id, result: reason };
  }

  const c = await creditTopup(rt, db, topup.id, null);
  if (c === 'already') {
    // w4: co the la GIU (nghi cong kep voi khoan da xac nhan tay) hoac bi dong 'duplicate_txn': dua vao hang cho thu cong thay vi coi la gui lai
    const t = (await db.query<{ status: string; matched_by: string | null }>('SELECT status, matched_by FROM topups WHERE id = ?', [topup.id]))[0];
    if (t?.matched_by === 'manual:possible_double_credit') return { ...withCust, topup_id: topup.id, result: 'manual:possible_double_credit' };
    if (t?.matched_by === 'duplicate_txn' || t?.status === 'rejected') return { ...withCust, topup_id: topup.id, result: 'manual:duplicate_txn' };
    return { ...withCust, topup_id: topup.id, result: 'duplicate', duplicate: true };
  }
  await notify(db, rt, { customer: cust.id, kind: 'topup_credited', title: 'Nạp tiền thành công', body: `Đã cộng ${amount} ₫ vào ví.`, refType: 'topup', refId: topup.id });
  await runActivation(rt, db, cust.id, topup.id);
  return { ...withCust, topup_id: topup.id, result: 'credited', credited: true };
}

// ---------------------------------------------------------------------------
// Doi soat bu (job dinh ky): lay giao dich tu API SePay, xu ly cai chua co
// ---------------------------------------------------------------------------

export type FetchTxns = (sinceIso: string) => Promise<unknown[]>;

export async function reconcileSepay(rt: Runtime, fetchTxns: FetchTxns, opts: { lookbackHours?: number } = {}): Promise<{ checked: number; missing: number; credited: number; queued: number; skipped: number; errors: number }> {
  const since = new Date(rt.clock.now().getTime() - (opts.lookbackHours ?? 48) * 3600_000).toISOString();
  const list = await fetchTxns(since);
  const out = { checked: 0, missing: 0, credited: 0, queued: 0, skipped: 0, errors: 0 };
  for (const item of list) {
    out.checked++;
    const parsed = sepayPayload.safeParse(item);
    if (!parsed.success) {
      out.errors++;
      continue;
    }
    const p = parsed.data;
    const ex = (await rt.db.query<{ processed_at: string | null }>('SELECT processed_at FROM payment_webhooks WHERE event_id = ?', [String(p.id)]))[0];
    if (ex?.processed_at) {
      out.skipped++;
      continue;
    }
    out.missing++;
    try {
      const r = await processIncoming(rt, { payload: p, raw: JSON.stringify(item), source: 'reconcile' });
      if (r.credited) out.credited++;
      else if (r.result.startsWith('manual:')) out.queued++;
      else out.skipped++;
    } catch {
      out.errors++;
    }
  }
  return out;
}

/** Ham lay giao dich that tu API SePay (khong dung trong test). Dinh dang phan hoi theo tai lieu SePay userapi: CHUA kiem chung voi dich vu that. */
export function createSepayFetcher(env: Record<string, string | undefined>, fetchImpl: typeof fetch = fetch): FetchTxns {
  return async (sinceIso) => {
    const token = env['SEPAY_API_TOKEN'];
    if (!token) throw new Error('Thiếu SEPAY_API_TOKEN');
    const d = new Date(sinceIso);
    const q = `transaction_date_min=${encodeURIComponent(d.toISOString().slice(0, 19).replace('T', ' '))}&limit=500`;
    const r = await fetchImpl(`https://my.sepay.vn/userapi/transactions/list?${q}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`SePay API ${r.status}`);
    const j = (await r.json()) as { transactions?: Record<string, unknown>[] };
    return (j.transactions ?? []).map((t) => ({
      id: t['id'],
      gateway: t['bank_brand_name'],
      transactionDate: t['transaction_date'],
      accountNumber: t['account_number'],
      subAccount: t['sub_account'],
      code: t['code'],
      content: t['transaction_content'],
      transferType: Number(t['amount_in']) > 0 ? 'in' : 'out',
      transferAmount: Number(t['amount_in']) > 0 ? Number(t['amount_in']) : Number(t['amount_out']),
      referenceCode: t['reference_number'],
    }));
  };
}
