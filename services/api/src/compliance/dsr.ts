// Quyen cua chu the du lieu (Nghi dinh 13/2023/ND-CP): xuat du lieu ca nhan (JSON) + an danh theo yeu cau, GIU so cai bat bien
// (wallet_entries, wallet_ledger, payouts, audit_log) vi nghia vu ke toan/chung minh. Bang luu giu su kien ev_* xoa theo chinh sach luu giu (retention).
import type { Db, Runtime } from '@ams/runtime';
import { ANONYMIZED_NAME, anonymizedEmail, maskValue } from '@ams/shared';
import { writeAudit } from '../lib/audit.js';
import { AAD, decField } from '../lib/crypto.js';
import { conflict, notFound } from '../lib/errors.js';

export type SubjectType = 'customer_contact' | 'end_user';
interface Actor {
  id: string | null;
  ip: string;
}
const LIMIT = 5000;

interface AdminRow {
  id: string;
  email: string;
  name: string;
  role: string;
  account_kind: string;
  customer_id: string | null;
  org_name: string | null;
  status: string;
  phone: string | null;
  created_at: string;
  last_login_at: string | null;
}

/** Xac dinh chu the khach hang: id tai khoan cong (admins) hoac id lien he (customer_contacts). */
async function resolveContact(db: Db, id: string): Promise<{ admin: AdminRow | null; contact: Record<string, unknown> | null }> {
  const admin = (await db.query<AdminRow>('SELECT id, email, name, role, account_kind, customer_id, org_name, status, phone, created_at, last_login_at FROM admins WHERE id = ?', [id]))[0] ?? null;
  const contact = (await db.query<Record<string, unknown>>('SELECT id, customer_id, name, title, phone, email, is_primary FROM customer_contacts WHERE id = ?', [id]))[0] ?? null;
  if (!admin && !contact) throw notFound('Không tìm thấy chủ thể dữ liệu.');
  if (admin && admin.account_kind === 'internal') throw conflict('Tài khoản nội bộ không thuộc phạm vi yêu cầu của chủ thể dữ liệu khách hàng. Xử lý theo quy trình nhân sự.', 'internal_account');
  return { admin, contact };
}

export interface ExportResult {
  exported_at: string;
  subject_type: SubjectType;
  subject_id: string;
  data: Record<string, unknown>;
  counts: Record<string, number>;
}

/** Xuat toan bo du lieu ca nhan cua mot chu the. Khong chua bi mat dang nhap (hash mat khau, TOTP), khong chua du lieu cua nguoi khac. */
export async function exportSubject(rt: Runtime, type: SubjectType, id: string): Promise<ExportResult> {
  const db = rt.db;
  const data: Record<string, unknown> = {};
  const counts: Record<string, number> = {};
  const put = (k: string, rows: unknown[]) => {
    data[k] = rows;
    counts[k] = rows.length;
  };
  if (type === 'customer_contact') {
    const { admin, contact } = await resolveContact(db, id);
    if (admin) {
      data['account'] = admin;
      put('sessions', await db.query('SELECT id, ip, user_agent, created_at, last_seen_at, revoked_at FROM sessions WHERE admin_id = ? ORDER BY created_at DESC LIMIT ?', [id, LIMIT]));
      put('notifications', await db.query('SELECT id, kind, title, body, created_at FROM notifications WHERE admin_id = ? ORDER BY created_at DESC LIMIT ?', [id, LIMIT]));
      put('legal_acceptances', await db.query('SELECT id, kind, version, sha256, accepted_at, ip, user_agent FROM legal_acceptances WHERE admin_id = ? ORDER BY accepted_at', [id]));
      put('audit_actions', await db.query('SELECT ts, action, object_type, object_id, ip FROM audit_log WHERE actor_id = ? ORDER BY ts DESC LIMIT ?', [id, LIMIT]));
      put('invites', await db.query('SELECT id, role, created_at, accepted_at FROM invites WHERE admin_id = ?', [id]));
    }
    if (contact) data['contact'] = contact;
    put('consent_records', await db.query('SELECT purpose, granted, version, source, created_at FROM consent_records WHERE subject_type = ? AND subject_id = ? ORDER BY created_at', [type, id]));
  } else {
    const u = (await db.query<{ id: string; phone_hash: string | null; email_enc: string | null; display_name: string | null; created_at: string }>('SELECT id, phone_hash, email_enc, display_name, created_at FROM end_users WHERE id = ?', [id]))[0];
    if (!u) throw notFound('Không tìm thấy chủ thể dữ liệu.');
    let email: string | null = null;
    if (u.email_enc) {
      try {
        email = await decField(rt, u.email_enc, 'end_users.email');
      } catch {
        email = null;
      }
    }
    data['profile'] = { id: u.id, display_name: u.display_name, email, phone_registered: !!u.phone_hash, created_at: u.created_at };
    const devices = await db.query<{ id: string }>('SELECT id, name, kind, model, os, app_version, region_id, paired_at, last_seen_at, created_at FROM devices WHERE user_id = ?', [id]);
    put('devices', devices);
    const ids = devices.map((d) => d.id);
    if (ids.length) {
      const ph = ids.map(() => '?').join(',');
      put('ad_impressions', await db.query(`SELECT ts, event_id, device_id, campaign_id, creative_id, valid, reward_vnd FROM ev_ad_impression WHERE device_id IN (${ph}) ORDER BY ts DESC LIMIT ?`, [...ids, LIMIT]));
    } else counts['ad_impressions'] = 0;
    put('reward_wallet_ledger', await db.query('SELECT id, kind, amount_vnd, ref_type, ref_id, status, created_at FROM wallet_ledger WHERE user_id = ? ORDER BY created_at', [id]));
    put('payouts', await db.query('SELECT id, amount_vnd, channel, status, requested_at, paid_at FROM payouts WHERE user_id = ? ORDER BY requested_at', [id]));
    put('consent_records', await db.query('SELECT purpose, granted, version, source, created_at FROM consent_records WHERE subject_type = ? AND subject_id = ? ORDER BY created_at', [type, id]));
  }
  return { exported_at: rt.clock.now().toISOString(), subject_type: type, subject_id: id, data, counts };
}

export interface AnonymizeResult {
  already: boolean;
  changed: Record<string, number>;
  retained: string[];
}

/** An danh nguoi dung cuoi (end_users): xoa ten/so dien thoai(bam)/email, go lien ket thiet bi. So cai thuong (wallet_ledger/payouts) GIU NGUYEN. Idempotent. */
async function anonymizeEndUser(rt: Runtime, id: string, a: Actor): Promise<AnonymizeResult> {
  const u = (await rt.db.query<{ id: string; display_name: string | null; phone_hash: string | null; email_enc: string | null }>('SELECT id, display_name, phone_hash, email_enc FROM end_users WHERE id = ?', [id]))[0];
  if (!u) throw notFound('Không tìm thấy chủ thể dữ liệu.');
  const already = u.display_name === ANONYMIZED_NAME && !u.phone_hash && !u.email_enc;
  const changed: Record<string, number> = {};
  if (!already) {
    await rt.db.tx(async (db) => {
      changed['end_users'] = (await db.run('UPDATE end_users SET display_name = ?, phone_hash = NULL, email_enc = NULL WHERE id = ?', [ANONYMIZED_NAME, id])).changes;
      changed['devices_unlinked'] = (await db.run('UPDATE devices SET user_id = NULL WHERE user_id = ?', [id])).changes;
      await writeAudit(db, { rt, ip: a.ip, actorId: a.id }, { action: 'compliance.dsr.anonymize', objectType: 'end_user', objectId: id, diff: { fields: ['display_name', 'phone_hash', 'email_enc'], devices_unlinked: changed['devices_unlinked'] } });
    });
  }
  return { already, changed, retained: ['wallet_ledger', 'payouts', 'audit_log'] };
}

/** An danh tai khoan/lien he khach hang: ten, email, SDT, ten to chuc, bo ma 2 lop, thu hoi phien, xoa thong bao/loi moi. Chung tu (audit, chap nhan dieu khoan, hoa don) GIU. Idempotent. */
async function anonymizeContact(rt: Runtime, id: string, a: Actor): Promise<AnonymizeResult> {
  const { admin, contact } = await resolveContact(rt.db, id);
  const already = (!admin || admin.name === ANONYMIZED_NAME) && (!contact || contact['name'] === ANONYMIZED_NAME);
  const changed: Record<string, number> = {};
  if (!already) {
    const now = rt.clock.now().toISOString();
    await rt.db.tx(async (db) => {
      if (admin) {
        changed['admins'] = (await db.run("UPDATE admins SET name = ?, email = ?, phone = NULL, org_name = NULL, status = 'disabled', password_hash = NULL, totp_secret_enc = NULL WHERE id = ?", [ANONYMIZED_NAME, anonymizedEmail(admin.id), admin.id])).changes;
        changed['sessions_revoked'] = (await db.run('UPDATE sessions SET revoked_at = COALESCE(revoked_at, ?), ip = NULL, user_agent = NULL WHERE admin_id = ?', [now, admin.id])).changes;
        changed['notifications_deleted'] = (await db.run('DELETE FROM notifications WHERE admin_id = ?', [admin.id])).changes;
        changed['invites_deleted'] = (await db.run('DELETE FROM invites WHERE admin_id = ?', [admin.id])).changes;
        await db.run('DELETE FROM mfa WHERE admin_id = ?', [admin.id]);
        await db.run('DELETE FROM settings WHERE key = ?', [`force_password_change:${admin.id}`]);
      }
      if (contact) changed['customer_contacts'] = (await db.run('UPDATE customer_contacts SET name = ?, title = NULL, phone = NULL, email = NULL WHERE id = ?', [ANONYMIZED_NAME, id])).changes;
      await writeAudit(db, { rt, ip: a.ip, actorId: a.id }, { action: 'compliance.dsr.anonymize', objectType: 'customer_contact', objectId: id, customerId: admin?.customer_id ?? (contact?.['customer_id'] as string | undefined) ?? null, diff: { had_account: !!admin, had_contact: !!contact, masked_email: maskValue(admin?.email) } });
    });
  }
  return { already, changed, retained: ['audit_log', 'legal_acceptances', 'invoices', 'wallet_entries'] };
}

export const anonymizeSubject = (rt: Runtime, type: SubjectType, id: string, a: Actor): Promise<AnonymizeResult> => (type === 'end_user' ? anonymizeEndUser(rt, id, a) : anonymizeContact(rt, id, a));
