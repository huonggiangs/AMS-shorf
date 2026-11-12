import type { Runtime } from '@ams/runtime';
import { sha256Hex } from '@ams/shared';
import { AD_FORMATS, MANIFEST_TZ, PROTOCOL_VERSION, type AdFormat, type Manifest, type ManifestCreative, type ManifestDelta, type ManifestSlot } from './protocol.js';
import type { DeviceRec } from './devices.js';

export interface GroupKey {
  region: string;
  daypart: string; // 'all' = moi khung gio trong mot manifest
  modelClass: string;
}

export const groupString = (g: GroupKey): string => `${g.region}.${g.daypart}.${g.modelClass}`;

export function parseGroup(s: string): GroupKey | null {
  const m = /^([A-Za-z0-9_-]{1,16})\.([a-z_]{1,16})\.([a-z0-9_x]{2,40})$/.exec(s);
  return m ? { region: m[1]!, daypart: m[2]!, modelClass: m[3]! } : null;
}

export function groupOfDevice(d: DeviceRec, daypart = 'all'): GroupKey {
  return { region: d.region || 'ALL', daypart, modelClass: d.modelClass };
}

/** loai man hinh + (voi thang may/LED) do phan giai tu modelClass */
function classType(cls: string): { type: string; px: { w: number; h: number } | null } {
  const m = /^(tv|elevator|led_p5)(?:_(\d+)x(\d+))?$/.exec(cls);
  if (!m) return { type: cls, px: null };
  return { type: m[1]!, px: m[2] ? { w: Number(m[2]), h: Number(m[3]) } : null };
}

interface CreativeRow {
  id: string;
  campaign_id: string;
  target_type: string | null;
  px_w: number | null;
  px_h: number | null;
  kind: string | null;
  storage_key: string | null;
  size_bytes: number | null;
  duration_s: number | null;
  sha256?: string | null;
}
interface SlotRow {
  campaign_id: string;
  start_at: string | null;
  end_at: string | null;
  slot_id: string;
  daypart: string | null;
  start_min: number | null;
  end_min: number | null;
  priority: number;
  reward_points: number;
  regions: string | null;
}

export interface ManifestOpts {
  mediaBaseUrl: string;
  ttlS: number; // TTL cache de xuat cho thiet bi/CDN
  buildTtlS: number; // sau bao lau dung lai moi xay lai tu DB
}

interface GroupRecord {
  etag: string;
  json: string;
  builtAt: number;
  prev: Record<string, string>; // creative_id -> campaign_id cua ban truoc (de nhan impression sat luc doi lich)
}

/** Tra cuu nhanh cho gateway: creative -> thong tin; gom ca creative cua ban ngay truoc. */
export interface ManifestView {
  etag: string;
  json: string;
  creative(id: string): { campaign_id: string; duration_s: number | null; current: boolean } | undefined;
  /** reward_points lon nhat cua chien dich (hoac cua slot neu co slot_id) */
  reward(campaignId: string, slotId?: string): number;
}

const memTtlMs = 15_000;

export class ManifestService {
  private mem = new Map<string, { at: number; rec: GroupRecord }>();
  private inflight = new Map<string, Promise<GroupRecord>>();
  private shaColumn: boolean | undefined;
  constructor(
    private rt: Runtime,
    private opts: ManifestOpts,
  ) {}

  /** Lay ban ghi manifest cua nhom (xay neu chua co / het han build-TTL). */
  async get(g: GroupKey): Promise<ManifestView> {
    const key = groupString(g);
    const now = this.rt.clock.now().getTime();
    const m = this.mem.get(key);
    let rec: GroupRecord | undefined;
    if (m && now - m.at < memTtlMs) rec = m.rec;
    if (!rec) {
      const raw = await this.rt.kv.get(`manifest:${key}`);
      if (raw) {
        try {
          const r = JSON.parse(raw) as GroupRecord;
          if (now - r.builtAt < this.opts.buildTtlS * 1000) rec = r;
        } catch {
          /* xay lai */
        }
      }
    }
    if (!rec) {
      let p = this.inflight.get(key);
      if (!p) {
        p = this.rebuild(g, key).finally(() => this.inflight.delete(key));
        this.inflight.set(key, p);
      }
      rec = await p;
    }
    this.mem.set(key, { at: now, rec });
    return this.view(rec);
  }

  private views = new Map<string, ManifestView>();
  private view(rec: GroupRecord): ManifestView {
    const k = rec.etag + ':' + rec.builtAt;
    let v = this.views.get(k);
    if (v) return v;
    const man = JSON.parse(rec.json) as Manifest;
    const cur = new Map(man.creatives.map((c) => [c.id, c]));
    v = {
      etag: rec.etag,
      json: rec.json,
      creative: (id) => {
        const c = cur.get(id);
        if (c) return { campaign_id: c.campaign_id, duration_s: c.duration_s, current: true };
        const pc = rec.prev[id];
        return pc ? { campaign_id: pc, duration_s: null, current: false } : undefined;
      },
      reward: (campaignId, slotId) => {
        let best = 0;
        for (const s of man.schedule) if (s.campaign_id === campaignId && (!slotId || s.slot_id === slotId)) best = Math.max(best, s.reward_points);
        return best;
      },
    };
    if (this.views.size > 2000) this.views.clear();
    this.views.set(k, v);
    return v;
  }

  /** Nhom da tung duoc xay (dung cho duong cong khai: khong cho ke la liet ke nhom bat ky). */
  async known(g: GroupKey): Promise<boolean> {
    const key = groupString(g);
    return this.mem.has(key) || (await this.rt.kv.get(`manifest:${key}`)) !== null;
  }

  /** Cap nhat nong: xoa cache nhom (API goi sau khi duyet/dung chien dich). */
  async invalidate(g?: GroupKey): Promise<void> {
    if (g) {
      this.mem.delete(groupString(g));
      await this.rt.kv.del(`manifest:${groupString(g)}`);
    } else this.mem.clear();
  }

  /** Delta so voi ban `baseEtag` neu con trong kv; null neu khong con ban do. */
  async delta(g: GroupKey, baseEtag: string, cur: { etag: string; json: string }): Promise<ManifestDelta | null> {
    if (!/^[0-9a-f]{16}$/.test(baseEtag)) return null;
    const raw = await this.rt.kv.get(`manifest:${groupString(g)}:${baseEtag}`);
    if (!raw) return null;
    const base = JSON.parse(raw) as Manifest;
    const now = JSON.parse(cur.json) as Manifest;
    const baseIds = new Set(base.creatives.map((c) => c.id));
    const nowIds = new Set(now.creatives.map((c) => c.id));
    return {
      version: PROTOCOL_VERSION,
      group: now.group,
      etag: now.etag,
      base_etag: baseEtag,
      generated_at: now.generated_at,
      ttl_s: now.ttl_s,
      creatives_added: now.creatives.filter((c) => !baseIds.has(c.id)),
      creatives_removed: base.creatives.filter((c) => !nowIds.has(c.id)).map((c) => c.id),
      schedule: now.schedule,
    };
  }

  private async rebuild(g: GroupKey, key: string): Promise<GroupRecord> {
    const prevRaw = await this.rt.kv.get(`manifest:${key}`);
    let prev: GroupRecord | null = null;
    if (prevRaw) {
      try {
        prev = JSON.parse(prevRaw) as GroupRecord;
      } catch {
        prev = null;
      }
    }
    const man = await this.build(g);
    const now = this.rt.clock.now().getTime();
    let prevMap: Record<string, string> = {};
    if (prev) {
      prevMap = prev.etag === man.etag ? prev.prev : Object.fromEntries((JSON.parse(prev.json) as Manifest).creatives.map((c) => [c.id, c.campaign_id]));
    }
    const rec: GroupRecord = { etag: man.etag, json: JSON.stringify(man), builtAt: now, prev: prevMap };
    await this.rt.kv.set(`manifest:${key}`, JSON.stringify(rec), 24 * 3600);
    // giu ban theo etag 1 gio de phuc vu delta
    await this.rt.kv.set(`manifest:${key}:${man.etag}`, rec.json, 3600);
    return rec;
  }

  async build(g: GroupKey): Promise<Manifest> {
    const now = this.rt.clock.now();
    const nowIso = now.toISOString();
    const { type, px } = classType(g.modelClass);
    const slotParams: unknown[] = [type];
    let daypartSql = '';
    if (g.daypart !== 'all') {
      daypartSql = ' AND s.daypart = ?';
      slotParams.push(g.daypart);
    }
    const slots = await this.rt.db.query<SlotRow>(
      `SELECT c.id AS campaign_id, c.start_at, c.end_at, s.id AS slot_id, s.daypart, s.start_min, s.end_min, s.priority, s.reward_points, s.regions
         FROM campaigns c JOIN schedule_slots s ON s.campaign_id = c.id
        WHERE c.state = 'active' AND s.target_type = ?${daypartSql}
        ORDER BY s.id`,
      slotParams,
    );
    const liveSlots = slots.filter((s) => {
      if (s.start_at && s.start_at > nowIso) return false;
      if (s.end_at && s.end_at < nowIso) return false;
      if (!s.regions) return true;
      try {
        const rs = JSON.parse(s.regions) as string[];
        return rs.length === 0 || g.region === 'ALL' || rs.includes(g.region);
      } catch {
        return true;
      }
    });
    const campaignIds = new Set(liveSlots.map((s) => s.campaign_id));

    const creativeRows = (await this.queryCreatives(type)).filter((r) => campaignIds.has(r.campaign_id));
    const creatives: ManifestCreative[] = [];
    for (const r of creativeRows) {
      if (px && (r.px_w !== px.w || r.px_h !== px.h)) continue; // thang may/LED khong tu co gian: dung do phan giai
      if (!r.storage_key) continue;
      const sha = await this.sha256Of(r);
      if (!sha) continue; // khong xac minh duoc tep => khong dua vao manifest
      const fmt = (AD_FORMATS as readonly string[]).includes(r.kind ?? '') ? (r.kind as AdFormat) : 'fullscreen';
      creatives.push({
        id: r.id,
        campaign_id: r.campaign_id,
        url: `${this.opts.mediaBaseUrl.replace(/\/+$/, '')}/${r.storage_key.split('/').map(encodeURIComponent).join('/')}`,
        sha256: sha,
        duration_s: r.duration_s === null ? null : Number(r.duration_s),
        px_w: r.px_w === null ? null : Number(r.px_w),
        px_h: r.px_h === null ? null : Number(r.px_h),
        format: fmt,
        media_type: r.kind === 'image' || /\.(png|jpe?g)$/i.test(r.storage_key) ? 'image' : 'video',
        size_bytes: r.size_bytes === null ? null : Number(r.size_bytes),
      });
    }
    creatives.sort((a, b) => (a.id < b.id ? -1 : 1));
    const byCampaign = new Map<string, string[]>();
    for (const c of creatives) byCampaign.set(c.campaign_id, [...(byCampaign.get(c.campaign_id) ?? []), c.id]);
    const schedule: ManifestSlot[] = [];
    for (const s of liveSlots) {
      const ids = byCampaign.get(s.campaign_id);
      if (!ids || ids.length === 0) continue; // chien dich chua co creative hop le cho nhom nay
      schedule.push({
        slot_id: s.slot_id,
        campaign_id: s.campaign_id,
        creative_ids: ids,
        daypart: s.daypart ?? 'all_day',
        start_min: Number(s.start_min ?? 0),
        end_min: Number(s.end_min ?? 1440),
        priority: Number(s.priority),
        reward_points: Number(s.reward_points),
      });
    }
    schedule.sort((a, b) => (a.slot_id < b.slot_id ? -1 : 1));
    const body = { version: PROTOCOL_VERSION, group: groupString(g), tz: MANIFEST_TZ, creatives, schedule };
    const etag = (await sha256Hex(JSON.stringify(body))).slice(0, 16);
    return { version: PROTOCOL_VERSION, group: body.group, tz: MANIFEST_TZ, etag, generated_at: nowIso, ttl_s: this.opts.ttlS, creatives, schedule };
  }

  private async queryCreatives(type: string): Promise<CreativeRow[]> {
    const base = `cr.id, cr.campaign_id, cr.target_type, cr.px_w, cr.px_h, cr.kind, cr.storage_key, cr.size_bytes, cr.duration_s`;
    const where = `FROM creatives cr JOIN campaigns c ON c.id = cr.campaign_id
        WHERE c.state = 'active' AND cr.target_type = ? AND cr.review_state = 'approved' AND cr.state = 'ready'
          AND cr.scan_state NOT IN ('infected','failed')`;
    if (this.shaColumn !== false) {
      try {
        const rows = await this.rt.db.query<CreativeRow>(`SELECT ${base}, cr.sha256 ${where}`, [type]);
        this.shaColumn = true;
        return rows;
      } catch {
        this.shaColumn = false; // chua co cot creatives.sha256 (xem requests): dung kv/doi tuong
      }
    }
    return this.rt.db.query<CreativeRow>(`SELECT ${base} ${where}`, [type]);
  }

  private async sha256Of(r: CreativeRow): Promise<string | null> {
    if (r.sha256) return r.sha256;
    const k = `creative:sha256:${r.id}`;
    const cached = await this.rt.kv.get(k);
    if (cached) return cached;
    const obj = await this.rt.objects.get(r.storage_key!);
    if (!obj) return null;
    const h = await sha256Hex(obj);
    await this.rt.kv.set(k, h);
    return h;
  }
}
