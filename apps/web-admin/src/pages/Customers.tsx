import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, errMsg } from '../api/client';
import { campaignSchema, contractRenderSchema, contractSchema, customerSchema, listOf, type Contract, type Customer } from '../api/schemas';
import { useAct } from '../api/hooks';
import { useAuth } from '../auth/AuthProvider';
import { ServerTable } from '../components/ServerTable';
import type { Col } from '../components/DataTable';
import { Btn, Field, Kpi, LoadingBlock, NameCell, Note, PageHead, StatusTag, Tabs } from '../components/ui';
import { Drawer } from '../components/Drawer';
import { Dialog } from '../components/Dialog';
import { useT } from '../i18n';
import { fmtDate, vnd, vndInWords } from '../lib/format';

type Tab = 'cu' | 'ct' | 'tpl';

export default function Customers() {
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>('cu');
  const [sp, setSp] = useSearchParams();
  const [add, setAdd] = useState(false);
  const [tplCus, setTplCus] = useState('');
  const [tplContract, setTplContract] = useState('');
  const total = (key: string, path: string, schema: typeof customerSchema | typeof contractSchema, filter?: string) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useQuery({ queryKey: [path, 'count', key], queryFn: () => api.get(path, { query: { page_size: 1, filter }, schema: listOf(schema) }) }).data?.total;
  const nCus = total('all', '/admin/v1/customers', customerSchema);
  const nActive = total('act', '/admin/v1/customers', customerSchema, 'status:cooperating');
  const nCt = total('all', '/admin/v1/contracts', contractSchema);
  const nEff = total('eff', '/admin/v1/contracts', contractSchema, 'status:effective');
  const nSign = total('sign', '/admin/v1/contracts', contractSchema, 'status:pending_sign');

  const cusCols: Col<Customer>[] = [
    { key: 'short', label: 'Khách hàng', sortKey: 'short_name', text: (r) => r.short_name ?? r.legal_name, cell: (r) => <NameCell icon="user" a={r.short_name ?? r.legal_name} b={r.legal_name} /> },
    { key: 'code', label: 'Mã', sortKey: 'code', text: (r) => r.code ?? r.id, cell: (r) => <span className="mono">{r.code ?? r.id}</span> },
    { key: 'tax', label: 'MST', text: (r) => r.tax_code ?? '', cell: (r) => <span className="mono">{r.tax_code ?? '—'}</span> },
    { key: 'contact', label: 'Đầu mối', text: (r) => r.contact ?? '', cell: (r) => <>{r.contact ?? '—'}<div style={{ color: 'var(--mut)', fontSize: 12.5 }}>{r.phone}</div></> },
    { key: 'industry', label: 'Ngành', text: (r) => r.industry ?? '' },
    { key: 'owner', label: 'Phụ trách', text: (r) => r.owner ?? '' },
    { key: 'debt', label: 'Công nợ', sortKey: 'debt_vnd', num: true, text: (r) => r.debt_vnd, cell: (r) => vnd(r.debt_vnd) },
    { key: 'status', label: 'Trạng thái', text: (r) => r.status, cell: (r) => <StatusTag status={r.status} /> },
  ];
  const ctCols: Col<Contract>[] = [
    { key: 'number', label: 'Số hợp đồng', sortKey: 'number', text: (r) => r.number, cell: (r) => <NameCell icon="doc" a={r.number} b={r.title} /> },
    { key: 'cus', label: 'Khách hàng', text: (r) => r.customer_name ?? r.customer_id },
    { key: 'val', label: 'Giá trị', sortKey: 'value_vnd', num: true, text: (r) => r.value_vnd, cell: (r) => vnd(r.value_vnd) },
    { key: 'term', label: 'Thời hạn', text: (r) => `${r.start_date ?? ''} → ${r.end_date ?? ''}`, cell: (r) => <span className="mono" style={{ fontSize: 12.5 }}>{fmtDate(r.start_date)} → {fmtDate(r.end_date)}</span> },
    { key: 'paid', label: 'Đã thu', text: (r) => `${r.paid_pct}%`, cell: (r) => <div style={{ minWidth: 100 }}><b className="mono" style={{ fontSize: 12.5 }}>{r.paid_pct}%</b><div className="bar" style={{ marginTop: 4 }}><i style={{ width: `${r.paid_pct}%` }} /></div></div> },
    { key: 'status', label: 'Trạng thái', text: (r) => r.status, cell: (r) => <StatusTag status={r.status} /> },
    { key: 'view', label: '', cell: (r) => <Btn className="sm" onClick={() => { setTplContract(r.id); setTab('tpl'); }}>Xem mẫu</Btn> },
  ];
  return (
    <>
      <PageHead title="Khách hàng & Hợp đồng" sub="Hồ sơ nhãn hàng, hợp đồng kinh tế, công nợ và hợp đồng mẫu." actions={can('customers', 'write') ? <Btn tone="p" icon="plus" onClick={() => setAdd(true)}>Thêm khách hàng</Btn> : null} />
      <div className="g g4">
        <Kpi label="Khách hàng" icon="users" value={nCus ?? '—'} foot={nActive != null ? `Đang hợp tác ${nActive}` : ''} />
        <Kpi label="Hợp đồng hiệu lực" icon="doc" value={nEff ?? '—'} foot={nSign != null ? `Chờ ký ${nSign}` : ''} />
        <Kpi label="Tổng hợp đồng" icon="coin" value={nCt ?? '—'} foot="Kể cả hết hạn" />
      </div>
      <Tabs value={tab} onChange={setTab} items={[{ id: 'cu', label: 'Khách hàng' }, { id: 'ct', label: 'Hợp đồng' }, { id: 'tpl', label: 'Hợp đồng mẫu' }]} />
      {tab === 'cu' ? (
        <ServerTable id="cu" endpoint="/admin/v1/customers" itemSchema={customerSchema} cols={cusCols} title="Danh sách khách hàng" exportName="khach-hang" onOpen={(r) => setSp({ open: r.id })}
          filters={[{ key: 'status', label: 'Trạng thái', options: ['cooperating', 'pending_payment', 'suspended'].map((v) => ({ value: v, label: v === 'cooperating' ? 'Đang hợp tác' : v === 'pending_payment' ? 'Chờ thanh toán' : 'Tạm dừng' })) }]} />
      ) : null}
      {tab === 'ct' ? (
        <ServerTable id="ct" endpoint="/admin/v1/contracts" itemSchema={contractSchema} cols={ctCols} title="Hợp đồng kinh tế" exportName="hop-dong"
          filters={[{ key: 'status', label: 'Trạng thái', options: ['effective', 'pending_sign', 'suspended', 'expired'].map((v) => ({ value: v, label: v === 'effective' ? 'Hiệu lực' : v === 'pending_sign' ? 'Chờ ký' : v === 'suspended' ? 'Tạm dừng' : 'Hết hạn' })) }]} />
      ) : null}
      {tab === 'tpl' ? <ContractTemplate initialCustomer={tplCus} initialContract={tplContract} /> : null}
      <CustomerDrawer id={sp.get('open')} onClose={() => setSp({})} onTemplate={(cid) => { setTplCus(cid); setTplContract(''); setSp({}); setTab('tpl'); }} />
      <AddCustomer open={add} onClose={() => setAdd(false)} />
    </>
  );
}

function CustomerDrawer({ id, onClose, onTemplate }: { id: string | null; onClose: () => void; onTemplate: (id: string) => void }) {
  const c = useQuery({ queryKey: ['/admin/v1/customers', 'one', id], enabled: !!id, queryFn: () => api.get(`/admin/v1/customers/${id}`, { schema: customerSchema }) });
  const cts = useQuery({ queryKey: ['/admin/v1/contracts', 'of', id], enabled: !!id, queryFn: () => api.get('/admin/v1/contracts', { query: { page_size: 50, filter: `customer_id:${id}` }, schema: listOf(contractSchema) }) });
  const cps = useQuery({ queryKey: ['/admin/v1/campaigns', 'of', id], enabled: !!id, queryFn: () => api.get('/admin/v1/campaigns', { query: { page_size: 50, filter: `customer_id:${id}` }, schema: listOf(campaignSchema) }) });
  const d = c.data;
  return (
    <Drawer open={!!id} onClose={onClose}>
      {c.isLoading ? <LoadingBlock /> : c.isError ? <p role="alert" style={{ color: 'var(--bad)' }}>{errMsg(c.error)}</p> : d ? (
        <>
          <h2>{d.short_name ?? d.legal_name}</h2>
          <p className="sub">{d.legal_name}</p>
          <div style={{ margin: '12px 0' }}><StatusTag status={d.status} /></div>
          <dl className="kv">
            <dt>Mã khách hàng</dt><dd className="mono">{d.code ?? d.id}</dd>
            <dt>Mã số thuế</dt><dd className="mono">{d.tax_code ?? '—'}</dd>
            <dt>Địa chỉ</dt><dd>{d.address ?? '—'}</dd>
            <dt>Người đại diện</dt><dd>{d.representative ?? '—'}{d.rep_title ? ` · ${d.rep_title}` : ''}</dd>
            <dt>Điện thoại</dt><dd className="mono">{d.phone ?? '—'}</dd>
            <dt>Email</dt><dd>{d.email ?? '—'}</dd>
            <dt>Đầu mối</dt><dd>{d.contact ?? '—'}</dd>
            <dt>Ngành</dt><dd>{d.industry ?? '—'}</dd>
            <dt>Phụ trách</dt><dd>{d.owner ?? '—'}</dd>
            <dt>Điều khoản</dt><dd>{d.payment_terms ?? '—'}</dd>
            <dt>Hạn mức công nợ</dt><dd className="mono">{vnd(d.credit_limit_vnd)}</dd>
            <dt>Công nợ hiện tại</dt><dd className="mono" style={{ color: d.debt_vnd > d.credit_limit_vnd * 0.8 ? 'var(--bad)' : 'var(--ink)' }}>{vnd(d.debt_vnd)}</dd>
            <dt>Hợp tác từ</dt><dd>{d.since ?? '—'}</dd>
          </dl>
          <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Hợp đồng ({cts.data?.total ?? 0})</h3>
          {cts.data?.items.map((x) => <div key={x.id} className="mono" style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '10px 12px', background: 'var(--bg)', borderRadius: 8, marginBottom: 6, fontSize: 12.5 }}><span>{x.number} · <StatusTag status={x.status} /></span><b>{vnd(x.value_vnd)}</b></div>)}
          {!cts.data?.items.length ? <p className="sub">Chưa có hợp đồng.</p> : null}
          <h3 style={{ margin: '16px 0 8px', fontSize: 15 }}>Chiến dịch ({cps.data?.total ?? 0})</h3>
          {cps.data?.items.map((a) => <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid var(--line)' }}><span>{a.name}</span><StatusTag status={a.status} /></div>)}
          {!cps.data?.items.length ? <p className="sub">Chưa có chiến dịch.</p> : null}
          <div className="acts" style={{ marginTop: 20 }}>
            <Btn tone="p" onClick={() => onTemplate(d.id)}>Tạo hợp đồng từ mẫu</Btn>
            <Btn onClick={onClose}>Đóng</Btn>
          </div>
        </>
      ) : null}
    </Drawer>
  );
}

function AddCustomer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const act = useAct();
  const [f, setF] = useState({ legal_name: '', short_name: '', tax_code: '', address: '', representative: '', rep_title: '', phone: '', email: '', industry: '', payment_terms: '', credit_limit_vnd: '0' });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  return (
    <Dialog open={open} onClose={onClose} width="min(560px,96vw)" label="Thêm khách hàng">
      <form onSubmit={async (e) => { e.preventDefault(); const r = await act(() => api.post('/admin/v1/customers', { body: { ...f, credit_limit_vnd: Math.round(+f.credit_limit_vnd || 0) } }), 'Đã thêm khách hàng.'); if (r !== undefined) onClose(); }}>
        <h2 style={{ margin: '0 0 10px', fontSize: 18 }}>Thêm khách hàng</h2>
        <Field label="Tên pháp lý"><input required value={f.legal_name} onChange={(e) => set('legal_name', e.target.value)} /></Field>
        <div className="g g2" style={{ margin: 0 }}>
          <Field label="Tên gọi ngắn"><input value={f.short_name} onChange={(e) => set('short_name', e.target.value)} /></Field>
          <Field label="Mã số thuế"><input inputMode="numeric" pattern="[0-9\-]{10,14}" value={f.tax_code} onChange={(e) => set('tax_code', e.target.value)} /></Field>
          <Field label="Người đại diện"><input value={f.representative} onChange={(e) => set('representative', e.target.value)} /></Field>
          <Field label="Chức vụ"><input value={f.rep_title} onChange={(e) => set('rep_title', e.target.value)} /></Field>
          <Field label="Điện thoại"><input value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
          <Field label="Email"><input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
          <Field label="Ngành"><input value={f.industry} onChange={(e) => set('industry', e.target.value)} /></Field>
          <Field label="Điều khoản thanh toán"><input value={f.payment_terms} onChange={(e) => set('payment_terms', e.target.value)} /></Field>
        </div>
        <Field label="Địa chỉ"><input value={f.address} onChange={(e) => set('address', e.target.value)} /></Field>
        <Field label="Hạn mức công nợ (₫)"><input type="number" min={0} value={f.credit_limit_vnd} onChange={(e) => set('credit_limit_vnd', e.target.value)} /></Field>
        <div className="da" style={{ marginTop: 14 }}>
          <button type="button" className="btn" onClick={onClose}>{t('Hủy')}</button>
          <button type="submit" className="btn p">{t('Lưu')}</button>
        </div>
      </form>
    </Dialog>
  );
}

/** Contract template tab: fill from customer profile, server renders HTML (amount in words), print = PDF. */
function ContractTemplate({ initialCustomer, initialContract }: { initialCustomer: string; initialContract: string }) {
  const act = useAct();
  const frame = useRef<HTMLIFrameElement>(null);
  const [f, setF] = useState({ customer_id: initialCustomer, number: '', value: '0', start: '', months: '12', adv: '30' });
  const [contractId, setContractId] = useState(initialContract);
  const [html, setHtml] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const custs = useQuery({ queryKey: ['/admin/v1/customers', 'pick'], queryFn: () => api.get('/admin/v1/customers', { query: { page_size: 200 }, schema: listOf(customerSchema) }) });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const render = async (id: string) => {
    setBusy(true); setErr('');
    try { setHtml((await api.post(`/admin/v1/contracts/${id}/render`, { body: { advance_pct: +f.adv, months: +f.months }, schema: contractRenderSchema })).html); setContractId(id); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  useEffect(() => { if (initialContract) void render(initialContract); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    if (!f.customer_id) return setErr('Chọn khách hàng (Bên B).');
    const r = await act(() => api.post('/admin/v1/contracts', { body: { customer_id: f.customer_id, number: f.number || undefined, value_vnd: Math.round(+f.value || 0), start_date: f.start || undefined, months: +f.months, advance_pct: +f.adv }, schema: contractSchema }), 'Đã lưu hợp đồng.', ['/admin/v1/contracts']);
    if (r) await render(r.id);
  };
  const print = () => { const w = frame.current?.contentWindow; if (w) { w.focus(); w.print(); } };
  return (
    <>
      <Note>Hợp đồng mẫu tham khảo, điền sẵn từ hồ sơ khách hàng, số tiền bằng chữ do máy chủ sinh. Cần luật sư của công ty rà soát trước khi dùng chính thức.</Note>
      <div className="g g21">
        <div className="card cp" style={{ background: 'var(--bg)', boxShadow: 'none', minHeight: 260 }}>
          {busy ? <LoadingBlock /> : html ? <iframe ref={frame} title="Hợp đồng" sandbox="allow-same-origin allow-modals" srcDoc={html} style={{ width: '100%', height: 720, border: 0, background: '#fff', borderRadius: 8 }} /> : <p className="sub" style={{ textAlign: 'center' }}>Lưu hợp đồng để xem bản dựng từ mẫu, hoặc bấm &quot;Xem mẫu&quot; ở danh sách hợp đồng.</p>}
        </div>
        <div className="card cp" style={{ alignSelf: 'start' }}>
          <div className="ch"><h2>Điền hợp đồng</h2></div>
          <Field label="Khách hàng (Bên B)"><select value={f.customer_id} onChange={(e) => set('customer_id', e.target.value)}><option value="">—</option>{custs.data?.items.map((c) => <option key={c.id} value={c.id}>{c.short_name ?? c.legal_name}</option>)}</select></Field>
          <Field label="Số hợp đồng (để trống: tự cấp)"><input value={f.number} onChange={(e) => set('number', e.target.value)} /></Field>
          <Field label="Giá trị (₫)" hint={`Bằng chữ: ${vndInWords(+f.value || 0)}`}><input type="number" min={0} value={f.value} onChange={(e) => set('value', e.target.value)} /></Field>
          <Field label="Ngày hiệu lực"><input type="date" value={f.start} onChange={(e) => set('start', e.target.value)} /></Field>
          <Field label="Thời hạn (tháng)"><input type="number" min={1} value={f.months} onChange={(e) => set('months', e.target.value)} /></Field>
          <Field label="Thanh toán trước (%)"><input type="number" min={0} max={100} value={f.adv} onChange={(e) => set('adv', e.target.value)} /></Field>
          {err ? <p role="alert" style={{ color: 'var(--bad)' }}>{err}</p> : null}
          <div className="acts" style={{ marginTop: 14 }}>
            <Btn tone="p" onClick={print} disabled={!html}>Xuất PDF / In</Btn>
            <Btn onClick={() => void save()}>Lưu vào danh sách</Btn>
            {contractId ? <Btn onClick={() => void render(contractId)}>Dựng lại</Btn> : null}
          </div>
        </div>
      </div>
    </>
  );
}
