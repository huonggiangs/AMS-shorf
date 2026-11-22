import { useEffect, useMemo, useRef, useState } from 'react';
import { useCallback } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { mediaSchema } from '../api/schemas';
import { Dialog } from './Dialog';
import { LivePreview, type PreviewItem } from './LivePreview';
import { PRESETS, type Orientation, type Zone } from '../lib/layout';
import { LoadingBlock } from './ui';

const MEDIA = '/admin/v1/media';

/** Tai URL xem truoc that (da ky) cua cac tep roi tra ve danh sach cho LivePreview. */
export function usePreviewItems(ids: string[], zoneOf: Record<string, string | null | undefined> = {}, durations: Record<string, number | null | undefined> = {}): { items: PreviewItem[]; loading: boolean; refresh: (id: string) => void } {
  const qc = useQueryClient();
  // URL ky het han sau 15 phut: coi la cu sau 10 phut de lan mo ke tiep lay URL moi
  const qs = useQueries({ queries: ids.map((id) => ({ queryKey: [MEDIA, 'one', id], queryFn: () => api.get(`${MEDIA}/${id}`, { schema: mediaSchema }), staleTime: 10 * 60_000 })) });
  const refresh = useCallback((id: string) => { void qc.invalidateQueries({ queryKey: [MEDIA, 'one', id] }); }, [qc]);
  const loading = qs.some((q) => q.isLoading);
  const sig = qs.map((q) => `${q.data?.id ?? '-'}:${q.data?.preview_url ?? ''}`).join('|');
  const items = useMemo<PreviewItem[]>(
    () =>
      qs.flatMap((q, i): PreviewItem[] => {
        const m = q.data;
        if (!m) return [];
        const kind = m.kind === 'image' || m.mime?.startsWith('image/') ? 'image' : 'video';
        const note = m.preview_url ? null : m.source === 'youtube' ? 'Nguồn YouTube không xem trước được — tải video về rồi tải lên kho.' : m.source && m.source !== 'upload' ? 'Tệp từ liên kết chưa được tải về kho nên chưa xem trước.' : null;
        return [{ id: m.id, zoneId: zoneOf[ids[i]!] ?? null, kind, url: m.preview_url ?? null, duration_s: durations[m.id] ?? m.duration_sec ?? null, name: m.name, note }];
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sig, JSON.stringify(zoneOf), JSON.stringify(durations)],
  );
  return { items, loading, refresh };
}

/** Xem truoc cac tep cua mot chuong trinh voi bo cuc cua no (hoac man don neu chua co bo cuc). */
export function ProgramPreviewDialog({ title, orientation, zones, ids, zoneOf, header, footer, onClose }: { title: string; orientation: Orientation; zones: Zone[] | null; ids: string[]; zoneOf: Record<string, string | null | undefined>; header?: string | null; footer?: string | null; onClose: () => void }) {
  const { items, loading, refresh } = usePreviewItems(ids, zoneOf);
  const single = PRESETS.find((p) => p.orientation === orientation && p.id.startsWith('full'))!.zones;
  return (
    <Dialog open onClose={onClose} size="lg" label="Xem trước chương trình">
      <h2 style={{ margin: '0 0 10px', fontSize: 18 }}>Xem trước: {title}</h2>
      {loading ? <LoadingBlock /> : items.length === 0 ? <p>Chương trình chưa có tệp để xem trước.</p> : <LivePreview orientation={orientation} zones={zones && zones.length ? zones : single} items={items} header={header} footer={footer} onRetry={refresh} />}
      <p style={{ color: 'var(--mut)', fontSize: 12, marginTop: 8 }}>Mô phỏng trên trình duyệt. Thiết bị thật có thể khác đôi chút về chuyển cảnh và độ phân giải.</p>
      <div className="da" style={{ marginTop: 10 }}><button type="button" className="btn" onClick={onClose}>Đóng</button></div>
    </Dialog>
  );
}

/** Video xem nhanh 1 tep: hien loi cu the (het han/khong ho tro/hong) + tai lai thay vi khung den; co tua, bat tieng. */
export function PreviewVideo({ src, name, onExpired }: { src: string; name: string; onExpired?: () => void }) {
  const [err, setErr] = useState('');
  const retried = useRef(false);
  useEffect(() => { setErr(''); retried.current = false; }, [src]);
  return (
    <div style={{ position: 'relative' }}>
      <video
        key={src}
        src={src}
        controls
        autoPlay
        muted
        playsInline
        preload="auto"
        onLoadedData={() => setErr('')}
        onError={(e) => {
          if (!retried.current && onExpired) { retried.current = true; onExpired(); return; }
          const c = e.currentTarget.error?.code;
          setErr(c === 4 ? 'Trình duyệt không phát được định dạng/đường dẫn này (cần MP4 H.264).' : c === 2 ? 'Lỗi mạng khi tải video.' : c === 3 ? 'Video bị hỏng hoặc không giải mã được.' : 'Không tải được video.');
        }}
        style={{ maxWidth: '100%', maxHeight: '65vh', display: 'block', margin: '0 auto', background: '#000' }}
        aria-label={`Xem trước ${name}`}
      />
      {err ? <p role="alert" style={{ color: '#b91c1c', margin: '8px 0 0' }}>⚠ {err} <button type="button" className="btn sm" onClick={() => { retried.current = false; setErr(''); onExpired?.(); }}>Tải lại</button></p> : null}
    </div>
  );
}

/** Xem nhanh MOT tep trong kho (video that / anh). */
export function MediaPreviewDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery({ queryKey: [MEDIA, 'one', id], queryFn: () => api.get(`${MEDIA}/${id}`, { schema: mediaSchema }), staleTime: 10 * 60_000 });
  const m = q.data;
  const isVideo = m?.kind === 'video' || m?.mime?.startsWith('video/');
  return (
    <Dialog open onClose={onClose} size="lg" label="Xem trước tệp">
      <h2 style={{ margin: '0 0 10px', fontSize: 18 }}>Xem trước: {m?.name ?? '…'}</h2>
      {q.isLoading || !m ? <LoadingBlock /> : m.preview_url ? (isVideo ? <PreviewVideo src={m.preview_url} name={m.name} onExpired={() => void q.refetch()} /> : <img src={m.preview_url} alt={`Xem trước ${m.name}`} style={{ maxWidth: '100%', maxHeight: '65vh', display: 'block', margin: '0 auto' }} />) : <p>{m.source === 'youtube' ? 'Nguồn YouTube không xem trước được. Hãy tải video về rồi tải lên kho (giữ phần mô tả hiển thị).' : m.source && m.source !== 'upload' ? 'Tệp từ liên kết chưa được tải về kho nên chưa xem trước được.' : 'Chưa có bản xem trước cho tệp này.'}</p>}
      <div className="da" style={{ marginTop: 10 }}><button type="button" className="btn" onClick={onClose}>Đóng</button></div>
    </Dialog>
  );
}
