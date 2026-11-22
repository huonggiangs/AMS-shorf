import { useState } from 'react';
import { ApiError, api, errMsg } from '../api/client';
import { useAct } from '../api/hooks';
import type { Customer } from '../api/schemas';
import { Dialog } from './Dialog';
import { Field, Note } from './ui';

export interface Contact { id?: string; name: string; title?: string | null; phone?: string | null; email?: string | null; is_primary?: boolean | number }
export const TAX_RE = /^\d{10}(-\d{3})?$/;
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const STATUS: [string, string][] = [['cooperating', 'Đang hợp tác'], ['pending_payment', 'Chờ thanh toán'], ['suspended', 'Tạm dừng'], ['terminated', 'Chấm dứt']];

/** Kiểm tra hồ sơ trước khi gửi (máy chủ kiểm tra lại): trả về thông báo lỗi tiếng Việt hoặc chuỗi rỗng. */
export function validateCustomerForm(f: { legal_name: string; tax_code: string; email: string }, contacts: Contact[]): string {
  if (!f.legal_name.trim()) return 'Nhập tên pháp lý.';
  if (f.tax_code.trim() && !TAX_RE.test(f.tax_code.trim())) return 'Mã số thuế gồm 10 số (hoặc 10 số-3 số, ví dụ 0312345678-001).';
  if (f.email.trim() && !EMAIL_RE.test(f.email.trim())) return 'Email không hợp lệ.';
  for (const [i, c] of contacts.entries()) {
    if (!c.name.trim()) return `Người liên hệ #${i + 1}: nhập tên.`;
    if (c.email && c.email.trim() && !EMAIL_RE.test(c.email.trim())) return `Người liên hệ #${i + 1}: email không hợp lệ.`;
  }
  return '';
}

/** Sửa hồ sơ khách hàng. Mã khách hàng (mã thanh toán) chỉ đọc. Gửi PATCH kèm `if_updated_at` để chặn ghi đè khi người khác vừa sửa. */
export function EditCustomerDialog({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const act = useAct();
  const c = customer as Customer & { notes?: string | null; updated_at?: string | null; contacts?: Contact[] };
  const [f, setF] = useState({
    legal_name: c.legal_name ?? '', short_name: c.short_name ?? '', tax_code: c.tax_code ?? '', address: c.address ?? '', representative: c.representative ?? '', rep_title: c.rep_title ?? '',
    phone: c.phone ?? '', email: c.email ?? '', industry: c.industry ?? '', payment_terms: c.payment_terms ?? '', notes: c.notes ?? '', status: c.status,
  });
  const [contacts, setContacts] = useState<Contact[]>((c.contacts ?? []).map((x) => ({ ...x, is_primary: !!x.is_primary })));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const setC = (i: number, patch: Partial<Contact>) => setContacts((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : patch.is_primary ? { ...x, is_primary: false } : x)));
  const submit = async () => {
    const bad = validateCustomerForm(f, contacts);
    if (bad) return setErr(bad);
    setErr(''); setBusy(true);
    const r = await act(() => api.patch(`/admin/v1/customers/${c.id}`, {
      body: { ...f, if_updated_at: c.updated_at ?? undefined, contacts: contacts.map((x) => ({ id: x.id, name: x.name.trim(), title: x.title || null, phone: x.phone || null, email: x.email || null, is_primary: !!x.is_primary })) },
    }), 'Đã lưu hồ sơ khách hàng.');
    setBusy(false);
    if (r !== undefined) onClose();
  };
  return (
    <Dialog open onClose={onClose} size="lg" label="Sửa khách hàng">
      <form noValidate onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <h2 style={{ margin: '0 0 10px', fontSize: 18 }}>Sửa khách hàng · {c.code ?? c.id}</h2>
        <div className="g g2" style={{ margin: 0 }}>
          <Field label="Mã khách hàng (không đổi được)"><input readOnly value={c.code ?? c.id} className="mono" /></Field>
          <Field label="Trạng thái"><select value={f.status} onChange={(e) => set('status', e.target.value)}>{STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        </div>
        <Field label="Tên pháp lý"><input required value={f.legal_name} onChange={(e) => set('legal_name', e.target.value)} /></Field>
        <div className="g g2" style={{ margin: 0 }}>
          <Field label="Tên gọi ngắn"><input value={f.short_name} onChange={(e) => set('short_name', e.target.value)} /></Field>
          <Field label="Mã số thuế" hint="10 số, hoặc 10 số-3 số cho chi nhánh"><input inputMode="numeric" value={f.tax_code} onChange={(e) => set('tax_code', e.target.value)} aria-invalid={!!f.tax_code && !TAX_RE.test(f.tax_code.trim())} /></Field>
          <Field label="Người đại diện"><input value={f.representative} onChange={(e) => set('representative', e.target.value)} /></Field>
          <Field label="Chức vụ"><input value={f.rep_title} onChange={(e) => set('rep_title', e.target.value)} /></Field>
          <Field label="Điện thoại"><input value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
          <Field label="Email"><input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
          <Field label="Ngành"><input value={f.industry} onChange={(e) => set('industry', e.target.value)} /></Field>
          <Field label="Điều khoản thanh toán"><input value={f.payment_terms} onChange={(e) => set('payment_terms', e.target.value)} /></Field>
        </div>
        <Field label="Địa chỉ"><input value={f.address} onChange={(e) => set('address', e.target.value)} /></Field>
        <Field label="Ghi chú nội bộ"><textarea rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
        <h3 style={{ margin: '12px 0 6px', fontSize: 15 }}>Người liên hệ</h3>
        {contacts.map((x, i) => (
          <div key={x.id ?? `n${i}`} className="g g4" style={{ margin: '0 0 6px', alignItems: 'end' }}>
            <Field label="Tên"><input value={x.name} onChange={(e) => setC(i, { name: e.target.value })} /></Field>
            <Field label="Chức vụ"><input value={x.title ?? ''} onChange={(e) => setC(i, { title: e.target.value })} /></Field>
            <Field label="Điện thoại"><input value={x.phone ?? ''} onChange={(e) => setC(i, { phone: e.target.value })} /></Field>
            <Field label="Email"><input value={x.email ?? ''} onChange={(e) => setC(i, { email: e.target.value })} /></Field>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="radio" name="primary" checked={!!x.is_primary} onChange={() => setC(i, { is_primary: true })} /> Đầu mối chính</label>
            <button type="button" className="btn sm d" onClick={() => setContacts((l) => l.filter((_, j) => j !== i))}>Xóa liên hệ</button>
          </div>
        ))}
        <button type="button" className="btn sm" onClick={() => setContacts((l) => [...l, { name: '', is_primary: l.length === 0 }])}>Thêm người liên hệ</button>
        {err ? <Note warn>{err}</Note> : null}
        <div className="da" style={{ marginTop: 14 }}>
          <button type="button" className="btn" onClick={onClose}>Hủy</button>
          <button type="submit" className="btn p" disabled={busy}>Lưu</button>
        </div>
      </form>
    </Dialog>
  );
}

interface Blocker { code: string; message: string }

/** Xóa (lưu trữ) khách hàng. Nếu máy chủ chặn (chiến dịch đang chạy, số dư ví, công nợ) thì hiện đầy đủ lý do. */
export function DeleteCustomerDialog({ customer, onClose, onDone }: { customer: Customer; onClose: () => void; onDone: () => void }) {
  const act = useAct();
  const [blockers, setBlockers] = useState<Blocker[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true); setErr(''); setBlockers([]);
    try {
      await api.del(`/admin/v1/customers/${customer.id}`);
      await act(async () => undefined, 'Đã xóa (lưu trữ) khách hàng.');
      onDone();
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'customer_has_blockers') setBlockers((e.details as { blockers?: Blocker[] } | undefined)?.blockers ?? [{ code: 'x', message: e.message }]);
      else setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} size="lg" label="Xóa khách hàng">
      <h2 style={{ margin: '0 0 10px', fontSize: 18 }}>Xóa khách hàng “{customer.short_name ?? customer.legal_name}”?</h2>
      <Note warn>Khách hàng được lưu trữ (ẩn khỏi danh sách, chuyển sang “Chấm dứt”) và các tài khoản cổng khách hàng bị khóa, đăng xuất. Hợp đồng, hóa đơn, ví và lịch sử được giữ nguyên. Không xóa được nếu còn chiến dịch đang hoạt động, số dư ví hoặc hóa đơn/công nợ chưa thanh toán.</Note>
      {blockers.length ? (
        <div role="alert" style={{ marginTop: 10 }}>
          <b style={{ color: 'var(--bad)' }}>Chưa thể xóa khách hàng này:</b>
          <ul style={{ margin: '6px 0', paddingLeft: 18 }}>{blockers.map((b) => <li key={b.code}>{b.message}</li>)}</ul>
        </div>
      ) : null}
      {err ? <p role="alert" style={{ color: 'var(--bad)' }}>{err}</p> : null}
      <div className="da" style={{ marginTop: 14 }}>
        <button type="button" className="btn" onClick={onClose}>{blockers.length ? 'Đóng' : 'Hủy'}</button>
        {blockers.length ? null : <button type="button" className="btn d" onClick={() => void submit()} disabled={busy}>Xóa khách hàng</button>}
      </div>
    </Dialog>
  );
}
