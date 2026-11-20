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
  /** cach hien anh/video trong khung: 'cover' (mac dinh, phu kin) hoac 'fit' (vua khung, co the co vien) */
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
  fit: 'cover',
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
