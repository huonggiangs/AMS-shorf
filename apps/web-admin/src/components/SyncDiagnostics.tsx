import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '../api/client';
import { DataTable, initialTableState } from './DataTable';
import type { Col } from './DataTable';
import { ErrorBlock, LoadingBlock, Tag } from './ui';
import { fmtDateTime, num } from '../lib/format';

const code = z.enum(['ok', 'no_devices', 'offline', 'pending_trust', 'blocked', 'no_events', 'all_rejected', 'not_counted', 'ingest_lag']);
type Code = z.infer<typeof code>;
const counts = z.record(z.string(), z.coerce.number());
const dev = z.object({
  id: z.string(), name: z.string().nullable(), kind: z.string(), location: z.string().nullable(), trust_level: z.number(), online: z.boolean(),
  last_heartbeat_at: z.string().nullable(), last_event_at: z.string().nullable(),
  received_24h: z.number(), accepted_24h: z.number(), valid_24h: z.number(), rejected_24h: z.number(), stored_24h: z.number(),
  rejected_by_reason: counts, flagged_by_reason: counts, aliases: counts, code, explain: z.string(),
}).passthrough();
const schema = z.object({
  generated_at: z.string(),
  summary: z.object({ code, explain: z.string(), devices: z.number(), online: z.number(), events_accepted_24h: z.number(), events_rejected_24h: z.number(), stored_24h: z.number(), ingest_gap: z.number(), last_event_at: z.string().nullable(), queue_lag_s: z.number().nullable() }),
  devices: z.array(dev),
}).passthrough();
type Dev = z.infer<typeof dev>;

const REASON: Record<string, string> = {
  malformed: 'sai định dạng', not_in_manifest: 'creative không thuộc lịch phát', campaign_mismatch: 'sai chiến dịch', ts_out_of_range: 'lệch giờ máy (quá 48 giờ hoặc ở tương lai)',
  untrusted_device: 'thiết bị chưa cấp quyền', vcr_low: 'xem chưa hết', short_play: 'phát chưa đủ 90% thời lượng', rate_cap: 'vượt trần lượt/giờ', no_price: 'chưa có giá chốt', pending_trust: 'chờ cấp quyền',
};
const TONE: Record<Code, 'ok' | 'warn' | 'bad' | 'info'> = { ok: 'ok', no_devices: 'warn', offline: 'bad', pending_trust: 'warn', blocked: 'bad', no_events: 'warn', all_rejected: 'bad', not_counted: 'warn', ingest_lag: 'warn' };
const LABEL: Record<Code, string> = { ok: 'Bình thường', no_devices: 'Chưa có thiết bị', offline: 'Offline', pending_trust: 'Chờ cấp quyền', blocked: 'Bị chặn', no_events: 'Chưa gửi lượt phát', all_rejected: 'Bị từ chối hết', not_counted: 'Chưa tính', ingest_lag: 'Đang chờ xử lý' };
const chips = (m: Record<string, number>): string => Object.entries(m).map(([k, v]) => `${REASON[k] ?? k}: ${v}`).join('; ');

/** Chip "Chẩn đoán đồng bộ" + bảng theo thiết bị: vì sao số lượt xem đang 0 hay thấp (offline / app không gửi / chờ cấp quyền / bị từ chối / chờ xử lý). */
export function SyncDiagnostics() {
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['/admin/v1/history/diagnostics'], queryFn: () => api.get('/admin/v1/history/diagnostics', { schema }), refetchInterval: open ? 30_000 : false });
  const s = q.data?.summary;
  const cols: Col<Dev>[] = [
    { key: 'name', label: 'Thiết bị', cell: (r) => `${r.name ?? r.id} (${r.kind})`, text: (r) => r.name ?? r.id },
    { key: 'loc', label: 'Địa điểm', cell: (r) => r.location ?? '—', text: (r) => r.location ?? '' },
    { key: 'hb', label: 'Nhịp tim cuối', cell: (r) => (r.last_heartbeat_at ? fmtDateTime(r.last_heartbeat_at) : '—'), text: (r) => r.last_heartbeat_at ?? '' },
    { key: 'ev', label: 'Sự kiện cuối', cell: (r) => (r.last_event_at ? fmtDateTime(r.last_event_at) : '—'), text: (r) => r.last_event_at ?? '' },
    { key: 'acc', label: 'Nhận 24h', num: true, cell: (r) => num(r.accepted_24h), text: (r) => r.accepted_24h },
    { key: 'val', label: 'Hợp lệ', num: true, cell: (r) => num(r.valid_24h), text: (r) => r.valid_24h },
    { key: 'rej', label: 'Từ chối', num: true, cell: (r) => num(r.rejected_24h), text: (r) => r.rejected_24h },
    { key: 'why', label: 'Lý do từ chối / không tính', cell: (r) => [chips(r.rejected_by_reason), chips(r.flagged_by_reason)].filter(Boolean).join(' | ') || '—', text: (r) => chips(r.rejected_by_reason) },
    { key: 'st', label: 'Chẩn đoán', cell: (r) => <span title={r.explain}><Tag tone={TONE[r.code]}>{LABEL[r.code]}</Tag></span>, text: (r) => LABEL[r.code] },
  ];
  return (
    <div className="card cp">
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>Chẩn đoán đồng bộ</button>
        {q.isLoading ? <span className="sub">Đang kiểm tra…</span> : s ? <Tag tone={TONE[s.code]}>{LABEL[s.code]}</Tag> : null}
        {s ? <span className="sub">{s.online}/{s.devices} thiết bị online · 24 giờ qua: nhận {num(s.events_accepted_24h)}, từ chối {num(s.events_rejected_24h)}, đã ghi {num(s.stored_24h)}{s.last_event_at ? ` · sự kiện cuối ${fmtDateTime(s.last_event_at)}` : ''}</span> : null}
      </div>
      {s ? <p className="sub" role="status" style={{ margin: '8px 0 0' }}>{s.explain}{s.ingest_gap > 0 && s.queue_lag_s !== null ? ` (${num(s.ingest_gap)} sự kiện chờ ghi, trễ khoảng ${Math.ceil(s.queue_lag_s / 60)} phút)` : ''}</p> : null}
      {open ? (q.isError ? <ErrorBlock error={q.error} onRetry={() => void q.refetch()} /> : q.isLoading ? <LoadingBlock /> : q.data ? (
        <div style={{ marginTop: 12 }}>
          <DataTable<Dev> cols={cols} rows={q.data.devices} total={q.data.devices.length} pageSize={25} rowKey={(r) => r.id} state={initialTableState} onState={() => undefined} emptyText="Chưa có thiết bị." />
          <p className="sub">Nhịp tim cập nhật tối đa mỗi 10 phút. Số liệu 24 giờ gần nhất. Màn hình gửi lượt phát mỗi vài phút nên con số có thể trễ.</p>
        </div>
      ) : null) : null}
    </div>
  );
}
