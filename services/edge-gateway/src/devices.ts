import type { Runtime } from '@ams/runtime';
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
}

export function modelClassOf(r: { kind: string; screenType?: string | null; pxW?: number | null; pxH?: number | null }): { type: 'tv' | 'elevator' | 'led_p5'; cls: string } {
  const type = (r.screenType as 'tv' | 'elevator' | 'led_p5' | null) ?? (r.kind === 'elevator' ? 'elevator' : r.kind === 'led_p5' ? 'led_p5' : 'tv');
  if (type === 'tv') return { type, cls: 'tv' };
  return { type, cls: r.pxW && r.pxH ? `${type}_${r.pxW}x${r.pxH}` : type };
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
              s.id AS screen_id, s.type AS screen_type, s.px_w, s.px_h
         FROM devices d LEFT JOIN screens s ON s.device_id = d.id WHERE d.id = ? LIMIT 1`,
      [id],
    );
    const r = rows[0];
    if (!r || !r.pubkey_ed25519) return null;
    const mc = modelClassOf({ kind: r.kind, screenType: r.screen_type, pxW: r.px_w, pxH: r.px_h });
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
      pxW: r.px_w === null ? null : Number(r.px_w),
      pxH: r.px_h === null ? null : Number(r.px_h),
      modelClass: mc.cls,
    };
  }
}
