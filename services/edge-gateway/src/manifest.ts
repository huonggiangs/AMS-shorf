import type { Runtime } from '@ams/runtime';
import { ANY, MANIFEST_EPOCH_KEY, elevatorTierFor, isElevatorResolution, SIGNAGE_CONFIG_KEY, SIGNAGE_DEFAULT, isAdFormat, isSignageKind, parseOverlay, parseSignageConfig, pickSnapshotPrice, sha256Hex, type PriceSource, type PricingDaypart, type SignageKindConfig } from '@ams/shared';
import { MANIFEST_TZ, PROTOCOL_VERSION, type Manifest, type ManifestCreative, type ManifestDelta, type ManifestLayout, type ManifestSlot, type ManifestZone } from './protocol.js';
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
  format?: string | null;
  overlay?: string | null;
  customer_id?: string | null;
  scan_state?: string | null;
  /** creative_security.content_version hien tai (khong co dong = 1) */
  content_version?: number | null;
  /** creative_kid_review (0015): xac nhan kid_safe cua nguoi duyet va phien ban noi dung luc xac nhan */
  kr_kid?: number | null;
  kr_version?: number | null;
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
  /** schedule_slot_text (0017): NULL = khong ghi de */
  slot_header: string | null;
  slot_footer: string | null;
}

/** Gan tep (da loc hop le, giu thu tu) vao vung media; tep chua gan vung roi vao vung media dau tien. */
function programLayout(layout: { orientation: 'landscape' | 'portrait'; zones: ManifestZone[] }, itemZones: Record<string, string>, ids: string[]): ManifestLayout {
  const media = layout.zones.filter((z) => z.type === 'video' || z.type === 'image');
  const first = media[0]?.id;
  const known = new Set(media.map((z) => z.id));
  return {
    orientation: layout.orientation,
    zones: layout.zones.map((z) => {
      if (z.type !== 'video' && z.type !== 'image') return z;
      const creative_ids = ids.filter((id) => (known.has(itemZones[id] ?? '') ? itemZones[id] : first) === z.id);
      return { ...z, creative_ids };
    }),
  };
}

interface LiveProgram {
  id: string;
  start_min: number;
  end_min: number;
  priority: number;
  header: string | null;
  footer: string | null;
  items: string[];
  /** bo cuc da vung (0021) + tep theo vung; khong co = man don */
  layout: { orientation: 'landscape' | 'portrait'; zones: ManifestZone[] } | null;
  itemZones: Record<string, string>;
}

export interface ManifestOpts {
  mediaBaseUrl: string;
  ttlS: number; // TTL cache de xuat cho thiet bi/CDN
  buildTtlS: number; // sau bao lau dung lai moi xay lai tu DB
  /** bo nho dem moi instance (giay) truoc khi hoi lai kv/epoch; mac dinh 15. Thap hon = API doi chien dich co hieu luc nhanh hon. */
  memTtlS?: number;
}

interface GroupRecord {
  etag: string;
  json: string;
  builtAt: number;
  /** gia tri kv `manifest:epoch` luc xay; API tang epoch khi doi chien dich/creative => moi ban cu bi bo */
  epoch?: string;
  prev: Record<string, string>; // creative_id -> campaign_id cua ban truoc (de nhan impression sat luc doi lich)
  /** gia chot theo chien dich (p1-pricing): gateway tinh tien impression theo day, khong theo bang gia hien hanh */
  prices?: CampaignPriceMap;
  /** gia cua cac chien dich vua roi khoi manifest (impression den tre van duoc tinh dung gia) */
  prevPrices?: CampaignPriceMap;
}

/** Gia chot cua chien dich (campaign_prices) da loc theo loai man + khu vuc cua nhom; CHI o phia may chu, KHONG gui xuong thiet bi (khong nam trong manifest JSON/etag). */
export interface PriceRowLite {
  screen_type: string;
  region_id: string;
  daypart: PricingDaypart;
  unit_price_micro_vnd: number;
  floor_micro_vnd: number;
  source: PriceSource;
  source_ref: string | null;
}
export type CampaignPriceMap = Record<string, PriceRowLite[]>;

/** Thu thap tinh trang suy giam trong mot lan xay (loi TAM THOI cua kv/objects, khac voi 'khong co'). */
interface BuildCtx {
  degraded: string[];
  prices?: CampaignPriceMap;
}

/** Tra cuu nhanh cho gateway: creative -> thong tin; gom ca creative cua ban ngay truoc. */
export interface ManifestView {
  etag: string;
  json: string;
  creative(id: string): { campaign_id: string; duration_s: number | null; current: boolean } | undefined;
  /** reward_points lon nhat cua chien dich (hoac cua slot neu co slot_id) */
  reward(campaignId: string, slotId?: string): number;
  /** gia chot cua chien dich cho (khu vuc, khung gio); undefined = chien dich khong co gia chot trong ban nay */
  price(campaignId: string, region: string, daypart: string): PriceRowLite | undefined;
}

const memTtlMs = 15_000;
/** kv do API tang (`bumpManifestEpoch`) de bat moi instance gateway xay lai manifest (toi da memTtlMs sau). */
export const EPOCH_KEY = MANIFEST_EPOCH_KEY;

export class ManifestService {
  private mem = new Map<string, { at: number; rec: GroupRecord }>();
  private inflight = new Map<string, Promise<GroupRecord>>();
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
    if (m && now - m.at < (this.opts.memTtlS ?? memTtlMs / 1000) * 1000) rec = m.rec;
    if (!rec) {
      const epoch = (await this.rt.kv.get(EPOCH_KEY)) ?? '0';
      const raw = await this.rt.kv.get(`manifest:${key}`);
      if (raw) {
        try {
          const r = JSON.parse(raw) as GroupRecord;
          if (now - r.builtAt < this.opts.buildTtlS * 1000 && (r.epoch ?? '0') === epoch) rec = r;
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
    // CHI ghi bo nho khi vua nap tu kv/DB: ghi ca khi trung bo nho thi cua so truot mai mai (manifest cua nhom dong khach khong bao gio lam moi)
    if (!m || m.rec !== rec) this.mem.set(key, { at: now, rec });
    return this.view(rec);
  }

  /** cau hinh Signage theo loai man, bo nho dem ngan (heartbeat can hotline/cap nhat app ma khong hoi DB moi lan) */
  private signageMem: { at: number; cfg: Record<'elevator' | 'led_p5', SignageKindConfig> } | null = null;

  /** Cau hinh Signage Player cua mot loai man ('tv' => mac dinh rong: TV khong dung). Doc settings.signage_config (loi doc thi nem de caller xu ly). */
  async signage(type: string, fresh = false): Promise<SignageKindConfig> {
    if (!isSignageKind(type)) return { ...SIGNAGE_DEFAULT };
    const now = this.rt.clock.now().getTime();
    if (fresh || !this.signageMem || now - this.signageMem.at >= (this.opts.memTtlS ?? memTtlMs / 1000) * 1000) {
      const r = (await this.rt.db.query<{ value: string }>('SELECT value FROM settings WHERE key = ?', [SIGNAGE_CONFIG_KEY]))[0];
      this.signageMem = { at: now, cfg: parseSignageConfig(r?.value) };
    }
    return this.signageMem.cfg[type];
  }

  private views = new Map<string, ManifestView>();
  private view(rec: GroupRecord): ManifestView {
    const k = rec.etag + ':' + rec.builtAt;
    let v = this.views.get(k);
    if (v) return v;
    const man = JSON.parse(rec.json) as Manifest;
    const groupType = classType(parseGroup(man.group)?.modelClass ?? '').type;
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
      price: (campaignId, region, daypart) => {
        const rows = rec.prices?.[campaignId] ?? rec.prevPrices?.[campaignId];
        return rows ? pickSnapshotPrice(rows, { screenType: groupType, region: region || ANY, daypart }) : undefined;
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
    this.signageMem = null;
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
    const baseById = new Map(base.creatives.map((c) => [c.id, JSON.stringify(c)]));
    const nowIds = new Set(now.creatives.map((c) => c.id));
    // creative co CUNG id nhung noi dung khac (vd doi `fit`/thoi luong): gui lai day du (them vao added; id cung nam trong removed de client thay the, khong nhan doi)
    const changed = now.creatives.filter((c) => baseById.has(c.id) && baseById.get(c.id) !== JSON.stringify(c));
    return {
      version: PROTOCOL_VERSION,
      group: now.group,
      etag: now.etag,
      base_etag: baseEtag,
      generated_at: now.generated_at,
      ttl_s: now.ttl_s,
      creatives_added: now.creatives.filter((c) => !baseById.has(c.id) || baseById.get(c.id) !== JSON.stringify(c)),
      creatives_removed: [...base.creatives.filter((c) => !nowIds.has(c.id)).map((c) => c.id), ...changed.map((c) => c.id)],
      schedule: now.schedule,
      ...(now.rotation ? { rotation: now.rotation } : {}),
      ...(now.header !== undefined ? { header: now.header } : {}),
      ...(now.footer !== undefined ? { footer: now.footer } : {}),
      ...(now.hotline !== undefined ? { hotline: now.hotline } : {}),
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
    const epoch = (await this.rt.kv.get(EPOCH_KEY)) ?? '0'; // doc TRUOC khi xay: doi giua chung thi ban nay bi coi la cu o lan sau
    const ctx: BuildCtx = { degraded: [] };
    let man: Manifest;
    try {
      man = await this.buildWith(g, ctx);
    } catch (e) {
      // DB/ha tang loi luc xay: dung ban cu (neu co) thay vi tra 5xx hang loat; khong co ban cu thi nem loi (gateway tra 5xx, thiet bi giu ban dang co)
      console.error(`[manifest] xay ${key} that bai: ${(e as Error).message}`);
      if (prev) return prev;
      throw e;
    }
    const now = this.rt.clock.now().getTime();
    let prevMap: Record<string, string> = {};
    if (prev) {
      prevMap = prev.etag === man.etag ? prev.prev : Object.fromEntries((JSON.parse(prev.json) as Manifest).creatives.map((c) => [c.id, c.campaign_id]));
    }
    const prices = ctx.prices ?? {};
    const carried: CampaignPriceMap = {};
    if (prev) {
      const old = { ...(prev.prevPrices ?? {}), ...(prev.prices ?? {}) };
      for (const cid of new Set(Object.values(prevMap))) if (!(cid in prices) && old[cid]) carried[cid] = old[cid]!;
    }
    const rec: GroupRecord = { etag: man.etag, json: JSON.stringify(man), builtAt: now, epoch, prev: prevMap, prices, prevPrices: carried };
    if (ctx.degraded.length) {
      // mot so creative khong xac minh duoc vi loi tam thoi: tuyet doi khong cache ban thieu. Co ban cu thi dung ban cu.
      console.error(`[manifest] ban suy giam ${key} (${ctx.degraded.length} creative: ${ctx.degraded.slice(0, 5).join(',')}): khong cache`);
      if (prev) return prev;
      throw new Error(`manifest ${key} suy giam va khong co ban cu`); // 5xx: thiet bi giu manifest dang co, khong nhan manifest thieu

    }
    await this.rt.kv.set(`manifest:${key}`, JSON.stringify(rec), 24 * 3600);
    // giu ban theo etag 1 gio de phuc vu delta
    await this.rt.kv.set(`manifest:${key}:${man.etag}`, rec.json, 3600);
    return rec;
  }

  async build(g: GroupKey): Promise<Manifest> {
    return this.buildWith(g, { degraded: [] });
  }

  private async buildWith(g: GroupKey, ctx: BuildCtx): Promise<Manifest> {
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
      `SELECT c.id AS campaign_id, c.start_at, c.end_at, s.id AS slot_id, s.daypart, s.start_min, s.end_min, s.priority, s.reward_points, s.regions,
              t.header AS slot_header, t.footer AS slot_footer
         FROM campaigns c JOIN schedule_slots s ON s.campaign_id = c.id LEFT JOIN schedule_slot_text t ON t.slot_id = s.id
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

    // Signage Player (thang may/LED): cau hinh chung theo loai man. TV khong nhan cac truong nay (giu nguyen hop dong TV).
    const signage = type === 'tv' ? null : await this.signage(type, true); // doc moi tu DB: ban dung ra duoc cache toi buildTtlS, khong duoc dung cau hinh cu
    const programs = await this.livePrograms(type, g, now);
    const programIds = new Set(programs.map((p) => `bp_${p.id}`));
    const creativeRows = [
      ...(await this.queryCreatives(type)).filter((r) => campaignIds.has(r.campaign_id)),
      // chuong trinh phat song noi bo: tep trong kho (chua gan chien dich), campaign_id = 'bp_<id>' (khong co gia chot => khong tinh tien)
      ...(programs.length ? (await this.queryProgramCreatives(type)).filter((r) => programIds.has(r.campaign_id)) : []),
    ];
    const seenCreative = new Set<string>();
    const lockAllowed = await this.lockAdsEnabled();
    const creatives: ManifestCreative[] = [];
    // Thang may co nhom theo bac (elevator_<w>x<h>): moi chien dich chi giu creative o bac CAO NHAT khong vuot bac cua thiet bi
    // (bang hoac thap hon gan nhat; khong bao gio day 4K cho man HD). Nhom `elevator` (chua khai px) nhan moi creative thang may HD-4K.
    const elevatorBest = new Map<string, number>();
    if (type === 'elevator' && px) {
      for (const r of creativeRows) {
        if (!r.px_w || !r.px_h || !isElevatorResolution(Number(r.px_w), Number(r.px_h))) continue;
        const tw = elevatorTierFor(Number(r.px_w), Number(r.px_h)).w;
        if (tw <= px.w && tw > (elevatorBest.get(r.campaign_id) ?? 0)) elevatorBest.set(r.campaign_id, tw);
      }
    }
    for (const r of creativeRows) {
      if (seenCreative.has(r.id)) continue; // cung tep o nhieu chuong trinh: chi dua vao manifest mot lan
      if (type === 'elevator') {
        const known = !!r.px_w && !!r.px_h;
        if (known && !isElevatorResolution(Number(r.px_w), Number(r.px_h))) continue; // chi creative doc 9:16 HD-4K
        if (px && !known) continue; // nhom theo do phan giai: creative chua biet kich thuoc thi khong dua vao
        if (px && elevatorTierFor(Number(r.px_w), Number(r.px_h)).w !== elevatorBest.get(r.campaign_id)) continue;
      } else if (px && (r.px_w !== px.w || r.px_h !== px.h)) continue; // LED khong tu co gian: dung do phan giai
      if (!r.storage_key) continue;
      // uu tien ban chuyen ma; tep goc chi duoc phat khi da quet sach (hoac quan tri cho phep tep chua quet)
      const rend = await this.renditionOf(r, ctx);
      let sha: string | null;
      let key = r.storage_key;
      let sizeBytes = r.size_bytes;
      let isImage = r.kind === 'image' || /\.(png|jpe?g)$/i.test(r.storage_key);
      if (rend) {
        sha = rend.sha256;
        key = rend.key;
        sizeBytes = rend.size ?? r.size_bytes;
        isImage = rend.content_type.startsWith('image/') || (!rend.content_type && isImage);
      } else if (this.rt.config.env['MANIFEST_REQUIRE_RENDITION'] === '1') {
        continue; // bucket chi mo prefix renditions/: tep goc khong tai duoc
      } else {
        try {
          sha = await this.sha256Of(r);
        } catch (e) {
          console.error(`[manifest] bo qua creative ${r.id}: khong tinh duoc sha256: ${(e as Error).message}`);
          ctx.degraded.push(r.id); // loi tam thoi (khac 'tep khong ton tai' => null): khong duoc cache ban thieu nay
          sha = null;
        }
      }
      if (!sha) continue; // khong xac minh duoc tep => khong dua vao manifest
      const fmt = isAdFormat(r.format) ? r.format : isAdFormat(r.kind) ? r.kind : 'fullscreen';
      const { ov, drop } = parseOverlayJson(r.overlay, lockAllowed, Number(r.kr_kid ?? 0) === 1 && r.kr_version != null && Number(r.kr_version) === Number(r.content_version ?? 1));
      if (drop) continue; // creative chi-man-khoa khi man khoa/tre em chua duoc bat (hoac khong kid_safe): khong phat o man thuong
      seenCreative.add(r.id);
      creatives.push({
        id: r.id,
        campaign_id: r.campaign_id,
        url: `${this.opts.mediaBaseUrl.replace(/\/+$/, '')}/${key.split('/').map(encodeURIComponent).join('/')}`,
        sha256: sha,
        // anh tinh tren thang may/LED: duration_s LUON co (mac dinh cau hinh, 10 giay); TV giu `null` nhu cu
        duration_s: r.duration_s === null || r.duration_s === undefined ? (signage && isImage ? signage.image_duration_s : null) : Number(r.duration_s),
        px_w: r.px_w === null ? null : Number(r.px_w),
        px_h: r.px_h === null ? null : Number(r.px_h),
        format: fmt,
        ...(ov ? { overlay: ov } : {}),
        media_type: isImage ? 'image' : 'video',
        size_bytes: sizeBytes === null ? null : Number(sizeBytes),
        ...(signage ? { fit: signage.fit } : {}),
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
        ...(signage && s.slot_header !== null && s.slot_header !== undefined ? { header: s.slot_header } : {}),
        ...(signage && s.slot_footer !== null && s.slot_footer !== undefined ? { footer: s.slot_footer } : {}),
      });
    }
    for (const p of programs) {
      const ids = p.items.filter((id) => seenCreative.has(id));
      if (ids.length === 0) continue; // chuong trinh chua co tep hop le cho nhom nay
      schedule.push({
        slot_id: `bp_${p.id}`,
        campaign_id: `bp_${p.id}`,
        creative_ids: ids,
        daypart: 'custom',
        start_min: Number(p.start_min),
        end_min: Number(p.end_min),
        priority: Number(p.priority),
        reward_points: 0,
        ...(signage && p.header !== null ? { header: p.header } : {}),
        ...(signage && p.footer !== null ? { footer: p.footer } : {}),
        ...(p.layout ? { layout: programLayout(p.layout, p.itemZones, ids) } : {}),
      });
    }
    schedule.sort((a, b) => (a.slot_id < b.slot_id ? -1 : 1));
    ctx.prices = await this.loadPrices(type, g.region, schedule.map((s) => s.campaign_id));
    // thang may/LED: header/footer/hotline cap manifest + quy tac xoay vong (DEVICE-PROTOCOL 7.5). Nam trong etag nen doi cau hinh => thiet bi tai lai manifest.
    const extra = signage ? { header: signage.header, footer: signage.footer, hotline: signage.hotline, rotation: { mode: 'sequential' as const } } : {};
    const body = { version: PROTOCOL_VERSION, group: groupString(g), tz: MANIFEST_TZ, creatives, schedule, ...extra };
    const etag = (await sha256Hex(JSON.stringify(body))).slice(0, 16);
    return { version: PROTOCOL_VERSION, group: body.group, tz: MANIFEST_TZ, etag, generated_at: nowIso, ttl_s: this.opts.ttlS, creatives, schedule, ...extra };
  }

  /** Gia chot (campaign_prices) cua cac chien dich trong ban: chi dong cua loai man cua nhom, khu vuc '*' hoac khu vuc cua nhom. Loi DB noi len (rebuild dung ban cu). */
  private async loadPrices(type: string, region: string, campaignIds: string[]): Promise<CampaignPriceMap> {
    const out: CampaignPriceMap = {};
    const want = new Set(campaignIds);
    if (want.size === 0) return out;
    const rows = await this.rt.db.query<{ campaign_id: string; screen_type: string; region_id: string; daypart: string; unit_price_micro_vnd: unknown; floor_micro_vnd: unknown; source: string; source_ref: string | null }>(
      `SELECT p.campaign_id, p.screen_type, p.region_id, p.daypart, p.unit_price_micro_vnd, p.floor_micro_vnd, p.source, p.source_ref
         FROM campaign_prices p JOIN campaigns c ON c.id = p.campaign_id WHERE c.state = 'active' AND p.screen_type = ?`,
      [type],
    );
    for (const r of rows) {
      if (!want.has(r.campaign_id)) continue;
      if (r.region_id !== ANY && r.region_id !== region) continue;
      (out[r.campaign_id] ??= []).push({
        screen_type: r.screen_type,
        region_id: r.region_id,
        daypart: r.daypart as PricingDaypart,
        unit_price_micro_vnd: Number(r.unit_price_micro_vnd),
        floor_micro_vnd: Number(r.floor_micro_vnd),
        source: r.source as PriceSource,
        source_ref: r.source_ref,
      });
    }
    return out;
  }

  /** man khoa/tre em (p2): mac dinh TAT; bat bang settings.tv_experience.lock_ads_enabled === true. Loi DB khong duoc nuot (tra false se am tham go lock). */
  private async lockAdsEnabled(): Promise<boolean> {
    const r = (await this.rt.db.query<{ value: string }>("SELECT value FROM settings WHERE key = 'tv_experience'"))[0];
    if (!r) return false;
    try {
      return (JSON.parse(r.value) as { lock_ads_enabled?: unknown }).lock_ads_enabled === true;
    } catch {
      return false;
    }
  }

  /** Ban chuyen ma (media-worker ghi `renditions/<customer>/<id>/manifest.json`); null neu chua co. */
  private async renditionOf(r: CreativeRow & { customer_id?: string | null }, ctx: BuildCtx): Promise<{ key: string; sha256: string; size: number | null; content_type: string } | null> {
    if (!r.customer_id) return null;
    const k = `creative:rendition:${r.id}`;
    let raw: string | null = null;
    try {
      raw = await this.rt.kv.get(k);
    } catch {
      raw = null; // kv hong = cache miss: doc thang tu objects
    }
    if (raw === null) {
      let failed = false;
      const obj = await this.rt.objects.get(`renditions/${r.customer_id}/${r.id}/manifest.json`).catch(() => {
        failed = true;
        return null;
      });
      if (failed) {
        // loi tam thoi cua objects: KHONG cache 'none' (khong luu am tinh), roi ve tep goc (chi khi da quet sach) va danh dau suy giam
        ctx.degraded.push(r.id);
        return null;
      }
      raw = obj ? new TextDecoder().decode(obj) : 'none';
      try {
        await this.rt.kv.set(k, raw.length > 20_000 ? 'none' : raw, raw === 'none' ? 300 : 3600);
      } catch {
        /* cache hong: khong sao */
      }
    }
    if (raw === 'none') return null;
    try {
      const m = JSON.parse(raw) as { renditions?: { key?: string; sha256?: string; size?: number; content_type?: string }[] };
      const x = (m.renditions ?? []).find((e) => typeof e.key === 'string' && typeof e.sha256 === 'string' && e.key.startsWith(`renditions/${r.customer_id}/${r.id}/`));
      return x ? { key: x.key!, sha256: x.sha256!, size: typeof x.size === 'number' ? x.size : null, content_type: x.content_type ?? '' } : null;
    } catch {
      return null;
    }
  }

  /** Chuong trinh phat song noi bo dang xuat ban, con hieu luc (ngay Viet Nam), dung loai man + khu vuc cua nhom; kem danh sach tep theo thu tu. */
  private async livePrograms(type: string, g: GroupKey, now: Date): Promise<LiveProgram[]> {
    if (g.daypart !== 'all') return []; // lich noi bo la 'custom', khong thuoc khung gio dat san
    const today = new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
    const rows = await this.rt.db.query<{ id: string; regions: string | null; start_date: string | null; end_date: string | null; start_min: number; end_min: number; priority: number; header: string | null; footer: string | null }>(
      "SELECT id, regions, start_date, end_date, start_min, end_min, priority, header, footer FROM broadcast_programs WHERE status = 'published' AND target_type = ? ORDER BY id",
      [type],
    );
    const out: LiveProgram[] = [];
    for (const r of rows) {
      if (r.start_date && r.start_date > today) continue;
      if (r.end_date && r.end_date < today) continue;
      try {
        const rs = JSON.parse(r.regions ?? '[]') as string[];
        if (rs.length > 0 && g.region !== 'ALL' && !rs.includes(g.region)) continue;
      } catch {
        /* regions hong: coi nhu moi khu vuc */
      }
      const items = await this.rt.db.query<{ creative_id: string }>('SELECT creative_id FROM broadcast_program_items WHERE program_id = ? ORDER BY position, creative_id', [r.id]);
      const lay = (await this.rt.db.query<{ orientation: string; zones: string | null }>('SELECT orientation, zones FROM broadcast_program_layouts WHERE program_id = ?', [r.id]))[0];
      let layout: LiveProgram['layout'] = null;
      if (lay) {
        try {
          const zones = JSON.parse(lay.zones ?? '[]') as ManifestZone[];
          if (Array.isArray(zones) && zones.length > 0) layout = { orientation: lay.orientation === 'portrait' ? 'portrait' : 'landscape', zones };
        } catch {
          /* bo cuc hong: phat man don */
        }
      }
      const zr = layout ? await this.rt.db.query<{ creative_id: string; zone_id: string }>('SELECT creative_id, zone_id FROM broadcast_item_zones WHERE program_id = ?', [r.id]) : [];
      out.push({ ...r, items: items.map((i) => i.creative_id), layout, itemZones: Object.fromEntries(zr.map((z) => [z.creative_id, z.zone_id])) });
    }
    return out;
  }

  /** Tep cua cac chuong trinh noi bo: da duyet + san sang, chua gan chien dich; campaign_id tra ve = 'bp_<program_id>'. */
  private async queryProgramCreatives(type: string): Promise<CreativeRow[]> {
    return this.rt.db.query<CreativeRow>(
      `SELECT cr.id, 'bp_' || bp.id AS campaign_id, cr.target_type, cr.px_w, cr.px_h, cr.kind, cr.storage_key, cr.size_bytes, cr.duration_s, cr.sha256, cr.format, cr.overlay, cr.customer_id, cr.scan_state,
              COALESCE(cs.content_version, 1) AS content_version, kr.kid_safe AS kr_kid, kr.content_version AS kr_version
         FROM broadcast_programs bp JOIN broadcast_program_items i ON i.program_id = bp.id JOIN creatives cr ON cr.id = i.creative_id
         LEFT JOIN creative_security cs ON cs.creative_id = cr.id LEFT JOIN creative_kid_review kr ON kr.creative_id = cr.id
        WHERE bp.status = 'published' AND bp.target_type = ? AND cr.campaign_id IS NULL AND cr.review_state = 'approved' AND cr.state = 'ready'
          AND cr.scan_state NOT IN ('infected','failed','needs_manual_review','pending')
          AND NOT (cs.approved_version IS NOT NULL AND cs.approved_version <> cs.content_version)`,
      [type],
    );
  }

  private async queryCreatives(type: string): Promise<CreativeRow[]> {
    return this.rt.db.query<CreativeRow>(
      `SELECT cr.id, cr.campaign_id, cr.target_type, cr.px_w, cr.px_h, cr.kind, cr.storage_key, cr.size_bytes, cr.duration_s, cr.sha256, cr.format, cr.overlay, cr.customer_id, cr.scan_state,
              COALESCE(cs.content_version, 1) AS content_version, kr.kid_safe AS kr_kid, kr.content_version AS kr_version
         FROM creatives cr JOIN campaigns c ON c.id = cr.campaign_id LEFT JOIN creative_security cs ON cs.creative_id = cr.id LEFT JOIN creative_kid_review kr ON kr.creative_id = cr.id
        WHERE c.state = 'active' AND cr.target_type = ? AND cr.review_state = 'approved' AND cr.state = 'ready'
          AND NOT (cs.approved_version IS NOT NULL AND cs.approved_version <> cs.content_version)
          AND cr.scan_state NOT IN ('infected','failed','needs_manual_review','pending')`,
      [type],
    );
  }

  private async sha256Of(r: CreativeRow): Promise<string | null> {
    if (r.sha256) return r.sha256;
    const k = `creative:sha256:${r.id}`;
    let cached: string | null = null;
    try {
      cached = await this.rt.kv.get(k);
    } catch {
      cached = null; // kv hong = cache miss: tinh lai tu tep, khong go creative
    }
    if (cached) return cached;
    const obj = await this.rt.objects.get(r.storage_key!); // loi objects: nem (rebuild danh dau suy giam, khong cache)
    if (!obj) return null;
    const h = await sha256Hex(obj);
    try {
      await this.rt.kv.set(k, h);
    } catch {
      /* cache hong: khong sao */
    }
    return h;
  }
}

/**
 * overlay luu TEXT JSON; kiem lai khi phat (du lieu cu/hong thi bo qua, khong lam hong manifest).
 * Chinh sach tre em (p2, fail-safe): ngu canh 'lock' chi con khi settings.tv_experience.lock_ads_enabled === true VA creative kid_safe === true
 * VA nguoi duyet da xac nhan kid_safe cho dung content_version hien tai (creative_kid_review, w-dev);
 * nguoc lai 'lock' bi bo; neu 'lock' la ngu canh DUY NHAT thi creative bi loai khoi manifest (drop) — khong roi ve fullscreen.
 */
function parseOverlayJson(raw: string | null | undefined, lockAllowed: boolean, kidReviewed: boolean): { ov: import('@ams/shared').CreativeOverlay | null; drop: boolean } {
  if (!raw) return { ov: null, drop: false };
  try {
    // du lieu DB la dang tin cay (khach chi ghi qua route 'reject'/'strip'): giu kid_safe/ngu canh 'lock' do nguoi duyet dat
    const r = parseOverlay(JSON.parse(raw), { reviewerFields: 'keep' });
    if (!r.ok || !r.value) return { ov: null, drop: false };
    let v = r.value;
    // w-dev: kid_safe chi co hieu luc khi nguoi duyet da xac nhan (creative_kid_review) cho DUNG phien ban noi dung hien tai.
    // Khong co xac nhan / xac nhan cu (khach da doi noi dung) => khong bao kid_safe=true, khong cho ngu canh 'lock'.
    if (v.kid_safe === true && !kidReviewed) {
      const { kid_safe: _drop, ...rest } = v;
      v = rest;
    }
    if (v.contexts?.includes('lock') && !(lockAllowed && v.kid_safe === true)) {
      const rest = v.contexts.filter((x) => x !== 'lock');
      if (rest.length === 0) return { ov: null, drop: true };
      return { ov: { ...v, contexts: rest }, drop: false };
    }
    return { ov: v, drop: false };
  } catch {
    return { ov: null, drop: false };
  }
}
