import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { API_BASE, api } from '../api/client';
import { GroupBars } from './charts';
import { DataTable, initialTableState } from './DataTable';
import type { Col } from './DataTable';
import { ErrorBlock, Field, Kpi, LoadingBlock, Note } from './ui';
import { Icon } from './Icon';
import { fmtDateTime, num } from '../lib/format';

const row = z.object({ views: z.coerce.number(), watched_s: z.coerce.number() }).passthrough();
const reportSchema = z
  .object({
    range: z.object({ from: z.string(), to: z.string() }),
    scope: z.object({ customer: z.object({ id: z.string(), name: z.string() }).nullable() }),
    totals: z.object({ views: z.number(), watched_s: z.number(), campaigns: z.number(), devices: z.number(), locations: z.number() }),
    windows: z.object({ today: z.number(), d7: z.number(), d30: z.number() }),
    by_day: z.array(row.extend({ day: z.string() })),
    by_campaign: z.array(row.extend({ id: z.string(), name: z.string().nullable() })),
    by_creative: z.array(row.extend({ id: z.string(), name: z.string().nullable(), campaign_name: z.string().nullable().optional() })),
    by_location: z.array(row.extend({ id: z.string().nullable(), name: z.string(), devices: z.number().optional() })),
    by_device: z.array(row.extend({ id: z.string(), name: z.string().nullable(), location: z.string().nullable(), last_view_at: z.string().nullable() })).optional(),
    note: z.string(),
  })
  .passthrough();
type Report = z.infer<typeof reportSchema>;
type CampRow = Report['by_campaign'][number];
type CreRow = Report['by_creative'][number];
type LocRow = Report['by_location'][number];
type DevRow = NonNullable<Report['by_device']>[number];

const listSchema = z.object({ items: z.array(z.object({ id: z.string(), name: z.string().nullable().optional() }).passthrough()) }).passthrough();

export const fmtDur = (s: number): string => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h} giờ ${m} phút` : m > 0 ? `${m} phút ${s % 60} giây` : `${s} giây`;
};
const vnToday = (): string => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const vnAgo = (d: number): string => new Date(Date.now() + 7 * 3600_000 - d * 86_400_000).toISOString().slice(0, 10);

/**
 * Bao cao luot xem (admin: /admin/v1/reports/views, khach: /portal/v1/reports/views). Hien so hom nay / 7 ngay / 30 ngay, bieu do theo ngay,
 * theo chien dich, creative, dia diem (+ thiet bi cho noi bo) va tai CSV / HTML / PDF (cung bo loc). May chu loc theo khach trong SQL.
 */
export function ViewsReport({ external }: { external: boolean }) {
  const base = external ? '/portal/v1/reports/views' : '/admin/v1/reports/views';
  const [from, setFrom] = useState(vnAgo(29));
  const [to, setTo] = useState(vnToday());
  const [campaign, setCampaign] = useState('');
  const [customer, setCustomer] = useState('');
  const [device, setDevice] = useState('');
  const query = useMemo(() => ({ from, to, campaign_id: campaign || undefined, customer_id: customer || undefined, device_id: device || undefined }), [from, to, campaign, customer, device]);
  const q = useQuery({ queryKey: [base, query], queryFn: () => api.get(base, { query, schema: reportSchema }) });
  const camps = useQuery({ queryKey: [external ? '/portal/v1/campaigns' : '/admin/v1/campaigns', 'pick'], queryFn: () => api.get(external ? '/portal/v1/campaigns' : '/admin/v1/campaigns', { query: { page_size: 200 }, schema: listSchema }) });
  const custs = useQuery({ enabled: !external, queryKey: ['/admin/v1/customers', 'pick'], queryFn: () => api.get('/admin/v1/customers', { query: { page_size: 200 }, schema: listSchema }) });
  const d = q.data;
  const href = (kind: 'export.csv' | 'report.html' | 'report.pdf'): string => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v) p.set(k, String(v));
    return `${API_BASE}${base}/${kind}?${p.toString()}`;
  };
  const dis = !d || d.totals.views === 0;

  const campCols: Col<CampRow>[] = [
    { key: 'name', label: 'Chiến dịch', cell: (r) => r.name ?? r.id, text: (r) => r.name ?? r.id },
    { key: 'views', label: 'Số lượt xem', num: true, cell: (r) => num(r.views), text: (r) => r.views },
    { key: 'watched', label: 'Thời lượng (giây)', num: true, cell: (r) => num(r.watched_s), text: (r) => r.watched_s },
  ];
  const creCols: Col<CreRow>[] = [
    { key: 'name', label: 'Creative', cell: (r) => r.name ?? r.id, text: (r) => r.name ?? r.id },
    { key: 'camp', label: 'Chiến dịch', cell: (r) => r.campaign_name ?? '—', text: (r) => r.campaign_name ?? '' },
    { key: 'views', label: 'Số lượt xem', num: true, cell: (r) => num(r.views), text: (r) => r.views },
    { key: 'watched', label: 'Thời lượng (giây)', num: true, cell: (r) => num(r.watched_s), text: (r) => r.watched_s },
  ];
  const locCols: Col<LocRow>[] = [
    { key: 'name', label: 'Địa điểm', cell: (r) => r.name, text: (r) => r.name },
    { key: 'views', label: 'Số lượt xem', num: true, cell: (r) => num(r.views), text: (r) => r.views },
    { key: 'watched', label: 'Thời lượng (giây)', num: true, cell: (r) => num(r.watched_s), text: (r) => r.watched_s },
  ];
  const devCols: Col<DevRow>[] = [
    { key: 'name', label: 'Thiết bị', cell: (r) => r.name ?? r.id, text: (r) => r.name ?? r.id },
    { key: 'loc', label: 'Địa điểm', cell: (r) => r.location ?? '—', text: (r) => r.location ?? '' },
    { key: 'last', label: 'Lượt xem gần nhất', cell: (r) => (r.last_view_at ? fmtDateTime(r.last_view_at) : '—'), text: (r) => r.last_view_at ?? '' },
    { key: 'views', label: 'Số lượt xem', num: true, cell: (r) => num(r.views), text: (r) => r.views },
    { key: 'watched', label: 'Thời lượng (giây)', num: true, cell: (r) => num(r.watched_s), text: (r) => r.watched_s },
  ];
  const tbl = <R,>(title: string, cols: Col<R>[], rows: R[], key: (r: R) => string) => (
    <DataTable<R> title={title} cols={cols} rows={rows} total={rows.length} pageSize={Math.max(5, Math.min(rows.length, 50))} rowKey={key} state={initialTableState} onState={() => undefined} emptyText="Chưa có lượt xem trong khoảng đã chọn." />
  );

  return (
    <>
      <div className="card cp" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label="Từ ngày"><input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} /></Field>
        <Field label="Đến ngày"><input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} /></Field>
        <Field label="Chiến dịch">
          <select className="sel" value={campaign} onChange={(e) => setCampaign(e.target.value)}>
            <option value="">Tất cả</option>
            {(camps.data?.items ?? []).map((c) => <option key={c.id} value={c.id}>{c.name ?? c.id}</option>)}
          </select>
        </Field>
        {!external ? (
          <Field label="Khách hàng">
            <select className="sel" value={customer} onChange={(e) => setCustomer(e.target.value)}>
              <option value="">Tất cả</option>
              {(custs.data?.items ?? []).map((c) => <option key={c.id} value={c.id}>{(c as { short_name?: string }).short_name ?? c.name ?? c.id}</option>)}
            </select>
          </Field>
        ) : null}
        {!external ? <Field label="Mã thiết bị"><input value={device} onChange={(e) => setDevice(e.target.value.trim())} placeholder="Tất cả" /></Field> : null}
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' }}>
          {([['export.csv', 'Tải CSV'], ['report.pdf', 'Báo cáo PDF'], ['report.html', 'Báo cáo HTML']] as const).map(([k, label]) =>
            dis ? <button key={k} type="button" className="btn" disabled title="Chưa có lượt xem để xuất"><Icon n="dl" />{label}</button> : <a key={k} className="btn" href={href(k)} download><Icon n="dl" />{label}</a>)}
        </div>
      </div>
      {q.isLoading ? <LoadingBlock /> : q.isError ? <ErrorBlock error={q.error} onRetry={() => void q.refetch()} /> : d ? (
        <>
          <div className="g g4">
            <Kpi label="Lượt xem hôm nay" icon="eye" value={num(d.windows.today)} />
            <Kpi label="7 ngày gần nhất" icon="eye" value={num(d.windows.d7)} />
            <Kpi label="30 ngày gần nhất" icon="eye" value={num(d.windows.d30)} />
            <Kpi label="Trong khoảng đã chọn" icon="eye" value={num(d.totals.views)} foot={`Thời lượng phát ${fmtDur(d.totals.watched_s)}`} />
          </div>
          <div className="card cp">
            <div className="ch"><div><h2>Lượt xem theo ngày</h2><p>Giờ Việt Nam (UTC+7)</p></div></div>
            {d.by_day.length ? <GroupBars data={d.by_day.map((x) => ({ label: x.day.slice(5).replace('-', '/'), a: x.views, b: 0, tip: `${x.day}: ${num(x.views)} lượt · ${fmtDur(x.watched_s)}` }))} /> : null}
            {d.totals.views === 0 ? <p className="sub" role="status">Chưa có lượt xem trong khoảng này. Số liệu cập nhật sau vài phút kể từ khi màn hình gửi dữ liệu (màn gửi mỗi vài phút).{!external ? ' Mở “Chẩn đoán đồng bộ” để biết vì sao.' : ' Nếu quảng cáo đã chạy mà vẫn trống, liên hệ ANIO để kiểm tra.'}</p> : null}
          </div>
          {tbl('Theo chiến dịch', campCols, d.by_campaign, (r) => r.id)}
          {tbl('Quảng cáo xem nhiều nhất', creCols, d.by_creative.slice(0, 20), (r) => r.id)}
          {tbl('Theo địa điểm', locCols, d.by_location, (r) => r.id ?? 'none')}
          {!external && d.by_device ? tbl('Theo thiết bị', devCols, d.by_device, (r) => r.id) : null}
          <Note>{d.note}</Note>
        </>
      ) : null}
    </>
  );
}
