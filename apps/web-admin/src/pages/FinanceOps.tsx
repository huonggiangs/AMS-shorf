import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { activationLogSchema, customerSchema, listOf, manualQueueSchema, refundRequestsSchema, type ManualItem, type RefundRequest } from '../api/schemas';
import { useAct } from '../api/hooks';
import { useAuth } from '../auth/AuthProvider';
import { Btn, EmptyBlock, ErrorBlock, LoadingBlock, PageHead, StatusTag, Tabs } from '../components/ui';
import { Dialog } from '../components/Dialog';
import { PromptDialog } from '../components/Prompt';
import { fmtDateTime, vnd } from '../lib/format';

type Sub = 'manual' | 'refund' | 'activation';
const KEY = '/admin/v1/payments';

/** Vận hành tài chính (a2): hàng đợi giao dịch thủ công, yêu cầu hoàn tiền, nhật ký kích hoạt. Hành động chính trên từng dòng. */
export default function FinanceOps() {
  const [sub, setSub] = useState<Sub>('manual');
  return (
    <>
      <PageHead title="Vận hành tài chính" sub="Giao dịch chờ xử lý tay, yêu cầu hoàn tiền và nhật ký tự động kích hoạt." />
      <Tabs value={sub} onChange={setSub} items={[{ id: 'manual', label: 'Hàng đợi thủ công' }, { id: 'refund', label: 'Hoàn tiền' }, { id: 'activation', label: 'Nhật ký kích hoạt' }]} />
      {sub === 'manual' ? <ManualQueue /> : sub === 'refund' ? <Refunds /> : <ActivationLog />}
    </>
  );
}

function ManualQueue() {
  const { can } = useAuth();
  const act = useAct();
  const q = useQuery({ queryKey: [KEY, 'manual-queue'], queryFn: () => api.get('/admin/v1/payments/manual-queue', { schema: manualQueueSchema }) });
  const [pick, setPick] = useState<ManualItem | null>(null);
  const canAct = can('finance', 'approve');
  return (
    <>
      {q.isLoading ? <LoadingBlock /> : q.isError ? <ErrorBlock error={q.error} onRetry={() => void q.refetch()} /> : !q.data?.items.length ? <EmptyBlock /> : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ width: '100%' }}>
            <thead><tr><th>Nhận lúc</th><th>Số tiền</th><th>Nội dung chuyển khoản</th><th>Lý do chưa khớp</th><th /></tr></thead>
            <tbody>
              {q.data.items.map((r) => (
                <tr key={r.id}>
                  <td>{fmtDateTime(r.received_at)}</td>
                  <td>{vnd(r.amount_vnd)}</td>
                  <td>{r.content ?? ''}</td>
                  <td>{r.reason}</td>
                  <td>{canAct ? <Btn tone="p" className="sm" onClick={() => setPick(r)}>{r.topup_id ? 'Xác nhận nạp' : 'Gán khách hàng'}</Btn> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ResolveDialog item={pick} onClose={() => setPick(null)} onDone={(item, customerId) => act(() => api.post(`/admin/v1/payments/manual-queue/${item.id}/resolve`, { body: customerId ? { customer_id: customerId } : {} }), 'Đã xử lý giao dịch.', ['/admin/v1', '/portal/v1'])} />
    </>
  );
}

function ResolveDialog({ item, onClose, onDone }: { item: ManualItem | null; onClose: () => void; onDone: (i: ManualItem, customerId: string) => Promise<unknown> }) {
  const [cid, setCid] = useState('');
  const custs = useQuery({ queryKey: ['/admin/v1/customers', 'pick'], enabled: !!item && !item.topup_id, queryFn: () => api.get('/admin/v1/customers', { query: { page_size: 200 }, schema: listOf(customerSchema) }) });
  if (!item) return null;
  const needCustomer = !item.topup_id;
  return (
    <Dialog open onClose={onClose} label="Xử lý giao dịch">
      <form onSubmit={(e) => { e.preventDefault(); void onDone(item, cid).then(onClose); }}>
        <h2 style={{ margin: '0 0 10px', fontSize: 18 }}>Xử lý giao dịch {vnd(item.amount_vnd)}</h2>
        <p style={{ color: 'var(--mut)', fontSize: 13 }}>{item.content}</p>
        {needCustomer ? (
          <div className="fd"><label htmlFor="mq-c">Cộng vào ví của khách hàng</label>
            <select id="mq-c" value={cid} required onChange={(e) => setCid(e.target.value)}>
              <option value="">— Chọn khách hàng —</option>
              {(custs.data?.items ?? []).map((c) => <option key={c.id} value={c.id}>{c.short_name || c.legal_name}</option>)}
            </select>
          </div>
        ) : <p>Giao dịch đã gắn với một lệnh nạp; xác nhận để cộng tiền vào ví.</p>}
        <div className="da" style={{ marginTop: 14 }}>
          <button type="button" className="btn" onClick={onClose}>Hủy</button>
          <button type="submit" className="btn p">Xác nhận</button>
        </div>
      </form>
    </Dialog>
  );
}

function Refunds() {
  const { can } = useAuth();
  const act = useAct();
  const q = useQuery({ queryKey: [KEY, 'refunds'], queryFn: () => api.get('/admin/v1/refund-requests', { schema: refundRequestsSchema }) });
  const [rej, setRej] = useState<RefundRequest | null>(null);
  const [paid, setPaid] = useState<RefundRequest | null>(null);
  const canAct = can('finance', 'approve');
  const post = (id: string, a: string, body?: unknown, ok?: string) => act(() => api.post(`/admin/v1/refund-requests/${id}/${a}`, { body: body ?? {} }), ok, ['/admin/v1', '/portal/v1']);
  return (
    <>
      {q.isLoading ? <LoadingBlock /> : q.isError ? <ErrorBlock error={q.error} onRetry={() => void q.refetch()} /> : !q.data?.items.length ? <EmptyBlock /> : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ width: '100%' }}>
            <thead><tr><th>Khách hàng</th><th>Số tiền</th><th>Lý do</th><th>Trạng thái</th><th>Gửi lúc</th><th /></tr></thead>
            <tbody>
              {q.data.items.map((r) => (
                <tr key={r.id}>
                  <td>{r.customer_name ?? r.customer_id}</td>
                  <td>{vnd(r.amount_vnd)}</td>
                  <td>{r.reason ?? ''}</td>
                  <td><StatusTag status={r.status} /></td>
                  <td>{fmtDateTime(r.created_at)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {canAct && r.status === 'pending' ? <><Btn tone="p" className="sm" onClick={() => void post(r.id, 'approve', {}, 'Đã duyệt hoàn tiền.')}>Duyệt</Btn> <Btn className="sm" onClick={() => setRej(r)}>Từ chối</Btn></> : null}
                    {canAct && r.status === 'approved' ? <Btn tone="p" className="sm" onClick={() => setPaid(r)}>Đã chi</Btn> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <PromptDialog open={!!rej} title="Từ chối hoàn tiền" label="Lý do (tối thiểu 3 ký tự, khách hàng nhìn thấy)" onClose={() => setRej(null)} onSubmit={async (note) => { if (rej) await post(rej.id, 'reject', { note }, 'Đã từ chối yêu cầu.'); }} />
      <PromptDialog open={!!paid} title="Đánh dấu đã chi" label="Số chứng từ chuyển tiền (bắt buộc)" onClose={() => setPaid(null)} onSubmit={async (voucher_ref) => { if (paid) await post(paid.id, 'paid', { voucher_ref }, 'Đã ghi nhận chi hoàn tiền.'); }} />
    </>
  );
}

function ActivationLog() {
  const { can } = useAuth();
  const act = useAct();
  const q = useQuery({ queryKey: [KEY, 'activation-log'], queryFn: () => api.get('/admin/v1/activation-log', { schema: activationLogSchema }) });
  const canAct = can('finance', 'approve');
  return q.isLoading ? <LoadingBlock /> : q.isError ? <ErrorBlock error={q.error} onRetry={() => void q.refetch()} /> : !q.data?.items.length ? <EmptyBlock /> : (
    <div className="card" style={{ overflowX: 'auto' }}>
      <table className="tbl" style={{ width: '100%' }}>
        <thead><tr><th>Thời điểm</th><th>Khách hàng</th><th>Số hành động</th><th /></tr></thead>
        <tbody>
          {q.data.items.map((r) => (
            <tr key={r.id}>
              <td>{fmtDateTime(r.created_at)}</td>
              <td>{r.customer_id ?? ''}</td>
              <td>{r.actions.length}</td>
              <td>{canAct ? <Btn className="sm" onClick={() => { if (window.confirm('Hoàn tác các hành động kích hoạt này?')) void act(() => api.post(`/admin/v1/activation-log/${r.id}/undo`, { body: {} }), 'Đã hoàn tác kích hoạt.', ['/admin/v1', '/portal/v1']); }}>Hoàn tác</Btn> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
