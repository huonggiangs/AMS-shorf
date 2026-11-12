import { generateEd25519KeyPair, uuidv7, type Ed25519KeyPair } from '@ams/shared';
import { signRequest } from '@ams/edge-gateway/testing';
import type { Manifest } from '@ams/edge-gateway/protocol';
import type { Recorder } from './stats.js';
import type { SimResponse, Transport } from './transport.js';

export interface DeviceOpts {
  transport: Transport;
  rec: Recorder;
  /** giay may chu (thiet bi tin cay dong ho may chu qua server_time; sim dung gio that, hoac ham nay trong test dong ho gia) */
  nowSec?: () => number;
  /** ngu `ms` (sim co the nen thoi gian); mac dinh khong ngu */
  sleep?: (ms: number) => Promise<void>;
  /** he so nen thoi gian khi tinh thoi gian cho theo next_interval/Retry-After (mac dinh 0 = khong cho) */
  timeScale?: number;
  /** Xac nhan ma ghep doi thay cho nguoi dung (API app dien thoai); tra true neu thanh cong */
  confirmPairing?: (code: string) => Promise<boolean>;
  kind?: string;
  region?: string;
  /** xac suat thiet bi la doi tuong ngau nhien cua RNG (de test xac dinh) */
  rng?: () => number;
  maxAttempts?: number;
  /** 'endpoint' (mac dinh): ack qua POST /v1/commands/ack; 'heartbeat': ack cu qua cmd_ack o heartbeat ke tiep */
  ackMode?: 'endpoint' | 'heartbeat';
  /** loai lenh ma thiet bi nay bao 'failed' (de thu duong that bai) */
  failCommandTypes?: string[];
}

export interface DeviceReport {
  deviceId: string;
  registered: boolean;
  paired: boolean;
  heartbeats: number;
  intervals: { base: number; next: number }[];
  manifestFetches: number;
  manifest304: number;
  creatives: number;
  eventsSent: number;
  eventsAccepted: number;
  eventsValid: number;
  retries: number;
  errors: string[];
  /** lenh nhan o heartbeat (tinh ca giao lai), so da ack ok / failed */
  commandsReceived: number;
  commandsAcked: number;
  commandsFailed: number;
  /** id lenh da thuc thi (moi id mot lan: giao lai duoc khu trung phia thiet bi vi lenh phai idempotent) */
  commandsExecuted: { id: string; type: string; args?: unknown }[];
}

export interface DeviceCommandMsg {
  id: string;
  type: string;
  args?: Record<string, unknown>;
}

const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 60_000;

/**
 * Thiet bi ao tuan theo docs/DEVICE-PROTOCOL.md. Cung la "ban tham chieu" cho app TV:
 * ky moi yeu cau bang nonce moi, retry voi backoff mu + full jitter, ton trong Retry-After, chi tai manifest khi etag doi.
 */
export class VirtualDevice {
  keys!: Ed25519KeyPair;
  id = '';
  etag: string | null = null;
  manifest: Manifest | null = null;
  report: DeviceReport = { deviceId: '', registered: false, paired: false, heartbeats: 0, intervals: [], manifestFetches: 0, manifest304: 0, creatives: 0, eventsSent: 0, eventsAccepted: 0, eventsValid: 0, retries: 0, errors: [], commandsReceived: 0, commandsAcked: 0, commandsFailed: 0, commandsExecuted: [] };
  /** lenh da thuc thi (khu trung giao lai) */
  private doneCommands = new Set<string>();
  /** id cho ack qua heartbeat o lan ke tiep */
  private pendingAck: string[] = [];
  /** lenh refresh_manifest vua nhan: lan sync ke tiep tai lai du etag khong doi */
  forceManifest = false;
  monitor = false;
  private o: Required<Pick<DeviceOpts, 'transport' | 'rec'>> & DeviceOpts;
  constructor(o: DeviceOpts) {
    this.o = o;
  }

  private now(): number {
    return this.o.nowSec ? this.o.nowSec() : Math.floor(Date.now() / 1000);
  }
  private async wait(ms: number): Promise<void> {
    const t = ms * (this.o.timeScale ?? 0);
    if (t > 0) await (this.o.sleep ?? ((x: number) => new Promise<void>((r) => setTimeout(r, x))))(t);
  }

  /** Gui mot yeu cau da ky, co retry cho 429/503/loi mang (tai cung nonce MOI moi lan). */
  async request(endpoint: string, method: 'GET' | 'POST', path: string, payload?: unknown, o: { signAs?: 'device' | 'register'; okStatuses?: number[] } = {}): Promise<SimResponse> {
    const body = payload === undefined ? undefined : JSON.stringify(payload);
    const max = this.o.maxAttempts ?? 4;
    let last: SimResponse | undefined;
    for (let attempt = 0; attempt < max; attempt++) {
      const s = await signRequest(this.keys.privateKey, { method, path, ...(body !== undefined ? { body } : {}), ...(o.signAs === 'register' ? {} : { deviceId: this.id }), ts: this.now() });
      const t0 = performance.now();
      try {
        last = await this.o.transport({ method, path, headers: s.headers, ...(body !== undefined ? { body } : {}) });
      } catch (e) {
        this.o.rec.add(endpoint, performance.now() - t0, 0);
        this.report.errors.push(`${endpoint}: mang ${(e as Error).message}`);
        this.report.retries++;
        await this.wait(this.backoff(attempt));
        continue;
      }
      this.o.rec.add(endpoint, performance.now() - t0, last.status, [...(o.okStatuses ?? []), 200, 201, 202, 304]);
      if (last.status !== 429 && last.status !== 503 && last.status < 500) return last;
      this.report.retries++;
      const ra = Number(last.headers.get('retry-after'));
      await this.wait(Number.isFinite(ra) && ra > 0 ? ra * 1000 : this.backoff(attempt));
    }
    return last ?? { status: 0, headers: { get: () => null }, text: '' };
  }

  /** backoff mu voi full jitter: uniform(0, min(cap, base * 2^n)) */
  private backoff(attempt: number): number {
    const r = this.o.rng ? this.o.rng() : Math.random();
    return Math.floor(r * Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt));
  }

  async register(): Promise<boolean> {
    this.keys = await generateEd25519KeyPair();
    const res = await this.request('register', 'POST', '/v1/register', {
      pubkey: this.keys.publicKey,
      kind: this.o.kind ?? 'tv',
      model: 'SimTV-1',
      os: 'sim',
      app_version: '0.0.1-sim',
      region: this.o.region ?? 'HN',
    }, { signAs: 'register' });
    if (res.status !== 201 && res.status !== 200) {
      this.report.errors.push(`register ${res.status} ${res.text.slice(0, 120)}`);
      return false;
    }
    this.id = (JSON.parse(res.text) as { device_id: string }).device_id;
    this.report.deviceId = this.id;
    this.report.registered = true;
    return true;
  }

  async pair(): Promise<boolean> {
    const first = await this.request('pair', 'POST', '/v1/pair', {});
    if (first.status !== 200) return false;
    const j = JSON.parse(first.text) as { paired: boolean; code?: string };
    if (j.paired) return (this.report.paired = true);
    if (!this.o.confirmPairing || !j.code) return false;
    if (!(await this.o.confirmPairing(j.code))) return false;
    const again = await this.request('pair', 'POST', '/v1/pair', {});
    this.report.paired = again.status === 200 && (JSON.parse(again.text) as { paired: boolean }).paired === true;
    return this.report.paired;
  }

  /** @returns next_interval (giay) hoac null neu loi */
  async heartbeat(state = 1): Promise<{ next: number; etag: string; commands: DeviceCommandMsg[] } | null> {
    const body: Record<string, unknown> = { state: this.monitor ? 3 : state, app_ver: '0.0.1-sim', soc_temp: 45 + Math.floor(Math.random() * 20), rssi: -40 - Math.floor(Math.random() * 30), dl_mbps: 20, cache_used_mb: 300, cache_slots: 8 };
    if (this.pendingAck.length) body['cmd_ack'] = this.pendingAck.slice(0, 20);
    const res = await this.request('heartbeat', 'POST', '/v1/heartbeat', body);
    if (res.status !== 200) {
      this.report.errors.push(`heartbeat ${res.status}`);
      return null;
    }
    this.pendingAck = this.pendingAck.slice(20);
    const j = JSON.parse(res.text) as { next_interval: number; interval_base: number; manifest_etag: string; commands?: DeviceCommandMsg[] };
    this.report.heartbeats++;
    this.report.intervals.push({ base: j.interval_base, next: j.next_interval });
    const commands = j.commands ?? [];
    this.report.commandsReceived += commands.length;
    await this.handleCommands(commands);
    return { next: j.next_interval, etag: j.manifest_etag, commands };
  }

  /**
   * Xu ly lenh theo docs/DEVICE-PROTOCOL.md: thuc thi MOT LAN moi id (giao lai chi ack lai), `refresh_manifest` -> tai lai manifest,
   * `set_monitor` -> state 3, `reboot`/loai la -> chi ack. Ack qua endpoint (hoac heartbeat ke tiep neu ackMode='heartbeat').
   */
  private async handleCommands(cmds: DeviceCommandMsg[]): Promise<void> {
    if (cmds.length === 0) return;
    const acks: { id: string; status: 'ok' | 'failed'; result?: string }[] = [];
    for (const c of cmds) {
      const fail = this.o.failCommandTypes?.includes(c.type) ?? false;
      if (!this.doneCommands.has(c.id)) {
        this.doneCommands.add(c.id);
        if (!fail) {
          if (c.type === 'refresh_manifest') this.forceManifest = true;
          else if (c.type === 'set_monitor') this.monitor = c.args?.['on'] !== false;
        }
        this.report.commandsExecuted.push({ id: c.id, type: c.type, ...(c.args ? { args: c.args } : {}) });
        if (fail) this.report.commandsFailed++;
        else this.report.commandsAcked++;
      }
      acks.push(fail ? { id: c.id, status: 'failed', result: 'sim: khong ho tro' } : { id: c.id, status: 'ok' });
    }
    if ((this.o.ackMode ?? 'endpoint') === 'heartbeat') {
      for (const a of acks) if (a.status === 'ok' && !this.pendingAck.includes(a.id)) this.pendingAck.push(a.id);
      return;
    }
    for (let i = 0; i < acks.length; i += 20) {
      const res = await this.request('cmd_ack', 'POST', '/v1/commands/ack', { acks: acks.slice(i, i + 20) });
      if (res.status !== 200) this.report.errors.push(`cmd_ack ${res.status}`);
    }
  }

  /** Tai manifest neu etag doi (dung ?etag= de nhan 304). */
  async syncManifest(serverEtag?: string): Promise<void> {
    if (serverEtag && serverEtag === this.etag && !this.forceManifest) return;
    this.forceManifest = false;
    const res = await this.request('manifest', 'GET', this.etag ? `/v1/manifest?etag=${this.etag}` : '/v1/manifest');
    this.report.manifestFetches++;
    if (res.status === 304) {
      this.report.manifest304++;
      return;
    }
    if (res.status !== 200) {
      this.report.errors.push(`manifest ${res.status}`);
      return;
    }
    this.manifest = JSON.parse(res.text) as Manifest;
    this.etag = this.manifest.etag;
    this.report.creatives = this.manifest.creatives.length;
  }

  /** Mo phong phat quang cao: sinh `n` impression hop le tu manifest va gui theo lo <=50. */
  async playAndReport(n: number): Promise<void> {
    const m = this.manifest;
    if (!m || m.schedule.length === 0 || n <= 0) return;
    const events: Record<string, unknown>[] = [];
    for (let i = 0; i < n; i++) {
      const slot = m.schedule[i % m.schedule.length]!;
      const cr = m.creatives.find((c) => c.id === slot.creative_ids[0])!;
      const t = Date.now() - 2000 - i * 1000;
      events.push({ type: 'impression', event_id: uuidv7(t), ts: new Date(t).toISOString(), campaign_id: slot.campaign_id, creative_id: cr.id, slot_id: slot.slot_id, vcr_pct: 100, played_ms: (cr.duration_s ?? 15) * 1000 });
    }
    for (let i = 0; i < events.length; i += 50) {
      const batch = events.slice(i, i + 50);
      const res = await this.request('events', 'POST', '/v1/events', { events: batch });
      this.report.eventsSent += batch.length;
      if (res.status === 202) {
        const j = JSON.parse(res.text) as { accepted: number; valid: number };
        this.report.eventsAccepted += j.accepted;
        this.report.eventsValid += j.valid;
      } else this.report.errors.push(`events ${res.status}`);
    }
  }

  /** Luong day du: dang ky -> ghep doi -> N chu ky heartbeat (theo next_interval) -> manifest -> gui su kien. */
  async run(o: { cycles: number; eventsPerDevice: number }): Promise<DeviceReport> {
    if (!(await this.register())) return this.report;
    await this.pair();
    for (let c = 0; c < o.cycles; c++) {
      const hb = await this.heartbeat(1);
      if (hb) {
        await this.syncManifest(hb.etag);
        if (c === 0) await this.playAndReport(o.eventsPerDevice);
        await this.wait(hb.next * 1000);
      }
    }
    return this.report;
  }
}
