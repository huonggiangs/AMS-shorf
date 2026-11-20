// Cau hinh Signage Player (thang may / LED P5): chu header/footer, hotline, che do hien thi anh, cap nhat app tu xa.
// Luu o settings.signage_config (JSON) theo loai man; API quan tri kiem tra bang validateSignageKind, gateway doc bang parseSignageConfig.
// Khong phu thuoc zod de gateway/Worker va web import duoc nhe.
export const SIGNAGE_CONFIG_KEY = 'signage_config';
export const SIGNAGE_KINDS = ['elevator', 'led_p5'] as const;
export type SignageKind = (typeof SIGNAGE_KINDS)[number];
export const isSignageKind = (x: unknown): x is SignageKind => typeof x === 'string' && (SIGNAGE_KINDS as readonly string[]).includes(x);

export const SIGNAGE_LIMITS = { header: 120, footer: 200, hotline: 60, imageDurationMin: 3, imageDurationMax: 120, url: 300 } as const;
export const DEFAULT_IMAGE_DURATION_S = 10;
export type SignageFit = 'fit' | 'cover';

export interface SignageKindConfig {
  /** chu header cap manifest (rong = an) */
  header: string;
  /** chu footer cap manifest (rong = an) */
  footer: string;
  /** hotline / Zalo hien o man hinh logo (rong = khong gui) */
  hotline: string;
  /** cach hien anh/video trong khung: 'fit' (MAC DINH tu 20/11/2026: vua khung, giu ti le, co vien den neu lech) hoac 'cover' (phu kin, co the cat mep; chon thu cong theo loai man) */
  fit: SignageFit;
  /** thoi luong mac dinh cua anh tinh khi creative chua khai bao duration_s */
  image_duration_s: number;
  /** ban app toi thieu server chap nhan (vd "1.2.0"); rong = khong gui (khi do gateway dung cong tac toan he thong neu co) */
  min_app_version: string;
  /** URL HTTPS tai ban cap nhat (APK) cho box khong co kho ung dung; rong = khong gui */
  app_update_url: string;
  /** SHA-256 (64 hex) cua tep cap nhat; bat buoc di kem URL */
  app_update_sha256: string;
}
export type SignageConfig = Record<SignageKind, SignageKindConfig>;

export const SIGNAGE_DEFAULT: SignageKindConfig = {
  header: '',
  footer: '',
  hotline: '',
  fit: 'fit',
  image_duration_s: DEFAULT_IMAGE_DURATION_S,
  min_app_version: '',
  app_update_url: '',
  app_update_sha256: '',
};

export interface FieldError {
  path: string;
  message: string;
}

// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const VERSION_RE = /^\d{1,4}(\.\d{1,4}){0,3}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

/** Chu hien tren man hinh: khong ky tu dieu khien, bo khoang trang dau/cuoi, gioi han do dai. */
export function validateDisplayText(v: unknown, max: number, path: string, errs: FieldError[]): string {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') {
    errs.push({ path, message: 'Phải là chuỗi ký tự.' });
    return '';
  }
  const s = v.trim();
  if (s.length > max) errs.push({ path, message: `Tối đa ${max} ký tự.` });
  if (CONTROL_RE.test(s)) errs.push({ path, message: 'Không được chứa ký tự điều khiển.' });
  return s;
}

/** URL cap nhat: HTTPS, co ten mien, KHONG nhung tai khoan/mat khau, KHONG query/fragment (tranh luu token/URL ky). */
export function validateAppUpdateUrl(raw: string): string | null {
  if (raw.length > SIGNAGE_LIMITS.url) return `Tối đa ${SIGNAGE_LIMITS.url} ký tự.`;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return 'Không phải URL hợp lệ.';
  }
  if (u.protocol !== 'https:') return 'Phải dùng HTTPS.';
  if (!u.hostname || !u.hostname.includes('.')) return 'Thiếu tên miền.';
  if (u.username || u.password) return 'Không được nhúng tài khoản/mật khẩu trong URL.';
  if (u.search || u.hash) return 'Không được có tham số (?...) hoặc #...: URL có chữ ký/token không được lưu.';
  return null;
}

/** Kiem tra day du cau hinh MOT loai man (thay the toan bo). Truong thieu dung mac dinh. */
export function validateSignageKind(input: unknown): { ok: true; value: SignageKindConfig } | { ok: false; errors: FieldError[] } {
  const errs: FieldError[] = [];
  const o = (input && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  const known = new Set(Object.keys(SIGNAGE_DEFAULT));
  for (const k of Object.keys(o)) if (!known.has(k) && k !== 'kind') errs.push({ path: k, message: 'Trường không được hỗ trợ.' });
  const header = validateDisplayText(o['header'], SIGNAGE_LIMITS.header, 'header', errs);
  const footer = validateDisplayText(o['footer'], SIGNAGE_LIMITS.footer, 'footer', errs);
  const hotline = validateDisplayText(o['hotline'], SIGNAGE_LIMITS.hotline, 'hotline', errs);
  let fit: SignageFit = SIGNAGE_DEFAULT.fit;
  if (o['fit'] !== undefined) {
    if (o['fit'] === 'fit' || o['fit'] === 'cover') fit = o['fit'];
    else errs.push({ path: 'fit', message: 'Chỉ nhận "fit" hoặc "cover".' });
  }
  let dur = SIGNAGE_DEFAULT.image_duration_s;
  if (o['image_duration_s'] !== undefined) {
    const n = o['image_duration_s'];
    if (typeof n === 'number' && Number.isInteger(n) && n >= SIGNAGE_LIMITS.imageDurationMin && n <= SIGNAGE_LIMITS.imageDurationMax) dur = n;
    else errs.push({ path: 'image_duration_s', message: `Số nguyên từ ${SIGNAGE_LIMITS.imageDurationMin} đến ${SIGNAGE_LIMITS.imageDurationMax} giây.` });
  }
  let minV = '';
  if (o['min_app_version'] !== undefined && o['min_app_version'] !== null && o['min_app_version'] !== '') {
    if (typeof o['min_app_version'] === 'string' && VERSION_RE.test(o['min_app_version'].trim())) minV = o['min_app_version'].trim();
    else errs.push({ path: 'min_app_version', message: 'Dạng số phiên bản, ví dụ 1.2.0.' });
  }
  let url = '';
  if (o['app_update_url'] !== undefined && o['app_update_url'] !== null && o['app_update_url'] !== '') {
    if (typeof o['app_update_url'] !== 'string') errs.push({ path: 'app_update_url', message: 'Phải là chuỗi ký tự.' });
    else {
      url = o['app_update_url'].trim();
      const e = validateAppUpdateUrl(url);
      if (e) errs.push({ path: 'app_update_url', message: e });
    }
  }
  let sha = '';
  if (o['app_update_sha256'] !== undefined && o['app_update_sha256'] !== null && o['app_update_sha256'] !== '') {
    if (typeof o['app_update_sha256'] === 'string' && SHA256_RE.test(o['app_update_sha256'].trim().toLowerCase())) sha = o['app_update_sha256'].trim().toLowerCase();
    else errs.push({ path: 'app_update_sha256', message: 'Phải gồm đúng 64 ký tự hex (0-9, a-f).' });
  }
  if (!errs.length && (url !== '') !== (sha !== '')) errs.push({ path: url ? 'app_update_sha256' : 'app_update_url', message: 'URL và SHA-256 phải đi cùng nhau.' });
  if (errs.length) return { ok: false, errors: errs };
  return { ok: true, value: { header, footer, hotline, fit, image_duration_s: dur, min_app_version: minV, app_update_url: url, app_update_sha256: sha } };
}

/** Doc settings.signage_config: chiu duoc du lieu hong/thieu (tra mac dinh cho phan khong hop le, KHONG nem loi). */
export function parseSignageConfig(raw: string | null | undefined): SignageConfig {
  const out: SignageConfig = { elevator: { ...SIGNAGE_DEFAULT }, led_p5: { ...SIGNAGE_DEFAULT } };
  if (!raw) return out;
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!j || typeof j !== 'object') return out;
  for (const k of SIGNAGE_KINDS) {
    const r = validateSignageKind((j as Record<string, unknown>)[k]);
    if (r.ok) out[k] = r.value;
  }
  return out;
}

/** Nhan mac dinh cua nguon dang phat do thiet bi bao. */
export const DEVICE_SOURCES = ['ams', 'usb', 'lan'] as const;
export type DeviceSource = (typeof DEVICE_SOURCES)[number];
export const DEVICE_ORIENTATIONS = ['landscape', 'portrait'] as const;

/** Nhat ky thiet bi (device_logs) giu bao nhieu ngay; gateway don, API chi hien trong khoang nay. */
export const DEVICE_LOG_RETENTION_DAYS = 7;

/**
 * Thang may: moi do phan giai DOC 9:16 tu HD (720x1280) den 4K (2160x3840).
 * Cac bac chuan dung de gom nhom manifest `elevator_<w>x<h>` (768x1366 la sai so nho cua 9:16 cho man 18,5").
 */
export const ELEVATOR_TIERS: readonly { w: number; h: number }[] = [
  { w: 720, h: 1280 },
  { w: 768, h: 1366 },
  { w: 1080, h: 1920 },
  { w: 1440, h: 2560 },
  { w: 2160, h: 3840 },
];
export const ELEVATOR_MIN = { w: 720, h: 1280 } as const;
export const ELEVATOR_MAX = { w: 2160, h: 3840 } as const;
/** Sai so cho phep khi so ti le 9:16 va khi so voi bac (vd man co thanh dieu huong an bot vai pixel chieu cao). */
export const ELEVATOR_TOLERANCE = 0.02;

/** true neu w x h la man/tep thang may hop le: doc, ~9:16 (+-2%), tu 720x1280 den 2160x3840. */
export function isElevatorResolution(w: number, h: number): boolean {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return false;
  if (Math.abs(w / h - 9 / 16) / (9 / 16) > ELEVATOR_TOLERANCE) return false;
  return w >= ELEVATOR_MIN.w && h >= ELEVATOR_MIN.h && w <= ELEVATOR_MAX.w && h <= ELEVATOR_MAX.h;
}

/**
 * Bac chuan gan nhat KHONG VUOT do phan giai (w x h): bac lon nhat co chieu rong <= w (sai so +2%).
 * Khong bao gio day len bac cao hon (man HD khong nhan 4K). Duoi 720 px: tra bac thap nhat. Tra anh xoay ngang (w > h) ve doc.
 */
export function elevatorTierFor(w: number, h: number): { w: number; h: number } {
  const pw = Math.min(w, h);
  let best = ELEVATOR_TIERS[0]!;
  for (const t of ELEVATOR_TIERS) if (t.w <= pw * (1 + ELEVATOR_TOLERANCE)) best = t;
  return best;
}

/**
 * Ten nhom manifest cho thiet bi/man hinh: `elevator_<bac chuan>` (bac gan nhat khong vuot do phan giai), `led_p5_<w>x<h>` (dung kich thuoc), hoac chinh `kind` khi chua khai px.
 * Gateway (manifest) va API quan tri (model_class) dung CHUNG ham nay de hai ben luon khop.
 */
export function signageModelClass(kind: 'elevator' | 'led_p5', w: number | null | undefined, h: number | null | undefined): string {
  if (!w || !h) return kind;
  if (kind === 'elevator') {
    const t = elevatorTierFor(w, h);
    return `elevator_${t.w}x${t.h}`;
  }
  return `${kind}_${w}x${h}`;
}
