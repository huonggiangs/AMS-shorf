import { useMemo, useState } from 'react';
import { z } from 'zod';
import { useAuth } from '../auth/AuthProvider';
import { ServerTable } from '../components/ServerTable';
import type { Col } from '../components/DataTable';
import { Field, PageHead, Tabs, Tag } from '../components/ui';
import { fmtDateTime, vnd } from '../lib/format';

const ref = z.object({ id: z.string(), name: z.string().nullable().optional() }).passthrough();
const impSchema = z
  .object({
    event_id: z.string(),
    ts: z.string(),
    campaign: ref,
    creative: ref.nullable().optional(),
    device: ref.nullable().optional(),
    screen_id: z.string().nullable().optional(),
    vcr_pct: z.coerce.number(),
    valid: z.boolean(),
    reject_reason: z.string().nullable().optional(),
    revenue_vnd: z.number().optional(),
    reward_vnd: z.number().optional(),
  })
  .passthrough();
type Imp = z.infer<typeof impSchema>;

const popSchema = z
  .object({
    ts: z.string(),
    creative: ref,
    campaign: ref.nullable().optional(),
    duration_ms: z.coerce.number(),
    screen_id: z.string().optional(),
    source: z.string().nullable().optional(),
  })
  .passthrough();
type Pop = z.infer<typeof popSchema>;

/** Lịch sử xem quảng cáo (proof-of-play): đọc /history (admin) hoặc /portal/v1/history (khách; máy chủ lọc theo khách trong SQL). */
export default function History() {
  const { isExternal, can } = useAuth();
  const base = isExternal ? '/portal/v1/history' : '/admin/v1/history';
  const [tab, setTab] = useState<'imp' | 'pop'>('imp');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const extra = useMemo(() => ({ from: from || undefined, to: to || undefined }), [from, to]);
  const showMoney = !isExternal && can('finance', 'view');

  const impCols: Col<Imp>[] = [
    { key: 'ts', label: 'Thời điểm', sortKey: 'ts', cell: (r) => fmtDateTime(r.ts), text: (r) => r.ts },
    { key: 'campaign', label: 'Chiến dịch', sortKey: 'campaign', cell: (r) => r.campaign.name ?? r.campaign.id, text: (r) => r.campaign.name ?? r.campaign.id },
    { key: 'creative', label: 'Creative', cell: (r) => r.creative?.name ?? '—', text: (r) => r.creative?.name ?? '' },
    ...(isExternal ? [] : [{ key: 'device', label: 'Thiết bị', cell: (r: Imp) => r.device?.name ?? r.device?.id ?? '—', text: (r: Imp) => r.device?.name ?? r.device?.id ?? '' }]),
    { key: 'vcr_pct', label: 'Xem hết', sortKey: 'vcr_pct', num: true, cell: (r) => `${r.vcr_pct}%`, text: (r) => r.vcr_pct },
    { key: 'valid', label: 'Trạng thái', sortKey: 'valid', cell: (r) => (r.valid ? <Tag tone="ok">Hợp lệ</Tag> : <Tag tone="warn">Không tính{r.reject_reason ? ` · ${r.reject_reason}` : ''}</Tag>), text: (r) => (r.valid ? 'Hợp lệ' : `Không tính ${r.reject_reason ?? ''}`) },
    ...(showMoney ? [{ key: 'revenue_vnd', label: 'Doanh thu', num: true, cell: (r: Imp) => vnd(r.revenue_vnd), text: (r: Imp) => r.revenue_vnd ?? 0 }] : []),
  ];
  const popCols: Col<Pop>[] = [
    { key: 'ts', label: 'Thời điểm', sortKey: 'ts', cell: (r) => fmtDateTime(r.ts), text: (r) => r.ts },
    { key: 'creative', label: 'Creative', cell: (r) => r.creative.name ?? r.creative.id, text: (r) => r.creative.name ?? r.creative.id },
    { key: 'campaign', label: 'Chiến dịch', cell: (r) => r.campaign?.name ?? '—', text: (r) => r.campaign?.name ?? '' },
    ...(isExternal ? [] : [{ key: 'screen_id', label: 'Màn hình', cell: (r: Pop) => r.screen_id ?? '—', text: (r: Pop) => r.screen_id ?? '' }]),
    { key: 'duration_ms', label: 'Thời lượng (giây)', sortKey: 'duration_ms', num: true, cell: (r) => (r.duration_ms / 1000).toLocaleString('vi-VN'), text: (r) => r.duration_ms / 1000 },
  ];

  return (
    <>
      <PageHead title="Lịch sử xem quảng cáo" sub="Đối soát lượt phát theo thiết bị, chiến dịch và trạng thái." />
      <Tabs value={tab} onChange={setTab} items={[{ id: 'imp', label: 'Lượt xem' }, { id: 'pop', label: 'Proof-of-play' }]} />
      <div className="card cp" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label="Từ ngày"><input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="Đến ngày"><input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      {tab === 'imp' ? (
        <ServerTable
          id="history-imp"
          endpoint={base}
          itemSchema={impSchema}
          cols={impCols}
          rowKey={(r) => r.event_id}
          pageSize={20}
          extra={extra}
          exportName="lich-su-xem"
          emptyText="Chưa có lượt xem trong khoảng đã chọn."
          filters={[{ key: 'valid', label: 'Trạng thái', options: [{ value: 'true', label: 'Hợp lệ' }, { value: 'false', label: 'Không tính' }] }]}
        />
      ) : (
        <ServerTable id="history-pop" endpoint={`${base}/proof-of-play`} itemSchema={popSchema} cols={popCols} rowKey={(r) => `${r.ts}|${r.creative.id}|${r.screen_id ?? ''}`} pageSize={20} extra={extra} exportName="proof-of-play" emptyText="Chưa có bản ghi proof-of-play." />
      )}
    </>
  );
}
