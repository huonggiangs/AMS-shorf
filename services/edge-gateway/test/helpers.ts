import { createTestRuntime, type TestRuntime } from '@ams/runtime';
import { createIngestConsumer, type IngestConsumer, type SpendRequest } from '@ams/ingest-consumer';
import { uuidv7 } from '@ams/shared';
import { createGateway, redeemPairingCode, type Gateway, type GatewayOptions } from '../src/gateway.js';
import { generateEd25519KeyPair, seedAdFixture, signRequest, type AdFixture, type FixtureOpts } from '../src/testing.js';

export interface Harness {
  rt: TestRuntime;
  gw: Gateway;
  consumer: IngestConsumer;
  spends: SpendRequest[];
  fixture: AdFixture;
  close(): Promise<void>;
}

export async function harness(o: { dialect?: 'sqlite' | 'postgres'; env?: Record<string, string>; gw?: GatewayOptions; fixture?: FixtureOpts } = {}): Promise<Harness> {
  const rt = await createTestRuntime({ dialect: o.dialect ?? 'sqlite', env: { MEDIA_PUBLIC_URL: 'https://media.test', ...o.env } });
  const fixture = await seedAdFixture(rt, o.fixture);
  const gw = createGateway(rt, o.gw);
  const spends: SpendRequest[] = [];
  const consumer = createIngestConsumer(rt, {
    spend: async (r) => {
      spends.push(r);
    },
  });
  consumer.subscribe();
  return { rt, gw, consumer, spends, fixture, close: () => rt.close() };
}

export class TestDevice {
  id = '';
  trust = 0;
  constructor(
    public h: Harness,
    public keys: { publicKey: string; privateKey: string },
  ) {}
  static async create(h: Harness, reg: Record<string, unknown> = {}): Promise<TestDevice> {
    const d = new TestDevice(h, await generateEd25519KeyPair());
    const res = await d.registerRaw(reg);
    if (res.status !== 201) throw new Error('register that bai ' + res.status + ' ' + (await res.text()));
    d.id = ((await res.json()) as { device_id: string }).device_id;
    return d;
  }
  now(): number {
    return Math.floor(this.h.rt.clock.now().getTime() / 1000);
  }
  async registerRaw(reg: Record<string, unknown> = {}, headers: Record<string, string> = {}, init: { ts?: number; nonce?: string; key?: string } = {}): Promise<Response> {
    const body = JSON.stringify({ pubkey: this.keys.publicKey, kind: 'tv', model: 'TestTV', os: 'android', app_version: '1.0.0', region: 'HN', ...reg });
    const s = await signRequest(init.key ?? this.keys.privateKey, { method: 'POST', path: '/v1/register', body, ts: init.ts ?? this.now(), ...(init.nonce ? { nonce: init.nonce } : {}) });
    return this.h.gw.app.request('/v1/register', { method: 'POST', body, headers: { ...s.headers, ...headers } });
  }
  async call(method: 'GET' | 'POST', path: string, payload?: unknown, o: { ts?: number; nonce?: string; key?: string; deviceId?: string; headers?: Record<string, string> } = {}): Promise<Response> {
    const body = payload === undefined ? undefined : JSON.stringify(payload);
    const s = await signRequest(o.key ?? this.keys.privateKey, { method, path, ...(body !== undefined ? { body } : {}), deviceId: o.deviceId ?? this.id, ts: o.ts ?? this.now(), ...(o.nonce ? { nonce: o.nonce } : {}) });
    return this.h.gw.app.request(path, { method, ...(body !== undefined ? { body } : {}), headers: { ...s.headers, ...(o.headers ?? {}) } });
  }
  /** ghep doi qua ma 6 so + redeem (thay cho ung dung dien thoai) */
  async pair(): Promise<void> {
    const r = (await (await this.call('POST', '/v1/pair', {})).json()) as { code: string };
    const uid = this.h.rt.id();
    await this.h.rt.db.run('INSERT INTO end_users (id, created_at) VALUES (?, ?)', [uid, this.h.rt.clock.now().toISOString()]);
    const red = await redeemPairingCode(this.h.rt, r.code, uid);
    if (!red.ok) throw new Error('redeem that bai');
    await this.h.gw.devices.invalidate(this.id);
    this.trust = 1;
  }
}

export function impression(h: Harness, o: { camp?: number; vcr?: number; played?: number; tsOffsetMs?: number; creative?: number } = {}): Record<string, unknown> {
  const c = h.fixture.campaigns[o.camp ?? 0]!;
  const cr = c.creatives[o.creative ?? 0]!;
  const t = h.rt.clock.now().getTime() + (o.tsOffsetMs ?? -5000);
  return { type: 'impression', event_id: uuidv7(t), ts: new Date(t).toISOString(), campaign_id: c.id, creative_id: cr.id, slot_id: c.slotId, vcr_pct: o.vcr ?? 100, played_ms: o.played ?? 15000 };
}
