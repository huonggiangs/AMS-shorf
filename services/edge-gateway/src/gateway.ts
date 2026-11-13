import { Hono } from 'hono';
import { ZodError } from 'zod';
import type { Runtime } from '@ams/runtime';
import { randomBytes, shardOf, toBase64Url } from '@ams/shared';
import { KvNonceStore, authenticateDevice, readEnvelope, verifyEnvelope, type AuthDeps, type NonceStore } from './auth.js';
import { DeviceDirectory, type DeviceRec } from './devices.js';
import { DEFAULT_POLICY, INGEST_TOPIC, processEvents, type EventPolicy } from './events.js';
import { CtlCache, DEFAULT_INTERVALS, RpsLoad, computeInterval, retryAfter, type IntervalCfg, type LoadFn } from './load.js';
import { ManifestService, groupOfDevice, groupString, parseGroup } from './manifest.js';
import { issuePairingCode } from './pairing.js';
import { ttlForConfig } from './heartbeat-ttl.js';
import { KvPresence, type Presence } from './presence.js';
import { ackCommands, hasCommandFlag, type Delivered, sweepCommands, takeDeliverable } from './commands.js';
import { MAX_ACK_BODY_BYTES, MAX_BODY_BYTES, MAX_HEARTBEAT_BODY_BYTES, PAIR_CODE_TTL_S, PROTOCOL_VERSION, commandAckBody, heartbeatBody, registerBody } from './protocol.js';
import { HttpProblem, clientIp, defaultRng, defer, envInt, nowSec, problem, type Rng } from './util.js';
import { redeemPairingCode } from './pairing.js';

export { redeemPairingCode, issuePairingCode } from './pairing.js';
export { enqueueCommand, ackCommands, sweepCommands, listCommands, CommandError } from './commands.js';
export type { DeviceCommand, EnqueueOptions, CommandStatus } from './commands.js';
export { INGEST_TOPIC } from './events.js';
export type { ImpressionRow, IngestMessage } from './events.js';

export interface GatewayOptions {
  rng?: Rng;
  /** do tai 0..n; mac dinh dem request cua instance so voi GW_CAPACITY_RPS */
  load?: LoadFn;
  nonces?: NonceStore;
  presence?: Presence;
  intervals?: Partial<IntervalCfg>;
  policy?: Partial<EventPolicy>;
}

export interface Gateway {
  app: Hono;
  /** Xa bo dem telemetry heartbeat + last_seen xuong event store/DB (cron moi phut, hoac cuoi test). */
  flush(): Promise<void>;
  /** Quet lenh thiet bi (het han, giao qua nhieu lan, dung co hieu). Goi moi phut (cron Cloudflare / timer Node). */
  sweep(): Promise<{ expired: number; failed: number; reflagged: number }>;
  manifests: ManifestService;
  devices: DeviceDirectory;
}

interface HbRow {
  ts: string;
  device_id: string;
  shard: number;
  region: string | null;
  app_ver: string | null;
  soc_temp: number | null;
  rssi: number | null;
  dl_mbps: number | null;
  cache_used_mb: number | null;
  cache_slots: number | null;
  state: number;
}

/**
 * Cong suat MAC DINH cua MOT instance gateway (req/s), chi dung de keo gian chu ky (tu 70%) va 503 (tu 100%).
 * Do that (docs/LOAD-TEST-REPORT.md): 2 vCPU chia se, Node + consumer chung tien trinh, ~500 req/s giu p99 < 400 ms, ~1.000 req/s la diem gay.
 * 700 = 70% diem gay: giam tai bat dau o ~490 req/s (muc da do p99 < 400 ms), shed o 700. Production PHAI dat GW_CAPACITY_RPS theo
 * do tai tren phan cung that (~1.300-1.600 req/s/loi Node x 60% x so loi), khong dua vao mac dinh nay.
 */
export const DEFAULT_GW_CAPACITY_RPS = 700;

export function createGateway(rt: Runtime, opts: GatewayOptions = {}): Gateway {
  const env = rt.config.env;
  const rng = opts.rng ?? defaultRng;
  const intervals: IntervalCfg = {
    playingS: envInt(env, 'HB_PLAYING_S', DEFAULT_INTERVALS.playingS),
    idleS: envInt(env, 'HB_IDLE_S', DEFAULT_INTERVALS.idleS),
    errorS: envInt(env, 'HB_ERROR_S', DEFAULT_INTERVALS.errorS),
    monitoredS: envInt(env, 'HB_MONITORED_S', DEFAULT_INTERVALS.monitoredS),
    ...opts.intervals,
  };
  // TTL khoa theo thiet bi dan xuat tu chu ky toi da that (heartbeat-ttl.ts): song sot qua it nhat mot heartbeat bi tre
  const stateTtlS = ttlForConfig(intervals);
  const devices = new DeviceDirectory(rt, envInt(env, 'DEVICE_MEM_TTL_S', 30) * 1000, envInt(env, 'DEVICE_KV_TTL_S', stateTtlS));
  const presence = opts.presence ?? new KvPresence(rt.kv, envInt(env, 'PRESENCE_TTL_S', stateTtlS));
  const nonces = opts.nonces ?? new KvNonceStore(rt.kv);
  const deps: AuthDeps = { rt, devices, nonces };
  // PUBLIC_MEDIA_BASE_URL: dia chi TV tai duoc (Caddy phuc vu renditions/* tu volume khi OBJECT_STORE=fs); MEDIA_PUBLIC_URL giu lam ten cu.
  const mediaBase = env['PUBLIC_MEDIA_BASE_URL'] ?? env['MEDIA_PUBLIC_URL'] ?? (env['S3_PUBLIC_ENDPOINT'] && env['S3_BUCKET'] ? `${env['S3_PUBLIC_ENDPOINT']}/${env['S3_BUCKET']}` : 'https://media.ams.invalid');
  const manifestTtl = envInt(env, 'MANIFEST_TTL_S', 900);
  const manifests = new ManifestService(rt, { mediaBaseUrl: mediaBase, ttlS: manifestTtl, buildTtlS: envInt(env, 'MANIFEST_BUILD_TTL_S', 60), memTtlS: envInt(env, 'MANIFEST_MEM_TTL_S', 15) });
  const rps = new RpsLoad(rt, envInt(env, 'GW_CAPACITY_RPS', DEFAULT_GW_CAPACITY_RPS));
  const loadFn: LoadFn = opts.load ?? rps.factor;
  const ctl = new CtlCache(rt);
  const policy: EventPolicy = {
    ...DEFAULT_POLICY,
    minVcrPct: envInt(env, 'IMPRESSION_MIN_VCR', DEFAULT_POLICY.minVcrPct),
    maxPerDeviceHour: envInt(env, 'IMPRESSION_MAX_PER_DEVICE_HOUR', DEFAULT_POLICY.maxPerDeviceHour),
    priceMicroVnd: envInt(env, 'IMPRESSION_PRICE_MICRO_VND', DEFAULT_POLICY.priceMicroVnd),
    rewardPointToVnd: envInt(env, 'REWARD_POINT_VND', DEFAULT_POLICY.rewardPointToVnd),
    ...opts.policy,
  };
  const shedAt = envInt(env, 'GW_SHED_AT', 1);
  const minGapS = envInt(env, 'HB_MIN_GAP_S', 5);
  const regLimit = envInt(env, 'REGISTER_LIMIT_PER_HOUR', 20);
  const evLimit = envInt(env, 'EVENTS_LIMIT_PER_MIN', 30);
  const sampleEvery = Math.max(1, envInt(env, 'TELEMETRY_SAMPLE_EVERY', 1)); // 1 = ghi moi heartbeat; 5 = 1/5 (de xuat #7)
  const flushSize = envInt(env, 'TELEMETRY_FLUSH_SIZE', 200);
  const publicManifest = env['MANIFEST_PUBLIC'] !== '0';
  const cmdRedeliverS = envInt(env, 'CMD_REDELIVER_S', 120);

  // ----- bo dem telemetry: gop lo, khong qua Queue tung heartbeat -----
  let hbRows: HbRow[] = [];
  let seenDirty = new Map<string, { ts: string; appVer: string | null }>();
  let hbCounter = 0;
  async function flush(): Promise<void> {
    const rows = hbRows;
    const dirty = seenDirty;
    hbRows = [];
    seenDirty = new Map();
    if (rows.length > 0) await rt.events.append('heartbeat', rows as unknown as Record<string, unknown>[]);
    if (dirty.size > 0) {
      const stmts = [...dirty].map(([id, v]) => ({
        sql: `UPDATE devices SET last_seen_at = ?, status = CASE WHEN status IN ('checking','offline') THEN 'active' ELSE status END, app_version = COALESCE(?, app_version) WHERE id = ?`,
        params: [v.ts, v.appVer, id],
      }));
      for (let i = 0; i < stmts.length; i += 100) await rt.db.batch(stmts.slice(i, i + 100));
    }
  }

  // R1-13: ngoai local/test tu choi bi mat mac dinh va khong mount /v1/dev/*
  const amsEnv = resolveAmsEnvLocal(env);
  const isLocalEnv = (e: string) => e === 'local' || e === 'test';
  if (!isLocalEnv(amsEnv)) {
    for (const k of ['FIELD_ENC_KEY', 'SEPAY_WEBHOOK_SECRET', 'GATEWAY_SECRET']) {
      const v = env[k];
      if (v && /^change[-_]?me/i.test(v)) throw new Error(`[gateway] ${k} la gia tri mac dinh (change-me*) khi AMS_ENV=${amsEnv}: dat bi mat that.`);
    }
  }

  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof HttpProblem) return problem(c, err.code, err.message, err.details, err.headers);
    if (err instanceof ZodError) return problem(c, 'validation_failed', 'Du lieu khong hop le.', err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    if (err instanceof SyntaxError) return problem(c, 'bad_request', 'Than yeu cau khong phai JSON hop le.');
    console.error('[gateway] loi noi bo:', err instanceof Error ? err.message : err);
    return problem(c, 'internal', 'Loi may chu.');
  });

  app.use('*', async (c, next) => {
    rps.hit();
    await next();
  });

  app.get('/health', (c) => c.json({ ok: true, service: 'edge-gateway', runtime: rt.config.runtime, time: rt.clock.now().toISOString() }));

  /** Doc than yeu cau theo luong, dung ngay khi vuot `max` (khong dem vao bo nho toan bo, ke ca khi khong co content-length). */
  async function readBody(c: import('hono').Context, max: number): Promise<Uint8Array> {
    const tooBig = () => new HttpProblem('payload_too_large', `Than yeu cau qua ${max} byte.`);
    const cl = c.req.header('content-length');
    if (cl !== undefined && (!/^\d+$/.test(cl) || Number(cl) > max)) throw tooBig();
    const stream = c.req.raw.body;
    if (!stream) return new Uint8Array(0);
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => undefined);
        throw tooBig();
      }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const ch of chunks) {
      out.set(ch, off);
      off += ch.byteLength;
    }
    return out;
  }
  const parseJson = <T>(b: Uint8Array): unknown => JSON.parse(new TextDecoder().decode(b)) as T;

  /** Giam tai TRUOC khi ton CPU chu ky: tra 503 + Retry-After co jitter. */
  async function shedCheck(kind: 'hb' | 'manifest' | 'events'): Promise<void> {
    const cfg = await ctl.get();
    const f = loadFn();
    const shed = kind === 'events' ? cfg.shed_events === true || f >= shedAt * 2 : cfg.shed === true || f >= shedAt;
    if (shed) {
      const base = computeInterval(0, false, f, cfg, intervals, () => 0.5).base;
      const ra = retryAfter(Math.min(base, 600), rng);
      throw new HttpProblem('overloaded', 'May chu dang qua tai, thu lai sau.', { retry_after: ra }, { 'retry-after': String(ra) });
    }
  }

  async function rateLimit(key: string, limit: number, windowSec: number, what: string): Promise<void> {
    const bucket = Math.floor(nowSec(rt.clock.now()) / windowSec);
    const n = await rt.kv.incr(`rl:${key}:${bucket}`, windowSec);
    if (n > limit) {
      const ra = retryAfter(windowSec - (nowSec(rt.clock.now()) % windowSec) + 1, rng);
      throw new HttpProblem('rate_limited', `Qua gioi han ${what}.`, { retry_after: ra }, { 'retry-after': String(ra) });
    }
  }

  // ---------------------------------------------------------------- register
  app.post('/v1/register', async (c) => {
    const body = await readBody(c, 2048);
    await rateLimit(`reg:${clientIp(c)}`, regLimit, 3600, 'dang ky theo IP');
    const input = registerBody.parse(parseJson(body));
    const env0 = readEnvelope(c);
    // bang chung so huu khoa: ky chinh yeu cau dang ky bang khoa rieng tuong ung
    await verifyEnvelope(c, deps, env0, body, input.pubkey, `reg:${input.pubkey.slice(0, 16)}`);
    const nowIso = rt.clock.now().toISOString();
    let row = (await rt.db.query<{ id: string; trust_level: number; blocked: number }>('SELECT id, trust_level, blocked FROM devices WHERE pubkey_ed25519 = ?', [input.pubkey]))[0];
    let created = false;
    if (!row) {
      const id = rt.id();
      try {
        await rt.db.run(
          `INSERT INTO devices (id, kind, model, os, app_version, region_id, pubkey_ed25519, trust_level, status, blocked, shard, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'checking', 0, ?, ?)`,
          [id, input.kind, input.model ?? null, input.os ?? null, input.app_version ?? null, input.region ?? null, input.pubkey, shardOf(id), nowIso],
        );
        created = true;
        row = { id, trust_level: 0, blocked: 0 };
      } catch {
        row = (await rt.db.query<{ id: string; trust_level: number; blocked: number }>('SELECT id, trust_level, blocked FROM devices WHERE pubkey_ed25519 = ?', [input.pubkey]))[0];
        if (!row) throw new Error('khong tao duoc thiet bi');
      }
    }
    if (Number(row.blocked) === 1) throw new HttpProblem('device_blocked', 'Thiet bi bi khoa.');
    const attNonce = toBase64Url(randomBytes(16));
    await rt.db.run('INSERT INTO device_attestations (device_id, nonce, result, checked_at) VALUES (?, ?, NULL, NULL)', [row.id, attNonce]);
    return c.json(
      {
        device_id: row.id,
        trust_level: Number(row.trust_level),
        attestation_nonce: attNonce,
        server_time: rt.clock.now().toISOString(),
        protocol: PROTOCOL_VERSION,
        heartbeat_interval: intervals.idleS,
        created,
      },
      created ? 201 : 200,
    );
  });

  // -------------------------------------------------------------------- pair
  app.post('/v1/pair', async (c) => {
    const body = await readBody(c, 1024);
    const dev = await authenticateDevice(c, deps, body);
    const st = (await rt.db.query<{ user_id: string | null; trust_level: number }>('SELECT user_id, trust_level FROM devices WHERE id = ?', [dev.id]))[0];
    if (st?.user_id) {
      if (dev.userId !== st.user_id || dev.trust !== Number(st.trust_level)) await devices.invalidate(dev.id);
      return c.json({ paired: true, trust_level: Number(st.trust_level) });
    }
    const existing = await rt.db.query<{ code: string }>('SELECT code FROM pairing_codes WHERE device_id = ? AND used_at IS NULL AND expires_at > ?', [dev.id, rt.clock.now().toISOString()]);
    if (existing.length === 0) await rateLimit(`pair:${dev.id}`, 6, 3600, 'xin ma ghep doi');
    const issued = await issuePairingCode(rt, dev.id);
    return c.json({ paired: false, code: issued.code, expires_at: issued.expiresAt, expires_in: Math.max(0, Math.round((Date.parse(issued.expiresAt) - rt.clock.now().getTime()) / 1000)), ttl_s: PAIR_CODE_TTL_S });
  });

  // --------------------------------------------------------------- heartbeat
  app.post('/v1/heartbeat', async (c) => {
    await shedCheck('hb');
    const body = await readBody(c, MAX_HEARTBEAT_BODY_BYTES);
    const dev = await authenticateDevice(c, deps, body);
    const hb = heartbeatBody.parse(body.length ? parseJson(body) : {});
    const now = rt.clock.now();
    const nowS = nowSec(now);
    const { prevTs } = await presence.touch(dev.id, { ts: nowS, state: hb.state, region: dev.region });
    if (prevTs !== null && nowS - prevTs < minGapS) {
      const ra = retryAfter(minGapS, rng);
      throw new HttpProblem('rate_limited', 'Heartbeat qua day.', { retry_after: ra }, { 'retry-after': String(ra) });
    }
    const cfg = await ctl.get();
    const monitored = cfg.monitored?.includes(dev.id) ?? false;
    const { base, next } = computeInterval(hb.state, monitored, loadFn(), cfg, intervals, rng);
    const group = groupOfDevice(dev);
    const view = await manifests.get(group);
    const gs = groupString(group);

    if (++hbCounter % sampleEvery === 0 || hb.state === 2) {
      hbRows.push({
        ts: now.toISOString(), device_id: dev.id, shard: shardOf(dev.id), region: dev.region, app_ver: hb.app_ver ?? null, soc_temp: hb.soc_temp ?? null, rssi: hb.rssi ?? null,
        dl_mbps: hb.dl_mbps ?? null, cache_used_mb: hb.cache_used_mb ?? null, cache_slots: hb.cache_slots ?? null, state: hb.state,
      });
    }
    if (prevTs === null || nowS - prevTs > 600) seenDirty.set(dev.id, { ts: now.toISOString(), appVer: hb.app_ver ?? null });
    if (hbRows.length >= flushSize) defer(c, flush());

    // lenh thiet bi (bang device_commands): ack cu (cmd_ack trong heartbeat) -> acked; giao pending/delivered-qua-han, danh dau delivered
    let commands: Delivered[] = [];
    if (hb.cmd_ack?.length) await ackCommands(rt, dev.id, hb.cmd_ack.map((id) => ({ id })));
    if (hb.cmd_ack?.length || (await hasCommandFlag(rt, dev.id))) commands = await takeDeliverable(rt, dev.id, cmdRedeliverS);
    return c.json({
      ok: true,
      server_time: now.toISOString(),
      next_interval: next,
      interval_base: base,
      manifest_etag: view.etag,
      manifest_group: gs,
      manifest_url: `/v1/manifest/g/${encodeURIComponent(gs)}`,
      commands,
      ...(cfg.min_app_version ? { min_app_version: cfg.min_app_version } : {}),
    });
  });

  // ------------------------------------------------------------ command ack
  app.post('/v1/commands/ack', async (c) => {
    const body = await readBody(c, MAX_ACK_BODY_BYTES);
    const dev = await authenticateDevice(c, deps, body);
    const parsed = commandAckBody.parse(parseJson(body));
    const r = await ackCommands(rt, dev.id, parsed.acks);
    return c.json({ ok: true, acked: r.acked, known: r.known, unknown: r.unknown });
  });

  // ---------------------------------------------------------------- manifest
  function cacheHeaders(etag: string, pub: boolean): Record<string, string> {
    return {
      etag: `"${etag}"`,
      'cache-control': pub ? `public, max-age=60, s-maxage=${manifestTtl}, stale-while-revalidate=60` : 'private, no-cache',
      vary: 'if-none-match',
    };
  }
  function clientEtag(c: import('hono').Context): string | null {
    const q = c.req.query('etag');
    if (q) return q;
    const inm = c.req.header('if-none-match');
    return inm ? inm.replace(/^W\//, '').replace(/"/g, '') : null;
  }
  async function serveManifest(c: import('hono').Context, g: ReturnType<typeof groupOfDevice>, pub: boolean): Promise<Response> {
    const view = await manifests.get(g);
    const have = clientEtag(c);
    const headers = cacheHeaders(view.etag, pub);
    if (have && have === view.etag) return new Response(null, { status: 304, headers });
    if (have && c.req.query('delta') === '1') {
      const d = await manifests.delta(g, have, view);
      if (d) return new Response(JSON.stringify(d), { status: 200, headers: { ...headers, 'content-type': 'application/json; charset=utf-8', 'x-manifest-kind': 'delta' } });
    }
    return new Response(view.json, { status: 200, headers: { ...headers, 'content-type': 'application/json; charset=utf-8', 'x-manifest-kind': 'full' } });
  }

  app.get('/v1/manifest', async (c) => {
    await shedCheck('manifest');
    const dev = await authenticateDevice(c, deps, new Uint8Array());
    const dp = c.req.query('daypart');
    return serveManifest(c, groupOfDevice(dev, dp && /^[a-z_]{1,16}$/.test(dp) ? dp : 'all'), false);
  });

  // Duong cong khai co the cache o CDN: khong xac thuc, noi dung khong bi mat (URL media cong khai + sha256).
  app.get('/v1/manifest/g/:group', async (c) => {
    if (!publicManifest) throw new HttpProblem('not_found', 'Khong co.');
    await shedCheck('manifest');
    let raw: string;
    try {
      raw = decodeURIComponent(c.req.param('group'));
    } catch {
      throw new HttpProblem('not_found', 'Nhom manifest khong ton tai.');
    }
    const g = parseGroup(raw);
    if (!g || !(await manifests.known(g))) throw new HttpProblem('not_found', 'Nhom manifest khong ton tai.');
    return serveManifest(c, g, true);
  });

  // ------------------------------------------------------------------ events
  app.post('/v1/events', async (c) => {
    await shedCheck('events');
    const body = await readBody(c, MAX_BODY_BYTES);
    const dev = await authenticateDevice(c, deps, body);
    await rateLimit(`ev:${dev.id}`, evLimit, 60, 'lo su kien theo thiet bi');
    const parsed = parseJson<{ events?: unknown }>(body) as { events?: unknown };
    if (!Array.isArray(parsed?.events) || parsed.events.length < 1) throw new HttpProblem('validation_failed', 'Can mang events (1..50 su kien).');
    if (parsed.events.length > 50) throw new HttpProblem('validation_failed', 'Toi da 50 su kien moi lo.', { max: 50, got: parsed.events.length });
    const view = await manifests.get(groupOfDevice(dev));
    const { result, msg } = await processEvents(rt, dev, parsed.events, view, policy);
    if (msg) await rt.queue.send(INGEST_TOPIC, msg);
    return c.json(result, 202);
  });

  // ---- chi de thu/gia lap: xac nhan ma ghep doi khong can ung dung (KHONG mount tren Cloudflare/production)
  if (env['GATEWAY_DEV_ENDPOINTS'] === '1' && rt.config.runtime !== 'cloudflare' && isLocalEnv(amsEnv)) {
    app.post('/v1/dev/pair-confirm', async (c) => {
      const { code } = (await c.req.json()) as { code: string };
      const uid = rt.id();
      await rt.db.run('INSERT INTO end_users (id, phone_hash, email_enc, display_name, created_at) VALUES (?, NULL, NULL, ?, ?)', [uid, 'dev-sim', rt.clock.now().toISOString()]);
      const r = await redeemPairingCode(rt, String(code), uid);
      if (r.ok) devices.invalidate(r.deviceId).catch(() => undefined);
      return c.json(r, r.ok ? 200 : 404);
    });
  }

  app.notFound((c) => problem(c, 'not_found', 'Khong tim thay duong dan.'));
  return { app, flush, sweep: () => sweepCommands(rt), manifests, devices };
}

export type { DeviceRec };

/** Cung quy tac voi packages/db seed-guard resolveAmsEnv (khong import de khong keo goi db vao Worker). */
function resolveAmsEnvLocal(env: Record<string, string | undefined>): string {
  const al: Record<string, string> = { local: 'local', dev: 'local', development: 'local', test: 'test', staging: 'staging', stg: 'staging', production: 'production', prod: 'production' };
  const raw = (env['AMS_ENV'] ?? '').trim().toLowerCase();
  if (raw) return al[raw] ?? 'production'; // gia tri la => coi nhu production (an toan truoc)
  const rtn = (env['RUNTIME'] ?? '').trim().toLowerCase();
  if (rtn === 'cloudflare' || rtn === 'k8s') return 'production';
  return rtn === 'test' ? 'test' : 'local';
}
