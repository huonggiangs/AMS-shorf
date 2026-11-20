import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, errMsg } from '../api/client';
import { customerSchema, listOf, mediaSchema, uploadUrlSchema, type Media } from '../api/schemas';
import { useAct, useBase } from '../api/hooks';
import { useAuth } from '../auth/AuthProvider';
import { Btn, EmptyBlock, ErrorBlock, Field, LoadingBlock, PageHead, StatusTag, Tabs } from '../components/ui';
import { Dialog } from '../components/Dialog';
import { PromptDialog } from '../components/Prompt';
import { reasonText } from './CreativeReview';
import { OverlayForm, emptyOverlay, overlayError, overlayPayload, AD_FORMAT_OPTIONS } from '../components/OverlayForm';
import { useT } from '../i18n';
import { checkMediaUrl, type LinkSource } from '../lib/creative';

const PAGE = 9;
const MAX_IMAGE_BYTES = 500 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
/** Giới hạn tải lên hiển thị cho người dùng (khớp services/api/src/lib/creative.ts + docs/CLOUDFLARE-MEDIA-LIMITS.md). Tệp đi thẳng lên kho R2 (không qua Worker 100 MB). */
export const UPLOAD_LIMIT_TEXT = 'Video: H.264 + AAC, tối đa 1920×1080 (Full HD), tối đa 100 MB; không nhận AV1/H.265/4K vì TV không phát ổn định và hệ thống không chuyển mã được. TV: 16:9, 5–60 giây. Thang máy: 768×1366 hoặc 1080×1920, 10–30 giây, tối đa 30 MB. LED: đúng kích thước bảng, 5–15 giây, tối đa 50 MB. Ảnh PNG/JPG tối đa 500 MB. Khách hàng còn bị giới hạn theo hạn mức tải lên của tài khoản.';

export default function MediaPage() {
  const t = useT();
  const { can } = useAuth();
  const base = useBase();
  const act = useAct();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [up, setUp] = useState(false);
  const [rej, setRej] = useState<string | null>(null);
  const [rev, setRev] = useState<string | null>(null);
  const query = useQuery({
    queryKey: [base.media, page, q, status],
    placeholderData: keepPreviousData,
    queryFn: () => api.get(base.media, { query: { page, page_size: PAGE, q, filter: status ? `status:${status}` : undefined }, schema: listOf(mediaSchema) }),
  });
  const pages = Math.max(1, Math.ceil((query.data?.total ?? 0) / PAGE));
  const canApprove = can('media', 'approve') && !base.isExternal;
  return (
    <>
      <PageHead title="Nội dung & Media" sub="Kho tệp quảng cáo và trạng thái kiểm duyệt." actions={can('media', 'write') ? <Btn tone="p" icon="plus" onClick={() => setUp(true)}>{t('Tải nội dung mới')}</Btn> : null} />
      <div className="tb" style={{ marginBottom: 12, background: 'none', padding: 0 }}>
        <label className="sr"><input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder={t('Tìm…')} aria-label={t('Tìm…')} /></label>
        <Tabs value={status} onChange={(v) => { setStatus(v); setPage(1); }} items={[{ id: '', label: 'Tất cả' }, { id: 'processing', label: 'Đang xử lý' }, { id: 'pending', label: 'Chờ duyệt' }, { id: 'approved', label: 'Đã duyệt' }, { id: 'rejected', label: 'Cần chỉnh sửa' }]} />
      </div>
      {query.isLoading ? <LoadingBlock /> : query.isError ? <ErrorBlock error={query.error} onRetry={() => void query.refetch()} /> : !query.data?.items.length ? <EmptyBlock /> : (
        <div className="g g3">
          {query.data.items.map((m) => <MediaCard key={m.id} m={m} canApprove={canApprove} onReview={() => setRev(m.id)} onAction={(a) => void act(() => api.post(`${base.media}/${m.id}/${a}`, a === 'confirm' ? { body: {} } : undefined), a === 'confirm' ? 'Đã xác nhận lại tệp.' : 'Đã gửi kiểm tra lại, kết quả hiện sau ít phút.')} onApprove={() => void act(() => api.post(`${base.media}/${m.id}/approve`), 'Đã duyệt media.')} onReject={() => setRej(m.id)} />)}
        </div>
      )}
      <div className="tf" style={{ background: 'none' }}>
        <span>{query.data?.total ?? 0} tệp</span>
        <div className="pg">{Array.from({ length: pages }, (_, i) => <button key={i} type="button" className={i + 1 === page ? 'on' : ''} onClick={() => setPage(i + 1)}>{i + 1}</button>)}</div>
      </div>
      <UploadDialog open={up} onClose={() => setUp(false)} />
      {rev ? <ReviewDialog id={rev} onClose={() => setRev(null)} /> : null}
      <PromptDialog open={!!rej} title="Trả lại media" label="Lý do (khách hàng nhận email kèm lý do)" onClose={() => setRej(null)} onSubmit={async (reason) => { if (rej) await act(() => api.post(`${base.media}/${rej}/reject`, { body: { reason } }), 'Đã trả lại.'); }} />
    </>
  );
}

function MediaCard({ m, canApprove, onApprove, onReject, onReview, onAction }: { m: Media; canApprove: boolean; onApprove: () => void; onReject: () => void; onReview: () => void; onAction: (a: 'confirm' | 'recheck') => void }) {
  const t = useT();
  const fmtLabel = m.format && m.format !== 'fullscreen' ? AD_FORMAT_OPTIONS.find((o) => o.id === m.format)?.label : null;
  const meta = [m.mime?.split('/')[1]?.toUpperCase(), fmtLabel, m.width && m.height ? `${m.width}×${m.height}` : null, m.duration_sec ? `${m.duration_sec} giây` : null].filter(Boolean).join(' · ');
  return (
    <div className="card">
      <div className="scr" style={{ borderRadius: '20px 20px 0 0' }}>
        {m.thumb_url ? <img src={m.thumb_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div className="ph">{m.kind === 'image' ? 'ẢNH' : 'VIDEO'}<br />{m.width && m.height ? `${m.width}×${m.height}` : ''}</div>}
      </div>
      <div className="cp" style={{ padding: 16 }}>
        <b>{m.name}</b>
        <div style={{ color: 'var(--mut)', fontSize: 13, margin: '2px 0 12px' }}>{meta || m.source_url || ''}{m.owner_name ? ` · ${m.owner_name}` : ''}</div>
        {m.reject_reason ? <div style={{ color: 'var(--bad)', fontSize: 13, marginBottom: 8 }}>{m.reject_reason}</div> : null}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <StatusTag status={m.status} />
          {m.status === 'pending' && canApprove && !m.blocker ? <span><Btn tone="p" className="sm" onClick={onApprove}>{t('Duyệt')}</Btn> <Btn className="sm" onClick={onReject}>{t('Trả lại')}</Btn></span> : null}
        </div>
        {m.status !== 'approved' && m.blocker ? <Blocker m={m} canApprove={canApprove} onReview={onReview} onAction={onAction} onReject={onReject} /> : null}
      </div>
    </div>
  );
}

/** Giải thích vì sao tệp chưa duyệt được + nút việc cần làm (xác nhận lại / kiểm tra lại / xem và duyệt tay). */
function Blocker({ m, canApprove, onReview, onAction, onReject }: { m: Media; canApprove: boolean; onReview: () => void; onAction: (a: 'confirm' | 'recheck') => void; onReject: () => void }) {
  const b = m.blocker!;
  return (
    <div role="status" aria-label="Vì sao chưa duyệt được" style={{ marginTop: 10, padding: '10px 12px', borderRadius: 12, background: 'var(--warn-t, #FEF3C7)', fontSize: 13 }}>
      <div>{b.message}</div>
      {m.scan_reasons.length ? <ul aria-label="Lý do cần kiểm tra" style={{ margin: '6px 0 0', paddingLeft: 18 }}>{m.scan_reasons.map((r) => <li key={r}>{reasonText(r)}</li>)}</ul> : null}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
        {b.action === 'manual_review' && canApprove ? <Btn tone="p" className="sm" onClick={onReview}>Xem và duyệt</Btn> : null}
        {b.action === 'manual_review' && !canApprove ? <span>Cần người có quyền duyệt xem tệp.</span> : null}
        {b.action === 'confirm' ? <Btn className="sm" onClick={() => onAction('confirm')}>Xác nhận lại</Btn> : null}
        {b.action === 'recheck' || b.action === 'manual_review' ? <Btn className="sm" onClick={() => onAction('recheck')}>Kiểm tra lại</Btn> : null}
        {b.action === 'recheck' && canApprove ? <Btn className="sm" onClick={onReject}>Trả lại</Btn> : null}
      </div>
    </div>
  );
}

/** Xem trước phát được + lý do + duyệt MỘT BƯỚC (ghi chú bắt buộc, ghi nhật ký) hoặc trả lại. Dùng cho tệp 'chờ kiểm tra thủ công' (Cloudflare không có quét mã độc). */
function ReviewDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const base = useBase();
  const act = useAct();
  const q = useQuery({ queryKey: [base.media, 'one', id], queryFn: () => api.get(`${base.media}/${id}`, { schema: mediaSchema }) });
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState<'approve' | 'reject'>('approve');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const m = q.data;
  const submit = async () => {
    if (!m) return;
    const text = (mode === 'approve' ? note : reason).trim();
    if (text.length < 3) return setErr('Nhập ghi chú/lý do (tối thiểu 3 ký tự).');
    setErr('');
    setBusy(true);
    try {
      if (mode === 'approve') await api.post(`${base.media}/${m.id}/approve`, { body: { manual_review_note: text, content_version: m.content_version } });
      else await api.post(`${base.media}/${m.id}/reject`, { body: { reason: text } });
      await act(async () => undefined, mode === 'approve' ? 'Đã duyệt. Tệp có thể gắn vào chiến dịch.' : 'Đã trả lại.', [base.media, '/admin/v1/media']);
      onClose();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const isVideo = m?.kind === 'video' || m?.mime?.startsWith('video/');
  return (
    <Dialog open onClose={onClose} size="xl" label="Xem và duyệt tệp">
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <h2 style={{ margin: '0 0 10px', fontSize: 18 }}>Xem và duyệt: {m?.name ?? '…'}</h2>
        {q.isLoading || !m ? <LoadingBlock /> : (
          <div className="dlg-split">
            <div>
              {m.preview_url ? (isVideo ? <video src={m.preview_url} controls preload="metadata" aria-label={`Xem trước ${m.name}`} /> : <img src={m.preview_url} alt={`Xem trước ${m.name}`} />) : <div className="ph">Không có bản xem trước</div>}
              <div style={{ color: 'var(--mut)', fontSize: 13, marginTop: 6 }}>{[m.mime, m.width && m.height ? `${m.width}×${m.height}` : null, m.duration_sec ? `${m.duration_sec} giây` : null, m.size_bytes ? `${(m.size_bytes / 1048576).toFixed(1)} MB` : null].filter(Boolean).join(' · ')}</div>
            </div>
            <div>
              {m.blocker ? <p style={{ margin: '0 0 8px', fontSize: 13 }}>{m.blocker.message}</p> : null}
              {m.scan_reasons.length ? <ul aria-label="Lý do cần kiểm tra" style={{ margin: '0 0 10px', paddingLeft: 18, fontSize: 13 }}>{m.scan_reasons.map((r) => <li key={r}>{reasonText(r)}</li>)}</ul> : null}
              <Tabs value={mode} onChange={(v) => { setMode(v); setErr(''); }} items={[{ id: 'approve', label: 'Duyệt' }, { id: 'reject', label: 'Trả lại' }]} />
              {mode === 'approve'
                ? <Field label="Ghi chú kiểm tra (ghi vào nhật ký, tối thiểu 3 ký tự)" hint="Bạn xác nhận đã xem tệp, nội dung an toàn và đúng quy định quảng cáo."><textarea value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></Field>
                : <Field label="Lý do trả lại (khách hàng nhận email kèm lý do)"><textarea value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></Field>}
            </div>
          </div>
        )}
        {err ? <p role="alert" style={{ color: 'var(--bad)', margin: '8px 0 0' }}>{err}</p> : null}
        <div className="da" style={{ marginTop: 14 }}>
          <button type="button" className="btn" onClick={onClose}>Đóng</button>
          <button type="submit" className={`btn ${mode === 'approve' ? 'p' : 'd'}`} disabled={busy || !m}>{mode === 'approve' ? 'Duyệt tệp' : 'Trả lại'}</button>
        </div>
      </form>
    </Dialog>
  );
}

const readDims = (f: File): Promise<{ width?: number; height?: number; duration_sec?: number }> =>
  new Promise((res) => {
    const url = URL.createObjectURL(f);
    const done = (v: { width?: number; height?: number; duration_sec?: number }) => { URL.revokeObjectURL(url); res(v); };
    if (f.type.startsWith('image/')) {
      const i = new Image();
      i.onload = () => done({ width: i.naturalWidth, height: i.naturalHeight });
      i.onerror = () => done({});
      i.src = url;
    } else if (f.type.startsWith('video/')) {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.onloadedmetadata = () => done({ width: v.videoWidth, height: v.videoHeight, duration_sec: Math.round(v.duration) });
      v.onerror = () => done({});
      v.src = url;
    } else done({});
  });

export function UploadDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const base = useBase();
  const act = useAct();
  const [mode, setMode] = useState<'file' | LinkSource>('file');
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [ov, setOv] = useState(emptyOverlay());
  const custs = useQuery({ queryKey: ['/admin/v1/customers', 'pick'], enabled: open && !base.isExternal, queryFn: () => api.get('/admin/v1/customers', { query: { page_size: 200 }, schema: listOf(customerSchema) }) });
  const linkCheck = mode !== 'file' && url ? checkMediaUrl(mode, url) : null;

  const submit = async () => {
    setErr('');
    if (!base.isExternal && !customerId) return setErr('Chọn khách hàng sở hữu nội dung này.');
    const oe = overlayError(ov);
    if (oe) return setErr(oe);
    setBusy(true);
    try {
      if (mode === 'file') {
        if (!file) throw new Error('Chọn một tệp.');
        const isVideoFile = file.type.startsWith('video/');
        if (file.size > (isVideoFile ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES)) throw new Error(`Tệp ${(file.size / 1048576).toFixed(0)} MB lớn hơn giới hạn ${isVideoFile ? '100 MB cho video' : '500 MB'}. Hãy xuất lại video H.264 1080p (khoảng 8–10 Mbps), cắt ngắn 15–60 giây rồi tải lên.`);
        if (!/^(video\/(mp4|quicktime|webm)|image\/(png|jpeg))$/.test(file.type)) throw new Error('Chỉ nhận MP4, MOV, WebM, PNG hoặc JPG.');
        const dims = await readDims(file);
        if (isVideoFile && dims.width && dims.height && (Math.max(dims.width, dims.height) > 1920 || Math.min(dims.width, dims.height) > 1080)) throw new Error(`Video ${dims.width}×${dims.height} vượt Full HD 1920×1080. Hãy xuất lại ở 1080p (H.264 + AAC) rồi tải lên.`);
        const u = await api.post(`${base.media}/upload-url`, { body: { name: file.name, content_type: file.type, size_bytes: file.size, ...dims, ...(customerId ? { customer_id: customerId } : {}), format: ov.format, ...(overlayPayload(ov) ? { overlay: overlayPayload(ov) } : {}) }, schema: uploadUrlSchema });
        let put: Response;
        try {
          put = await fetch(u.url, { method: u.method ?? 'PUT', headers: { 'Content-Type': file.type, ...(u.headers ?? {}) }, body: file });
        } catch {
          throw new Error('Không tải được tệp lên kho lưu trữ (mất kết nối hoặc kho chưa cho phép tải từ trình duyệt). Kiểm tra mạng và thử lại; nếu vẫn lỗi, báo quản trị cấu hình CORS cho kho R2.');
        }
        if (!put.ok) throw new Error(put.status === 403 ? 'Đường dẫn tải lên đã hết hạn (15 phút). Hãy chọn tệp và tải lại.' : `Tải lên kho lưu trữ thất bại (${put.status}).`);
        await api.post(`${base.media}/${u.id}/confirm`, { body: { ...dims } });
      } else {
        const c = checkMediaUrl(mode, url);
        if (!c.ok) throw new Error(c.message);
        await api.post(`${base.media}/import`, { body: { source: mode, url: url.trim(), ...(customerId ? { customer_id: customerId } : {}) } });
      }
      await act(async () => undefined, 'Đã tải lên. Hệ thống kiểm tra cơ bản rồi chuyển tệp vào hàng chờ duyệt; xem trạng thái ở thẻ tệp.', [base.media, '/admin/v1/media', '/portal/v1/media']);
      setFile(null); setUrl(''); setOv(emptyOverlay());
      onClose();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} size="lg" label="Tải nội dung">
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <h2 style={{ margin: '0 0 10px', fontSize: 18 }}>{t('Tải nội dung mới')}</h2>
        {!base.isExternal ? (
          <Field label="Khách hàng sở hữu nội dung" hint="Nội dung do nhân viên tải lên được gắn vào ví và hợp đồng của khách hàng này.">
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} required aria-label="Khách hàng sở hữu nội dung">
              <option value="">— Chọn khách hàng —</option>
              {(custs.data?.items ?? []).map((c) => <option key={c.id} value={c.id}>{c.short_name || c.legal_name}{c.code ? ` (${c.code})` : ''}</option>)}
            </select>
          </Field>
        ) : null}
        <Tabs value={mode} onChange={(v) => { setMode(v); setErr(''); }} items={[{ id: 'file', label: 'Từ máy' }, { id: 'youtube', label: 'YouTube' }, { id: 'drive', label: 'Google Drive' }, { id: 'dropbox', label: 'Dropbox' }, { id: 'url', label: 'Liên kết trực tiếp' }]} />
        {mode === 'file' ? (
          <Field label="Tệp (MP4, MOV, WebM, PNG, JPG · tối đa 500 MB)" hint={`Tệp tải thẳng lên kho lưu trữ qua đường dẫn có thời hạn, rồi được kiểm tra định dạng, kích thước, thời lượng và chuyển vào hàng chờ duyệt. ${UPLOAD_LIMIT_TEXT}`}>
            <input type="file" accept="video/mp4,video/quicktime,video/webm,image/png,image/jpeg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Field>
        ) : (
          <Field label="Liên kết" hint="Chỉ lưu tham chiếu; hệ thống tải về và chuyển mã trước khi phát. Chỉ dùng nội dung có quyền sử dụng.">
            <input type="url" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} required />
          </Field>
        )}
        {mode === 'file' ? <OverlayForm value={ov} onChange={setOv} /> : null}
        {linkCheck ? <p role="status" style={{ margin: '6px 0 0', fontSize: 13, color: linkCheck.ok ? 'var(--mut)' : 'var(--bad)' }}>{linkCheck.message}</p> : null}
        {err ? <p role="alert" style={{ color: 'var(--bad)', margin: '8px 0 0' }}>{err}</p> : null}
        <div className="da" style={{ marginTop: 14 }}>
          <button type="button" className="btn" onClick={onClose}>{t('Hủy')}</button>
          <button type="submit" className="btn p" disabled={busy}>{busy ? t('Đang tải…') : 'Tải lên'}</button>
        </div>
      </form>
    </Dialog>
  );
}
