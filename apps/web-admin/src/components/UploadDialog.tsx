// "Tải nội dung mới": MỘT luồng cho người dùng cơ bản: kéo thả/chọn tệp (hoặc dán liên kết Drive) -> tự kiểm tra -> tự chuyển sang chuẩn phát được nếu cần
// (chuyển mã H.264 ngay trên trình duyệt, lib/transcode*.ts) -> tải lên (một thanh tiến độ chung) -> tự duyệt nếu có quyền -> hiện ảnh đại diện.
// Máy chủ vẫn kiểm tra lại mọi thứ (codec, kích thước, thời lượng): trình duyệt chỉ giúp người dùng đạt chuẩn.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { API_BASE, api, errMsg, putBlob } from '../api/client';
import { customerSchema, listOf, uploadUrlSchema } from '../api/schemas';
import { useAct, useBase } from '../api/hooks';
import { Btn, Field } from './ui';
import { Dialog } from './Dialog';
import { OverlayForm, emptyOverlay, overlayError, overlayPayload } from './OverlayForm';
import { useT } from '../i18n';
import { checkMediaUrl, type LinkSource } from '../lib/creative';
import { UploadError, type UploadProgress } from '../lib/multipart';
import { fmtBytes, uploadToStore } from '../lib/upload';
import { captureThumbnail, resolveThumbUrl, thumbSupported, uploadDoneMessage } from '../lib/thumbnail';
import {
  AUDIO_BPS, DEFAULT_CEILING, MB, RULES, TRANSCODE_MESSAGES, TranscodeError, assessSource, estimateSeconds, etaSeconds, fmtDuration, fmtMb, inferTarget, overallPercent, pickSettings, reasonText,
  type Ceiling, type Phase, type Reason, type SourceInfo, type TargetKind,
} from '../lib/transcode-plan';
import { probeVideo, transcodeVideo, webCodecsSupported } from '../lib/transcode';

const MAX_IMAGE_BYTES = 500 * MB;
/** Giới hạn tải lên hiển thị trong "Chi tiết" (khớp services/api/src/lib/creative.ts + docs/CLOUDFLARE-MEDIA-LIMITS.md). */
export const UPLOAD_LIMIT_TEXT =
  'Video TV: H.264 + AAC, tối đa 1920×1080 (Full HD), tối đa 100 MB, 16:9, 5–60 giây. Thang máy: dọc 9:16 từ HD 720×1280 đến 4K 2160×3840 (gồm 768×1366, 1080×1920, 1440×2560), H.264 hoặc H.265 + AAC (VP9 được nhận kèm cảnh báo), bitrate khuyến nghị ≤ 16 Mbps, 10–30 giây, tối đa 200 MB. LED: đúng kích thước bảng, 5–15 giây, tối đa 50 MB. AV1 không phát ổn định: dùng nút "Tự động chuyển sang chuẩn phát được" để hệ thống đổi sang H.264 ngay trên máy bạn. Ảnh PNG/JPG tối đa 500 MB. Tệp lớn hơn 90 MB được tải lên từng phần (hiện % tiến độ, có thể hủy). Khách hàng còn bị giới hạn theo hạn mức tải lên của tài khoản.';

type Stage = 'pick' | 'checking' | 'ready' | 'working' | 'done';
interface Dims { width?: number; height?: number; duration_sec?: number }
interface Analysis { src: SourceInfo | null; isVideo: boolean; dims: Dims }
interface Done { name: string; status: string | null; thumb: string | null; warnings: string[]; converted: boolean; sizeNote: string }

const EXT_MIME: Record<string, string> = {
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo', flv: 'video/x-flv', rmvb: 'video/vnd.rn-realvideo', rm: 'video/vnd.rn-realvideo',
  wmv: 'video/x-ms-wmv', asf: 'video/x-ms-asf', '3gp': 'video/3gpp', '3g2': 'video/3gpp2', mpg: 'video/mpeg', mpeg: 'video/mpeg', ts: 'video/mp2t', mts: 'video/mp2t', m2ts: 'video/mp2t', vob: 'video/mpeg', ogv: 'video/ogg', f4v: 'video/x-f4v', divx: 'video/x-msvideo',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif', heic: 'image/heic', heif: 'image/heif', tif: 'image/tiff', tiff: 'image/tiff',
};
/** Kho chung (nhân viên): mọi video/ảnh phổ biến; trình duyệt thường để trống hoặc khai sai type cho AVI/MKV/FLV/RMVB → ưu tiên đuôi tệp. */
export const guessType = (f: File): string => {
  const ext = (f.name.split('.').pop() ?? '').toLowerCase();
  if (EXT_MIME[ext]) return EXT_MIME[ext]!;
  return f.type || '';
};
export const isAcceptedType = (t: string): boolean => /^(video\/(mp4|quicktime|webm)|image\/(png|jpeg))$/.test(t);
/** Nhân viên: nhận mọi video và ảnh (trừ SVG); khách hàng/đối tác: giữ quy định cũ. */
export const isLibraryType = (t: string): boolean => (t.startsWith('video/') || t.startsWith('image/') && !t.includes('svg') || /^application\/vnd\.rn-realmedia/.test(t));
export const LIBRARY_VIDEO_MAX = 1600 * MB;
export const LIBRARY_IMAGE_MAX = 25 * MB;
export const LIBRARY_LIMIT_TEXT =
  'Kho chung nhận mọi định dạng video (MP4, MOV, AVI, FLV, RMVB, MKV, WebM, WMV, 3GP, MPEG, TS…) với mọi chuẩn nén (H.264, H.265/HEVC, VP8/VP9, AV1, MPEG-2/4, ProRes…) tối đa 1.600 MB, và ảnh PNG, JPG, GIF, WebP, BMP, AVIF, HEIC tối đa 25 MB. Video không phải MP4 H.264 được tự động chuyển sang MP4 H.264/AAC: ngay trên trình duyệt nếu máy giải mã được, nếu không thì máy chủ chuyển mã (cần media-worker; chưa có worker thì tệp chờ duyệt thủ công). Không gắn khách hàng thì tệp nằm trong Kho chung và dùng được cho mọi chương trình phát sóng. Tệp lớn hơn 90 MB được tải lên từng phần (hiện % tiến độ, có thể hủy).';

const readDims = (f: File): Promise<Dims> =>
  new Promise((res) => {
    const url = URL.createObjectURL(f);
    const type = guessType(f);
    let fin = false;
    const done = (v: Dims) => { if (fin) return; fin = true; URL.revokeObjectURL(url); res(v); };
    setTimeout(() => done({}), 8000); // không treo giao diện nếu trình duyệt không đọc được tệp
    if (type.startsWith('image/')) {
      const i = new Image();
      i.onload = () => done({ width: i.naturalWidth, height: i.naturalHeight });
      i.onerror = () => done({});
      i.src = url;
    } else if (type.startsWith('video/')) {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.onloadedmetadata = () => done({ width: v.videoWidth, height: v.videoHeight, duration_sec: Math.round(v.duration) });
      v.onerror = () => done({});
      v.src = url;
    } else done({});
  });

/** Liên kết dán vào: tự nhận nguồn (Drive/Dropbox/YouTube/tệp trực tiếp). */
export function detectLinkSource(raw: string): LinkSource | null {
  try {
    const h = new URL(raw.trim()).hostname.toLowerCase();
    if (h === 'drive.google.com' || h === 'docs.google.com' || h === 'drive.usercontent.google.com') return 'drive';
    if (h === 'dropbox.com' || h.endsWith('.dropbox.com') || h.endsWith('dropboxusercontent.com')) return 'dropbox';
    if (h === 'youtu.be' || h === 'youtube.com' || h.endsWith('.youtube.com')) return 'youtube';
    return 'url';
  } catch {
    return null;
  }
}

const CEILINGS: { v: Ceiling; label: string }[] = [
  { v: 720, label: 'HD (nhẹ nhất)' },
  { v: 1080, label: 'Full HD (khuyên dùng)' },
  { v: 1440, label: '2K' },
  { v: 2160, label: '4K (nặng)' },
];

export function UploadDialog({ open, onClose, initialFile, autoPick }: { open: boolean; onClose: () => void; initialFile?: File | null; autoPick?: boolean }) {
  const t = useT();
  const base = useBase();
  const act = useAct();
  const [stage, setStage] = useState<Stage>('pick');
  const [file, setFile] = useState<File | null>(null);
  const [an, setAn] = useState<Analysis | null>(null);
  const [target, setTarget] = useState<TargetKind>('elevator');
  const [targetTouched, setTargetTouched] = useState(false);
  const [autoConvert, setAutoConvert] = useState(true);
  const [trim, setTrim] = useState(false);
  const [ceiling, setCeiling] = useState<Ceiling>(DEFAULT_CEILING);
  const [url, setUrl] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [ov, setOv] = useState(emptyOverlay());
  const [err, setErr] = useState('');
  const [prog, setProg] = useState<{ phase: Phase; percent: number; label: string } | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [drag, setDrag] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const resumeRef = useRef<{ key: string; u: { id: string; url: string; via?: 'direct' | 'proxy' | 'multipart' | undefined } } | null>(null);
  const convertedRef = useRef<{ key: string; file: File } | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const custs = useQuery({ queryKey: ['/admin/v1/customers', 'pick'], enabled: open && !base.isExternal, queryFn: () => api.get('/admin/v1/customers', { query: { page_size: 200 }, schema: listOf(customerSchema) }) });
  const working = stage === 'working';
  const library = !base.isExternal && !customerId; // nhân viên không gắn khách hàng: Kho chung, mọi định dạng/codec; chọn khách hàng cụ thể thì giữ chuẩn nghiêm ngặt

  // đang chuyển/tải: cảnh báo khi người dùng đóng tab
  useEffect(() => {
    if (!working) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [working]);

  const reset = () => {
    setStage('pick'); setFile(null); setAn(null); setErr(''); setProg(null); setDone(null); setTrim(false); setAutoConvert(true); setTargetTouched(false); setUrl('');
    resumeRef.current = null; convertedRef.current = null;
    if (fileInput.current) fileInput.current.value = '';
  };

  const pick = async (f: File | null) => {
    setErr('');
    setDone(null);
    resumeRef.current = null;
    convertedRef.current = null;
    if (!f) { setFile(null); setAn(null); setStage('pick'); return; }
    const type = guessType(f);
    if (!(library ? isLibraryType(type) : isAcceptedType(type))) {
      setFile(null); setAn(null); setStage('pick');
      setErr(library ? 'Chỉ nhận tệp video hoặc ảnh (MP4, MOV, AVI, FLV, RMVB, MKV, WebM, PNG, JPG, GIF, WebP…).' : 'Chỉ nhận video MP4, MOV, WebM hoặc ảnh PNG, JPG.');
      return;
    }
    setFile(f);
    setStage('checking');
    setTrim(false);
    setAutoConvert(true);
    setTargetTouched(false);
    const isVideo = type.startsWith('video/');
    const src = isVideo ? await probeVideo(f) : null;
    const dims: Dims = src ? {} : await readDims(f); // probe đọc được thì không cần thẻ <video>
    if (src) {
      setTarget(inferTarget(src.width, src.height));
      setAn({ src, isVideo, dims: { width: src.width, height: src.height, duration_sec: Math.round(src.durationSec) } });
    } else {
      if (dims.width && dims.height) setTarget(inferTarget(dims.width, dims.height));
      setAn({ src: null, isVideo, dims });
    }
    setStage('ready');
  };

  // mở từ thẻ lỗi nhập liên kết: mở luôn hộp chọn tệp (được phép vì vừa có thao tác bấm của người dùng)
  useEffect(() => {
    if (open && autoPick) {
      const id = setTimeout(() => fileInput.current?.click(), 50);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [open, autoPick]);

  // mở từ nơi khác với một tệp có sẵn (nút "Chọn tệp từ máy" ở thẻ lỗi nhập liên kết thì chỉ mở hộp chọn tệp)
  useEffect(() => {
    if (open && initialFile) void pick(initialFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialFile]);

  const a = useMemo(() => (an?.src ? assessSource(an.src, target) : null), [an, target]);
  const canConvert = webCodecsSupported();
  // Kho chung: chỉ chuyển khi codec/container chưa phải MP4 H.264 và trình duyệt giải mã được (không ép thời lượng/tỉ lệ/loại màn); còn lại máy chủ chuyển mã sau.
  const libNeedsConvert = library && !!an?.src && (an.src.codec !== 'avc' || !['mp4', 'mov', 'm4v'].includes(an.src.container));
  const required = !library && !!a?.needsConvert;
  const needTrim = !library && !!a?.trimTo;
  // chuyển khi: bắt buộc, hoặc cần cắt ngắn, hoặc nên chuyển và người dùng để bật
  const willConvert = library
    ? libNeedsConvert && canConvert && autoConvert
    : !!a && (a.needsConvert || (needTrim && trim) || (a.offerConvert && autoConvert)) && (canConvert || a.needsConvert || (needTrim && trim));
  const plan = useMemo(() => {
    if (!an?.src) return null;
    const p = pickSettings(an.src, target, { ceiling, trim: !library && needTrim && trim });
    if (library) {
      // bitrate theo bậc chuẩn, không bó theo tần dung lượng của loại màn (kho chung không giới hạn theo màn)
      const tierBps = RULES[target].tiers.find((x) => x.label === p.settings.tierLabel)?.videoBps;
      if (tierBps) p.settings.videoBps = tierBps;
      return { ...p, tooBig: false };
    }
    return p;
  }, [an, target, ceiling, trim, needTrim, library]);
  const blockers: string[] = [];
  if (!library) {
    if (a && willConvert && !canConvert) blockers.push(TRANSCODE_MESSAGES.unsupported_browser);
    if (a?.blockers.includes('too_short')) blockers.push(`Video quá ngắn (tối thiểu ${RULES[target].durationMin} giây cho màn này). Hãy chọn video dài hơn.`);
    if (a && needTrim && !trim) blockers.push(`Video dài ${fmtDuration(an!.src!.durationSec)}, màn này nhận tối đa ${a.trimTo} giây. Hãy tích "Cắt lấy ${a.trimTo} giây đầu" bên dưới, hoặc chọn video ngắn hơn.`);
    if (plan?.tooBig && willConvert) blockers.push(TRANSCODE_MESSAGES.too_big);
    if (an && !an.isVideo && file && file.size > MAX_IMAGE_BYTES) blockers.push(`Ảnh ${fmtMb(file.size)} lớn hơn giới hạn ${MAX_IMAGE_BYTES / MB} MB.`);
  } else if (file && an) {
    if (an.isVideo && file.size > LIBRARY_VIDEO_MAX) blockers.push(`Video ${fmtMb(file.size)} lớn hơn giới hạn ${LIBRARY_VIDEO_MAX / MB} MB.`);
    if (!an.isVideo && file.size > LIBRARY_IMAGE_MAX) blockers.push(`Ảnh ${fmtMb(file.size)} lớn hơn giới hạn ${LIBRARY_IMAGE_MAX / MB} MB.`);
  }

  const linkSource = url.trim() ? detectLinkSource(url) : null;
  const linkCheck = url.trim() && linkSource ? checkMediaUrl(linkSource, url) : url.trim() ? { ok: false, message: 'Liên kết không hợp lệ.' } : null;

  const mapProgress = (phase: Phase, frac: number, label: string) => setProg({ phase, percent: overallPercent(phase, frac, willConvert), label });

  const submitFile = async () => {
    if (!file) throw new Error('Chọn một tệp.');
    let toSend = file;
    let dims: Dims = an?.dims ?? {};
    const ctl = new AbortController();
    abortRef.current = ctl;
    if (willConvert && an?.src && plan) {
      const ckey = `${file.name}|${file.size}|${file.lastModified}|${JSON.stringify(plan.settings)}`;
      if (convertedRef.current?.key === ckey) toSend = convertedRef.current.file;
      else {
        mapProgress('convert', 0, 'Đang chuyển sang chuẩn phát được… 0%');
        toSend = await transcodeVideo(file, plan.settings, {
          signal: ctl.signal,
          onProgress: (p) => {
            const eta = etaSeconds(p.fraction, p.elapsedSec);
            mapProgress('convert', p.fraction, `Đang chuyển sang chuẩn phát được… ${Math.round(p.fraction * 100)}%${eta !== null ? ` · còn khoảng ${fmtDuration(eta)}` : ''}`);
          },
        });
        convertedRef.current = { key: ckey, file: toSend };
      }
      dims = { width: plan.settings.width, height: plan.settings.height, duration_sec: Math.round(plan.settings.outDurationSec) };
      const cap = RULES[target].maxBytes;
      if (!library && toSend.size > cap) throw new TranscodeError('too_big', `${TRANSCODE_MESSAGES.too_big} (${fmtMb(toSend.size)} / ${cap / MB} MB)`);
    }
    const sendType = guessType(toSend);
    const fkey = `${toSend.name}|${toSend.size}|${toSend.lastModified}`;
    let u = resumeRef.current?.key === fkey ? resumeRef.current.u : null;
    if (!u) {
      mapProgress('upload', 0, 'Đang tải lên… 0%');
      u = await api.post(`${base.media}/upload-url`, { body: { name: toSend.name, content_type: sendType, size_bytes: toSend.size, ...dims, ...(customerId ? { customer_id: customerId } : {}), format: ov.format, ...(overlayPayload(ov) ? { overlay: overlayPayload(ov) } : {}) }, schema: uploadUrlSchema });
    }
    try {
      await uploadToStore(base.media, u, toSend, {
        signal: ctl.signal,
        onProgress: (p: UploadProgress) => mapProgress('upload', p.percent / 100, `Đang tải lên… ${p.percent}% · ${fmtBytes(p.loaded)} / ${fmtBytes(p.total)}${p.totalParts ? ` · phần ${p.part}/${p.totalParts}` : ''}`),
      });
      resumeRef.current = null;
    } catch (e) {
      // lỗi mạng/phần: giữ phiên để tải lại tiếp tục; hết hạn/đã hủy/không còn quyền: bỏ phiên
      const code = e instanceof UploadError ? e.code : '';
      resumeRef.current = u.via === 'multipart' && /^UP-(PART|COMPLETE)-/.test(code) && !/-(401|403|404|409|422)$/.test(code) ? { key: fkey, u } : null;
      throw e;
    }
    mapProgress('finish', 0.2, 'Đang kiểm tra tệp…');
    const confirmed = (await api.post(`${base.media}/${u.id}/confirm`, { body: { ...dims } })) as { status?: string; warnings?: string[]; thumb_url?: string | null } | null;
    mapProgress('finish', 0.7, 'Đang hoàn tất…');
    let thumb: string | null = null;
    if (thumbSupported()) {
      try {
        const tb = await captureThumbnail(toSend, sendType, { durationSec: dims.duration_sec });
        if (tb) {
          await putBlob(`${base.media}/${u.id}/thumbnail`, tb);
          thumb = URL.createObjectURL(tb);
        }
      } catch { /* im lặng: sẽ tự tạo lại khi mở trang Media */ }
    }
    if (!thumb && confirmed?.thumb_url) thumb = resolveThumbUrl(confirmed.thumb_url, API_BASE);
    return { name: toSend.name, status: confirmed?.status ?? null, thumb, warnings: confirmed?.warnings ?? [], converted: toSend !== file, sizeNote: toSend !== file ? `${fmtMb(file.size)} → ${fmtMb(toSend.size)}` : fmtMb(toSend.size) } satisfies Done;
  };

  const submit = async () => {
    setErr('');
    const oe = overlayError(ov);
    if (oe) return setErr(oe);
    if (file) {
      if (blockers.length) return setErr(blockers[0]!);
      setStage('working');
      try {
        const d = await submitFile();
        await act(async () => undefined, undefined, [base.media, '/admin/v1/media', '/portal/v1/media']);
        setDone(d);
        setStage('done');
      } catch (e) {
        const code = e instanceof UploadError ? e.code : e instanceof TranscodeError ? e.code : '';
        setErr(code === 'UP-ABORT' ? 'Đã hủy tải lên.' : e instanceof TranscodeError ? (e.code === 'canceled' ? 'Đã hủy chuyển video.' : e.message) : errMsg(e));
        setStage('ready');
      } finally {
        abortRef.current = null;
        setProg(null);
      }
      return;
    }
    // liên kết
    if (!linkSource) return setErr('Dán liên kết Google Drive, Dropbox hoặc liên kết tệp trực tiếp.');
    const c = checkMediaUrl(linkSource, url);
    if (!c.ok) return setErr(c.message);
    setStage('working');
    setProg({ phase: 'upload', percent: 10, label: 'Đang gửi yêu cầu…' });
    try {
      await api.post(`${base.media}/import`, { body: { source: linkSource, url: url.trim(), ...(customerId ? { customer_id: customerId } : {}), format: ov.format, ...(overlayPayload(ov) ? { overlay: overlayPayload(ov) } : {}) } });
      await act(async () => undefined, 'Đã gửi yêu cầu tải từ liên kết. Tiến độ hiện ở thẻ tệp (tự cập nhật); nếu tệp cần chuyển sang H.264, hệ thống sẽ hướng dẫn bạn tải tệp về máy rồi kéo vào ô tải lên.', [base.media, '/admin/v1/media', '/portal/v1/media']);
      reset();
      onClose();
    } catch (e) {
      setErr(errMsg(e));
      setStage('pick');
    } finally {
      setProg(null);
    }
  };

  const cancel = () => abortRef.current?.abort();
  const close = () => { if (!working) { reset(); onClose(); } };
  const src = an?.src ?? null;
  const reasons: Reason[] = a ? [...a.required, ...a.recommended.filter((r) => r !== 'container' || !a.required.length)] : [];
  const eta = plan && willConvert ? estimateSeconds(plan.settings.outDurationSec, plan.settings.width, plan.settings.height) : 0;
  const primaryLabel = working ? t('Đang tải…') : file ? (willConvert ? (library ? 'Chuyển sang H.264 và tải lên' : 'Tự động chuyển sang chuẩn phát được') : 'Tải lên') : 'Nhập từ liên kết';
  const canSubmit = !working && (file ? stage === 'ready' && !blockers.length : !!linkCheck?.ok && linkSource !== 'youtube') && !(stage === 'checking');

  return (
    <Dialog open={open} onClose={close} size="lg" label="Tải nội dung">
      <form onSubmit={(e) => { e.preventDefault(); if (canSubmit) void submit(); }}>
        <h2 style={{ margin: '0 0 10px', fontSize: 18 }}>{t('Tải nội dung mới')}</h2>

        {stage === 'done' && done ? (
          <div role="status" aria-label="Tải lên xong">
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div style={{ width: 120, aspectRatio: '9 / 16', background: 'var(--line, #E5E7EB)', borderRadius: 12, overflow: 'hidden', display: 'grid', placeItems: 'center', fontSize: 12, color: 'var(--mut)' }}>
                {done.thumb ? <img src={done.thumb} alt={`Ảnh đại diện ${done.name}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : 'Chưa có ảnh'}
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <b>{done.name}</b>
                <p style={{ margin: '6px 0' }}>{uploadDoneMessage(done.status)}</p>
                {done.converted ? <p style={{ margin: '6px 0', fontSize: 13, color: 'var(--mut)' }}>Đã chuyển sang chuẩn phát được ({done.sizeNote}).</p> : null}
                {done.warnings.map((w) => <p key={w} style={{ margin: '6px 0', fontSize: 13, color: 'var(--warn, #B45309)' }}>Lưu ý: {w}</p>)}
              </div>
            </div>
            <div className="da" style={{ marginTop: 14 }}>
              <button type="button" className="btn" onClick={reset}>Tải thêm tệp</button>
              <button type="button" className="btn p" onClick={close}>Xong</button>
            </div>
          </div>
        ) : (
          <>
            {!base.isExternal ? (
              <Field label="Gắn khách hàng (không bắt buộc)" hint="Để trống: tệp vào Kho chung, dùng được cho mọi chương trình phát sóng. Chọn khách hàng nếu nội dung thuộc ví và hợp đồng của họ.">
                <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} aria-label="Khách hàng sở hữu nội dung" disabled={working}>
                  <option value="">Kho chung (không gắn khách hàng)</option>
                  {(custs.data?.items ?? []).map((c) => <option key={c.id} value={c.id}>{c.short_name || c.legal_name}{c.code ? ` (${c.code})` : ''}</option>)}
                </select>
              </Field>
            ) : null}

            {/* ô kéo thả */}
            <label
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); if (!working) void pick(e.dataTransfer.files?.[0] ?? null); }}
              style={{ display: 'block', border: `2px dashed ${drag ? 'var(--pri, #2563EB)' : 'var(--line, #CBD5E1)'}`, borderRadius: 16, padding: '22px 16px', textAlign: 'center', cursor: working ? 'default' : 'pointer', background: drag ? 'var(--pri-t, #EFF6FF)' : 'transparent', margin: '8px 0' }}
            >
              <input ref={fileInput} type="file" aria-label="Chọn tệp để tải lên" accept={library ? 'video/*,image/*,.mkv,.avi,.flv,.rmvb,.rm,.wmv,.3gp,.mpg,.mpeg,.ts,.m2ts,.vob,.heic,.heif' : 'video/mp4,video/quicktime,video/webm,image/png,image/jpeg'} disabled={working} onChange={(e) => void pick(e.target.files?.[0] ?? null)} style={{ position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' }} />
              {file ? <><b>{file.name}</b><div style={{ color: 'var(--mut)', fontSize: 13 }}>{fmtMb(file.size)} · bấm để chọn tệp khác</div></> : <><b>Kéo tệp vào đây</b> hoặc bấm để chọn<div style={{ color: 'var(--mut)', fontSize: 13, marginTop: 4 }}>{library ? 'Mọi định dạng video (MP4, MOV, AVI, FLV, RMVB, MKV, WebM…) hoặc ảnh (PNG, JPG, GIF, WebP…)' : 'Video (MP4, MOV, WebM) hoặc ảnh (PNG, JPG)'}</div></>}
            </label>

            {stage === 'checking' ? <p role="status" style={{ margin: '8px 0' }}>Đang kiểm tra tệp…</p> : null}

            {/* kết quả kiểm tra, ngôn ngữ đơn giản */}
            {stage !== 'checking' && file && an ? (
              <div style={{ margin: '8px 0' }}>
                {library ? (
                  <>
                    <p role="status" aria-label="Kết quả kiểm tra" style={{ margin: '0 0 6px', padding: '10px 12px', borderRadius: 12, background: an.isVideo && (!src || libNeedsConvert) ? 'var(--warn-t, #FEF3C7)' : 'var(--ok-t, #DCFCE7)' }}>
                      {!an.isVideo
                        ? 'Ảnh sẽ được tải lên Kho chung.'
                        : !src
                          ? 'Trình duyệt chưa đọc được video này (định dạng/codec đặc biệt). Tệp vẫn được tải lên nguyên bản; máy chủ sẽ chuyển sang MP4 H.264/AAC (cần media-worker, nếu chưa có thì chờ duyệt thủ công).'
                          : libNeedsConvert
                            ? (willConvert ? 'Video sẽ được tự động chuyển sang MP4 H.264/AAC ngay trên máy bạn rồi tải lên.' : 'Video sẽ được tải nguyên bản; máy chủ chuyển sang MP4 H.264/AAC sau khi tải (cần media-worker).')
                            : 'Video đã là MP4 H.264, tải lên ngay được.'}
                    </p>
                    <p aria-label="Thông tin tệp" style={{ margin: '0 0 6px', fontSize: 13, color: 'var(--mut)' }}>
                      {src
                        ? `Phát hiện: ${src.container.toUpperCase()} · ${src.codec ? src.codec.toUpperCase() : 'không rõ codec'} · ${src.width}×${src.height} · ${fmtDuration(src.durationSec)} · ${fmtMb(src.sizeBytes)}`
                        : `Phát hiện: ${(file.name.split('.').pop() ?? '').toUpperCase()}${an.dims.width ? ` · ${an.dims.width}×${an.dims.height}` : ''} · ${fmtMb(file.size)}`}
                    </p>
                    {libNeedsConvert && canConvert ? (
                      <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '4px 0', fontSize: 14 }}>
                        <input type="checkbox" checked={autoConvert} disabled={working} onChange={(e) => setAutoConvert(e.target.checked)} />
                        Chuyển sang MP4 H.264 ngay trên máy tôi trước khi tải (không cần chờ máy chủ)
                      </label>
                    ) : null}
                    {libNeedsConvert && canConvert && autoConvert && plan ? (
                      <p style={{ margin: '6px 0', fontSize: 13, color: 'var(--mut)' }}>{`Thông số: ${plan.settings.tierLabel}, dự kiến khoảng ${fmtDuration(eta)}. Hãy giữ tab này mở trong lúc chuyển.`}</p>
                    ) : null}
                  </>
                ) : an.isVideo && src && a ? (
                  <>
                    <p role="status" aria-label="Kết quả kiểm tra" style={{ margin: '0 0 6px', padding: '10px 12px', borderRadius: 12, background: a.needsConvert ? 'var(--warn-t, #FEF3C7)' : 'var(--ok-t, #DCFCE7)' }}>
                      {a.needsConvert ? 'Tệp này cần chuyển sang chuẩn phát được trước khi tải lên.' : a.offerConvert ? 'Tệp dùng được, nhưng nên chuyển sang chuẩn phổ biến nhất để phát mượt hơn.' : 'Tệp đạt chuẩn, có thể tải lên ngay.'}
                    </p>
                    {reasons.length ? <ul aria-label="Lý do" style={{ margin: '0 0 8px', paddingLeft: 18, fontSize: 13 }}>{reasons.map((r) => <li key={r}>{reasonText(r, src, target)}</li>)}</ul> : null}
                    <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '4px 0', fontSize: 14 }}>
                      Dành cho:
                      <select aria-label="Dành cho loại màn hình" value={target} disabled={working} onChange={(e) => { setTarget(e.target.value as TargetKind); setTargetTouched(true); }}>
                        <option value="elevator">Màn thang máy (đặt dọc)</option>
                        <option value="tv">Màn TV (nằm ngang)</option>
                      </select>
                      {!targetTouched ? <span style={{ color: 'var(--mut)', fontSize: 12.5 }}>(tự nhận theo hình)</span> : null}
                    </label>
                    {a.offerConvert && !required ? (
                      <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '4px 0', fontSize: 14 }}>
                        <input type="checkbox" checked={autoConvert} disabled={working || !canConvert} onChange={(e) => setAutoConvert(e.target.checked)} />
                        Tự động chuyển sang chuẩn phát được (khuyên dùng)
                      </label>
                    ) : null}
                    {needTrim ? (
                      <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '4px 0', fontSize: 14 }}>
                        <input type="checkbox" checked={trim} disabled={working} onChange={(e) => setTrim(e.target.checked)} />
                        {`Cắt lấy ${a.trimTo} giây đầu (video dài ${fmtDuration(src.durationSec)})`}
                      </label>
                    ) : null}
                    {willConvert && plan ? (
                      <p style={{ margin: '6px 0', fontSize: 13, color: 'var(--mut)' }}>
                        {`Hệ thống tự chọn thông số phù hợp (${plan.settings.tierLabel}). Dự kiến mất khoảng ${fmtDuration(eta)}. Hãy giữ tab này mở và đừng tắt máy trong lúc chuyển.`}
                      </p>
                    ) : null}
                  </>
                ) : an.isVideo ? (
                  <p role="status" aria-label="Kết quả kiểm tra" style={{ margin: 0, fontSize: 13, color: 'var(--mut)' }}>Chưa đọc được thông tin chi tiết của video này; hệ thống sẽ kiểm tra sau khi tải lên.</p>
                ) : null}
                {blockers.length ? <p role="alert" style={{ color: 'var(--bad)', margin: '6px 0 0' }}>{blockers[0]}</p> : null}
                {src ? (
                  <details style={{ marginTop: 8 }}>
                    <summary style={{ cursor: 'pointer', fontSize: 13 }}>Chi tiết</summary>
                    <div style={{ fontSize: 13, color: 'var(--mut)', marginTop: 6 }}>
                      <div>{`Tệp gốc: ${src.container.toUpperCase()}, ${src.codec ? src.codec.toUpperCase() : 'không rõ codec'}, ${src.width}×${src.height}, ${fmtDuration(src.durationSec)}, ${src.fps ? `${Math.round(src.fps)} khung/giây, ` : ''}${src.bitrateBps ? `${(src.bitrateBps / 1e6).toFixed(1)} Mbps, ` : ''}${fmtMb(src.sizeBytes)}`}</div>
                      {plan && willConvert ? <div>{`Sẽ chuyển thành: MP4 H.264 ${plan.settings.width}×${plan.settings.height}, ${plan.settings.fps} khung/giây, ${(plan.settings.videoBps / 1e6).toFixed(1)} Mbps, AAC ${AUDIO_BPS / 1000} kbps, mốc hình mỗi ${plan.settings.keyFrameSec} giây, thông tin đầu tệp (faststart), dung lượng khoảng ${fmtMb(plan.estimatedBytes)}`}</div> : null}
                      <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
                        Độ phân giải tối đa khi chuyển:
                        <select aria-label="Độ phân giải tối đa khi chuyển" value={ceiling} disabled={working} onChange={(e) => setCeiling(Number(e.target.value) as Ceiling)}>
                          {CEILINGS.filter((c) => RULES[target].tiers.some((x) => Math.min(x.w, x.h) >= c.v)).map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
                        </select>
                      </label>
                    </div>
                  </details>
                ) : null}
              </div>
            ) : null}

            {/* dán liên kết */}
            {!file ? (
              <div style={{ margin: '10px 0' }}>
                <Field label="Hoặc dán liên kết Google Drive / Dropbox" hint="Drive: chia sẻ ở chế độ “Bất kỳ ai có đường liên kết”. Tệp tối đa 200 MB. Nếu tệp cần chuyển sang H.264, hãy tải về máy rồi kéo vào ô trên, hệ thống sẽ tự chuyển.">
                  <input type="url" aria-label="Liên kết Google Drive hoặc Dropbox" placeholder="https://…" value={url} disabled={working} onChange={(e) => { setUrl(e.target.value); setErr(''); }} />
                </Field>
                {linkSource === 'youtube' ? <p role="status" style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--bad)' }}>Chưa hỗ trợ tải từ YouTube. Hãy tải video về máy rồi kéo vào ô tải lên (hệ thống tự chuyển sang chuẩn phát được). Phần mô tả hiển thị bạn nhập bên dưới được giữ nguyên và áp dụng cho tệp tải lên.</p> : null}
                {linkCheck && linkSource !== 'youtube' ? <p role="status" style={{ margin: '4px 0 0', fontSize: 13, color: linkCheck.ok ? 'var(--mut)' : 'var(--bad)' }}>{linkCheck.message}</p> : null}
              </div>
            ) : null}

            <details style={{ marginTop: 6 }} open={!file && !!url.trim()}>
              <summary style={{ cursor: 'pointer', fontSize: 13 }}>{file ? 'Tùy chọn hiển thị (không bắt buộc)' : 'Mô tả hiển thị cho liên kết (không bắt buộc)'}</summary>
              <OverlayForm value={ov} onChange={setOv} />
            </details>

            <details style={{ marginTop: 6 }}>
              <summary style={{ cursor: 'pointer', fontSize: 13 }}>Giới hạn và quy định</summary>
              <p style={{ fontSize: 12.5, color: 'var(--mut)' }}>{library ? LIBRARY_LIMIT_TEXT : UPLOAD_LIMIT_TEXT}</p>
            </details>

            {prog ? (
              <div role="progressbar" aria-label="Tiến độ tải lên" aria-valuemin={0} aria-valuemax={100} aria-valuenow={prog.percent} style={{ marginTop: 12 }}>
                <div style={{ height: 10, borderRadius: 5, background: 'var(--line, #E5E7EB)', overflow: 'hidden' }}><div style={{ width: `${prog.percent}%`, height: '100%', background: 'var(--pri, #2563EB)', transition: 'width .2s' }} /></div>
                <div style={{ fontSize: 13, color: 'var(--mut)', marginTop: 4 }}>{`${prog.percent}% · ${prog.label}`}</div>
                <div style={{ fontSize: 12.5, color: 'var(--mut)' }}>Đừng đóng tab này cho đến khi xong.</div>
              </div>
            ) : null}
            {err ? <p role="alert" style={{ color: 'var(--bad)', margin: '8px 0 0' }}>{err}</p> : null}
            <div className="da" style={{ marginTop: 14 }}>
              {working && file ? <Btn tone="d" onClick={cancel}>Hủy</Btn> : <button type="button" className="btn" onClick={close}>{t('Hủy')}</button>}
              <button type="submit" className="btn p" disabled={!canSubmit} style={willConvert && file ? { fontSize: 16, padding: '12px 20px' } : undefined}>{primaryLabel}</button>
            </div>
          </>
        )}
      </form>
    </Dialog>
  );
}

