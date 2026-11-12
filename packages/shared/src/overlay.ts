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
  qr?: { url: string; label?: string; title?: string };
  /** ma SCTE-35/ad-id (quang cao chen vao luong truyen hinh) */
  scte_id?: string;
  badges?: string[];
}

export type OverlayResult = { ok: true; value: CreativeOverlay | null } | { ok: false; errors: { path: string; message: string }[] };

const LIMITS = { sponsor_tag: 60, brand_label: 60, headline: 140, label: 60, sub: 100, title: 80, scte_id: 64, badge: 30, url: 512, number: 24 };
const HOTLINE_RE = /^[0-9+().\-\s]{3,24}$/;
const SCTE_RE = /^[A-Za-z0-9_.:\-]{1,64}$/;

/**
 * Kiem tra + chuan hoa overlay (cat khoang trang, bo khoa la, bo chuoi rong). Tra `value: null` neu khong con gi.
 * QR chi nhan https (hoac http cho localhost khi test khong dung o production: chi https).
 */
export function parseOverlay(input: unknown): OverlayResult {
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
      if (url || label || title) {
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
          else out.qr = { url, ...(label ? { label } : {}), ...(title ? { title } : {}) };
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
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: Object.keys(out).length ? out : null };
}
