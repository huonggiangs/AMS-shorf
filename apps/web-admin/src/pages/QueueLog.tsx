import { useState } from 'react';
import { bpLogSchema, devLogSchema, heartbeatSchema, queueSchema, type BpLog, type DevLog, type Heartbeat, type QueueRow } from '../api/schemasBp';
import { api } from '../api/client';
import { useAct } from '../api/hooks';
import { useAuth } from '../auth/AuthProvider';
import { ServerTable } from '../components/ServerTable';
import type { Col, FilterDef } from '../components/DataTable';
import { Btn, Note, PageHead, Tabs, Tag } from '../components/ui';
import { fmtDateTime } from '../lib/format';

type TabId = 'queue' | 'logs' | 'events';
const B = '/admin/v1/broadcast-insights';
const STATE: Record<string, [string, 'ok' | 'warn' | 'bad' | 'info']> = { pending: ['Đang chờ', 'warn'], delivered: ['Đã giao', 'info'], acked: ['Đã xác nhận', 'ok'], failed: ['Lỗi / đã hủy', 'bad'], expired: ['Hết hạn', 'info'] };
const ACTION: Record<string, string> = { 'broadcast.create': 'Tạo chương trình', 'broadcast.update': 'Sửa chương trình', 'broadcast.publish': 'Xuất bản', 'broadcast.unpublish': 'Dừng phát', 'broadcast.delete': 'Xóa chương trình', 'broadcast.notice': 'Thông báo khẩn', 'broadcast.recommend': 'Đề xuất phân phối' };
const summary = (l: BpLog): string => {
  const d = (l.diff ?? {}) as Record<string, unknown>;
  const name = typeof d['name'] === 'string' ? d['name'] : typeof d['text'] === 'string' ? d['text'] : '';
  return `${name}${l.object_id ? ` ${l.object_id}` : ''}`.trim();
};

/** Hàng đợi lệnh gửi thiết bị, nhật ký phát sóng (audit broadcast.*) và sự kiện thiết bị gần đây. */
export default function QueueLog() {
  const { can } = useAuth();
  const act = useAct();
  const [tab, setTab] = useState<TabId>('queue');
  const canWrite = can('devices', 'write');
  const cancel = (r: QueueRow) => act(() => api.post(`/admin/v1/devices/${r.device_id}/commands/${r.id}/cancel`, { body: {} }), 'Đã hủy lệnh.', [B]);
  const retry = (r: QueueRow) => act(() => api.post(`/admin/v1/devices/${r.device_id}/commands`, { body: { type: r.type, args: r.args } }), 'Đã xếp lại lệnh.', [B]);

  const queueCols: Col<QueueRow>[] = [
    { key: 'created_at', label: 'Tạo lúc', sortKey: 'created_at', text: (r) => fmtDateTime(r.created_at) },
    { key: 'device', label: 'Thiết bị', text: (r) => r.device_name ?? r.device_id, cell: (r) => <span>{r.device_name ?? r.device_id}<br /><small className="mono">{r.region ?? ''} {r.device_kind ?? ''}</small></span> },
    { key: 'type', label: 'Lệnh', sortKey: 'type', text: (r) => r.type, cell: (r) => <span>{r.type}{Object.keys(r.args).length ? <><br /><small className="mono">{JSON.stringify(r.args).slice(0, 80)}</small></> : null}</span> },
    { key: 'state', label: 'Trạng thái', text: (r) => STATE[r.state]?.[0] ?? r.state, cell: (r) => <Tag tone={STATE[r.state]?.[1] ?? 'info'}>{STATE[r.state]?.[0] ?? r.state}</Tag> },
    { key: 'deliveries', label: 'Lần giao', num: true, text: (r) => r.deliveries },
    { key: 'act', label: '', cell: (r) => canWrite ? (
      <span style={{ display: 'flex', gap: 6 }}>
        {r.cancellable ? <Btn onClick={() => { if (window.confirm('Hủy lệnh này?')) void cancel(r); }}>Hủy</Btn> : null}
        {r.state === 'failed' || r.state === 'expired' ? <Btn onClick={() => void retry(r)}>Thử lại</Btn> : null}
      </span>
    ) : null },
  ];
  const queueFilters: FilterDef[] = [{ key: 'status', label: 'Trạng thái', options: Object.entries(STATE).map(([value, [label]]) => ({ value, label })) }];
  const logCols: Col<BpLog>[] = [
    { key: 'at', label: 'Thời gian', sortKey: 'at', text: (r) => fmtDateTime(r.at) },
    { key: 'actor', label: 'Người thực hiện', sortKey: 'actor', text: (r) => r.actor },
    { key: 'action', label: 'Hành động', sortKey: 'action', text: (r) => ACTION[r.action] ?? r.action },
    { key: 'detail', label: 'Chi tiết', text: summary },
  ];
  const logFilters: FilterDef[] = [{ key: 'action', label: 'Hành động', options: Object.entries(ACTION).map(([value, label]) => ({ value, label })) }];
  const devCols: Col<DevLog>[] = [
    { key: 'ts', label: 'Thời gian', sortKey: 'ts', text: (r) => fmtDateTime(r.at) },
    { key: 'device', label: 'Thiết bị', text: (r) => r.device_name ?? r.device_id },
    { key: 'level', label: 'Mức', sortKey: 'level', text: (r) => r.level },
    { key: 'tag', label: 'Nhãn', text: (r) => r.tag ?? '' },
    { key: 'message', label: 'Nội dung', text: (r) => r.message },
  ];
  const hbCols: Col<Heartbeat>[] = [
    { key: 'ts', label: 'Thời gian', sortKey: 'ts', text: (r) => fmtDateTime(r.at) },
    { key: 'device', label: 'Thiết bị', text: (r) => r.device_name ?? r.device_id },
    { key: 'app', label: 'Phiên bản', text: (r) => r.app_ver ?? '' },
    { key: 'temp', label: 'Nhiệt độ (°C)', num: true, text: (r) => r.soc_temp ?? '' },
    { key: 'rssi', label: 'Sóng (dBm)', num: true, text: (r) => r.rssi ?? '' },
    { key: 'cache', label: 'Bộ nhớ đệm (MB)', num: true, text: (r) => r.cache_used_mb ?? '' },
  ];
  return (
    <>
      <PageHead eyebrow="Giám sát" title="Hàng đợi & Nhật ký" sub="Theo dõi lệnh đã gửi tới thiết bị, thao tác phát sóng của người dùng và sự kiện thiết bị gần đây." />
      <Tabs<TabId> value={tab} onChange={setTab} label="Mục theo dõi" items={[{ id: 'queue', label: 'Hàng đợi lệnh' }, { id: 'logs', label: 'Nhật ký phát sóng' }, { id: 'events', label: 'Sự kiện thiết bị' }]} />
      {tab === 'queue' ? (
        <>
          <Note>Thiết bị nhận lệnh ở lần heartbeat kế tiếp, không phải tức thì. Chỉ lệnh đang chờ/đã giao mới hủy được; lệnh lỗi hoặc hết hạn có thể thử lại.</Note>
          <ServerTable id="bq" endpoint={`${B}/queue`} itemSchema={queueSchema} cols={queueCols} filters={queueFilters} pageSize={10} exportName="hang-doi-lenh" />
        </>
      ) : tab === 'logs' ? (
        <ServerTable id="bl" endpoint={`${B}/logs`} itemSchema={bpLogSchema} cols={logCols} filters={logFilters} pageSize={10} exportName="nhat-ky-phat-song" />
      ) : (
        <>
          <ServerTable id="bd" title="Nhật ký thiết bị" endpoint={`${B}/events/logs`} itemSchema={devLogSchema} cols={devCols} pageSize={8} exportName="nhat-ky-thiet-bi" />
          <ServerTable id="bh" title="Heartbeat gần đây" endpoint={`${B}/events/heartbeat`} itemSchema={heartbeatSchema} cols={hbCols} rowKey={(r) => r.id} pageSize={8} exportName="heartbeat" />
        </>
      )}
    </>
  );
}
