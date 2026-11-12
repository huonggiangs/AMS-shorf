import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, errMsg } from '../api/client';
import { customerSchema, listOf, userSchema, MODULES, type AdminUser, type Permissions, type Role } from '../api/schemas';
import { useAct } from '../api/hooks';
import { useAuth } from '../auth/AuthProvider';
import { ServerTable } from '../components/ServerTable';
import type { Col } from '../components/DataTable';
import { PermissionMatrix } from '../components/PermissionMatrix';
import { Btn, Field, Kpi, NameCell, Note, PageHead, StatusTag, Tag } from '../components/ui';
import { Icon } from '../components/Icon';
import { useT } from '../i18n';
import { ROLE_HELP, ROLE_LABEL } from '../lib/status';
import { ROLE_PRESET, clampForRole, isExternalRole, permCount } from '../lib/rbac';

const ROLE_KEYS = Object.keys(ROLE_LABEL) as Role[];
interface Draft { id: string; name: string; email: string; phone: string; role: Role; customer_id: string; expires_at: string; perms: Permissions }
const blank = (): Draft => ({ id: '', name: '', email: '', phone: '', role: 'content_manager', customer_id: '', expires_at: '', perms: structuredClone(ROLE_PRESET.content_manager) });

export default function Access() {
  const t = useT();
  const { can } = useAuth();
  const act = useAct();
  const [sp, setSp] = useSearchParams();
  const [u, setU] = useState<Draft>(blank);
  const [err, setErr] = useState('');
  const canWrite = can('admin', 'write');
  const ext = isExternalRole(u.role);
  const custs = useQuery({ queryKey: ['/admin/v1/customers', 'pick'], queryFn: () => api.get('/admin/v1/customers', { query: { page_size: 200 }, schema: listOf(customerSchema) }) });
  const count = (key: string, filter?: string) => useQuery({ queryKey: ['/admin/v1/users', 'count', key], queryFn: () => api.get('/admin/v1/users', { query: { page_size: 1, filter }, schema: listOf(userSchema) }) }).data?.total; // eslint-disable-line react-hooks/rules-of-hooks
  const nAll = count('all'), nInv = count('inv', 'status:invited'), nExt = count('ext', 'external:1');

  const setRole = (role: Role) => setU((p) => ({ ...p, role, perms: clampForRole(role, structuredClone(ROLE_PRESET[role])) }));
  const editId = sp.get('user');
  useEffect(() => {
    if (!editId) return;
    void (async () => {
      try {
        const m = await api.get(`/admin/v1/users/${editId}`, { schema: userSchema });
        const p = (await api.get(`/admin/v1/permissions/${editId}`)) as { permissions?: Permissions } | Permissions;
        const perms = (p as { permissions?: Permissions }).permissions ?? (p as Permissions);
        setU({ id: m.id, name: m.name ?? '', email: m.email, phone: m.phone ?? '', role: m.role as Role, customer_id: m.customer_id ?? '', expires_at: m.expires_at?.slice(0, 10) ?? '', perms: clampForRole(m.role, perms) });
        document.getElementById('nuCard')?.scrollIntoView?.({ behavior: 'smooth' });
      } catch (e) { setErr(errMsg(e)); }
    })();
  }, [editId]);

  const save = async () => {
    setErr('');
    if (!u.id && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(u.email)) return setErr('Email không hợp lệ.');
    if (!u.id && !u.name.trim()) return setErr('Nhập họ tên.');
    if (ext && !u.customer_id) return setErr('Tài khoản ngoài bắt buộc chọn phạm vi khách hàng.');
    const perms = clampForRole(u.role, u.perms);
    const r = u.id
      ? await act(async () => { await api.put(`/admin/v1/permissions/${u.id}`, { body: { permissions: perms } }); await api.put(`/admin/v1/users/${u.id}`, { body: { role: u.role, customer_id: u.customer_id || null, expires_at: u.expires_at || null } }); return true; }, 'Đã lưu thay đổi.')
      : await act(() => api.post('/admin/v1/users', { body: { name: u.name.trim(), email: u.email.trim(), phone: u.phone || undefined, role: u.role, customer_id: ext ? u.customer_id : undefined, expires_at: ext && u.expires_at ? u.expires_at : undefined, permissions: perms } }), 'Đã gửi email mời, liên kết kích hoạt hết hạn sau 72 giờ.');
    if (r !== undefined) { setU(blank()); setSp({}); }
  };

  const cols: Col<AdminUser>[] = [
    { key: 'name', label: 'Người dùng', sortKey: 'name', text: (r) => r.name ?? r.email, cell: (r) => <NameCell icon="user" a={r.name ?? r.email} b={r.email} /> },
    { key: 'role', label: 'Vai trò', sortKey: 'role', text: (r) => ROLE_LABEL[r.role] ?? r.role },
    { key: 'scope', label: 'Phạm vi', text: (r) => r.customer_name ?? 'Toàn hệ thống' },
    { key: 'perm', label: 'Quyền', num: true, text: (r) => r.perm_count ?? '', cell: (r) => (r.perm_count != null ? `${r.perm_count} quyền` : '—') },
    { key: 'status', label: 'Trạng thái', text: (r) => r.status, cell: (r) => <StatusTag status={r.status} /> },
    { key: 'edit', label: '', cell: (r) => canWrite ? <Btn className="sm" onClick={() => setSp({ user: r.id })}>Sửa quyền</Btn> : null },
  ];
  return (
    <>
      <PageHead title="Người dùng & Phân quyền" sub="Cấp quyền cho đội nội dung, tài chính và vận hành." actions={canWrite ? <Btn tone="p" icon="plus" onClick={() => { setU(blank()); setSp({}); }}>{t('Mời người dùng')}</Btn> : null} />
      <div className="g g4">
        <Kpi label="Tài khoản" icon="users" value={nAll ?? '—'} foot="Nội bộ và ngoài" />
        <Kpi label="Tài khoản ngoài" icon="img" value={nExt ?? '—'} foot="Khách hàng, đối tác" />
        <Kpi label="Chờ xác nhận" icon="clock" value={nInv ?? '—'} foot="Lời mời" />
        <Kpi label="Duyệt ngân sách" icon="card" value="Super admin" foot="Không kế thừa" />
      </div>
      <div className="g g21" id="nuCard">
        <div className="card cp">
          <div className="ch"><div><h2>{u.id ? 'Sửa quyền người dùng' : 'Tạo người dùng'}</h2><p>{u.id ? u.email : 'Nhập thông tin, chọn vai trò rồi tinh chỉnh quyền ở bên cạnh.'}</p></div>{u.id ? <Tag tone="info">Đang sửa</Tag> : null}</div>
          <Field label="Họ tên"><input value={u.name} onChange={(e) => setU({ ...u, name: e.target.value })} placeholder="Nguyễn Văn A" readOnly={!!u.id} /></Field>
          <Field label="Email"><input type="email" value={u.email} onChange={(e) => setU({ ...u, email: e.target.value })} placeholder="ten@congty.vn" readOnly={!!u.id} /></Field>
          <Field label="Số điện thoại"><input value={u.phone} onChange={(e) => setU({ ...u, phone: e.target.value })} placeholder="09x xxx xxxx" readOnly={!!u.id} /></Field>
          <Field label="Vai trò" hint={ROLE_HELP[u.role]}><select value={u.role} onChange={(e) => setRole(e.target.value as Role)}>{ROLE_KEYS.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></Field>
          <Field label={`Phạm vi khách hàng ${ext ? '(bắt buộc)' : '(chỉ áp dụng tài khoản ngoài)'}`}>
            <select value={u.customer_id} disabled={!ext} onChange={(e) => setU({ ...u, customer_id: e.target.value })}>
              <option value="">Toàn hệ thống</option>
              {custs.data?.items.map((c) => <option key={c.id} value={c.id}>{c.short_name ?? c.legal_name}</option>)}
            </select>
          </Field>
          {ext ? <Field label="Hết hạn tài khoản (tùy chọn)"><input type="date" value={u.expires_at} onChange={(e) => setU({ ...u, expires_at: e.target.value })} /></Field> : null}
          <div className="note" style={{ margin: '12px 0 0' }}><Icon n="shield" /><span>Hệ thống gửi email mời, liên kết kích hoạt hết hạn sau 72 giờ, bắt buộc bật 2FA{ext ? ' và chỉ thấy dữ liệu của khách hàng được chọn.' : '.'}</span></div>
          {err ? <p role="alert" style={{ color: 'var(--bad)', margin: '10px 0 0' }}>{err}</p> : null}
          <div className="acts" style={{ marginTop: 16 }}>
            <Btn tone="p" disabled={!canWrite} onClick={() => void save()}>{u.id ? 'Lưu thay đổi' : 'Tạo và gửi lời mời'}</Btn>
            <Btn onClick={() => setU((p) => ({ ...p, perms: clampForRole(p.role, structuredClone(ROLE_PRESET[p.role])) }))}>Đặt lại theo vai trò</Btn>
            {u.id ? <Btn onClick={() => { setU(blank()); setSp({}); }}>Hủy sửa</Btn> : null}
          </div>
        </div>
        <div className="card cp">
          <div className="ch"><div><h2>Phân quyền chi tiết</h2><p>{permCount(clampForRole(u.role, u.perms))} / {MODULES.length * 4} quyền được cấp{ext ? ' · tài khoản ngoài chỉ được dùng 3 mô-đun, không có quyền Duyệt' : ''}</p></div></div>
          <PermissionMatrix role={u.role} value={u.perms} onChange={(perms) => setU({ ...u, perms })} readOnly={!canWrite} />
        </div>
      </div>
      <div style={{ height: 18 }} />
      <ServerTable id="mb" endpoint="/admin/v1/users" itemSchema={userSchema} cols={cols} title="Thành viên quản trị" exportName="thanh-vien"
        filters={[{ key: 'role', label: 'Vai trò', options: ROLE_KEYS.map((r) => ({ value: r, label: ROLE_LABEL[r] })) }]}
        bulk={canWrite ? [{ key: 'lock', label: 'Khóa', tone: 'd' }, { key: 'unlock', label: 'Mở khóa' }] : []}
        onBulk={(k, ids, done) => void (async () => { for (const id of ids) await act(() => api.put(`/admin/v1/users/${id}`, { body: { status: k === 'lock' ? 'locked' : 'active' } }), k === 'lock' ? 'Đã khóa.' : 'Đã mở khóa.'); done(); })()} />
      <Note>Quyền được kiểm tra ở máy chủ theo bảng phân quyền và vai trò; tài khoản ngoài còn bị giới hạn theo khách hàng trong mọi truy vấn.</Note>
    </>
  );
}
