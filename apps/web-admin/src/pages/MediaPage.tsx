import { useEffect, useRef, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { API_BASE, api, errMsg, putBlob } from '../api/client';
import { bulkDeleteResultSchema, listOf, mediaSchema, type BulkDeleteResult, type Media } from '../api/schemas';
import { useAct, useBase } from '../api/hooks';
import { useAuth } from '../auth/AuthProvider';
import { Btn, EmptyBlock, ErrorBlock, Field, LoadingBlock, PageHead, StatusTag, Tabs } from '../components/ui';
import { Dialog } from '../components/Dialog';
import { PromptDialog } from '../components/Prompt';
import { reasonText } from './CreativeReview';
import { AD_FORMAT_OPTIONS } from '../components/OverlayForm';
import { useT } from '../i18n';
import { fmtBytes, redactUrl, uploadToStore } from '../lib/upload';
import { UploadDialog, UPLOAD_LIMIT_TEXT } from '../components/UploadDialog';
export { fmtBytes, redactUrl, uploadToStore, UploadDialog, UPLOAD_LIMIT_TEXT };
import { captureThumbnail, pickBackfill, resolveThumbUrl, thumbSupported } from '../lib/thumbnail';

const PAGE = 9;
/** Tệp 'Đang xử lý' coi là kẹt: tạo hơn 30 phút trước mà không còn tiến độ chạy, hoặc nhập liên kết đã thất bại. */
export const STUCK_AFTER_MS = 30 * 60_000;
export function isStuck(m: Pick<Media, 'status' | 'created_at' | 'transfer'>, nowMs: number): boolean {
  if (m.status !== 'processing') return false;
  if (m.transfer?.status === 'failed') return true;
  const t = m.created_at ? Date.parse(m.created_at) : NaN;
  return Number.isFinite(t) && nowMs - t > STUCK_AFTER_MS && !(m.transfer && ['queued', 'running', 'open'].includes(m.transfer.status));
}
/** Mã lỗi nhập liên kết mà việc chuyển sang H.264 trên máy tính sửa được (máy chủ không chuyển mã được). */
export const CONVERT_ERROR_CODES = ['unsupported_codec', 'video_resolution_too_high', 'file_too_large', 'creative_size_mismatch'];
/** Xóa hàng loạt: tối đa 200 tệp mỗi lần gọi API (máy chủ giới hạn), quá 5 tệp phải gõ XOA để xác nhận. */
export const BULK_DELETE_MAX = 200;
export const BULK_CONFIRM_ABOVE = 5;
export const BULK_CONFIRM_WORD = 'XOA';
const SELECT_ALL_CAP = 5000;
export const chunkIds = (ids: string[], n = BULK_DELETE_MAX): string[][] => {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += n) out.push(ids.slice(i, i + n));
  return out;
};
type Picked = Record<string, { name: string; size: number }>;

/** Tao anh dai dien cho tep da tai truoc day: lay URL ky GET -> canvas -> PUT. Tra ve true neu thanh cong. Khong nem loi. */
async function backfillThumb(base: string, m: { id: string; mime?: string | null; duration_sec?: number | null }): Promise<boolean> {
  try {
    const one = await api.get(`${base}/${m.id}`, { schema: mediaSchema });
    if (!one.preview_url) return false;
    const blob = await captureThumbnail(one.preview_url, m.mime ?? 'video/mp4', { durationSec: m.duration_sec });
    if (!blob) return false;
    await putBlob(`${base}/${m.id}/thumbnail`, blob);
    return true;
  } catch {
    return false;
  }
}

export default function MediaPage() {
  const t = useT();
  const { can } = useAuth();
  const base = useBase();
  const act = useAct();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [up, setUp] = useState(false);
  const [autoPick, setAutoPick] = useState(false);
  const [rej, setRej] = useState<string | null>(null);
  const [rev, setRev] = useState<string | null>(null);
  const canDelete = can('media', 'delete') && !base.isExternal;
  const [picked, setPicked] = useState<Picked>({});
  const [delOpen, setDelOpen] = useState(false);
  const [allBusy, setAllBusy] = useState(false);
  const query = useQuery({
    queryKey: [base.media, page, q, status],
    placeholderData: keepPreviousData,
    // tep dang nhap tu lien ket / dang tai: tu cap nhat tien do moi 3 giay
    refetchInterval: (qq) => (qq.state.data?.items.some((m) => m.status === 'processing' && m.transfer && ['queued', 'running', 'open'].includes(m.transfer.status)) ? 3000 : false),
    queryFn: () => api.get(base.media, { query: { page, page_size: PAGE, q, filter: status ? `status:${status}` : undefined }, schema: listOf(mediaSchema) }),
  });
  const pages = Math.max(1, Math.ceil((query.data?.total ?? 0) / PAGE));
  const qc = useQueryClient();
  const tried = useRef<Set<string>>(new Set());
  const canWrite = can('media', 'write');
  // Tep cu chua co anh dai dien: tao ngam, tuan tu, toi da vai tep moi lan mo trang; im lang khi loi, khong chan giao dien.
  useEffect(() => {
    if (!canWrite || !thumbSupported() || !query.data) return;
    const todo = pickBackfill(query.data.items, tried.current);
    if (!todo.length) return;
    todo.forEach((m) => tried.current.add(m.id));
    let stop = false;
    void (async () => {
      let any = false;
      for (const m of todo) {
        if (stop) return;
        if (await backfillThumb(base.media, m)) any = true;
      }
      if (any && !stop) await qc.invalidateQueries({ queryKey: [base.media] });
    })();
    return () => { stop = true; };
  }, [query.data, canWrite, base.media, qc]);
  const makeThumb = async (m: Media) => {
    const ok = await backfillThumb(base.media, m);
    await act(async () => { if (!ok) throw new Error('Chưa tạo được ảnh đại diện (trình duyệt không đọc được video hoặc kho tệp chưa cho phép tải từ trình duyệt).'); }, 'Đã tạo ảnh đại diện.', [base.media]);
  };
  const canApprove = can('media', 'approve') && !base.isExternal;
  const pickedIds = Object.keys(picked);
  const pageItems = query.data?.items ?? [];
  const pageAllOn = pageItems.length > 0 && pageItems.every((m) => picked[m.id]);
  const toggle = (m: Media) => setPicked((p) => { const n = { ...p }; if (n[m.id]) delete n[m.id]; else n[m.id] = { name: m.name, size: m.size_bytes ?? 0 }; return n; });
  const togglePage = () => setPicked((p) => { const n = { ...p }; for (const m of pageItems) { if (pageAllOn) delete n[m.id]; else n[m.id] = { name: m.name, size: m.size_bytes ?? 0 }; } return n; });
  // "Chọn tất cả" theo bộ lọc hiện tại: lấy mọi trang khớp bộ lọc/ô tìm (tối đa SELECT_ALL_CAP tệp)
  const pickAllFiltered = async (keep?: (m: Media) => boolean): Promise<number> => {
    setAllBusy(true);
    try {
      const n: Picked = {};
      for (let pg = 1; Object.keys(n).length < SELECT_ALL_CAP; pg++) {
        const r = await api.get(base.media, { query: { page: pg, page_size: 200, q, filter: status ? `status:${status}` : undefined }, schema: listOf(mediaSchema) });
        for (const m of r.items) if (!keep || keep(m)) n[m.id] = { name: m.name, size: m.size_bytes ?? 0 };
        if (r.items.length < 200 || pg * 200 >= r.total) break;
      }
      setPicked(n);
      return Object.keys(n).length;
    } catch (e) {
      await act(async () => { throw e; });
      return 0;
    } finally {
      setAllBusy(false);
    }
  };
  // "Xóa tất cả tệp lỗi/kẹt": chỉ ở bộ lọc "Đang xử lý" (tệp đã kẹt quá 30 phút hoặc nhập liên kết thất bại) và "Cần chỉnh sửa" (mọi tệp bị từ chối); luôn qua hộp xác nhận
  const stuckFilter = status === 'processing' || status === 'rejected';
  const deleteStuck = async () => {
    const n = await pickAllFiltered(status === 'processing' ? (m) => isStuck(m, Date.now()) : undefined);
    if (n > 0) setDelOpen(true);
    else await act(async () => undefined, status === 'processing' ? 'Không có tệp nào bị kẹt (các tệp đang xử lý còn mới).' : 'Không có tệp lỗi nào.');
  };
  return (
    <>
      <PageHead title="Nội dung & Media" sub="Kho tệp quảng cáo và trạng thái kiểm duyệt." actions={can('media', 'write') ? <Btn tone="p" icon="plus" onClick={() => { setAutoPick(false); setUp(true); }}>{t('Tải nội dung mới')}</Btn> : null} />
      <div className="tb" style={{ marginBottom: 12, background: 'none', padding: 0 }}>
        <label className="sr"><input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder={t('Tìm…')} aria-label={t('Tìm…')} /></label>
        <Tabs value={status} onChange={(v) => { setStatus(v); setPage(1); }} items={[{ id: '', label: 'Tất cả' }, { id: 'processing', label: 'Đang xử lý' }, { id: 'pending', label: 'Chờ duyệt' }, { id: 'approved', label: 'Đã duyệt' }, { id: 'rejected', label: 'Cần chỉnh sửa' }]} />
      </div>
      {canDelete && pageItems.length ? (
        <div role="toolbar" aria-label="Chọn nhiều tệp để xóa" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <Btn className="sm" onClick={togglePage}>{pageAllOn ? 'Bỏ chọn trang này' : 'Chọn tất cả trang này'}</Btn>
          {(query.data?.total ?? 0) > pageItems.length ? <Btn className="sm" disabled={allBusy} onClick={() => void pickAllFiltered()}>{allBusy ? 'Đang chọn…' : `Chọn tất cả ${query.data?.total} tệp (theo bộ lọc hiện tại)`}</Btn> : null}
          {pickedIds.length ? <Btn className="sm" onClick={() => setPicked({})}>Bỏ chọn tất cả</Btn> : null}
          {stuckFilter ? <Btn tone="d" className="sm" disabled={allBusy} onClick={() => void deleteStuck()}>{status === 'processing' ? 'Xóa tất cả tệp bị kẹt' : 'Xóa tất cả tệp lỗi'}</Btn> : null}
          <span aria-live="polite" style={{ color: 'var(--mut)', fontSize: 13 }}>{pickedIds.length ? `Đã chọn ${pickedIds.length} tệp` : 'Chưa chọn tệp nào'}</span>
          <Btn tone="d" className="sm" disabled={!pickedIds.length} onClick={() => setDelOpen(true)}>{`Xóa đã chọn${pickedIds.length ? ` (${pickedIds.length})` : ''}`}</Btn>
        </div>
      ) : null}
      {query.isLoading ? <LoadingBlock /> : query.isError ? <ErrorBlock error={query.error} onRetry={() => void query.refetch()} /> : !query.data?.items.length ? <EmptyBlock /> : (
        <div className="g g3">
          {query.data.items.map((m) => <MediaCard key={m.id} m={m} canApprove={canApprove} internal={!base.isExternal} onPickFile={canWrite ? () => { setAutoPick(true); setUp(true); } : undefined} selectable={canDelete} selected={!!picked[m.id]} onToggle={() => toggle(m)} onMakeThumb={canWrite && thumbSupported() ? () => void makeThumb(m) : undefined} onReview={() => setRev(m.id)} onAction={(a) => void act(() => api.post(`${base.media}/${m.id}/${a === 'retry' ? 'import/retry' : a}`, a === 'confirm' ? { body: {} } : undefined), a === 'confirm' ? 'Đã xác nhận lại tệp.' : a === 'retry' ? 'Đã xếp lại việc tải từ liên kết.' : 'Đã gửi kiểm tra lại, kết quả hiện sau ít phút.')} onApprove={() => void act(() => api.post(`${base.media}/${m.id}/approve`), 'Đã duyệt media.')} onReject={() => setRej(m.id)} />)}
        </div>
      )}
      <div className="tf" style={{ background: 'none' }}>
        <span>{query.data?.total ?? 0} tệp</span>
        <div className="pg">{Array.from({ length: pages }, (_, i) => <button key={i} type="button" className={i + 1 === page ? 'on' : ''} onClick={() => setPage(i + 1)}>{i + 1}</button>)}</div>
      </div>
      <UploadDialog open={up} autoPick={autoPick} onClose={() => { setUp(false); setAutoPick(false); }} />
      {delOpen ? <DeleteSelectedDialog items={Object.entries(picked).map(([id, v]) => ({ id, ...v }))} onClose={() => setDelOpen(false)} onDone={(ids) => setPicked((p) => { const n = { ...p }; for (const id of ids) delete n[id]; return n; })} /> : null}
      {rev ? <ReviewDialog id={rev} onClose={() => setRev(null)} /> : null}
      <PromptDialog open={!!rej} title="Trả lại media" label="Lý do (khách hàng nhận email kèm lý do)" onClose={() => setRej(null)} onSubmit={async (reason) => { if (rej) await act(() => api.post(`${base.media}/${rej}/reject`, { body: { reason } }), 'Đã trả lại.'); }} />
    </>
  );
}

function MediaCard({ m, canApprove, internal, selectable, selected, onToggle, onMakeThumb, onApprove, onReject, onReview, onAction, onPickFile }: { m: Media; canApprove: boolean; internal?: boolean; onPickFile?: () => void; selectable?: boolean; selected?: boolean; onToggle?: () => void; onMakeThumb?: (() => void) | undefined; onApprove: () => void; onReject: () => void; onReview: () => void; onAction: (a: 'confirm' | 'recheck' | 'retry') => void }) {
  const t = useT();
  const fmtLabel = m.format && m.format !== 'fullscreen' ? AD_FORMAT_OPTIONS.find((o) => o.id === m.format)?.label : null;
  const meta = [m.mime?.split('/')[1]?.toUpperCase(), fmtLabel, m.width && m.height ? `${m.width}×${m.height}` : null, m.duration_sec ? `${m.duration_sec} giây` : null].filter(Boolean).join(' · ');
  return (
    <div className="card">
      <div className="scr" style={{ borderRadius: '20px 20px 0 0' }}>
        {m.thumb_url ? <img src={resolveThumbUrl(m.thumb_url, API_BASE) ?? ''} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div className="ph">{m.kind === 'image' ? 'ẢNH' : 'VIDEO'}<br />{m.width && m.height ? `${m.width}×${m.height}` : ''}{onMakeThumb && m.source === 'upload' && m.status !== 'processing' ? <><br /><button type="button" className="btn sm" onClick={onMakeThumb}>Tạo ảnh đại diện</button></> : null}</div>}
      </div>
      <div className="cp" style={{ padding: 16 }}>
        {selectable ? <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginBottom: 6 }}><input type="checkbox" checked={!!selected} onChange={onToggle} aria-label={`Chọn tệp ${m.name}`} />Chọn</label> : null}
        <b>{m.name}</b>
        <div style={{ color: 'var(--mut)', fontSize: 13, margin: '2px 0 12px' }}>{meta || m.source_url || ''}{m.owner_name ? ` · ${m.owner_name}` : ''}</div>
        {m.reject_reason ? <div style={{ color: 'var(--bad)', fontSize: 13, marginBottom: 8 }}>{m.reject_reason}</div> : null}
        <TransferBar m={m} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <StatusTag status={m.status} />
          {m.status === 'pending' && canApprove && !m.blocker ? <span><Btn tone="p" className="sm" onClick={onApprove}>{t('Duyệt')}</Btn> <Btn className="sm" onClick={onReject}>{t('Trả lại')}</Btn></span> : null}
        </div>
        {m.warnings?.length ? <ul aria-label="Lưu ý về tệp" style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12.5, color: 'var(--warn, #B45309)' }}>{m.warnings.map((w) => <li key={w}>{w}</li>)}</ul> : null}
        {m.status !== 'approved' && m.blocker ? <Blocker m={m} canApprove={canApprove} onReview={onReview} onAction={onAction} onReject={onReject} onPickFile={onPickFile} /> : null}
        {internal && m.diag ? <DiagBox d={m.diag} /> : null}
      </div>
    </div>
  );
}

/**
 * Hộp xác nhận xóa hàng loạt: nêu số tệp + dung lượng, cảnh báo không hoàn tác, quá 5 tệp phải gõ XOA.
 * Gọi POST /media/bulk-delete theo từng đợt <= 200 id; tệp đang dùng trong chiến dịch bị máy chủ BỎ QUA (hiện kèm lý do), không xóa ngầm.
 */
export function DeleteSelectedDialog({ items, onClose, onDone }: { items: { id: string; name: string; size: number }[]; onClose: () => void; onDone: (deletedIds: string[]) => void }) {
  const base = useBase();
  const qc = useQueryClient();
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [res, setRes] = useState<BulkDeleteResult | null>(null);
  const total = items.reduce((a, x) => a + x.size, 0);
  const needWord = items.length > BULK_CONFIRM_ABOVE;
  const okWord = !needWord || word.trim() === BULK_CONFIRM_WORD;
  const run = async () => {
    if (!okWord || busy) return;
    setBusy(true);
    setErr('');
    const agg: BulkDeleteResult = { requested: 0, deleted_count: 0, skipped_count: 0, freed_bytes: 0, objects_deleted: 0, deleted: [], skipped: [] };
    try {
      for (const ids of chunkIds(items.map((x) => x.id))) {
        const r = await api.post(`${base.media}/bulk-delete`, { body: { ids }, schema: bulkDeleteResultSchema });
        agg.requested += r.requested;
        agg.deleted_count += r.deleted_count;
        agg.skipped_count += r.skipped_count;
        agg.freed_bytes += r.freed_bytes;
        agg.deleted.push(...r.deleted);
        agg.skipped.push(...r.skipped);
      }
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
      if (agg.requested) {
        setRes(agg);
        onDone(agg.deleted.map((d) => d.id));
        await qc.invalidateQueries({ queryKey: [base.media] });
      }
    }
  };
  return (
    <Dialog open onClose={onClose} label="Xóa các tệp đã chọn">
      {res ? (
        <div>
          <h2 style={{ margin: '0 0 10px', fontSize: 18 }}>Kết quả xóa</h2>
          <p role="status" style={{ margin: '0 0 8px' }}>Đã xóa {res.deleted_count} tệp ({fmtBytes(res.freed_bytes)}). Bỏ qua {res.skipped_count} tệp.</p>
          {res.skipped.length ? <ul aria-label="Tệp bị bỏ qua" style={{ margin: 0, paddingLeft: 18, fontSize: 13, maxHeight: 220, overflow: 'auto' }}>{res.skipped.map((s) => <li key={s.id}><b>{s.name ?? s.id}</b>: {s.reason}</li>)}</ul> : null}
          {err ? <p role="alert" style={{ color: 'var(--bad)' }}>{err}</p> : null}
          <div className="da" style={{ marginTop: 14 }}><button type="button" className="btn p" onClick={onClose}>Đóng</button></div>
        </div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); void run(); }}>
          <h2 style={{ margin: '0 0 10px', fontSize: 18 }}>Xóa {items.length} tệp đã chọn?</h2>
          <p style={{ margin: '0 0 8px' }}>Sẽ xóa <b>{items.length} tệp</b>, tổng dung lượng <b>{fmtBytes(total)}</b>, gồm cả ảnh đại diện và tệp trong kho lưu trữ.</p>
          <p role="alert" style={{ margin: '0 0 8px', color: 'var(--bad)' }}>Thao tác này không thể hoàn tác. Tệp đang dùng trong chiến dịch đang phát hoặc đã lên lịch sẽ được bỏ qua, không bị xóa.</p>
          <ul aria-label="Một số tệp sẽ xóa" style={{ margin: '0 0 8px', paddingLeft: 18, fontSize: 13, maxHeight: 120, overflow: 'auto' }}>{items.slice(0, 8).map((x) => <li key={x.id}>{x.name}</li>)}{items.length > 8 ? <li>… và {items.length - 8} tệp khác</li> : null}</ul>
          {needWord ? <Field label={`Gõ ${BULK_CONFIRM_WORD} để xác nhận (vì xóa hơn ${BULK_CONFIRM_ABOVE} tệp)`}><input value={word} onChange={(e) => setWord(e.target.value)} autoComplete="off" aria-label={`Gõ ${BULK_CONFIRM_WORD} để xác nhận`} /></Field> : null}
          {err ? <p role="alert" style={{ color: 'var(--bad)', margin: '8px 0 0' }}>{err}</p> : null}
          <div className="da" style={{ marginTop: 14 }}>
            <button type="button" className="btn" onClick={onClose}>Hủy</button>
            <button type="submit" className="btn d" disabled={!okWord || busy}>{busy ? 'Đang xóa…' : `Xóa ${items.length} tệp`}</button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

const SOURCE_LABEL: Record<string, string> = { gdrive: 'Drive', dropbox: 'Dropbox', url: 'liên kết', youtube: 'YouTube' };
/** Tiến độ nhập từ liên kết ("Đang tải từ Drive… 45%") hoặc tải lên từng phần; lỗi cụ thể hiện ở reject_reason + nút Thử lại. */
export function TransferBar({ m }: { m: Media }) {
  const tr = m.transfer;
  if (!tr || !['queued', 'running', 'open'].includes(tr.status)) return null;
  const isImport = tr.kind === 'import';
  const where = SOURCE_LABEL[m.source ?? ''] ?? 'liên kết';
  const pct = tr.percent ?? null;
  const text = isImport
    ? tr.status === 'queued' && !tr.bytes_done ? `Đang chờ tải từ ${where}…` : `Đang tải từ ${where}… ${pct !== null ? `${pct}%` : fmtBytes(tr.bytes_done)}`
    : `Đang tải lên… ${pct !== null ? `${pct}%` : ''}`;
  return (
    <div role="progressbar" aria-label="Tiến độ tải" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? 0} style={{ marginBottom: 8 }}>
      <div style={{ height: 6, borderRadius: 3, background: 'var(--line, #E5E7EB)', overflow: 'hidden' }}><div style={{ width: `${pct ?? 5}%`, height: '100%', background: 'var(--pri, #2563EB)' }} /></div>
      <div style={{ fontSize: 13, color: 'var(--mut)', marginTop: 3 }}>{text}{tr.bytes_total ? ` · ${fmtBytes(tr.bytes_done)} / ${fmtBytes(tr.bytes_total)}` : ''}</div>
      {tr.error_message && tr.status === 'queued' ? <div style={{ fontSize: 12, color: 'var(--mut)' }}>{tr.error_message}</div> : null}
    </div>
  );
}

/** Chẩn đoán kỹ thuật của lần nhập liên kết thất bại (CHỈ nhân viên nội bộ; máy chủ không gửi cho khách). */
function DiagBox({ d }: { d: NonNullable<Media['diag']> }) {
  return (
    <details style={{ marginTop: 8, fontSize: 12.5 }}>
      <summary style={{ cursor: 'pointer' }}>Chi tiết kỹ thuật (quản trị)</summary>
      <dl style={{ margin: '6px 0 0', color: 'var(--mut)' }}>
        <div>Mã: {d.code ?? '—'} · HTTP: {d.http ?? '—'}</div>
        <div>Loại nội dung: {d.content_type ?? '—'}</div>
        <div>Tiêu đề trang: {d.title ?? '—'}</div>
        <div>Đoạn đầu: {d.snippet ?? '—'}</div>
        <div>Địa chỉ cuối: {d.final_url ?? '—'}</div>
      </dl>
    </details>
  );
}

/** Giải thích vì sao tệp chưa duyệt được + nút việc cần làm (xác nhận lại / kiểm tra lại / xem và duyệt tay). */
function Blocker({ m, canApprove, onReview, onAction, onReject, onPickFile }: { m: Media; canApprove: boolean; onReview: () => void; onAction: (a: 'confirm' | 'recheck' | 'retry') => void; onReject: () => void; onPickFile?: (() => void) | undefined }) {
  const b = m.blocker!;
  return (
    <div role="status" aria-label="Vì sao chưa duyệt được" style={{ marginTop: 10, padding: '10px 12px', borderRadius: 12, background: 'var(--warn-t, #FEF3C7)', fontSize: 13 }}>
      <div>{b.message}</div>
      {m.scan_reasons.length ? <ul aria-label="Lý do cần kiểm tra" style={{ margin: '6px 0 0', paddingLeft: 18 }}>{m.scan_reasons.map((r) => <li key={r}>{reasonText(r)}</li>)}</ul> : null}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
        {b.action === 'manual_review' && canApprove ? <Btn tone="p" className="sm" onClick={onReview}>Xem và duyệt</Btn> : null}
        {b.action === 'manual_review' && !canApprove ? <span>Cần người có quyền duyệt xem tệp.</span> : null}
        {b.action === 'retry' && onPickFile && CONVERT_ERROR_CODES.includes(m.transfer?.error_code ?? '') ? <Btn tone="p" className="sm" onClick={onPickFile}>Chọn tệp từ máy</Btn> : null}
        {b.action === 'retry' && !CONVERT_ERROR_CODES.includes(m.transfer?.error_code ?? '') ? <Btn tone="p" className="sm" onClick={() => onAction('retry')}>Thử lại</Btn> : null}
        {b.action === 'confirm' ? <Btn className="sm" onClick={() => onAction('confirm')}>Xác nhận lại</Btn> : null}
        {b.action === 'recheck' || b.action === 'manual_review' ? <Btn className="sm" onClick={() => onAction('recheck')}>Kiểm tra lại</Btn> : null}
        {b.action === 'recheck' && canApprove ? <Btn className="sm" onClick={onReject}>Trả lại</Btn> : null}
      </div>
    </div>
  );
}

/** Xem trước phát được + lý do + duyệt MỘT BƯỚC (ghi chú bắt buộc, ghi nhật ký) hoặc trả lại. Dùng cho tệp 'chờ kiểm tra thủ công' (kiểm tra cấu trúc phát hiện điểm bất thường). */
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
