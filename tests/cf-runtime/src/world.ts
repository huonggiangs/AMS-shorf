/* eslint-disable @typescript-eslint/no-explicit-any */
// Moi truong chay THAT tren workerd (Miniflare): bundle Worker api + edge-gateway tu `wrangler deploy --dry-run`, cau hinh binding/DO/queue
// lay tu wrangler.generated.toml (production) qua unstable_getMiniflareWorkerOptions, D1 da ap migration 0001-0015.
// Phia Node dung CloudflareRuntime tren CHINH cac binding do (cung D1/KV/R2) de gieo du lieu va doi chieu.
import { Miniflare, type WorkerOptions } from 'miniflare';
import { unstable_getMiniflareWorkerOptions } from 'wrangler';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCloudflareRuntime, type CloudflareRuntime } from '@ams/runtime/cloudflare';
import { generateEd25519KeyPair, seedAdFixture, signRequest, type AdFixture } from '@ams/edge-gateway/testing';
import { applyBalance, createFinanceCore, reconcileLedger, settleSpendRemainders } from '@ams/payments';
import { uuidv7 } from '@ams/shared';
import { redeemPairingCode } from '@ams/edge-gateway';
import { PERSIST, ROOT } from './global-setup.js';

export const GW_HOST = 'https://gw-ams.anio.vn';
export const API_HOST = 'https://ams.anio.vn';
export const PRICE_MICRO = 20_500_000; // 20,5 VND/impression: co phan du micro de thu quyet toan
export const MICRO = 1_000_000;
const GW_NAME = 'ams-edge-gateway-production';
const API_NAME = 'ams-api-production';

export const SECRETS = {
  SESSION_SECRET: 'a'.repeat(64),
  FIELD_ENC_KEY: Buffer.alloc(32, 7).toString('base64'),
  SEPAY_WEBHOOK_SECRET: 'sepay-test-secret',
  VIEWER_OTP_SECRET: 'otp-test-secret-0123456789',
};

export interface World {
  mf: Miniflare;
  rt: CloudflareRuntime; // phia Node, tren cung D1/KV/R2/Queue binding
  gw(path: string, init?: RequestInit): Promise<Response>;
  api(path: string, init?: RequestInit): Promise<Response>;
  gwOpts: WorkerOptions;
  apiScheduled(cron: string): Promise<void>;
  gwScheduled(cron: string): Promise<void>;
  apiOpts: WorkerOptions;
  close(): Promise<void>;
}

function opts(toml: string, script: string, name: string, extra: Record<string, unknown>): WorkerOptions {
  const { workerOptions } = unstable_getMiniflareWorkerOptions(join(ROOT, toml), 'production');
  const o = workerOptions as unknown as Record<string, unknown>;
  const bindings = { ...(o['bindings'] as Record<string, unknown>), ...SECRETS, ...extra };
  return { ...o, name, modules: true, script: readFileSync(join(ROOT, script), 'utf8'), bindings, cronTriggers: undefined } as unknown as WorkerOptions;
}

let cached: Promise<World> | null = null;
export function getWorld(): Promise<World> {
  return (cached ??= create());
}

async function create(): Promise<World> {
  const common = { DEVICE_MEM_TTL_S: '0', MANIFEST_MEM_TTL_S: '0', IMPRESSION_PRICE_MICRO_VND: String(PRICE_MICRO), HB_MIN_GAP_S: '0', REGISTER_LIMIT_PER_HOUR: '1000000', EVENTS_LIMIT_PER_MIN: '1000000', VIEWER_WITHDRAW_ENABLED: '1' };
  const gwOpts = opts('infra/cloudflare/edge-gateway/wrangler.generated.toml', '.wrangler/dry/edge-gateway/worker.js', GW_NAME, common);
  const apiOpts = opts('infra/cloudflare/api/wrangler.generated.toml', '.wrangler/dry/api/worker.js', API_NAME, { ...common, R2_ACCOUNT_ID: 'acc0123456789', R2_ACCESS_KEY_ID: 'AKIDTEST', R2_SECRET_ACCESS_KEY: 'secrettest' });
  const mf = new Miniflare({
    workers: [gwOpts, apiOpts],
    d1Persist: join(PERSIST, 'v3/d1'),
    kvPersist: join(PERSIST, 'v3/kv'),
    r2Persist: join(PERSIST, 'v3/r2'),
    durableObjectsPersist: join(PERSIST, 'v3/do'),
    cachePersist: false,
    log: undefined,
  } as never);
  await mf.ready;
  const gwW = await mf.getWorker(GW_NAME);
  const apiW = await mf.getWorker(API_NAME);
  const env = {
    DB: await mf.getD1Database('DB_CORE', GW_NAME),
    KV: await mf.getKVNamespace('KV', GW_NAME),
    QUEUE: await mf.getQueueProducer('INGEST_QUEUE', GW_NAME),
    BUCKET: await mf.getR2Bucket('MEDIA', GW_NAME),
    ...SECRETS,
    ...common,
  };
  const rt = createCloudflareRuntime(env as never);
  return {
    mf, rt, gwOpts, apiOpts,
    gw: (p, init) => gwW.fetch(GW_HOST + p, init as never) as unknown as Promise<Response>,
    api: (p, init) => apiW.fetch(API_HOST + p, init as never) as unknown as Promise<Response>,
    apiScheduled: async (cron) => void (await (apiW as any).scheduled({ cron })),
    gwScheduled: async (cron) => void (await (gwW as any).scheduled({ cron })),
    close: () => mf.dispose(),
  };
}

export type Keys = { publicKey: string; privateKey: string };

/** Thiet bi ao: ky Ed25519 that, goi qua HTTP vao Worker gateway chay tren workerd. */
export class Dev {
  id = '';
  keys!: Keys;
  constructor(public w: World) {}
  static async create(w: World, o: { region?: string; kind?: string; pair?: boolean } = {}): Promise<Dev> {
    const d = new Dev(w);
    d.keys = await generateEd25519KeyPair();
    const res = await d.register({ region: o.region ?? 'HN', ...(o.kind ? { kind: o.kind } : {}) });
    if (res.status !== 201) throw new Error('register that bai: ' + res.status + ' ' + (await res.text()));
    d.id = ((await res.json()) as { device_id: string }).device_id;
    if (o.pair !== false) await d.pairViaUser();
    return d;
  }
  nowS(): number {
    return Math.floor(Date.now() / 1000);
  }
  async register(extra: Record<string, unknown> = {}): Promise<Response> {
    const body = JSON.stringify({ pubkey: this.keys.publicKey, kind: 'tv', model: 'CfTV', os: 'android', app_version: '1.0.0', ...extra });
    const s = await signRequest(this.keys.privateKey, { method: 'POST', path: '/v1/register', body, ts: this.nowS() });
    return this.w.gw('/v1/register', { method: 'POST', body, headers: s.headers });
  }
  async call(method: 'GET' | 'POST', path: string, payload?: unknown, o: { nonce?: string } = {}): Promise<Response> {
    const body = payload === undefined ? undefined : JSON.stringify(payload);
    const s = await signRequest(this.keys.privateKey, { method, path, ...(body !== undefined ? { body } : {}), deviceId: this.id, ts: this.nowS(), ...(o.nonce ? { nonce: o.nonce } : {}) });
    return this.w.gw(path, { method, ...(body !== undefined ? { body } : {}), headers: s.headers });
  }
  /** Ghep doi nhu app: lay ma 6 so tu thiet bi, redeem phia Node (gia lap API cong khach hang) tren cung D1. */
  async pairViaUser(): Promise<string> {
    const r = (await (await this.call('POST', '/v1/pair', {})).json()) as { code: string };
    const uid = this.w.rt.id();
    await this.w.rt.db.run('INSERT INTO end_users (id, created_at) VALUES (?, ?)', [uid, new Date().toISOString()]);
    const red = await redeemPairingCode(this.w.rt, r.code, uid);
    if (!red.ok) throw new Error('redeem that bai');
    return uid;
  }
  events(events: unknown[]): Promise<Response> {
    return this.call('POST', '/v1/events', { events });
  }
}

// ---------------------------------------------------------------- tien + chien dich

export interface Money {
  fixture: AdFixture;
  customerId: string;
  campaignIds: string[];
  budgetVnd: number;
  walletVnd: number;
}
/** Gieo khach + chien dich + vi that (nap + giu tien bang API tai chinh that) tren D1 da migrate. */
export async function seedMoney(w: World, o: { campaigns?: number; budgetVnd?: number; walletVnd?: number; rewardModel?: 'cover' | 'performance' } = {}): Promise<Money> {
  const rt = w.rt;
  const n = o.campaigns ?? 1;
  const fixture = await seedAdFixture(rt, { campaigns: n, creativesPerCampaign: 1, ...(o.rewardModel ? { rewardModel: o.rewardModel } : {}) });
  const budgetVnd = o.budgetVnd ?? 1_000_000;
  const walletVnd = o.walletVnd ?? n * budgetVnd * 2;
  const customerId = fixture.customerId;
  const campaignIds = fixture.campaigns.map((c) => c.id);
  await rt.db.run(`UPDATE campaigns SET state = 'awaiting_funds', funding_state = 'awaiting_funds', reserved_vnd = 0, spent_vnd = 0, approved_budget_vnd = ?, budget_cap_vnd = ? WHERE customer_id = ?`, [budgetVnd, budgetVnd, customerId]);
  await applyBalance(rt.db, rt, { customerId, amount: walletVnd, kind: 'topup', refType: 'seed', refId: customerId });
  for (const id of campaignIds) {
    for (const dp of ['peak', 'off_peak']) {
      await rt.db.run(
        `INSERT INTO campaign_prices (campaign_id, screen_type, region_id, daypart, unit_price_micro_vnd, floor_micro_vnd, list_price_micro_vnd, model, cpm_micro_vnd, source, source_ref, floored, resolved_by, resolved_at)
         VALUES (?, 'tv', '*', ?, ?, 0, NULL, 'per_impression', NULL, 'rate_card', NULL, 0, NULL, ?)`,
        [id, dp, PRICE_MICRO, new Date().toISOString()],
      );
    }
  }
  await rt.kv.incr('manifest:epoch');
  const core = createFinanceCore(rt);
  for (const id of campaignIds) {
    const r = await core.reserveForCampaign(id, budgetVnd);
    if (r.state !== 'active') throw new Error('khong giu duoc tien: ' + JSON.stringify(r));
  }
  return { fixture, customerId, campaignIds, budgetVnd, walletVnd };
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
export const num = (x: unknown): number => (x === null || x === undefined ? 0 : Number(x));

/** Cho den khi dieu kien dung (queue/consumer chay bat dong bo tren workerd). */
export async function waitFor<T>(fn: () => Promise<T | false | null | undefined>, what: string, timeoutMs = 60_000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error('het gio cho: ' + what);
    await sleep(150);
  }
}

export async function countImpressions(w: World, campaignIds?: string[]): Promise<number> {
  const where = campaignIds?.length ? `WHERE campaign_id IN (${campaignIds.map(() => '?').join(',')})` : '';
  return num((await w.rt.db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM ev_ad_impression ${where}`, campaignIds ?? []))[0]!.n);
}

/** Cho consumer (queue that cua workerd) ghi du `n` impression cua cac chien dich, roi quyet toan phan du micro. */
export async function settle(w: World, m: Money, n: number): Promise<void> {
  await waitFor(async () => (await countImpressions(w, m.campaignIds)) >= n, `consumer ghi ${n} impression`);
  await sleep(300); // cho cac lo con lai (khong duoc ghi them: kiem tra trung)
  await settleSpendRemainders(w.rt);
}

export interface Snap {
  rows: string[];
  hourly: number;
  campaigns: { id: string; state: string; reserved: number; spent: number; remainder: number }[];
  wallet: { balance: number; reserved: number; spent: number };
  ledgerSpend: number;
}
export async function snapshot(w: World, m: Money): Promise<Snap> {
  const db = w.rt.db;
  const ph = m.campaignIds.map(() => '?').join(',');
  const rows = await db.query<{ event_id: string }>(`SELECT event_id FROM ev_ad_impression WHERE campaign_id IN (${ph}) AND valid = 1 ORDER BY event_id`, m.campaignIds);
  const hourly = num((await db.query<{ s: unknown }>(`SELECT COALESCE(SUM(valid),0) AS s FROM impression_hourly WHERE campaign_id IN (${ph})`, m.campaignIds))[0]!.s);
  const campaigns = (await db.query<Record<string, unknown>>('SELECT id, state, reserved_vnd, spent_vnd, spend_remainder_micro FROM campaigns WHERE customer_id = ? ORDER BY id', [m.customerId])).map((c) => ({
    id: String(c['id']), state: String(c['state']), reserved: num(c['reserved_vnd']), spent: num(c['spent_vnd']), remainder: num(c['spend_remainder_micro']),
  }));
  const wal = (await db.query<Record<string, unknown>>('SELECT balance_vnd, reserved_vnd, spent_vnd FROM ad_wallets WHERE customer_id = ?', [m.customerId]))[0]!;
  const ledgerSpend = num((await db.query<{ s: unknown }>("SELECT COALESCE(SUM(amount_vnd),0) AS s FROM wallet_entries WHERE kind = 'spend' AND customer_id = ?", [m.customerId]))[0]!.s);
  return { rows: rows.map((r) => r.event_id), hourly, campaigns, wallet: { balance: num(wal['balance_vnd']), reserved: num(wal['reserved_vnd']), spent: num(wal['spent_vnd']) }, ledgerSpend };
}

/** Bat bien tien: khong tru kep, khong mat tien, so cai == cache vi, spent chien dich == vi. `acked` = event_id hop le da nhan 202. */
export async function moneyViolations(w: World, m: Money, acked: Map<string, Set<string>>): Promise<string[]> {
  const v: string[] = [];
  const s = await snapshot(w, m);
  const all = new Set<string>();
  for (const set of acked.values()) for (const id of set) all.add(id);
  if (new Set(s.rows).size !== s.rows.length) v.push('ev_ad_impression co event_id trung');
  const missing = [...all].filter((id) => !s.rows.includes(id));
  if (missing.length) v.push(`MAT ${missing.length} su kien da nhan 202`);
  if (s.rows.length !== all.size) v.push(`so dong hop le ${s.rows.length} != so event_id hop le da ack ${all.size}`);
  if (s.hourly !== s.rows.length) v.push(`impression_hourly ${s.hourly} != ${s.rows.length}`);
  const rec = await reconcileLedger(w.rt);
  if (rec.mismatches.length) v.push('reconcileLedger lech: ' + JSON.stringify(rec.mismatches));
  const sumSpent = s.campaigns.reduce((a, c) => a + c.spent, 0);
  if (sumSpent !== s.wallet.spent) v.push(`tong spent chien dich ${sumSpent} != vi.spent ${s.wallet.spent}`);
  if (s.ledgerSpend !== s.wallet.spent) v.push(`so cai spend ${s.ledgerSpend} != vi.spent ${s.wallet.spent}`);
  if (s.wallet.balance !== m.walletVnd - s.wallet.spent) v.push(`so du ${s.wallet.balance} != nap ${m.walletVnd} - chi ${s.wallet.spent}`);
  for (const c of s.campaigns) {
    const n = acked.get(c.id)?.size ?? 0;
    const charged = c.spent * MICRO + c.remainder;
    if (charged > n * PRICE_MICRO) v.push(`TRU KEP ${c.id}: ${charged} > ${n * PRICE_MICRO}`);
    if (charged < n * PRICE_MICRO) v.push(`MAT TIEN ${c.id}: ${charged} < ${n * PRICE_MICRO}`);
  }
  return v;
}

let seq = 0;
/** impression hop le theo manifest */
export function impression(m: Money, o: { camp?: number; id?: string; ageMs?: number } = {}): Record<string, unknown> {
  const c = m.fixture.campaigns[o.camp ?? 0]!;
  const t = Date.now() - (o.ageMs ?? 5000) - (seq++ % 997);
  return { type: 'impression', event_id: o.id ?? uuidv7(t), ts: new Date(t).toISOString(), campaign_id: c.id, creative_id: c.creatives[0]!.id, slot_id: c.slotId, vcr_pct: 100, played_ms: 15000 };
}
