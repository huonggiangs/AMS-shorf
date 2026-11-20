import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, errMsg } from '../api/client';
import { deviceSchema, listOf, type Device } from '../api/schemas';
import { useAct } from '../api/hooks';
import { useAuth } from '../auth/AuthProvider';
import { ServerTable } from '../components/ServerTable';
import type { Col } from '../components/DataTable';
import { Btn, Kpi, LoadingBlock, NameCell, PageHead, StatusTag, Tag } from '../components/ui';
import { Drawer } from '../components/Drawer';
import { LineChart } from '../components/charts';
import { fmtDateTime, num } from '../lib/format';
import { DeviceCommands, OwnerForm, PairDialog } from '../components/DeviceOps';
import { ApproveDevice, DeviceLogs, isSignage, kindLabel } from '../components/SignageOps';

type DevEx = Device & { pairing_state?: string; trust_level?: number; paired_at?: string | null };
const SRC_LABEL: Record<string, string> = { ams: 'AMS (mạng)', usb: 'USB', lan: 'LAN' };
/** TV: đã ghép mã; thang máy/LED: đã được cấp quyền (không dùng mã 6 số). */
export const isPaired = (d: DevEx): boolean => !!d.paired_at || (isSignage(d.kind) && (d.trust_level ?? 0) >= 1);
const PAIR_LABEL: Record<string, string> = { pending: 'Chờ ghép mã', awaiting_approval: 'Chờ cấp quyền', approved: 'Đã cấp quyền', paired: 'Đã ghép (tin cậy 1)', verified: 'Đã xác minh (tin cậy 2)', blocked: 'Bị chặn' };
export const pairingText = (r: Device): string => PAIR_LABEL[(r as DevEx).pairing_state ?? ''] ?? '';
function PairTag({ d }: { d: Device }) {
  const s = (d as DevEx).pairing_state;
  if (!s) return <span>—</span>;
  return <Tag tone={s === 'pending' || s === 'awaiting_approval' ? 'warn' : s === 'blocked' ? 'bad' : s === 'verified' || s === 'approved' ? 'ok' : 'info'}>{PAIR_LABEL[s] ?? s}</Tag>;
}

export const deviceCols = (full: boolean): Col<Device>[] => [
  { key: 'name', label: 'Thiết bị', sortKey: 'name', text: (r) => r.name, cell: (r) => <NameCell icon={r.kind === 'phone' ? 'phone' : 'tv'} a={r.name} b={[isSignage(r.kind) ? kindLabel(r.kind) : null, r.model, r.os].filter(Boolean).join(' · ')} /> },
  { key: 'pair', label: 'Ghép mã', text: (r) => pairingText(r), cell: (r) => <PairTag d={r} /> },
  { key: 'owner', label: 'Chủ sở hữu', sortKey: 'owner_name', text: (r) => r.owner_name ?? '' },
  ...(full ? [{ key: 'region', label: 'Khu vực', sortKey: 'region', text: (r: Device) => r.region ?? '' }] : []),
  { key: 'app', label: 'Ứng dụng', text: (r) => r.app_version ?? '' },
  { key: 'src', label: 'Nguồn phát', text: (r) => (r.play_source ? SRC_LABEL[r.play_source] ?? r.play_source : '') },
  { key: 'cache', label: 'Bộ nhớ đệm', num: true, text: (r) => (r.cache_mb != null ? `${num(r.cache_mb)} MB` : '') },
  { key: 'views', label: 'Quảng cáo đã xem', sortKey: 'views', text: (r) => r.views, cell: (r) => (
    <div style={{ minWidth: 170 }}><b className="mono">{num(r.views)} lượt</b><div style={{ color: 'var(--mut)', fontSize: 12.5 }}>{(r.recent_ads ?? []).slice(0, 2).join(', ')}{(r.recent_ads?.length ?? 0) > 2 ? ` +${r.recent_ads!.length - 2}` : ''}</div></div>) },
  { key: 'seen', label: 'Heartbeat gần nhất', sortKey: 'last_seen_at', text: (r) => fmtDateTime(r.last_seen_at) },
  { key: 'status', label: 'Trạng thái', sortKey: 'status', text: (r) => r.status, cell: (r) => <StatusTag status={r.status} /> },
];

export default function Devices() {
  const { can } = useAuth();
  const act = useAct();
  const [sp, setSp] = useSearchParams();
  const count = (key: string, filter?: string) => useQuery({ queryKey: ['/admin/v1/devices', 'count', key], queryFn: () => api.get('/admin/v1/devices', { query: { page_size: 1, filter }, schema: listOf(deviceSchema) }) }).data?.total; // eslint-disable-line react-hooks/rules-of-hooks
  const wait = count('wait', 'status:awaiting_approval');
  const pend = count('pend', 'status:unpaired'), all = count('all'), tvs = count('tv', 'kind:tv'), phones = count('ph', 'kind:phone'), chk = count('chk', 'status:checking'), blk = count('blk', 'status:blocked');
  const canWrite = can('devices', 'write');
  const canApprove = can('devices', 'approve');
  const [pairOpen, setPairOpen] = useState(false);
  return (
    <>
      <PageHead title="Quản lý thiết bị" sub="Danh sách TV, smartphone, trạng thái ghép đôi và telemetry." actions={canWrite ? <Btn tone="p" icon="plus" onClick={() => setPairOpen(true)}>Ghép mã</Btn> : undefined} />
      <div className="g g4">
        <Kpi label="Tổng thiết bị" icon="tv" value={all != null ? num(all) : '—'} foot={tvs != null && phones != null ? `${num(tvs)} TV · ${num(phones)} smartphone` : ''} />
 
        <Kpi label="Chờ ghép mã" icon="link" value={pend != null ? num(pend) : '—'} foot="TV đã đăng ký, chưa nhập mã 6 số" />
        <Kpi label="Chờ cấp quyền" icon="link" value={wait != null ? num(wait) : '—'} foot="Thang máy / LED đã tự đăng ký, chờ vận hành cấp quyền" />
        <Kpi label="Cần rà soát" icon="warn" value={chk != null ? num(chk) : '—'} foot="Đang kiểm tra / chờ xác minh" />
        <Kpi label="Đã chặn" icon="shield" value={blk != null ? num(blk) : '—'} foot="Bị loại khỏi tính hoa hồng" />
      </div>
      <ServerTable id="dv" endpoint="/admin/v1/devices" itemSchema={deviceSchema} cols={deviceCols(true)} title="Danh sách thiết bị" exportName="thiet-bi" onOpen={(r) => setSp({ open: r.id })}
        filters={[
          { key: 'kind', label: 'Loại', options: [{ value: 'tv', label: 'TV' }, { value: 'phone', label: 'Điện thoại' }, { value: 'elevator', label: 'Thang máy' }, { value: 'led_p5', label: 'LED P5' }] },
          { key: 'source', label: 'Nguồn phát', options: [{ value: 'ams', label: 'AMS (mạng)' }, { value: 'usb', label: 'USB' }, { value: 'lan', label: 'LAN' }] },
          { key: 'status', label: 'Trạng thái', options: ['online', 'paired', 'needs_update', 'checking', 'blocked', 'unpaired', 'awaiting_approval'].map((v) => ({ value: v, label: ({ online: 'Hoạt động', paired: 'Đã ghép đôi', needs_update: 'Cần cập nhật', checking: 'Đang kiểm tra', blocked: 'Bị loại trừ', unpaired: 'Chờ ghép mã', awaiting_approval: 'Chờ cấp quyền' } as Record<string, string>)[v]! })) },
        ]}
        bulk={canWrite ? [{ key: 'verify', label: 'Xác minh' }, { key: 'block', label: 'Chặn', tone: 'd' }] : []}
        onBulk={(k, ids, done) => void act(() => api.post('/admin/v1/devices/bulk', { body: { action: k, ids } }), k === 'verify' ? `Đã xác minh ${ids.length} thiết bị.` : `Đã chặn ${ids.length} thiết bị.`).then(done)} />
      <PairDialog open={pairOpen} onClose={() => setPairOpen(false)} onDone={(id) => setSp({ open: id })} />
      <DeviceDrawer id={sp.get('open')} onClose={() => setSp({})} canWrite={canWrite} canApprove={canApprove} />
    </>
  );
}

export function DeviceDrawer({ id, onClose, canWrite, canApprove }: { id: string | null; onClose: () => void; canWrite: boolean; canApprove?: boolean }) {
  const act = useAct();
  const { can } = useAuth();
  const mayApprove = canApprove ?? can('devices', 'approve');
  const q = useQuery({ queryKey: ['/admin/v1/devices', 'one', id], enabled: !!id, queryFn: () => api.get(`/admin/v1/devices/${id}`, { schema: deviceSchema }) });
  const d = q.data as (DevEx & { delivery?: unknown; views_7d?: number[]; seen_ads?: { name: string; brand?: string; views: number }[] }) | undefined;
  const bulk = (a: string) => act(() => api.post('/admin/v1/devices/bulk', { body: { action: a, ids: [id] } }), a === 'verify' ? 'Đã xác minh.' : 'Đã chặn hoa hồng.');
  return (
    <Drawer open={!!id} onClose={onClose}>
      {q.isLoading ? <LoadingBlock /> : q.isError ? <p role="alert" style={{ color: 'var(--bad)' }}>{errMsg(q.error)}</p> : d ? (
        <>
          <h2>{d.name}</h2>
          <p className="sub">{[d.model, d.os].filter(Boolean).join(' · ')}</p>
          <div style={{ marginTop: 12 }}><StatusTag status={d.status} /></div>
          <dl className="kv">
            <dt>Mã thiết bị</dt><dd className="mono">{d.id}</dd><dt>Ghép mã</dt><dd><PairTag d={d} />{d.paired_at ? ` · ${fmtDateTime(d.paired_at)}` : ''}</dd>
            <dt>Chủ sở hữu</dt><dd>{d.owner_name ?? '—'}</dd>
            {isSignage(d.kind) ? <><dt>Loại / độ phân giải</dt><dd>{kindLabel(d.kind)}{d.px_w && d.px_h ? ` · ${d.px_w}×${d.px_h}${d.orientation ? ` ${d.orientation}` : ''}` : ''}</dd><dt>Vị trí</dt><dd>{d.screen ? `${d.screen.venue_name ?? d.screen.venue_id ?? ''} (${d.screen.id})` : '—'}</dd><dt>Nguồn phát</dt><dd>{d.play_source ? SRC_LABEL[d.play_source] ?? d.play_source : '—'}</dd><dt>Bộ nhớ đệm</dt><dd>{d.cache_mb != null ? `${num(d.cache_mb)} MB` : '—'}</dd></> : null}
            <dt>Khu vực</dt><dd>{d.region ?? '—'}</dd><dt>Ứng dụng</dt><dd>{d.app_version ?? '—'}</dd>
            <dt>Heartbeat gần nhất</dt><dd>{fmtDateTime(d.last_seen_at)}</dd><dt>Lượt xem hợp lệ</dt><dd>{num(d.views)}</dd>
          </dl>
          {canWrite ? <OwnerForm key={`${d.id}-${d.owner_name ?? ''}`} deviceId={d.id} current={d.owner_name} paired={isPaired(d)} /> : null}
          {isSignage(d.kind) ? <ApproveDevice deviceId={d.id} kind={d.kind!} grantState={d.grant_state} screenLabel={d.screen ? `${d.screen.venue_name ?? d.screen.venue_id ?? ''} (${d.screen.id})` : null} canApprove={mayApprove} /> : null}
          <DeviceCommands deviceId={d.id} paired={isPaired(d)} canWrite={canWrite} signage={isSignage(d.kind)} />
          {isSignage(d.kind) ? <DeviceLogs deviceId={d.id} /> : null}
          <h3 style={{ margin: '18px 0 8px', fontSize: 15 }}>Quảng cáo đã xem</h3>
          {(d.seen_ads ?? []).map((a) => <div key={a.name} className="mono" style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '10px 12px', background: 'var(--bg)', borderRadius: 8, marginBottom: 6, fontSize: 12.5 }}><span>{a.name}{a.brand ? ` · ${a.brand}` : ''}</span><b>{num(a.views)} lượt</b></div>)}
          {!d.seen_ads?.length ? <p className="sub">Chưa có dữ liệu lượt xem.</p> : null}
          {d.views_7d?.length ? <LineChart series={[{ n: 'Lượt xem', c: '#005BBF', d: d.views_7d }]} labels={d.views_7d.map((_, i) => `N-${d.views_7d!.length - 1 - i}`)} h={150} /> : null}
          {canWrite ? <div className="acts" style={{ marginTop: 20 }}><Btn tone="p" onClick={() => void bulk('verify')}>Xác minh (tin cậy 2)</Btn><Btn tone="d" onClick={() => void bulk('block')}>Chặn hoa hồng</Btn></div> : null}
        </>
      ) : null}
    </Drawer>
  );
}
