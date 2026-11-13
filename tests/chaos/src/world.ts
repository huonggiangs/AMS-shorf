// Moi truong kiem thu dung chung (ban sao giua tests/contract va tests/chaos; chi dung API cong khai cua cac goi).
// Gateway + ingest-consumer (chi tieu THAT cua @ams/payments) + vi that tren test runtime. Khong cham vao ma dich vu.
import { createTestRuntime, type Runtime, type TestRuntime } from '@ams/runtime';
import { createGateway, redeemPairingCode, type Gateway, type GatewayOptions } from '@ams/edge-gateway';
import { seedAdFixture, signRequest, generateEd25519KeyPair, type AdFixture } from '@ams/edge-gateway/testing';
import type { Manifest } from '@ams/edge-gateway/protocol';
import { createIngestConsumer, type IngestConsumer } from '@ams/ingest-consumer';
import { applyBalance, createFinanceCore, createSpendFn, reconcileLedger, settleSpendRemainders } from '@ams/payments';
import { uuidv7 } from '@ams/shared';

export const MICRO = 1_000_000;

export interface WorldOpts {
  dialect?: 'sqlite' | 'postgres';
  campaigns?: number;
  creativesPerCampaign?: number;
  /** ngan sach duyet moi chien dich (VND) */
  budgetVnd?: number;
  /** tien nap vao vi (VND); mac dinh = campaigns * budget * 2 */
  walletVnd?: number;
  /** don gia impression (micro-VND); mac dinh 20,5 VND de co phan du micro */
  priceMicro?: number;
  env?: Record<string, string>;
  /** boc runtime cho gateway + consumer + spend (chen loi). Khoi tao du lieu luon dung runtime sach. */
  wrap?: (rt: TestRuntime) => Runtime;
  gateway?: GatewayOptions;
}

export interface World {
  rt: TestRuntime;
  /** runtime ma gateway/consumer thuc su dung (= rt neu khong wrap) */
  frt: Runtime;
  gw: Gateway;
  consumer: IngestConsumer;
  fixture: AdFixture;
  customerId: string;
  campaignIds: string[];
  priceMicro: number;
  budgetVnd: number;
  walletVnd: number;
  close(): Promise<void>;
}

export async function createWorld(o: WorldOpts = {}): Promise<World> {
  const priceMicro = o.priceMicro ?? 20_500_000;
  const rt = await createTestRuntime({
    dialect: o.dialect ?? 'sqlite',
    env: {
      MEDIA_PUBLIC_URL: 'https://media.test',
      HB_MIN_GAP_S: '0',
      REGISTER_LIMIT_PER_HOUR: '1000000',
      EVENTS_LIMIT_PER_MIN: '1000000',
      IMPRESSION_MAX_PER_DEVICE_HOUR: '1000000',
      IMPRESSION_PRICE_MICRO_VND: String(priceMicro),
      ...o.env,
    },
  });
  const nCamp = o.campaigns ?? 1;
  const fixture = await seedAdFixture(rt, { campaigns: nCamp, creativesPerCampaign: o.creativesPerCampaign ?? 1 });
  const budgetVnd = o.budgetVnd ?? 1_000_000;
  const walletVnd = o.walletVnd ?? nCamp * budgetVnd * 2;
  const customerId = fixture.customerId;
  const campaignIds = fixture.campaigns.map((c) => c.id);
  // dua chien dich ve "da duyet, cho nap tien" roi nap vi + giu tien bang API tai chinh that
  await rt.db.run(`UPDATE campaigns SET state = 'awaiting_funds', funding_state = 'awaiting_funds', reserved_vnd = 0, spent_vnd = 0, approved_budget_vnd = ?, budget_cap_vnd = ? WHERE customer_id = ?`, [budgetVnd, budgetVnd, customerId]);
  await applyBalance(rt.db, rt, { customerId, amount: walletVnd, kind: 'topup', refType: 'seed', refId: 'seed' });
  const core = createFinanceCore(rt);
  for (const id of campaignIds) {
    const r = await core.reserveForCampaign(id, budgetVnd);
    if (r.state !== 'active') throw new Error(`khong giu duoc tien cho chien dich: ${JSON.stringify(r)}`);
  }
  const frt = o.wrap ? o.wrap(rt) : rt;
  const gw = createGateway(frt, o.gateway);
  const consumer = createIngestConsumer(frt, { spend: createSpendFn(frt) });
  consumer.subscribe();
  return { rt, frt, gw, consumer, fixture, customerId, campaignIds, priceMicro, budgetVnd, walletVnd, close: () => rt.close() };
}

export type Transport = (path: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<Response>;

/** Thiet bi ao co kiem soat tung byte (khac tools/sim VirtualDevice: khong tu thu lai, de test thay moi phan hoi). */
export class Dev {
  id = '';
  keys!: { publicKey: string; privateKey: string };
  clockOffsetS = 0;
  constructor(public w: World, public transport: Transport = (p, i) => Promise.resolve(w.gw.app.request(p, i))) {}

  static async create(w: World, o: { region?: string; kind?: string; pair?: boolean; transport?: Transport } = {}): Promise<Dev> {
    const d = new Dev(w, o.transport);
    d.keys = await generateEd25519KeyPair();
    const res = await d.register({ region: o.region ?? 'HN', ...(o.kind ? { kind: o.kind } : {}) });
    if (res.status !== 201) throw new Error('register that bai: ' + res.status + ' ' + (await res.text()));
    d.id = ((await res.json()) as { device_id: string }).device_id;
    if (o.pair !== false) await d.pair();
    return d;
  }
  nowS(): number {
    return Math.floor(this.w.rt.clock.now().getTime() / 1000) + this.clockOffsetS;
  }
  async register(extra: Record<string, unknown> = {}, init: { nonce?: string; ts?: number; key?: string } = {}): Promise<Response> {
    const body = JSON.stringify({ pubkey: this.keys.publicKey, kind: 'tv', model: 'ContractTV', os: 'android', app_version: '1.0.0', ...extra });
    const s = await signRequest(init.key ?? this.keys.privateKey, { method: 'POST', path: '/v1/register', body, ts: init.ts ?? this.nowS(), ...(init.nonce ? { nonce: init.nonce } : {}) });
    return this.transport('/v1/register', { method: 'POST', body, headers: s.headers });
  }
  async call(method: 'GET' | 'POST', path: string, payload?: unknown, o: { raw?: string; ts?: number; nonce?: string; key?: string; deviceId?: string | null; headers?: Record<string, string>; signPath?: string } = {}): Promise<Response> {
    const body = o.raw ?? (payload === undefined ? undefined : JSON.stringify(payload));
    const s = await signRequest(o.key ?? this.keys.privateKey, {
      method,
      path: o.signPath ?? path,
      ...(body !== undefined ? { body } : {}),
      ...(o.deviceId === null ? {} : { deviceId: o.deviceId ?? this.id }),
      ts: o.ts ?? this.nowS(),
      ...(o.nonce ? { nonce: o.nonce } : {}),
    });
    return this.transport(path, { method, ...(body !== undefined ? { body } : {}), headers: { ...s.headers, ...(o.headers ?? {}) } });
  }
  async pair(): Promise<void> {
    const r = (await (await this.call('POST', '/v1/pair', {})).json()) as { code: string };
    const uid = this.w.rt.id();
    await this.w.rt.db.run('INSERT INTO end_users (id, created_at) VALUES (?, ?)', [uid, this.w.rt.clock.now().toISOString()]);
    const red = await redeemPairingCode(this.w.rt, r.code, uid);
    if (!red.ok) throw new Error('redeem that bai');
    await this.w.gw.devices.invalidate(this.id);
  }
  async manifest(query = ''): Promise<{ res: Response; json: Manifest | null; text: string }> {
    const res = await this.call('GET', '/v1/manifest' + query);
    const text = await res.text();
    return { res, json: res.status === 200 ? (JSON.parse(text) as Manifest) : null, text };
  }
  async events(events: unknown[], o: { nonce?: string } = {}): Promise<Response> {
    return this.call('POST', '/v1/events', { events }, o);
  }
}

let evSeq = 0;
/** impression hop le theo manifest (chien dich `camp`, creative `cr`); event_id UUIDv7 duy nhat */
export function impression(w: World, o: { camp?: number; cr?: number; vcr?: number; played?: number; ageMs?: number; id?: string } = {}): Record<string, unknown> {
  const c = w.fixture.campaigns[o.camp ?? 0]!;
  const cr = c.creatives[o.cr ?? 0]!;
  const t = w.rt.clock.now().getTime() - (o.ageMs ?? 5000) - (evSeq++ % 997);
  return { type: 'impression', event_id: o.id ?? uuidv7(t), ts: new Date(t).toISOString(), campaign_id: c.id, creative_id: cr.id, slot_id: c.slotId, vcr_pct: o.vcr ?? 100, played_ms: o.played ?? 15000 };
}

/** Cho queue + telemetry xong, roi quyet toan phan du (job dinh ky that cua payments) tren runtime sach. */
export async function settle(w: World): Promise<void> {
  await w.rt.queue.drain();
  await w.gw.flush();
}
export async function settleMoney(w: World): Promise<void> {
  await settle(w);
  await settleSpendRemainders(w.rt);
}

export const num = (x: unknown): number => (x === null || x === undefined ? 0 : Number(x));

export interface Snapshot {
  impressionRows: string[];
  hourlyImpressions: number;
  campaigns: { id: string; state: string; funding: string; reserved: number; spent: number; remainder: number }[];
  wallet: { balance: number; reserved: number; spent: number };
  ledgerSpend: number;
}
export async function snapshot(w: World): Promise<Snapshot> {
  const db = w.rt.db;
  const rows = await db.query<{ event_id: string }>('SELECT event_id FROM ev_ad_impression ORDER BY event_id');
  const hourly = num((await db.query<{ s: unknown }>('SELECT COALESCE(SUM(impressions),0) AS s FROM impression_hourly'))[0]!.s);
  const campaigns = (await db.query<Record<string, unknown>>('SELECT id, state, funding_state, reserved_vnd, spent_vnd, spend_remainder_micro FROM campaigns WHERE customer_id = ? ORDER BY id', [w.customerId])).map((c) => ({
    id: String(c['id']), state: String(c['state']), funding: String(c['funding_state']), reserved: num(c['reserved_vnd']), spent: num(c['spent_vnd']), remainder: num(c['spend_remainder_micro']),
  }));
  const wal = (await db.query<Record<string, unknown>>('SELECT balance_vnd, reserved_vnd, spent_vnd FROM ad_wallets WHERE customer_id = ?', [w.customerId]))[0]!;
  const ledgerSpend = num((await db.query<{ s: unknown }>("SELECT COALESCE(SUM(amount_vnd),0) AS s FROM wallet_entries WHERE kind = 'spend' AND customer_id = ?", [w.customerId]))[0]!.s);
  return { impressionRows: rows.map((r) => r.event_id), hourlyImpressions: hourly, campaigns, wallet: { balance: num(wal['balance_vnd']), reserved: num(wal['reserved_vnd']), spent: num(wal['spent_vnd']) }, ledgerSpend };
}

/**
 * BAT BIEN sau khi he thong yen (da settle). `acked` = event_id (hop le, tinh tien) ma thiet bi da nhan 202.
 * Tra ve danh sach vi pham (rong = dung) de test in ra cung seed/tai hien.
 */
export async function violations(w: World, acked: { byCampaign: Map<string, Set<string>>; flagged?: Set<string> }, o: { allowUnderCharge?: boolean } = {}): Promise<string[]> {
  const v: string[] = [];
  const s = await snapshot(w);
  const allAcked = new Set<string>();
  for (const set of acked.byCampaign.values()) for (const id of set) allAcked.add(id);
  // 1. khong mat su kien, khong ghi trung
  const rows = s.impressionRows;
  if (new Set(rows).size !== rows.length) v.push('ev_ad_impression co event_id trung');
  const missing = [...allAcked].filter((id) => !rows.includes(id));
  if (missing.length) v.push(`MAT ${missing.length} su kien da duoc gateway xac nhan 202 (vd ${missing[0]})`);
  const extra = rows.filter((id) => !allAcked.has(id) && !acked.flagged?.has(id));
  if (extra.length) v.push(`${extra.length} su kien co trong DB ma thiet bi khong he gui (phantom)`);
  if (s.hourlyImpressions !== rows.length) v.push(`impression_hourly=${s.hourlyImpressions} != so dong ev_ad_impression=${rows.length}`);
  // 2. vi: so cai == cache; chi tieu chien dich == vi
  const rec = await reconcileLedger(w.rt);
  if (rec.mismatches.length) v.push('reconcileLedger lech: ' + JSON.stringify(rec.mismatches));
  const sumSpent = s.campaigns.reduce((a, c) => a + c.spent, 0);
  if (sumSpent !== s.wallet.spent) v.push(`tong spent_vnd chien dich ${sumSpent} != vi.spent ${s.wallet.spent}`);
  if (s.ledgerSpend !== s.wallet.spent) v.push(`tong so cai spend ${s.ledgerSpend} != vi.spent ${s.wallet.spent}`);
  if (s.wallet.balance !== w.walletVnd - s.wallet.spent) v.push(`so du ${s.wallet.balance} != nap ${w.walletVnd} - da chi ${s.wallet.spent}`);
  if (s.wallet.reserved < 0 || s.wallet.balance < s.wallet.reserved) v.push('vi: reserved am hoac vuot so du');
  // 3. khong tru kep / khong mat tien: spent*1e6 + remainder == ack * gia (tru khi da het ngan sach thi spent <= ngan sach)
  for (const c of s.campaigns) {
    const n = acked.byCampaign.get(c.id)?.size ?? 0;
    const expected = n * w.priceMicro;
    const charged = c.spent * MICRO + c.remainder;
    if (c.spent > w.budgetVnd) v.push(`chien dich ${c.id}: chi ${c.spent} > ngan sach ${w.budgetVnd}`);
    if (c.spent + c.reserved > w.budgetVnd) v.push(`chien dich ${c.id}: spent+reserved ${c.spent + c.reserved} > ngan sach`);
    const exhausted = c.state === 'ended' && c.reserved === 0;
    if (charged > expected) v.push(`TRU KEP chien dich ${c.id}: da tinh ${charged} micro > ${expected} (so su kien ${n})`);
    if (!exhausted && !o.allowUnderCharge && charged < expected) v.push(`MAT TIEN chien dich ${c.id}: da tinh ${charged} micro < ${expected} (so su kien ${n})`);
  }
  return v;
}

export { uuidv7 };
