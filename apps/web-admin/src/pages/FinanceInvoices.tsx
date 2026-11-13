import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '../api/client';
import { customerSchema, listOf } from '../api/schemas';
import { useAct } from '../api/hooks';
import { useAuth } from '../auth/AuthProvider';
import { ServerTable } from '../components/ServerTable';
import type { Col } from '../components/DataTable';
import { Dialog } from '../components/Dialog';
import { PromptDialog } from '../components/Prompt';
import { Btn, EmptyBlock, ErrorBlock, Field, Kpi, LoadingBlock, Note, Tag } from '../components/ui';
import { LineChart } from '../components/charts';
import { fmtDateTime, vnd } from '../lib/format';

const invSchema = z
  .object({
    id: z.string(),
    customer: z.string().optional(),
    period: z.string(),
    amount_vnd: z.number(),
    vat_rate: z.number(),
    vat_vnd: z.number(),
    total_vnd: z.number(),
    status: z.string(),
    einvoice_ref: z.string().nullable().optional(),
    due_date: z.string().nullable().optional(),
    paid_vnd: z.number().nullable().optional(),
  })
  .passthrough();
type Inv = z.infer<typeof invSchema>;

const payoutSchema = z.object({ id: z.string(), user: z.string().nullable().optional(), amount_vnd: z.number(), channel: z.string().nullable().optional(), status: z.string(), external_ref: z.string().nullable().optional(), requested_at: z.string(), paid_at: z.string().nullable().optional(), user_balance_vnd: z.number() }).passthrough();
export type Payout = z.infer<typeof payoutSchema>;

const hourlySchema = z.object({
  date: z.string(),
  hours: z.array(z.object({ hour: z.number(), impressions: z.number(), valid: z.number(), revenue_vnd: z.number(), reward_vnd: z.number() })),
  total: z.object({ impressions: z.number(), valid: z.number(), revenue_vnd: z.number(), reward_vnd: z.number() }),
  freshness_at: z.string().nullable(),
  generated_at: z.string(),
  stale: z.boolean(),
});

const STATUS: Record<string, [string, 'ok' | 'warn' | 'info' | 'bad']> = {
  draft: ['Nháp', 'info'], issued: ['Đã phát hành', 'warn'], paid: ['Đã thanh toán', 'ok'], void: ['Đã hủy', 'bad'],
  pending: ['Chờ chi', 'warn'], rejected: ['Từ chối', 'bad'],
};
const St = ({ s }: { s: string }) => <Tag tone={STATUS[s]?.[1] ?? 'info'}>{STATUS[s]?.[0] ?? s}</Tag>;

const todayVn = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

/** Doanh thu theo giờ (gio Viet Nam) từ bảng gộp impression_hourly, kèm thời điểm dữ liệu mới nhất. */
export function HourlyRevenue() {
  const [date, setDate] = useState(todayVn());
  const q = useQuery({ queryKey: ['/admin/v1/revenue/hourly', date], queryFn: () => api.get('/admin/v1/revenue/hourly', { query: { date }, schema: hourlySchema }) });
  return (
    <div className="card cp">
      <div className="ch" style={{ gap: 12, flexWrap: 'wrap' }}>
        <div><h2>Doanh thu theo giờ</h2><p>Giờ Việt Nam · đồng</p></div>
        <Field label="Ngày"><input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></Field>
      </div>
      {q.isLoading ? <LoadingBlock /> : q.isError ? <ErrorBlock error={q.error} onRetry={() => void q.refetch()} /> : q.data ? (
        <>
          <Note warn={q.data.stale}>
            {q.data.freshness_at ? `Dữ liệu cập nhật đến ${fmtDateTime(q.data.freshness_at)}.` : 'Chưa nhận được lượt xem nào.'}
            {q.data.stale ? ' Dữ liệu có thể chưa đầy đủ cho những giờ gần nhất.' : ''}
          </Note>
          <div className="g g4">
            <Kpi label="Lượt phát" icon="play" value={q.data.total.impressions.toLocaleString('vi-VN')} foot={`${q.data.total.valid.toLocaleString('vi-VN')} hợp lệ`} />
            <Kpi label="Doanh thu" icon="coin" value={vnd(q.data.total.revenue_vnd)} />
            <Kpi label="Chi phí thưởng" icon="users" value={vnd(q.data.total.reward_vnd)} />
          </div>
          {q.data.total.impressions === 0 ? <EmptyBlock>Không có dữ liệu trong ngày này.</EmptyBlock> : (
            <LineChart labels={q.data.hours.map((h) => `${h.hour}h`)} series={[{ n: 'Doanh thu', c: '#005BBF', d: q.data.hours.map((h) => h.revenue_vnd) }]} fmt={(v) => vnd(v)} />
          )}
        </>
      ) : null}
    </div>
  );
}

function NewInvoice({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const act = useAct();
  const [cid, setCid] = useState('');
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [amount, setAmount] = useState('');
  const [rate, setRate] = useState('10');
  const custs = useQuery({ queryKey: ['/admin/v1/customers', 'pick'], enabled: open, queryFn: () => api.get('/admin/v1/customers', { query: { page_size: 200 }, schema: listOf(customerSchema) }) });
  const amt = Number(amount);
  const ok = !!cid && /^\d{4}-(0[1-9]|1[0-2])$/.test(period) && Number.isInteger(amt) && amt > 0;
  return (
    <Dialog open={open} onClose={onClose} label="Tạo hóa đơn VAT" width="min(440px, 94vw)">
      <h2>Tạo hóa đơn VAT (bản nháp)</h2>
      <Field label="Khách hàng">
        <select value={cid} onChange={(e) => setCid(e.target.value)}>
          <option value="">— Chọn —</option>
          {(custs.data?.items ?? []).map((c) => <option key={c.id} value={c.id}>{c.short_name}</option>)}
        </select>
      </Field>
      <Field label="Kỳ (YYYY-MM)"><input value={period} onChange={(e) => setPeriod(e.target.value)} /></Field>
      <Field label="Giá trị trước thuế (₫)"><input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      <Field label="Thuế suất VAT"><select value={rate} onChange={(e) => setRate(e.target.value)}>{[0, 5, 8, 10].map((r) => <option key={r} value={r}>{r}%</option>)}</select></Field>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
        <Btn onClick={onClose}>Hủy</Btn>
        <Btn tone="p" disabled={!ok} onClick={async () => { const r = await act(() => api.post('/admin/v1/invoices', { body: { customer_id: cid, period, amount_vnd: amt, vat_rate: Number(rate) } }), 'Đã tạo hóa đơn nháp.'); if (r) { onDone(); onClose(); } }}>Tạo hóa đơn</Btn>
      </div>
    </Dialog>
  );
}

/** Hóa đơn VAT và chi trả thưởng người xem (nội bộ). Chuyển trạng thái do máy chủ kiểm soát; nút chỉ hiện khi có quyền. */
export function InvoicesPanel({ only }: { only?: 'pay' } = {}) {
  const { can } = useAuth();
  const act = useAct();
  const [tab, setTab] = useState<'inv' | 'pay'>(only ?? 'inv');
  const [adding, setAdding] = useState(false);
  const [voiding, setVoiding] = useState<Inv | null>(null);
  const [issuing, setIssuing] = useState<Inv | null>(null);
  const [paying, setPaying] = useState<Payout | null>(null);
  const [rejecting, setRejecting] = useState<Payout | null>(null);
  const [nonce, setNonce] = useState(0);
  const write = can('finance', 'write');
  const approve = can('finance', 'approve');
  const post = (path: string, body: unknown, ok: string) => act(() => api.post(path, { body }), ok);

  const invCols: Col<Inv>[] = [
    { key: 'customer', label: 'Khách hàng', sortKey: 'customer', text: (r) => r.customer ?? '' },
    { key: 'period', label: 'Kỳ', sortKey: 'period' },
    { key: 'amount_vnd', label: 'Trước thuế', sortKey: 'amount_vnd', num: true, cell: (r) => vnd(r.amount_vnd), text: (r) => r.amount_vnd },
    { key: 'vat_vnd', label: 'VAT', num: true, cell: (r) => `${vnd(r.vat_vnd)} (${r.vat_rate}%)`, text: (r) => r.vat_vnd },
    { key: 'total_vnd', label: 'Tổng', num: true, cell: (r) => vnd(r.total_vnd), text: (r) => r.total_vnd },
    { key: 'status', label: 'Trạng thái', sortKey: 'status', cell: (r) => <St s={r.status} />, text: (r) => STATUS[r.status]?.[0] ?? r.status },
    { key: 'einvoice_ref', label: 'Số HĐĐT', text: (r) => r.einvoice_ref ?? '' },
    {
      key: 'act', label: '',
      cell: (r) => (
        <span style={{ display: 'inline-flex', gap: 6 }}>
          {approve && r.status === 'draft' ? <Btn tone="p" className="sm" onClick={() => setIssuing(r)}>Phát hành</Btn> : null}
          {approve && r.status === 'issued' ? <Btn tone="p" className="sm" onClick={async () => { await post(`/admin/v1/invoices/${r.id}/pay`, {}, 'Đã ghi nhận thanh toán.'); setNonce((n) => n + 1); }}>Đã thu</Btn> : null}
          {approve && (r.status === 'draft' || r.status === 'issued') ? <Btn tone="d" className="sm" onClick={() => setVoiding(r)}>Hủy</Btn> : null}
        </span>
      ),
    },
  ];
  const payCols: Col<Payout>[] = [
    { key: 'requested_at', label: 'Yêu cầu lúc', sortKey: 'requested_at', cell: (r) => fmtDateTime(r.requested_at), text: (r) => r.requested_at },
    { key: 'user', label: 'Người dùng', text: (r) => r.user ?? '' },
    { key: 'amount_vnd', label: 'Số tiền', sortKey: 'amount_vnd', num: true, cell: (r) => vnd(r.amount_vnd), text: (r) => r.amount_vnd },
    { key: 'channel', label: 'Kênh', text: (r) => r.channel ?? '' },
    { key: 'user_balance_vnd', label: 'Số dư ví thưởng', num: true, cell: (r) => vnd(r.user_balance_vnd), text: (r) => r.user_balance_vnd },
    { key: 'status', label: 'Trạng thái', sortKey: 'status', cell: (r) => <St s={r.status} />, text: (r) => STATUS[r.status]?.[0] ?? r.status },
    {
      key: 'act', label: '',
      cell: (r) => approve && r.status === 'pending' ? (
        <span style={{ display: 'inline-flex', gap: 6 }}>
          <Btn tone="p" className="sm" onClick={() => setPaying(r)}>Chi trả</Btn>
          <Btn tone="d" className="sm" onClick={() => setRejecting(r)}>Từ chối</Btn>
        </span>
      ) : null,
    },
  ];

  return (
    <>
      {only ? null : <div className="tabs" role="group" style={{ marginTop: 12 }}>
        <button type="button" className={tab === 'inv' ? 'on' : ''} aria-pressed={tab === 'inv'} onClick={() => setTab('inv')}>Hóa đơn VAT</button>
        <button type="button" className={tab === 'pay' ? 'on' : ''} aria-pressed={tab === 'pay'} onClick={() => setTab('pay')}>Chi trả thưởng</button>
      </div>}
      {tab === 'inv' ? (
        <ServerTable
          key={`inv${nonce}`}
          id="invoices"
          endpoint="/admin/v1/invoices"
          itemSchema={invSchema}
          cols={invCols}
          title="Hóa đơn VAT"
          sub={write ? <Btn tone="p" icon="plus" onClick={() => setAdding(true)}>Tạo hóa đơn</Btn> : undefined}
          filters={[{ key: 'status', label: 'Trạng thái', options: Object.entries(STATUS).filter(([k]) => ['draft', 'issued', 'paid', 'void'].includes(k)).map(([value, [label]]) => ({ value, label })) }]}
          exportName="hoa-don-vat"
          emptyText="Chưa có hóa đơn."
        />
      ) : (
        <ServerTable
          key={`pay${nonce}`}
          id="payouts"
          endpoint="/admin/v1/payouts"
          itemSchema={payoutSchema}
          cols={payCols}
          title="Chi trả thưởng người xem"
          filters={[{ key: 'status', label: 'Trạng thái', options: [{ value: 'pending', label: 'Chờ chi' }, { value: 'paid', label: 'Đã thanh toán' }, { value: 'rejected', label: 'Từ chối' }] }]}
          exportName="chi-tra-thuong"
          emptyText="Chưa có lệnh chi trả."
        />
      )}
      <NewInvoice open={adding} onClose={() => setAdding(false)} onDone={() => setNonce((n) => n + 1)} />
      <PromptDialog open={!!issuing} title="Phát hành hóa đơn" label="Số hóa đơn điện tử (tùy chọn)" required={false} onClose={() => setIssuing(null)} onSubmit={async (v) => { if (issuing) { await post(`/admin/v1/invoices/${issuing.id}/issue`, v.trim() ? { einvoice_ref: v.trim() } : {}, 'Đã phát hành hóa đơn, công nợ đã được ghi.'); setNonce((n) => n + 1); } setIssuing(null); }} />
      <PromptDialog open={!!voiding} title="Hủy hóa đơn" label="Lý do hủy" onClose={() => setVoiding(null)} onSubmit={async (v) => { if (voiding) { await post(`/admin/v1/invoices/${voiding.id}/void`, { reason: v }, 'Đã hủy hóa đơn.'); setNonce((n) => n + 1); } setVoiding(null); }} />
      <PromptDialog open={!!paying} title="Chi trả thưởng" label="Mã giao dịch ngân hàng/ví" onClose={() => setPaying(null)} onSubmit={async (v) => { if (paying) { await post(`/admin/v1/payouts/${paying.id}/pay`, { external_ref: v }, 'Đã chi trả và trừ ví thưởng.'); setNonce((n) => n + 1); } setPaying(null); }} />
      <PromptDialog open={!!rejecting} title="Từ chối chi trả" label="Lý do từ chối" onClose={() => setRejecting(null)} onSubmit={async (v) => { if (rejecting) { await post(`/admin/v1/payouts/${rejecting.id}/reject`, { reason: v }, 'Đã từ chối lệnh chi trả.'); setNonce((n) => n + 1); } setRejecting(null); }} />
    </>
  );
}

const portalInvSchema = invSchema;
/** Khách hàng: hóa đơn VAT của chính mình (đã phát hành/đã thanh toán). */
export function PortalInvoices() {
  const cols: Col<Inv>[] = [
    { key: 'period', label: 'Kỳ', sortKey: 'period' },
    { key: 'total_vnd', label: 'Tổng (gồm VAT)', num: true, cell: (r) => vnd(r.total_vnd), text: (r) => r.total_vnd },
    { key: 'status', label: 'Trạng thái', cell: (r) => <St s={r.status} />, text: (r) => STATUS[r.status]?.[0] ?? r.status },
    { key: 'einvoice_ref', label: 'Số HĐĐT', text: (r) => r.einvoice_ref ?? '' },
    { key: 'due_date', label: 'Hạn thanh toán', text: (r) => r.due_date ?? '' },
  ];
  return <ServerTable id="portal-invoices" endpoint="/portal/v1/invoices" itemSchema={portalInvSchema} cols={cols} title="Hóa đơn VAT" pageSize={8} emptyText="Chưa có hóa đơn." />;
}
