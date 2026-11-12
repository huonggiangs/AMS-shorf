import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, errMsg } from '../api/client';
import { customerSchema, listOf, mediaSchema, uploadUrlSchema, type Media } from '../api/schemas';
import { useAct, useBase } from '../api/hooks';
import { useAuth } from '../auth/AuthProvider';
import { Btn, EmptyBlock, ErrorBlock, Field, LoadingBlock, PageHead, StatusTag, Tabs } from '../components/ui';
import { Dialog } from '../components/Dialog';
import { PromptDialog } from '../components/Prompt';
import { OverlayForm, emptyOverlay, overlayError, overlayPayload, AD_FORMAT_OPTIONS } from '../components/OverlayForm';
import { useT } from '../i18n';
import { checkMediaUrl, type LinkSource } from '../lib/creative';

const PAGE = 9;
const MAX_BYTES = 500 * 1024 * 1024;

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
        <Tabs value={status} onChange={(v) => { setStatus(v); setPage(1); }} items={[{ id: '', label: 'Tất cả' }, { id: 'pending', label: 'Chờ duyệt' }, { id: 'approved', label: 'Đã duyệt' }, { id: 'rejected', label: 'Cần chỉnh sửa' }]} />
      </div>
      {query.isLoading ? <LoadingBlock /> : query.isError ? <ErrorBlock error={query.error} onRetry={() => void query.refetch()} /> : !query.data?.items.length ? <EmptyBlock /> : (
        <div className="g g3">
          {query.data.items.map((m) => <MediaCard key={m.id} m={m} canApprove={canApprove} onApprove={() => void act(() => api.post(`${base.media}/${m.id}/approve`), 'Đã duyệt media.')} onReject={() => setRej(m.id)} />)}
        </div>
      )}
      <div className="tf" style={{ background: 'none' }}>
        <span>{query.data?.total ?? 0} tệp</span>
        <div className="pg">{Array.from({ length: pages }, (_, i) => <button key={i} type="button" className={i + 1 === page ? 'on' : ''} onClick={() => setPage(i + 1)}>{i + 1}</button>)}</div>
      </div>
      <UploadDialog open={up} onClose={() => setUp(false)} />
      <PromptDialog open={!!rej} title="Trả lại media" label="Lý do (khách hàng nhận email kèm lý do)" onClose={() => setRej(null)} onSubmit={async (reason) => { if (rej) await act(() => api.post(`${base.media}/${rej}/reject`, { body: { reason } }), 'Đã trả lại.'); }} />
    </>
  );
}

function MediaCard({ m, canApprove, onApprove, onReject }: { m: Media; canApprove: boolean; onApprove: () => void; onReject: () => void }) {
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
          {m.status === 'pending' && canApprove ? <span><Btn tone="p" className="sm" onClick={onApprove}>{t('Duyệt')}</Btn> <Btn className="sm" onClick={onReject}>{t('Trả lại')}</Btn></span> : null}
        </div>
      </div>
    </div>
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
        if (file.size > MAX_BYTES) throw new Error('Tệp lớn hơn 500 MB.');
        if (!/^(video\/(mp4|quicktime|webm)|image\/(png|jpeg))$/.test(file.type)) throw new Error('Chỉ nhận MP4, MOV, WebM, PNG hoặc JPG.');
        const dims = await readDims(file);
        const u = await api.post(`${base.media}/upload-url`, { body: { name: file.name, content_type: file.type, size_bytes: file.size, ...dims, ...(customerId ? { customer_id: customerId } : {}), format: ov.format, ...(overlayPayload(ov) ? { overlay: overlayPayload(ov) } : {}) }, schema: uploadUrlSchema });
        const put = await fetch(u.url, { method: u.method ?? 'PUT', headers: { 'Content-Type': file.type, ...(u.headers ?? {}) }, body: file });
        if (!put.ok) throw new Error(`Tải lên kho lưu trữ thất bại (${put.status}).`);
        await api.post(`${base.media}/${u.id}/confirm`, { body: { ...dims } });
      } else {
        const c = checkMediaUrl(mode, url);
        if (!c.ok) throw new Error(c.message);
        await api.post(`${base.media}/import`, { body: { source: mode, url: url.trim(), ...(customerId ? { customer_id: customerId } : {}) } });
      }
      await act(async () => undefined, 'Đã gửi tệp, đang quét và chuyển mã trước khi vào hàng chờ duyệt.', [base.media, '/admin/v1/media', '/portal/v1/media']);
      setFile(null); setUrl(''); setOv(emptyOverlay());
      onClose();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} width="min(520px,96vw)" label="Tải nội dung">
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
          <Field label="Tệp (MP4, MOV, WebM, PNG, JPG · tối đa 500 MB)" hint="Tệp được lấy đường dẫn tải lên có thời hạn, quét mã độc, kiểm tra độ phân giải rồi mới vào hàng chờ duyệt.">
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
