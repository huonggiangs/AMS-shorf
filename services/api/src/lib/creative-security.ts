// p2-security: rang buoc phien ban noi dung (R1-14) + kid_safe/man khoa co cau truc (R4-N5) + chinh sach tre em an toan mac dinh.
// Bang phu `creative_security` (migration 0008): khong co dong = content_version 1, kid_safe 0, lock_context 0, chua rang buoc phien ban.
import type { Db } from '@ams/runtime';
import { parseOverlay, sha256Hex } from '@ams/shared';
import { conflict, unprocessable } from './errors.js';
import { jsonParse } from './http.js';

export interface CreativeSec {
  content_version: number;
  approved_version: number | null;
  approved_hash: string | null;
  kid_safe: number;
  lock_context: number;
}

export async function getCreativeSec(db: Db, id: string): Promise<CreativeSec> {
  const r = (await db.query<Record<string, unknown>>('SELECT content_version, approved_version, approved_hash, kid_safe, lock_context FROM creative_security WHERE creative_id = ?', [id]))[0];
  return r
    ? { content_version: Number(r['content_version']), approved_version: r['approved_version'] === null ? null : Number(r['approved_version']), approved_hash: (r['approved_hash'] as string | null) ?? null, kid_safe: Number(r['kid_safe']), lock_context: Number(r['lock_context']) }
    : { content_version: 1, approved_version: null, approved_hash: null, kid_safe: 0, lock_context: 0 };
}

/** Dau van tay noi dung duoc duyet: tep (sha256, neu chua co thi khoa+kich thuoc), dinh dang, overlay. */
export async function contentHash(c: { sha256?: string | null; storage_key?: string | null; size_bytes?: unknown; source_url?: string | null; format?: string | null; overlay?: string | null }): Promise<string> {
  return sha256Hex(JSON.stringify([c.sha256 ?? `${c.storage_key ?? c.source_url ?? ''}:${c.size_bytes ?? ''}`, c.format ?? 'fullscreen', c.overlay ?? null]));
}

/** Noi dung doi (tep/dinh dang/overlay): tang content_version. Tra ve phien ban moi. */
export async function bumpContentVersion(db: Db, id: string, nowIso: string): Promise<number> {
  await db.run(
    `INSERT INTO creative_security (creative_id, content_version, updated_at) VALUES (?, 2, ?)
     ON CONFLICT (creative_id) DO UPDATE SET content_version = creative_security.content_version + 1, updated_at = excluded.updated_at`,
    [id, nowIso],
  );
  return (await getCreativeSec(db, id)).content_version;
}

/** Cot kid_safe / lock_context tu overlay JSON (parse co cau truc, khong LIKE). */
export function kidFlagsOf(overlayJson: string | null | undefined): { kid_safe: 0 | 1; lock_context: 0 | 1 } {
  if (!overlayJson) return { kid_safe: 0, lock_context: 0 };
  const r = parseOverlay(jsonParse<unknown>(overlayJson, null), { reviewerFields: 'keep' });
  const o = r.ok && r.value ? r.value : {};
  return { kid_safe: o.kid_safe === true ? 1 : 0, lock_context: o.contexts?.includes('lock') ? 1 : 0 };
}

export async function syncKidFlags(db: Db, id: string, overlayJson: string | null | undefined, nowIso: string): Promise<void> {
  const f = kidFlagsOf(overlayJson);
  await db.run(
    `INSERT INTO creative_security (creative_id, content_version, kid_safe, lock_context, updated_at) VALUES (?, 1, ?, ?, ?)
     ON CONFLICT (creative_id) DO UPDATE SET kid_safe = excluded.kid_safe, lock_context = excluded.lock_context, updated_at = excluded.updated_at`,
    [id, f.kid_safe, f.lock_context, nowIso],
  );
}

/** Ghi nhan duyet gan voi phien ban + dau van tay hien tai. */
export async function recordApproval(db: Db, row: { id: string; sha256?: string | null; storage_key?: string | null; size_bytes?: unknown; source_url?: string | null; format?: string | null; overlay?: string | null }, nowIso: string): Promise<{ version: number; hash: string }> {
  const sec = await getCreativeSec(db, row.id);
  const hash = await contentHash(row);
  await db.run(
    `INSERT INTO creative_security (creative_id, content_version, approved_version, approved_hash, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (creative_id) DO UPDATE SET approved_version = excluded.approved_version, approved_hash = excluded.approved_hash, updated_at = excluded.updated_at`,
    [row.id, sec.content_version, sec.content_version, hash, nowIso],
  );
  return { version: sec.content_version, hash };
}

/** Nguoi duyet da xem phien ban `expected`; noi dung da doi => 409 (R1-14). */
export async function assertContentVersion(db: Db, id: string, expected: number | undefined): Promise<void> {
  if (expected === undefined) return;
  const cur = (await getCreativeSec(db, id)).content_version;
  if (cur !== expected) throw conflict('Nội dung tệp đã thay đổi kể từ lúc bạn xem. Hãy tải lại và xem lại trước khi duyệt.', 'content_changed', { expected_version: expected, current_version: cur });
}

// ---------- chinh sach tre em (mac dinh AN TOAN) ----------
// Quang cao tren man khoa / man hinh tre em: TAT tru khi quan tri co quyen bat ro rang (settings.tv_experience.lock_ads_enabled = true).
// May chu cuong che o 3 cho: (a) luc dat ngu canh 'lock' (tv-experience), (b) luc duyet creative/chien dich, (c) luc xay manifest (edge-gateway).
export const KID_POLICY_BLOCK_CODE = 'lock_ads_disabled';

export async function lockAdsEnabled(db: Db): Promise<boolean> {
  const raw = (await db.query<{ value: string }>("SELECT value FROM settings WHERE key = 'tv_experience'"))[0]?.value;
  const v = jsonParse<{ lock_ads_enabled?: unknown } | null>(raw, null);
  return v?.lock_ads_enabled === true;
}

/** 422 neu creative co ngu canh 'lock' ma quang cao man khoa dang tat. */
export async function assertLockPolicy(db: Db, overlayJson: string | null | undefined, details?: unknown): Promise<void> {
  if (!kidFlagsOf(overlayJson).lock_context) return;
  if (await lockAdsEnabled(db)) return;
  throw unprocessable('Quảng cáo ở màn khóa/màn hình trẻ em đang TẮT (mặc định an toàn). Bỏ ngữ cảnh "lock" khỏi creative hoặc để quản trị cấp cao bật trong Trải nghiệm TV.', KID_POLICY_BLOCK_CODE, details);
}
