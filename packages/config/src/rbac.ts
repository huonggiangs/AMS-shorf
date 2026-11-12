// RBAC mot nguon: 6 vai tro x 12 mo-dun x 4 hanh dong (PLAN §4). Dung chung API va web.
// Khong phu thuoc @ams/shared de web import duoc nhe; cac hang duoc khai bao lai khop voi shared/types.ts (co test doi chieu).
export const ROLES = ['super_admin', 'content_manager', 'finance', 'device_ops', 'customer', 'partner'] as const;
export type Role = (typeof ROLES)[number];

export const MODULES = [
  'overview', 'devices', 'tv_experience', 'campaigns', 'customers', 'approvals',
  'media', 'screens', 'schedule', 'finance', 'partners', 'admin',
] as const;
export type Module = (typeof MODULES)[number];

export const ACTIONS = ['view', 'write', 'approve', 'delete'] as const;
export type Action = (typeof ACTIONS)[number];

export interface PermRow {
  module: string;
  action: string;
  allowed: boolean | number;
}

type Grant = Partial<Record<Module, readonly Action[]>>;
const V = ['view'] as const;
const VW = ['view', 'write'] as const;
const VWA = ['view', 'write', 'approve'] as const;
const ALL = ['view', 'write', 'approve', 'delete'] as const;

/**
 * Quyen mac dinh theo vai tro (suy ra tu prototype + muc 1.1 dac ta).
 * Ghi chu nghiep vu cho API:
 *  - Duyet ngan sach chien dich (`POST /campaigns/:id/approve`) = campaigns:approve -> chi super_admin.
 *  - Duyet/tra lai media = media:approve -> content_manager co (duoc duyet media, khong duyet ngan sach).
 *  - Xac nhan nap tien thu cong (`POST /topups/:id/confirm`) = finance:approve.
 *  - Nhat ky hoat dong (audit-log GET) = admin:view -> chi super_admin (chat hon prototype, noi finance/device_ops cung xem).
 */
export const ROLE_DEFAULTS: Record<Role, Grant> = {
  super_admin: Object.fromEntries(MODULES.map((m) => [m, ALL])) as Grant,
  content_manager: {
    overview: V, devices: V, tv_experience: V, campaigns: VW, customers: V, approvals: VW,
    media: ALL, screens: VW, schedule: VW,
  },
  finance: {
    overview: V, customers: VW, finance: ALL, partners: V,
  },
  device_ops: {
    overview: V, devices: VW, tv_experience: VW, screens: VW,
  },
  customer: {
    campaigns: VW, media: VW, finance: VW,
  },
  partner: {
    campaigns: V, media: VW,
  },
};

/** Tai khoan ngoai (customer/partner): chi 3 mo-dun, khong bao gio approve/delete, du bi ghi de. */
export const EXTERNAL_ROLES: readonly Role[] = ['customer', 'partner'];
export const EXTERNAL_MODULES: readonly Module[] = ['campaigns', 'media', 'finance'];
export const EXTERNAL_FORBIDDEN_ACTIONS: readonly Action[] = ['approve', 'delete'];

export function isRole(x: unknown): x is Role {
  return typeof x === 'string' && (ROLES as readonly string[]).includes(x);
}
export function isModule(x: unknown): x is Module {
  return typeof x === 'string' && (MODULES as readonly string[]).includes(x);
}
export function isAction(x: unknown): x is Action {
  return typeof x === 'string' && (ACTIONS as readonly string[]).includes(x);
}
export function isExternalRole(role: string): boolean {
  return (EXTERNAL_ROLES as readonly string[]).includes(role);
}

/** Rang buoc cung: ap dung SAU khi ghi de, khong the vuot qua. */
export function externalAllowed(role: string, module: string, action: string): boolean {
  if (!isExternalRole(role)) return true;
  if (!(EXTERNAL_MODULES as readonly string[]).includes(module)) return false;
  if ((EXTERNAL_FORBIDDEN_ACTIONS as readonly string[]).includes(action)) return false;
  // partner khong co mo-dun finance (khong co vi rieng)
  if (role === 'partner' && module === 'finance') return false;
  return true;
}

export function defaultAllows(role: Role, module: Module, action: Action): boolean {
  return (ROLE_DEFAULTS[role][module] ?? []).includes(action);
}

/**
 * Kiem quyen. `permRows` = cac dong admin_permissions cua tai khoan (ghi de mac dinh theo vai tro: allowed 1 cap them, 0 thu hoi).
 * Mac dinh tu choi voi vai tro/mo-dun/hanh dong la.
 */
export function can(permRows: readonly PermRow[] | null | undefined, role: string, module: string, action: string): boolean {
  if (!isRole(role) || !isModule(module) || !isAction(action)) return false;
  let allowed = defaultAllows(role, module, action);
  if (permRows) {
    // dong cuoi cung khop thang (neu trung)
    for (const r of permRows) {
      if (r.module === module && r.action === action) allowed = r.allowed === true || r.allowed === 1;
    }
  }
  return allowed && externalAllowed(role, module, action);
}

/** Ma tran quyen hieu luc cho `GET /auth/me`: { module: [actions] } (chi mo-dun co it nhat mot quyen). */
export function effectivePermissions(permRows: readonly PermRow[] | null | undefined, role: string): Partial<Record<Module, Action[]>> {
  const out: Partial<Record<Module, Action[]>> = {};
  for (const m of MODULES) {
    const acts = ACTIONS.filter((a) => can(permRows, role, m, a));
    if (acts.length) out[m] = [...acts];
  }
  return out;
}

/** Xac thuc mot ban ghi ghi de truoc khi luu: tra ve ly do tu choi hoac null. */
export function validateOverride(role: string, module: string, action: string, allowed: boolean): string | null {
  if (!isRole(role)) return 'vai tro khong hop le';
  if (!isModule(module)) return 'mo-dun khong hop le';
  if (!isAction(action)) return 'hanh dong khong hop le';
  if (allowed && !externalAllowed(role, module, action)) return 'tai khoan ngoai khong duoc cap quyen nay';
  return null;
}
