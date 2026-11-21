import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { broadcastSchema, listOf, type Broadcast } from '../api/schemas';
import { useAct } from '../api/hooks';
import { useAuth } from '../auth/AuthProvider';
import { Btn, EmptyBlock, ErrorBlock, LoadingBlock, Tabs, Tag } from './ui';
import { ProgramPreviewDialog } from './PreviewDialogs';
import { fmtMin } from '../lib/format';

export const BASE = '/admin/v1/broadcast';
export type Orient = 'all' | 'portrait' | 'landscape';

export const STATUS: Record<string, { label: string; tone: 'ok' | 'warn' | 'info' | 'bad' }> = {
  draft: { label: 'Bản nháp', tone: 'warn' },
  published: { label: 'Đã xuất bản', tone: 'ok' },
  ended: { label: 'Đã kết thúc', tone: 'info' },
};

export const orientationOf = (p: Broadcast): 'portrait' | 'landscape' => p.layout?.orientation ?? (p.target_type === 'tv' ? 'landscape' : 'portrait');
export const orientLabel = (o: 'portrait' | 'landscape'): string => (o === 'portrait' ? 'Dọc 9:16' : 'Ngang 16:9');
export const zoneCount = (p: Broadcast): number => p.layout?.zones?.length || 1;
/** Số thiết bị gán: API có thể trả device_count; nếu chưa có thì hiện phạm vi khu vực. */
export const devicesLabel = (p: Broadcast): string => {
  const n = (p as { device_count?: number }).device_count;
  if (typeof n === 'number' && n > 0) return `${n} thiết bị`;
  return p.regions.length ? p.regions.join(', ') : 'Tất cả khu vực';
};
const dateRange = (p: Broadcast): string => `${p.start_date ?? '…'} ~ ${p.end_date ?? '…'}`;

export function useBroadcastList(pageSize = 100) {
  return useQuery({ queryKey: [BASE, 'list', pageSize], queryFn: () => api.get(BASE, { query: { page_size: pageSize }, schema: listOf(broadcastSchema) }) });
}

/** Danh sách chương trình phát sóng theo định dạng QuangBáo Cloud: lọc hướng màn hình + bảng + thao tác. */
export function ProgramList({ limit, compact = false, showFilter = true }: { limit?: number; compact?: boolean; showFilter?: boolean }) {
  const nav = useNavigate();
  const act = useAct();
  const { can } = useAuth();
  const canWrite = can('schedule', 'write');
  const canDelete = can('schedule', 'delete');
  const list = useBroadcastList();
  const [orient, setOrient] = useState<Orient>('all');
  const [view, setView] = useState<Broadcast | null>(null);
  const run = (p: Broadcast, action: 'publish' | 'unpublish', ok: string) => act(() => api.post(`${BASE}/${p.id}/${action}`, { body: {} }), ok, [BASE]);
  if (list.isLoading) return <LoadingBlock />;
  if (list.isError) return <ErrorBlock error={list.error} onRetry={() => void list.refetch()} />;
  let rows = [...(list.data?.items ?? [])];
  if (limit) rows.sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')));
  if (orient !== 'all') rows = rows.filter((p) => orientationOf(p) === orient);
  if (limit) rows = rows.slice(0, limit);
  return (
    <>
      {showFilter ? (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '0 0 10px' }}>
          <Tabs<Orient> label="Lọc theo hướng màn hình" value={orient} onChange={setOrient} items={[{ id: 'all', label: 'Tất cả' }, { id: 'portrait', label: 'Màn hình Dọc 9:16' }, { id: 'landscape', label: 'Màn hình Ngang 16:9' }]} />
          {canWrite ? <Btn tone="p" icon="plus" onClick={() => nav('/broadcast?new=1')}>Tạo chương trình</Btn> : null}
        </div>
      ) : null}
      {!rows.length ? <EmptyBlock>Chưa có chương trình phát sóng nào.</EmptyBlock> : (
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl" data-testid="program-list">
            <thead><tr>{compact ? null : <th>ID</th>}<th>Tên chương trình</th><th>Định hướng</th>{compact ? null : <th>Thời gian phát</th>}<th>Khung giờ</th><th>Trạng thái</th><th>Thiết bị gán</th><th style={{ textAlign: 'right' }}>Thao tác</th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  {compact ? null : <td className="mono">{p.id.length > 8 ? p.id.slice(0, 8) : p.id}</td>}
                  <td style={{ minWidth: 180 }}><b>{p.name}</b><div style={{ color: 'var(--mut)', fontSize: 12 }}>Phiên bản v{p.version} · {zoneCount(p)} vùng hiển thị</div></td>
                  <td style={{ whiteSpace: 'nowrap' }}>{orientLabel(orientationOf(p))}</td>
                  {compact ? null : <td className="mono" style={{ whiteSpace: 'nowrap' }}>{dateRange(p)}</td>}
                  <td className="mono" style={{ whiteSpace: 'nowrap' }}>{fmtMin(p.start_min)} - {fmtMin(p.end_min)}</td>
                  <td><Tag tone={STATUS[p.status]?.tone ?? 'info'}>{STATUS[p.status]?.label ?? p.status}</Tag></td>
                  <td>{devicesLabel(p)}</td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    {canWrite && p.status !== 'published' ? <button type="button" className="btn sm p" onClick={() => void run(p, 'publish', 'Đã phát hành. Thiết bị sẽ nhận trong ít phút.')}>Phát hành ngay</button> : null}{' '}
                    {canWrite && p.status === 'published' ? <button type="button" className="btn sm" onClick={() => void run(p, 'unpublish', 'Đã gỡ phát.')}>Gỡ phát</button> : null}{' '}
                    {p.item_count > 0 ? <button type="button" className="btn sm" onClick={() => void api.get(`${BASE}/${p.id}`, { schema: broadcastSchema }).then(setView)}>Xem trước</button> : null}{' '}
                    {canWrite ? <button type="button" className="btn sm" onClick={() => nav(`/broadcast?program=${p.id}`)}>Sửa</button> : null}{' '}
                    {!compact && canDelete ? <button type="button" className="btn sm d" onClick={() => { if (window.confirm(`Xóa chương trình "${p.name}"?`)) void act(() => api.del(`${BASE}/${p.id}`), 'Đã xóa.', [BASE]); }}>Xóa</button> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {view ? <ProgramPreviewDialog title={view.name} orientation={orientationOf(view)} zones={view.layout?.zones ?? null} ids={view.items.map((i) => i.creative_id)} zoneOf={Object.fromEntries(view.items.map((i) => [i.creative_id, i.zone_id ?? null]))} header={view.header} footer={view.footer} onClose={() => setView(null)} /> : null}
    </>
  );
}
