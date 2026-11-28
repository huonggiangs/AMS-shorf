import { Hono } from 'hono';
import { ZodError } from 'zod';
import { bumpOpsCounter, kvIncrMany, type Runtime } from '@ams/runtime';
import { PLACEHOLDER_PRICE_MICRO_VND, explicitEnvPrice, placeholderAllowed, randomBytes, shardOf, toBase64Url, safeErr, hmacSha256Hex, timingSafeEqualStr } from '@ams/shared';
import { KvNonceStore, authenticateDevice, readEnvelope, verifyEnvelope, type AuthDeps, type NonceStore } from './auth.js';
import { DeviceDirectory, type DeviceRec } from './devices.js';
import { DEFAULT_POLICY, INGEST_TOPIC, processEvents, type EventPolicy } from './events.js';
import { extractEvents } from './events-compat.js';
import { isItemImpressionRaw, processItemImpressions } from './item-events.js';
import { recordEventStats, sweepEventStats } from './event-stats.js';
import { CtlCache, DEFAULT_INTERVALS, RpsLoad, computeInterval, retryAfter, type IntervalCfg, type LoadFn } from './load.js';
import { ManifestService, groupOfDevice, groupString, parseGroup } from './manifest.js';
import { issuePairingCode } from './pairing.js';
import { ttlForConfig } from './heartbeat-ttl.js';
import { KvPresence, type Presence } from './presence.js';
import { ackCommands, hasCommandFlag, type Delivered, sweepCommands, takeDeliverable } from './commands.js';
import { MAX_ACK_BODY_BYTES, MAX_EVENTS_BODY_BYTES, MAX_HEARTBEAT_BODY_BYTES, MAX_LOGS_BODY_BYTES, PAIR_CODE_TTL_S, PROTOCOL_VERSION, commandAckBody, heartbeatBody, logsBody, registerBody } from './protocol.js';
import { sweepDeviceLogs } from './logs.js';
import { HttpProblem, clientIp, defaultRng, defer, envInt, nowSec, problem, type Rng } from './util.js';
import { redeemPairingCode } from './pairing.js';
import { CampaignRewardCfg, mountViewerRoutes, postViewRewards, viewerCors, viewerPolicyFromEnv, type ViewerOptions } from './viewer.js';

export { redeemPairingCode, issuePairingCode } from './pairing.js';
export { enqueueCommand, ackCommands, sweepCommands, listCommands, CommandError } from './commands.js';
export type { DeviceCommand, EnqueueOptions, CommandStatus } from './commands.js';
export { INGEST_TOPIC } from './events.js';
export type { ImpressionRow, IngestMessage } from './events.js';
export { CampaignRewardCfg, viewerPolicyFromEnv, vnDayStartIso, type OtpSender, type ViewerOptions, type ViewerPolicy } from './viewer.js';

export interface GatewayOptions {
  rng?: Rng;
  /** do tai 0..n; mac dinh dem request cua instance so voi GW_CAPACITY_RPS */
  load?: LoadFn;
  nonces?: NonceStore;
  presence?: Presence;
  intervals?: Partial<IntervalCfg>;
  policy?: Partial<EventPolicy>;
  /** phia nguoi xem (WP-18): cong gui OTP, ghi de chinh sach */
  viewer?: ViewerOptions;
}

export interface Gateway {
  app: Hono;
  /** Xa bo dem telemetry heartbeat + last_seen xuong event store/DB (cron moi phut, hoac cuoi test). */
  flush(): Promise<void>;
  /** Quet lenh thiet bi (het han, giao qua nhieu lan, dung co hieu). Goi moi phut (cron Cloudflare / timer Node). */
  sweep(): Promise<{ expired: number; failed: number; reflagged: number; logs_deleted: number }>;
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
  const mediaBase = env['PUBLIC_MEDIA_BASE_URL'] ?? env['MEDIA_PUBLIC_URL'] ?? (env['S3_PUBLIC_ENDPOINT'] && env['S3_BUCKET'] ? `${env['S3_PUBLIC_ENDPOINT']}/${env['S3_BUCKET']}` : env['PUBLIC_GATEWAY_URL'] ? `${env['PUBLIC_GATEWAY_URL'].replace(/\/+$/, '')}/media` : 'https://media.ams.invalid');
  // Khong cau hinh URL media rieng (Cloudflare R2 chi co binding): gateway tu phuc vu tep qua GET /media/* (xem duoi), nen URL trong manifest dung duoc.
  const manifestTtl = envInt(env, 'MANIFEST_TTL_S', 900);
  const manifests = new ManifestService(rt, { mediaBaseUrl: mediaBase, ttlS: manifestTtl, buildTtlS: envInt(env, 'MANIFEST_BUILD_TTL_S', 60), memTtlS: envInt(env, 'MANIFEST_MEM_TTL_S', 15) });
  const rps = new RpsLoad(rt, envInt(env, 'GW_CAPACITY_RPS', DEFAULT_GW_CAPACITY_RPS));
  const loadFn: LoadFn = opts.load ?? rps.factor;
  const ctl = new CtlCache(rt);
  const policy: EventPolicy = {
    ...DEFAULT_POLICY,
    minVcrPct: envInt(env, 'IMPRESSION_MIN_VCR', DEFAULT_POLICY.minVcrPct),
    maxPerDeviceHour: envInt(env, 'IMPRESSION_MAX_PER_DEVICE_HOUR', DEFAULT_POLICY.maxPerDeviceHour),
    // gia du phong cho chien dich chua co gia chot: CHI local/test (bien moi truong neu dat, nguoc lai 20 d); production = 0 (no_price). Gia that: campaign_prices.
    priceMicroVnd: placeholderAllowed(env) ? (explicitEnvPrice(env) ?? PLACEHOLDER_PRICE_MICRO_VND) : DEFAULT_POLICY.priceMicroVnd,
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
  const pairedHbS = Math.max(0, envInt(env, 'HB_PAIRED_S', 0)) === 0 ? 0 : Math.max(30, envInt(env, 'HB_PAIRED_S', 0));

  // ----- bo dem telemetry: gop lo, khong qua Queue tung heartbeat -----
  let hbRows: HbRow[] = [];
  let seenDirty = new Map<string, { ts: string; appVer: string | null }>();
  let hbCounter = 0;
  // Signage Player: nguon dang phat / dung luong cache (telemetry, ghi theo lo khi doi hoac moi 30 phut) -> device_profiles
  const PROFILE_REFRESH_S = 1800;
  let profDirty = new Map<string, { source: string | null; cacheMb: number | null; ts: string }>();
  const profSeen = new Map<string, { source: string | null; appVer: string | null; at: number }>();
  const PROFILE_UPSERT = `INSERT INTO device_profiles (device_id, px_w, px_h, orientation, source, cache_mb, reported_at) VALUES (?,?,?,?,?,?,?)
       ON CONFLICT (device_id) DO UPDATE SET px_w = COALESCE(excluded.px_w, device_profiles.px_w), px_h = COALESCE(excluded.px_h, device_profiles.px_h),
         orientation = COALESCE(excluded.orientation, device_profiles.orientation), source = COALESCE(excluded.source, device_profiles.source),
         cache_mb = COALESCE(excluded.cache_mb, device_profiles.cache_mb), reported_at = excluded.reported_at`;
  // am luong thiet bi bao cao (heartbeat.volume): ghi khi doi gia tri hoac moi 30 phut; upsert vi TV co the chua co dong device_profiles
  let volDirty = new Map<string, { volume: number; ts: string }>();
  const volSeen = new Map<string, { v: number; at: number }>();
  const VOLUME_UPSERT = `INSERT INTO device_profiles (device_id, volume, volume_at) VALUES (?,?,?)
       ON CONFLICT (device_id) DO UPDATE SET volume = excluded.volume, volume_at = excluded.volume_at`;
  // tinh nang app bao cao (caps): ghi ngay khi doi (hiem), nho ban da ghi de khong ghi lai moi heartbeat
  const capsSeen = new Map<string, string>();
  const CAPS_UPSERT = `INSERT INTO device_profiles (device_id, caps) VALUES (?,?) ON CONFLICT (device_id) DO UPDATE SET caps = excluded.caps`;
  async function saveCaps(deviceId: string, caps: string[]): Promise<void> {
    const json = JSON.stringify([...new Set(caps)].sort());
    if (capsSeen.get(deviceId) === json) return;
    await rt.db.run(CAPS_UPSERT, [deviceId, json]);
    if (capsSeen.size >= 100_000) capsSeen.clear();
    capsSeen.set(deviceId, json);
  }
  async function flush(): Promise<void> {
    const vols = volDirty;
    volDirty = new Map();
    if (vols.size > 0) {
      const stmts = [...vols].map(([id, v]) => ({ sql: VOLUME_UPSERT, params: [id, v.volume, v.ts] }));
      for (let i = 0; i < stmts.length; i += 100) await rt.db.batch(stmts.slice(i, i + 100)).catch((e) => console.error('[gateway] ghi am luong loi:', safeErr(e)));
    }
    const rows = hbRows;
    const dirty = seenDirty;
    const prof = profDirty;
    hbRows = [];
    seenDirty = new Map();
    profDirty = new Map();
    if (prof.size > 0) {
      const stmts = [...prof].map(([id, v]) => ({ sql: PROFILE_UPSERT, params: [id, null, null, null, v.source, v.cacheMb, v.ts] }));
      for (let i = 0; i < stmts.length; i += 100) await rt.db.batch(stmts.slice(i, i + 100)).catch((e) => console.error('[gateway] ghi device_profiles loi:', safeErr(e)));
    }
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

  const viewerPolicy = { ...viewerPolicyFromEnv(env, isLocalEnv(amsEnv)), ...opts.viewer?.policy };
  const rewardCfg = new CampaignRewardCfg(rt, envInt(env, 'CAMPAIGN_REWARD_TTL_S', 30) * 1000);
  const app = new Hono();
  const cors = viewerCors(env);
  if (cors) app.use('/v1/*', cors);

  app.onError((err, c) => {
    if (err instanceof HttpProblem) return problem(c, err.code, err.message, err.details, err.headers);
    if (err instanceof ZodError) return problem(c, 'validation_failed', 'Du lieu khong hop le.', err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    if (err instanceof SyntaxError) return problem(c, 'bad_request', 'Than yeu cau khong phai JSON hop le.');
    void bumpOpsCounter(rt, 'gateway_5xx'); // p3-ops: kiem tra canh bao gateway:5xx
    console.error('[gateway] loi noi bo:', safeErr(err));
    return problem(c, 'internal', 'Loi may chu.');
  });

  const trustProxy = env['TRUST_PROXY'] !== '0';
  app.use('*', async (c, next) => {
    (c as unknown as { set(k: string, v: unknown): void }).set('trustProxy', trustProxy);
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
    if ((input.px_w === undefined) !== (input.px_h === undefined)) throw new HttpProblem('validation_failed', 'px_w va px_h phai di cung nhau.', [{ path: input.px_w === undefined ? 'px_w' : 'px_h', message: 'Thieu truong di kem.' }]);
    const env0 = readEnvelope(c);
    // bang chung so huu khoa: ky chinh yeu cau dang ky bang khoa rieng tuong ung
    await verifyEnvelope(c, deps, env0, body, input.pubkey, `reg:${input.pubkey.slice(0, 16)}`);
    const nowIso = rt.clock.now().toISOString();
    const region = input.region ? input.region : null;
    // Idempotent THEO KHOA CONG KHAI: cung pubkey luon nhan lai cung device_id (uq_devices_pubkey + SELECT truoc + bat dua INSERT), khong tao thiet bi thu hai.
    let row = (await rt.db.query<{ id: string; trust_level: number; blocked: number; region_id: string | null }>('SELECT id, trust_level, blocked, region_id FROM devices WHERE pubkey_ed25519 = ?', [input.pubkey]))[0];
    let created = false;
    if (!row) {
      const id = rt.id();
      try {
        await rt.db.run(
          `INSERT INTO devices (id, kind, model, os, app_version, region_id, pubkey_ed25519, trust_level, status, blocked, shard, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'checking', 0, ?, ?)`,
          [id, input.kind, input.model ?? null, input.os ?? null, input.app_version ?? null, region, input.pubkey, shardOf(id), nowIso],
        );
        created = true;
        row = { id, trust_level: 0, blocked: 0, region_id: region };
      } catch {
        row = (await rt.db.query<{ id: string; trust_level: number; blocked: number; region_id: string | null }>('SELECT id, trust_level, blocked, region_id FROM devices WHERE pubkey_ed25519 = ?', [input.pubkey]))[0];
        if (!row) throw new Error('khong tao duoc thiet bi');
      }
    }
    if (Number(row.blocked) === 1) throw new HttpProblem('device_blocked', 'Thiet bi bi khoa.');
    // Signage Player: luu do phan giai/huong tu khai; dang ky lai (cung khoa) cap nhat thong tin app (khong doi trust/kind)
    if (input.px_w !== undefined || input.orientation !== undefined) {
      await rt.db.run(PROFILE_UPSERT, [row.id, input.px_w ?? null, input.px_h ?? null, input.orientation ?? null, null, null, nowIso]);
    }
    if (input.caps) await saveCaps(row.id, input.caps).catch((e) => console.error('[gateway] ghi caps loi:', safeErr(e)));
    if (!created) {
      const hasScreen = region ? (await rt.db.query('SELECT 1 AS x FROM screens WHERE device_id = ? LIMIT 1', [row.id])).length > 0 : true;
      await rt.db.run('UPDATE devices SET model = COALESCE(?, model), os = COALESCE(?, os), app_version = COALESCE(?, app_version), region_id = ? WHERE id = ?', [
        input.model ?? null, input.os ?? null, input.app_version ?? null, region && !hasScreen ? region : row.region_id, row.id,
      ]);
      await devices.invalidate(row.id);
    }
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
    let dev = await authenticateDevice(c, deps, body);
    const hb = heartbeatBody.parse(body.length ? parseJson(body) : {});
    if ((hb.px_w === undefined) !== (hb.px_h === undefined)) throw new HttpProblem('validation_failed', 'px_w va px_h phai di cung nhau.', [{ path: hb.px_w === undefined ? 'px_w' : 'px_h', message: 'Thieu truong di kem.' }]);
    const appVer = hb.app_ver ?? hb.app_version ?? null;
    const cacheMb = hb.cache_used_mb ?? hb.cache_mb ?? null;
    const now = rt.clock.now();
    const nowS = nowSec(now);
    const { prevTs } = await presence.touch(dev.id, { ts: nowS, state: hb.state, region: dev.region });
    if (prevTs !== null && nowS - prevTs < minGapS) {
      const ra = retryAfter(minGapS, rng);
      throw new HttpProblem('rate_limited', 'Heartbeat qua day.', { retry_after: ra }, { 'retry-after': String(ra) });
    }
    // Signage Player: do phan giai/huong/vung thay doi => ghi NGAY (anh huong nhom manifest) roi nap lai ban ghi thiet bi.
    // Chi thang may/LED (TV khong doi nhom theo do phan giai); man hinh da gan thi vung va do phan giai do van hanh quyet dinh, bo qua tu khai.
    if (dev.screenType !== 'tv' || dev.kind === 'elevator' || dev.kind === 'led_p5') {
      const pxChanged = hb.px_w !== undefined && (hb.px_w !== (dev.profPxW ?? null) || hb.px_h !== (dev.profPxH ?? null));
      const oriChanged = hb.orientation !== undefined && hb.orientation !== (dev.profOrientation ?? null);
      const regionChanged = !!hb.region && !dev.screenId && hb.region !== dev.region;
      if ((pxChanged || oriChanged || regionChanged) && (await rt.kv.incr(`profchg:${dev.id}:${Math.floor(nowS / 60)}`, 120).catch(() => 1)) <= 3) {
        const stmts = [{ sql: PROFILE_UPSERT, params: [dev.id, hb.px_w ?? null, hb.px_h ?? null, hb.orientation ?? null, hb.source ?? null, cacheMb, now.toISOString()] }];
        if (regionChanged) stmts.push({ sql: 'UPDATE devices SET region_id = ? WHERE id = ?', params: [hb.region!, dev.id] });
        await rt.db.batch(stmts);
        await devices.invalidate(dev.id);
        dev = (await devices.get(dev.id)) ?? dev;
      }
    }
    const cfg = await ctl.get();
    const monitored = cfg.monitored?.includes(dev.id) ?? false;
    // w-dev: HB_PAIRED_S (tuy chon, mac dinh TAT) rut ngan chu ky co so cua thiet bi DA GHEP (trust >= 1) de lenh tu web toi nhanh hon.
    // Van la polling (khong realtime); tai cao van keo gian theo computeInterval. Toi thieu 30 giay de khong tao tai.
    const pairedCap = Number(dev.trust) >= 1 && pairedHbS > 0 ? pairedHbS : 0;
    const eff: IntervalCfg = pairedCap ? { playingS: Math.min(intervals.playingS, pairedCap), idleS: Math.min(intervals.idleS, pairedCap), errorS: Math.min(intervals.errorS, pairedCap), monitoredS: intervals.monitoredS } : intervals;
    const { base, next } = computeInterval(hb.state, monitored, loadFn(), cfg, eff, rng);
    const group = await manifests.groupFor(dev);
    const view = await manifests.get(group);
    const gs = groupString(group);

    if (++hbCounter % sampleEvery === 0 || hb.state === 2) {
      hbRows.push({
        ts: now.toISOString(), device_id: dev.id, shard: shardOf(dev.id), region: dev.region, app_ver: appVer, soc_temp: hb.soc_temp ?? null, rssi: hb.rssi ?? null,
        dl_mbps: hb.dl_mbps ?? null, cache_used_mb: cacheMb, cache_slots: hb.cache_slots ?? null, state: hb.state,
      });
    }
    if (hb.caps) await saveCaps(dev.id, hb.caps).catch((e) => console.error('[gateway] ghi caps loi:', safeErr(e)));
    // nhip ke tiep that (khong suy tu last_seen_at vi last_seen chi ghi moi >10 phut): web hien "thiet bi nhan lenh luc ~HH:MM"
    await rt.kv.set(`hbnext:${dev.id}`, `${now.getTime()}:${now.getTime() + next * 1000}`, Math.ceil(next * 3 + 120)).catch(() => undefined);
    if (hb.volume !== undefined) {
      const vs = volSeen.get(dev.id);
      if (!vs || vs.v !== hb.volume || nowS - vs.at >= PROFILE_REFRESH_S) {
        volDirty.set(dev.id, { volume: hb.volume, ts: now.toISOString() });
        if (volSeen.size >= 100_000) volSeen.clear();
        volSeen.set(dev.id, { v: hb.volume, at: nowS });
      }
    }
    const ps = profSeen.get(dev.id);
    const appVerChanged = appVer !== null && (!ps || ps.appVer !== appVer);
    if (prevTs === null || nowS - prevTs > 600 || appVerChanged) seenDirty.set(dev.id, { ts: now.toISOString(), appVer });
    if (hb.source !== undefined || cacheMb !== null) {
      const srcChanged = hb.source !== undefined && (!ps || ps.source !== hb.source);
      if (!ps || srcChanged || nowS - ps.at >= PROFILE_REFRESH_S) {
        profDirty.set(dev.id, { source: hb.source ?? ps?.source ?? null, cacheMb, ts: now.toISOString() });
        if (profSeen.size >= 100_000) profSeen.clear();
        profSeen.set(dev.id, { source: hb.source ?? ps?.source ?? null, appVer: appVer ?? ps?.appVer ?? null, at: nowS });
      }
    } else if (appVerChanged) {
      if (profSeen.size >= 100_000) profSeen.clear();
      profSeen.set(dev.id, { source: ps?.source ?? null, appVer, at: ps?.at ?? 0 });
    }
    if (hbRows.length >= flushSize || profDirty.size >= flushSize || volDirty.size >= flushSize) defer(c, flush());

    // lenh thiet bi (bang device_commands): ack cu (cmd_ack trong heartbeat) -> acked; giao pending/delivered-qua-han, danh dau delivered
    let commands: Delivered[] = [];
    if (hb.cmd_ack?.length) await ackCommands(rt, dev.id, hb.cmd_ack.map((id) => ({ id })));
    if (hb.cmd_ack?.length || (await hasCommandFlag(rt, dev.id))) commands = await takeDeliverable(rt, dev.id, cmdRedeliverS);
    // Signage Player (thang may/LED): hotline hien o man hinh logo + thong tin cap nhat app tu xa, cau hinh theo loai man (settings.signage_config)
    const sg = dev.screenType === 'tv' ? null : await manifests.signage(dev.screenType).catch(() => null);
    const minApp = sg?.min_app_version || cfg.min_app_version;
    return c.json({
      ok: true,
      server_time: now.toISOString(),
      next_interval: next,
      interval_base: base,
      manifest_etag: view.etag,
      manifest_group: gs,
      manifest_url: group.device ? '/v1/manifest' : `/v1/manifest/g/${encodeURIComponent(gs)}`,
      commands,
      ...(minApp ? { min_app_version: minApp } : {}),
      ...(sg?.hotline ? { hotline: sg.hotline } : {}),
      ...(sg?.app_update_url && sg.app_update_sha256 ? { app_update_url: sg.app_update_url, app_update_sha256: sg.app_update_sha256 } : {}),
    });
  });

  // -------------------------------------------------------------------- logs
  // Nhat ky thiet bi (Signage Player): <= 8 KB/lan, <= 100 dong, gioi han tan suat theo device_id, giu 7 ngay (sweepDeviceLogs). Ky nhu moi /v1/*.
  const logsLimit = envInt(env, 'LOGS_LIMIT_PER_HOUR', 60);
  const logsRowsPerDay = envInt(env, 'LOGS_ROWS_PER_DAY', 5000);
  app.post('/v1/logs', async (c) => {
    await shedCheck('events');
    const body = await readBody(c, MAX_LOGS_BODY_BYTES);
    const dev = await authenticateDevice(c, deps, body);
    await rateLimit(`logs:${dev.id}`, logsLimit, 3600, 'nhat ky theo thiet bi');
    const input = logsBody.parse(parseJson(body));
    const nowMs = rt.clock.now().getTime();
    const dayKey = new Date(nowMs).toISOString().slice(0, 10).replace(/\D/g, '');
    const [dayRows] = await kvIncrMany(rt.kv, [{ k: `logrows:${dev.id}:${dayKey}`, by: input.entries.length, ttlSec: 2 * 86400 }]);
    if ((dayRows ?? 0) > logsRowsPerDay) {
      const ra = retryAfter(3600, rng);
      throw new HttpProblem('rate_limited', 'Qua gioi han dong nhat ky moi ngay.', { retry_after: ra }, { 'retry-after': String(ra) });
    }
    const receivedAt = new Date(nowMs).toISOString();
    // `ts` do thiet bi khai: kep vao [7 ngay truoc, +5 phut] de dong cu/tuong lai khong thoat khoi don dep 7 ngay hoac day len dau danh sach
    const lo = nowMs - 7 * 86400_000;
    const hi = nowMs + 5 * 60_000;
    const stmts = input.entries.map((e) => {
      const t = Math.min(hi, Math.max(lo, Date.parse(e.ts)));
      return { sql: 'INSERT INTO device_logs (id, device_id, ts, received_at, level, tag, message) VALUES (?,?,?,?,?,?,?)', params: [rt.id(), dev.id, new Date(t).toISOString(), receivedAt, e.level, e.tag ?? null, e.msg] };
    });
    await rt.db.batch(stmts);
    return c.json({ ok: true, stored: stmts.length });
  });

  // ------------------------------------------------- command long-poll (realtime)
  // GET /v1/commands/wait?timeout=<1..25>: giu ket noi toi da `timeout` giay; tra ngay khi co lenh (kiem co hieu kv moi WAIT_TICK_MS).
  // Tin khan toi thiet bi dang cho trong <~2 giay thay vi cho nhip heartbeat. Chi chi phi: <= 25/WAIT_TICK truy van kv moi lan goi.
  const waitLimit = envInt(env, 'CMD_WAIT_LIMIT_PER_HOUR', 600);
  const waitTickMs = envInt(env, 'CMD_WAIT_TICK_MS', 1500);
  app.get('/v1/commands/wait', async (c) => {
    await shedCheck('hb');
    const dev = await authenticateDevice(c, deps, new Uint8Array());
    await rateLimit(`cw:${dev.id}`, waitLimit, 3600, 'long-poll lenh theo thiet bi');
    const tRaw = Number(c.req.query('timeout') ?? 25);
    const timeoutS = Math.min(25, Math.max(1, Number.isFinite(tRaw) ? Math.floor(tRaw) : 25));
    const deadline = rt.clock.now().getTime() + timeoutS * 1000;
    let commands: Delivered[] = [];
    const maxTicks = Math.ceil((timeoutS * 1000) / waitTickMs) + 1; // phong dong ho gia trong kiem thu
    for (let tick = 0; tick < maxTicks; tick++) {
      if (await hasCommandFlag(rt, dev.id)) {
        commands = await takeDeliverable(rt, dev.id, cmdRedeliverS);
        if (commands.length) break;
      }
      const left = deadline - rt.clock.now().getTime();
      if (left <= 0) break;
      await new Promise((r) => setTimeout(r, Math.min(waitTickMs, left)));
    }
    return c.json({ commands, waited: true });
  });

  // ------------------------------------------------------------ command ack
  app.post('/v1/commands/ack', async (c) => {
    const body = await readBody(c, MAX_ACK_BODY_BYTES);
    const dev = await authenticateDevice(c, deps, body);
    const parsed = commandAckBody.parse(parseJson(body));
    const r = await ackCommands(rt, dev.id, parsed.acks);
    // set_volume duoc ack kem {applied_percent, mode}: ghi am luong THAT vao ho so ngay (khong cho heartbeat ke tiep) de web hien dung
    try {
      const withResult = parsed.acks.filter((a) => a.status !== 'failed' && a.result);
      for (const a of withResult) {
        const row = (await rt.db.query<{ type: string }>('SELECT type FROM device_commands WHERE id = ? AND device_id = ?', [a.id, dev.id]))[0];
        if (row?.type !== 'set_volume') continue;
        const v = Number((JSON.parse(a.result as string) as { applied_percent?: unknown }).applied_percent);
        if (Number.isInteger(v) && v >= 0 && v <= 100) {
          const ts = rt.clock.now().toISOString();
          volDirty.set(dev.id, { volume: v, ts });
          volSeen.set(dev.id, { v, at: Math.floor(rt.clock.now().getTime() / 1000) });
          defer(c, flush());
        }
      }
    } catch { /* result khong phai JSON: bo qua */ }
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
    if (q) return q.replace(/^W\//, '').replace(/"/g, '');
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


  // Phuc vu tep media da duyet cho TV khi khong co URL cong khai rieng (R2 binding). Chi tep cua creative approved/ready; ho tro Range.
  const MEDIA_MAX_CHUNK = 8 * 1024 * 1024;
  app.get('/media/*', async (c) => {
    let key: string;
    try {
      key = decodeURIComponent(new URL(c.req.url).pathname.replace(/^\/media\//, ''));
    } catch {
      throw new HttpProblem('not_found', 'Khong co.');
    }
    if (!key || key.includes('..') || key.startsWith('/')) throw new HttpProblem('not_found', 'Khong co.');
    const seg = key.split('/');
    const ok = seg[0] === 'renditions' && seg.length >= 3
      ? (await rt.db.query<{ n: number }>("SELECT 1 AS n FROM creatives WHERE id = ? AND review_state = 'approved' AND state = 'ready'", [seg[2]!]))[0]
      : (await rt.db.query<{ n: number }>("SELECT 1 AS n FROM creatives WHERE storage_key = ? AND review_state = 'approved' AND state = 'ready' LIMIT 1", [key]))[0];
    if (!ok) throw new HttpProblem('not_found', 'Khong co.');
    const head = await rt.objects.head(key);
    if (!head) throw new HttpProblem('not_found', 'Khong co.');
    const base: Record<string, string> = { 'content-type': head.contentType || 'application/octet-stream', 'accept-ranges': 'bytes', 'cache-control': 'public, max-age=3600', 'access-control-allow-origin': '*' };
    const m = /^bytes=(\d*)-(\d*)$/.exec((c.req.header('range') ?? '').trim());
    if (m && (m[1] !== '' || m[2] !== '') && rt.objects.getRange) {
      let start: number;
      let end: number;
      if (m[1] === '') {
        start = Math.max(0, head.size - Number(m[2]));
        end = head.size - 1;
      } else {
        start = Number(m[1]);
        end = m[2] === '' ? head.size - 1 : Math.min(Number(m[2]), head.size - 1);
      }
      if (!Number.isFinite(start) || start >= head.size || end < start) return new Response(null, { status: 416, headers: { ...base, 'content-range': `bytes */${head.size}` } });
      const chunk = await rt.objects.getRange(key, start, Math.min(end - start + 1, MEDIA_MAX_CHUNK));
      if (!chunk) throw new HttpProblem('not_found', 'Khong co.');
      return new Response(chunk as Uint8Array<ArrayBuffer>, { status: 206, headers: { ...base, 'content-length': String(chunk.length), 'content-range': `bytes ${start}-${start + chunk.length - 1}/${head.size}` } });
    }
    const bytes = await rt.objects.get(key);
    if (!bytes) throw new HttpProblem('not_found', 'Khong co.');
    return new Response(bytes as Uint8Array<ArrayBuffer>, { status: 200, headers: { ...base, 'content-length': String(bytes.length) } });
  });


  // ------------------------------------------------------------------ stream cho TV (stream-only)
  // TV KHONG tai tep ve: phat truc tiep tu URL. Thiet bi ky yeu cau POST /v1/media/tokens de nhan URL co chu ky HMAC ngan han (gan thiet bi + tep),
  // phat bang GET /v1/media/:id/stream?... (Range/206, khong luu cache, gioi han theo thiet bi). Khong can dang nhap nguoi dung, khong can khoa S3.
  const streamSecret = env['MEDIA_TOKEN_SECRET'] ?? env['GATEWAY_SECRET'] ?? env['FIELD_ENC_KEY'] ?? env['FIELD_INDEX_KEY'];
  const streamTtlS = Math.min(86_400, Math.max(300, envInt(env, 'MEDIA_STREAM_TTL_S', 6 * 3600)));
  const streamLimit = envInt(env, 'MEDIA_STREAM_LIMIT_PER_MIN', 1200);
  const tokenLimit = envInt(env, 'MEDIA_TOKEN_LIMIT_PER_HOUR', 240);
  const streamMac = (dev: string, cid: string, key: string, exp: number): Promise<string> => hmacSha256Hex(streamSecret!, `media-stream|${dev}|${cid}|${key}|${exp}`);
  const mediaPrefix = `${mediaBase.replace(/\/+$/, '')}/`;
  const MIME_BY_EXT: Record<string, string> = { mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

  app.post('/v1/media/tokens', async (c) => {
    const body = await readBody(c, 2048);
    const dev = await authenticateDevice(c, deps, body);
    await rateLimit(`mt:${dev.id}`, tokenLimit, 3600, 'cap token stream theo thiet bi');
    if (!streamSecret) throw new HttpProblem('not_configured', 'May chu chua cau hinh bi mat ky URL stream (MEDIA_TOKEN_SECRET).');
    const input = parseJson(body) as { creative_ids?: unknown } | null;
    const ids = Array.isArray(input?.creative_ids) ? (input!.creative_ids as unknown[]).filter((x): x is string => typeof x === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(x)) : [];
    if (ids.length < 1 || ids.length > 24) throw new HttpProblem('validation_failed', 'Can creative_ids (1..24 id hop le).');
    const view = await manifests.get(await manifests.groupFor(dev));
    const mf = JSON.parse(view.json) as { creatives?: { id: string; url?: string; delivery?: string }[] };
    const byId = new Map((mf.creatives ?? []).map((x) => [x.id, x]));
    const exp = Math.floor(rt.clock.now().getTime() / 1000) + streamTtlS;
    const streams: Record<string, { path: string; exp: number }> = {};
    const skipped: string[] = [];
    for (const id of new Set(ids)) {
      const cr = byId.get(id);
      // chi creative TAI LEN co trong manifest cua CHINH thiet bi nay va URL nam duoi kho media cua AMS (link ngoai thi TV phat thang URL ngoai)
      if (!cr || cr.delivery === 'stream' || !cr.url || !cr.url.startsWith(mediaPrefix)) { skipped.push(id); continue; }
      let key: string;
      try { key = decodeURIComponent(cr.url.slice(mediaPrefix.length).split(/[?#]/)[0]!); } catch { skipped.push(id); continue; }
      if (!key || key.includes('..') || key.startsWith('/')) { skipped.push(id); continue; }
      const t = await streamMac(dev.id, id, key, exp);
      streams[id] = { path: `/v1/media/${encodeURIComponent(id)}/stream?d=${encodeURIComponent(dev.id)}&exp=${exp}&k=${encodeURIComponent(key)}&t=${t}`, exp };
    }
    try {
      await rt.db.run('INSERT INTO audit_log (id, ts, actor_id, action, object_type, object_id, customer_id, ip, diff) VALUES (?,?,?,?,?,?,?,?,?)', [rt.id(), rt.clock.now().toISOString(), null, 'device.media_token', 'device', dev.id, null, clientIp(c), JSON.stringify({ n: Object.keys(streams).length, skipped: skipped.length, ttl_s: streamTtlS })]);
    } catch { /* nhat ky khong duoc lam hong viec cap token */ }
    return c.json({ ttl_s: streamTtlS, expires_at: new Date(exp * 1000).toISOString(), streams, skipped });
  });

  app.get('/v1/media/:id/stream', async (c) => {
    if (!streamSecret) throw new HttpProblem('not_configured', 'May chu chua cau hinh bi mat ky URL stream.');
    const id = c.req.param('id');
    const q = c.req.query();
    const exp = Number(q['exp']);
    const key = q['k'] ?? '';
    const d = q['d'] ?? '';
    const t = q['t'] ?? '';
    const bad = (why: string): never => { throw new HttpProblem('forbidden', 'URL stream khong hop le hoac het han.', { why }); };
    if (!id || !d || !key || !t || !Number.isInteger(exp)) bad('malformed');
    if (key.includes('..') || key.startsWith('/')) bad('key');
    if (exp < Math.floor(rt.clock.now().getTime() / 1000)) bad('expired');
    if (!timingSafeEqualStr(await streamMac(d, id, key, exp), t)) bad('signature');
    await rateLimit(`ms:${d}`, streamLimit, 60, 'stream media theo thiet bi');
    // thu hoi ngay khi creative het duyet / thiet bi bi xoa: khong cho phat tiep du token con han
    const live = (await rt.db.query<{ n: number }>("SELECT 1 AS n FROM creatives WHERE id = ? AND review_state = 'approved' AND state = 'ready'", [id]))[0];
    if (!live) throw new HttpProblem('not_found', 'Khong co.');
    const head = await rt.objects.head(key);
    if (!head) throw new HttpProblem('not_found', 'Khong co.');
    const ext = (key.split('.').pop() ?? '').toLowerCase();
    const ctype = head.contentType && head.contentType !== 'application/octet-stream' ? head.contentType : (MIME_BY_EXT[ext] ?? 'application/octet-stream');
    const base: Record<string, string> = { 'content-type': ctype, 'accept-ranges': 'bytes', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' };
    const rangeHdr = (c.req.header('range') ?? '').trim();
    const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHdr);
    if (rangeHdr && !(m && (m[1] !== '' || m[2] !== ''))) return new Response(null, { status: 416, headers: { ...base, 'content-range': `bytes */${head.size}` } });
    let start = 0;
    let end = head.size - 1;
    if (m) {
      if (m[1] === '') { start = Math.max(0, head.size - Number(m[2])); }
      else { start = Number(m[1]); end = m[2] === '' ? head.size - 1 : Math.min(Number(m[2]), head.size - 1); }
      if (!Number.isFinite(start) || start >= head.size || end < start) return new Response(null, { status: 416, headers: { ...base, 'content-range': `bytes */${head.size}` } });
    }
    if (c.req.method === 'HEAD') return new Response(null, { status: 200, headers: { ...base, 'content-length': String(head.size) } });
    // khong Range: tep nho tra 200; tep lon tra manh dau 206 (khong nap ca tep vao bo nho Worker)
    const wantAll = !m && head.size <= MEDIA_MAX_CHUNK;
    if (wantAll || !rt.objects.getRange) {
      const bytes = await rt.objects.get(key);
      if (!bytes) throw new HttpProblem('not_found', 'Khong co.');
      if (!m) return new Response(bytes as Uint8Array<ArrayBuffer>, { status: 200, headers: { ...base, 'content-length': String(bytes.length) } });
      const part = bytes.subarray(start, end + 1);
      return new Response(part as Uint8Array<ArrayBuffer>, { status: 206, headers: { ...base, 'content-length': String(part.length), 'content-range': `bytes ${start}-${start + part.length - 1}/${head.size}` } });
    }
    const chunk = await rt.objects.getRange(key, start, Math.min(end - start + 1, MEDIA_MAX_CHUNK));
    if (!chunk) throw new HttpProblem('not_found', 'Khong co.');
    return new Response(chunk as Uint8Array<ArrayBuffer>, { status: 206, headers: { ...base, 'content-length': String(chunk.length), 'content-range': `bytes ${start}-${start + chunk.length - 1}/${head.size}` } });
  });

  app.get('/v1/manifest', async (c) => {
    await shedCheck('manifest');
    const dev = await authenticateDevice(c, deps, new Uint8Array());
    const dp = c.req.query('daypart');
    return serveManifest(c, await manifests.groupFor(dev, dp && /^[a-z_]{1,16}$/.test(dp) ? dp : 'all'), false);
  });

  // Duong cong khai co the cache o CDN: khong xac thuc, noi dung khong bi mat (URL media cong khai + sha256).
  app.get('/v1/manifest/g/:group', async (c) => {
    if (!publicManifest) throw new HttpProblem('not_found', 'Khong co.');
    await shedCheck('manifest');
    // P2: duong cong khai khong xac thuc: gioi han theo IP (mac dinh 300/phut) de khong bi quet/doan nhom manifest
    await rateLimit(`mg:${clientIp(c)}`, envInt(env, 'MANIFEST_PUBLIC_LIMIT_PER_MIN', 300), 60, 'manifest cong khai theo IP');
    let raw: string;
    try {
      raw = decodeURIComponent(c.req.param('group'));
    } catch {
      throw new HttpProblem('not_found', 'Nhom manifest khong ton tai.');
    }
    const g = parseGroup(raw);
    if (!g || g.device || !(await manifests.known(g))) throw new HttpProblem('not_found', 'Nhom manifest khong ton tai.');
    return serveManifest(c, g, true);
  });

  // ------------------------------------------------------------------ events
  app.post('/v1/events', async (c) => {
    await shedCheck('events');
    const body = await readBody(c, MAX_EVENTS_BODY_BYTES);
    const dev = await authenticateDevice(c, deps, body);
    await rateLimit(`ev:${dev.id}`, evLimit, 60, 'lo su kien theo thiet bi');
    const parsed = parseJson<unknown>(body);
    const { events: allEvs, alias: bodyAlias } = extractEvents(parsed);
    const evs = allEvs?.filter((e) => !isItemImpressionRaw(e)) ?? [];
    const itemEvs = allEvs?.filter((e) => isItemImpressionRaw(e)) ?? [];
    if (!allEvs || allEvs.length < 1) throw new HttpProblem('validation_failed', 'Can mang events (1..50 su kien).');
    if (allEvs.length > 50) throw new HttpProblem('validation_failed', 'Toi da 50 su kien moi lo.', { max: 50, got: allEvs.length });
    const view = await manifests.get(await manifests.groupFor(dev));
    const campIds = evs.flatMap((e) => {
      const o = e as { campaign_id?: unknown; campaignId?: unknown } | null;
      const v = o?.campaign_id ?? o?.campaignId;
      return typeof v === 'string' ? [v] : [];
    });
    const rewardModels = await rewardCfg.get(campIds);
    const { result, msg, extras } = await processEvents(rt, dev, evs, view, policy, rewardModels);
    if (bodyAlias) extras.aliases[bodyAlias] = 1;
    // item_impression: chi bao cao (khong tinh tien). Loi DB noi len (5xx) de app gui lai nguyen lo — khu trung theo log_id nen an toan.
    const item = await processItemImpressions(rt, dev, itemEvs, policy);
    if (itemEvs.length > 0) {
      extras.items = { ...(item.stored ? { stored: item.stored } : {}), ...(item.duplicates ? { duplicate: item.duplicates } : {}) };
      for (const r of item.rejected) extras.items[`rej:${r.reason}`] = (extras.items[`rej:${r.reason}`] ?? 0) + 1;
    }
    // thong ke theo thiet bi cho "Chan doan dong bo" (loi thong ke KHONG duoc lam hong viec nhan su kien)
    await recordEventStats(rt, dev.id, result, extras).catch(() => undefined);
    if (msg) {
      await postViewRewards({ rt, policy: viewerPolicy }, dev, msg.impressions); // so cai truoc, hang doi sau: gui lai se khu trung theo event_id
      await rt.queue.send(INGEST_TOPIC, msg);
    }
    if (itemEvs.length === 0) return c.json(result, 202);
    // item_impression: stored + duplicates deu la "da nhan" (app xoa khoi hang doi); rejected la vinh vien (khong gui lai)
    const itemAccepted = item.stored + item.duplicates;
    return c.json(
      {
        ...result,
        accepted: result.accepted + itemAccepted,
        valid: result.valid + (dev.trust >= 1 ? itemAccepted : 0),
        flagged: result.flagged + (dev.trust >= 1 ? 0 : itemAccepted),
        rejected: [...result.rejected, ...item.rejected],
        item_impressions: { accepted: itemAccepted, stored: item.stored, duplicates: item.duplicates, rejected: item.rejected.length },
      },
      202,
    );
  });

  // ---- phia nguoi xem (WP-18): /v1/viewer/*, /v1/wallet, /v1/withdraw, /v1/interactions, /v1/tax-authorization
  mountViewerRoutes(app, { rt, deps, devices, manifests, policy: viewerPolicy, otpSender: opts.viewer?.otpSender, rewardCfg, readBody, parseJson, rateLimit });

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
  return {
    app,
    flush,
    sweep: async () => {
      const r = await sweepCommands(rt);
      await sweepEventStats(rt).catch(() => undefined);
      return { ...r, logs_deleted: await sweepDeviceLogs(rt) };
    },
    manifests,
    devices,
  };
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
