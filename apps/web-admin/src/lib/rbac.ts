import { ACTIONS, EXTERNAL_MODULES, EXTERNAL_ROLES, MODULES, type Action, type Module, type Permissions, type Role } from '../api/schemas';

export const MODULE_LABEL: Record<Module, string> = {
  overview: 'Tổng quan', devices: 'Thiết bị', tv_experience: 'Trải nghiệm trên TV', campaigns: 'Quảng cáo & chiến dịch',
  customers: 'Khách hàng & hợp đồng', approvals: 'Phê duyệt', media: 'Nội dung & Media', screens: 'Màn hình thang máy & LED',
  schedule: 'Lịch phát', finance: 'Tài chính & ví', partners: 'Đối tác & API', admin: 'Người dùng, phân quyền & nhật ký',
};
export const ACTION_LABEL: Record<Action, string> = { view: 'Xem', write: 'Tạo/Sửa', approve: 'Duyệt', delete: 'Xóa/Xuất' };

export const isExternalRole = (r: string) => EXTERNAL_ROLES.includes(r);

/** Is a cell locked for this role? External accounts: only 3 modules, never approve/delete. */
export const isLocked = (role: string, m: Module, a: Action): boolean =>
  isExternalRole(role) && (!EXTERNAL_MODULES.includes(m) || a === 'approve' || a === 'delete');

const all = (): Permissions => Object.fromEntries(MODULES.map((m) => [m, [...ACTIONS]])) as Permissions;
const P = (o: Partial<Record<Module, string>>): Permissions => {
  const map: Record<string, Action> = { v: 'view', t: 'write', d: 'approve', x: 'delete' };
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, [...(v as string)].map((c) => map[c]!)])) as Permissions;
};
/**
 * Default matrix per role (display/reset only; the server is authoritative).
 * TODO: replace with the shared table in packages/config/rbac.ts once exposed to the web app.
 */
export const ROLE_PRESET: Record<Role, Permissions> = {
  super_admin: all(),
  content_manager: P({ overview: 'v', devices: 'v', campaigns: 'vt', customers: 'v', approvals: 'v', media: 'vtdx', screens: 'vt', schedule: 'vt' }),
  finance: P({ overview: 'v', customers: 'vtx', finance: 'vtdx', partners: 'v', admin: 'v' }),
  device_ops: P({ overview: 'v', devices: 'vtx', screens: 'vtx', admin: 'v' }),
  customer: P({ campaigns: 'vt', media: 'vt', finance: 'vt' }),
  partner: P({ campaigns: 'v', media: 'vt' }),
};

export const permCount = (p: Permissions) => Object.values(p).reduce((n, a) => n + (a?.length ?? 0), 0);
export const clampForRole = (role: string, p: Permissions): Permissions => {
  const out: Permissions = {};
  for (const m of MODULES) {
    const a = (p[m] ?? []).filter((x) => !isLocked(role, m, x));
    if (a.length) out[m] = a;
  }
  return out;
};
