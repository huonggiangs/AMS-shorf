import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { campaignSchema, customerSchema, listOf, okSchema, portalWalletSchema, revenueSchema, sepaySettingsSchema, topupSchema, walletSchema, type SepaySettings, type Topup, type Wallet } from '../api/schemas';
import { useAct, useBase } from '../api/hooks';
import { useAuth } from '../auth/AuthProvider';
import { ServerTable } from '../components/ServerTable';
import type { Col } from '../components/DataTable';
import { TopupDialog, type BankInfo } from '../components/TopupDialog';
import { Btn, CopyBtn, EmptyBlock, ErrorBlock, Field, Kpi, LoadingBlock, NameCell, Note, PageHead, StatusTag, Tabs, Tag } from '../components/ui';
import { Donut, LineChart } from '../components/charts';
import { useT } from '../i18n';
import { useUi } from '../state/ui';
import { fmtDateTime, mil, vnd } from '../lib/format';
import { MIN_TOPUP_VND } from '../lib/sepay';
import { Icon } from '../components/Icon';
import { Link } from 'react-router-dom';
import FinanceOps from './FinanceOps';
import PriceBook from './PriceBook';
import History from './History';
import { HourlyRevenue, InvoicesPanel, PortalEinvoices, PortalInvoices } from './FinanceInvoices';

export default function Finance() {
  const { isExternal, can } = useAuth();
  const [tab, setTab] = useState<'ov' | 'wallet' | 'ops' | 'price'>('ov');
  if (isExternal) return <><WalletView />{can('finance', 'view') ? <><PortalInvoices /><PortalEinvoices /><History /></> : null}</>;
  return (
    <>
      <Tabs value={tab} onChange={setTab} items={[{ id: 'ov', label: 'Tổng quan' }, { id: 'wallet', label: 'Ví quảng cáo' }, { id: 'ops', label: 'Vận hành' }, { id: 'price', label: 'Bảng giá' }]} />
      {tab === 'ov' ? <FinanceOverview /> : tab === 'wallet' ? <WalletView /> : tab === 'price' ? <PriceBook /> : <FinanceOps />}
    </>
  );
}

function FinanceOverview() {
  const rev = useQuery({ queryKey: ['/admin/v1/revenue'], queryFn: () => api.get('/admin/v1/revenue', { schema: revenueSchema }) });
  const months = rev.data?.months ?? [];
  const last = months[months.length - 1];
  return (
    <>
      <PageHead title="Thanh toán & thuế" sub="Doanh thu quảng cáo, quỹ thưởng, chi trả user và hóa đơn VAT." />
      {rev.isLoading ? <LoadingBlock /> : rev.isError ? <ErrorBlock error={rev.error} onRetry={() => void rev.refetch()} /> : (
        <>
          <div className="g g4">
            <Kpi label="Doanh thu quảng cáo" icon="coin" value={last ? `₫ ${mil(last.revenue_vnd)} tr` : '—'} foot={last ? `Kỳ ${last.label}` : 'Chưa có dữ liệu'} />
            <Kpi label="Quỹ thưởng user" icon="users" value={last ? `₫ ${mil(last.reward_vnd)} tr` : '—'} foot="Tối đa 20% doanh thu gộp" />
          </div>
          {months.length ? (
            <div className="g g21">
              <div className="card cp"><div className="ch"><div><h2>Doanh thu theo tháng</h2><p>Doanh thu và quỹ thưởng · triệu ₫</p></div></div>
                <LineChart labels={months.map((m) => m.label)} series={[{ n: 'Doanh thu', c: '#005BBF', d: months.map((m) => Math.round(m.revenue_vnd / 1e6)) }, { n: 'Thưởng', c: '#D97706', d: months.map((m) => Math.round(m.reward_vnd / 1e6)) }]} fmt={(v) => `${v} tr`} />
              </div>
              {last ? <div className="card cp"><div className="ch"><h2>Phân bổ kỳ {last.label}</h2></div><Donut parts={[{ n: 'Giữ lại', v: Math.round((last.revenue_vnd - last.reward_vnd) / 1e6), c: '#005BBF' }, { n: 'Thưởng', v: Math.round(last.reward_vnd / 1e6), c: '#D97706' }]} /></div> : null}
            </div>
          ) : <EmptyBlock>Chưa có doanh thu trong 12 tháng gần đây.</EmptyBlock>}
        </>
      )}
      <HourlyRevenue />
      <InvoicesPanel />
    </>
  );
}

const sumW = (ws: Wallet[]) => ws.reduce((a, w) => ({ bal: a.bal + w.balance_vnd, res: a.res + w.reserved_vnd, spent: a.spent + w.spent_vnd }), { bal: 0, res: 0, spent: 0 });

function WalletView() {
  const t = useT();
  const { isExternal, me, can } = useAuth();
  const act = useAct();
  const { notify } = useUi();
  const base = useBase();
  const [top, setTop] = useState(false);

  const own = useQuery({ queryKey: ['/portal/v1/wallet'], enabled: isExternal, queryFn: () => api.get('/portal/v1/wallet', { schema: portalWalletSchema }) });
  const all = useQuery({ queryKey: ['/admin/v1/wallets', 'all'], enabled: !isExternal, queryFn: () => api.get('/admin/v1/wallets', { query: { page_size: 200 }, schema: listOf(walletSchema) }) });
  const sepay = useQuery({ queryKey: ['/admin/v1/settings/sepay'], enabled: !isExternal && can('finance', 'view'), queryFn: () => api.get('/admin/v1/settings/sepay', { schema: sepaySettingsSchema }) });
  const waiting = useQuery({ queryKey: [base.campaigns, 'count', 'af'], queryFn: () => api.get(base.campaigns, { query: { page_size: 1, filter: 'status:awaiting_funds' }, schema: listOf(campaignSchema) }) });
  const custs = useQuery({ queryKey: ['/admin/v1/customers', 'pick'], enabled: !isExternal, queryFn: () => api.get('/admin/v1/customers', { query: { page_size: 200 }, schema: listOf(customerSchema) }) });

  const tot = isExternal ? (own.data ? { bal: own.data.balance_vnd, res: own.data.reserved_vnd, spent: own.data.spent_vnd } : null) : all.data ? sumW(all.data.items) : null;
  const partial = !isExternal && (all.data?.total ?? 0) > (all.data?.items.length ?? 0);
  const bank: BankInfo | null = isExternal
    ? own.data?.payment ? { ...own.data.payment } : null
    : sepay.data?.bank && sepay.data.account_number ? { bank: sepay.data.bank, account_number: sepay.data.account_number, account_holder: sepay.data.account_holder ?? '', prefix: sepay.data.prefix } : null;
  const fixed = isExternal && me?.customer_scope ? { id: me.customer_scope.customer_id, code: me.customer_scope.code ?? me.customer_scope.customer_id, name: me.customer_scope.name ?? '' } : null;
  const loading = isExternal ? own.isLoading : all.isLoading;
  const error = isExternal ? own.error : all.error;

  const wCols: Col<Wallet>[] = [
    { key: 'name', label: 'Khách hàng', sortKey: 'customer_name', text: (r) => r.customer_name ?? r.customer_id, cell: (r) => <NameCell icon="user" a={r.customer_name ?? r.customer_id} b="Ví trả trước" /> },
    { key: 'bal', label: 'Số dư', sortKey: 'balance_vnd', num: true, text: (r) => r.balance_vnd, cell: (r) => vnd(r.balance_vnd) },
    { key: 'res', label: 'Đang giữ', sortKey: 'reserved_vnd', num: true, text: (r) => r.reserved_vnd, cell: (r) => vnd(r.reserved_vnd) },
    { key: 'av', label: 'Khả dụng', num: true, text: (r) => r.balance_vnd - r.reserved_vnd, cell: (r) => { const a = r.available_vnd ?? r.balance_vnd - r.reserved_vnd; return <b style={{ color: a < 10e6 ? 'var(--bad)' : 'var(--ok)' }}>{vnd(a)}</b>; } },
    { key: 'sp', label: 'Đã chi', sortKey: 'spent_vnd', num: true, text: (r) => r.spent_vnd, cell: (r) => vnd(r.spent_vnd) },
  ];
  const tCols: Col<Topup>[] = [
    { key: 'code', label: 'Mã', text: (r) => r.code ?? r.id, cell: (r) => <span className="mono">{r.code ?? r.id}</span> },
    ...(isExternal ? [] : [{ key: 'cus', label: 'Khách hàng', text: (r: Topup) => r.customer_name ?? r.customer_id ?? '' }]),
    { key: 'method', label: 'Phương thức', text: (r) => r.method ?? '' },
    { key: 'at', label: 'Thời gian', sortKey: 'created_at', text: (r) => fmtDateTime(r.created_at) },
    { key: 'amt', label: 'Số tiền', sortKey: 'amount_vnd', num: true, text: (r) => r.amount_vnd, cell: (r) => vnd(r.amount_vnd) },
    { key: 'st', label: 'Trạng thái', text: (r) => r.status, cell: (r) => <StatusTag status={r.status} /> },
    { key: 'ok', label: '', cell: (r) => r.status === 'awaiting_confirm' && !isExternal && can('finance', 'approve') ? <Btn tone="p" className="sm" onClick={() => void act(() => api.post(`/admin/v1/topups/${r.id}/confirm`), 'Đã xác nhận nhận tiền.')}>Xác nhận đã nhận tiền</Btn> : null },
  ];
  const nWait = waiting.data?.total ?? 0;
  return (
    <>
      <PageHead title={isExternal ? 'Ví quảng cáo' : 'Ví quảng cáo của khách hàng'} sub="Nạp tiền trước, gửi quảng cáo để duyệt. Khi được duyệt, hệ thống giữ ngân sách từ ví và tự chạy theo lịch." actions={<Btn tone="p" icon="plus" onClick={() => setTop(true)}>{t('Nạp tiền')}</Btn>} />
      {loading ? <LoadingBlock /> : error ? <ErrorBlock error={error} onRetry={() => void (isExternal ? own : all).refetch()} /> : (
        <div className="g g4">
          <Kpi label="Số dư khả dụng" icon="card" value={tot ? mil(tot.bal - tot.res) : '—'} unit="triệu ₫" foot={tot ? `Tổng ví ${mil(tot.bal)} triệu${partial ? ' (200 ví đầu)' : ''}` : ''} />
          <Kpi label="Đang giữ cho chiến dịch" icon="clock" value={tot ? mil(tot.res) : '—'} unit="triệu ₫" foot="Trừ dần theo lượt phát hợp lệ" />
          <Kpi label="Đã chi" icon="coin" value={tot ? mil(tot.spent) : '—'} unit="triệu ₫" foot="Tính theo impression đã đối soát" />
          <Kpi label="Chờ nạp tiền" icon="warn" value={nWait} unit="chiến dịch" foot={nWait ? 'Tự chạy ngay khi ví đủ' : 'Không có'} />
        </div>
      )}
      <div className="card cp" style={{ marginBottom: 18 }}>
        <div className="ch"><h2>Quy trình tự phục vụ</h2></div>
        <div className="step">{[['1', 'Nạp tiền', 'VietQR (SePay)'], ['2', 'Gửi quảng cáo', 'Chọn màn hình, lịch, ngân sách'], ['3', 'Duyệt nội dung', 'Nội dung và ngân sách'], ['4', 'Tự chạy', 'Giữ ngân sách từ ví, phát đúng lịch'], ['5', 'Đối soát', 'Trừ theo lượt phát, hoàn phần dư']].map((s) => <div key={s[0]}><b>{s[0]}</b><br /><b style={{ color: 'var(--ink)' }}>{s[1]}</b><br /><span style={{ color: 'var(--mut)', fontSize: 13 }}>{s[2]}</span></div>)}</div>
      </div>
      {!isExternal ? <SepayPanel s={sepay.data} loading={sepay.isLoading} error={sepay.error} canEdit={can('finance', 'write')} /> : null}
      {!isExternal ? <ServerTable id="wl" endpoint="/admin/v1/wallets" itemSchema={walletSchema} cols={wCols} title="Ví theo khách hàng" exportName="vi-khach-hang" rowKey={(r) => r.customer_id} /> : null}
      <div style={{ height: 18 }} />
      <ServerTable id="tp" endpoint={base.topups} itemSchema={topupSchema} cols={tCols} title="Lịch sử nạp tiền" exportName="nap-tien" filters={[{ key: 'status', label: 'Trạng thái', options: [{ value: 'awaiting_confirm', label: 'Chờ xác nhận' }, { value: 'confirmed', label: 'Đã ghi nhận' }] }]} />
      <Note>Nạp tối thiểu {vnd(MIN_TOPUP_VND)}, đã gồm hóa đơn VAT theo thông tin doanh nghiệp. Ngân sách chiến dịch chỉ được giữ khi quảng cáo được duyệt. Phần chưa dùng khi kết thúc hoặc hủy được hoàn về ví; rút về ngân hàng theo yêu cầu và đối soát. Cảnh báo email khi ví còn dưới 10% hoặc không đủ chạy 3 ngày.</Note>
      <TopupDialog
        open={top} onClose={() => setTop(false)} bank={bank} fixed={fixed}
        customers={(custs.data?.items ?? []).filter((c) => c.status !== 'suspended').map((c) => ({ id: c.id, code: c.code ?? c.id, name: c.short_name ?? c.legal_name }))}
        onSubmit={async (v) => { await api.post(isExternal ? '/portal/v1/topups' : '/admin/v1/topups', { body: { customer_id: v.customer_id, amount_vnd: v.amount_vnd, method: 'qr' } }); notify(`Đang chờ ngân hàng báo có ${vnd(v.amount_vnd)}. Ví sẽ tự cộng.`); }}
        onSimulate={!isExternal && sepay.data?.dev_mode ? async (v) => { await api.post('/dev/sepay/simulate', { body: { transferType: 'in', transferAmount: v.amount_vnd, content: `${v.content} chuyen tien` } }); notify('Đã mô phỏng giao dịch đến.'); } : null}
      />
    </>
  );
}

function SepayPanel({ s, loading, error, canEdit }: { s?: SepaySettings; loading: boolean; error: unknown; canEdit: boolean }) {
  const act = useAct();
  const [test, setTest] = useState('');
  if (loading) return <LoadingBlock />;
  if (error || !s) return <ErrorBlock error={error ?? new Error('Không tải được cấu hình SePay.')} />;
  return (
    <>
      <div className="card cp" style={{ marginBottom: 18 }}>
        <div className="ch">
          <div><h2>Tích hợp SePay: nhận tiền và tự kích hoạt</h2><p>SePay báo giao dịch ngân hàng qua webhook. Hệ thống đối chiếu mã trong nội dung chuyển khoản, cộng ví, tự chạy quảng cáo chờ nạp tiền và kích hoạt khách hàng mới.</p></div>
          <Tag tone={s.enabled ? 'ok' : 'mut'}>{s.enabled ? 'Đang bật' : 'Tắt'}{s.env ? ` · ${s.env}` : ''}</Tag>
        </div>
        <dl className="kv" style={{ margin: 0 }}>
          <dt>URL webhook</dt><dd className="mono" style={{ overflowWrap: 'anywhere' }}>{s.webhook_url} <CopyBtn text={s.webhook_url} label="Sao chép URL" /></dd>
          <dt>Xác thực</dt><dd>{s.auth_mode ?? 'HMAC-SHA256'} (header X-SePay-Signature, X-SePay-Timestamp){s.has_secret === false ? ' · chưa đặt khóa bí mật phía máy chủ' : ''}</dd>
          <dt>Tài khoản nhận</dt><dd>{s.bank ?? '—'} · <span className="mono">{s.account_number ?? '—'}</span> · {s.account_holder ?? '—'}</dd>
          <dt>Cú pháp</dt><dd className="mono">{s.prefix} &lt;mã khách hàng&gt;, ví dụ {s.prefix} K004</dd>
          <dt>Phản hồi</dt><dd>HTTP 200/201 + {'{"success": true}'}</dd>
          <dt>Tự kích hoạt</dt><dd>{s.auto_activate ? 'Bật' : 'Tắt'}{s.min_activate_vnd ? ` · từ ${vnd(s.min_activate_vnd)}` : ''}</dd>
        </dl>
        <div className="note" style={{ margin: '14px 0 0', flexWrap: 'wrap' }}>
          <Icon n="info" />
          <span><b>3 bước cài đặt:</b> 1) Cấu hình khóa, ngân hàng và số tài khoản ở Tích hợp API &gt; Kết nối SePay. 2) Vào my.sepay.vn &gt; Webhooks &gt; Thêm webhook: dán URL ở trên, sự kiện &quot;Có tiền vào&quot;, xác thực HMAC-SHA256, bật &quot;Tự động gửi lại khi server trả lỗi&quot;. 3) Bấm Gửi thử.</span>
        </div>
        {test ? <p role="status" style={{ margin: '10px 0 0' }}>{test}</p> : null}
        {canEdit ? (
          <div className="acts" style={{ marginTop: 14 }}>
            <Link className="btn p" to="/integrations">Cấu hình ở Tích hợp API</Link>
            <Btn onClick={async () => { const r = await act(() => api.post('/admin/v1/settings/sepay/test', { schema: okSchema }), undefined, []); setTest(r ? ((r as { message?: string }).message ?? 'Đã gửi thử. Kiểm tra nhật ký webhook.') : 'Gửi thử thất bại, xem thông báo lỗi.'); }}>Gửi thử</Btn>
          </div>
        ) : null}
      </div>
      {s.dev_mode ? <SimulateTable s={s} /> : null}
    </>
  );
}

/** Webhook log / simulated transactions. Visible only when the API reports dev mode. */
function SimulateTable({ s }: { s: SepaySettings }) {
  const act = useAct();
  const [amount, setAmount] = useState(String(MIN_TOPUP_VND));
  const [content, setContent] = useState(`${s.prefix} K004`);
  const [lastId, setLastId] = useState<number | null>(null);
  const sim = (id?: number) => act(() => api.post('/dev/sepay/simulate', { body: { id, transferType: 'in', transferAmount: +amount, content: `${content} chuyen tien` }, schema: okSchema }), 'Đã gửi giao dịch mô phỏng.', ['/admin/v1']);
  return (
    <div className="card cp" style={{ marginBottom: 18 }} data-testid="sepay-sim">
      <div className="ch"><div><h2>Mô phỏng giao dịch (chế độ phát triển)</h2><p>Chỉ hiện khi máy chủ báo dev mode. Không dùng trên môi trường thật.</p></div><Tag tone="warn">DEV</Tag></div>
      <div className="g g3" style={{ margin: 0 }}>
        <Field label="Nội dung chuyển khoản"><input value={content} onChange={(e) => setContent(e.target.value)} /></Field>
        <Field label="Số tiền (₫)"><input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      </div>
      <div className="acts" style={{ marginTop: 12 }}>
        <Btn tone="p" onClick={async () => { const id = Date.now() % 1_000_000_000; setLastId(id); await sim(id); }}>Mô phỏng giao dịch đến</Btn>
        <Btn disabled={lastId == null} onClick={() => void sim(lastId ?? undefined)}>Gửi trùng giao dịch gần nhất</Btn>
      </div>
      {s.recent?.length ? (
        <div className="tw" style={{ marginTop: 14 }}><table aria-label="Nhật ký webhook SePay"><thead><tr><th>ID SePay</th><th>Thời gian</th><th>Nội dung</th><th>Khách hàng</th><th className="n">Số tiền</th><th>Kết quả</th></tr></thead>
          <tbody>{s.recent.map((r) => <tr key={r.id}><td className="mono">{r.id}</td><td>{fmtDateTime(r.at)}</td><td className="mono" style={{ fontSize: 12.5 }}>{r.content}</td><td>{r.customer ?? '—'}</td><td className="n">{vnd(r.amount_vnd)}</td><td>{r.result}</td></tr>)}</tbody></table></div>
      ) : <p className="sub" style={{ marginTop: 12 }}>Chưa có giao dịch nào trong nhật ký webhook.</p>}
    </div>
  );
}

