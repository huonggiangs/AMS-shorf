import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, errMsg } from '../api/client';
import { useAct } from '../api/hooks';
import { useAuth } from '../auth/AuthProvider';
import { ServerTable } from '../components/ServerTable';
import type { Col } from '../components/DataTable';
import { Btn, ErrorBlock, Field, Kpi, LoadingBlock, Note, PageHead, Tabs, Tag } from '../components/ui';
import { Dialog } from '../components/Dialog';
import { PromptDialog } from '../components/Prompt';
import { fmtDate, fmtDateTime, vnd } from '../lib/format';
import { anyRow, DUNNING_KIND, EINVOICE_KIND, EINVOICE_STATUS, n, PROVIDER_LABEL, RECV_STATE, s, type Row } from '../lib/p4';

type Tab = 'recv' | 'dun' | 'einv';

/** Công nợ, nhắc nợ và hóa đơn điện tử (finance). Cài đặt ghi cần quyền quản trị; xác nhận/hủy/điều chỉnh cần quyền duyệt tài chính. */
export default function Billing() {
  const [tab, setTab] = useState<Tab>('recv');
  return (
    <>
      <PageHead title="Công nợ & Hóa đơn điện tử" sub="Theo dõi khoản phải thu, nhắc nợ tự động, hạn mức công nợ và hóa đơn điện tử gửi nhà cung cấp." />
      <Tabs label="Công nợ và hóa đơn" value={tab} onChange={setTab} items={[{ id: 'recv', label: 'Khoản phải thu' }, { id: 'dun', label: 'Nhắc nợ' }, { id: 'einv', label: 'Hóa đơn điện tử' }]} />
      {tab === 'recv' ? <Receivables /> : tab === 'dun' ? <Dunning /> : <Einvoices />}
    </>
  );
}

function Receivables() {
  const sum = useQuery({ queryKey: ['/admin/v1/billing/summary'], queryFn: () => api.get('/admin/v1/billing/summary') as Promise<{ by_state: Record<string, { count: number; remaining_vnd: number }>; total_outstanding_vnd: number; auto_pause_events: number }> });
  const cols: Col<Row>[] = [
    { key: 'customer', label: 'Khách hàng', sortKey: 'customer', text: (r) => s(r.customer) },
    { key: 'period', label: 'Kỳ', text: (r) => s(r.period) || '—' },
    { key: 'amount', label: 'Phải thu', num: true, sortKey: 'amount_vnd', text: (r) => n(r.amount_vnd), cell: (r) => vnd(n(r.amount_vnd)) },
    { key: 'remaining', label: 'Còn lại', num: true, text: (r) => n(r.remaining_vnd), cell: (r) => vnd(n(r.remaining_vnd)) },
    { key: 'due', label: 'Hạn thanh toán', sortKey: 'due_date', text: (r) => fmtDate(s(r.due_date)) },
    { key: 'late', label: 'Quá hạn (ngày)', num: true, text: (r) => n(r.days_past_due) },
    { key: 'limit', label: 'Hạn mức công nợ', num: true, text: (r) => (n(r.credit_limit_vnd) > 0 ? n(r.credit_limit_vnd) : 'Không giới hạn'), cell: (r) => (n(r.credit_limit_vnd) > 0 ? vnd(n(r.credit_limit_vnd)) : 'Không giới hạn') },
    { key: 'state', label: 'Trạng thái', sortKey: 'state', text: (r) => RECV_STATE[s(r.state)]?.label ?? s(r.state), cell: (r) => <Tag tone={RECV_STATE[s(r.state)]?.tone ?? 'info'}>{RECV_STATE[s(r.state)]?.label ?? s(r.state)}</Tag> },
  ];
  const over = sum.data?.by_state?.['overdue'];
  return (
    <>
      <div className="g g3" style={{ margin: '8px 0' }}>
        <Kpi icon="coin" label="Tổng còn phải thu" value={vnd(n(sum.data?.total_outstanding_vnd))} />
        <Kpi icon="alert" label="Quá hạn" value={vnd(n(over?.remaining_vnd))} foot={`${n(over?.count)} khoản`} />
        <Kpi icon="pause" label="Lần tự động tạm dừng" value={String(n(sum.data?.auto_pause_events))} />
      </div>
      <ServerTable id="recv" endpoint="/admin/v1/billing/receivables" itemSchema={anyRow} cols={cols} extra={{ filter: 'unpaid:1' }} exportName="khoan-phai-thu" rowKey={(r) => s(r.id)} emptyText="Không có khoản phải thu nào chưa thanh toán." />
    </>
  );
}

function Dunning() {
  const { can } = useAuth();
  const act = useAct();
  const canEdit = can('admin', 'write');
  const canRun = can('finance', 'approve');
  const q = useQuery({ queryKey: ['/admin/v1/billing/settings'], queryFn: () => api.get('/admin/v1/billing/settings') as Promise<{ settings: { reminder_offsets_days: number[]; auto_pause_after_days: number; enforce_credit_limit: boolean; low_balance_email: boolean; send_emails: boolean } }> });
  const [f, setF] = useState<{ offsets: string; pause: string; credit: boolean; low: boolean; mail: boolean } | null>(null);
  const cur = f ?? (q.data ? { offsets: q.data.settings.reminder_offsets_days.join(', '), pause: String(q.data.settings.auto_pause_after_days), credit: q.data.settings.enforce_credit_limit, low: q.data.settings.low_balance_email, mail: q.data.settings.send_emails } : null);
  const [err, setErr] = useState('');
  const save = async () => {
    if (!cur) return;
    setErr('');
    const offs = cur.offsets.split(/[,\s]+/).filter(Boolean).map(Number);
    if (offs.some((x) => !Number.isInteger(x))) { setErr('Mốc nhắc phải là số nguyên ngày, cách nhau bởi dấu phẩy (âm = trước hạn).'); return; }
    await act(() => api.put('/admin/v1/billing/settings', { body: { reminder_offsets_days: offs, auto_pause_after_days: Number(cur.pause) || 0, enforce_credit_limit: cur.credit, low_balance_email: cur.low, send_emails: cur.mail } }), 'Đã lưu cài đặt nhắc nợ.', ['/admin/v1/billing']);
    setF(null);
  };
  const cols: Col<Row>[] = [
    { key: 'at', label: 'Thời điểm', sortKey: 'created_at', text: (r) => fmtDateTime(s(r.created_at)) },
    { key: 'cu', label: 'Khách hàng', sortKey: 'customer', text: (r) => s(r.customer) },
    { key: 'kind', label: 'Sự kiện', sortKey: 'kind', text: (r) => DUNNING_KIND[s(r.kind)] ?? s(r.kind) },
    { key: 'detail', label: 'Chi tiết', text: (r) => s(r.detail) },
    { key: 'mail', label: 'Email', text: (r) => (r.mail_sent ? 'Đã gửi' : '—') },
  ];
  return (
    <>
      <div className="card cp" style={{ margin: '8px 0' }}>
        <div className="ch"><h2>Cài đặt nhắc nợ</h2></div>
        {q.isLoading ? <LoadingBlock /> : q.error ? <ErrorBlock error={q.error} onRetry={() => void q.refetch()} /> : cur ? (
          <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <Field label="Mốc gửi email nhắc (ngày so với hạn thanh toán)" hint="Ví dụ -3, 0, 7, 14: -3 là trước hạn 3 ngày, 7 là quá hạn 7 ngày."><input value={cur.offsets} disabled={!canEdit} onChange={(e) => setF({ ...cur, offsets: e.target.value })} /></Field>
            <Field label="Tự động tạm dừng chiến dịch khi quá hạn quá (ngày)" hint="0 = không tự động tạm dừng."><input type="number" min={0} value={cur.pause} disabled={!canEdit} onChange={(e) => setF({ ...cur, pause: e.target.value })} /></Field>
            <label style={{ display: 'flex', gap: 8, margin: '8px 0' }}><input type="checkbox" checked={cur.credit} disabled={!canEdit} onChange={(e) => setF({ ...cur, credit: e.target.checked })} /> Áp dụng hạn mức công nợ của từng khách (chặn phát hành hóa đơn / duyệt chiến dịch khi vượt)</label>
            <label style={{ display: 'flex', gap: 8, margin: '8px 0' }}><input type="checkbox" checked={cur.low} disabled={!canEdit} onChange={(e) => setF({ ...cur, low: e.target.checked })} /> Gửi email cảnh báo khi số dư ví thấp</label>
            <label style={{ display: 'flex', gap: 8, margin: '8px 0' }}><input type="checkbox" checked={cur.mail} disabled={!canEdit} onChange={(e) => setF({ ...cur, mail: e.target.checked })} /> Cho phép gửi email nhắc nợ</label>
            {err ? <Note warn>{err}</Note> : null}
            <div className="acts" style={{ marginTop: 10 }}>
              {canEdit ? <Btn tone="p" type="submit">Lưu cài đặt</Btn> : <Note>Chỉ quản trị viên được sửa cài đặt.</Note>}
              {canRun ? <Btn onClick={() => void act(async () => (await api.post('/admin/v1/billing/run')) as { summary: Row }, (r) => `Đã chạy nhắc nợ: ${JSON.stringify(r.summary)}`, ['/admin/v1/billing'])}>Chạy ngay</Btn> : null}
            </div>
          </form>
        ) : null}
      </div>
      <ServerTable id="dun-events" endpoint="/admin/v1/billing/events" itemSchema={anyRow} cols={cols} title="Lịch sử nhắc nợ" exportName="nhac-no" rowKey={(r) => s(r.id)} emptyText="Chưa có sự kiện nhắc nợ nào." />
    </>
  );
}

function Einvoices() {
  const { can } = useAuth();
  const act = useAct();
  const canAct = can('finance', 'approve');
  const canEdit = can('admin', 'write');
  const q = useQuery({ queryKey: ['/admin/v1/einvoices/settings'], queryFn: () => api.get('/admin/v1/einvoices/settings') as Promise<{ settings: { provider: string; sandbox: boolean; series: string; template_code: string; auto_issue: boolean; auto_adjust_on_refund: boolean }; providers: string[]; connection: { configured: boolean; missing: string[] } }> });
  const [f, setF] = useState<{ provider: string; sandbox: boolean; series: string; template_code: string; auto_issue: boolean; auto_adjust_on_refund: boolean } | null>(null);
  const cur = f ?? q.data?.settings ?? null;
  const [err, setErr] = useState('');
  const [confirmProd, setConfirmProd] = useState(false);
  const [dlg, setDlg] = useState<{ kind: 'confirm' | 'adjust'; doc: Row } | null>(null);
  const [cancel, setCancel] = useState<Row | null>(null);
  const save = async () => {
    if (!cur) return;
    setErr('');
    try {
      await api.put('/admin/v1/einvoices/settings', { body: { ...cur, ...(confirmProd ? { confirm_production: true } : {}) } });
      await act(async () => undefined, 'Đã lưu cài đặt hóa đơn điện tử.', ['/admin/v1/einvoices']);
      setF(null);
    } catch (e) {
      setErr(errMsg(e));
    }
  };
  const real = !!cur && cur.provider !== 'manual';
  const cols: Col<Row>[] = [
    { key: 'at', label: 'Tạo lúc', sortKey: 'created_at', text: (r) => fmtDateTime(s(r.created_at)) },
    { key: 'cu', label: 'Khách hàng', sortKey: 'customer', text: (r) => s(r.customer) },
    { key: 'period', label: 'Kỳ', text: (r) => s(r.period) },
    { key: 'kind', label: 'Loại', sortKey: 'kind', text: (r) => EINVOICE_KIND[s(r.kind)] ?? s(r.kind) },
    { key: 'no', label: 'Số hóa đơn', text: (r) => s(r.einvoice_no) || '—' },
    { key: 'total', label: 'Tổng', num: true, sortKey: 'total_vnd', text: (r) => n(r.total_vnd), cell: (r) => vnd(n(r.total_vnd)) },
    { key: 'status', label: 'Trạng thái', sortKey: 'status', text: (r) => EINVOICE_STATUS[s(r.status)]?.label ?? s(r.status), cell: (r) => <Tag tone={EINVOICE_STATUS[s(r.status)]?.tone ?? 'info'}>{EINVOICE_STATUS[s(r.status)]?.label ?? s(r.status)}{r.sandbox ? ' (sandbox)' : ''}</Tag> },
    { key: 'err', label: 'Ghi chú', text: (r) => s(r.last_error) },
    ...(canAct ? [{
      key: 'act', label: '', text: () => '',
      cell: (r: Row) => {
        const id = s(r.id);
        const st = s(r.status);
        const post = (path: string, ok: string) => void act(() => api.post(`/admin/v1/einvoices/${id}/${path}`), ok, ['/admin/v1/einvoices']);
        return (
          <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {st === 'pending' && s(r.provider) === 'manual' ? <Btn tone="p" onClick={() => setDlg({ kind: 'confirm', doc: r })}>Nhập số hóa đơn</Btn> : null}
            {(st === 'pending' || st === 'failed') && s(r.provider) !== 'manual' ? <Btn onClick={() => post('retry', 'Đã thử gửi lại.')}>Thử lại</Btn> : null}
            {st === 'pending' && s(r.provider) !== 'manual' ? <Btn onClick={() => post('refresh', 'Đã cập nhật trạng thái.')}>Kiểm tra trạng thái</Btn> : null}
            {st === 'issued' && s(r.kind) === 'original' ? <Btn onClick={() => setDlg({ kind: 'adjust', doc: r })}>Điều chỉnh</Btn> : null}
            {st === 'issued' ? <Btn tone="d" onClick={() => setCancel(r)}>Hủy</Btn> : null}
          </span>
        );
      },
    } as Col<Row>] : []),
  ];
  return (
    <>
      <div className="card cp" style={{ margin: '8px 0' }}>
        <div className="ch"><h2>Nhà cung cấp hóa đơn điện tử</h2></div>
        {q.isLoading ? <LoadingBlock /> : q.error ? <ErrorBlock error={q.error} onRetry={() => void q.refetch()} /> : cur ? (
          <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <Note warn>Hệ thống chỉ có khung kết nối. Thông tin xác thực nhà cung cấp (MISA/Viettel) được cấu hình bằng biến môi trường của máy chủ, không nhập ở đây. Cần kế toán kiểm thử sandbox trước khi chuyển sang chế độ thật.</Note>
            <Field label="Nhà cung cấp"><select className="sel" value={cur.provider} disabled={!canEdit} onChange={(e) => setF({ ...cur, provider: e.target.value })}>{(q.data?.providers ?? ['manual', 'misa', 'viettel']).map((p) => <option key={p} value={p}>{PROVIDER_LABEL[p] ?? p}</option>)}</select></Field>
            {real ? <p className="sub">Kết nối: {q.data?.connection.configured ? <Tag tone="ok">Đã cấu hình</Tag> : <Tag tone="bad">Thiếu cấu hình: {(q.data?.connection.missing ?? []).join(', ')}</Tag>}</p> : <p className="sub">Chế độ thủ công: kế toán phát hành trên cổng nhà cung cấp rồi nhập số hóa đơn vào hệ thống.</p>}
            <div className="g g2">
              <Field label="Ký hiệu hóa đơn"><input value={cur.series} disabled={!canEdit} onChange={(e) => setF({ ...cur, series: e.target.value })} /></Field>
              <Field label="Mẫu số"><input value={cur.template_code} disabled={!canEdit} onChange={(e) => setF({ ...cur, template_code: e.target.value })} /></Field>
            </div>
            {real ? <label style={{ display: 'flex', gap: 8, margin: '8px 0' }}><input type="checkbox" checked={cur.sandbox} disabled={!canEdit} onChange={(e) => setF({ ...cur, sandbox: e.target.checked })} /> Chế độ thử nghiệm (sandbox)</label> : null}
            {real && !cur.sandbox ? <label style={{ display: 'flex', gap: 8, margin: '8px 0' }}><input type="checkbox" checked={confirmProd} onChange={(e) => setConfirmProd(e.target.checked)} /> Tôi xác nhận kế toán đã kiểm thử sandbox và đồng ý phát hành hóa đơn có giá trị pháp lý</label> : null}
            <label style={{ display: 'flex', gap: 8, margin: '8px 0' }}><input type="checkbox" checked={cur.auto_issue} disabled={!canEdit} onChange={(e) => setF({ ...cur, auto_issue: e.target.checked })} /> Tự động gửi hóa đơn điện tử khi phát hành hóa đơn nội bộ</label>
            <label style={{ display: 'flex', gap: 8, margin: '8px 0' }}><input type="checkbox" checked={cur.auto_adjust_on_refund} disabled={!canEdit} onChange={(e) => setF({ ...cur, auto_adjust_on_refund: e.target.checked })} /> Tự tạo hóa đơn điều chỉnh khi hoàn tiền</label>
            {err ? <Note warn>{err}</Note> : null}
            {canEdit ? <div className="acts" style={{ marginTop: 10 }}><Btn tone="p" type="submit">Lưu cài đặt</Btn></div> : <Note>Chỉ quản trị viên được sửa cài đặt.</Note>}
          </form>
        ) : null}
      </div>
      <ServerTable id="einv" endpoint="/admin/v1/einvoices" itemSchema={anyRow} cols={cols} title="Chứng từ hóa đơn điện tử" exportName="hoa-don-dien-tu" rowKey={(r) => s(r.id)} emptyText="Chưa có chứng từ hóa đơn điện tử." />
      {dlg ? <DocDialog kind={dlg.kind} doc={dlg.doc} onClose={() => setDlg(null)} /> : null}
      <PromptDialog open={!!cancel} title="Hủy hóa đơn điện tử" label="Lý do hủy" onClose={() => setCancel(null)} onSubmit={async (reason) => { if (cancel) await act(() => api.post(`/admin/v1/einvoices/${s(cancel.id)}/cancel`, { body: { reason } }), 'Đã tạo chứng từ hủy.', ['/admin/v1/einvoices']); }} />
    </>
  );
}

function DocDialog({ kind, doc, onClose }: { kind: 'confirm' | 'adjust'; doc: Row; onClose: () => void }) {
  const act = useAct();
  const [no, setNo] = useState('');
  const [series, setSeries] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const submit = async () => {
    setErr('');
    try {
      if (kind === 'confirm') await api.post(`/admin/v1/einvoices/${s(doc.id)}/confirm`, { body: { einvoice_no: no, ...(series ? { series } : {}) } });
      else await api.post('/admin/v1/einvoices/adjust', { body: { invoice_id: s(doc.invoice_id), refund_total_vnd: Number(amount), reason, ...(no ? { manual_ref: no } : {}) } });
      await act(async () => undefined, kind === 'confirm' ? 'Đã ghi nhận số hóa đơn.' : 'Đã tạo hóa đơn điều chỉnh.', ['/admin/v1/einvoices']);
      onClose();
    } catch (e) {
      setErr(errMsg(e));
    }
  };
  return (
    <Dialog open onClose={onClose} width="min(480px,96vw)" label={kind === 'confirm' ? 'Nhập số hóa đơn' : 'Điều chỉnh hóa đơn'}>
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <h2 style={{ margin: '0 0 10px', fontSize: 18 }}>{kind === 'confirm' ? 'Nhập số hóa đơn đã phát hành' : 'Tạo hóa đơn điều chỉnh (hoàn tiền)'}</h2>
        {kind === 'adjust' ? (
          <>
            <Field label="Số tiền hoàn (gồm VAT, VND)"><input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} required /></Field>
            <Field label="Lý do"><input value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} /></Field>
          </>
        ) : null}
        <Field label={kind === 'confirm' ? 'Số hóa đơn' : 'Số hóa đơn điều chỉnh (chế độ thủ công, nếu đã có)'}><input value={no} onChange={(e) => setNo(e.target.value)} required={kind === 'confirm'} /></Field>
        {kind === 'confirm' ? <Field label="Ký hiệu (nếu khác mặc định)"><input value={series} onChange={(e) => setSeries(e.target.value)} /></Field> : null}
        {err ? <Note warn>{err}</Note> : null}
        <div className="da" style={{ marginTop: 14 }}>
          <button type="button" className="btn" onClick={onClose}>Hủy</button>
          <button type="submit" className="btn p">Xác nhận</button>
        </div>
      </form>
    </Dialog>
  );
}
