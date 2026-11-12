// Bootstrap san xuat toi thieu: tenant + cai dat mac dinh + Super admin dau tien (doi mat khau bat buoc, TOTP dang ky khi dang nhap lan dau).
// KHONG tao khach hang, chien dich, thiet bi, hop dong, vi/tien, nhat ky mau. Vai tro/quyen mac dinh nam trong ma (packages/config/rbac.ts),
// khong luu bang, nen khong can nap. Khong bao gio in/log bi mat: mat khau sinh ngau nhien chi tra ve trong ket qua cho CLI quyet dinh (chi local).
import { hashPassword, randomPassword } from '@ams/shared';
import { assertEncKey, assertSepaySafe, isLocalEnv, resolveAmsEnv, SeedRefusedError } from './seed-guard.js';
import type { AmsEnv } from './seed-guard.js';
import { CONTRACT_BODY_DEFAULT } from './seed-contract-template.js';
import type { SeedRuntime } from './types.js';

export interface BootstrapOptions {
  passwordParams?: { N?: number; r?: number; p?: number };
  /** bat buoc o staging/production; local mac dinh admin@ams.local */
  adminEmail?: string;
  adminName?: string;
  /** mat khau ban dau do nguoi van hanh cung cap; khong dat: local sinh ngau nhien, production tu choi */
  adminPassword?: string;
  tenantName?: string;
  tenantTaxCode?: string;
}

export interface BootstrapResult {
  skipped: boolean;
  env: AmsEnv;
  tenantId: string;
  adminId: string;
  adminEmail: string;
  /** chi co khi mat khau duoc SINH tu dong (chi local); CLI chi ghi ra tep local, khong log */
  generatedPassword: string | null;
  mustChangePassword: boolean;
  totpEnrolmentRequired: boolean;
  counts: Record<string, number>;
}

/** Khoa co `settings` danh dau tai khoan phai doi mat khau truoc khi dung tiep (xem ops/agents/d1-seed-prod.requests.md). */
export const FORCE_PW_CHANGE_KEY = (adminId: string) => `force_password_change:${adminId}`;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function checkAdminPassword(pw: string): string | null {
  if (pw.length < 12) return 'Mat khau Super admin phai >= 12 ky tu.';
  if (/CHANGE_ME|change-me|^password|^admin|^12345/i.test(pw)) return 'Mat khau Super admin la gia tri mau/de doan.';
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw)) return 'Mat khau Super admin can chu hoa, chu thuong va chu so.';
  return null;
}

export async function bootstrap(rt: SeedRuntime, opts: BootstrapOptions = {}): Promise<BootstrapResult> {
  const env = rt.config.env;
  const amsEnv = resolveAmsEnv(env);
  const local = isLocalEnv(amsEnv);
  const sepayMode = assertSepaySafe(env);
  assertEncKey(env);

  const email = (opts.adminEmail ?? (local ? 'admin@ams.local' : '')).trim().toLowerCase();
  if (!email) throw new SeedRefusedError('admin_email_missing', 'Thieu email Super admin (BOOTSTRAP_ADMIN_EMAIL).');
  if (!EMAIL_RE.test(email)) throw new SeedRefusedError('admin_email_invalid', 'Email Super admin khong hop le.');
  if (!local && /\.(local|localhost|example|test)$/.test(email)) throw new SeedRefusedError('admin_email_placeholder', 'Email Super admin o staging/production khong duoc la email mau (.local/.example).');

  let password = opts.adminPassword ?? null;
  let generated: string | null = null;
  if (password === null) {
    if (!local) throw new SeedRefusedError('admin_password_missing', 'Production/staging: phai cung cap mat khau Super admin (BOOTSTRAP_ADMIN_PASSWORD, *_FILE hoac nhap khi duoc hoi). Khong tu sinh de tranh lo qua log.');
    generated = password = `${randomPassword(16)}Aa1`;
  } else {
    const bad = checkAdminPassword(password);
    if (bad) throw new SeedRefusedError('admin_password_weak', bad);
  }

  const existing = await rt.db.query<{ n: number }>('SELECT COUNT(*) AS n FROM tenants');
  if (Number(existing[0]?.n) > 0) {
    return { skipped: true, env: amsEnv, tenantId: '', adminId: '', adminEmail: email, generatedPassword: null, mustChangePassword: false, totpEnrolmentRequired: false, counts: {} };
  }

  const now = rt.clock.now().toISOString();
  const tenantId = rt.id();
  const adminId = rt.id();
  const hash = await hashPassword(password, { N: 2 ** 15, ...(opts.passwordParams ?? {}) });
  const counts: Record<string, number> = {};

  await rt.db.tx(async (tx) => {
    const insTx = async (table: string, row: Record<string, unknown>) => {
      const cols = Object.keys(row);
      await tx.run(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, cols.map((c) => row[c]));
      counts[table] = (counts[table] ?? 0) + 1;
    };
    await insTx('tenants', { id: tenantId, name: opts.tenantName ?? env['BOOTSTRAP_TENANT_NAME'] ?? 'AMS', tax_code: opts.tenantTaxCode ?? env['BOOTSTRAP_TENANT_TAX_CODE'] ?? null, created_at: now });
    // Super admin: totp_secret_enc NULL + mfa_required=1 => dang nhap lan dau buoc dang ky TOTP (mfa_enroll_required).
    await insTx('admins', {
      id: adminId, tenant_id: tenantId, email, name: opts.adminName ?? 'Super admin', role: 'super_admin', account_kind: 'internal', customer_id: null, org_name: null,
      status: 'active', password_hash: hash, totp_secret_enc: null, mfa_required: 1, invited_by: null, created_at: now,
    });
    await insTx('settings', { key: FORCE_PW_CHANGE_KEY(adminId), value: JSON.stringify({ reason: 'bootstrap', at: now }), updated_by: 'bootstrap', updated_at: now });
    // Mac dinh an toan: SePay TAT, khong auto-kich-hoat, khong so tai khoan/ngan hang (nhap trong Cai dat > SePay). Bi mat webhook chi lay tu env.
    await insTx('settings', {
      key: 'sepay', updated_by: 'bootstrap', updated_at: now,
      value: JSON.stringify({ enabled: 0, env: sepayMode, auth: 'HMAC-SHA256', webhook_url: env['SEPAY_WEBHOOK_URL'] ?? '', bank: '', account_holder: '', prefix: 'AMS', min_amount_vnd: 5_000_000, auto_activate: 0 }),
    });
    await insTx('settings', { key: 'seller', value: JSON.stringify({ name: opts.tenantName ?? env['BOOTSTRAP_TENANT_NAME'] ?? 'AMS', tax_code: opts.tenantTaxCode ?? env['BOOTSTRAP_TENANT_TAX_CODE'] ?? '', address: '', rep: '', email }), updated_by: 'bootstrap', updated_at: now });
    await insTx('settings', { key: 'bootstrap', value: JSON.stringify({ bootstrapped_at: now, env: amsEnv, demo_data: false }), updated_by: 'bootstrap', updated_at: now });
    await insTx('activation_rules', { id: rt.id(), customer_id: null, min_amount_vnd: 5_000_000, auto_activate: 0, plan_id: null });
    await insTx('contract_templates', { id: rt.id(), name: 'Hợp đồng dịch vụ quảng cáo', version: 1, body_md: CONTRACT_BODY_DEFAULT, variables: JSON.stringify(['seller.*', 'customer.*', 'contract.*']), active: 1 });
    await insTx('audit_log', { id: rt.id(), ts: now, actor_id: null, action: 'bootstrap.super_admin_created', object_type: 'admin', object_id: adminId, customer_id: null, ip: null, diff: JSON.stringify({ env: amsEnv, email }) });
  });

  return { skipped: false, env: amsEnv, tenantId, adminId, adminEmail: email, generatedPassword: generated, mustChangePassword: true, totpEnrolmentRequired: true, counts };
}
