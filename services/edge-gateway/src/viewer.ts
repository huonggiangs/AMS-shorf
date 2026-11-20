// Phia nguoi xem (WP-18): ghep doi tu dien thoai, vi thuong, rut tien (cho tai chinh duyet), tuong tac QR, uy quyen thue.
// Moi endpoint nhan yeu cau DA KY bang khoa thiet bi (giong /v1/*), kiem quyen o may chu: thiet bi `phone` moi duoc doc vi / rut tien.
// Tien la so nguyen dong; so cai wallet_ledger bat bien (chi INSERT). KHONG co dong nao o day tu chuyen tien: rut tien chi tao payouts 'pending'.
// Tuong thich D1: thao tac tien dung mot cau lenh co dieu kien hoac db.batch (khong dua vao rollback cua tx).
import type { Context, Hono } from 'hono';
import type { Db, Runtime } from '@ams/runtime';
import { decryptField, encryptField, fromBase64Url, fromUtf8, hmacSha256Hex, sha256Hex, timingSafeEqualStr, toBase64Url, utf8 } from '@ams/shared';
import { authenticateDevice, type AuthDeps } from './auth.js';
import type { DeviceDirectory, DeviceRec } from './devices.js';
import { groupOfDevice, type ManifestService } from './manifest.js';
import { redeemPairingCode, randomCode6 } from './pairing.js';
import {
  MAX_INTERACTION_BODY_BYTES,
  MAX_VIEWER_BODY_BYTES,
  interactionsBody,
  phoneBody,
  taxAuthBody,
  viewerPairBody,
  withdrawBody,
  type WithdrawBody,
} from './protocol.js';
import { HttpProblem, clientIp, envInt } from './util.js';
import type { ImpressionRow } from '@ams/ingest-consumer/contract';

// ------------------------------------------------------------------ cau hinh
export interface ViewerPolicy {
  withdrawEnabled: boolean; // VIEWER_WITHDRAW_ENABLED=1 (mac dinh TAT: can ra soat thue/KYC truoc khi bat chi tra that)
  requireTaxConsent: boolean; // PAYOUT_REQUIRE_TAX_CONSENT (mac dinh 1)
  thresholdVnd: number; // PAYOUT_THRESHOLD_VND, quyet dinh: 100.000 cong don
  unitPriceVnd: number; // chi de HIEN THI tren app (20 d)
  interactionMaxRewardVnd: number; // tran van hanh don gia tuong tac (50 d)
  dailyRewardCapVnd: number; // tran thuong moi nguoi dung moi ngay (gio VN), tat ca nguon
  interactionsPerUserDay: number;
  interactionsPerCampaignUserDay: number;
  maxTvsPerUser: number;
  otpTtlS: number;
  otpMaxAttempts: number;
  otpSendsPerHour: number;
  pairFailLimit: number; // so lan nhap sai moi thiet bi / 15 phut
  taxConsentVersion: string;
  otpDevEcho: boolean; // CHI local/test: tra ma OTP trong phan hoi
}

export function viewerPolicyFromEnv(env: Record<string, string | undefined>, local: boolean): ViewerPolicy {
  return {
    withdrawEnabled: env['VIEWER_WITHDRAW_ENABLED'] === '1',
    requireTaxConsent: env['PAYOUT_REQUIRE_TAX_CONSENT'] !== '0',
    thresholdVnd: envInt(env, 'PAYOUT_THRESHOLD_VND', 100_000),
    unitPriceVnd: envInt(env, 'VIEWER_UNIT_PRICE_VND', 20),
    interactionMaxRewardVnd: envInt(env, 'INTERACTION_MAX_REWARD_VND', 50),
    dailyRewardCapVnd: envInt(env, 'VIEWER_DAILY_REWARD_CAP_VND', 10_000),
    interactionsPerUserDay: envInt(env, 'INTERACTIONS_PER_USER_DAY', 30),
    interactionsPerCampaignUserDay: envInt(env, 'INTERACTIONS_PER_CAMPAIGN_USER_DAY', 3),
    maxTvsPerUser: envInt(env, 'VIEWER_MAX_TVS', 10),
    otpTtlS: envInt(env, 'VIEWER_OTP_TTL_S', 300),
    otpMaxAttempts: envInt(env, 'VIEWER_OTP_MAX_ATTEMPTS', 5),
    otpSendsPerHour: envInt(env, 'VIEWER_OTP_SENDS_PER_HOUR', 3),
    pairFailLimit: envInt(env, 'VIEWER_PAIR_FAIL_LIMIT', 5),
    taxConsentVersion: env['TAX_CONSENT_VERSION'] ?? 'v0-draft',
    otpDevEcho: local && env['VIEWER_OTP_DEV_ECHO'] === '1',
  };
}

/** Cong gui OTP (SMS / Zalo ZNS / email). CHUA co nha cung cap: production phai tiem cai dat that; khong co => not_configured. */
export interface OtpSender {
  send(m: { to: string; purpose: 'phone_verify' | 'withdraw'; code: string; ttlS: number }): Promise<void>;
}
export interface ViewerOptions {
  otpSender?: OtpSender;
  policy?: Partial<ViewerPolicy>;
}

export interface ViewerCtx {
  rt: Runtime;
  deps: AuthDeps;
  devices: DeviceDirectory;
  manifests: ManifestService;
  policy: ViewerPolicy;
  otpSender?: OtpSender;
  rewardCfg: CampaignRewardCfg;
  readBody(c: Context, max: number): Promise<Uint8Array>;
  parseJson(b: Uint8Array): unknown;
  rateLimit(key: string, limit: number, windowSec: number, what: string): Promise<void>;
}

// ------------------------------------------------------------------ cau hinh thuong theo chien dich
export interface CampaignReward {
  reward_model: 'cover' | 'performance';
  interaction_reward_vnd: number;
}

/** Doc loai chien dich + don gia tuong tac tu DB (cache bo nho ngan). Chien dich la/da xoa => 'performance', 0 d (khong thuong). */
export class CampaignRewardCfg {
  private mem = new Map<string, { at: number; v: CampaignReward }>();
  constructor(
    private rt: Runtime,
    private ttlMs = 30_000,
  ) {}
  async get(ids: string[]): Promise<Map<string, CampaignReward>> {
    const now = this.rt.clock.now().getTime();
    const out = new Map<string, CampaignReward>();
    const need: string[] = [];
    for (const id of new Set(ids)) {
      const m = this.mem.get(id);
      if (m && now - m.at < this.ttlMs) out.set(id, m.v);
      else need.push(id);
    }
    for (let i = 0; i < need.length; i += 50) {
      const part = need.slice(i, i + 50);
      const rows = await this.rt.db.query<{ id: string; reward_model: string; interaction_reward_vnd: number }>(
        `SELECT id, reward_model, interaction_reward_vnd FROM campaigns WHERE id IN (${part.map(() => '?').join(',')})`,
        part,
      );
      for (const r of rows) {
        const v: CampaignReward = { reward_model: r.reward_model === 'cover' ? 'cover' : 'performance', interaction_reward_vnd: Math.max(0, Number(r.interaction_reward_vnd) || 0) };
        out.set(r.id, v);
        this.mem.set(r.id, { at: now, v });
      }
      for (const id of part) if (!out.has(id)) out.set(id, { reward_model: 'performance', interaction_reward_vnd: 0 });
    }
    if (this.mem.size > 20_000) this.mem.clear();
    return out;
  }
}

// ------------------------------------------------------------------ tien ich
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** 00:00 gio Viet Nam (UTC+7) cua ngay chua `nowMs`, dang ISO UTC (so sanh chuoi duoc voi created_at). */
export function vnDayStartIso(nowMs: number): string {
  const off = 7 * 3600_000;
  return new Date(Math.floor((nowMs + off) / 86_400_000) * 86_400_000 - off).toISOString();
}

function needPhone(dev: DeviceRec): void {
  if (dev.kind !== 'phone') throw new HttpProblem('forbidden', 'Chi thiet bi dien thoai (kind=phone) moi dung duoc chuc nang nay.');
}
function needUser(dev: DeviceRec): string {
  if (!dev.userId) throw new HttpProblem('forbidden', 'Hay ghep doi TV bang ma 6 so truoc.');
  return dev.userId;
}

function maskPhone(p: string): string {
  return p.length >= 7 ? `${p.slice(0, 3)}****${p.slice(-3)}` : '***';
}
export function normalizePhone(p: string): string {
  return p.startsWith('+84') ? '0' + p.slice(3) : p;
}

async function encKey(x: ViewerCtx): Promise<string> {
  const k = x.rt.config.env['FIELD_ENC_KEY'];
  if (!k) throw new HttpProblem('not_configured', 'May chu chua cau hinh khoa ma hoa truong (FIELD_ENC_KEY).');
  return k;
}

async function sumLedger(db: Db, userId: string): Promise<{ bal: number; views: number; inter: number }> {
  const r = (
    await db.query<{ bal: unknown; views: unknown; inter: unknown }>(
      `SELECT COALESCE(SUM(amount_vnd), 0) AS bal,
              COALESCE(SUM(CASE WHEN kind = 'reward' AND ref_type = 'impression' THEN 1 ELSE 0 END), 0) AS views,
              COALESCE(SUM(CASE WHEN kind = 'reward' AND ref_type = 'interaction' THEN 1 ELSE 0 END), 0) AS inter
         FROM wallet_ledger WHERE user_id = ? AND status = 'posted'`,
      [userId],
    )
  )[0];
  return { bal: num(r?.bal), views: num(r?.views), inter: num(r?.inter) };
}
async function sumPayouts(db: Db, userId: string, status: string): Promise<number> {
  const r = (await db.query<{ s: unknown }>('SELECT COALESCE(SUM(amount_vnd), 0) AS s FROM payouts WHERE user_id = ? AND status = ?', [userId, status]))[0];
  return num(r?.s);
}
async function rewardSumSince(db: Db, userId: string, sinceIso: string): Promise<number> {
  const r = (await db.query<{ s: unknown }>("SELECT COALESCE(SUM(amount_vnd), 0) AS s FROM wallet_ledger WHERE user_id = ? AND kind = 'reward' AND status = 'posted' AND created_at >= ?", [userId, sinceIso]))[0];
  return num(r?.s);
}
async function currentTax(db: Db, userId: string): Promise<{ mode: string; consent_version: string | null; created_at: string } | null> {
  return (
    (await db.query<{ mode: string; consent_version: string | null; created_at: string }>('SELECT mode, consent_version, created_at FROM viewer_tax_authorizations WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 1', [userId]))[0] ?? null
  );
}

// ------------------------------------------------------------------ OTP
async function otpHash(x: ViewerCtx, purpose: string, userId: string, ctx: string, code: string): Promise<string> {
  const secret = x.rt.config.env['VIEWER_OTP_SECRET'] ?? x.rt.config.env['FIELD_ENC_KEY'];
  if (!secret) throw new HttpProblem('not_configured', 'May chu chua cau hinh khoa OTP.');
  return hmacSha256Hex(secret, `${purpose}|${userId}|${ctx}|${code}`);
}
const otpKeys = (purpose: string, userId: string) => ({ main: `votp:${purpose}:${userId}`, tries: `votpa:${purpose}:${userId}` });

interface OtpIssued {
  expiresIn: number;
  devCode?: string;
}
async function issueOtp(x: ViewerCtx, purpose: 'phone_verify' | 'withdraw', userId: string, ctx: string, to: string): Promise<OtpIssued> {
  if (!x.otpSender && !x.policy.otpDevEcho) throw new HttpProblem('not_configured', 'Chua cau hinh kenh gui OTP (SMS/Zalo): chuc nang can OTP tam thoi chua dung duoc.', { reason: 'otp_channel_not_configured' });
  await x.rateLimit(`otp:${userId}`, x.policy.otpSendsPerHour, 3600, 'gui OTP');
  const code = randomCode6();
  const k = otpKeys(purpose, userId);
  await x.rt.kv.set(k.main, await otpHash(x, purpose, userId, ctx, code), x.policy.otpTtlS);
  await x.rt.kv.del(k.tries);
  if (x.otpSender) await x.otpSender.send({ to, purpose, code, ttlS: x.policy.otpTtlS });
  return { expiresIn: x.policy.otpTtlS, ...(x.policy.otpDevEcho ? { devCode: code } : {}) };
}
async function verifyOtp(x: ViewerCtx, purpose: string, userId: string, ctx: string, code: string): Promise<void> {
  const k = otpKeys(purpose, userId);
  const stored = await x.rt.kv.get(k.main);
  if (!stored) throw new HttpProblem('otp_invalid', 'OTP het han hoac chua duoc gui.');
  const tries = await x.rt.kv.incr(k.tries, x.policy.otpTtlS);
  if (tries > x.policy.otpMaxAttempts) {
    await x.rt.kv.del(k.main);
    throw new HttpProblem('otp_invalid', 'Nhap sai OTP qua nhieu lan, hay xin ma moi.');
  }
  if (!timingSafeEqualStr(stored, await otpHash(x, purpose, userId, ctx, code))) throw new HttpProblem('otp_invalid', 'OTP khong dung.');
  await x.rt.kv.del(k.main); // dung mot lan
  await x.rt.kv.del(k.tries);
}

// ------------------------------------------------------------------ ghi thuong luot xem (goi tu /v1/events)
/**
 * Ghi wallet_ledger cho cac impression hop le co thuong (chi chien dich 'cover', xem events.ts). Khu trung theo event_id (chi muc duy nhat);
 * ap tran thuong/ngay cua nguoi dung: vuot tran => dat reward_vnd = 0 tren chinh dong impression (de kho su kien khop so cai).
 */
export async function postViewRewards(x: Pick<ViewerCtx, 'rt' | 'policy'>, dev: DeviceRec, rows: ImpressionRow[]): Promise<number> {
  const cand = rows.filter((r) => r.valid === 1 && r.reward_vnd > 0);
  if (cand.length === 0) return 0;
  if (!dev.userId) {
    for (const r of cand) r.reward_vnd = 0; // thiet bi chua gan nguoi dung: khong co vi de ghi
    return 0;
  }
  const { rt, policy } = x;
  const now = rt.clock.now();
  const nowIso = now.toISOString();
  // event_id da co dong thuong (gui lai): giu nguyen so tien da ghi, KHONG tinh lai vao tran ngay, khong ghi them
  const done = new Map<string, number>();
  const ids = cand.map((r) => r.event_id);
  for (let i = 0; i < ids.length; i += 50) {
    const part = ids.slice(i, i + 50);
    const got = await rt.db.query<{ ref_id: string; amount_vnd: unknown }>(`SELECT ref_id, amount_vnd FROM wallet_ledger WHERE kind = 'reward' AND ref_type = 'impression' AND ref_id IN (${part.map(() => '?').join(',')})`, part);
    for (const g of got) done.set(g.ref_id, num(g.amount_vnd));
  }
  let used = await rewardSumSince(rt.db, dev.userId, vnDayStartIso(now.getTime()));
  const stmts: { sql: string; params: unknown[] }[] = [];
  let total = 0;
  for (const r of cand) {
    const prior = done.get(r.event_id);
    if (prior !== undefined) {
      r.reward_vnd = prior;
      continue;
    }
    if (used + r.reward_vnd > policy.dailyRewardCapVnd) {
      r.reward_vnd = 0;
      continue;
    }
    used += r.reward_vnd;
    total += r.reward_vnd;
    stmts.push({
      sql: `INSERT INTO wallet_ledger (id, user_id, kind, amount_vnd, ref_type, ref_id, status, created_at) VALUES (?, ?, 'reward', ?, 'impression', ?, 'posted', ?) ON CONFLICT DO NOTHING`,
      params: [rt.id(), dev.userId, r.reward_vnd, r.event_id, nowIso],
    });
  }
  for (let i = 0; i < stmts.length; i += 50) await rt.db.batch(stmts.slice(i, i + 50));
  return total;
}

// ------------------------------------------------------------------ routes
export function mountViewerRoutes(app: Hono, x: ViewerCtx): void {
  const { rt, policy } = x;
  const nowIso = () => rt.clock.now().toISOString();

  // ---------------------------------------------------------- POST /v1/viewer/pair
  app.post('/v1/viewer/pair', async (c) => {
    const body = await x.readBody(c, MAX_VIEWER_BODY_BYTES);
    const dev = await authenticateDevice(c, x.deps, body);
    needPhone(dev);
    await x.rateLimit(`vpair:ip:${clientIp(c)}`, 30, 3600, 'ghep doi theo IP');
    const failKey = `vpairfail:${dev.id}`;
    const fails = Number((await rt.kv.get(failKey)) ?? 0);
    if (fails >= policy.pairFailLimit) throw new HttpProblem('rate_limited', 'Nhap sai ma qua nhieu lan, thu lai sau 15 phut.', { retry_after: 900 }, { 'retry-after': '900' });
    const { code } = viewerPairBody.parse(x.parseJson(body));
    const bad = async (): Promise<never> => {
      await rt.kv.incr(failKey, 900);
      throw new HttpProblem('invalid_code', 'Ma ghep doi khong dung hoac da het han.');
    };
    const row = (await rt.db.query<{ device_id: string; expires_at: string; used_at: string | null }>('SELECT device_id, expires_at, used_at FROM pairing_codes WHERE code = ?', [code]))[0];
    if (!row || row.used_at || row.expires_at <= nowIso()) return bad();
    const tv = (await rt.db.query<{ id: string; user_id: string | null; blocked: number; kind: string; name: string | null; model: string | null }>('SELECT id, user_id, blocked, kind, name, model FROM devices WHERE id = ?', [row.device_id]))[0];
    if (!tv || Number(tv.blocked) === 1 || tv.kind === 'phone') return bad();

    let userId = dev.userId;
    if (tv.user_id && tv.user_id === userId) return c.json({ paired: true, device_id: tv.id, trust_level: 1, already: true });
    if (tv.user_id) throw new HttpProblem('already_paired', 'TV nay da ghep voi tai khoan khac.');
    if (userId) {
      const n = num((await rt.db.query<{ n: unknown }>("SELECT COUNT(*) AS n FROM devices WHERE user_id = ? AND kind <> 'phone'", [userId]))[0]?.n);
      if (n >= policy.maxTvsPerUser) throw new HttpProblem('forbidden', `Toi da ${policy.maxTvsPerUser} TV cho moi tai khoan.`);
    } else {
      // ma hop le => moi tao nguoi dung cho dien thoai nay va nang tin cay len 1 (khong tao nguoi dung rac khi ma sai)
      const id = rt.id();
      await rt.db.run('INSERT INTO end_users (id, phone_hash, email_enc, display_name, created_at) VALUES (?, NULL, NULL, NULL, ?)', [id, nowIso()]);
      const u = await rt.db.run('UPDATE devices SET user_id = ?, paired_at = ?, trust_level = CASE WHEN trust_level < 1 THEN 1 ELSE trust_level END WHERE id = ? AND user_id IS NULL', [id, nowIso(), dev.id]);
      if (u.changes === 1) userId = id;
      else userId = (await rt.db.query<{ user_id: string | null }>('SELECT user_id FROM devices WHERE id = ?', [dev.id]))[0]?.user_id ?? null;
      await x.devices.invalidate(dev.id);
      if (!userId) throw new Error('khong gan duoc nguoi dung cho dien thoai');
    }
    const red = await redeemPairingCode(rt, code, userId);
    if (!red.ok) return bad();
    await x.devices.invalidate(red.deviceId);
    await rt.kv.del(failKey);
    await rt.db.run('INSERT INTO audit_log (id, ts, actor_id, action, object_type, object_id, customer_id, ip, diff) VALUES (?,?,?,?,?,?,?,?,?)', [rt.id(), nowIso(), userId, 'viewer.pair', 'device', red.deviceId, null, clientIp(c), JSON.stringify({ phone_device_id: dev.id })]);
    return c.json({ paired: true, device_id: red.deviceId, trust_level: 1 });
  });

  // ---------------------------------------------------------- GET /v1/wallet
  app.get('/v1/wallet', async (c) => {
    const dev = await authenticateDevice(c, x.deps, new Uint8Array());
    needPhone(dev);
    const base = { unit_price_vnd: policy.unitPriceVnd, payout_threshold_vnd: policy.thresholdVnd, interaction_reward_range_vnd: [20, policy.interactionMaxRewardVnd], daily_reward_cap_vnd: policy.dailyRewardCapVnd, withdraw_enabled: policy.withdrawEnabled };
    if (!dev.userId) return c.json({ paired: false, balance_vnd: 0, ledger_balance_vnd: 0, pending_payout_vnd: 0, total_paid_vnd: 0, views: 0, interactions: 0, payouts: [], devices: [], tax_mode: 'none', tax_authorization: 'none', phone_verified: false, ...base });
    const uid = dev.userId;
    const l = await sumLedger(rt.db, uid);
    const pending = await sumPayouts(rt.db, uid, 'pending');
    const paid = await sumPayouts(rt.db, uid, 'paid');
    const payouts = await rt.db.query<{ id: string; amount_vnd: unknown; status: string; requested_at: string; paid_at: string | null }>('SELECT id, amount_vnd, status, requested_at, paid_at FROM payouts WHERE user_id = ? ORDER BY requested_at DESC, id DESC LIMIT 20', [uid]);
    const tvs = await rt.db.query<{ id: string; name: string | null; model: string | null; paired_at: string | null }>("SELECT id, name, model, paired_at FROM devices WHERE user_id = ? AND kind <> 'phone' ORDER BY paired_at DESC, id LIMIT 20", [uid]);
    const user = (await rt.db.query<{ phone_verified_at: string | null }>('SELECT phone_verified_at FROM end_users WHERE id = ?', [uid]))[0];
    const tax = await currentTax(rt.db, uid);
    const today = await rewardSumSince(rt.db, uid, vnDayStartIso(rt.clock.now().getTime()));
    return c.json({
      paired: true,
      balance_vnd: Math.max(0, l.bal - pending),
      ledger_balance_vnd: l.bal,
      pending_payout_vnd: pending,
      total_paid_vnd: paid,
      views: l.views,
      interactions: l.inter,
      payouts: payouts.map((p) => ({ id: p.id, amount_vnd: num(p.amount_vnd), status: p.status, requested_at: p.requested_at, paid_at: p.paid_at })),
      devices: tvs.map((t) => ({ device_id: t.id, name: t.name ?? t.model, paired_at: t.paired_at })),
      tax_mode: tax?.mode ?? 'none',
      tax_authorization: tax?.mode ?? 'none', // ten truong cua app Mindo
      phone_verified: !!user?.phone_verified_at,
      today_reward_vnd: today,
      ...base,
    });
  });

  // ---------------------------------------------------------- GET /v1/wallet/ledger
  app.get('/v1/wallet/ledger', async (c) => {
    const dev = await authenticateDevice(c, x.deps, new Uint8Array());
    needPhone(dev);
    const uid = needUser(dev);
    const lim = Math.min(Math.max(Math.trunc(Number(c.req.query('limit') ?? 20)) || 20, 1), 100);
    let after: { t: string; id: string } | null = null;
    const cur = c.req.query('cursor');
    if (cur) {
      try {
        const [t, id] = fromUtf8(fromBase64Url(cur)).split('|');
        if (!t || !id || Number.isNaN(Date.parse(t))) throw new Error('x');
        after = { t, id };
      } catch {
        throw new HttpProblem('validation_failed', 'cursor khong hop le.');
      }
    }
    const rows = await rt.db.query<{ id: string; kind: string; amount_vnd: unknown; status: string; created_at: string; ref_type: string | null }>(
      `SELECT id, kind, amount_vnd, status, created_at, ref_type FROM wallet_ledger WHERE user_id = ?${after ? ' AND (created_at < ? OR (created_at = ? AND id < ?))' : ''} ORDER BY created_at DESC, id DESC LIMIT ?`,
      after ? [uid, after.t, after.t, after.id, lim + 1] : [uid, lim + 1],
    );
    const page = rows.slice(0, lim);
    const last = page[page.length - 1];
    return c.json({
      items: page.map((r) => ({ id: r.id, kind: r.kind, amount_vnd: num(r.amount_vnd), status: r.status, created_at: r.created_at, ref_type: r.ref_type })),
      ...(rows.length > lim && last ? { next_cursor: toBase64Url(utf8(`${last.created_at}|${last.id}`)) } : {}),
    });
  });

  // ---------------------------------------------------------- POST /v1/viewer/phone  (khong co otp: gui OTP; co otp: xac minh)
  app.post('/v1/viewer/phone', async (c) => {
    const body = await x.readBody(c, MAX_VIEWER_BODY_BYTES);
    const dev = await authenticateDevice(c, x.deps, body);
    needPhone(dev);
    const uid = needUser(dev);
    const b = phoneBody.parse(x.parseJson(body));
    const phone = normalizePhone(b.phone);
    const key = await encKey(x);
    if (!b.otp) {
      const o = await issueOtp(x, 'phone_verify', uid, phone, phone);
      return c.json({ otp_sent: true, expires_in: o.expiresIn, phone_masked: maskPhone(phone), ...(o.devCode ? { dev_otp: o.devCode } : {}) }, 202);
    }
    await verifyOtp(x, 'phone_verify', uid, phone, b.otp);
    const hash = await hmacSha256Hex(key, `phone|${phone}`);
    try {
      await rt.db.run('UPDATE end_users SET phone_hash = ?, phone_enc = ?, phone_verified_at = ? WHERE id = ?', [hash, await encryptField(key, phone, `phone:${uid}`), nowIso(), uid]);
    } catch {
      throw new HttpProblem('already_paired', 'So dien thoai da gan voi tai khoan khac.');
    }
    await rt.db.run('INSERT INTO audit_log (id, ts, actor_id, action, object_type, object_id, customer_id, ip, diff) VALUES (?,?,?,?,?,?,?,?,?)', [rt.id(), nowIso(), uid, 'viewer.phone_verified', 'end_user', uid, null, clientIp(c), JSON.stringify({ phone_masked: maskPhone(phone) })]);
    return c.json({ verified: true, phone_masked: maskPhone(phone) });
  });

  // ---------------------------------------------------------- GET/POST /v1/tax-authorization
  const taxView = (t: { mode: string; consent_version: string | null; created_at: string } | null) => ({
    mode: t?.mode ?? 'none',
    consent_version: t?.consent_version ?? null,
    updated_at: t?.created_at ?? null,
    current_consent_version: policy.taxConsentVersion,
    modes: ['none', 'auto_pay', 'delegate'],
    tax_authorization: t?.mode ?? 'none', // ten truong cua app Mindo
    // CHUA khau tru / nop thue that: chi luu y chi. Xem docs/VIEWER-API.md muc 7.
    remittance_active: false,
  });
  app.get('/v1/tax-authorization', async (c) => {
    const dev = await authenticateDevice(c, x.deps, new Uint8Array());
    needPhone(dev);
    return c.json(taxView(dev.userId ? await currentTax(rt.db, dev.userId) : null));
  });
  app.post('/v1/tax-authorization', async (c) => {
    const body = await x.readBody(c, MAX_VIEWER_BODY_BYTES);
    const dev = await authenticateDevice(c, x.deps, body);
    needPhone(dev);
    const uid = needUser(dev);
    await x.rateLimit(`tax:${uid}`, 10, 3600, 'doi uy quyen thue');
    const b = taxAuthBody.parse(x.parseJson(body));
    if (b.mode !== 'none' && b.consent_version !== policy.taxConsentVersion) throw new HttpProblem('validation_failed', 'Phien ban dieu khoan thue khong con hieu luc.', { current_consent_version: policy.taxConsentVersion });
    const taxEnc = b.tax_code ? await encryptField(await encKey(x), b.tax_code.replace('-', ''), `tax:${uid}`) : null;
    const id = rt.id();
    const ts = nowIso();
    await rt.db.batch([
      { sql: 'INSERT INTO viewer_tax_authorizations (id, user_id, mode, consent_version, tax_code_enc, device_id, ip, created_at) VALUES (?,?,?,?,?,?,?,?)', params: [id, uid, b.mode, b.consent_version, taxEnc, dev.id, clientIp(c), ts] },
      { sql: 'INSERT INTO audit_log (id, ts, actor_id, action, object_type, object_id, customer_id, ip, diff) VALUES (?,?,?,?,?,?,?,?,?)', params: [rt.id(), ts, uid, 'viewer.tax_authorization', 'end_user', uid, null, clientIp(c), JSON.stringify({ mode: b.mode, consent_version: b.consent_version, has_tax_code: !!taxEnc })] },
    ]);
    return c.json(taxView({ mode: b.mode, consent_version: b.consent_version, created_at: ts }));
  });

  // ---------------------------------------------------------- POST /v1/withdraw
  const replayOf = (p: { id: string; amount_vnd: unknown; status: string; requested_at: string }) => ({ payout_id: p.id, id: p.id, status: p.status, amount_vnd: num(p.amount_vnd), requested_at: p.requested_at, review: 'awaiting_finance_approval', idempotent_replay: true });

  app.post('/v1/withdraw', async (c) => {
    const body = await x.readBody(c, MAX_VIEWER_BODY_BYTES);
    const dev = await authenticateDevice(c, x.deps, body);
    needPhone(dev);
    const b: WithdrawBody = withdrawBody.parse(x.parseJson(body));
    if (!policy.withdrawEnabled) throw new HttpProblem('feature_disabled', 'Chi tra chua duoc bat (dang ra soat thue/KYC). So du van duoc tich luy.');
    const uid = needUser(dev);
    const last4 = b.bank.account_number.slice(-4);

    // idempotent: gui lai cung khoa => tra lenh cu (khong can OTP moi)
    const prior = (await rt.db.query<{ id: string; amount_vnd: unknown; status: string; requested_at: string; account_last4: string | null }>('SELECT id, amount_vnd, status, requested_at, account_last4 FROM payouts WHERE user_id = ? AND idempotency_key = ?', [uid, b.idempotency_key]))[0];
    if (prior) {
      if (num(prior.amount_vnd) !== b.amount_vnd || prior.account_last4 !== last4) throw new HttpProblem('idempotency_conflict', 'idempotency_key da dung cho yeu cau khac.');
      return c.json(replayOf(prior));
    }
    const user = (await rt.db.query<{ phone_enc: string | null; phone_verified_at: string | null }>('SELECT phone_enc, phone_verified_at FROM end_users WHERE id = ?', [uid]))[0];
    if (!user?.phone_verified_at || !user.phone_enc) throw new HttpProblem('phone_not_verified', 'Hay xac minh so dien thoai truoc khi rut.');
    const stored = await currentTax(rt.db, uid);
    const taxMode = b.tax_authorization ?? stored?.mode ?? 'none'; // y chi di kem lenh rut thang the cho che do da luu
    if (policy.requireTaxConsent && taxMode === 'none') throw new HttpProblem('tax_consent_required', 'Hay chon che do thue (tu ke khai / thanh toan tu dong / uy quyen nop thue) truoc khi rut.');
    if (b.amount_vnd < policy.thresholdVnd) throw new HttpProblem('below_threshold', `Chua dat moc nhan thuong ${policy.thresholdVnd} dong.`, { threshold_vnd: policy.thresholdVnd });
    const avail = async () => (await sumLedger(rt.db, uid)).bal - (await sumPayouts(rt.db, uid, 'pending'));
    const have = await avail();
    if (b.amount_vnd > have) throw new HttpProblem('insufficient_balance', 'So du khong du.', { available_vnd: Math.max(0, have) });
    const key = await encKey(x);

    // OTP gan voi dung so tien + tai khoan: OTP cua yeu cau nay khong dung lai cho yeu cau khac
    const ctx = await sha256Hex(`${b.amount_vnd}|${b.bank.account_number}|${b.bank.bank_name}`);
    if (!b.otp) {
      const phone = await decryptField(key, user.phone_enc, `phone:${uid}`);
      const o = await issueOtp(x, 'withdraw', uid, ctx, phone);
      throw new HttpProblem('otp_required', 'Da gui OTP toi so dien thoai da xac minh.', { expires_in: o.expiresIn, phone_masked: maskPhone(phone), ...(o.devCode ? { dev_otp: o.devCode } : {}) });
    }
    await verifyOtp(x, 'withdraw', uid, ctx, b.otp);

    const id = rt.id();
    const ts = nowIso();
    const enc = await encryptField(key, JSON.stringify({ n: b.bank.account_number, name: b.bank.account_name }), `payout:${id}`);
    // mot lenh nguyen tu: chi them khi du so du kha dung, khong co lenh dang cho khac, chua co khoa idempotent. Khoa hang nguoi dung de PG tuan tu hoa.
    const taxChanged = taxMode !== (stored?.mode ?? 'none');
    const stmts: { sql: string; params: unknown[] }[] = [
      { sql: 'UPDATE end_users SET created_at = created_at WHERE id = ?', params: [uid] }, // khoa hang nguoi dung (PG tuan tu hoa; D1: khong tac dung)
      {
        sql: `INSERT INTO payouts (id, user_id, amount_vnd, channel, status, external_ref, requested_at, paid_at, idempotency_key, bank_code, bank_name, account_enc, account_last4, tax_mode, requested_via)
         SELECT ?, ?, CAST(? AS BIGINT), 'bank', 'pending', NULL, ?, NULL, ?, ?, ?, ?, ?, ?, 'viewer_app'
          WHERE COALESCE((SELECT SUM(amount_vnd) FROM wallet_ledger WHERE user_id = ? AND status = 'posted'), 0)
                - COALESCE((SELECT SUM(amount_vnd) FROM payouts WHERE user_id = ? AND status = 'pending'), 0) >= ?
            AND NOT EXISTS (SELECT 1 FROM payouts WHERE user_id = ? AND status = 'pending')
            AND NOT EXISTS (SELECT 1 FROM payouts WHERE user_id = ? AND idempotency_key = ?)`,
        params: [id, uid, b.amount_vnd, ts, b.idempotency_key, b.bank.bank_code ?? null, b.bank.bank_name, enc, last4, taxMode, uid, uid, b.amount_vnd, uid, uid, b.idempotency_key],
      },
    ];
    // cac dong phu chi ghi khi lenh rut THAT SU duoc tao (WHERE EXISTS tren chinh id vua chen), cung mot batch nguyen tu (PG/SQLite/D1)
    if (taxChanged) {
      stmts.push({
        sql: `INSERT INTO viewer_tax_authorizations (id, user_id, mode, consent_version, tax_code_enc, device_id, ip, created_at)
              SELECT ?, ?, ?, ?, NULL, ?, ?, ? WHERE EXISTS (SELECT 1 FROM payouts WHERE id = ?)`,
        params: [rt.id(), uid, taxMode, policy.taxConsentVersion, dev.id, clientIp(c), ts, id],
      });
    }
    stmts.push({
      sql: `INSERT INTO audit_log (id, ts, actor_id, action, object_type, object_id, customer_id, ip, diff)
            SELECT ?, ?, ?, ?, ?, ?, NULL, ?, ? WHERE EXISTS (SELECT 1 FROM payouts WHERE id = ?)`,
      params: [rt.id(), ts, uid, 'viewer.withdraw', 'payout', id, clientIp(c), JSON.stringify({ amount_vnd: b.amount_vnd, account_last4: last4, tax_mode: taxMode }), id],
    });
    const res = await rt.db.batch(stmts);
    const changes = res[1]?.changes ?? 0;
    if (changes !== 1) {
      const again = (await rt.db.query<{ id: string; amount_vnd: unknown; status: string; requested_at: string; account_last4: string | null }>('SELECT id, amount_vnd, status, requested_at, account_last4 FROM payouts WHERE user_id = ? AND idempotency_key = ?', [uid, b.idempotency_key]))[0];
      if (again) return c.json(replayOf(again));
      if (b.amount_vnd > (await avail())) throw new HttpProblem('insufficient_balance', 'So du khong du.');
      throw new HttpProblem('conflict', 'Dang co mot lenh rut cho tai chinh duyet. Hay cho lenh do xu ly xong.');
    }
    return c.json({ payout_id: id, id, status: 'pending', amount_vnd: b.amount_vnd, requested_at: ts, review: 'awaiting_finance_approval' }, 201);
  });

  // ---------------------------------------------------------- POST /v1/interactions
  app.post('/v1/interactions', async (c) => {
    const body = await x.readBody(c, MAX_INTERACTION_BODY_BYTES);
    const dev = await authenticateDevice(c, x.deps, body);
    if (dev.kind !== 'phone' && dev.kind !== 'tv') throw new HttpProblem('forbidden', 'Loai thiet bi khong duoc bao tuong tac.');
    await x.rateLimit(`inter:${dev.id}`, 20, 60, 'lo tuong tac theo thiet bi');
    const parsed = interactionsBody.parse(x.parseJson(body));
    const now = rt.clock.now().getTime();
    const dayStart = vnDayStartIso(now);
    const view = await x.manifests.get(groupOfDevice(dev));
    const cfgs = await x.rewardCfg.get(parsed.events.map((e) => e.campaign_id));
    const results: { event_id: string; status: 'credited' | 'recorded' | 'duplicate' | 'rejected'; credited_vnd: number; reason?: string }[] = [];
    const uid = dev.userId;
    const eligible = !!uid && dev.trust >= 1;

    const run = async (t: Db): Promise<void> => {
      if (uid) await t.run('UPDATE end_users SET created_at = created_at WHERE id = ?', [uid]); // tuan tu hoa cac lo cung nguoi dung (PG); tran dem lai tu DB
      let rewardedToday = uid ? await rewardSumSince(t, uid, dayStart) : 0;
      let countToday = uid ? num((await t.query<{ n: unknown }>('SELECT COUNT(*) AS n FROM viewer_interactions WHERE user_id = ? AND valid = 1 AND created_at >= ?', [uid, dayStart]))[0]?.n) : 0;
      const perCamp = new Map<string, number>();
      const seen = new Set<string>();
      for (const e of parsed.events) {
        const kind = e.kind ?? e.interaction!;
        const rej = (reason: string) => results.push({ event_id: e.event_id, status: 'rejected', credited_vnd: 0, reason });
        if (seen.has(e.event_id)) continue; // trung trong lo: bo qua im lang
        seen.add(e.event_id);
        const tsMs = Date.parse(e.ts);
        if (tsMs > now + 300_000 || tsMs < now - 24 * 3600_000) {
          rej('ts_out_of_range');
          continue;
        }
        const info = view.creative(e.creative_id);
        if (!info) {
          rej('not_in_manifest');
          continue;
        }
        if (info.campaign_id !== e.campaign_id) {
          rej('campaign_mismatch');
          continue;
        }
        const prev = (await t.query<{ device_id: string }>('SELECT device_id FROM viewer_interactions WHERE event_id = ?', [e.event_id]))[0];
        if (prev) {
          if (prev.device_id === dev.id) results.push({ event_id: e.event_id, status: 'duplicate', credited_vnd: 0 });
          else rej('duplicate');
          continue;
        }
        let reason: string | null = null;
        let reward = 0;
        if (!eligible) reason = 'untrusted_device';
        else {
          const cfg = cfgs.get(e.campaign_id);
          reward = Math.min(cfg?.interaction_reward_vnd ?? 0, policy.interactionMaxRewardVnd);
          let cc = perCamp.get(e.campaign_id);
          if (cc === undefined) cc = num((await t.query<{ n: unknown }>('SELECT COUNT(*) AS n FROM viewer_interactions WHERE user_id = ? AND campaign_id = ? AND valid = 1 AND created_at >= ?', [uid, e.campaign_id, dayStart]))[0]?.n);
          if (countToday >= policy.interactionsPerUserDay) reason = 'daily_cap';
          else if (cc >= policy.interactionsPerCampaignUserDay) reason = 'campaign_cap';
          else if (reward > 0 && rewardedToday + reward > policy.dailyRewardCapVnd) reason = 'daily_reward_cap';
          if (!reason) {
            perCamp.set(e.campaign_id, cc + 1);
            countToday++;
            rewardedToday += reward;
          }
        }
        const valid = reason === null;
        if (!valid) reward = 0;
        const ts = new Date(tsMs).toISOString();
        const created = new Date(now).toISOString();
        const stmts: { sql: string; params: unknown[] }[] = [
          {
            sql: 'INSERT INTO viewer_interactions (event_id, device_id, user_id, campaign_id, creative_id, slot_id, kind, ts, valid, reject_reason, reward_vnd, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT (event_id) DO NOTHING',
            params: [e.event_id, dev.id, uid, e.campaign_id, e.creative_id, e.slot_id ?? null, kind, ts, valid ? 1 : 0, reason, reward, created],
          },
        ];
        if (reward > 0 && uid) {
          stmts.push({
            sql: "INSERT INTO wallet_ledger (id, user_id, kind, amount_vnd, ref_type, ref_id, status, created_at) VALUES (?, ?, 'reward', ?, 'interaction', ?, 'posted', ?) ON CONFLICT DO NOTHING",
            params: [rt.id(), uid, reward, e.event_id, created],
          });
        }
        await t.batch(stmts);
        results.push(valid ? { event_id: e.event_id, status: reward > 0 ? 'credited' : 'recorded', credited_vnd: reward } : { event_id: e.event_id, status: 'rejected', credited_vnd: 0, reason: reason! });
      }
    };
    await rt.db.tx(run);
    const rejected = results.filter((r) => r.status === 'rejected');
    return c.json({
      accepted: results.length - rejected.length,
      valid: results.filter((r) => r.status === 'credited' || r.status === 'recorded').length,
      credited_vnd: results.reduce((s, r) => s + r.credited_vnd, 0),
      rejected: rejected.map((r) => ({ event_id: r.event_id, reason: r.reason ?? 'rejected' })),
      results,
    });
  });
}

/** CORS tuy chon cho app WebView (Capacitor) goi gateway. Chi bat khi VIEWER_CORS_ORIGINS co gia tri; xac thuc bang chu ky, khong cookie. */
export function viewerCors(env: Record<string, string | undefined>): ((c: Context, next: () => Promise<void>) => Promise<Response | void>) | null {
  const list = (env['VIEWER_CORS_ORIGINS'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) return null;
  const allowAll = list.includes('*');
  return async (c, next) => {
    const origin = c.req.header('origin');
    const ok = !!origin && (allowAll || list.includes(origin));
    const hdr: Record<string, string> = ok ? { 'access-control-allow-origin': origin!, vary: 'Origin' } : {};
    if (c.req.method === 'OPTIONS') {
      return new Response(null, { status: ok ? 204 : 403, headers: { ...hdr, 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type, x-device-id, x-timestamp, x-nonce, x-signature, if-none-match', 'access-control-max-age': '600' } });
    }
    await next();
    for (const [k, v] of Object.entries(hdr)) c.res.headers.set(k, v);
    if (ok) c.res.headers.set('access-control-expose-headers', 'retry-after, etag, x-manifest-kind');
  };
}
