import { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMsg } from '../api/client';
import { scanQueueItemSchema, listOf, type ScanQueueItem } from '../api/schemas';
import { useAuth } from '../auth/AuthProvider';
import { Btn, EmptyBlock, ErrorBlock, Field, LoadingBlock, Note, PageHead, Tag } from '../components/ui';
import { Dialog } from '../components/Dialog';
import { fmtDateTime } from '../lib/format';
import { useUi } from '../state/ui';
import { TvMetaSection } from '../components/TvMeta';

const PAGE_SIZE = 12;
const ENDPOINT = '/admin/v1/media/scan-review/queue';
export const REASON: Record<string, string> = {
  type_not_in_allowlist: 'Định dạng tệp ngoài danh sách an toàn',
  png_trailing_data: 'PNG có dữ liệu thừa phía sau (có thể chứa tệp ẩn)',
  png_no_iend: 'PNG thiếu phần kết thúc',
  png_chunk_overrun: 'PNG có khối dữ liệu vượt giới hạn',
  png_ihdr_invalid: 'PNG có phần đầu không hợp lệ',
  jpeg_no_eoi: 'JPEG thiếu dấu kết thúc',
  jpeg_no_sof: 'JPEG thiếu thông tin khung ảnh',
  webp_header_invalid: 'WebP có phần đầu không hợp lệ',
  webp_riff_size_mismatch: 'WebP có kích thước khai báo không khớp',
  mp4_no_mdat: 'MP4 không có dữ liệu hình/tiếng',
  size_mismatch: 'Kích thước tệp không khớp với khai báo',
  duration_mismatch: 'Thời lượng không khớp với khai báo',
  duration_out_of_range: 'Thời lượng ngoài giới hạn cho phép',
  dimensions_out_of_range: 'Kích thước ảnh/video ngoài giới hạn cho phép',
  size_over_inline_limit: 'Tệp quá lớn để kiểm tra tự động',
  too_large_to_read_inline: 'Tệp quá lớn để đọc kiểm tra tự động',
  mark_clean_disabled: 'Máy chủ đang tắt tự động đánh dấu sạch',
  mp4_trailing_bytes: 'MP4 có dữ liệu thừa phía sau (có thể chứa tệp ẩn)',
  mp4_box_overrun: 'MP4 có khối dữ liệu vượt giới hạn tệp (tệp hỏng hoặc bị cắt)',
  mp4_ftyp_missing: 'Không nhận ra tệp MP4 (thiếu phần đầu)',
  mp4_no_moov: 'MP4 thiếu thông tin thời lượng/khung hình (moov)',
  mp4_no_mvhd: 'MP4 thiếu thông tin thời lượng',
  mp4_no_video_track: 'MP4 không có luồng hình',
  mp4_zero_duration: 'MP4 có thời lượng bằng 0',
  mp4_moov_too_large: 'MP4 có phần mô tả quá lớn để kiểm tra tự động',
  mp4_header_unreadable: 'Không đọc được phần đầu MP4',
  mp4_too_many_boxes: 'MP4 có cấu trúc bất thường (quá nhiều khối)',
};
/** Mã lý do có thể kèm tham số sau dấu ':' (mime_mismatch:…, dimensions_mismatch:…, mp4_brand_not_allowed:…). */
export function reasonText(code: string): string {
  if (REASON[code]) return REASON[code];
  const [k, ...rest] = code.split(':');
  const arg = rest.join(':');
  if (k === 'unsupported_codec') return `Video dùng codec ${arg === 'av01' ? 'AV1' : arg === 'hvc1' || arg === 'hev1' ? 'H.265' : arg || 'không phải H.264'} mà màn hình không phát ổn định (TV/LED cần H.264/AAC; thang máy nhận H.264 hoặc H.265)`;
  if (k === 'video_resolution_too_high') return 'Video vượt độ phân giải cho phép (TV/LED: Full HD 1920×1080; thang máy: 4K 2160×3840)';
  if (k === 'mime_mismatch') return `Loại tệp khai báo (${arg}) không khớp nội dung thật`;
  if (k === 'dimensions_mismatch') return `Kích thước thật của tệp khác khai báo (${arg.replace('!=', ' so với ')})`;
  if (k === 'mp4_brand_not_allowed') return `MP4 dùng định dạng con không nằm trong danh sách an toàn (${arg})`;
  return code;
}
const SCAN: Record<string, string> = { needs_manual_review: 'Chờ kiểm tra thủ công', clean: 'Đã sạch', failed: 'Bị từ chối', infected: 'Nhiễm mã độc' };
const sizeText = (b?: number | null) => (b == null ? '—' : b >= 1048576 ? `${(b / 1048576).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(b / 1024)).toLocaleString('vi-VN')} KB`);
const MIN_NOTE = 3;

/** Hàng chờ kiểm tra thủ công creative (scan_state = needs_manual_review). Chỉ quyền media:approve. Quyết định gắn với content_version đã xem; mọi quyết định ghi nhật ký. */
export default function CreativeReview() {
  const { can } = useAuth();
  const { notify } = useUi();
  const qc = useQueryClient();
  const allowed = can('media', 'approve');
  const [page, setPage] = useState(1);
  const [dlg, setDlg] = useState<{ item: ScanQueueItem; decision: 'approve' | 'reject' } | null>(null);
  const q = useQuery({
    queryKey: [ENDPOINT, page], enabled: allowed, placeholderData: keepPreviousData,
    queryFn: () => api.get(ENDPOINT, { query: { page, page_size: PAGE_SIZE }, schema: listOf(scanQueueItemSchema) }),
  });
  if (!allowed) {
    return (
      <div className="card cp" role="alert" style={{ textAlign: 'center', padding: 36 }}>
        <h2 style={{ margin: '0 0 6px' }}>Không có quyền duyệt creative</h2>
        <p className="sub">Cần quyền duyệt nội dung (media) để xem và xử lý hàng chờ này.</p>
      </div>
    );
  }
  const total = q.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const refresh = () => qc.invalidateQueries({ queryKey: [ENDPOINT] });
  const submit = async (item: ScanQueueItem, decision: 'approve' | 'reject', note: string, alsoApprove = false) => {
    try {
      if (decision === 'approve' && alsoApprove) {
        // một bước: xác nhận an toàn (kiểm tra thủ công) + duyệt nội dung => dùng được ngay cho chiến dịch
        await api.post(`/admin/v1/media/${item.id}/approve`, { body: { manual_review_note: note, content_version: item.content_version } });
        notify('Đã duyệt creative. Tệp có thể gắn vào chiến dịch.');
      } else {
        await api.post(`/admin/v1/media/${item.id}/scan-review`, { body: { decision, note, content_version: item.content_version } });
        notify(decision === 'approve' ? 'Đã duyệt kiểm tra thủ công. Tệp vẫn cần duyệt nội dung ở trang Nội dung & Media.' : 'Đã từ chối creative.');
      }
      if (page > 1 && (q.data?.items.length ?? 0) <= 1) setPage(page - 1);
      void qc.invalidateQueries({ queryKey: ['/admin/v1/media'] });
      return true;
    } catch (e) {
      notify(errMsg(e));
      return false;
    } finally {
      void refresh();
    }
  };
  return (
    <>
      <PageHead title="Duyệt creative" sub="Tệp quảng cáo chưa qua được kiểm tra tự động, cần người có quyền xem và quyết định." />
      <Note>Duyệt tại đây chỉ xác nhận tệp an toàn (không phải duyệt nội dung quảng cáo). Tệp bị từ chối sẽ không bao giờ được phát. Mỗi quyết định gắn với phiên bản nội dung bạn đang xem: nếu khách đổi tệp, hệ thống yêu cầu xem lại.</Note>
      {q.isLoading ? <LoadingBlock /> : q.isError ? <ErrorBlock error={q.error} onRetry={() => void q.refetch()} /> : !q.data?.items.length ? <EmptyBlock>Không có creative nào đang chờ kiểm tra thủ công.</EmptyBlock> : (
        <div className="g g3">
          {q.data.items.map((m) => <ReviewCard key={m.id} m={m} onRecheck={async () => { try { await api.post(`/admin/v1/media/${m.id}/recheck`); notify('Đã gửi kiểm tra lại. Kết quả hiện sau ít phút.'); } catch (e) { notify(errMsg(e)); } void refresh(); }} onApprove={() => setDlg({ item: m, decision: 'approve' })} onReject={() => setDlg({ item: m, decision: 'reject' })} />)}
        </div>
      )}
      <div className="tf" style={{ background: 'none' }}>
        <span>{total} tệp đang chờ</span>
        <div className="pg">{Array.from({ length: pages }, (_, i) => <button key={i} type="button" className={i + 1 === page ? 'on' : ''} aria-label={`Trang ${i + 1}`} aria-current={i + 1 === page ? 'page' : undefined} onClick={() => setPage(i + 1)}>{i + 1}</button>)}</div>
      </div>
      <TvMetaSection />
      {dlg ? <ReasonDialog key={`${dlg.item.id}-${dlg.decision}`} item={dlg.item} decision={dlg.decision} onClose={() => setDlg(null)} onSubmit={(note, both) => submit(dlg.item, dlg.decision, note, both)} /> : null}
    </>
  );
}

function Preview({ m }: { m: ScanQueueItem }) {
  const isVideo = m.kind === 'video' || m.mime?.startsWith('video/');
  const isImage = m.kind === 'image' || m.mime?.startsWith('image/');
  if (m.preview_url && isVideo) return <video src={m.preview_url} controls preload="metadata" aria-label={`Xem trước ${m.name ?? ''}`} style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }} />;
  if (m.preview_url && isImage) return <img src={m.preview_url} alt={`Xem trước ${m.name ?? ''}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
  return <div className="ph">{isVideo ? 'VIDEO' : 'TỆP'}<br />Không có bản xem trước</div>;
}

function ReviewCard({ m, onApprove, onReject, onRecheck }: { m: ScanQueueItem; onApprove: () => void; onReject: () => void; onRecheck: () => void }) {
  const meta = [m.mime?.split('/')[1]?.toUpperCase(), sizeText(m.size_bytes), m.width && m.height ? `${m.width}×${m.height}` : null, m.duration_s ? `${m.duration_s} giây` : null].filter(Boolean).join(' · ');
  return (
    <div className="card" role="group" aria-label={m.name ?? m.id}>
      <div className="scr" style={{ borderRadius: '20px 20px 0 0' }}><Preview m={m} /></div>
      <div className="cp" style={{ padding: 16 }}>
        <b>{m.name ?? m.id}</b>
        <div style={{ color: 'var(--mut)', fontSize: 13, margin: '2px 0 8px' }}>{m.customer_name ?? m.customer_id ?? '—'} · {meta}{m.created_at ? ` · ${fmtDateTime(m.created_at)}` : ''}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          <Tag tone="warn">{SCAN[m.scan_state] ?? m.scan_state}</Tag>
          <Tag tone="info">Phiên bản nội dung v{m.content_version}</Tag>
        </div>
        {m.reasons.length ? <ul aria-label="Lý do cần kiểm tra" style={{ margin: '0 0 10px', paddingLeft: 18, fontSize: 13 }}>{m.reasons.map((r) => <li key={r}>{reasonText(r)}</li>)}</ul> : <p className="sub" style={{ margin: '0 0 10px' }}>Không có chi tiết lý do.</p>}
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn tone="p" className="sm" onClick={onApprove}>Duyệt</Btn>
          <Btn className="sm" onClick={onReject}>Từ chối</Btn>
          <Btn className="sm" onClick={onRecheck}>Kiểm tra lại</Btn>
        </div>
      </div>
    </div>
  );
}

function ReasonDialog({ item, decision, onClose, onSubmit }: { item: ScanQueueItem; decision: 'approve' | 'reject'; onClose: () => void; onSubmit: (note: string, both: boolean) => Promise<boolean> }) {
  const [note, setNote] = useState('');
  const [both, setBoth] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const title = decision === 'approve' ? 'Duyệt creative (xác nhận an toàn)' : 'Từ chối creative';
  return (
    <Dialog open onClose={onClose} size="sm" label={title}>
      <form onSubmit={async (e) => {
        e.preventDefault();
        if (note.trim().length < MIN_NOTE) return setErr(`Nhập lý do (tối thiểu ${MIN_NOTE} ký tự).`);
        setErr(''); setBusy(true);
        const ok = await onSubmit(note.trim(), both);
        setBusy(false);
        if (ok) onClose();
      }}>
        <h2 style={{ margin: '0 0 6px', fontSize: 18 }}>{title}</h2>
        <p className="sub" style={{ margin: '0 0 10px' }}>{item.name ?? item.id} · phiên bản nội dung v{item.content_version}</p>
        <Field label={decision === 'approve' ? 'Lý do duyệt (ghi vào nhật ký)' : 'Lý do từ chối (ghi vào nhật ký)'}><textarea value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></Field>
        {decision === 'approve' ? (
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 10, fontSize: 13 }}>
            <input type="checkbox" checked={both} onChange={(e) => setBoth(e.target.checked)} style={{ marginTop: 3 }} />
            <span>Đồng thời duyệt nội dung quảng cáo (dùng được ngay cho chiến dịch). Bỏ chọn nếu chỉ xác nhận an toàn.</span>
          </label>
        ) : null}
        {err ? <p role="alert" style={{ color: 'var(--bad)', margin: '8px 0 0' }}>{err}</p> : null}
        <div className="da" style={{ marginTop: 14 }}>
          <button type="button" className="btn" onClick={onClose}>Hủy</button>
          <button type="submit" className={`btn ${decision === 'approve' ? 'p' : 'd'}`} disabled={busy}>{decision === 'approve' ? 'Xác nhận duyệt' : 'Xác nhận từ chối'}</button>
        </div>
      </form>
    </Dialog>
  );
}
