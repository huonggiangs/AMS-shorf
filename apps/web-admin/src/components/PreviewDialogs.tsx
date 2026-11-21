import { useMemo } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { mediaSchema } from '../api/schemas';
import { Dialog } from './Dialog';
import { LivePreview, type PreviewItem } from './LivePreview';
import { PRESETS, type Orientation, type Zone } from '../lib/layout';
import { LoadingBlock } from './ui';

const MEDIA = '/admin/v1/media';

/** Tai URL xem truoc that (da ky) cua cac tep roi tra ve danh sach cho LivePreview. */
export function usePreviewItems(ids: string[], zoneOf: Record<string, string | null | undefined> = {}, durations: Record<string, number | null | undefined> = {}): { items: PreviewItem[]; loading: boolean } {
  const qs = useQueries({ queries: ids.map((id) => ({ queryKey: [MEDIA, 'one', id], queryFn: () => api.get(`${MEDIA}/${id}`, { schema: mediaSchema }), staleTime: 60_000 })) });
  const loading = qs.some((q) => q.isLoading);
  const sig = qs.map((q) => q.data?.id ?? '-').join('|');
  const items = useMemo<PreviewItem[]>(
    () =>
      qs.flatMap((q, i): PreviewItem[] => {
        const m = q.data;
        if (!m) return [];
        const kind = m.kind === 'image' || m.mime?.startsWith('image/') ? 'image' : 'video';
        return [{ id: m.id, zoneId: zoneOf[ids[i]!] ?? null, kind, url: m.preview_url ?? null, duration_s: durations[m.id] ?? m.duration_sec ?? null, name: m.name }];
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sig, JSON.stringify(zoneOf), JSON.stringify(durations)],
  );
  return { items, loading };
}

/** Xem truoc cac tep cua mot chuong trinh voi bo cuc cua no (hoac man don neu chua co bo cuc). */
export function ProgramPreviewDialog({ title, orientation, zones, ids, zoneOf, header, footer, onClose }: { title: string; orientation: Orientation; zones: Zone[] | null; ids: string[]; zoneOf: Record<string, string | null | undefined>; header?: string | null; footer?: string | null; onClose: () => void }) {
  const { items, loading } = usePreviewItems(ids, zoneOf);
  const single = PRESETS.find((p) => p.orientation === orientation && p.id.startsWith('full'))!.zones;
  return (
    <Dialog open onClose={onClose} size="lg" label="Xem trước chương trình">
      <h2 style={{ margin: '0 0 10px', fontSize: 18 }}>Xem trước: {title}</h2>
      {loading ? <LoadingBlock /> : items.length === 0 ? <p>Chương trình chưa có tệp để xem trước.</p> : <LivePreview orientation={orientation} zones={zones && zones.length ? zones : single} items={items} header={header} footer={footer} />}
      <p style={{ color: 'var(--mut)', fontSize: 12, marginTop: 8 }}>Mô phỏng trên trình duyệt. Thiết bị thật có thể khác đôi chút về chuyển cảnh và độ phân giải.</p>
      <div className="da" style={{ marginTop: 10 }}><button type="button" className="btn" onClick={onClose}>Đóng</button></div>
    </Dialog>
  );
}

/** Xem nhanh MOT tep trong kho (video that / anh). */
export function MediaPreviewDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery({ queryKey: [MEDIA, 'one', id], queryFn: () => api.get(`${MEDIA}/${id}`, { schema: mediaSchema }) });
  const m = q.data;
  const isVideo = m?.kind === 'video' || m?.mime?.startsWith('video/');
  return (
    <Dialog open onClose={onClose} size="lg" label="Xem trước tệp">
      <h2 style={{ margin: '0 0 10px', fontSize: 18 }}>Xem trước: {m?.name ?? '…'}</h2>
      {q.isLoading || !m ? <LoadingBlock /> : m.preview_url ? (isVideo ? <video src={m.preview_url} controls autoPlay muted preload="metadata" style={{ maxWidth: '100%', maxHeight: '65vh', display: 'block', margin: '0 auto' }} aria-label={`Xem trước ${m.name}`} /> : <img src={m.preview_url} alt={`Xem trước ${m.name}`} style={{ maxWidth: '100%', maxHeight: '65vh', display: 'block', margin: '0 auto' }} />) : <p>Chưa có bản xem trước cho tệp này.</p>}
      <div className="da" style={{ marginTop: 10 }}><button type="button" className="btn" onClick={onClose}>Đóng</button></div>
    </Dialog>
  );
}
