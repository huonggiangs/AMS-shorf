// Orchestrator tai: Postgres 16 THAT (embedded-postgres) + Redis THAT (redis-server) + gateway/consumer IN-PROCESS (cung tien trinh voi file nay)
// + generator tien trinh con goi HTTP loopback, ky Ed25519 that. Do p50/p95/p99, req/s, CPU, RAM, so thao tac Redis/Postgres tren moi request.
// Chay: pnpm --filter @ams/load load -- --devices 50000 --ramp 250,500,1000,2000,3000 --step-seconds 20 --fleet-devices 10000 --fleet-scale 0.025 --fleet-seconds 90 --register 3000
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { createServer, connect } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, cpus, totalmem } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { createDockerRuntime } from '@ams/runtime';
import { shardOf } from '@ams/shared';
import { seedAdFixture } from '@ams/edge-gateway/testing';
import { startNode as startGateway } from '@ams/edge-gateway/node';
import { startConsumer } from '@ams/ingest-consumer/node';
import { b64u, signed, loadKey, uuidv7, type DeviceCred, type Fixture } from './common.js';

const ROOT = new URL('../../../', import.meta.url).pathname;
const HERE = new URL('./', import.meta.url).pathname;

function parseArgs(argv: string[]): Record<string, string> {
  const o: Record<string, string> = {};
  const a = argv.filter((x) => x !== '--');
  for (let i = 0; i < a.length; i++) if (a[i]!.startsWith('--')) o[a[i]!.slice(2)] = a[i + 1] && !a[i + 1]!.startsWith('--') ? a[++i]! : '1';
  return o;
}
const args = parseArgs(process.argv.slice(2));
const N_DEV = Number(args['devices'] ?? 50_000);
const RAMP = (args['ramp'] ?? '250,500,1000,1500,2000,3000,4000').split(',').filter(Boolean).map(Number);
const STEP_S = Number(args['step-seconds'] ?? 20);
const FLEET_DEV = Number(args['fleet-devices'] ?? 0);
const FLEET_SCALE = Number(args['fleet-scale'] ?? 0.025);
const FLEET_S = Number(args['fleet-seconds'] ?? 90);
const FLEET_CAP = args['fleet-capacity'] ? Number(args['fleet-capacity']) : 0; // 0 = khong gioi han (do thuan); >0 = GW_CAPACITY_RPS that
const REGISTER = Number(args['register'] ?? 0);
const COLD = Number(args['cold-rps'] ?? 0);
const OUT = args['out'] ?? join(HERE, '..', 'results', `run-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
// ti le request/thiet bi/gio theo giao thuc that: heartbeat 300s (dang phat) = 12, manifest poll 900s = 4, lo su kien 600s = 6
const MIX = { hb: 12, mf: 4, mfFull: 0, ev: 6 };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
    s.on('error', reject);
  });
}
async function redisPing(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const c = connect(port, '127.0.0.1', () => c.write('PING\r\n'));
    c.on('data', (d) => {
      c.destroy();
      resolve(d.toString().startsWith('+PONG'));
    });
    c.on('error', () => resolve(false));
  });
}
function run(cmd: string, a: string[], env: Record<string, string | undefined>, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, a, { env: { ...process.env, ...env } as NodeJS.ProcessEnv, cwd });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} ${a.join(' ')} -> ${code}\n${out.slice(-800)}`))));
  });
}

// ---------------------------------------------------------------- do /proc
const CLK = Number(execFileSync('getconf', ['CLK_TCK']).toString().trim());
interface Proc {
  pid: number;
  ppid: number;
  ticks: number;
  rssKb: number;
  cmd: string;
}
function scanProcs(): Proc[] {
  const out: Proc[] = [];
  for (const d of readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const st = readFileSync(`/proc/${d}/stat`, 'utf8');
      const rp = st.lastIndexOf(')');
      const f = st.slice(rp + 2).split(' ');
      const status = readFileSync(`/proc/${d}/status`, 'utf8');
      const m = /VmRSS:\s+(\d+)/.exec(status);
      out.push({ pid: Number(d), ppid: Number(f[1]), ticks: Number(f[11]) + Number(f[12]), rssKb: m ? Number(m[1]) : 0, cmd: readFileSync(`/proc/${d}/cmdline`, 'utf8').replace(/\0/g, ' ') });
    } catch {
      /* tien trinh vua thoat */
    }
  }
  return out;
}
function treeOf(procs: Proc[], root: number): Proc[] {
  const res: Proc[] = [];
  const stack = [root];
  while (stack.length) {
    const p = stack.pop()!;
    const me = procs.find((x) => x.pid === p);
    if (me) res.push(me);
    for (const c of procs) if (c.ppid === p) stack.push(c.pid);
  }
  return res;
}
function sysCpu(): { sysBusy: number; sysStolen: number } {
  const f = readFileSync('/proc/stat', 'utf8').split('\n')[0]!.trim().split(/\s+/).slice(1).map(Number);
  // user nice system idle iowait irq softirq steal
  const busy = (f[0] ?? 0) + (f[1] ?? 0) + (f[2] ?? 0) + (f[5] ?? 0) + (f[6] ?? 0);
  return { sysBusy: busy / CLK, sysStolen: (f[7] ?? 0) / CLK };
}
interface Snap {
  t: number;
  hostCpu: number; // giay CPU cua tien trinh nay (gateway + consumer + orchestrator)
  hostRssMb: number;
  pgCpu: number;
  pgRssMb: number;
  redisCpu: number;
  redisRssMb: number;
  redisCmds: number;
  pgXact: number;
  redisKeys: number;
  redisUsedMb: number;
  sysBusy: number; // tong giay CPU ban tren toan may (moi nhan)
  sysStolen: number;
}

// ---------------------------------------------------------------- ha tang
const cleanups: (() => Promise<void> | void)[] = [];
async function cleanup(): Promise<void> {
  for (const c of cleanups.reverse()) {
    try {
      await c();
    } catch {
      /* bo qua */
    }
  }
}

async function main(): Promise<void> {
  const report: Record<string, unknown> = {
    started: new Date().toISOString(),
    host: { cpus: cpus().length, cpuModel: cpus()[0]?.model, memGb: +(totalmem() / 2 ** 30).toFixed(1), node: process.version },
    config: { N_DEV, RAMP, STEP_S, MIX, FLEET_DEV, FLEET_SCALE, FLEET_S, FLEET_CAP, REGISTER, COLD },
  };
  const pgPort = await freePort();
  const pgDir = join(tmpdir(), `ams-load-pg-${process.pid}-${Date.now()}`);
  const epg = new EmbeddedPostgres({ databaseDir: pgDir, user: 'ams', password: 'ams', port: pgPort, persistent: false, onLog: () => undefined, onError: () => undefined });
  await epg.initialise();
  await epg.start();
  cleanups.push(async () => {
    await epg.stop();
    if (existsSync(pgDir)) rmSync(pgDir, { recursive: true, force: true });
  });
  await epg.createDatabase('ams');
  const dbUrl = `postgres://ams:ams@127.0.0.1:${pgPort}/ams`;
  const pgc = new pg.Client({ connectionString: dbUrl });
  await pgc.connect();
  cleanups.push(() => pgc.end());
  report['postgres'] = String((await pgc.query('SHOW server_version')).rows[0].server_version);
  const pgDefaults = (await pgc.query("SELECT name, setting FROM pg_settings WHERE name IN ('shared_buffers','max_connections','synchronous_commit','fsync','wal_level')")).rows;
  report['postgresSettings'] = Object.fromEntries(pgDefaults.map((r: { name: string; setting: string }) => [r.name, r.setting]));

  const redisPort = await freePort();
  const rdir = mkdtempSync(join(tmpdir(), 'ams-load-redis-'));
  const redisProc: ChildProcess = spawn('redis-server', ['--port', String(redisPort), '--bind', '127.0.0.1', '--save', '', '--appendonly', 'no', '--dir', rdir], { stdio: 'ignore' });
  cleanups.push(() => {
    redisProc.kill('SIGTERM');
    rmSync(rdir, { recursive: true, force: true });
  });
  for (let i = 0; i < 80 && !(await redisPing(redisPort)); i++) await sleep(100);
  report['redis'] = execFileSync('redis-server', ['--version']).toString().match(/v=(\S+)/)?.[1];
  const redisCli = (cmd: string[]): string => execFileSync('redis-cli', ['-p', String(redisPort), ...cmd]).toString();

  const env: Record<string, string> = {
    DATABASE_URL: dbUrl,
    REDIS_URL: `redis://127.0.0.1:${redisPort}`,
    S3_ENDPOINT: 'http://127.0.0.1:1',
    S3_BUCKET: 'ams-media',
    S3_ACCESS_KEY: 'x',
    S3_SECRET_KEY: 'x',
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: '1',
    SESSION_SECRET: randomBytes(32).toString('base64'),
    FIELD_ENC_KEY: randomBytes(32).toString('base64'),
    SCRYPT_N: '1024',
    MEDIA_PUBLIC_URL: 'https://media.load.test',
    REGISTER_LIMIT_PER_HOUR: '100000000', // chi de gia lap tu mot IP loopback
    TELEMETRY_FLUSH_MS: '2000',
    IMPRESSION_PRICE_MICRO_VND: '20000000',
    GATEWAY_DEV_ENDPOINTS: '0',
    API_SCHEDULER: '0',
    // HB_MIN_GAP_S, EVENTS_LIMIT_PER_MIN, TELEMETRY_SAMPLE_EVERY, MANIFEST_*_TTL: de MAC DINH cua gateway
  };
  await run('pnpm', ['--filter', '@ams/api', 'migrate'], env, ROOT);

  // ---------- du lieu: chien dich mau + thiet bi (chen thang vao Postgres; dang ky that duoc do rieng o pha 'register')
  const setup = await createDockerRuntime(env);
  cleanups.push(async () => void (await setup.close?.()));
  const fx = await seedAdFixture(setup, { campaigns: 3, creativesPerCampaign: 2, withObjects: false });
  for (const c of fx.campaigns) for (const cr of c.creatives) await setup.db.run('UPDATE creatives SET sha256 = ? WHERE id = ?', [cr.sha256, cr.id]);
  const fixture: Fixture = { items: fx.campaigns.map((c) => ({ campaign_id: c.id, creative_id: c.creatives[0]!.id, slot_id: c.slotId })) };
  const userId = setup.id();
  await setup.db.run('INSERT INTO end_users (id, created_at) VALUES (?, ?)', [userId, new Date().toISOString()]);

  const t0 = performance.now();
  const creds: DeviceCred[] = [];
  const cols: Record<string, (string | number)[]> = { id: [], kind: [], model: [], region: [], pub: [], shard: [] };
  for (let i = 0; i < N_DEV; i++) {
    const kp = generateKeyPairSync('ed25519');
    const id = setup.id();
    const region = i % 2 ? 'HN' : 'HCM';
    creds.push({ id, region, priv: (kp.privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer).toString('base64') });
    cols['id']!.push(id);
    cols['region']!.push(region);
    cols['pub']!.push(b64u(Buffer.from(kp.publicKey.export({ format: 'jwk' }).x!, 'base64url')));
    cols['shard']!.push(shardOf(id));
  }
  const now = new Date().toISOString();
  for (let i = 0; i < N_DEV; i += 5000) {
    const sl = (a: (string | number)[]) => a.slice(i, i + 5000);
    await pgc.query(
      `INSERT INTO devices (id, user_id, kind, model, os, app_version, region_id, pubkey_ed25519, trust_level, status, paired_at, blocked, shard, created_at)
       SELECT id, $1, 'tv', 'LoadTV', 'sim', '0.0.1-load', region, pub, 1, 'active', $2, 0, shard, $2
       FROM unnest($3::text[], $4::text[], $5::text[], $6::int[]) AS t(id, region, pub, shard)`,
      [userId, now, sl(cols['id']!), sl(cols['region']!), sl(cols['pub']!), sl(cols['shard']!)],
    );
  }
  report['deviceSetupSeconds'] = +((performance.now() - t0) / 1000).toFixed(1);
  const devicesFile = join(tmpdir(), `ams-load-devices-${process.pid}.json`);
  writeFileSync(devicesFile, JSON.stringify(creds));
  cleanups.push(() => rmSync(devicesFile, { force: true }));

  // ---------- gateway + consumer IN-PROCESS
  let gw: { close(): Promise<void>; port: number } | undefined;
  let cons: { close(): Promise<void>; port: number } | undefined;
  const startGw = async (cap: number): Promise<void> => {
    const port = await freePort();
    gw = await startGateway({ ...env, PORT: String(port), GW_CAPACITY_RPS: String(cap), COMMAND_SWEEP_MS: '60000' });
    if (!cons) cons = await startConsumer({ ...env, PORT: '0' });
  };
  const stopGw = async (): Promise<void> => {
    await gw?.close();
    gw = undefined;
  };
  cleanups.push(async () => {
    await stopGw();
    await cons?.close();
  });
  const base = () => `http://127.0.0.1:${gw!.port}`;

  const mkSnap = async (): Promise<Snap> => {
    const procs = scanProcs();
    const me = procs.find((p) => p.pid === process.pid)!;
    const pgRoot = procs.find((p) => p.cmd.includes(pgDir) && /postgres/.test(p.cmd) && !procs.some((q) => q.pid === p.ppid && q.cmd.includes(pgDir)));
    const pgTree = pgRoot ? treeOf(procs, pgRoot.pid) : [];
    const rd = procs.find((p) => p.pid === redisProc.pid);
    const info = redisCli(['info']);
    const num = (re: RegExp) => Number(re.exec(info)?.[1] ?? 0);
    const x = (await pgc.query("SELECT xact_commit + xact_rollback AS x FROM pg_stat_database WHERE datname = 'ams'")).rows[0];
    return {
      t: performance.now() / 1000,
      hostCpu: me.ticks / CLK,
      hostRssMb: me.rssKb / 1024,
      pgCpu: pgTree.reduce((s, p) => s + p.ticks, 0) / CLK,
      pgRssMb: pgTree.reduce((s, p) => s + p.rssKb, 0) / 1024,
      redisCpu: (rd?.ticks ?? 0) / CLK,
      redisRssMb: (rd?.rssKb ?? 0) / 1024,
      redisCmds: num(/total_commands_processed:(\d+)/),
      pgXact: Number(x?.x ?? 0),
      redisKeys: Number(/db0:keys=(\d+)/.exec(info)?.[1] ?? 0),
      redisUsedMb: num(/used_memory:(\d+)/) / 2 ** 20,
      ...sysCpu(),
    };
  };

  const etags: Record<string, string> = {};
  const learnEtags = async (): Promise<void> => {
    for (const region of ['HN', 'HCM']) {
      const d = creds.find((c) => c.region === region)!;
      const path = '/v1/manifest';
      const r = await fetch(base() + path, { headers: signed(loadKey(d.priv), d.id, 'GET', path, undefined, Math.floor(Date.now() / 1000)) });
      const j = (await r.json()) as { etag: string; creatives: unknown[]; schedule: unknown[] };
      if (r.status !== 200 || !j.etag) throw new Error(`khong lay duoc manifest ${region}: ${r.status}`);
      etags[region] = j.etag;
      report[`manifest_${region}`] = { creatives: j.creatives.length, slots: j.schedule.length, bytes: JSON.stringify(j).length };
    }
  };

  async function phase(name: string, genCfg: Record<string, unknown>): Promise<Record<string, any>> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const child = spawn('node', ['--import', 'tsx', join(HERE, 'gen.ts'), JSON.stringify({ base: base(), devicesFile, fixture, etags, ...genCfg })], { stdio: ['pipe', 'pipe', 'inherit'], cwd: HERE });
    let buf = '';
    const holder: { result: Record<string, any> | null; ready: () => void } = { result: null, ready: () => undefined }; // eslint-disable-line @typescript-eslint/no-explicit-any
    const readyP = new Promise<void>((r) => (holder.ready = r));
    const exited = new Promise<void>((r) => child.on('close', () => r()));
    child.stdout!.on('data', (d: Buffer) => {
      buf += d.toString();
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (line === 'READY') holder.ready();
        else if (line.startsWith('RESULT ')) holder.result = JSON.parse(line.slice(7));
      }
    });
    await readyP;
    await sleep(500);
    const a = await mkSnap();
    child.stdin!.write('GO\n');
    await exited;
    const b = await mkSnap();
    const result = holder.result;
    if (!result) throw new Error(`generator ${name} khong tra ket qua`);
    const wall = b.t - a.t;
    const total = result['types']['ALL'].count as number;
    result['server'] = {
      wallS: +wall.toFixed(2),
      gatewayCpuCores: +((b.hostCpu - a.hostCpu) / wall).toFixed(3),
      gatewayCpuMsPerReq: +(((b.hostCpu - a.hostCpu) * 1000) / total).toFixed(3),
      pgCpuCores: +((b.pgCpu - a.pgCpu) / wall).toFixed(3),
      pgCpuMsPerReq: +(((b.pgCpu - a.pgCpu) * 1000) / total).toFixed(3),
      redisCpuCores: +((b.redisCpu - a.redisCpu) / wall).toFixed(3),
      redisCpuMsPerReq: +(((b.redisCpu - a.redisCpu) * 1000) / total).toFixed(3),
      redisOpsPerReq: +((b.redisCmds - a.redisCmds) / total).toFixed(2),
      pgTxPerReq: +((b.pgXact - a.pgXact) / total).toFixed(3),
      systemBusyCores: +((b.sysBusy - a.sysBusy) / wall).toFixed(2),
      otherProcessesCores: +Math.max(0, (b.sysBusy - a.sysBusy) / wall - ((b.hostCpu - a.hostCpu) / wall + (b.pgCpu - a.pgCpu) / wall + (b.redisCpu - a.redisCpu) / wall + (result['genCpuCores'] as number))).toFixed(2),
      stolenCores: +((b.sysStolen - a.sysStolen) / wall).toFixed(2),
      loadavg1: Number(readFileSync('/proc/loadavg', 'utf8').split(' ')[0]),
      hostRssMb: +b.hostRssMb.toFixed(0),
      pgRssMb: +b.pgRssMb.toFixed(0),
      redisRssMb: +b.redisRssMb.toFixed(0),
      redisKeys: b.redisKeys,
      redisUsedMb: +b.redisUsedMb.toFixed(1),
    };
    const t = result['types'] as Record<string, { count: number; p99: number; errors: number }>;
    const brief = Object.entries(t).map(([k, v]) => `${k}:${v.count}/p99=${v.p99.toFixed(0)}ms/err=${v.errors}`).join(' ');
    console.error(`[${name}] ${result['achievedRps'].toFixed(0)} req/s  gwCPU=${result['server'].gatewayCpuCores} cores  pg=${result['server'].pgCpuCores}  redis=${result['server'].redisCpuCores}  gen=${result['genCpuCores'].toFixed(2)}  other=${result['server'].otherProcessesCores}  ${brief}`);
    return result;
  }

  // ---------- pha 1: ramp theo muc rps (mo vong), gateway khong tu giam tai (do cong suat thuan)
  await startGw(100_000_000);
  await learnEtags();
  const ramp: Record<string, any>[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  let acceptedEv = 0;
  let hbOk = 0;
  const countHb0 = (r: Record<string, any>) => (hbOk += Number(r['types']?.heartbeat?.statuses?.['200'] ?? 0)); // eslint-disable-line @typescript-eslint/no-explicit-any
  const countHb = countHb0;
  // khoi dong nong: nap bo nho dem thiet bi + presence, khong tinh vao ket qua
  if (RAMP.length) {
    const w = await phase('warmup', { mode: 'ramp', rps: 500, seconds: 10, mix: MIX });
    acceptedEv += w['ev']?.accepted ?? 0;
    hbOk += Number(w['types']?.heartbeat?.statuses?.['200'] ?? 0);
    report['warmup'] = w;
    await sleep(6000);
  }
  for (const rps of RAMP) {
    const r = await phase(`ramp ${rps}`, { mode: 'ramp', rps, seconds: STEP_S, mix: MIX });
    ramp.push(r);
    acceptedEv += r['ev']?.accepted ?? 0;
    countHb(r);
    const all = r['types'].ALL;
    if (all.errors / all.count > 0.05 || r['achievedRps'] < rps * 0.8) {
      console.error(`dung ramp: qua nguong tai muc ${rps} rps`);
      break;
    }
    await sleep(6000); // > HB_MIN_GAP_S de khong va cham 429 giua cac buoc
  }
  report['ramp'] = ramp;
  if (COLD > 0) {
    report['coldManifest'] = await phase('cold manifest (khong etag, 200 + than day du)', { mode: 'ramp', rps: COLD, seconds: STEP_S, mix: { hb: 0, mf: 0, mfFull: 1, ev: 0 } });
    await sleep(2000);
  }
  if (REGISTER > 0) {
    report['register'] = await phase('register', { mode: 'register', count: REGISTER, concurrency: 64, seconds: 0 });
    report['registerDbRows'] = Number((await pgc.query("SELECT COUNT(*) AS n FROM devices WHERE model = 'LoadTV' AND status = 'checking'")).rows[0].n);
  }

  // ---------- pha 2: doi thiet bi theo giao thuc (chu ky do SERVER dieu khien, jitter, nen thoi gian)
  if (FLEET_DEV > 0) {
    if (FLEET_CAP > 0) {
      await stopGw();
      await startGw(FLEET_CAP);
      await learnEtags();
    }
    const fr = await phase(`fleet ${FLEET_DEV} thiet bi x${(1 / FLEET_SCALE).toFixed(0)}`, { mode: 'fleet', devices: FLEET_DEV, scale: FLEET_SCALE, seconds: FLEET_S });
    report['fleet'] = fr;
    acceptedEv += fr['fleet']?.evAccepted ?? 0;
    countHb(fr);
  }

  // ---------- ben vung: doi hang doi + telemetry xa het, doi chieu DB
  const q = async (sql: string) => (await pgc.query(sql)).rows[0];
  let imp = 0;
  for (let i = 0; i < Number(args['drain-wait'] ?? 90); i++) {
    imp = Number((await q('SELECT COUNT(*) AS n FROM ev_ad_impression')).n);
    if (imp >= acceptedEv) break;
    await sleep(1000);
  }
  await sleep(4000); // 2 chu ky xa telemetry (TELEMETRY_FLUSH_MS=2000)
  const hbRows = Number((await q('SELECT COUNT(*) AS n FROM ev_heartbeat')).n);
  const impDistinct = Number((await q('SELECT COUNT(DISTINCT event_id) AS n FROM ev_ad_impression')).n);
  const hourly = Number((await q('SELECT COALESCE(SUM(impressions),0) AS n FROM impression_hourly')).n);
  const spend = await q("SELECT COUNT(*) AS n, COALESCE(SUM(impressions),0) AS imps FROM spend_events").catch(() => null);
  const consStats = await fetch(`http://127.0.0.1:${cons!.port}/health`).then((r) => r.json()).catch(() => null);
  report['durability'] = { consumerStats: consStats, eventsAcceptedByGateway: acceptedEv, ev_ad_impression_rows: imp, distinctEventIds: impDistinct, impression_hourly_sum: hourly, spend_events: spend, heartbeats200: hbOk, ev_heartbeat_rows: hbRows };

  // idempotent: gui lai CUNG event_id (nonce moi) -> khong tang so dem
  {
    const d = creds[0]!;
    const key = loadKey(d.priv);
    const it = fixture.items[0]!;
    const t = Date.now() - 5000;
    const ev = { type: 'impression', event_id: uuidv7(t), ts: new Date(t).toISOString(), campaign_id: it.campaign_id, creative_id: it.creative_id, slot_id: it.slot_id, vcr_pct: 100, played_ms: 15000 };
    const body = JSON.stringify({ events: [ev] });
    const before = Number((await q('SELECT COUNT(*) AS n FROM ev_ad_impression')).n);
    const codes: number[] = [];
    for (let i = 0; i < 3; i++) codes.push((await fetch(base() + '/v1/events', { method: 'POST', headers: signed(key, d.id, 'POST', '/v1/events', body, Math.floor(Date.now() / 1000)), body })).status);
    await sleep(2500);
    const after = Number((await q('SELECT COUNT(*) AS n FROM ev_ad_impression')).n);
    report['dedupe'] = { statuses: codes, rowsAdded: after - before };
  }
  // chi so thiet bi online trong Redis (presence)
  report['presenceKeys'] = Number(redisCli(['eval', "return #redis.call('keys','presence:*')", '0']).trim());
  report['finished'] = new Date().toISOString();
  mkdirSync(join(OUT, '..'), { recursive: true });
  writeFileSync(OUT, JSON.stringify(report, null, 1));
  console.error(`ket qua: ${OUT}`);
}

main()
  .catch((e) => {
    console.error('LOI', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    process.exit(process.exitCode ?? 0);
  });
