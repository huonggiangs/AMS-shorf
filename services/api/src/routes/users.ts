import { Hono } from 'hono';
import { z } from 'zod';
import { ACTIONS, MODULES, ROLES, can, defaultAllows, isExternalRole, validateOverride } from '@ams/config';
import type { Action, Module, PermRow, Role } from '@ams/config';
import type { Db, Runtime } from '@ams/runtime';
import { audit as auditCtx } from '../lib/audit-ctx.js';
import { diffObjects } from '../lib/audit.js';
import { hashToken, newToken } from '../lib/crypto.js';
import { conflict, forbidden, notFound, unprocessable } from '../lib/errors.js';
import { eq, getRt, jsonParse, num, parseBody, runList } from '../lib/http.js';
import type { Ctx, ListSpec } from '../lib/http.js';
import { appUrl, inviteMail, trySend } from '../lib/mail.js';
import { isDate } from '../lib/dates.js';
import { revokeAllSessions, loadPerms } from '../auth/session.js';
import type { AdminProfile } from '../auth/session.js';
import { requirePerm } from '../auth/middleware.js';
import type { AppEnv, AuthUser } from '../types.js';

type Perms = Partial<Record<Module, Action[]>>;

const U_SELECT = `a.id, a.name, a.email, a.role, a.account_kind, a.customer_id, a.status, a.last_login_at, a.created_at, cu.short_name AS customer_name, a.phone AS phone, a.expires_at AS expires_at,
  (SELECT COUNT(*) FROM admin_permissions ap WHERE ap.admin_id = a.id) AS perm_count`;
const U_FROM = "FROM admins a LEFT JOIN customers cu ON cu.id = a.customer_id";

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  account_kind: string;
  customer_id: string | null;
  status: string;
  last_login_at: string | null;
  created_at: string;
  customer_name: string | null;
  phone: string | null;
  expires_at: string | null;
  perm_count: number;
}

const present = (u: UserRow) => {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone ?? null,
    role: u.role,
    account_kind: u.account_kind,
    customer_id: u.customer_id,
    customer_name: u.customer_name,
    status: u.status,
    expires_at: u.expires_at ?? null,
    last_login_at: u.last_login_at,
    perm_count: num(u.perm_count),
    created_at: u.created_at,
  };
};

const spec: ListSpec = {
  from: U_FROM,
  select: U_SELECT,
  search: ['a.name', 'a.email', 'cu.short_name'],
  sorts: { name: 'a.name', email: 'a.email', role: 'a.role', status: 'a.status', created_at: 'a.created_at', last_login_at: 'a.last_login_at' },
  defaultSort: 'created_at:desc',
  tiebreak: 'a.id',
  filters: {
    role: eq('a.role'),
    status: eq('a.status'),
    customer_id: eq('a.customer_id'),
    kind: (v) => ({ sql: 'a.account_kind = ?', params: [v] }),
    scope: (v) => (v === 'external' ? { sql: "a.account_kind <> 'internal'", params: [] } : v === 'internal' ? { sql: "a.account_kind = 'internal'", params: [] } : null),
  },
};

const permsSchema = z.record(z.string(), z.array(z.string()));

/** Chuyen ma tran { module: [actions] } thanh cac dong ghi de so voi mac dinh vai tro; kiem tra hop le. */
export function overridesFrom(role: string, perms: Record<string, string[]>): { module: Module; action: Action; allowed: boolean }[] {
  const want = new Set<string>();
  for (const [m, acts] of Object.entries(perms)) {
    if (!(MODULES as readonly string[]).includes(m)) throw unprocessable(`Mô-đun không hợp lệ: ${m}.`, 'bad_permission');
    for (const a of acts) {
      if (!(ACTIONS as readonly string[]).includes(a)) throw unprocessable(`Hành động không hợp lệ: ${a}.`, 'bad_permission');
      want.add(`${m}:${a}`);
    }
  }
  const out: { module: Module; action: Action; allowed: boolean }[] = [];
  for (const m of MODULES) {
    for (const a of ACTIONS) {
      const allowed = want.has(`${m}:${a}`);
      if (allowed === defaultAllows(role as Role, m, a)) continue;
      const bad = validateOverride(role, m, a, allowed);
      if (bad) throw unprocessable(`Không thể cấp quyền ${m}:${a}: ${bad}.`, 'bad_permission');
      out.push({ module: m, action: a, allowed });
    }
  }
  return out;
}

/** Chong leo thang: nguoi thao tac chi cap duoc quyen ma chinh ho dang co; chi super_admin cap vai tro super_admin. */
function guardEscalation(actor: AuthUser, role: string, overrides: { module: Module; action: Action; allowed: boolean }[]): void {
  if (actor.role === 'super_admin') return;
  if (role === 'super_admin') throw forbidden('Chỉ Super Admin được cấp vai trò Super Admin.', 'escalation');
  for (const o of overrides) {
    if (o.allowed && !can(actor.perms as PermRow[], actor.role, o.module, o.action)) throw forbidden(`Bạn không thể cấp quyền ${o.module}:${o.action} vì chính bạn không có.`, 'escalation');
  }
}

async function sendInvite(rt: Runtime, db: Db, a: { id: string; email: string; name: string; role: string; external: boolean }, invitedBy: string): Promise<{ sent: boolean; sendLater: () => Promise<boolean> }> {
  const t = await newToken();
  const nowIso = rt.clock.now().toISOString();
  await db.run('INSERT INTO invites (id, admin_id, email, role, token_hash, invited_by, expires_at, created_at) VALUES (?,?,?,?,?,?,?,?)', [rt.id(), a.id, a.email, a.role, t.hash, invitedBy, new Date(rt.clock.now().getTime() + 72 * 3600_000).toISOString(), nowIso]);
  const link = `${appUrl(rt, a.external)}/activate?token=${encodeURIComponent(t.token)}`;
  const m = inviteMail(link, a.name, a.role);
  // gui thu sau khi giao dich da cam: tranh gui thu cho thao tac bi hoan lai
  return { sent: false, sendLater: () => trySend(rt, { to: a.email, ...m }) };
}

async function loadUser(c: Ctx, id: string): Promise<UserRow> {
  const r = (await getRt(c).db.query<UserRow>(`SELECT ${U_SELECT} ${U_FROM} WHERE a.id = ?`, [id]))[0];
  if (!r) throw notFound('Không tìm thấy tài khoản.');
  return r;
}

async function saveProfile(db: Db, _rt: Runtime, id: string, patch: AdminProfile, _by: string): Promise<void> {
  if (patch.phone !== undefined) await db.run('UPDATE admins SET phone = ? WHERE id = ?', [patch.phone, id]);
  if (patch.expires_at !== undefined) await db.run('UPDATE admins SET expires_at = ? WHERE id = ?', [patch.expires_at, id]);
}

export function userRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get('/', requirePerm('admin', 'view'), async (c) => {
    const res = await runList<UserRow>(c, spec);
    return c.json({ ...res, items: res.items.map(present) });
  });
  r.get('/:id', requirePerm('admin', 'view'), async (c) => c.json(present(await loadUser(c, c.req.param('id')))));

  r.post('/', requirePerm('admin', 'write'), async (c) => {
    const rt = getRt(c);
    const actor = c.get('user');
    const b = await parseBody(
      c,
      z.object({
        name: z.string().trim().min(1, 'Nhập họ tên').max(200),
        email: z.string().trim().toLowerCase().email('Email không hợp lệ').max(254),
        phone: z.string().trim().max(30).optional().nullable(),
        role: z.enum(ROLES),
        customer_id: z.string().max(64).optional().nullable(),
        expires_at: z.string().optional().nullable(),
        permissions: permsSchema.optional(),
      }),
    );
    const external = isExternalRole(b.role);
    if (external && !b.customer_id) throw unprocessable('Tài khoản ngoài bắt buộc chọn phạm vi khách hàng.', 'customer_required');
    if (!external && b.customer_id) throw unprocessable('Tài khoản nội bộ không gắn khách hàng.', 'customer_forbidden');
    if (b.expires_at && !isDate(b.expires_at.slice(0, 10))) throw unprocessable('Ngày hết hạn không hợp lệ.', 'bad_date');
    if (external) {
      const cu = (await rt.db.query<{ state: string }>('SELECT state FROM customers WHERE id = ?', [b.customer_id!]))[0];
      if (!cu) throw unprocessable('Khách hàng không tồn tại.', 'customer_not_found');
      if (cu.state === 'terminated') throw conflict('Khách hàng đã chấm dứt hợp đồng.', 'customer_terminated');
    }
    const overrides = overridesFrom(b.role, b.permissions ?? {});
    // khong gui `permissions` = dung mac dinh vai tro
    const useOverrides = b.permissions ? overrides : [];
    guardEscalation(actor, b.role, useOverrides);
    if ((await rt.db.query('SELECT 1 AS x FROM admins WHERE email = ?', [b.email])).length) throw conflict('Email đã được dùng cho một tài khoản khác.', 'email_taken');
    const id = rt.id();
    const nowIso = rt.clock.now().toISOString();
    let later: (() => Promise<boolean>) | null = null;
    await rt.db.tx(async (db) => {
      await db.run(
        `INSERT INTO admins (id, tenant_id, email, name, role, account_kind, customer_id, status, mfa_required, invited_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [id, actor.tenantId, b.email, b.name, b.role, external ? (b.role === 'partner' ? 'partner' : 'customer') : 'internal', b.customer_id ?? null, 'invited', external ? 1 : 0, actor.id, nowIso],
      );
      for (const o of useOverrides) await db.run('INSERT INTO admin_permissions (admin_id, module, action, allowed, updated_by, updated_at) VALUES (?,?,?,?,?,?)', [id, o.module, o.action, o.allowed ? 1 : 0, actor.id, nowIso]);
      if (b.phone || b.expires_at) await saveProfile(db, rt, id, { phone: b.phone ?? null, expires_at: b.expires_at ? (b.expires_at.length === 10 ? `${b.expires_at}T23:59:59.999Z` : b.expires_at) : null }, actor.id);
      later = (await sendInvite(rt, db, { id, email: b.email, name: b.name, role: b.role, external }, actor.id)).sendLater;
      await auditCtx(c, db, { action: 'user.invite', objectType: 'admin', objectId: id, customerId: b.customer_id ?? null, diff: { role: b.role, customer_id: b.customer_id ?? null, overrides: useOverrides.length } });
    });
    const sent = later ? await (later as () => Promise<boolean>)() : false;
    return c.json({ ...present(await loadUser(c, id)), invite_sent: sent }, 201);
  });

  r.post('/:id/resend-invite', requirePerm('admin', 'write'), async (c) => {
    const rt = getRt(c);
    const u = await loadUser(c, c.req.param('id'));
    if (u.status !== 'invited') throw conflict('Tài khoản đã kích hoạt, không cần gửi lại lời mời.', 'not_invited');
    let later: (() => Promise<boolean>) | null = null;
    await rt.db.tx(async (db) => {
      await db.run('UPDATE invites SET expires_at = ? WHERE admin_id = ? AND accepted_at IS NULL', [rt.clock.now().toISOString(), u.id]);
      later = (await sendInvite(rt, db, { id: u.id, email: u.email, name: u.name, role: u.role, external: u.account_kind !== 'internal' }, c.get('user').id)).sendLater;
      await auditCtx(c, db, { action: 'user.resend_invite', objectType: 'admin', objectId: u.id, customerId: u.customer_id });
    });
    return c.json({ ok: true, invite_sent: later ? await (later as () => Promise<boolean>)() : false });
  });

  r.put('/:id', requirePerm('admin', 'write'), async (c) => {
    const rt = getRt(c);
    const actor = c.get('user');
    const u = await loadUser(c, c.req.param('id'));
    const b = await parseBody(
      c,
      z.object({
        name: z.string().trim().min(1).max(200).optional(),
        phone: z.string().trim().max(30).nullable().optional(),
        role: z.enum(ROLES).optional(),
        customer_id: z.string().max(64).nullable().optional(),
        expires_at: z.string().nullable().optional(),
        status: z.enum(['active', 'locked']).optional(),
      }),
    );
    const self = u.id === actor.id;
    if (self && (b.role !== undefined || b.status !== undefined || b.customer_id !== undefined)) throw forbidden('Không thể tự thay đổi vai trò, phạm vi hoặc trạng thái của chính mình.', 'self_modify');
    if (u.role === 'super_admin' && actor.role !== 'super_admin') throw forbidden('Chỉ Super Admin được sửa tài khoản Super Admin.', 'escalation');
    const role = b.role ?? u.role;
    const external = isExternalRole(role);
    if (external !== (u.account_kind !== 'internal')) throw unprocessable('Không thể chuyển tài khoản giữa nhóm nội bộ và nhóm ngoài. Hãy tạo tài khoản mới.', 'kind_change');
    const customerId = b.customer_id !== undefined ? b.customer_id : u.customer_id;
    if (external && !customerId) throw unprocessable('Tài khoản ngoài bắt buộc chọn phạm vi khách hàng.', 'customer_required');
    if (!external && customerId) throw unprocessable('Tài khoản nội bộ không gắn khách hàng.', 'customer_forbidden');
    if (customerId && customerId !== u.customer_id) {
      if (!(await rt.db.query('SELECT 1 AS x FROM customers WHERE id = ?', [customerId])).length) throw unprocessable('Khách hàng không tồn tại.', 'customer_not_found');
    }
    if (b.status && u.status === 'invited') throw conflict('Tài khoản chưa kích hoạt.', 'invalid_state');
    let roleOverrides: { module: Module; action: Action; allowed: boolean }[] = [];
    if (b.role && b.role !== u.role) {
      guardEscalation(actor, b.role, []);
      // doi vai tro: xoa cac ghi de cu (da tinh cho vai tro cu) de khong mang theo quyen ngoai y muon
      roleOverrides = [];
    }
    if (b.expires_at && !isDate(b.expires_at.slice(0, 10))) throw unprocessable('Ngày hết hạn không hợp lệ.', 'bad_date');
    const nowIso = rt.clock.now().toISOString();
    await rt.db.tx(async (db) => {
      await db.run('UPDATE admins SET name = ?, role = ?, customer_id = ?, status = ?, failed_logins = CASE WHEN ? = \'active\' THEN 0 ELSE failed_logins END, locked_until = CASE WHEN ? = \'active\' THEN NULL ELSE locked_until END WHERE id = ?', [
        b.name ?? u.name,
        role,
        customerId ?? null,
        b.status ?? u.status,
        b.status ?? u.status,
        b.status ?? u.status,
        u.id,
      ]);
      if (b.role && b.role !== u.role) {
        await db.run('DELETE FROM admin_permissions WHERE admin_id = ?', [u.id]);
        for (const o of roleOverrides) await db.run('INSERT INTO admin_permissions (admin_id, module, action, allowed, updated_by, updated_at) VALUES (?,?,?,?,?,?)', [u.id, o.module, o.action, 1, actor.id, nowIso]);
      }
      const prof: AdminProfile = {};
      if (b.phone !== undefined) prof.phone = b.phone;
      if (b.expires_at !== undefined) prof.expires_at = b.expires_at ? (b.expires_at.length === 10 ? `${b.expires_at}T23:59:59.999Z` : b.expires_at) : null;
      if (Object.keys(prof).length) await saveProfile(db, rt, u.id, prof, actor.id);
      await auditCtx(c, db, {
        action: b.status === 'locked' ? 'user.lock' : b.status === 'active' && u.status === 'locked' ? 'user.unlock' : 'user.update',
        objectType: 'admin',
        objectId: u.id,
        customerId: u.customer_id,
        diff: diffObjects({ name: u.name, role: u.role, customer_id: u.customer_id, status: u.status }, { name: b.name, role: b.role, customer_id: b.customer_id, status: b.status, ...(b.expires_at !== undefined ? { expires_at: b.expires_at } : {}), ...(b.phone !== undefined ? { phone: '***' } : {}) }),
      });
    });
    // khoa hoac doi vai tro: thu hoi phien dang mo de co hieu luc ngay
    if (b.status === 'locked' || (b.role && b.role !== u.role)) await revokeAllSessions(rt, u.id);
    return c.json(present(await loadUser(c, u.id)));
  });

  return r;
}

export function permissionRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get('/:adminId', requirePerm('admin', 'view'), async (c) => {
    const rt = getRt(c);
    const u = await loadUser(c, c.req.param('adminId'));
    const rows = await loadPerms(rt, u.id);
    const out: Perms = {};
    for (const m of MODULES) {
      const acts = ACTIONS.filter((a) => can(rows, u.role, m, a));
      if (acts.length) out[m] = [...acts];
    }
    return c.json({ admin_id: u.id, role: u.role, permissions: out });
  });

  r.put('/:adminId', requirePerm('admin', 'write'), async (c) => {
    const rt = getRt(c);
    const actor = c.get('user');
    const u = await loadUser(c, c.req.param('adminId'));
    if (u.id === actor.id) throw forbidden('Không thể tự thay đổi quyền của chính mình.', 'self_modify');
    if (u.role === 'super_admin' && actor.role !== 'super_admin') throw forbidden('Chỉ Super Admin được sửa quyền của Super Admin.', 'escalation');
    const b = await parseBody(c, z.object({ permissions: permsSchema }));
    const overrides = overridesFrom(u.role, b.permissions);
    guardEscalation(actor, u.role, overrides);
    const before = await loadPerms(rt, u.id);
    const nowIso = rt.clock.now().toISOString();
    await rt.db.tx(async (db) => {
      await db.run('DELETE FROM admin_permissions WHERE admin_id = ?', [u.id]);
      for (const o of overrides) await db.run('INSERT INTO admin_permissions (admin_id, module, action, allowed, updated_by, updated_at) VALUES (?,?,?,?,?,?)', [u.id, o.module, o.action, o.allowed ? 1 : 0, actor.id, nowIso]);
      await auditCtx(c, db, { action: 'permissions.update', objectType: 'admin', objectId: u.id, customerId: u.customer_id, diff: { before: before.map((x) => `${x.module}:${x.action}=${x.allowed ? 1 : 0}`), after: overrides.map((x) => `${x.module}:${x.action}=${x.allowed ? 1 : 0}`) } });
    });
    await revokeAllSessions(rt, u.id).catch(() => undefined);
    const rows = await loadPerms(rt, u.id);
    const out: Perms = {};
    for (const m of MODULES) {
      const acts = ACTIONS.filter((a) => can(rows, u.role, m, a));
      if (acts.length) out[m] = [...acts];
    }
    return c.json({ admin_id: u.id, role: u.role, permissions: out });
  });

  return r;
}
