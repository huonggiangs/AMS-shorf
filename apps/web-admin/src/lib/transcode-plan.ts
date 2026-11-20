// Chuyen ma video O TRINH DUYET: phan THUAN (khong DOM, khong WebCodecs) = danh gia tep nguon theo quy tac cua may chu + chon thong so dau ra.
// Quy tac phai khop services/api/src/lib/creative.ts (VIDEO_RULES, DURATION_RANGE, ELEVATOR_*); may chu van kiem tra lai (khong tin trinh duyet).
// Phan chay that (mediabunny + WebCodecs, Web Worker) o transcode-core.ts / transcode.worker.ts / transcode.ts (nap luoi).
export const MB = 1048576;

export type TargetKind = 'elevator' | 'tv';
export type SourceCodec = 'avc' | 'hevc' | 'vp9' | 'vp8' | 'av1' | string;

export interface SourceInfo {
  /** kich thuoc HIEN THI (da tinh xoay) */
  width: number;
  height: number;
  durationSec: number;
  codec: SourceCodec | null;
  /** mp4 | mov | webm | mkv | ... (ten dinh dang doc duoc, chu thuong) */
  container: string;
  fps: number | null;
  bitrateBps: number | null;
  sizeBytes: number;
  hasAudio: boolean;
}

export interface Tier {
  w: number;
  h: number;
  label: string;
  /** bitrate video muc tieu (bps) */
  videoBps: number;
}
/** Bac chuan thang may 9:16 (khop ELEVATOR_TIERS cua @ams/shared); bitrate <= 16 Mbps theo tai lieu. */
export const ELEVATOR_TIERS: readonly Tier[] = [
  { w: 720, h: 1280, label: 'HD 720×1280', videoBps: 4_500_000 },
  { w: 1080, h: 1920, label: 'Full HD 1080×1920', videoBps: 7_000_000 },
  { w: 1440, h: 2560, label: '2K 1440×2560', videoBps: 11_000_000 },
  { w: 2160, h: 3840, label: '4K 2160×3840', videoBps: 15_000_000 },
];
export const TV_TIERS: readonly Tier[] = [
  { w: 1280, h: 720, label: 'HD 1280×720', videoBps: 3_500_000 },
  { w: 1920, h: 1080, label: 'Full HD 1920×1080', videoBps: 6_000_000 },
];
/** Tran do phan giai khi chuyen ma: mac dinh Full HD cho nhe (4K tuy chon trong "Chi tiet"). Khoa = canh NGAN cua bac (720, 1080, 1440, 2160). */
export type Ceiling = 720 | 1080 | 1440 | 2160;
export const DEFAULT_CEILING: Ceiling = 1080;

export interface Rules {
  maxBytes: number;
  durationMin: number;
  durationMax: number;
  tiers: readonly Tier[];
  /** ti le rong/cao yeu cau */
  ratio: number;
  /** codec dung duoc khong can chuyen */
  codecsOk: readonly string[];
  /** codec dung duoc nhung khong toi uu */
  codecsWarn: readonly string[];
}
export const RULES: Record<TargetKind, Rules> = {
  elevator: { maxBytes: 200 * MB, durationMin: 10, durationMax: 30, tiers: ELEVATOR_TIERS, ratio: 9 / 16, codecsOk: ['avc', 'hevc'], codecsWarn: ['vp9'] },
  tv: { maxBytes: 100 * MB, durationMin: 5, durationMax: 60, tiers: TV_TIERS, ratio: 16 / 9, codecsOk: ['avc'], codecsWarn: [] },
};
export const AUDIO_BPS = 128_000;
export const MAX_FPS = 30;
export const KEYFRAME_SEC = 2;
/** de lai 8% du phong cho container + sai so bitrate */
export const SIZE_SAFETY = 0.92;

const near = (a: number, b: number, tol = 0.02) => Math.abs(a - b) / b <= tol;

/** Doc 9:16 (hoac vuong/doc khac) -> thang may; ngang -> TV. Nguoi dung doi duoc trong hop thoai. */
export function inferTarget(w: number, h: number): TargetKind {
  return w < h ? 'elevator' : 'tv';
}

export type Reason =
  | 'codec_unsupported' // AV1/VP8/khac: may chu chan
  | 'codec_tv' // H.265/VP9 cho TV: may chu chan
  | 'too_big' // qua dung luong
  | 'res_high'
  | 'res_low'
  | 'wrong_ratio'
  | 'codec_not_ideal' // VP9 thang may: duoc nhung nen chuyen
  | 'container' // khong phai MP4: may chu khong doc kiem duoc het
  | 'bitrate_high';

export const REQUIRED_REASONS: readonly Reason[] = ['codec_unsupported', 'codec_tv', 'too_big', 'res_high', 'res_low', 'wrong_ratio'];

export interface Assessment {
  target: TargetKind;
  /** vi pham quy tac may chu: BAT BUOC chuyen ma */
  required: Reason[];
  /** duoc phep nhung nen chuyen (mac dinh bat) */
  recommended: Reason[];
  /** khong the tu sua */
  blockers: ('too_short' | 'not_video')[];
  /** video qua dai: can cat; so giay toi da duoc giu. null = khong phai cat */
  trimTo: number | null;
  needsConvert: boolean;
  /** hien nut chuyen (bat buoc hoac nen) */
  offerConvert: boolean;
}

/** Danh gia tep video nguon cho loai man dich. */
export function assessSource(src: SourceInfo, target: TargetKind): Assessment {
  const r = RULES[target];
  const required: Reason[] = [];
  const recommended: Reason[] = [];
  const blockers: Assessment['blockers'] = [];
  const codec = src.codec;
  if (codec) {
    if (!r.codecsOk.includes(codec) && !r.codecsWarn.includes(codec)) required.push(target === 'tv' && (codec === 'hevc' || codec === 'vp9') ? 'codec_tv' : 'codec_unsupported');
    else if (r.codecsWarn.includes(codec)) recommended.push('codec_not_ideal');
  }
  if (src.sizeBytes > r.maxBytes) required.push('too_big');
  const ratioOk = near(src.width / src.height, r.ratio);
  if (!ratioOk) required.push('wrong_ratio');
  const long = Math.max(src.width, src.height);
  const short = Math.min(src.width, src.height);
  const top = r.tiers[r.tiers.length - 1]!;
  const bottom = r.tiers[0]!;
  if (ratioOk) {
    if (long > Math.max(top.w, top.h) * 1.001 || short > Math.min(top.w, top.h) * 1.001) required.push('res_high');
    if (target === 'elevator' && src.width < bottom.w * 0.98) required.push('res_low');
  }
  if (src.container !== 'mp4') recommended.push('container');
  if (target === 'elevator' && src.bitrateBps && src.bitrateBps > 16_000_000) recommended.push('bitrate_high');
  let trimTo: number | null = null;
  if (src.durationSec > r.durationMax + 0.5) trimTo = r.durationMax;
  else if (src.durationSec > 0 && src.durationSec < r.durationMin - 0.5) blockers.push('too_short');
  const needsConvert = required.length > 0;
  return { target, required, recommended, blockers, trimTo, needsConvert, offerConvert: needsConvert || recommended.length > 0 };
}

export interface TranscodeSettings {
  width: number;
  height: number;
  /** vua khung: giu ti le, co vien den neu lech, KHONG cat, KHONG be meo */
  fit: 'contain';
  videoBps: number;
  audioBps: number;
  fps: number;
  keyFrameSec: number;
  /** cat o giay nay (null = giu nguyen) */
  trimEndSec: number | null;
  /** thoi luong dau ra du kien (giay) */
  outDurationSec: number;
  tierLabel: string;
}
export interface SettingsResult {
  settings: TranscodeSettings;
  estimatedBytes: number;
  /** ngay ca bitrate thap nhat van vuot tran dung luong */
  tooBig: boolean;
}
/** Bitrate thap nhat con xem duoc (bps). */
export const MIN_VIDEO_BPS = 1_000_000;

/** Chon bac do phan giai: tran = `ceiling` (canh ngan), khong phong to qua tep goc tru khi goc nho hon bac thap nhat. */
export function pickTier(src: Pick<SourceInfo, 'width' | 'height'>, target: TargetKind, ceiling: Ceiling = DEFAULT_CEILING): Tier {
  const r = RULES[target];
  const cap = r.tiers.filter((t) => Math.min(t.w, t.h) <= ceiling);
  const allowed = cap.length ? cap : [r.tiers[0]!];
  const ratioOk = near(src.width / src.height, r.ratio);
  // tep dung ti le: bac lon nhat khong vuot chieu rong goc; tep lech ti le: dua theo canh dai cua tep (noi dung duoc co vao khung)
  const basis = ratioOk ? src.width : Math.max(src.width, src.height);
  const fits = allowed.filter((t) => t.w <= basis * 1.02);
  return fits.length ? fits[fits.length - 1]! : allowed[0]!;
}

export function pickSettings(src: SourceInfo, target: TargetKind, opts: { ceiling?: Ceiling; trim?: boolean } = {}): SettingsResult {
  const r = RULES[target];
  const tier = pickTier(src, target, opts.ceiling ?? DEFAULT_CEILING);
  const a = assessSource(src, target);
  const trimEnd = opts.trim && a.trimTo ? a.trimTo : null;
  const dur = Math.max(1, trimEnd ?? src.durationSec);
  const fps = Math.max(1, Math.min(MAX_FPS, Math.round(src.fps && src.fps > 0 ? src.fps : MAX_FPS)));
  const audioBps = src.hasAudio ? AUDIO_BPS : 0;
  const budgetBps = Math.floor((r.maxBytes * SIZE_SAFETY * 8) / dur) - audioBps;
  let videoBps = Math.min(tier.videoBps, budgetBps);
  const tooBig = videoBps < MIN_VIDEO_BPS;
  videoBps = Math.max(MIN_VIDEO_BPS, videoBps);
  return {
    settings: { width: tier.w, height: tier.h, fit: 'contain', videoBps, audioBps: audioBps || AUDIO_BPS, fps, keyFrameSec: KEYFRAME_SEC, trimEndSec: trimEnd, outDurationSec: dur, tierLabel: tier.label },
    estimatedBytes: Math.round(((videoBps + audioBps) * dur) / 8),
    tooBig,
  };
}

/** Uoc luong thoi gian chuyen (giay) truoc khi biet toc do thuc: ~0,6x thoi luong o Full HD, ti le theo so diem anh. */
export function estimateSeconds(outDurationSec: number, w: number, h: number): number {
  const px = (w * h) / (1080 * 1920);
  return Math.max(5, Math.round(outDurationSec * 0.6 * Math.max(0.4, px)));
}
/** Thoi gian con lai (giay) tu tien do thuc (0..1) va thoi gian da troi; null khi chua du so lieu. */
export function etaSeconds(progress: number, elapsedSec: number): number | null {
  if (!(progress > 0.03) || !(elapsedSec > 2)) return null;
  return Math.max(0, Math.round((elapsedSec / progress) * (1 - progress)));
}
export function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s} giây`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest ? `${m} phút ${rest} giây` : `${m} phút`;
}
export const fmtMb = (bytes: number): string => `${(bytes / MB).toFixed(bytes >= 10 * MB ? 0 : 1)} MB`;

/** Cau giai thich bang tieng Viet don gian (khong thuat ngu) cho tung ly do. `detail=true`: kem thong so ky thuat. */
export function reasonText(reason: Reason, src: SourceInfo, target: TargetKind, detail = false): string {
  const r = RULES[target];
  const screen = target === 'elevator' ? 'màn thang máy' : 'màn TV';
  const codecName: Record<string, string> = { av1: 'AV1', vp9: 'VP9', vp8: 'VP8', hevc: 'H.265', avc: 'H.264' };
  const cn = src.codec ? codecName[src.codec] ?? src.codec.toUpperCase() : '';
  switch (reason) {
    case 'codec_unsupported':
      return `Định dạng video${detail && cn ? ` (${cn})` : ''} khó phát ổn định trên ${screen}.`;
    case 'codec_tv':
      return `Định dạng video${detail && cn ? ` (${cn})` : ''} không phù hợp với màn TV.`;
    case 'too_big':
      return `Tệp ${fmtMb(src.sizeBytes)} lớn hơn mức cho phép ${r.maxBytes / MB} MB.`;
    case 'res_high':
      return `Hình quá lớn${detail ? ` (${src.width}×${src.height})` : ''} so với mức ${screen} nhận.`;
    case 'res_low':
      return `Hình quá nhỏ${detail ? ` (${src.width}×${src.height})` : ''} cho ${screen}.`;
    case 'wrong_ratio':
      return target === 'elevator' ? 'Video đang nằm ngang, màn thang máy đặt dọc. Hệ thống sẽ đặt video vừa khung (không cắt, không méo, có viền đen).' : 'Video đang đặt dọc, màn TV nằm ngang. Hệ thống sẽ đặt video vừa khung (không cắt, không méo, có viền đen).';
    case 'codec_not_ideal':
      return 'Định dạng video này phát được nhưng chưa ổn định bằng chuẩn phổ biến nhất (H.264).';
    case 'container':
      return 'Tệp không phải MP4; chuyển sang MP4 để hệ thống kiểm tra và duyệt nhanh hơn.';
    case 'bitrate_high':
      return 'Tệp có chất lượng quá nặng cho đường truyền; hệ thống sẽ giảm cho nhẹ.';
  }
}

/** Dien giai ly do loi do may chu tra ve (ma loi) thanh viec can lam. */
export const CONVERTIBLE_SERVER_CODES: readonly string[] = ['unsupported_codec', 'video_resolution_too_high', 'file_too_large', 'creative_size_mismatch'];

// ---------------------------------------------------------------------------------------------------------- tien do chung mot thanh
export type Phase = 'convert' | 'upload' | 'finish';
/** Mot thanh tien do duy nhat: chuyen ma chiem 0-60% (neu co), tai len 60-97%, xac nhan 97-100%; khong chuyen ma thi tai len 0-97%. */
export function overallPercent(phase: Phase, phaseFraction: number, withConvert: boolean): number {
  const f = Math.min(1, Math.max(0, phaseFraction));
  const c = withConvert ? 60 : 0;
  if (phase === 'convert') return Math.round(f * c);
  if (phase === 'upload') return Math.round(c + f * (97 - c));
  return Math.round(97 + f * 3);
}

// ---------------------------------------------------------------------------------------------------------- loi chuyen ma
export type TranscodeErrorCode = 'unsupported_browser' | 'decode_unsupported' | 'encode_unsupported' | 'no_video' | 'read_failed' | 'too_big' | 'canceled' | 'failed';
export class TranscodeError extends Error {
  constructor(public code: TranscodeErrorCode, message: string) {
    super(message);
    this.name = 'TranscodeError';
  }
}
export const BROWSER_HINT = 'Hãy dùng Chrome hoặc Edge mới nhất trên máy tính.';
export const TRANSCODE_MESSAGES: Record<TranscodeErrorCode, string> = {
  unsupported_browser: `Trình duyệt này chưa hỗ trợ chuyển video tự động. ${BROWSER_HINT}`,
  decode_unsupported: `Trình duyệt chưa đọc được loại video này. ${BROWSER_HINT}`,
  encode_unsupported: `Trình duyệt chưa chuyển được sang H.264. ${BROWSER_HINT}`,
  no_video: 'Không tìm thấy hình ảnh trong tệp này. Hãy chọn tệp video khác.',
  read_failed: 'Không đọc được tệp. Tệp có thể bị hỏng, hãy thử tệp khác.',
  too_big: 'Dù đã nén vẫn vượt dung lượng cho phép. Hãy chọn đoạn video ngắn hơn.',
  canceled: 'Đã hủy chuyển video.',
  failed: 'Chuyển video không thành công. Hãy thử lại, hoặc dùng Chrome/Edge mới nhất trên máy tính.',
};
