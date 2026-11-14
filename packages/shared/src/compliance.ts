// Logic thuan (khong I/O) cho phap ly + hoa don dien tu + nhac no + quyen chu the du lieu (p4-legal-billing).
// Dung chung API va web-admin; moi ham la ham thuan de kiem thu ma khong can DB.
// Cac hang so phap ly (so ngay, danh sach nganh han che...) la MAC DINH KY THUAT: luat su/ke toan xac nhan truoc khi ban that (docs/legal/README.md).

// ---------------- van ban phap ly co phien ban ----------------
export const LEGAL_KINDS = ['terms', 'privacy', 'sla', 'ad_policy'] as const;
export type LegalKind = (typeof LEGAL_KINDS)[number];
export const LEGAL_KIND_LABEL: Record<LegalKind, string> = {
  terms: 'Điều khoản dịch vụ',
  privacy: 'Chính sách bảo mật',
  sla: 'Cam kết mức dịch vụ (SLA)',
  ad_policy: 'Chính sách nội dung quảng cáo',
};
export const isLegalKind = (x: unknown): x is LegalKind => typeof x === 'string' && (LEGAL_KINDS as readonly string[]).includes(x);

/** Phien ban hop le: chu/so/dau cham/gach, 1-24 ky tu (vd `1.0`, `2026-12`, `0.1-draft`). */
export const LEGAL_VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,23}$/;
/** Dau hieu ban nhap chua duoc luat su duyet: noi dung con dong "BAN NHAP" hoac cac cho `[...]` bo trong. */
export function legalDraftProblems(body: string): string[] {
  const out: string[] = [];
  if (/BẢN NHÁP|BAN NHAP/i.test(body)) out.push('Văn bản còn dòng "BẢN NHÁP".');
  const holes = body.match(/`\[[^\]`]*\]`/g);
  if (holes && holes.length) out.push(`Còn ${holes.length} chỗ trống dạng \`[...]\` cần luật sư điền.`);
  return out;
}

export interface PublishedDoc {
  id: string;
  kind: string;
  version: string;
  sha256: string;
  requires_acceptance: boolean;
}
/** Van ban da phat hanh ma tai khoan CHUA chap nhan dung ban (document_id) => bat buoc chap nhan truoc khi dung. */
export function pendingAcceptances<T extends PublishedDoc>(published: readonly T[], acceptedDocumentIds: ReadonlySet<string>): T[] {
  return published.filter((d) => d.requires_acceptance && !acceptedDocumentIds.has(d.id));
}

// ---------------- nganh quang cao + KYC ----------------
export const AD_CATEGORIES = [
  'general', 'food_beverage', 'retail', 'real_estate', 'education', 'automotive', 'technology', 'entertainment',
  'finance_banking', 'health_pharma', 'supplement', 'alcohol', 'tobacco', 'gambling', 'loan_credit', 'adult', 'political_religious',
] as const;
export type AdCategory = (typeof AD_CATEGORIES)[number];
export const AD_CATEGORY_LABEL: Record<AdCategory, string> = {
  general: 'Chung', food_beverage: 'Ăn uống', retail: 'Bán lẻ', real_estate: 'Bất động sản', education: 'Giáo dục', automotive: 'Ô tô - xe máy',
  technology: 'Công nghệ', entertainment: 'Giải trí', finance_banking: 'Tài chính - ngân hàng', health_pharma: 'Y tế - dược', supplement: 'Thực phẩm chức năng',
  alcohol: 'Rượu bia', tobacco: 'Thuốc lá', gambling: 'Cá cược - cờ bạc', loan_credit: 'Vay tiêu dùng', adult: 'Nội dung người lớn', political_religious: 'Chính trị - tôn giáo',
};
/** Nganh hạn chế: can giay phep/quy dinh rieng => duyet lan hai + KYC da duyet (luat su chot danh sach cuoi). */
export const RESTRICTED_CATEGORIES: readonly AdCategory[] = ['finance_banking', 'health_pharma', 'supplement', 'alcohol', 'tobacco', 'gambling', 'loan_credit', 'adult', 'political_religious'];
export const isAdCategory = (x: unknown): x is AdCategory => typeof x === 'string' && (AD_CATEGORIES as readonly string[]).includes(x);
export const isRestrictedCategory = (c: string | null | undefined): boolean => (RESTRICTED_CATEGORIES as readonly string[]).includes(c ?? '');

export const KYC_DOC_TYPES = ['business_registration', 'industry_licence', 'ad_content_permit', 'authorization_letter', 'other'] as const;
export type KycDocType = (typeof KYC_DOC_TYPES)[number];
export const KYC_DOC_LABEL: Record<KycDocType, string> = {
  business_registration: 'Giấy chứng nhận đăng ký doanh nghiệp', industry_licence: 'Giấy phép ngành nghề', ad_content_permit: 'Giấy xác nhận nội dung quảng cáo',
  authorization_letter: 'Giấy ủy quyền', other: 'Khác',
};
export const KYC_ALLOWED_MIME = ['application/pdf', 'image/png', 'image/jpeg'] as const;
export const KYC_MAX_BYTES = 10 * 1024 * 1024;
export const KYC_MAX_DOCS_PER_CUSTOMER = 30;

/** Ho so KYC du dieu kien nop duyet: co so ĐKKD, nguoi dai dien va it nhat 1 giay phep kinh doanh; nganh han che can them giay phep nganh. */
export function kycSubmissionProblems(p: { business_reg_no?: string | null; legal_rep_name?: string | null; docTypes: readonly string[]; restricted: boolean }): string[] {
  const out: string[] = [];
  if (!p.business_reg_no?.trim()) out.push('Thiếu mã số doanh nghiệp / số đăng ký kinh doanh.');
  if (!p.legal_rep_name?.trim()) out.push('Thiếu họ tên người đại diện pháp luật.');
  if (!p.docTypes.includes('business_registration')) out.push('Thiếu giấy chứng nhận đăng ký doanh nghiệp.');
  if (p.restricted && !p.docTypes.includes('industry_licence')) out.push('Ngành hạn chế cần giấy phép ngành nghề.');
  return out;
}

// ---------------- nhac no ----------------
export interface DunningConfig {
  /** so ngay so voi han thanh toan: am = nhac truoc han, 0 = dung han, duong = qua han. Moi moc gui toi da mot thu. */
  reminder_offsets_days: number[];
  /** qua han bao nhieu ngay thi tu tam dung chien dich (0 = tat) */
  auto_pause_after_days: number;
  /** co chan tao/duyet chien dich moi khi vuot han muc cong no (credit_limit_vnd) */
  enforce_credit_limit: boolean;
  /** canh bao so du thap: gui email (ngoai thong bao trong ung dung) */
  low_balance_email: boolean;
  /** gui email cho khach? false = chi ghi su kien + thong bao trong ung dung (chay thu) */
  send_emails: boolean;
}
export const DEFAULT_DUNNING: DunningConfig = {
  reminder_offsets_days: [-3, 0, 3, 7, 14],
  auto_pause_after_days: 15,
  enforce_credit_limit: true,
  low_balance_email: true,
  send_emails: true,
};
export const DUNNING_SETTINGS_KEY = 'dunning';

const clampInt = (v: unknown, lo: number, hi: number, d: number): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isInteger(n) && n >= lo && n <= hi ? n : d;
};
export function parseDunningConfig(raw: unknown): DunningConfig {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const offs = Array.isArray(o['reminder_offsets_days'])
    ? [...new Set((o['reminder_offsets_days'] as unknown[]).map((x) => clampInt(x, -30, 120, Number.NaN)).filter((x) => Number.isFinite(x)))].sort((a, b) => a - b).slice(0, 12)
    : DEFAULT_DUNNING.reminder_offsets_days;
  return {
    reminder_offsets_days: offs,
    auto_pause_after_days: clampInt(o['auto_pause_after_days'], 0, 365, DEFAULT_DUNNING.auto_pause_after_days),
    enforce_credit_limit: typeof o['enforce_credit_limit'] === 'boolean' ? o['enforce_credit_limit'] : DEFAULT_DUNNING.enforce_credit_limit,
    low_balance_email: typeof o['low_balance_email'] === 'boolean' ? o['low_balance_email'] : DEFAULT_DUNNING.low_balance_email,
    send_emails: typeof o['send_emails'] === 'boolean' ? o['send_emails'] : DEFAULT_DUNNING.send_emails,
  };
}

const DAY_MS = 86_400_000;
/** So ngay tu `due` (YYYY-MM-DD) den `today` (YYYY-MM-DD); duong = qua han. */
export function daysPastDue(due: string, today: string): number {
  const a = Date.parse(`${due.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${today.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / DAY_MS);
}

export interface DunningPlan {
  daysPastDue: number;
  markOverdue: boolean;
  /** moc nhac (offset) lon nhat da den han ma chua nhac: chi gui MOT thu cho moi lan chay (khong don thu cu) */
  reminderOffset: number | null;
  autoPause: boolean;
}
/** Quyet dinh cho mot khoan phai thu chua thanh toan. `sentOffsets` = cac moc da gui. */
export function planDunning(r: { due_date: string | null; remaining_vnd: number }, today: string, cfg: DunningConfig, sentOffsets: readonly number[]): DunningPlan {
  if (!r.due_date || r.remaining_vnd <= 0) return { daysPastDue: 0, markOverdue: false, reminderOffset: null, autoPause: false };
  const d = daysPastDue(r.due_date, today);
  // chi xet cac moc MOI hon moc da gui gan nhat (khong gui bu cac moc cu khi he thong chay tre/moi bat)
  const maxSent = sentOffsets.length ? Math.max(...sentOffsets) : Number.NEGATIVE_INFINITY;
  const due = cfg.reminder_offsets_days.filter((o) => o <= d && o > maxSent);
  return {
    daysPastDue: d,
    markOverdue: d > 0,
    reminderOffset: due.length ? Math.max(...due) : null,
    autoPause: cfg.auto_pause_after_days > 0 && d >= cfg.auto_pause_after_days,
  };
}

/** Cong no hien tai + khoan moi co vuot han muc khong. Han muc 0 = khong cho no (chi tra truoc). */
export function exceedsCreditLimit(limitVnd: number, outstandingVnd: number, extraVnd = 0): boolean {
  return outstandingVnd + extraVnd > Math.max(0, limitVnd);
}

// ---------------- hoa don dien tu ----------------
export const EINVOICE_PROVIDERS = ['manual', 'misa', 'viettel'] as const;
export type EinvoiceProviderId = (typeof EINVOICE_PROVIDERS)[number];
export type EinvoiceKind = 'original' | 'adjustment' | 'cancellation';
export type EinvoiceStatus = 'pending' | 'issued' | 'failed' | 'cancelled';
export const EINVOICE_MAX_ATTEMPTS = 6;

/** Khoa idempotency: cung (hoa don, loai, tham chieu) => cung khoa => nha cung cap khong phat hanh hai lan. */
export const einvoiceIdempotencyKey = (invoiceId: string, kind: EinvoiceKind, ref = ''): string => `ams:${invoiceId}:${kind}${ref ? `:${ref}` : ''}`;

/** Lui thoi gian thu lai (giay): 1p, 5p, 15p, 1h, 4h, 12h. Het so lan => null. */
export function einvoiceRetryDelaySec(attempts: number): number | null {
  const steps = [60, 300, 900, 3600, 14_400, 43_200];
  return attempts >= 1 && attempts <= steps.length ? steps[attempts - 1]! : null;
}

/** Chung tu dieu chinh khi hoan tien: so tien giam (am) + VAT theo thue suat cua hoa don goc, lam tron nhu invoices.vatOf. */
export function adjustmentAmounts(refundGrossVnd: number, vatRate: number): { amount_vnd: number; vat_vnd: number; total_vnd: number } {
  const gross = Math.max(0, Math.floor(refundGrossVnd));
  // hoan tien la so tien gom VAT: tach nguoc amount = gross * 100 / (100 + rate), VAT = gross - amount
  const amount = Math.round((gross * 100) / (100 + vatRate));
  const vat = gross - amount;
  return { amount_vnd: -amount, vat_vnd: -vat, total_vnd: -gross };
}

// ---------------- quyen chu the du lieu + luu giu ----------------
export const RETENTION_SETTINGS_KEY = 'retention_policy';
export interface RetentionPolicy {
  /** so ngay giu; 0 = khong tu xoa */
  ev_heartbeat_days: number;
  ev_ad_impression_days: number;
  ev_proof_of_play_days: number;
  impression_hourly_days: number;
}
export const DEFAULT_RETENTION: RetentionPolicy = { ev_heartbeat_days: 30, ev_ad_impression_days: 400, ev_proof_of_play_days: 400, impression_hourly_days: 800 };
/** Toi thieu cho cac bang su kien phuc vu doi soat/hoa don: khong cho dat duoi muc nay (tru 0 = khong xoa). */
export const RETENTION_MIN_DAYS = 7;
export function parseRetentionPolicy(raw: unknown): RetentionPolicy {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const f = (k: keyof RetentionPolicy): number => {
    const n = clampInt(o[k], 0, 3650, DEFAULT_RETENTION[k]);
    return n !== 0 && n < RETENTION_MIN_DAYS ? DEFAULT_RETENTION[k] : n;
  };
  return { ev_heartbeat_days: f('ev_heartbeat_days'), ev_ad_impression_days: f('ev_ad_impression_days'), ev_proof_of_play_days: f('ev_proof_of_play_days'), impression_hourly_days: f('impression_hourly_days') };
}
/** Moc cat (ISO) cho `days` ngay truoc `now`; null neu days = 0. */
export const retentionCutoff = (now: Date, days: number): string | null => (days > 0 ? new Date(now.getTime() - days * DAY_MS).toISOString() : null);

export const DSR_KINDS = ['export', 'anonymize'] as const;
export const DSR_SUBJECT_TYPES = ['customer_contact', 'end_user'] as const;
/** Han tra loi mac dinh (gio) cho yeu cau cua chu the du lieu; luat su xac nhan con so (ND 13/2023). */
export const DSR_DEFAULT_DUE_HOURS = 72;

export const ANONYMIZED_NAME = 'Đã ẩn danh';
/** Email ẩn danh duy nhất theo id (giữ ràng buộc UNIQUE email, không thể suy ngược ra người). */
export const anonymizedEmail = (id: string): string => `anonymized+${id.toLowerCase()}@invalid.example`;

/** Che bot gia tri nhay cam de hien thi/ghi log: giu 2 ky tu dau + 2 cuoi. */
export function maskValue(s: string | null | undefined): string {
  const v = (s ?? '').trim();
  if (!v) return '';
  if (v.length <= 4) return '*'.repeat(v.length);
  return `${v.slice(0, 2)}${'*'.repeat(Math.min(8, v.length - 4))}${v.slice(-2)}`;
}
