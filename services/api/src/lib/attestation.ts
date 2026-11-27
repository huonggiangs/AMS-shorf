// Cam ket phap ly noi dung (migration 0029). May chu KHONG BAO GIO tu ky: chi ghi khi request co attest.accepted === true
// tu nguoi dung that co quyen media:approve; luu nguoi ky, thoi diem, phien ban van bang, kid_safe do nguoi ky chon, bam IP/UA.
import { z } from 'zod';
import type { Db, Runtime } from '@ams/runtime';
import { ATTESTED_BY_MAX, LEGAL_ATTESTATION_VERSION, sha256Hex, type AttestationStatus } from '@ams/shared';
import { can } from '@ams/config';
import { conflict, forbidden } from './errors.js';
import { getCreativeSec } from './creative-security.js';
import { writeAudit } from './audit.js';
import type { Ctx } from './http.js';
import type { AuthUser } from '../types.js';

export const attestInputSchema = z.object({
  accepted: z.literal(true, { errorMap: () => ({ message: 'Phải tick ô cam kết pháp lý thì mới ký xác nhận được.' }) }),
  version: z.string().trim().min(1).max(32),
  kid_safe: z.boolean().optional(),
});
export type AttestBody = z.infer<typeof attestInputSchema>;

/** Chi nguoi noi bo CO quyen media:approve (can() o may chu) moi ky duoc; khach/doi tac khong bao gio. */
export function assertMayAttest(u: Pick<AuthUser, 'kind' | 'perms' | 'role'>): void {
  if (u.kind !== 'internal' || !can(u.perms, u.role, 'media', 'approve')) throw forbidden('Chỉ người có quyền duyệt nội dung mới được ký cam kết pháp lý.', 'attest_forbidden', { module: 'media', action: 'approve' });
}

/** 409 neu nguoi dung ky van ban cu (UI phai tai lai van ban hien hanh). */
export function assertAttestVersion(a: AttestBody): void {
  if (a.version !== LEGAL_ATTESTATION_VERSION) throw conflict('Văn bản cam kết đã được cập nhật. Hãy tải lại trang để đọc và xác nhận văn bản mới.', 'legal_version_mismatch', { expected: LEGAL_ATTESTATION_VERSION, got: a.version });
}

export interface AttestRow {
  id: string;
  creative_id: string;
  content_version: number;
  version: string;
  kid_safe: number;
  signed_by: string;
  signed_by_name: string;
  signed_at: string;
  source: string;
  revoked_at: string | null;
  revoked_by: string | null;
  revoked_reason: string | null;
}

const COLS = 'id, creative_id, content_version, version, kid_safe, signed_by, signed_by_name, signed_at, source, revoked_at, revoked_by, revoked_reason';

/** Dong cam ket moi nhat chua thu hoi (co the da cu so voi content_version hien tai). */
export async function latestAttestation(db: Db, creativeId: string): Promise<AttestRow | null> {
  return (await db.query<AttestRow>(`SELECT ${COLS} FROM creative_attestations WHERE creative_id = ? AND revoked_at IS NULL ORDER BY signed_at DESC, id DESC LIMIT 1`, [creativeId]))[0] ?? null;
}

export async function attestationStatus(db: Db, creativeId: string): Promise<{ status: AttestationStatus; row: AttestRow | null }> {
  const row = await latestAttestation(db, creativeId);
  if (!row) return { status: 'missing', row: null };
  const cur = (await getCreativeSec(db, creativeId)).content_version;
  return { status: Number(row.content_version) === cur ? 'valid' : 'stale', row };
}

export async function attestationHistory(db: Db, creativeId: string): Promise<AttestRow[]> {
  return db.query<AttestRow>(`SELECT ${COLS} FROM creative_attestations WHERE creative_id = ? ORDER BY signed_at DESC, id DESC LIMIT 200`, [creativeId]);
}

export const SIGN_SOURCES = ['approve', 'upload', 'late', 'bulk', 'campaign'] as const;
export type SignSource = (typeof SIGN_SOURCES)[number];

async function hashed(label: string, v: string | null | undefined): Promise<string | null> {
  if (!v || v === 'unknown') return null;
  return (await sha256Hex(`ams-attest:${label}:${v}`)).slice(0, 32);
}

/** Ghi mot cam ket (chi them). Goi TRONG giao dich cung voi viec duyet. `u` la nguoi dung that dang dang nhap. */
export async function recordAttestation(
  db: Db,
  rt: Runtime,
  c: Ctx,
  u: Pick<AuthUser, 'id' | 'name' | 'email'>,
  creative: { id: string; customer_id: string | null },
  a: AttestBody,
  source: SignSource,
  nowIso: string,
): Promise<{ id: string; content_version: number; kid_safe: 0 | 1 }> {
  assertAttestVersion(a);
  const sec = await getCreativeSec(db, creative.id);
  const id = rt.id();
  const kid: 0 | 1 = a.kid_safe === true ? 1 : 0;
  const display = (u.name?.trim() || u.email || u.id).slice(0, 120);
  await db.run(
    `INSERT INTO creative_attestations (id, creative_id, content_version, version, kid_safe, signed_by, signed_by_name, signed_at, source, ip_hash, ua_hash)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id, creative.id, sec.content_version, a.version, kid, u.id, display, nowIso, source, await hashed('ip', c.get('ip')), await hashed('ua', c.req.header('user-agent') ?? null)],
  );
  await writeAudit(db, { rt, ip: c.get('ip'), actorId: u.id }, {
    action: 'media.attest', objectType: 'creative', objectId: creative.id, customerId: creative.customer_id,
    diff: { version: a.version, content_version: sec.content_version, kid_safe: kid === 1, source, signed_by: u.id },
  });
  return { id, content_version: sec.content_version, kid_safe: kid };
}

/** Vo hieu cac cam ket cu (thu hoi duyet / tra lai). Khong xoa dong, chi dat revoked_at. */
export async function revokeAttestations(db: Db, rt: Runtime, creativeIds: string[], by: string | null, reason: string, nowIso: string, audit?: { ip: string; customerId?: string | null }): Promise<number> {
  let n = 0;
  for (const id of creativeIds) {
    const r = await db.run('UPDATE creative_attestations SET revoked_at = ?, revoked_by = ?, revoked_reason = ? WHERE creative_id = ? AND revoked_at IS NULL', [nowIso, by, reason, id]);
    if (r.changes > 0) {
      n += r.changes;
      if (audit) await writeAudit(db, { rt, ip: audit.ip, actorId: by }, { action: 'media.attest_revoke', objectType: 'creative', objectId: id, customerId: audit.customerId ?? null, diff: { reason, count: r.changes } });
    }
  }
  return n;
}

/** attested_by cho TV: 1..64 ky tu. */
export const attestedByFor = (name: string, id: string): string => ((name.trim() || id).slice(0, ATTESTED_BY_MAX));

export function presentAttestation(r: AttestRow | null, status: AttestationStatus) {
  return {
    status,
    version: r?.version ?? null,
    kid_safe: r ? r.kid_safe === 1 : false,
    signed_by: r?.signed_by ?? null,
    signed_by_name: r?.signed_by_name ?? null,
    signed_at: r?.signed_at ?? null,
    source: r?.source ?? null,
    content_version: r ? Number(r.content_version) : null,
  };
}
