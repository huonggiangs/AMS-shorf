// DO LUONG (local simulator, KHONG phai production): rows_read/rows_written cua D1 cho moi loai yeu cau + do tre HTTP qua workerd.
import { describe, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCloudflareRuntime } from '@ams/runtime/cloudflare';
import { createGateway } from '@ams/edge-gateway';
import { createIngestConsumer } from '@ams/ingest-consumer';
import { createSpendFn } from '@ams/payments';
import { signRequest, generateEd25519KeyPair } from '@ams/edge-gateway/testing';
import { redeemPairingCode } from '@ams/edge-gateway';
import { CountingD1 } from '../src/counting.js';
import { PERSIST } from '../src/global-setup.js';
import { Dev, SECRETS, getWorld, impression, seedMoney, sleep, waitFor, type World } from '../src/world.js';

const pct = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor((p / 100) * a.length))]!;

async function nodeGateway(w: World) {
  const cd = new CountingD1(await w.mf.getD1Database('DB_CORE', 'ams-edge-gateway-production'));
  const sent: { topic: string; msg: any }[] = [];
  const base = createCloudflareRuntime({
    DB: cd as never,
    KV: await w.mf.getKVNamespace('KV', 'ams-edge-gateway-production'),
    QUEUE: { send: async (b: any) => void sent.push(b) } as never,
    BUCKET: await w.mf.getR2Bucket('MEDIA', 'ams-edge-gateway-production'),
    ...SECRETS, ENVIRONMENT: 'production', HB_MIN_GAP_S: '0', DEVICE_MEM_TTL_S: '0', MANIFEST_MEM_TTL_S: '0', REGISTER_LIMIT_PER_HOUR: '1000000', EVENTS_LIMIT_PER_MIN: '1000000',
  } as never);
  const gw = createGateway(base);
  const consumer = createIngestConsumer(base, { spend: createSpendFn(base) });
  return { cd, sent, gw, consumer, base };
}

describe('do luong local simulator', () => {
  it('rows_written/rows_read moi yeu cau + do tre', async () => {
    const w = await getWorld();
    const out: Record<string, unknown> = { note: 'local simulator (workerd/miniflare), KHONG phai so production' };
    const m = await seedMoney(w);
    const { cd, sent, gw, consumer } = await nodeGateway(w);
    const keys = await generateEd25519KeyPair();
    const call = async (method: string, path: string, payload: unknown, id?: string) => {
      const body = payload === undefined ? undefined : JSON.stringify(payload);
      const s = await signRequest(keys.privateKey, { method, path, ...(body ? { body } : {}), ...(id ? { deviceId: id } : {}), ts: Math.floor(Date.now() / 1000) });
      return gw.app.request(path, { method, ...(body ? { body } : {}), headers: s.headers });
    };
    cd.reset();
    const reg = await call('POST', '/v1/register', { pubkey: keys.publicKey, kind: 'tv', model: 'm', os: 'android', app_version: '1', region: 'HN' });
    const id = ((await reg.json()) as any).device_id as string;
    out['register'] = { rows_written: cd.rowsWritten, rows_read: cd.rowsRead, statements: cd.statements };
    const pr = ((await (await call('POST', '/v1/pair', {}, id)).json()) as any).code;
    const uid = w.rt.id();
    await w.rt.db.run('INSERT INTO end_users (id, created_at) VALUES (?, ?)', [uid, new Date().toISOString()]);
    await redeemPairingCode(w.rt, pr, uid);
    await call('GET', '/v1/manifest', undefined, id);
    for (const [name, n] of [['heartbeat', 0]] as const) {
      await call('POST', '/v1/heartbeat', { state: 1 }, id); // khoi dong cache
      cd.reset();
      await call('POST', '/v1/heartbeat', { state: 1 }, id);
      out[name] = { rows_written: cd.rowsWritten, rows_read: cd.rowsRead, statements: cd.statements, n };
    }
    cd.reset();
    await call('GET', '/v1/manifest', undefined, id);
    out['manifest_cached'] = { rows_written: cd.rowsWritten, rows_read: cd.rowsRead, statements: cd.statements };
    // su kien: gateway (cap + dedupe) roi consumer (spend + ghi su kien); moi cum dung su kien MOI
    for (const n of [1, 10, 40]) {
      const evs = Array.from({ length: n }, () => impression(m));
      cd.reset();
      const r = await call('POST', '/v1/events', { events: evs }, id);
      const gwStat = { rows_written: cd.rowsWritten, rows_read: cd.rowsRead, statements: cd.statements, status: r.status };
      const msgs = sent.splice(0).filter((x) => x.topic === 'ingest.events');
      cd.reset();
      for (const x of msgs) await consumer.handle(x.msg);
      const cStat = { rows_written: cd.rowsWritten, rows_read: cd.rowsRead, statements: cd.statements };
      cd.reset();
      for (const x of msgs) await consumer.handle(x.msg); // giao lai: duong khu trung
      const rStat = { rows_written: cd.rowsWritten, rows_read: cd.rowsRead, statements: cd.statements };
      out[`events_${n}`] = { gateway: gwStat, consumer_first: cStat, consumer_redelivery: rStat, per_event_rows_written_total: (gwStat.rows_written + cStat.rows_written) / n };
    }
    // do tre HTTP qua workerd (gom ca ky Ed25519 phia client khong tinh)
    const d = await Dev.create(w);
    await d.call('GET', '/v1/manifest');
    const lat = async (name: string, f: () => Promise<Response>, n = 30) => {
      const t: number[] = [];
      for (let i = 0; i < n; i++) { const t0 = performance.now(); const r = await f(); await r.arrayBuffer(); t.push(performance.now() - t0); }
      out[`latency_${name}`] = { n, p50_ms: +pct(t, 50).toFixed(1), p95_ms: +pct(t, 95).toFixed(1), max_ms: +Math.max(...t).toFixed(1) };
    };
    await lat('heartbeat', () => d.call('POST', '/v1/heartbeat', { state: 1 }));
    await lat('manifest', () => d.call('GET', '/v1/manifest'));
    await lat('events_1', () => d.events([impression(m)]));
    await lat('events_40', () => d.events(Array.from({ length: 40 }, () => impression(m))), 15);
    writeFileSync(join(PERSIST, 'metrics.json'), JSON.stringify(out, null, 2));
    console.log('METRICS ' + JSON.stringify(out));
  });
});
