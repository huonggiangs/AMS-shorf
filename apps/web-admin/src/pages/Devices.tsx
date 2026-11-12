import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, errMsg } from '../api/client';
import { deviceSchema, listOf, type Device } from '../api/schemas';
import { useAct } from '../api/hooks';
import { useAuth } from '../auth/AuthProvider';
import { ServerTable } from '../components/ServerTable';
import type { Col } from '../components/DataTable';
import { Btn, Kpi, LoadingBlock, NameCell, PageHead, StatusTag } from '../components/ui';
import { Drawer } from '../components/Drawer';
import { LineChart } from '../components/charts';
import { fmtDateTime, num } from '../lib/format';

export const deviceCols = (full: boolean): Col<Device>[] => [
  { key: 'name', label: 'Thiết bị', sortKey: 'name', text: (r) => r.name, cell: (r) => <NameCell icon={r.kind === 'tv' ? 'tv' : 'phone'} a={r.name} b={[r.model, r.os].filter(Boolean).join(' · ')} /> },
  { key: 'owner', label: 'Chủ sở hữu', sortKey: 'owner_name', text: (r) => r.owner_name ?? '' },
  ...(full ? [{ key: 'region', label: 'Khu vực', sortKey: 'region', text: (r: Device) => r.region ?? '' }] : []),
  { key: 'app', label: 'Ứng dụng', text: (r) => r.app_version ?? '' },
  { key: 'views', label: 'Quảng cáo đã xem', sortKey: 'views', text: (r) => r.views, cell: (r) => (
    <div style={{ minWidth: 170 }}><b className="mono">{num(r.views)} lượt</b><div style={{ color: 'var(--mut)', fontSize: 12.5 }}>{(r.recent_ads ?? []).slice(0, 2).join(', ')}{(r.recent_ads?.length ?? 0) > 2 ? ` +${r.recent_ads!.length - 2}` : ''}</div></div>) },
  { key: 'seen', label: 'Hoạt động gần nhất', sortKey: 'last_seen_at', text: (r) => fmtDateTime(r.last_seen_at) },
  { key: 'status', label: 'Trạng thái', sortKey: 'status', text: (r) => r.status, cell: (r) => <StatusTag status={r.status} /> },
];

export default function Devices() {
  const { can } = useAuth();
  const act = useAct();
  const [sp, setSp] = useSearchParams();
  const count = (key: string, filter?: string) => useQuery({ queryKey: ['/admin/v1/devices', 'count', key], queryFn: () => api.get('/admin/v1/devices', { query: { page_size: 1, filter }, schema: listOf(deviceSchema) }) }).data?.total; // eslint-disable-line react-hooks/rules-of-hooks
  const all = count('all'), tvs = count('tv', 'kind:tv'), phones = count('ph', 'kind:phone'), chk = count('chk', 'status:checking'), blk = count('blk', 'status:blocked');
  const canWrite = can('devices', 'write');
  return (
    <>
      <PageHead title="Quản lý thiết bị" sub="Danh sách TV, smartphone, trạng thái ghép đôi và telemetry." />
      <div className="g g4">
        <Kpi label="Tổng thiết bị" icon="tv" value={all != null ? num(all) : '—'} foot={tvs != null && phones != null ? `${num(tvs)} TV · ${num(phones)} smartphone` : ''} />
        <Kpi label="Cần rà soát" icon="warn" value={chk != null ? num(chk) : '—'} foot="Đang kiểm tra / chờ xác minh" />
        <Kpi label="Đã chặn" icon="shield" value={blk != null ? num(blk) : '—'} foot="Bị loại khỏi tính hoa hồng" />
      </div>
      <ServerTable id="dv" endpoint="/admin/v1/devices" itemSchema={deviceSchema} cols={deviceCols(true)} title="Danh sách thiết bị" exportName="thiet-bi" onOpen={(r) => setSp({ open: r.id })}
        filters={[
          { key: 'kind', label: 'Loại', options: [{ value: 'tv', label: 'TV' }, { value: 'phone', label: 'Điện thoại' }] },
          { key: 'status', label: 'Trạng thái', options: ['online', 'paired', 'needs_update', 'checking', 'blocked'].map((v) => ({ value: v, label: ({ online: 'Hoạt động', paired: 'Đã ghép đôi', needs_update: 'Cần cập nhật', checking: 'Đang kiểm tra', blocked: 'Bị loại trừ' } as Record<string, string>)[v]! })) },
        ]}
        bulk={canWrite ? [{ key: 'verify', label: 'Xác minh' }, { key: 'block', label: 'Chặn', tone: 'd' }] : []}
        onBulk={(k, ids, done) => void act(() => api.post('/admin/v1/devices/bulk', { body: { action: k, ids } }), k === 'verify' ? `Đã xác minh ${ids.length} thiết bị.` : `Đã chặn ${ids.length} thiết bị.`).then(done)} />
      <DeviceDrawer id={sp.get('open')} onClose={() => setSp({})} canWrite={canWrite} />
    </>
  );
}

export function DeviceDrawer({ id, onClose, canWrite }: { id: string | null; onClose: () => void; canWrite: boolean }) {
  const act = useAct();
  const q = useQuery({ queryKey: ['/admin/v1/devices', 'one', id], enabled: !!id, queryFn: () => api.get(`/admin/v1/devices/${id}`, { schema: deviceSchema }) });
  const d = q.data as (Device & { views_7d?: number[]; seen_ads?: { name: string; brand?: string; views: number }[] }) | undefined;
  const bulk = (a: string) => act(() => api.post('/admin/v1/devices/bulk', { body: { action: a, ids: [id] } }), a === 'verify' ? 'Đã xác minh.' : 'Đã chặn hoa hồng.');
  return (
    <Drawer open={!!id} onClose={onClose}>
      {q.isLoading ? <LoadingBlock /> : q.isError ? <p role="alert" style={{ color: 'var(--bad)' }}>{errMsg(q.error)}</p> : d ? (
        <>
          <h2>{d.name}</h2>
          <p className="sub">{[d.model, d.os].filter(Boolean).join(' · ')}</p>
          <div style={{ marginTop: 12 }}><StatusTag status={d.status} /></div>
          <dl className="kv">
            <dt>Mã thiết bị</dt><dd className="mono">{d.id}</dd><dt>Chủ sở hữu</dt><dd>{d.owner_name ?? '—'}</dd>
            <dt>Khu vực</dt><dd>{d.region ?? '—'}</dd><dt>Ứng dụng</dt><dd>{d.app_version ?? '—'}</dd>
            <dt>Hoạt động</dt><dd>{fmtDateTime(d.last_seen_at)}</dd><dt>Lượt xem hợp lệ</dt><dd>{num(d.views)}</dd>
          </dl>
          <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Quảng cáo đã xem</h3>
          {(d.seen_ads ?? []).map((a) => <div key={a.name} className="mono" style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '10px 12px', background: 'var(--bg)', borderRadius: 8, marginBottom: 6, fontSize: 12.5 }}><span>{a.name}{a.brand ? ` · ${a.brand}` : ''}</span><b>{num(a.views)} lượt</b></div>)}
          {!d.seen_ads?.length ? <p className="sub">Chưa có dữ liệu lượt xem.</p> : null}
          {d.views_7d?.length ? <LineChart series={[{ n: 'Lượt xem', c: '#005BBF', d: d.views_7d }]} labels={d.views_7d.map((_, i) => `N-${d.views_7d!.length - 1 - i}`)} h={150} /> : null}
          {canWrite ? <div className="acts" style={{ marginTop: 20 }}><Btn tone="p" onClick={() => void bulk('verify')}>Xác minh</Btn><Btn tone="d" onClick={() => void bulk('block')}>Chặn hoa hồng</Btn></div> : null}
        </>
      ) : null}
    </Drawer>
  );
}
