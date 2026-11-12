import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { overviewSchema, type Campaign } from '../api/schemas';
import { Donut, GroupBars, Heat, PaceBar, SERIES_COLORS } from '../components/charts';
import { DataTable, initialTableState } from '../components/DataTable';
import { ErrorBlock, Kpi, LoadingBlock, NameCell, Note, PageHead, StatusTag, EmptyBlock } from '../components/ui';
import { Icon } from '../components/Icon';
import { useLang, useT } from '../i18n';
import { mil, num, vnd } from '../lib/format';

const kn = (k: Record<string, number | string>, key: string): number | undefined => (typeof k[key] === 'number' ? (k[key] as number) : undefined);

export default function Overview() {
  const t = useT();
  const lang = useLang();
  const [range, setRange] = useState(30);
  const q = useQuery({ queryKey: ['/admin/v1/dashboard/overview', range], queryFn: () => api.get('/admin/v1/dashboard/overview', { query: { range }, schema: overviewSchema }) });
  const d = q.data;
  const k = d?.kpi ?? {};
  const cols = [
    { key: 'n', label: 'Chiến dịch', text: (r: Campaign) => r.name, cell: (r: Campaign) => <NameCell icon="ads" a={r.name} b={`${r.id} · ${r.brand ?? ''}`} /> },
    { key: 's', label: 'Nguồn API', text: (r: Campaign) => r.source ?? '' },
    { key: 'i', label: 'Lượt hiển thị', num: true, text: (r: Campaign) => r.impressions, cell: (r: Campaign) => num(r.impressions) },
    { key: 'p', label: 'Pacing', text: (r: Campaign) => r.pacing_pct ?? '', cell: (r: Campaign) => <div style={{ minWidth: 110 }}><b className="mono" style={{ fontSize: 12.5 }}>{r.pacing_pct ?? 0}%</b><PaceBar pct={r.pacing_pct ?? 0} /></div> },
    { key: 'b', label: 'Ngân sách', num: true, text: (r: Campaign) => r.budget_vnd, cell: (r: Campaign) => vnd(r.budget_vnd) },
    { key: 'st', label: 'Trạng thái', text: (r: Campaign) => r.status, cell: (r: Campaign) => <StatusTag status={r.status} /> },
  ];
  return (
    <>
      <PageHead eyebrow={lang === 'en' ? 'Live broadcast control' : 'Hệ thống điều phối trực tiếp'} title="Tổng quan mạng lưới" sub="Doanh thu mạng lưới ads và tình trạng thiết bị toàn quốc."
        actions={<><select className="sel" value={range} onChange={(e) => setRange(+e.target.value)} aria-label="range">{[7, 30, 90].map((r) => <option key={r} value={r}>{r} ngày gần nhất</option>)}</select><button type="button" className="btn" onClick={() => window.print()}><Icon n="dl" />{t('Xuất PDF')}</button></>} />
      {q.isLoading ? <LoadingBlock /> : q.isError ? <ErrorBlock error={q.error} onRetry={() => void q.refetch()} /> : d ? (
        <>
          <div className="g g4">
            <Kpi label="Tổng thiết bị TV hoạt động" icon="tv" value={kn(k, 'active_tvs') != null ? num(kn(k, 'active_tvs')) : '—'} foot={kn(k, 'total_tvs') != null ? `/ ${num(kn(k, 'total_tvs'))} TV` : ''} />
            <Kpi label="Tổng lượt phát (impressions)" icon="eye" value={kn(k, 'impressions') != null ? num(kn(k, 'impressions')) : '—'} />
            <Kpi label="Doanh thu ad networks" icon="coin" value={kn(k, 'revenue_vnd') != null ? mil(kn(k, 'revenue_vnd')!, 2) : '—'} unit="triệu ₫" />
            <Kpi label="Chi phí trả thưởng người xem" icon="users" value={kn(k, 'reward_cost_vnd') != null ? mil(kn(k, 'reward_cost_vnd')!, 2) : '—'} unit="triệu ₫" />
          </div>
          <div className="g g21">
            <div className="card cp">
              <div className="ch"><div><h2>Xu hướng phát sóng & doanh thu</h2><p>Lượt hoàn thành quảng cáo và doanh thu theo ngày</p></div>
                <div className="lg" style={{ margin: 0 }}><span><i style={{ background: '#0284C7' }} />Doanh thu (triệu ₫)</span><span><i style={{ background: '#CBD5E1' }} />Lượt xem (k)</span></div></div>
              {d.trend.length ? <GroupBars data={d.trend.map((x) => ({ label: x.label, a: x.views / 1000, b: x.revenue_vnd / 1e6, tip: `${x.label}: ${Math.round(x.views / 1000)}k lượt · ${mil(x.revenue_vnd)} tr ₫` }))} /> : <EmptyBlock />}
            </div>
            <div className="card cp">
              <div className="ch"><div><h2>Cơ cấu doanh thu API</h2><p>Phân bổ theo nhà mạng programmatic</p></div></div>
              {d.revenue_split.length ? <Donut parts={d.revenue_split.map((s, i) => ({ n: s.name, v: s.value, c: SERIES_COLORS[i % SERIES_COLORS.length]! }))} /> : <EmptyBlock />}
            </div>
          </div>
          <div className="g g21">
            <div className="card cp">
              <div className="ch"><div><h2>Bản đồ nhiệt khung giờ phát sóng</h2><p>Tỷ lệ chiếm dụng khe quảng cáo (slot fill rate)</p></div></div>
              {d.slot_fill.length ? <Heat rows={d.slot_fill} cols={['06h', '08h', '10h', '12h', '14h', '16h', '18h', '20h', '22h'].slice(0, d.slot_fill[0]?.values.length ?? 9)} /> : <EmptyBlock />}
            </div>
            <div className="card cp">
              <div className="ch"><h2>Cảnh báo & giám sát TV</h2></div>
              {d.alerts.length ? d.alerts.map((a, i) => (
                <div className="alert" key={i}><span className="ico" style={{ color: a.level === 'bad' ? 'var(--bad)' : a.level === 'ok' ? 'var(--ok)' : 'var(--warn)' }}><Icon n={a.level === 'ok' ? 'check' : 'warn'} /></span><div><b>{a.title}</b>{a.text ? <p>{a.text}</p> : null}</div></div>
              )) : <EmptyBlock>Không có cảnh báo.</EmptyBlock>}
            </div>
          </div>
          <DataTable<Campaign> title="Top chiến dịch quảng cáo đang hoạt động" sub="Hiệu suất thời gian thực của các hợp đồng trọng điểm" cols={cols} rows={d.top_campaigns} total={d.top_campaigns.length} pageSize={Math.max(5, d.top_campaigns.length)} rowKey={(r) => r.id} state={initialTableState} onState={() => undefined} />
        </>
      ) : null}
      <Note>Số liệu lấy từ API tổng quan; ô trống nghĩa là máy chủ chưa trả dữ liệu cho chỉ số đó.</Note>
    </>
  );
}
