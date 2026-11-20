import { useEffect, useRef, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { API_BASE, api, errMsg, putBlob } from '../api/client';
import { bulkDeleteResultSchema, customerSchema, listOf, mediaSchema, uploadUrlSchema, type BulkDeleteResult, type Media } from '../api/schemas';
import { useAct, useBase } from '../api/hooks';
import { useAuth } from '../auth/AuthProvider';
import { Btn, EmptyBlock, ErrorBlock, Field, LoadingBlock, PageHead, StatusTag, Tabs } from '../components/ui';
import { Dialog } from '../components/Dialog';
import { PromptDialog } from '../components/Prompt';
import { reasonText } from './CreativeReview';
import { OverlayForm, emptyOverlay, overlayError, overlayPayload, AD_FORMAT_OPTIONS } from '../components/OverlayForm';
import { useT } from '../i18n';
import { checkMediaUrl, type LinkSource } from '../lib/creative';
import { captureThumbnail, pickBackfill, resolveThumbUrl, thumbSupported, uploadDoneMessage } from '../lib/thumbnail';

const PAGE = 9;
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
export const fmtBytes = (n: number): string => (n >= 1073741824 ? `${(n / 1073741824).toFixed(2)} GB` : `${(n / 1048576).toFixed(1)} MB`);
type Picked = Record<string, { name: string; size: number }>;
const MAX_IMAGE_BYTES = 500 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
/** Giới hạn tải lên hiển thị cho người dùng (khớp services/api/src/lib/creative.ts + docs/CLOUDFLARE-MEDIA-LIMITS.md). Tệp đi thẳng lên kho R2 (không qua Worker 100 MB). */
export const UPLOAD_LIMIT_TEXT = 'Video TV/LED: H.264 + AAC, tối đa 1920×1080 (Full HD), tối đa 100 MB; không nhận AV1/H.265/4K cho TV vì TV không phát ổn định và hệ thống không chuyển mã được. TV: 16:9, 5–60 giây. Thang máy: dọc 9:16 từ HD 720×1280 đến 4K 2160×3840 (gồm 768×1366, 1080×1920, 1440×2560), video H.264 hoặc H.265 + AAC, bitrate khuyến nghị ≤ 16 Mbps, 10–30 giây, tối đa 30 MB (đến Full HD) hoặc 100 MB (2K/4K). LED: đúng kích thước bảng, 5–15 giây, tối đa 50 MB. Ảnh PNG/JPG tối đa 500 MB. Khách hàng còn bị giới hạn theo hạn mức tải lên của tài khoản.';

/** Che chu ky/tham so cua URL ky truoc khi ghi console (chi giu origin + duong dan). */
export function redactUrl(raw: string): string {
  try {
    const x = new URL(raw, window.location.origin);
    return `${x.origin}${x.pathname}${x.search ? '?…' : ''}`;
  } catch {
    return '(url?)';
  }
}

/**
 * Gui tep len kho. `via='proxy'` (mac dinh tren Cloudflare khi chua co khoa S3): PUT cung origin toi API (phien + CSRF), khong can CORS.
 * `via='direct'`: PUT toi URL ky cua R2. Loi co ma ngan de chan doan: UP-NET (mang/CORS), UP-403 (kho tu choi chu ky/khoa), UP-<status>, hoac ma loi cua API.
 */
export async function uploadToStore(mediaBase: string, u: { id: string; url: string; method?: string | undefined; headers?: Record<string, string> | undefined; via?: 'direct' | 'proxy' | undefined }, file: File): Promise<void> {
  if (u.via === 'proxy') {
    try {
      await putBlob(`${mediaBase}/${u.id}/content`, file);
    } catch (e) {
      console.error('[upload] proxy that bai', { via: 'proxy', target: `${mediaBase}/${u.id}/content`, status: (e as { status?: number }).status, code: (e as { code?: string }).code });
      const code = (e as { code?: string }).code ?? 'UP-NET';
      throw new Error(`${errMsg(e)} (mã ${code})`);
    }
    return;
  }
  let put: Response;
  try {
    put = await fetch(u.url, { method: u.method ?? 'PUT', headers: { 'Content-Type': file.type, ...(u.headers ?? {}) }, body: file });
  } catch (e) {
    console.error('[upload] khong ket noi duoc kho', { via: 'direct', target: redactUrl(u.url), error: (e as Error).message });
    throw new Error('Không tải được tệp lên kho lưu trữ (mất kết nối hoặc kho chưa cho phép tải từ trình duyệt: CORS). Kiểm tra mạng và thử lại; nếu vẫn lỗi, báo quản trị cấu hình CORS cho kho R2. (mã UP-NET)');
  }
  if (!put.ok) {
    console.error('[upload] kho tu choi', { via: 'direct', target: redactUrl(u.url), status: put.status });
    throw new Error(put.status === 403 ? 'Kho từ chối chữ ký/khóa tải lên (mã UP-403). Nếu bạn chọn tệp từ hơn 15 phút trước, hãy tải lại; nếu vẫn lỗi, báo quản trị kiểm tra khóa R2.' : `Tải lên kho lưu trữ thất bại (mã UP-${put.status}).`);
  }
}

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
  const [rej, setRej] = useState<string | null>(null);
  const [rev, setRev] = useState<string | null>(null);
  const canDelete = can('media', 'delete') && !base.isExternal;
  const [picked, setPicked] = useState<Picked>({});
  const [delOpen, setDelOpen] = useState(false);
  const [allBusy, setAllBusy] = useState(false);
  const query = useQuery({
    queryKey: [base.media, page, q, status],
    placeholderData: keepPreviousData,
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
  const pickAllFiltered = async () => {
    setAllBusy(true);
    try {
      const n: Picked = {};
      for (let pg = 1; Object.keys(n).length < SELECT_ALL_CAP; pg++) {
        const r = await api.get(base.media, { query: { page: pg, page_size: 200, q, filter: status ? `status:${status}` : undefined }, schema: listOf(mediaSchema) });
        for (const m of r.items) n[m.id] = { name: m.name, size: m.size_bytes ?? 0 };
        if (r.items.length < 200 || pg * 200 >= r.total) break;
      }
      setPicked(n);
    } catch (e) {
      await act(async () => { throw e; });
    } finally {
      setAllBusy(false);
    }
  };
  return (
    <>
      <PageHead title="Nội dung & Media" sub="Kho tệp quảng cáo và trạng thái kiểm duyệt." actions={can('media', 'write') ? <Btn tone="p" icon="plus" onClick={() => setUp(true)}>{t('Tải nội dung mới')}</Btn> : null} />
      <div className="tb" style={{ marginBottom: 12, background: 'none', padding: 0 }}>
        <label className="sr"><input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder={t('Tìm…')} aria-label={t('Tìm…')} /></label>
        <Tabs value={status} onChange={(v) => { setStatus(v); setPage(1); }} items={[{ id: '', label: 'Tất cả' }, { id: 'processing', label: 'Đang xử lý' }, { id: 'pending', label: 'Chờ duyệt' }, { id: 'approved', label: 'Đã duyệt' }, { id: 'rejected', label: 'Cần chỉnh sửa' }]} />
      </div>
      {canDelete && pageItems.length ? (
        <div role="toolbar" aria-label="Chọn nhiều tệp để xóa" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <Btn className="sm" onClick={togglePage}>{pageAllOn ? 'Bỏ chọn trang này' : 'Chọn tất cả trang này'}</Btn>
          {(query.data?.total ?? 0) > pageItems.length ? <Btn className="sm" disabled={allBusy} onClick={() => void pickAllFiltered()}>{allBusy ? 'Đang chọn…' : `Chọn tất cả ${query.data?.total} tệp (theo bộ lọc hiện tại)`}</Btn> : null}
          {pickedIds.length ? <Btn className="sm" onClick={() => setPicked({})}>Bỏ chọn tất cả</Btn> : null}
          <span aria-live="polite" style={{ color: 'var(--mut)', fontSize: 13 }}>{pickedIds.length ? `Đã chọn ${pickedIds.length} tệp` : 'Chưa chọn tệp nào'}</span>
          <Btn tone="d" className="sm" disabled={!pickedIds.length} onClick={() => setDelOpen(true)}>{`Xóa đã chọn${pickedIds.length ? ` (${pickedIds.length})` : ''}`}</Btn>
        </div>
      ) : null}
      {query.isLoading ? <LoadingBlock /> : query.isError ? <ErrorBlock error={query.error} onRetry={() => void query.refetch()} /> : !query.data?.items.length ? <EmptyBlock /> : (
        <div className="g g3">
          {query.data.items.map((m) => <MediaCard key={m.id} m={m} canApprove={canApprove} selectable={canDelete} selected={!!picked[m.id]} onToggle={() => toggle(m)} onMakeThumb={canWrite && thumbSupported() ? () => void makeThumb(m) : undefined} onReview={() => setRev(m.id)} onAction={(a) => void act(() => api.post(`${base.media}/${m.id}/${a}`, a === 'confirm' ? { body: {} } : undefined), a === 'confirm' ? 'Đã xác nhận lại tệp.' : 'Đã gửi kiểm tra lại, kết quả hiện sau ít phút.')} onApprove={() => void act(() => api.post(`${base.media}/${m.id}/approve`), 'Đã duyệt media.')} onReject={() => setRej(m.id)} />)}
        </div>
      )}
      <div className="tf" style={{ background: 'none' }}>
        <span>{query.data?.total ?? 0} tệp</span>
        <div className="pg">{Array.from({ length: pages }, (_, i) => <button key={i} type="button" className={i + 1 === page ? 'on' : ''} onClick={() => setPage(i + 1)}>{i + 1}</button>)}</div>
      </div>
      <UploadDialog open={up} onClose={() => setUp(false)} />
      {delOpen ? <DeleteSelectedDialog items={Object.entries(picked).map(([id, v]) => ({ id, ...v }))} onClose={() => setDelOpen(false)} onDone={(ids) => setPicked((p) => { const n = { ...p }; for (const id of ids) delete n[id]; return n; })} /> : null}
      {rev ? <ReviewDialog id={rev} onClose={() => setRev(null)} /> : null}
      <PromptDialog open={!!rej} title="Trả lại media" label="Lý do (khách hàng nhận email kèm lý do)" onClose={() => setRej(null)} onSubmit={async (reason) => { if (rej) await act(() => api.post(`${base.media}/${rej}/reject`, { body: { reason } }), 'Đã trả lại.'); }} />
    </>
  );
}

function MediaCard({ m, canApprove, selectable, selected, onToggle, onMakeThumb, onApprove, onReject, onReview, onAction }: { m: Media; canApprove: boolean; selectable?: boolean; selected?: boolean; onToggle?: () => void; onMakeThumb?: (() => void) | undefined; onApprove: () => void; onReject: () => void; onReview: () => void; onAction: (a: 'confirm' | 'recheck') => void }) {
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <StatusTag status={m.status} />
          {m.status === 'pending' && canApprove && !m.blocker ? <span><Btn tone="p" className="sm" onClick={onApprove}>{t('Duyệt')}</Btn> <Btn className="sm" onClick={onReject}>{t('Trả lại')}</Btn></span> : null}
        </div>
        {m.status !== 'approved' && m.blocker ? <Blocker m={m} canApprove={canApprove} onReview={onReview} onAction={onAction} onReject={onReject} /> : null}
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
    let doneStatus: string | null = null;
    try {
      if (mode === 'file') {
        if (!file) throw new Error('Chọn một tệp.');
        const isVideoFile = file.type.startsWith('video/');
        if (file.size > (isVideoFile ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES)) throw new Error(`Tệp ${(file.size / 1048576).toFixed(0)} MB lớn hơn giới hạn ${isVideoFile ? '100 MB cho video' : '500 MB'}. Hãy xuất lại video H.264 1080p (khoảng 8–10 Mbps), cắt ngắn 15–60 giây rồi tải lên.`);
        if (!/^(video\/(mp4|quicktime|webm)|image\/(png|jpeg))$/.test(file.type)) throw new Error('Chỉ nhận MP4, MOV, WebM, PNG hoặc JPG.');
        const dims = await readDims(file);
        if (isVideoFile && dims.width && dims.height && (Math.max(dims.width, dims.height) > 1920 || Math.min(dims.width, dims.height) > 1080)) throw new Error(`Video ${dims.width}×${dims.height} vượt Full HD 1920×1080. Hãy xuất lại ở 1080p (H.264 + AAC) rồi tải lên.`);
        const u = await api.post(`${base.media}/upload-url`, { body: { name: file.name, content_type: file.type, size_bytes: file.size, ...dims, ...(customerId ? { customer_id: customerId } : {}), format: ov.format, ...(overlayPayload(ov) ? { overlay: overlayPayload(ov) } : {}) }, schema: uploadUrlSchema });
        await uploadToStore(base.media, u, file);
        const confirmed = (await api.post(`${base.media}/${u.id}/confirm`, { body: { ...dims } })) as { status?: string } | null;
        doneStatus = confirmed?.status ?? null;
        // Anh dai dien tao tai trinh duyet (khung ~1 s, rong 320 px, JPEG ~0,7); loi o day KHONG lam hong viec tai len.
        if (thumbSupported()) {
          try {
            const tb = await captureThumbnail(file, file.type, { durationSec: dims.duration_sec });
            if (tb) await putBlob(`${base.media}/${u.id}/thumbnail`, tb);
          } catch { /* im lang: se tu tao lai khi mo trang Media */ }
        }
      } else {
        const c = checkMediaUrl(mode, url);
        if (!c.ok) throw new Error(c.message);
        await api.post(`${base.media}/import`, { body: { source: mode, url: url.trim(), ...(customerId ? { customer_id: customerId } : {}) } });
      }
      await act(async () => undefined, uploadDoneMessage(doneStatus), [base.media, '/admin/v1/media', '/portal/v1/media']);
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
