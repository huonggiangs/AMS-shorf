import type { Runtime } from '@ams/runtime';
import { signageModelClass } from '@ams/shared';
import { DEVICE_KV_TTL_S } from './heartbeat-ttl.js';

export interface DeviceRec {
  id: string;
  pubkey: string;
  trust: number;
  blocked: boolean;
  region: string | null;
  kind: string;
  model: string | null;
  userId: string | null;
  screenId: string | null;
  screenType: 'tv' | 'elevator' | 'led_p5';
  pxW: number | null;
  pxH: number | null;
  modelClass: string;
  /** do phan giai/huong thiet bi TU KHAI (device_profiles); pxW/pxH uu tien screens.px_* khi da gan man hinh */
  profPxW?: number | null;
  profPxH?: number | null;
  profOrientation?: string | null;
}

export function modelClassOf(r: { kind: string; screenType?: string | null; pxW?: number | null; pxH?: number | null }): { type: 'tv' | 'elevator' | 'led_p5'; cls: string } {
  const type = (r.screenType as 'tv' | 'elevator' | 'led_p5' | null) ?? (r.kind === 'elevator' ? 'elevator' : r.kind === 'led_p5' ? 'led_p5' : 'tv');
  if (type === 'tv') return { type, cls: 'tv' };
  return { type, cls: signageModelClass(type, r.pxW, r.pxH) };
}

interface Row {
  id: string;
  pubkey_ed25519: string | null;
  trust_level: number;
  blocked: number;
  region_id: string | null;
  kind: string;
  model: string | null;
  user_id: string | null;
  screen_id: string | null;
  screen_type: string | null;
  px_w: number | null;
  px_h: number | null;
  prof_px_w: number | null;
  prof_px_h: number | null;
  prof_orientation: string | null;
}

/**
 * Tra cuu thiet bi cho moi request da ky. Ba tang: bo nho (TTL ngan) -> kv `dev:<id>` (DEVICE_KV_TTL_S, dan xuat tu chu ky heartbeat) -> DB.
 * Chan/doi trust: ben ghi goi `invalidate(id)` (xoa kv) — cac instance khac thay doi trong toi da `memTtlMs`.
 */
export class DeviceDirectory {
  private mem = new Map<string, { at: number; rec: DeviceRec | null }>();
  constructor(
    private rt: Runtime,
    private memTtlMs = 30_000,
    private kvTtlSec = DEVICE_KV_TTL_S,
    private maxEntries = 50_000,
  ) {}

  async get(id: string): Promise<DeviceRec | null> {
    const now = this.rt.clock.now().getTime();
    const m = this.mem.get(id);
    if (m && now - m.at < (m.rec ? this.memTtlMs : 10_000)) return m.rec;
    let rec: DeviceRec | null = null;
    const cached = await this.rt.kv.get(`dev:${id}`);
    if (cached) {
      try {
        rec = JSON.parse(cached) as DeviceRec;
      } catch {
        rec = null;
      }
    }
    if (!rec) {
      rec = await this.load(id);
      if (rec) await this.rt.kv.set(`dev:${id}`, JSON.stringify(rec), this.kvTtlSec);
    }
    if (this.mem.size >= this.maxEntries) this.mem.clear();
    this.mem.set(id, { at: now, rec });
    return rec;
  }

  async invalidate(id: string): Promise<void> {
    this.mem.delete(id);
    await this.rt.kv.del(`dev:${id}`);
  }

  private async load(id: string): Promise<DeviceRec | null> {
    const rows = await this.rt.db.query<Row>(
      `SELECT d.id, d.pubkey_ed25519, d.trust_level, d.blocked, d.region_id, d.kind, d.model, d.user_id,
              s.id AS screen_id, s.type AS screen_type, s.px_w, s.px_h,
              p.px_w AS prof_px_w, p.px_h AS prof_px_h, p.orientation AS prof_orientation
         FROM devices d LEFT JOIN screens s ON s.device_id = d.id LEFT JOIN device_profiles p ON p.device_id = d.id WHERE d.id = ? ORDER BY s.id LIMIT 1`,
      [id],
    );
    const r = rows[0];
    if (!r || !r.pubkey_ed25519) return null;
    const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
    // man hinh da gan (do van hanh) uu tien; chua gan thi dung do phan giai thiet bi tu khai (Signage Player)
    const px = r.px_w && r.px_h ? { w: Number(r.px_w), h: Number(r.px_h) } : r.prof_px_w && r.prof_px_h ? { w: Number(r.prof_px_w), h: Number(r.prof_px_h) } : null;
    const mc = modelClassOf({ kind: r.kind, screenType: r.screen_type, pxW: px?.w ?? null, pxH: px?.h ?? null });
    return {
      id: r.id,
      pubkey: r.pubkey_ed25519,
      trust: Number(r.trust_level),
      blocked: Number(r.blocked) === 1,
      region: r.region_id,
      kind: r.kind,
      model: r.model,
      userId: r.user_id,
      screenId: r.screen_id,
      screenType: mc.type,
      pxW: px?.w ?? null,
      pxH: px?.h ?? null,
      modelClass: mc.cls,
      profPxW: num(r.prof_px_w),
      profPxH: num(r.prof_px_h),
      profOrientation: r.prof_orientation ?? null,
    };
  }
}
