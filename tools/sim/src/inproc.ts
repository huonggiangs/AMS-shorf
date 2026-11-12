import { createTestRuntime, type TestRuntime } from '@ams/runtime';
import { createIngestConsumer, type IngestConsumer, type SpendRequest } from '@ams/ingest-consumer';
import { createGateway, redeemPairingCode, type Gateway, type GatewayOptions } from '@ams/edge-gateway';
import { seedAdFixture, type AdFixture, type FixtureOpts } from '@ams/edge-gateway/testing';
import { inProcessTransport, type Transport } from './transport.js';

export interface InProcessEnv {
  rt: TestRuntime;
  gw: Gateway;
  consumer: IngestConsumer;
  fixture: AdFixture;
  spends: SpendRequest[];
  transport: Transport;
  confirmPairing(code: string): Promise<boolean>;
  /** cho queue chay het va xa bo dem telemetry (de doi chieu so lieu sau khi chay) */
  settle(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Gateway + consumer + CSDL TRONG BO NHO trong cung tien trinh, goi thang app.request (khong mang).
 * HB_MIN_GAP_S=0 vi sim khong ngu that giua cac heartbeat.
 */
export async function createInProcessEnv(o: { dialect?: 'sqlite' | 'postgres'; fixture?: FixtureOpts; gateway?: GatewayOptions; env?: Record<string, string> } = {}): Promise<InProcessEnv> {
  const rt = await createTestRuntime({ dialect: o.dialect ?? 'sqlite', env: { HB_MIN_GAP_S: '0', MEDIA_PUBLIC_URL: 'https://media.sim.test', REGISTER_LIMIT_PER_HOUR: '1000000', EVENTS_LIMIT_PER_MIN: '1000000', ...o.env } });
  const fixture = await seedAdFixture(rt, { campaigns: 3, creativesPerCampaign: 2, ...o.fixture });
  const gw = createGateway(rt, o.gateway);
  const spends: SpendRequest[] = [];
  const consumer = createIngestConsumer(rt, { spend: async (r) => void spends.push(r) });
  consumer.subscribe();
  return {
    rt,
    gw,
    consumer,
    fixture,
    spends,
    transport: inProcessTransport(gw.app),
    async confirmPairing(code) {
      const uid = rt.id();
      await rt.db.run('INSERT INTO end_users (id, created_at) VALUES (?, ?)', [uid, rt.clock.now().toISOString()]);
      const r = await redeemPairingCode(rt, code, uid);
      if (r.ok) await gw.devices.invalidate(r.deviceId);
      return r.ok;
    },
    async settle() {
      await rt.queue.drain();
      await gw.flush();
    },
    close: () => rt.close(),
  };
}
