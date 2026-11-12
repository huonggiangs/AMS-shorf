// Generator tai (tien trinh con). Giao tiep voi orchestrator: dong 'READY' tren stdout sau khi chuan bi xong, doi 'GO' tren stdin,
// cuoi cung in mot dong JSON ket qua tien to 'RESULT '. Moi yeu cau di qua HTTP that (loopback) va duoc ky Ed25519.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { createInterface } from 'node:readline';
import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import { Rec, loadKey, signed, uuidv7, b64u, type DeviceCred, type Fixture } from './common.js';

interface Cfg {
  mode: 'ramp' | 'fleet' | 'register';
  base: string;
  devicesFile: string;
  fixture: Fixture;
  seconds: number;
  // ramp
  rps?: number;
  mix?: { hb: number; mf: number; mfFull: number; ev: number };
  // fleet
  devices?: number;
  scale?: number; // he so nen thoi gian (0,025 = 40x nhanh hon)
  // register
  count?: number;
  concurrency?: number;
  etags: Record<string, string>;
}
const cfg = JSON.parse(process.argv[2]!) as Cfg;
const url = new URL(cfg.base);
const agent = new http.Agent({ keepAlive: true, maxSockets: 1024, maxFreeSockets: 1024 });
const rec = new Rec();
const loopDelay = monitorEventLoopDelay({ resolution: 5 });

interface Resp {
  status: number;
  text: string;
  next?: number;
}
function send(method: 'GET' | 'POST', path: string, headers: Record<string, string>, body: string | undefined): Promise<Resp> {
  return new Promise((resolve) => {
    const req = http.request({ agent, host: url.hostname, port: url.port, method, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', () => resolve({ status: 0, text: '' }));
    req.setTimeout(30_000, () => req.destroy());
    if (body !== undefined) req.write(body);
    req.end();
  });
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const nowSec = () => Math.floor(Date.now() / 1000);

let devs: DeviceCred[] = [];
const keys = new Map<string, KeyObject>();
const keyOf = (d: DeviceCred): KeyObject => keys.get(d.id) ?? keys.set(d.id, loadKey(d.priv)).get(d.id)!;

function hbBody(): string {
  return JSON.stringify({ state: 1, app_ver: '0.0.1-load', soc_temp: 45 + Math.floor(Math.random() * 20), rssi: -40 - Math.floor(Math.random() * 30), dl_mbps: 20, cache_used_mb: 300, cache_slots: 8 });
}
function evBody(n: number): string {
  const it = cfg.fixture.items;
  const evs = [];
  for (let i = 0; i < n; i++) {
    const t = Date.now() - 2000 - i * 1000;
    const x = it[Math.floor(Math.random() * it.length)]!;
    evs.push({ type: 'impression', event_id: uuidv7(t), ts: new Date(t).toISOString(), campaign_id: x.campaign_id, creative_id: x.creative_id, slot_id: x.slot_id, vcr_pct: 100, played_ms: 15000 });
  }
  return JSON.stringify({ events: evs });
}
const poisson = (l: number): number => {
  let k = 0;
  let p = 1;
  const L = Math.exp(-l);
  do {
    k++;
    p *= Math.random();
  } while (p > L);
  return k - 1;
};

type Kind = 'hb' | 'mf' | 'mfFull' | 'ev';
interface Prepared {
  at: number; // ms tu luc bat dau
  kind: Kind;
  method: 'GET' | 'POST';
  path: string;
  headers: Record<string, string>;
  body: string | undefined;
}
const label: Record<Kind, string> = { hb: 'heartbeat', mf: 'manifest_304', mfFull: 'manifest_full', ev: 'events' };

function prepareRamp(): Prepared[] {
  const rps = cfg.rps!;
  const mix = cfg.mix!;
  const tot = mix.hb + mix.mf + mix.mfFull + mix.ev;
  const n = Math.round(rps * cfg.seconds);
  const out: Prepared[] = [];
  // con tro vong tron tren hoan vi ngau nhien: moi thiet bi cach nhau toi thieu N_pool/rps_kind giay
  const perm = (seed: number) => {
    const a = devs.map((_, i) => i);
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a.slice(seed % a.length).concat(a.slice(0, seed % a.length));
  };
  const cur: Record<Kind, number[]> = { hb: perm(0), mf: perm(1), mfFull: perm(2), ev: perm(3) };
  const pos: Record<Kind, number> = { hb: 0, mf: 0, mfFull: 0, ev: 0 };
  let t = 0;
  const ts0 = nowSec();
  for (let i = 0; i < n; i++) {
    t += (-Math.log(1 - Math.random()) / rps) * 1000; // Poisson
    let r = Math.random() * tot;
    const kind: Kind = (r -= mix.hb) < 0 ? 'hb' : (r -= mix.mf) < 0 ? 'mf' : (r -= mix.mfFull) < 0 ? 'mfFull' : 'ev';
    const d = devs[cur[kind][pos[kind]++ % devs.length]!]!;
    const key = keyOf(d);
    let method: 'GET' | 'POST' = 'POST';
    let path = '/v1/heartbeat';
    let body: string | undefined;
    if (kind === 'hb') body = hbBody();
    else if (kind === 'ev') {
      path = '/v1/events';
      body = evBody(1 + poisson(0.33)); // ~1,33 impression/lo (8/gio gui moi 10 phut)
    } else {
      method = 'GET';
      path = kind === 'mf' ? `/v1/manifest?etag=${cfg.etags[d.region]}` : '/v1/manifest';
    }
    out.push({ at: t, kind, method, path, headers: signed(key, d.id, method, path, body, ts0 + Math.floor(t / 1000)), body });
  }
  return out;
}

async function runRamp(): Promise<void> {
  const prep = prepareRamp();
  send0();
  await go();
  loopDelay.enable();
  const cpu0 = process.cpuUsage();
  const t0 = performance.now();
  let inflight = 0;
  let maxInflight = 0;
  let idx = 0;
  await new Promise<void>((resolveAll) => {
    let done = 0;
    const total = prep.length;
    const tick = () => {
      const now = performance.now() - t0;
      while (idx < total && prep[idx]!.at <= now) {
        const p = prep[idx++]!;
        const sched = t0 + p.at;
        inflight++;
        maxInflight = Math.max(maxInflight, inflight);
        void send(p.method, p.path, p.headers, p.body).then((r) => {
          inflight--;
          rec.add(label[p.kind], performance.now() - sched, r.status); // do tu thoi diem DU KIEN gui (tranh coordinated omission)
          if (++done === total) resolveAll();
        });
      }
      if (idx < total) setTimeout(tick, 1);
    };
    tick();
  });
  const wall = (performance.now() - t0) / 1000;
  finish({ wall, cpu: process.cpuUsage(cpu0), maxInflight, offered: prep.length });
}

// --------------------------------------------------------------------------- fleet
async function runFleet(): Promise<void> {
  const n = Math.min(cfg.devices!, devs.length);
  const S = cfg.scale!;
  const stats = { hb: 0, intervals: [] as number[], bases: new Set<number>(), mfFull: 0, mf304: 0, evSent: 0, evValid: 0, evAccepted: 0, hb503: 0, hb429: 0, etagChanges: 0 };
  await go();
  loopDelay.enable();
  const cpu0 = process.cpuUsage();
  const t0 = performance.now();
  const endAt = t0 + cfg.seconds * 1000;
  const jit = (x: number) => x * (0.8 + Math.random() * 0.4);
  const timers: NodeJS.Timeout[] = [];
  let live = 0;
  const after = (ms: number, f: () => void) => {
    if (performance.now() + ms < endAt) timers.push(setTimeout(f, ms));
  };
  const record = (type: string, t1: number, status: number) => rec.add(type, performance.now() - t1, status);

  const startDevice = (i: number) => {
    const d = devs[i]!;
    const key = keyOf(d);
    let etag: string | null = null;
    const call = async (type: string, method: 'GET' | 'POST', path: string, body?: string): Promise<Resp> => {
      const h = signed(key, d.id, method, path, body, nowSec());
      const t1 = performance.now();
      const r = await send(method, path, h, body);
      record(type, t1, r.status);
      return r;
    };
    const syncManifest = async () => {
      const r = await call(etag ? 'manifest_304' : 'manifest_full', 'GET', etag ? `/v1/manifest?etag=${etag}` : '/v1/manifest');
      if (r.status === 304) stats.mf304++;
      else if (r.status === 200) {
        stats.mfFull++;
        try {
          etag = (JSON.parse(r.text) as { etag: string }).etag;
        } catch {
          /* bo qua */
        }
      }
    };
    const hbLoop = async () => {
      const r = await call('heartbeat', 'POST', '/v1/heartbeat', hbBody());
      let nextS = 300;
      if (r.status === 200) {
        stats.hb++;
        const j = JSON.parse(r.text) as { next_interval: number; interval_base: number; manifest_etag: string };
        nextS = j.next_interval;
        stats.intervals.push(j.next_interval);
        stats.bases.add(j.interval_base);
        if (j.manifest_etag !== etag) {
          stats.etagChanges++;
          void syncManifest();
        }
      } else {
        if (r.status === 503) stats.hb503++;
        if (r.status === 429) stats.hb429++;
        const m = /"retry_after":(\d+)/.exec(r.text);
        nextS = m ? Number(m[1]) : 60; // ton trong Retry-After
      }
      after(nextS * 1000 * S, () => void hbLoop());
    };
    const mfLoop = () =>
      after(jit(900_000 * S), () => {
        void syncManifest();
        mfLoop();
      });
    const evLoop = () =>
      after(jit(600_000 * S), () => {
        const k = Math.max(1, poisson(1.33));
        void call('events', 'POST', '/v1/events', evBody(k)).then((r) => {
          if (r.status === 202) {
            const j = JSON.parse(r.text) as { accepted: number; valid: number };
            stats.evSent += k;
            stats.evAccepted += j.accepted;
            stats.evValid += j.valid;
          }
        });
        evLoop();
      });
    live++;
    void hbLoop();
    mfLoop();
    evLoop();
  };
  // khoi dong nga ngau nhien trong 60 giay (nhan voi he so nen), nhu app that sau mat dien hang loat
  for (let i = 0; i < n; i++) {
    const delay = Math.random() * 60_000 * S;
    timers.push(setTimeout(() => startDevice(i), delay));
  }
  await sleep(cfg.seconds * 1000);
  for (const t of timers) clearTimeout(t);
  await sleep(1500);
  const wall = (performance.now() - t0) / 1000;
  const iv = Float64Array.from(stats.intervals).sort();
  finish({ wall, cpu: process.cpuUsage(cpu0), live, fleet: { ...stats, bases: [...stats.bases], intervals: undefined, intervalMin: iv[0], intervalMax: iv[iv.length - 1], intervalMean: iv.reduce((a, b) => a + b, 0) / (iv.length || 1) } });
}

// -------------------------------------------------------------------------- register
async function runRegister(): Promise<void> {
  const total = cfg.count!;
  const pre: { path: string; headers: Record<string, string>; body: string }[] = [];
  const ts0 = nowSec();
  for (let i = 0; i < total; i++) {
    const kp = generateKeyPairSync('ed25519');
    const pub = b64u(Buffer.from(kp.publicKey.export({ format: 'jwk' }).x!, 'base64url'));
    const body = JSON.stringify({ pubkey: pub, kind: 'tv', model: 'LoadTV', os: 'sim', app_version: '0.0.1-load', region: i % 2 ? 'HN' : 'HCM' });
    pre.push({ path: '/v1/register', body, headers: signed(kp.privateKey, null, 'POST', '/v1/register', body, ts0) });
  }
  send0();
  await go();
  loopDelay.enable();
  const cpu0 = process.cpuUsage();
  const t0 = performance.now();
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= total) return;
      const p = pre[i]!;
      const t1 = performance.now();
      const r = await send('POST', p.path, p.headers, p.body);
      rec.add('register', performance.now() - t1, r.status);
    }
  };
  await Promise.all(Array.from({ length: cfg.concurrency ?? 64 }, worker));
  finish({ wall: (performance.now() - t0) / 1000, cpu: process.cpuUsage(cpu0), offered: total });
}

// ---------------------------------------------------------------------------- main
function send0(): void {
  console.log('READY');
}
let goResolve: () => void = () => undefined;
const goP = new Promise<void>((r) => (goResolve = r));
const go = (): Promise<void> => goP;
createInterface({ input: process.stdin }).on('line', (l) => {
  if (l.trim() === 'GO') goResolve();
});

function finish(extra: Record<string, unknown>): void {
  const cpu = extra['cpu'] as { user: number; system: number };
  const wall = extra['wall'] as number;
  const s = rec.summary();
  const out = {
    mode: cfg.mode,
    rpsTarget: cfg.rps ?? null,
    seconds: wall,
    achievedRps: s['ALL']!.count / wall,
    types: s,
    genCpuCores: (cpu.user + cpu.system) / 1e6 / wall,
    loopDelayP99ms: loopDelay.percentile(99) / 1e6,
    loopDelayMaxMs: loopDelay.max / 1e6,
    ...extra,
    cpu: undefined,
  };
  console.log('RESULT ' + JSON.stringify(out));
  process.exit(0);
}

devs = JSON.parse(readFileSync(cfg.devicesFile, 'utf8')) as DeviceCred[];
if (cfg.mode === 'ramp') void runRamp();
else if (cfg.mode === 'fleet') void runFleet();
else void runRegister();
