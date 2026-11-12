import type { Db, Runtime } from '@ams/runtime';
import { hmacSha256Hex } from '@ams/shared';
import type { Context, Hono } from 'hono';
import { ZodError, z } from 'zod';
import { defaultResolveActor, requirePerm, type ActorResolver, type FinanceActor } from './actor.js';
import { runActivation, undoActivation } from './activation.js';
import { BANKS, DEFAULT_MIN_TOPUP_VND, SAMPLE_ACCOUNT, devSimulateAllowed, loadSecrets, loadSepayConfig, qrUrl, saveSepayConfig, sepayMode, transferContent } from './config.js';
import { applyBalance, creditTopup, getWallet } from './ledger.js';
import { FinanceError, type FinanceCore, type FinancePort } from './port.js';
import { audit, iso, n, notify, startOfVnDayIso } from './util.js';
import { runDailyFinanceJobs } from './jobs.js';
import { authenticateWebhook, createSepayFetcher, processIncoming, reconcileSepay, sepayPayload, storeRejected } from './webhook.js';
import { releaseCampaign, reserveCampaign, spendCampaign } from './ledger.js';

/** Ham loi (khong phu thuoc hinh dang a1): (campaignId, budget). */
export function createFinanceCore(rt: Runtime): FinanceCore {
  return {
    reserveForCampaign: (id, budget, o) => reserveCampaign(rt, o?.db ?? rt.db, id, budget),
    releaseForCampaign: (id, o) => releaseCampaign(rt, o?.db ?? rt.db, id),
    spendForCampaign: (id, amt, ref, o) => spendCampaign(rt, o?.db ?? rt.db, id, amt, ref),
  };
}

/** FinancePort theo services/api/src/ports.ts cua a1. */
export function createFinancePort(): FinancePort {
  return {
    async reserveForCampaign(rt, { campaignId }) {
      const c = (await rt.db.query<{ approved_budget_vnd: unknown }>('SELECT approved_budget_vnd FROM campaigns WHERE id = ?', [campaignId]))[0];
      if (!c) throw new FinanceError('campaign_not_found', 'Không tìm thấy chiến dịch', 404);
      const budget = n(c.approved_budget_vnd);
      const r = await reserveCampaign(rt, rt.db, campaignId, budget);
      // 'paused' (activate_on_approve=0): da giu tien nhung khong tu chay; bao 'scheduled' cho kieu cua a1, DB giu state='paused'
      const st = r.state === 'paused' ? 'scheduled' : r.state;
      return { campaign_state: st, reserved_vnd: st === 'awaiting_funds' ? 0 : budget, shortfall_vnd: r.shortfall };
    },
    releaseForCampaign: async (rt, { campaignId }) => ({ released_vnd: (await releaseCampaign(rt, rt.db, campaignId)).released }),
    spendForCampaign: (rt, { campaignId, amountVnd, ref }) => spendCampaign(rt, rt.db, campaignId, amountVnd, ref),
    async scheduled(rt, cron) {
      if (cron.startsWith('*/')) {
        // doi soat bu SePay moi 10 phut (chi khi co token API va khong phai mock)
        if (rt.config.env['SEPAY_API_TOKEN'] && (rt.config.env['SEPAY_MODE'] ?? 'production') !== 'mock') await reconcileSepay(rt, createSepayFetcher(rt.config.env));
      } else {
        await runDailyFinanceJobs(rt);
      }
    },
  };
}

const err = (code: string, message: string, status: number, details?: unknown) => ({ body: { error: { code, message, ...(details !== undefined ? { details } : {}) } }, status });

type H = (c: Context) => Promise<Response>;

function wrap(fn: H): H {
  return async (c) => {
    try {
      return await fn(c);
    } catch (e) {
      if (e instanceof FinanceError) {
        const r = err(e.code, e.message, e.status, e.details);
        return c.json(r.body, r.status as 400);
      }
      if (e instanceof ZodError) {
        const r = err('validation_error', 'Dữ liệu không hợp lệ', 400, e.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
        return c.json(r.body, 400);
      }
      throw e;
    }
  };
}

async function jsonBody<T extends z.ZodTypeAny>(c: Context, schema: T): Promise<z.infer<T>> {
  let raw: unknown = {};
  try {
    raw = await c.req.json();
  } catch {
    raw = {};
  }
  return schema.parse(raw);
}

function paging(c: Context): { page: number; size: number; offset: number } {
  const page = Math.max(1, Number(c.req.query('page') ?? 1) || 1);
  const size = Math.min(200, Math.max(1, Number(c.req.query('page_size') ?? 25) || 25));
  return { page, size, offset: (page - 1) * size };
}

export interface MountOptions {
  resolveActor?: ActorResolver;
}

export interface MountResult {
  port: FinancePort;
  devSimulate: boolean;
}

/** Kiem tra cau hinh luc khoi dong: dung de khong de endpoint dev/mo phong lot len production. */
export function assertFinanceConfig(rt: Runtime): { mode: ReturnType<typeof sepayMode>; devSimulate: boolean } {
  const mode = sepayMode(rt); // nem loi neu gia tri la
  const env = rt.config.env;
  if (mode === 'production' && !env['SEPAY_WEBHOOK_SECRET'] && !env['SEPAY_API_KEY']) {
    throw new Error('SEPAY_MODE=production nhưng thiếu SEPAY_WEBHOOK_SECRET hoặc SEPAY_API_KEY: từ chối khởi động');
  }
  const devSimulate = devSimulateAllowed(rt);
  if (devSimulate && (rt.config.runtime !== 'docker' || mode === 'production')) throw new Error('Cấu hình sai: /dev/sepay/simulate không được bật ngoài docker/non-production');
  return { mode, devSimulate };
}

const statusOut = (s: string, admin: boolean): string => (admin && s === 'pending' ? 'awaiting_confirm' : s);

export function mountFinance(app: Hono<any>, rt: Runtime, opts: MountOptions = {}): MountResult {
  const { devSimulate } = assertFinanceConfig(rt);
  const resolve = opts.resolveActor ?? defaultResolveActor;
  const actorOf = async (c: Context): Promise<FinanceActor | null> => resolve(c, rt);
  const port = createFinancePort();

  // ================= webhook =================
  app.post('/webhooks/payments/sepay', wrap(async (c) => {
    const raw = await c.req.text();
    if (raw.length > 64 * 1024) {
      await storeRejected(rt, raw, 'too_large', c.req.raw.headers);
      return c.json(err('payload_too_large', 'Nội dung quá lớn', 413).body, 413);
    }
    const cfg = await loadSepayConfig(rt);
    const auth = await authenticateWebhook(rt, c.req.raw.headers, raw);
    if (!auth.ok) {
      await storeRejected(rt, raw, auth.reason, c.req.raw.headers);
      const r = err('invalid_signature', 'Xác thực webhook thất bại', 401);
      return c.json(r.body, 401);
    }
    if (!cfg.enabled) {
      await storeRejected(rt, raw, 'disabled', c.req.raw.headers);
      return c.json(err('webhook_disabled', 'Nhận tiền tự động đang tắt', 403).body, 403);
    }
    let payload;
    try {
      payload = sepayPayload.parse(JSON.parse(raw));
    } catch {
      await storeRejected(rt, raw, 'bad_payload', c.req.raw.headers);
      return c.json(err('bad_payload', 'Nội dung webhook không hợp lệ', 400).body, 400);
    }
    await processIncoming(rt, { payload, raw, source: 'webhook' }); // loi -> 500 de SePay gui lai
    return c.json({ success: true }, 200);
  }));

  // ================= dev simulate (chi docker + khong production) =================
  if (devSimulate) {
    app.post('/dev/sepay/simulate', wrap(async (c) => {
      if (!devSimulateAllowed(rt)) return c.json(err('not_found', 'Không tìm thấy', 404).body, 404);
      requirePerm(await actorOf(c), 'finance', 'write', 'internal');
      const b = await jsonBody(c, z.object({ id: z.union([z.number(), z.string()]).optional(), transferType: z.string().default('in'), transferAmount: z.coerce.number(), content: z.string().default('') }).passthrough());
      const cfg = await loadSepayConfig(rt);
      const payload = sepayPayload.parse({
        id: b.id ?? rt.id(), gateway: cfg.bank ?? 'MBBank', transactionDate: iso(rt), accountNumber: cfg.account_number ?? SAMPLE_ACCOUNT,
        content: b.content, transferType: b.transferType, transferAmount: b.transferAmount, referenceCode: 'SIM',
      });
      const r = await processIncoming(rt, { payload, raw: JSON.stringify(payload), source: 'simulate', eventPrefix: 'sim:' });
      return c.json({ success: true, result: r.result, customer_id: r.customer_id, topup_id: r.topup_id });
    }));
  }

  // ================= portal =================
  app.get('/portal/v1/wallet', wrap(async (c) => {
    const a = requirePerm(await actorOf(c), 'finance', 'view', 'external');
    const cid = a.customer_id!;
    const cust = (await rt.db.query<{ payment_code: string; short_name: string; state: string }>('SELECT payment_code, short_name, state FROM customers WHERE id = ?', [cid]))[0];
    if (!cust) throw new FinanceError('not_found', 'Không tìm thấy khách hàng', 404);
    const w = (await getWallet(rt.db, cid)) ?? { balance: 0, reserved: 0, spent: 0, available: 0 };
    const cfg = await loadSepayConfig(rt);
    const entries = await rt.db.query(
      'SELECT id, kind, amount_vnd, balance_after, ref_type, ref_id, note, created_at FROM wallet_entries WHERE customer_id = ? ORDER BY created_at DESC, id DESC LIMIT 50', [cid]);
    return c.json({
      customer_id: cid, customer_name: cust.short_name, payment_code: cust.payment_code,
      balance_vnd: w.balance, reserved_vnd: w.reserved, spent_vnd: w.spent, available_vnd: w.available,
      min_topup_vnd: cfg.min_amount_vnd,
      payment: cfg.enabled && cfg.bank && cfg.account_number && cfg.account_holder
        ? { bank: cfg.bank, account_number: cfg.account_number, account_holder: cfg.account_holder, prefix: cfg.prefix } : null,
      entries: entries.map((e: Record<string, unknown>) => ({ ...e, amount_vnd: n(e['amount_vnd']), balance_after: n(e['balance_after']) })),
    });
  }));

  async function createTopup(c: Context, a: FinanceActor, customerId: string): Promise<Response> {
    const b = await jsonBody(c, z.object({ amount_vnd: z.number().int().positive(), method: z.string().max(20).optional() }).passthrough());
    const cust = (await rt.db.query<{ payment_code: string; state: string }>('SELECT payment_code, state FROM customers WHERE id = ?', [customerId]))[0];
    if (!cust) throw new FinanceError('not_found', 'Không tìm thấy khách hàng', 404);
    if (cust.state === 'terminated' || cust.state === 'paused') throw new FinanceError('customer_blocked', 'Tài khoản đang bị khóa, không nạp được', 403);
    const cfg = await loadSepayConfig(rt);
    if (b.amount_vnd < cfg.min_amount_vnd) throw new FinanceError('below_minimum', `Số tiền nạp tối thiểu là ${cfg.min_amount_vnd} ₫`, 422, { min_amount_vnd: cfg.min_amount_vnd });
    if (cfg.daily_limit_vnd > 0) {
      const today = n((await rt.db.query<{ s: unknown }>("SELECT COALESCE(SUM(amount_vnd),0) AS s FROM topups WHERE customer_id = ? AND status IN ('credited','pending') AND requested_at >= ?", [customerId, startOfVnDayIso(rt.clock.now())]))[0]?.s);
      if (today + b.amount_vnd > cfg.daily_limit_vnd) throw new FinanceError('daily_limit', 'Vượt giới hạn nạp trong ngày', 422, { daily_limit_vnd: cfg.daily_limit_vnd });
    }
    const pend = n((await rt.db.query<{ k: unknown }>("SELECT COUNT(*) AS k FROM topups WHERE customer_id = ? AND status = 'pending'", [customerId]))[0]?.k);
    if (pend >= 20) throw new FinanceError('too_many_pending', 'Quá nhiều yêu cầu nạp đang chờ', 429);
    const id = rt.id();
    await rt.db.run(
      "INSERT INTO topups (id, code, customer_id, amount_vnd, method, provider, status, requested_by, requested_at) VALUES (?,?,?,?,?, 'sepay', 'pending', ?, ?)",
      [id, `NAP-${id.slice(-8)}`, customerId, b.amount_vnd, b.method ?? 'qr', a.id, iso(rt)],
    );
    await audit(rt.db, rt, { actor: a.id, action: 'finance.topup.request', type: 'topup', id, customer: customerId, ip: a.ip, diff: { amount_vnd: b.amount_vnd } });
    const content = transferContent(cfg.prefix, cust.payment_code);
    const configured = cfg.enabled && cfg.bank && cfg.account_number && cfg.account_holder;
    return c.json({
      id, payment_code: cust.payment_code, content, amount_vnd: b.amount_vnd, min_amount_vnd: cfg.min_amount_vnd,
      ...(configured ? { bank: cfg.bank, account_number: cfg.account_number, account_holder: cfg.account_holder, qr_url: qrUrl({ account: cfg.account_number!, bank: cfg.bank!, amount: b.amount_vnd, content }) } : {}),
    }, 201);
  }

  app.post('/portal/v1/topups', wrap(async (c) => {
    const a = requirePerm(await actorOf(c), 'finance', 'write', 'external');
    return createTopup(c, a, a.customer_id!); // customer_id luon lay tu phien, bo qua body
  }));

  app.get('/portal/v1/topups', wrap(async (c) => {
    const a = requirePerm(await actorOf(c), 'finance', 'view', 'external');
    const { page, size, offset } = paging(c);
    const total = n((await rt.db.query<{ k: unknown }>('SELECT COUNT(*) AS k FROM topups WHERE customer_id = ?', [a.customer_id]))[0]?.k);
    const rows = await rt.db.query<Record<string, unknown>>(
      'SELECT id, code, amount_vnd, method, status, requested_at, credited_at FROM topups WHERE customer_id = ? ORDER BY requested_at DESC, id DESC LIMIT ? OFFSET ?', [a.customer_id, size, offset]);
    return c.json({ items: rows.map((r) => ({ ...r, amount_vnd: n(r['amount_vnd']), created_at: r['requested_at'] })), page, page_size: size, total });
  }));

  app.post('/portal/v1/wallet/refund-requests', wrap(async (c) => {
    const a = requirePerm(await actorOf(c), 'finance', 'write', 'external');
    const b = await jsonBody(c, z.object({ amount_vnd: z.number().int().positive(), reason: z.string().max(500).optional() }));
    const w = await getWallet(rt.db, a.customer_id!);
    const pending = n((await rt.db.query<{ s: unknown }>("SELECT COALESCE(SUM(amount_vnd),0) AS s FROM refund_requests WHERE customer_id = ? AND status IN ('pending','approved')", [a.customer_id]))[0]?.s);
    // chi hoan phan chua dung (kha dung), khong tinh phan dang giu
    if (!w || b.amount_vnd + pending > w.available) throw new FinanceError('exceeds_available', 'Số tiền hoàn vượt quá số dư khả dụng', 422, { available_vnd: w?.available ?? 0, pending_refund_vnd: pending });
    const id = rt.id();
    await rt.db.run("INSERT INTO refund_requests (id, customer_id, amount_vnd, reason, status, requested_by, created_at) VALUES (?,?,?,?, 'pending', ?, ?)", [id, a.customer_id, b.amount_vnd, b.reason ?? null, a.id, iso(rt)]);
    await audit(rt.db, rt, { actor: a.id, action: 'finance.refund.request', type: 'refund_request', id, customer: a.customer_id, ip: a.ip, diff: { amount_vnd: b.amount_vnd } });
    return c.json({ id, status: 'pending', amount_vnd: b.amount_vnd }, 201);
  }));

  app.get('/portal/v1/wallet/refund-requests', wrap(async (c) => {
    const a = requirePerm(await actorOf(c), 'finance', 'view', 'external');
    const rows = await rt.db.query<Record<string, unknown>>('SELECT id, amount_vnd, reason, status, created_at, decided_at FROM refund_requests WHERE customer_id = ? ORDER BY created_at DESC, id DESC LIMIT 100', [a.customer_id]);
    return c.json({ items: rows.map((r) => ({ ...r, amount_vnd: n(r['amount_vnd']) })) });
  }));

  // ================= admin: topups =================
  app.get('/admin/v1/topups', wrap(async (c) => {
    requirePerm(await actorOf(c), 'finance', 'view', 'internal');
    const { page, size, offset } = paging(c);
    let status = c.req.query('status') ?? null;
    const f = c.req.query('filter');
    if (!status && f && f.startsWith('status:')) status = f.slice(7);
    if (status === 'awaiting_confirm') status = 'pending';
    const where = status ? 'WHERE t.status = ?' : '';
    const params = status ? [status] : [];
    const total = n((await rt.db.query<{ k: unknown }>(`SELECT COUNT(*) AS k FROM topups t ${where}`, params))[0]?.k);
    const rows = await rt.db.query<Record<string, unknown>>(
      `SELECT t.id, t.code, t.customer_id, c.short_name AS customer_name, c.payment_code, t.method, t.amount_vnd, t.status, t.requested_at, t.credited_at, t.provider
       FROM topups t JOIN customers c ON c.id = t.customer_id ${where} ORDER BY t.requested_at DESC, t.id DESC LIMIT ? OFFSET ?`, [...params, size, offset]);
    return c.json({ items: rows.map((r) => ({ ...r, amount_vnd: n(r['amount_vnd']), status: statusOut(String(r['status']), true), created_at: r['requested_at'] })), page, page_size: size, total });
  }));

  app.post('/admin/v1/topups', wrap(async (c) => {
    const a = requirePerm(await actorOf(c), 'finance', 'write', 'internal');
    const peek = (await c.req.raw.clone().json().catch(() => ({}))) as { customer_id?: string };
    if (!peek.customer_id) throw new FinanceError('validation_error', 'Thiếu customer_id', 400);
    return createTopup(c, a, peek.customer_id);
  }));

  async function confirmTopup(topupId: string, a: FinanceActor): Promise<{ status: string; activation_log_id: string | null }> {
    const t = (await rt.db.query<{ customer_id: string; requested_by: string | null; status: string; amount_vnd: unknown }>('SELECT customer_id, requested_by, status, amount_vnd FROM topups WHERE id = ?', [topupId]))[0];
    if (!t) throw new FinanceError('not_found', 'Không tìm thấy yêu cầu nạp', 404);
    if (t.requested_by && t.requested_by === a.id) throw new FinanceError('self_confirm_forbidden', 'Người tạo yêu cầu không được tự xác nhận (cần người thứ hai)', 403);
    const r = await creditTopup(rt, rt.db, topupId, a.id);
    if (r === 'already') throw new FinanceError('already_processed', 'Yêu cầu nạp đã được xử lý', 409);
    await rt.db.run("UPDATE payment_webhooks SET result = 'manual_resolved', matched_customer_id = ? WHERE topup_id = ? AND result LIKE 'manual:%'", [t.customer_id, topupId]);
    await audit(rt.db, rt, { actor: a.id, action: 'finance.topup.confirm', type: 'topup', id: topupId, customer: t.customer_id, ip: a.ip, diff: { amount_vnd: n(t.amount_vnd) } });
    await notify(rt.db, rt, { customer: t.customer_id, kind: 'topup_credited', title: 'Nạp tiền thành công', body: `Đã cộng ${n(t.amount_vnd)} ₫ vào ví.`, refType: 'topup', refId: topupId });
    const act = await runActivation(rt, rt.db, t.customer_id, topupId);
    return { status: 'credited', activation_log_id: act.log_id };
  }

  app.post('/admin/v1/topups/:id/confirm', wrap(async (c) => {
    const a = requirePerm(await actorOf(c), 'finance', 'approve', 'internal');
    return c.json(await confirmTopup(c.req.param('id'), a));
  }));

  // hang doi xu ly thu cong
  app.get('/admin/v1/payments/manual-queue', wrap(async (c) => {
    requirePerm(await actorOf(c), 'finance', 'view', 'internal');
    const rows = await rt.db.query<Record<string, unknown>>(
      `SELECT w.id, w.event_id, w.result, w.matched_customer_id, w.topup_id, w.received_at, w.payload, t.status AS topup_status
       FROM payment_webhooks w LEFT JOIN topups t ON t.id = w.topup_id
       WHERE w.result LIKE 'manual:%' ORDER BY w.received_at DESC, w.id DESC LIMIT 200`);
    return c.json({ items: rows.map((r) => {
      let amount = 0, content = '';
      try { const p = JSON.parse(String(r['payload'])) as Record<string, unknown>; amount = n(p['transferAmount']); content = String(p['content'] ?? ''); } catch { /* giu nguyen */ }
      return { id: r['id'], event_id: r['event_id'], reason: String(r['result']).slice(7), customer_id: r['matched_customer_id'], topup_id: r['topup_id'], received_at: r['received_at'], amount_vnd: amount, content };
    }) });
  }));

  app.post('/admin/v1/payments/manual-queue/:id/resolve', wrap(async (c) => {
    const a = requirePerm(await actorOf(c), 'finance', 'approve', 'internal');
    const b = await jsonBody(c, z.object({ customer_id: z.string().optional() }));
    const w = (await rt.db.query<{ id: string; event_id: string; payload: string; topup_id: string | null; result: string }>('SELECT id, event_id, payload, topup_id, result FROM payment_webhooks WHERE id = ?', [c.req.param('id')]))[0];
    if (!w || !w.result.startsWith('manual:')) throw new FinanceError('not_found', 'Không có trong hàng đợi', 404);
    if (w.topup_id) return c.json(await confirmTopup(w.topup_id, a));
    if (!b.customer_id) throw new FinanceError('validation_error', 'Cần chọn khách hàng', 400);
    const cust = (await rt.db.query('SELECT 1 AS x FROM customers WHERE id = ?', [b.customer_id]))[0];
    if (!cust) throw new FinanceError('not_found', 'Không tìm thấy khách hàng', 404);
    const p = JSON.parse(w.payload) as { transferAmount?: number | string; content?: string };
    const amount = Number(p.transferAmount);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new FinanceError('invalid_amount', 'Số tiền giao dịch không hợp lệ', 422);
    const claim = await rt.db.run("UPDATE payment_webhooks SET result = 'manual_resolved', matched_customer_id = ? WHERE id = ? AND result LIKE 'manual:%' AND topup_id IS NULL", [b.customer_id, w.id]);
    if (claim.changes !== 1) throw new FinanceError('already_processed', 'Đã được xử lý', 409);
    const tid = rt.id();
    await rt.db.run(
      "INSERT INTO topups (id, code, customer_id, amount_vnd, method, provider, provider_txn_id, matched_by, raw_content, status, confirmed_by, requested_at) VALUES (?,?,?,?, 'bank_transfer', 'sepay', ?, 'manual_queue', ?, 'pending', ?, ?) ON CONFLICT (provider_txn_id) DO NOTHING",
      [tid, `NAP-${tid.slice(-8)}`, b.customer_id, amount, w.event_id, (p.content ?? '').slice(0, 500), a.id, iso(rt)],
    );
    const t = (await rt.db.query<{ id: string }>('SELECT id FROM topups WHERE provider_txn_id = ?', [w.event_id]))[0]!;
    await rt.db.run('UPDATE payment_webhooks SET topup_id = ? WHERE id = ?', [t.id, w.id]);
    const r = await creditTopup(rt, rt.db, t.id, a.id);
    await audit(rt.db, rt, { actor: a.id, action: 'finance.manual_queue.resolve', type: 'payment_webhook', id: w.id, customer: b.customer_id, ip: a.ip, diff: { amount_vnd: amount, credit: r } });
    const act = await runActivation(rt, rt.db, b.customer_id, t.id);
    return c.json({ status: 'credited', topup_id: t.id, activation_log_id: act.log_id });
  }));

  // ================= admin: wallets, dieu chinh 2 nguoi =================
  app.get('/admin/v1/wallets', wrap(async (c) => {
    requirePerm(await actorOf(c), 'finance', 'view', 'internal');
    const { page, size, offset } = paging(c);
    const total = n((await rt.db.query<{ k: unknown }>('SELECT COUNT(*) AS k FROM customers'))[0]?.k);
    const rows = await rt.db.query<Record<string, unknown>>(
      `SELECT c.id AS customer_id, c.short_name AS customer_name, c.payment_code, c.state AS customer_state,
         COALESCE(w.balance_vnd,0) AS balance_vnd, COALESCE(w.reserved_vnd,0) AS reserved_vnd, COALESCE(w.spent_vnd,0) AS spent_vnd
       FROM customers c LEFT JOIN ad_wallets w ON w.customer_id = c.id ORDER BY c.short_name ASC, c.id ASC LIMIT ? OFFSET ?`, [size, offset]);
    return c.json({ items: rows.map((r) => ({ ...r, balance_vnd: n(r['balance_vnd']), reserved_vnd: n(r['reserved_vnd']), spent_vnd: n(r['spent_vnd']), available_vnd: n(r['balance_vnd']) - n(r['reserved_vnd']) })), page, page_size: size, total });
  }));

  app.get('/admin/v1/wallets/:customerId', wrap(async (c) => {
    requirePerm(await actorOf(c), 'finance', 'view', 'internal');
    const cid = c.req.param('customerId');
    const w = await getWallet(rt.db, cid);
    if (!w) throw new FinanceError('not_found', 'Không tìm thấy ví', 404);
    const entries = await rt.db.query<Record<string, unknown>>('SELECT id, kind, amount_vnd, balance_after, reserved_after, ref_type, ref_id, note, created_at FROM wallet_entries WHERE customer_id = ? ORDER BY created_at DESC, id DESC LIMIT 200', [cid]);
    return c.json({ customer_id: cid, balance_vnd: w.balance, reserved_vnd: w.reserved, spent_vnd: w.spent, available_vnd: w.available, entries: entries.map((e) => ({ ...e, amount_vnd: n(e['amount_vnd']), balance_after: n(e['balance_after']), reserved_after: n(e['reserved_after']) })) });
  }));

  // Dieu chinh tay: nguoi A de xuat (finance:write), nguoi B KHAC duyet (finance:approve). Luu de xuat trong `settings` (khoa wallet_adjust:*)
  // vi chua co bang rieng; de xuat bang bang rieng gui f1 trong requests.
  app.post('/admin/v1/wallets/:customerId/adjustments', wrap(async (c) => {
    const a = requirePerm(await actorOf(c), 'finance', 'write', 'internal');
    const b = await jsonBody(c, z.object({ amount_vnd: z.number().int().refine((x) => x !== 0, 'Số tiền khác 0'), reason: z.string().min(5).max(500) }));
    const cid = c.req.param('customerId');
    if (!(await rt.db.query('SELECT 1 AS x FROM customers WHERE id = ?', [cid]))[0]) throw new FinanceError('not_found', 'Không tìm thấy khách hàng', 404);
    const id = rt.id();
    await rt.db.run('INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?,?,?,?)', [`wallet_adjust:${id}`, JSON.stringify({ customer_id: cid, amount_vnd: b.amount_vnd, reason: b.reason, requested_by: a.id, requested_at: iso(rt), status: 'pending' }), a.id, iso(rt)]);
    await audit(rt.db, rt, { actor: a.id, action: 'finance.adjust.request', type: 'wallet_adjustment', id, customer: cid, ip: a.ip, diff: { amount_vnd: b.amount_vnd, reason: b.reason } });
    return c.json({ id, status: 'pending' }, 201);
  }));

  app.get('/admin/v1/wallet-adjustments', wrap(async (c) => {
    requirePerm(await actorOf(c), 'finance', 'view', 'internal');
    const rows = await rt.db.query<{ key: string; value: string }>("SELECT key, value FROM settings WHERE key LIKE 'wallet\\_adjust%' ESCAPE '\\' ORDER BY updated_at DESC LIMIT 200");
    return c.json({ items: rows.map((r) => ({ id: r.key.split(':')[1], ...(JSON.parse(r.value) as object) })) });
  }));

  app.post('/admin/v1/wallet-adjustments/:id/approve', wrap(async (c) => {
    const a = requirePerm(await actorOf(c), 'finance', 'approve', 'internal');
    const id = c.req.param('id');
    const row = (await rt.db.query<{ value: string }>('SELECT value FROM settings WHERE key = ?', [`wallet_adjust:${id}`]))[0];
    if (!row) throw new FinanceError('not_found', 'Không có đề xuất đang chờ', 404);
    const p = JSON.parse(row.value) as { customer_id: string; amount_vnd: number; reason: string; requested_by: string };
    if (p.requested_by === a.id) throw new FinanceError('same_person', 'Điều chỉnh tay cần hai người: người duyệt phải khác người đề xuất', 403);
    // chiem nguyen tu bang cach doi khoa
    const claim = await rt.db.run('UPDATE settings SET key = ?, updated_by = ?, updated_at = ? WHERE key = ?', [`wallet_adjust_done:${id}`, a.id, iso(rt), `wallet_adjust:${id}`]);
    if (claim.changes !== 1) throw new FinanceError('already_processed', 'Đề xuất đã được xử lý', 409);
    const w = await applyBalance(rt.db, rt, { customerId: p.customer_id, amount: p.amount_vnd, kind: 'adjust', refType: 'adjustment', refId: id, note: `${p.reason} (đề xuất ${p.requested_by}, duyệt ${a.id})` });
    if (!w) {
      await rt.db.run('UPDATE settings SET key = ? WHERE key = ?', [`wallet_adjust:${id}`, `wallet_adjust_done:${id}`]);
      throw new FinanceError('would_breach_reserved', 'Điều chỉnh làm số dư thấp hơn phần đang giữ', 409);
    }
    await rt.db.run('UPDATE settings SET value = ? WHERE key = ?', [JSON.stringify({ ...p, status: 'approved', approved_by: a.id, approved_at: iso(rt) }), `wallet_adjust_done:${id}`]);
    await audit(rt.db, rt, { actor: a.id, action: 'finance.adjust.approve', type: 'wallet_adjustment', id, customer: p.customer_id, ip: a.ip, diff: { amount_vnd: p.amount_vnd, requested_by: p.requested_by } });
    return c.json({ id, status: 'approved', balance_vnd: w.balance_vnd });
  }));

  // ================= admin: hoan tien =================
  app.get('/admin/v1/refund-requests', wrap(async (c) => {
    requirePerm(await actorOf(c), 'finance', 'view', 'internal');
    const rows = await rt.db.query<Record<string, unknown>>(
      `SELECT r.id, r.customer_id, c.short_name AS customer_name, r.amount_vnd, r.reason, r.status, r.decided_by, r.decision_note, r.created_at, r.decided_at
       FROM refund_requests r JOIN customers c ON c.id = r.customer_id ORDER BY r.created_at DESC, r.id DESC LIMIT 200`);
    return c.json({ items: rows.map((r) => ({ ...r, amount_vnd: n(r['amount_vnd']) })) });
  }));

  app.post('/admin/v1/refund-requests/:id/approve', wrap(async (c) => {
    const a = requirePerm(await actorOf(c), 'finance', 'approve', 'internal');
    const id = c.req.param('id');
    const b = await jsonBody(c, z.object({ note: z.string().max(500).optional() }));
    const r = (await rt.db.query<{ customer_id: string; amount_vnd: unknown }>('SELECT customer_id, amount_vnd FROM refund_requests WHERE id = ?', [id]))[0];
    if (!r) throw new FinanceError('not_found', 'Không tìm thấy yêu cầu hoàn', 404);
    const claim = await rt.db.run("UPDATE refund_requests SET status = 'approved', decided_by = ?, decision_note = ?, decided_at = ? WHERE id = ? AND status = 'pending'", [a.id, b.note ?? null, iso(rt), id]);
    if (claim.changes !== 1) throw new FinanceError('already_processed', 'Yêu cầu đã được xử lý', 409);
    const w = await applyBalance(rt.db, rt, { customerId: r.customer_id, amount: n(r.amount_vnd), kind: 'refund', refType: 'refund_request', refId: id, note: 'Hoàn tiền về ngân hàng' });
    if (!w) {
      await rt.db.run("UPDATE refund_requests SET status = 'pending', decided_by = NULL, decided_at = NULL WHERE id = ?", [id]);
      throw new FinanceError('insufficient_available', 'Số dư khả dụng không đủ để hoàn', 409);
    }
    await audit(rt.db, rt, { actor: a.id, action: 'finance.refund.approve', type: 'refund_request', id, customer: r.customer_id, ip: a.ip, diff: { amount_vnd: n(r.amount_vnd) } });
    await notify(rt.db, rt, { customer: r.customer_id, kind: 'refund_approved', title: 'Yêu cầu hoàn tiền đã được duyệt', refType: 'refund_request', refId: id });
    return c.json({ id, status: 'approved' });
  }));

  app.post('/admin/v1/refund-requests/:id/reject', wrap(async (c) => {
    const a = requirePerm(await actorOf(c), 'finance', 'approve', 'internal');
    const id = c.req.param('id');
    const b = await jsonBody(c, z.object({ note: z.string().min(3).max(500) }));
    const claim = await rt.db.run("UPDATE refund_requests SET status = 'rejected', decided_by = ?, decision_note = ?, decided_at = ? WHERE id = ? AND status = 'pending'", [a.id, b.note, iso(rt), id]);
    if (claim.changes !== 1) throw new FinanceError('already_processed', 'Yêu cầu đã được xử lý hoặc không tồn tại', 409);
    await audit(rt.db, rt, { actor: a.id, action: 'finance.refund.reject', type: 'refund_request', id, ip: a.ip, diff: { note: b.note } });
    return c.json({ id, status: 'rejected' });
  }));

  app.post('/admin/v1/refund-requests/:id/paid', wrap(async (c) => {
    const a = requirePerm(await actorOf(c), 'finance', 'approve', 'internal');
    const id = c.req.param('id');
    const b = await jsonBody(c, z.object({ voucher_ref: z.string().min(3).max(100) })); // chung tu bat buoc
    const claim = await rt.db.run("UPDATE refund_requests SET status = 'paid', decision_note = COALESCE(decision_note,'') || ? WHERE id = ? AND status = 'approved'", [` [chứng từ: ${b.voucher_ref}]`, id]);
    if (claim.changes !== 1) throw new FinanceError('not_approved', 'Chỉ đánh dấu đã chi khi yêu cầu đã duyệt', 409);
    await audit(rt.db, rt, { actor: a.id, action: 'finance.refund.paid', type: 'refund_request', id, ip: a.ip, diff: { voucher_ref: b.voucher_ref } });
    return c.json({ id, status: 'paid' });
  }));

  // ================= admin: activation log =================
  app.get('/admin/v1/activation-log', wrap(async (c) => {
    requirePerm(await actorOf(c), 'finance', 'view', 'internal');
    const rows = await rt.db.query<Record<string, unknown>>('SELECT id, customer_id, trigger_topup_id, actions, created_at FROM activation_log ORDER BY created_at DESC, id DESC LIMIT 200');
    return c.json({ items: rows.map((r) => ({ ...r, actions: (() => { try { return JSON.parse(String(r['actions'])); } catch { return []; } })() })) });
  }));

  app.post('/admin/v1/activation-log/:id/undo', wrap(async (c) => {
    const a = requirePerm(await actorOf(c), 'finance', 'approve', 'internal');
    try {
      return c.json(await undoActivation(rt, rt.db, c.req.param('id'), a.id));
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'not_found') throw new FinanceError('not_found', 'Không tìm thấy bản ghi kích hoạt', 404);
      if (code === 'already_undone') throw new FinanceError('already_undone', 'Đã hoàn tác trước đó', 409);
      throw e;
    }
  }));

  // ================= admin: cau hinh SePay =================
  async function sepayView(db: Db) {
    const cfg = await loadSepayConfig(rt, db);
    const sec = await loadSecrets(rt, db);
    const recent = await db.query<Record<string, unknown>>(
      `SELECT w.id, w.received_at, w.payload, w.result, c.short_name AS customer FROM payment_webhooks w LEFT JOIN customers c ON c.id = w.matched_customer_id
       ORDER BY w.received_at DESC, w.id DESC LIMIT 20`);
    return {
      enabled: cfg.enabled, bank: cfg.bank, account_number: cfg.account_number, account_holder: cfg.account_holder, prefix: cfg.prefix,
      webhook_url: cfg.webhook_url, auth_mode: cfg.auth_mode, auto_activate: cfg.auto_activate, min_activate_vnd: cfg.min_amount_vnd, daily_limit_vnd: cfg.daily_limit_vnd,
      env: sepayMode(rt), dev_mode: devSimulateAllowed(rt), has_secret: !!(sec.hmacSecret || sec.apiKey),
      sample_account: cfg.account_number === SAMPLE_ACCOUNT, banks: BANKS,
      recent: recent.map((r) => {
        let amount = 0, content: string | null = null;
        try { const p = JSON.parse(String(r['payload'])) as Record<string, unknown>; amount = n(p['transferAmount']); content = (p['content'] as string) ?? null; } catch { /* giu nguyen */ }
        return { id: r['id'], at: r['received_at'], content, amount_vnd: amount, result: r['result'], customer: r['customer'] };
      }),
    };
  }

  app.get('/admin/v1/settings/sepay', wrap(async (c) => {
    requirePerm(await actorOf(c), 'finance', 'view', 'internal');
    return c.json(await sepayView(rt.db));
  }));

  app.put('/admin/v1/settings/sepay', wrap(async (c) => {
    // doi tai khoan nhan tien = chuyen huong dong tien: can quyen duyet
    const a = requirePerm(await actorOf(c), 'finance', 'approve', 'internal');
    const b = await jsonBody(c, z.object({
      enabled: z.boolean().optional(),
      bank: z.enum(BANKS).optional(),
      account_number: z.string().regex(/^[0-9]{6,20}$/, 'Số tài khoản 6-20 chữ số').optional(),
      account_holder: z.string().min(2).max(100).optional(),
      prefix: z.string().regex(/^[A-Za-z]{2,8}$/, 'Tiền tố 2-8 chữ cái').optional(),
      min_activate_vnd: z.number().int().min(0).optional(),
      auto_activate: z.boolean().optional(),
      daily_limit_vnd: z.number().int().min(0).optional(),
    }).passthrough());
    const before = await loadSepayConfig(rt);
    await saveSepayConfig(rt, rt.db, {
      ...(b.enabled !== undefined ? { enabled: b.enabled } : {}), ...(b.bank ? { bank: b.bank } : {}), ...(b.account_number ? { account_number: b.account_number } : {}),
      ...(b.account_holder ? { account_holder: b.account_holder.toUpperCase() } : {}), ...(b.prefix ? { prefix: b.prefix.toUpperCase() } : {}),
      ...(b.min_activate_vnd !== undefined ? { min_amount_vnd: b.min_activate_vnd } : {}), ...(b.auto_activate !== undefined ? { auto_activate: b.auto_activate } : {}),
      ...(b.daily_limit_vnd !== undefined ? { daily_limit_vnd: b.daily_limit_vnd } : {}),
    }, a.id);
    const mask = (s: string | null) => (s ? `***${s.slice(-3)}` : null);
    await audit(rt.db, rt, { actor: a.id, action: 'finance.sepay.update', type: 'settings', id: 'sepay', ip: a.ip, diff: { bank: [before.bank, b.bank ?? before.bank], account: [mask(before.account_number), mask(b.account_number ?? before.account_number)], prefix: [before.prefix, b.prefix?.toUpperCase() ?? before.prefix] } });
    return c.json(await sepayView(rt.db));
  }));

  // "Gui thu": tu kiem tra cau hinh + vong ky/xac thuc chu ky cuc bo (khong goi mang, khong cong tien)
  app.post('/admin/v1/settings/sepay/test', wrap(async (c) => {
    requirePerm(await actorOf(c), 'finance', 'write', 'internal');
    const cfg = await loadSepayConfig(rt);
    const sec = await loadSecrets(rt);
    const problems: string[] = [];
    if (!cfg.bank) problems.push('chưa chọn ngân hàng');
    if (!cfg.account_number) problems.push('chưa nhập số tài khoản');
    else if (cfg.account_number === SAMPLE_ACCOUNT) problems.push('đang dùng số tài khoản MẪU 0123456789');
    if (!cfg.account_holder) problems.push('chưa nhập tên chủ tài khoản');
    if (!sec.hmacSecret && !sec.apiKey) problems.push('chưa cấu hình khóa bí mật webhook (SEPAY_WEBHOOK_SECRET / SEPAY_API_KEY)');
    let signature_ok = false;
    if (sec.hmacSecret) {
      const body = JSON.stringify({ id: 'selftest', transferType: 'in', transferAmount: 1 });
      const ts = String(Math.floor(rt.clock.now().getTime() / 1000));
      const h = new Headers({ 'x-sepay-timestamp': ts, 'x-sepay-signature': `sha256=${await hmacSha256Hex(sec.hmacSecret, `${ts}.${body}`)}` });
      signature_ok = (await authenticateWebhook(rt, h, body)).ok;
    }
    return c.json({ ok: problems.length === 0 && (signature_ok || !!sec.apiKey), signature_ok, problems, message: problems.length ? `Cần xử lý: ${problems.join('; ')}.` : 'Cấu hình hợp lệ. Dán URL webhook vào my.sepay.vn > Webhooks rồi bấm Gửi thử bên SePay.' });
  }));

  return { port, devSimulate };
}
