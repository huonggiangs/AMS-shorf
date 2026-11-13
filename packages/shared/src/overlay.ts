// Dinh dang quang cao + lop phu (overlay) cua creative. Mot nguon su that cho API (kiem tra khi nhap), gateway (phat trong manifest)
// va web admin. Khong phu thuoc thu vien ngoai de chay duoc tren Workers.

export const AD_FORMATS = ['fullscreen', 'menu_banner', 'l_banner', 'pause_ad', 'qr_corner', 'reward'] as const;
export type AdFormat = (typeof AD_FORMATS)[number];
export const isAdFormat = (v: unknown): v is AdFormat => typeof v === 'string' && (AD_FORMATS as readonly string[]).includes(v);

/** kv: API tang gia tri nay khi doi chien dich/creative/lich de gateway xay lai manifest ngay (toi da ~15 giay tre theo bo nho dem tung instance). */
export const MANIFEST_EPOCH_KEY = 'manifest:epoch';

export interface CreativeOverlay {
  /** nhan "Tai tro boi ..." goc man hinh */
  sponsor_tag?: string;
  brand_label?: string;
  headline?: string;
  hotline?: { label?: string; number: string; sub?: string };
  qr?: { url: string; label?: string; title?: string; hint?: string };
  /** ma SCTE-35/ad-id (quang cao chen vao luong truyen hinh) */
  scte_id?: string;
  badges?: string[];
  /** thoi luong hien thi (giay) 5..60; dong bo creatives.duration_s khi luu qua tv-experience */
  duration_s?: number;
  /** vung an toan (% moi canh) 0..15 */
  safe_area?: { top: number; right: number; bottom: number; left: number };
  /** noi hien thi tren TV; `lock` chi do nguoi duyet dat (xem ParseOverlayOptions) */
  contexts?: OverlayContext[];
  /** nguoi duyet xac nhan phu hop man hinh co tre em; mac dinh false => TV khong hien o man khoa */
  kid_safe?: boolean;
}

export const OVERLAY_CONTEXTS = ['lock', 'fullscreen', 'pause', 'corner'] as const;
export type OverlayContext = (typeof OVERLAY_CONTEXTS)[number];

/**
 * Truong chi nguoi duyet duoc dat: `kid_safe: true` va ngu canh `lock`.
 *  - 'strip' (mac dinh, an toan): bo am tham, khong bao loi. Dung cho moi noi khong chac chan (API khach, gateway chua nang cap).
 *  - 'reject': tra loi 422 de khach biet (API nhap lieu cua khach).
 *  - 'keep': giu nguyen (chi route tv-experience cua nguoi duyet, hoac doc lai du lieu da luu va tin cay).
 */
export interface ParseOverlayOptions {
  reviewerFields?: 'strip' | 'reject' | 'keep';
}

/** Anh nen creative fullscreen tren TV: 16:9 (lech toi da 16 don vi), tu 1280x720 (HD) den 7680x4320 (8K). Khop integrations/brainrot-tv/schema/overlay.ts. */
export const BG_MIN_W = 1280;
export const BG_MAX_W = 7680;
export function backgroundSizeProblem(w: number, h: number): string | null {
  if (!Number.isInteger(w) || !Number.isInteger(h) || Math.abs(w * 9 - h * 16) > 16) return `Ảnh nền phải tỉ lệ 16:9 (nhận ${w}x${h}).`;
  if (w < BG_MIN_W) return `Ảnh nền tối thiểu ${BG_MIN_W}x720 (HD).`;
  if (w > BG_MAX_W) return `Ảnh nền tối đa ${BG_MAX_W}x4320 (8K).`;
  return null;
}

export type OverlayResult = { ok: true; value: CreativeOverlay | null } | { ok: false; errors: { path: string; message: string }[] };

const LIMITS = { sponsor_tag: 60, brand_label: 60, headline: 140, label: 60, sub: 100, title: 80, scte_id: 64, badge: 30, url: 512, number: 24, hint: 40 };
const HOTLINE_RE = /^[0-9+().\-\s]{3,24}$/;
const SCTE_RE = /^[A-Za-z0-9_.:\-]{1,64}$/;

/**
 * Kiem tra + chuan hoa overlay (cat khoang trang, bo khoa la, bo chuoi rong). Tra `value: null` neu khong con gi.
 * QR chi nhan https (hoac http cho localhost khi test khong dung o production: chi https).
 */
export function parseOverlay(input: unknown, opts: ParseOverlayOptions = {}): OverlayResult {
  const reviewerMode = opts.reviewerFields ?? 'strip';
  if (input === null || input === undefined) return { ok: true, value: null };
  const errors: { path: string; message: string }[] = [];
  if (typeof input !== 'object' || Array.isArray(input)) return { ok: false, errors: [{ path: '', message: 'Overlay phải là một đối tượng.' }] };
  const src = input as Record<string, unknown>;
  const out: CreativeOverlay = {};
  const str = (path: string, v: unknown, max: number): string | undefined => {
    if (v === undefined || v === null) return undefined;
    if (typeof v !== 'string') {
      errors.push({ path, message: 'Phải là chuỗi.' });
      return undefined;
    }
    const t = v.trim();
    if (!t) return undefined;
    if (t.length > max) {
      errors.push({ path, message: `Tối đa ${max} ký tự.` });
      return undefined;
    }
    if (/[\u0000-\u001f\u007f<>]/.test(t)) {
      errors.push({ path, message: 'Không được chứa ký tự điều khiển hoặc < >.' });
      return undefined;
    }
    return t;
  };
  const sponsor = str('sponsor_tag', src['sponsor_tag'], LIMITS.sponsor_tag);
  if (sponsor) out.sponsor_tag = sponsor;
  const brand = str('brand_label', src['brand_label'], LIMITS.brand_label);
  if (brand) out.brand_label = brand;
  const head = str('headline', src['headline'], LIMITS.headline);
  if (head) out.headline = head;
  const scte = str('scte_id', src['scte_id'], LIMITS.scte_id);
  if (scte) {
    if (SCTE_RE.test(scte)) out.scte_id = scte;
    else errors.push({ path: 'scte_id', message: 'Chỉ gồm chữ, số, _ . : -' });
  }
  if (src['hotline'] !== undefined && src['hotline'] !== null) {
    const h = src['hotline'] as Record<string, unknown>;
    if (typeof h !== 'object' || Array.isArray(h)) errors.push({ path: 'hotline', message: 'Hotline phải là đối tượng.' });
    else {
      const number = str('hotline.number', h['number'], LIMITS.number);
      const label = str('hotline.label', h['label'], LIMITS.label);
      const sub = str('hotline.sub', h['sub'], LIMITS.sub);
      if (number || label || sub) {
        if (!number) errors.push({ path: 'hotline.number', message: 'Nhập số hotline.' });
        else if (!HOTLINE_RE.test(number)) errors.push({ path: 'hotline.number', message: 'Số hotline không hợp lệ.' });
        else out.hotline = { number, ...(label ? { label } : {}), ...(sub ? { sub } : {}) };
      }
    }
  }
  if (src['qr'] !== undefined && src['qr'] !== null) {
    const q = src['qr'] as Record<string, unknown>;
    if (typeof q !== 'object' || Array.isArray(q)) errors.push({ path: 'qr', message: 'QR phải là đối tượng.' });
    else {
      const url = str('qr.url', q['url'], LIMITS.url);
      const label = str('qr.label', q['label'], LIMITS.label);
      const title = str('qr.title', q['title'], LIMITS.title);
      const hint = str('qr.hint', q['hint'], LIMITS.hint);
      if (url || label || title || hint) {
        if (!url) errors.push({ path: 'qr.url', message: 'Nhập liên kết cho mã QR.' });
        else {
          let ok = false;
          try {
            const u = new URL(url);
            ok = u.protocol === 'https:' && !u.username && !u.password;
          } catch {
            ok = false;
          }
          if (!ok) errors.push({ path: 'qr.url', message: 'Liên kết QR phải là https hợp lệ.' });
          else out.qr = { url, ...(label ? { label } : {}), ...(title ? { title } : {}), ...(hint ? { hint } : {}) };
        }
      }
    }
  }
  if (src['badges'] !== undefined && src['badges'] !== null) {
    if (!Array.isArray(src['badges'])) errors.push({ path: 'badges', message: 'Huy hiệu phải là danh sách.' });
    else {
      if (src['badges'].length > 6) errors.push({ path: 'badges', message: 'Tối đa 6 huy hiệu.' });
      const list = src['badges'].map((b, i) => str(`badges.${i}`, b, LIMITS.badge)).filter((x): x is string => !!x);
      if (list.length) out.badges = list.slice(0, 6);
    }
  }
  if (src['duration_s'] !== undefined && src['duration_s'] !== null) {
    const d = src['duration_s'];
    if (typeof d !== 'number' || !Number.isInteger(d) || d < 5 || d > 60) errors.push({ path: 'duration_s', message: 'Thời lượng phải là số nguyên từ 5 đến 60 giây.' });
    else out.duration_s = d;
  }
  if (src['safe_area'] !== undefined && src['safe_area'] !== null) {
    const a = src['safe_area'] as Record<string, unknown>;
    if (typeof a !== 'object' || Array.isArray(a)) errors.push({ path: 'safe_area', message: 'Vùng an toàn phải là đối tượng.' });
    else {
      const edges = ['top', 'right', 'bottom', 'left'] as const;
      const vals = edges.map((k) => a[k]);
      if (vals.some((v) => typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 15)) errors.push({ path: 'safe_area', message: 'Mỗi cạnh vùng an toàn là số nguyên từ 0 đến 15 (%).' });
      else out.safe_area = { top: vals[0] as number, right: vals[1] as number, bottom: vals[2] as number, left: vals[3] as number };
    }
  }
  if (src['contexts'] !== undefined && src['contexts'] !== null) {
    if (!Array.isArray(src['contexts'])) errors.push({ path: 'contexts', message: 'Ngữ cảnh phải là danh sách.' });
    else {
      const bad = src['contexts'].filter((x) => !(OVERLAY_CONTEXTS as readonly unknown[]).includes(x));
      if (bad.length) errors.push({ path: 'contexts', message: `Ngữ cảnh không hợp lệ (chỉ ${OVERLAY_CONTEXTS.join(', ')}).` });
      else {
        let list = [...new Set(src['contexts'] as OverlayContext[])];
        if (list.includes('lock') && reviewerMode !== 'keep') {
          if (reviewerMode === 'reject') errors.push({ path: 'contexts', message: 'Ngữ cảnh "lock" (màn khóa) chỉ do người duyệt đặt.' });
          list = list.filter((x) => x !== 'lock');
        }
        if (list.length) out.contexts = list;
      }
    }
  }
  if (src['kid_safe'] !== undefined && src['kid_safe'] !== null) {
    if (typeof src['kid_safe'] !== 'boolean') errors.push({ path: 'kid_safe', message: 'kid_safe phải là true/false.' });
    else if (src['kid_safe'] === true && reviewerMode !== 'keep') {
      if (reviewerMode === 'reject') errors.push({ path: 'kid_safe', message: 'kid_safe chỉ do người duyệt xác nhận.' });
    } else out.kid_safe = src['kid_safe'];
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: Object.keys(out).length ? out : null };
}
