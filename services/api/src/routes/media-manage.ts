// m-list: sua metadata (PATCH) + xem tham chieu su dung. Xoa / xoa hang loat dung lai DELETE va POST /bulk-delete co san trong media.ts.
// Moi thao tac di qua mediaScope (IDOR: khach khac => 404).
import { Hono } from 'hono';
import { z } from 'zod';
import type { Runtime } from '@ams/runtime';
import { audit as auditCtx } from '../lib/audit-ctx.js';
import { HttpError, conflict, unprocessable } from '../lib/errors.js';
import { getRt, parseBody } from '../lib/http.js';
import type { Ctx } from '../lib/http.js';
import { checkImportUrl, type LinkSource } from '../lib/creative.js';
import { bumpManifest } from '../lib/manifest.js';
import { bumpContentVersion } from '../lib/creative-security.js';
import { requirePerm } from '../auth/middleware.js';
import { loadMedia, present } from './media.js';
import type { AppEnv } from '../types.js';

/** Chien dich o cac trang thai nay KHONG con dung tep (xoa duoc). Cac trang thai con lai (cho duyet, cho tien, da len lich, dang chay, tam dung) chan xoa. */
const INACTIVE_CAMPAIGN = ['draft', 'rejected'];

export function tagsOf(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export interface MediaRef {
  type: 'campaign';
  id: string;
  name: string | null;
  state: string;
  contract_id: string | null;
  blocking: boolean;
}

/** Nhung noi dang dung creative nay. `blocking` = chien dich dang hoat dong/cho duyet (chan xoa). Hop dong/lich phat di qua chien dich. */
export async function referencesOf(rt: Runtime, m: { id: string; campaign_id: string | null }): Promise<MediaRef[]> {
  if (!m.campaign_id) return [];
  const c = (await rt.db.query<{ id: string; name: string | null; state: string; contract_id: string | null }>('SELECT id, name, state, contract_id FROM campaigns WHERE id = ?', [m.campaign_id]))[0];
  return c ? [{ type: 'campaign', id: c.id, name: c.name, state: c.state, contract_id: c.contract_id, blocking: !INACTIVE_CAMPAIGN.includes(c.state) }] : [];
}

const blockedError = (refs: MediaRef[]) =>
  new HttpError(409, 'in_use', `Không thể đổi đường dẫn: tệp đang được dùng trong ${refs.filter((r) => r.blocking).map((r) => `chiến dịch "${r.name ?? r.id}"`).join(', ')}. Hãy gỡ tệp khỏi chiến dịch trước.`, { references: refs });

const patchBody = z
  .object({
    name: z.string().trim().min(1, 'Nhập tên tệp').max(200),
    description: z.string().trim().max(1000).nullable(),
    tags: z.array(z.string().trim().min(1).max(30)).max(10, 'Tối đa 10 thẻ'),
    duration_sec: z.coerce.number().int().min(1, 'Thời lượng tối thiểu 1 giây').max(3600),
    customer_id: z.string().max(64),
    source_url: z.string().trim().min(8).max(2048),
  })
  .partial()
  .strict();

export function mediaManageRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  // Sua metadata. Doi URL (noi dung) => quay lai cho duyet + tang content_version; ten/mo ta/the/thoi luong anh khong dong cham duyet.
  r.patch('/:id', requirePerm('media', 'write'), async (c) => {
    const rt = getRt(c);
    const u = c.get('user');
    const m = await loadMedia(c, c.req.param('id'));
    const b = await parseBody(c, patchBody);
    if (!Object.keys(b).length) throw unprocessable('Không có thay đổi nào để lưu.', 'nothing_to_update');
    if (m.state === 'uploading') throw conflict('Tệp chưa tải xong, chưa sửa được.', 'invalid_state');
    const refs = await referencesOf(rt, m);
    const inUse = refs.some((x) => x.blocking);
    const set: string[] = [];
    const params: unknown[] = [];
    const diff: Record<string, unknown> = {};
    const put = (col: string, val: unknown, key: string, before: unknown) => { set.push(`${col} = ?`); params.push(val); diff[key] = { from: before, to: val }; };

    if (b.name !== undefined && b.name !== m.name) put('name', b.name, 'name', m.name);
    if (b.description !== undefined && (b.description || null) !== (m.description || null)) put('description', b.description || null, 'description', m.description);
    if (b.tags !== undefined) {
      const tags = [...new Set(b.tags)];
      put('tags', tags.length ? JSON.stringify(tags) : null, 'tags', tagsOf(m.tags));
    }
    if (b.duration_sec !== undefined) {
      const isImage = (m.mime ?? '').startsWith('image/') || m.kind === 'image';
      if (!isImage) throw unprocessable('Chỉ đổi được thời lượng của ảnh; thời lượng video lấy từ chính tệp.', 'duration_fixed');
      if (b.duration_sec !== m.duration_s) put('duration_s', b.duration_sec, 'duration_sec', m.duration_s);
    }
    if (b.customer_id !== undefined && b.customer_id !== m.customer_id) {
      if (u.kind !== 'internal') throw new HttpError(403, 'forbidden', 'Chỉ nhân viên mới chuyển khách hàng sở hữu.');
      if (m.campaign_id) throw conflict('Tệp đang gắn chiến dịch, hãy gỡ khỏi chiến dịch trước khi đổi khách hàng.', 'in_use', { references: refs });
      const cu = (await rt.db.query<{ state: string }>('SELECT state FROM customers WHERE id = ?', [b.customer_id]))[0];
      if (!cu) throw unprocessable('Khách hàng không tồn tại.', 'customer_not_found');
      if (cu.state === 'terminated') throw conflict('Khách hàng đã chấm dứt hợp tác.', 'customer_inactive');
      put('customer_id', b.customer_id, 'customer_id', m.customer_id);
    }
    let contentChanged = false;
    if (b.source_url !== undefined && b.source_url !== m.source_url) {
      if (m.source === 'upload') throw unprocessable('Tệp tải lên không có đường dẫn để sửa. Hãy tải tệp mới.', 'not_a_link');
      if (inUse) throw blockedError(refs);
      const chk = checkImportUrl((m.source === 'gdrive' ? 'drive' : m.source) as LinkSource, b.source_url);
      if (!chk.ok) throw unprocessable(chk.message, 'bad_media_url');
      put('source_url', chk.url.toString(), 'source_url', m.source_url);
      set.push("review_state = 'pending'", "state = 'pending_review'", "scan_state = 'pending'", 'sha256 = NULL', 'review_note = NULL');
      contentChanged = true;
    }
    if (!set.length) return c.json(present(m)); // khong doi gi (idempotent)
    const nowIso = rt.clock.now().toISOString();
    await rt.db.tx(async (db) => {
      const res = await db.run(`UPDATE creatives SET ${set.join(', ')} WHERE id = ?`, [...params, m.id]);
      if (res.changes === 0) throw conflict('Tệp vừa bị xóa.', 'invalid_state');
      let ver: number | undefined;
      if (contentChanged) ver = await bumpContentVersion(db, m.id, nowIso);
      await auditCtx(c, db, { action: 'media.update', objectType: 'creative', objectId: m.id, customerId: m.customer_id, diff: { ...diff, ...(contentChanged ? { content_version: ver, review_reset: true } : {}) } });
    });
    if (m.campaign_id && (contentChanged || b.duration_sec !== undefined)) await bumpManifest(rt);
    return c.json(present(await loadMedia(c, m.id)));
  });

  r.get('/:id/references', requirePerm('media', 'view'), async (c) => {
    const m = await loadMedia(c, c.req.param('id'));
    const refs = await referencesOf(getRt(c), m);
    return c.json({ id: m.id, references: refs, can_delete: !refs.some((x) => x.blocking) });
  });

  return r;
}
