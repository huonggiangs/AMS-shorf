import type { Runtime } from '@ams/runtime';
import { JITTER } from './protocol.js';
import type { Rng } from './util.js';

/** Do tai: 0 = ranh, 1 = dung cong suat, >1 = qua tai. Test ghi de bang ham co dinh. */
export type LoadFn = () => number;

/** Dem request theo giay (cua so truot 5 giay) so voi cong suat du kien cua instance. */
export class RpsLoad {
  private buckets = new Map<number, number>();
  constructor(
    private rt: Runtime,
    public capacityRps: number,
  ) {}
  hit(): void {
    const s = Math.floor(this.rt.clock.now().getTime() / 1000);
    this.buckets.set(s, (this.buckets.get(s) ?? 0) + 1);
    if (this.buckets.size > 16) for (const k of this.buckets.keys()) if (k < s - 10) this.buckets.delete(k);
  }
  factor = (): number => {
    if (this.capacityRps <= 0) return 0;
    const s = Math.floor(this.rt.clock.now().getTime() / 1000);
    let n = 0;
    for (let i = 1; i <= 5; i++) n += this.buckets.get(s - i) ?? 0;
    return n / 5 / this.capacityRps;
  };
}

/** Cong tac dieu khien tu may chu (kv `ctl:gateway`), doc qua bo nho dem 10 giay. */
export interface Ctl {
  shed?: boolean; // tu choi heartbeat/manifest voi 503 + Retry-After
  shed_events?: boolean;
  interval_override_s?: number; // ep chu ky co so (truoc jitter)
  interval_multiplier?: number; // nhan chu ky co so (>=1 de giam tai)
  monitored?: string[]; // thiet bi giam sat truc tiep (chu ky ngan)
  min_app_version?: string;
}

export class CtlCache {
  private at = 0;
  private val: Ctl = {};
  constructor(private rt: Runtime, private ttlMs = 10_000) {}
  async get(): Promise<Ctl> {
    const now = this.rt.clock.now().getTime();
    if (now - this.at < this.ttlMs) return this.val;
    this.at = now;
    try {
      const raw = await this.rt.kv.get('ctl:gateway');
      this.val = raw ? (JSON.parse(raw) as Ctl) : {};
    } catch {
      this.val = {};
    }
    return this.val;
  }
}

export interface IntervalCfg {
  playingS: number;
  idleS: number;
  errorS: number;
  monitoredS: number;
}

export const DEFAULT_INTERVALS: IntervalCfg = { playingS: 300, idleS: 600, errorS: 120, monitoredS: 15 };

/** Chu ky co so theo trang thai + tai + cong tac; sau do jitter +-20% (so voi co so). */
export function computeInterval(state: number, monitored: boolean, load: number, ctl: Ctl, cfg: IntervalCfg, rng: Rng): { base: number; next: number } {
  let base = monitored || state === 3 ? cfg.monitoredS : state === 1 ? cfg.playingS : state === 2 ? cfg.errorS : cfg.idleS;
  if (ctl.interval_override_s && ctl.interval_override_s > 0) base = ctl.interval_override_s;
  // tu 70% cong suat tro len keo gian chu ky: 100% => x2,2 ; toi da x4
  const mult = (load < 0.7 ? 1 : Math.min(4, 1 + (load - 0.7) * 4)) * Math.max(1, ctl.interval_multiplier ?? 1);
  const b = Math.max(1, Math.round(base * mult));
  const lo = Math.max(1, Math.ceil(b * (1 - JITTER) - 1e-9));
  const hi = Math.max(lo, Math.floor(b * (1 + JITTER) + 1e-9));
  const next = Math.min(hi, Math.max(lo, Math.round(b * (1 + (rng() * 2 - 1) * JITTER))));
  return { base: b, next };
}

/** Retry-After (giay, so nguyen) co jitter +-20% quanh `base`. */
export function retryAfter(base: number, rng: Rng): number {
  return Math.max(1, Math.round(base * (1 + (rng() * 2 - 1) * JITTER)));
}
