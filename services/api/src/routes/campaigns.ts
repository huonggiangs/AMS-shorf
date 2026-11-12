import { Hono } from 'hono';
import { z } from 'zod';
import { audit as auditCtx } from '../lib/audit-ctx.js';
import { diffObjects } from '../lib/audit.js';
import { trySend, esc } from '../lib/mail.js';
import { conflict, forbidden, notFound, unprocessable } from '../lib/errors.js';
import { eq, eqMapped, getRt, jsonParse, num, parseBody, placeholders, runList, isoDate } from '../lib/http.js';
import type { Ctx, ListSpec, SqlFrag } from '../lib/http.js';
import { campaignScope, mediaScope } from '../lib/scope.js';
import { apiTarget, dbTarget, fitsTarget, parsePx, type TargetType } from '../lib/creative.js';
import { dayEnd, dayStart, isDate, todayVn } from '../lib/dates.js';
import { bumpManifest, ensureDefaultSlot } from '../lib/manifest.js';
import { requirePerm } from '../auth/middleware.js';
import type { AppEnv, AuthUser } from '../types.js';
import type { Db, Runtime } from '@ams/runtime';

const CAMP_SELECT = `c.id, c.name, c.customer_id, c.state, c.budget_cap_vnd, c.approved_budget_vnd, c.reserved_vnd, c.spent_vnd, c.funding_state, c.target_types, c.duration_s,
  c.start_at, c.end_at, c.reject_reason, c.created_at, c.approved_at, cu.payment_code AS customer_code, cu.short_name AS customer_short, adv.name AS advertiser_name, ua.name AS creator_name,
  (SELECT cr.id FROM creatives cr WHERE cr.campaign_id = c.id ORDER BY cr.created_at, cr.id LIMIT 1) AS media_id,
  (SELECT cr.name FROM creatives cr WHERE cr.campaign_id = c.id ORDER BY cr.created_at, cr.id LIMIT 1) AS media_name`;
const CAMP_FROM = `FROM campaigns c JOIN customers cu ON cu.id = c.customer_id LEFT JOIN advertisers adv ON adv.id = c.advertiser_id LEFT JOIN admins ua ON ua.id = c.created_by`;
const PACING = `CASE WHEN c.budget_cap_vnd > 0 THEN (c.spent_vnd * 100) / c.budget_cap_vnd ELSE 0 END`;

export const STATE_TO_API: Record<string, string> = { pending_review: 'pending' };
export const STATE_FROM_API: Record<string, string> = { pending: 'pending_review' };
export const apiState = (s: string) => STATE_TO_API[s] ?? s;

export interface CampRow {
  id: string;
  name: string;
  customer_id: string;
  state: string;
  budget_cap_vnd: number;
  approved_budget_vnd: number;
  reserved_vnd: number;
  spent_vnd: number;
  funding_state: string;
  target_types: string | null;
  duration_s: number | null;
  start_at: string | null;
  end_at: string | null;
  reject_reason: string | null;
  created_at: string;
  approved_at: string | null;
  customer_code: string;
  customer_short: string;
  advertiser_name: string | null;
  creator_name: string | null;
  media_id: string | null;
  media_name: string | null;
}

export function campaignSpec(u: AuthUser, nowIso: string, forceState?: string): ListSpec {
  const scope = campaignScope(u, 'c', nowIso);
  return {
    from: CAMP_FROM,
    select: CAMP_SELECT,
    where: [...(scope ? [scope] : []), ...(forceState ? [{ sql: 'c.state = ?', params: [forceState] }] : [])],
    search: ['c.name', 'adv.name', 'cu.short_name', 'cu.payment_code'],
    sorts: {
      name: 'c.name', budget_vnd: 'c.budget_cap_vnd', pacing_pct: PACING, start_date: 'c.start_at', end_date: 'c.end_at', status: 'c.state', created_at: 'c.created_at',
      customer: 'cu.short_name',
    },
    defaultSort: 'created_at:desc',
    tiebreak: 'c.id',
    filters: {
      status: forceState ? () => null : eqMapped('c.state', STATE_FROM_API),
      customer_id: eq('c.customer_id'),
      screen_type: (v) => ({ sql: 'c.target_types LIKE ?', params: [`%"${v === 'led' ? 'led_p5' : v === 'elevator' ? 'elevator' : 'tv'}"%`] }),
    },
  };
}

export async function presentCampaigns(rt: Runtime, rows: CampRow[], external: boolean): Promise<Record<string, unknown>[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const imp = await rt.db.query<{ campaign_id: string; n: number }>(`SELECT campaign_id, SUM(valid) AS n FROM impression_hourly WHERE campaign_id IN (${placeholders(ids.length)}) GROUP BY campaign_id`, ids);
  const impMap = new Map(imp.map((x) => [x.campaign_id, num(x.n)]));
  let srcMap = new Map<string, string>();
  if (!external) {
    const src = await rt.db.query<{ campaign_id: string; name: string }>(
      `SELECT s.campaign_id, p.name FROM schedule_slots s JOIN partners p ON p.id = s.partner_id WHERE s.campaign_id IN (${placeholders(ids.length)}) ORDER BY s.id`,
      ids,
    );
    srcMap = new Map(src.map((x) => [x.campaign_id, x.name]));
  }
  return rows.map((r) => {
    const budget = num(r.budget_cap_vnd);
    const targets = jsonParse<string[]>(r.target_types, []);
    const out: Record<string, unknown> = {
      id: r.id,
      name: r.name,
      customer_id: r.customer_id,
      customer_code: r.customer_code,
      brand: r.advertiser_name ?? r.customer_short,
      status: apiState(r.state),
      funding_state: r.funding_state,
      screen_type: apiTarget(targets[0]),
      duration_sec: r.duration_s,
      budget_vnd: budget,
      approved_budget_vnd: num(r.approved_budget_vnd),
      reserved_vnd: num(r.reserved_vnd),
      spent_vnd: num(r.spent_vnd),
      start_date: isoDate(r.start_at),
      end_date: isoDate(r.end_at),
      impressions: impMap.get(r.id) ?? 0,
      target_impressions: null,
      creator: r.creator_name,
      media_id: r.media_id,
      media_name: r.media_name,
      pacing_pct: budget > 0 ? Math.min(100, Math.floor((num(r.spent_vnd) * 100) / budget)) : 0,
      reward_per_view: null,
      reject_reason: r.reject_reason,
      created_at: r.created_at,
      approved_at: r.approved_at,
    };
    if (!external) out['source'] = srcMap.get(r.id) ?? 'Trực tiếp';
    return out;
  });
}

async function loadCampaign(c: Ctx, id: string, forWrite = false): Promise<CampRow> {
  const rt = getRt(c);
  const u = c.get('user');
  const scope = campaignScope(u, 'c', rt.clock.now().toISOString());
  const rows = await rt.db.query<CampRow>(`SELECT ${CAMP_SELECT} ${CAMP_FROM} WHERE c.id = ?${scope ? ` AND (${scope.sql})` : ''}`, [id, ...(scope?.params ?? [])]);
  const r = rows[0];
  void forWrite;
  if (!r) throw notFound('Không tìm thấy chiến dịch.'); // ca "khong ton tai" va "cua khach khac" deu 404
  return r;
}

const dateStr = z.string().refine(isDate, 'Ngày phải theo dạng YYYY-MM-DD');
const moneyInt = z.coerce.number().int('Phải là số nguyên (đồng)').min(1, 'Phải lớn hơn 0').max(1e13, 'Quá lớn');

const createBody = z.object({
  name: z.string().trim().min(1, 'Nhập tên chiến dịch').max(200),
  customer_id: z.string().min(1).max(64).optional().nullable(),
  screen_type: z.enum(['tv', 'elevator', 'led']).default('tv'),
  screen_id: z.string().max(64).optional().nullable(),
  media_id: z.string().max(64).optional().nullable(),
  budget_vnd: moneyInt,
  duration_sec: z.coerce.number().int().min(5).max(120).default(15),
  start_date: dateStr.optional().nullable(),
  end_date: dateStr.optional().nullable(),
});
const updateBody = createBody.partial();

async function ledPxOf(db: Db, screenId: string | null | undefined): Promise<{ w: number; h: number } | null> {
  if (!screenId) return null;
  const r = (
    await db.query<{ px_w: number; px_h: number }>(
      "SELECT s.px_w, s.px_h FROM screens s WHERE s.type = 'led_p5' AND (s.id = ? OR s.venue_id = ?) ORDER BY s.id LIMIT 1",
      [screenId, screenId],
    )
  )[0];
  return r ? { w: num(r.px_w), h: num(r.px_h) } : null;
}

/** Gan media (thu vien cua khach) vao chien dich; kiem tra khop loai man hinh. */
async function attachMedia(c: Ctx, db: Db, campaignId: string, customerId: string, mediaId: string, target: TargetType, screenId: string | null | undefined): Promise<void> {
  const rt = getRt(c);
  const u = c.get('user');
  const nowIso = rt.clock.now().toISOString();
  const ms = mediaScope(u, 'm', nowIso);
  const m = (
    await db.query<{ id: string; customer_id: string; campaign_id: string | null; name: string | null; px_w: number | null; px_h: number | null; review_state: string; state: string }>(
      `SELECT m.id, m.customer_id, m.campaign_id, m.name, m.px_w, m.px_h, m.review_state, m.state FROM creatives m WHERE m.id = ?${ms ? ` AND (${ms.sql})` : ''}`,
      [mediaId, ...(ms?.params ?? [])],
    )
  )[0];
  if (!m || m.customer_id !== customerId) throw notFound('Không tìm thấy tệp media.');
  if (m.review_state === 'rejected' || m.review_state === 'returned') throw unprocessable('Tệp media đã bị trả lại, hãy tải tệp khác.', 'media_rejected');
  if (m.state === 'uploading') throw unprocessable('Tệp media chưa tải xong.', 'media_not_ready');
  const w = num(m.px_w);
  const h = num(m.px_h);
  if (w && h) {
    const led = target === 'led_p5' ? await ledPxOf(db, screenId) : null;
    const fit = fitsTarget(target, w, h, { ledPx: led });
    if (!fit.ok) throw unprocessable(fit.message, 'creative_size_mismatch');
  }
  const dup = await db.query('SELECT 1 FROM creatives WHERE campaign_id = ? AND target_type = ? AND px_w = ? AND px_h = ?', [campaignId, target, w || null, h || null]);
  if (dup.length) throw conflict('Chiến dịch đã có tệp cho loại màn/độ phân giải này.', 'creative_duplicate');
  if (m.campaign_id === null) {
    await db.run('UPDATE creatives SET campaign_id = ?, target_type = ? WHERE id = ? AND campaign_id IS NULL', [campaignId, target, m.id]);
  } else {
    await db.run(
      `INSERT INTO creatives (id, campaign_id, customer_id, name, target_type, px_w, px_h, orientation, kind, source, source_url, storage_key, mime, size_bytes, duration_s, codec, uploaded_by, uploader_kind, scan_state, review_state, review_note, state, sha256, format, overlay, created_at)
       SELECT ?, ?, customer_id, name, ?, px_w, px_h, orientation, kind, source, source_url, storage_key, mime, size_bytes, duration_s, codec, uploaded_by, uploader_kind, scan_state, review_state, review_note, state, sha256, format, overlay, ?
         FROM creatives WHERE id = ?`,
      [rt.id(), campaignId, target, nowIso, m.id],
    );
  }
}

const releaseIfFunded = async (c: Ctx, row: CampRow, reason: string) => {
  const rt = getRt(c);
  if (row.funding_state === 'reserved' || num(row.reserved_vnd) > 0) {
    const fin = await c.get('finance')();
    return fin.releaseForCampaign(rt, { campaignId: row.id, actorId: c.get('user').id, reason });
  }
  return { released_vnd: 0 };
};

async function emailCampaignOwner(rt: Runtime, row: CampRow, subject: string, htmlBody: string): Promise<void> {
  const to = (await rt.db.query<{ email: string | null }>('SELECT email FROM customers WHERE id = ?', [row.customer_id]))[0]?.email;
  if (to && /@/.test(to)) await trySend(rt, { to, subject, html: htmlBody, text: htmlBody.replace(/<[^>]+>/g, '') });
}

export function campaignRoutes(external: boolean): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get('/', requirePerm('campaigns', 'view'), async (c) => {
    const rt = getRt(c);
    const res = await runList<CampRow>(c, campaignSpec(c.get('user'), rt.clock.now().toISOString()));
    return c.json({ ...res, items: await presentCampaigns(rt, res.items, external) });
  });

  r.get('/:id', requirePerm('campaigns', 'view'), async (c) => {
    const row = await loadCampaign(c, c.req.param('id'));
    return c.json((await presentCampaigns(getRt(c), [row], external))[0]);
  });

  r.post('/', requirePerm('campaigns', 'write'), async (c) => {
    const rt = getRt(c);
    const u = c.get('user');
    const b = await parseBody(c, createBody);
    const customerId = external ? u.customerId : b.customer_id;
    if (!customerId) throw unprocessable('Chọn khách hàng.', 'customer_required');
    const cu = (await rt.db.query<{ id: string; state: string; short_name: string }>('SELECT id, state, short_name FROM customers WHERE id = ?', [customerId]))[0];
    if (!cu) throw external ? notFound() : unprocessable('Khách hàng không tồn tại.', 'customer_not_found');
    if (cu.state === 'terminated') throw conflict('Khách hàng đã chấm dứt hợp tác.', 'customer_inactive');
    const start = b.start_date ?? todayVn(rt);
    if (b.end_date && b.end_date < start) throw unprocessable('Ngày kết thúc phải sau ngày bắt đầu.', 'bad_dates');
    const target = dbTarget(b.screen_type);
    if (target === 'led_p5' && b.screen_id && !(await ledPxOf(rt.db, b.screen_id))) throw unprocessable('Bảng LED không tồn tại.', 'screen_not_found');
    const id = rt.id();
    const nowIso = rt.clock.now().toISOString();
    await rt.db.tx(async (db) => {
      await db.run(
        `INSERT INTO campaigns (id, customer_id, name, state, budget_cap_vnd, approved_budget_vnd, reserved_vnd, spent_vnd, funding_state, activate_on_approve, target_types, duration_s, start_at, end_at, created_by, created_at, updated_at)
         VALUES (?,?,?,'draft',?,0,0,0,'none',1,?,?,?,?,?,?,?)`,
        [id, customerId, b.name, b.budget_vnd, JSON.stringify([target]), b.duration_sec, dayStart(start), b.end_date ? dayEnd(b.end_date) : null, u.id, nowIso, nowIso],
      );
      if (b.media_id) await attachMedia(c, db, id, customerId, b.media_id, target, b.screen_id);
      await auditCtx(c, db, { action: 'campaign.create', objectType: 'campaign', objectId: id, customerId, diff: { name: b.name, budget_vnd: b.budget_vnd, screen_type: b.screen_type, media_id: b.media_id ?? null } });
    });
    return c.json((await presentCampaigns(rt, [await loadCampaign(c, id)], external))[0], 201);
  });

  r.put('/:id', requirePerm('campaigns', 'write'), async (c) => {
    const rt = getRt(c);
    const row = await loadCampaign(c, c.req.param('id'), true);
    if (!['draft', 'rejected'].includes(row.state)) throw conflict('Chỉ sửa được chiến dịch ở trạng thái bản nháp hoặc bị trả lại.', 'invalid_state');
    const b = await parseBody(c, updateBody);
    const start = b.start_date ?? isoDate(row.start_at) ?? todayVn(rt);
    const end = b.end_date === null ? null : (b.end_date ?? isoDate(row.end_at));
    if (end && end < start) throw unprocessable('Ngày kết thúc phải sau ngày bắt đầu.', 'bad_dates');
    const target = b.screen_type ? dbTarget(b.screen_type) : (jsonParse<string[]>(row.target_types, ['tv'])[0] as TargetType);
    const next = {
      name: b.name ?? row.name,
      budget_cap_vnd: b.budget_vnd ?? num(row.budget_cap_vnd),
      duration_s: b.duration_sec ?? row.duration_s,
      start_at: dayStart(start),
      end_at: end ? dayEnd(end) : null,
      target_types: JSON.stringify([target]),
    };
    await rt.db.tx(async (db) => {
      const res = await db.run(
        `UPDATE campaigns SET name = ?, budget_cap_vnd = ?, duration_s = ?, start_at = ?, end_at = ?, target_types = ?, updated_at = ? WHERE id = ? AND state IN ('draft','rejected')`,
        [next.name, next.budget_cap_vnd, next.duration_s, next.start_at, next.end_at, next.target_types, rt.clock.now().toISOString(), row.id],
      );
      if (res.changes === 0) throw conflict('Chiến dịch vừa đổi trạng thái, hãy tải lại.', 'invalid_state');
      if (b.media_id) await attachMedia(c, db, row.id, row.customer_id, b.media_id, target, b.screen_id);
      await auditCtx(c, db, {
        action: 'campaign.update', objectType: 'campaign', objectId: row.id, customerId: row.customer_id,
        diff: { ...diffObjects({ name: row.name, budget_cap_vnd: num(row.budget_cap_vnd), duration_s: row.duration_s, start_at: row.start_at, end_at: row.end_at, target_types: row.target_types }, next), ...(b.media_id ? { media_id: { from: null, to: b.media_id } } : {}) },
      });
    });
    return c.json((await presentCampaigns(rt, [await loadCampaign(c, row.id)], external))[0]);
  });

  r.post('/:id/submit', requirePerm('campaigns', 'write'), async (c) => {
    const rt = getRt(c);
    const row = await loadCampaign(c, c.req.param('id'), true);
    if (!['draft', 'rejected'].includes(row.state)) throw conflict('Chỉ gửi duyệt được chiến dịch ở trạng thái bản nháp hoặc bị trả lại.', 'invalid_state');
    if (num(row.budget_cap_vnd) <= 0) throw unprocessable('Ngân sách phải lớn hơn 0.', 'budget_required');
    const cust = (await rt.db.query<{ state: string }>('SELECT state FROM customers WHERE id = ?', [row.customer_id]))[0];
    if (cust?.state === 'terminated') throw conflict('Khách hàng đã chấm dứt hợp tác.', 'customer_inactive');
    await rt.db.tx(async (db) => {
      const res = await db.run(`UPDATE campaigns SET state = 'pending_review', reject_reason = NULL, updated_at = ? WHERE id = ? AND state IN ('draft','rejected')`, [rt.clock.now().toISOString(), row.id]);
      if (res.changes === 0) throw conflict('Chiến dịch vừa đổi trạng thái, hãy tải lại.', 'invalid_state');
      await auditCtx(c, db, { action: 'campaign.submit', objectType: 'campaign', objectId: row.id, customerId: row.customer_id, diff: { state: { from: row.state, to: 'pending_review' } } });
    });
    return c.json((await presentCampaigns(rt, [await loadCampaign(c, row.id)], external))[0]);
  });

  r.post('/:id/pause', requirePerm('campaigns', 'write'), async (c) => {
    const rt = getRt(c);
    const row = await loadCampaign(c, c.req.param('id'), true);
    if (!['active', 'scheduled'].includes(row.state)) throw conflict('Chỉ tạm dừng được chiến dịch đang phát hoặc đã lên lịch.', 'invalid_state');
    await rt.db.tx(async (db) => {
      const res = await db.run(`UPDATE campaigns SET state = 'paused', updated_at = ? WHERE id = ? AND state IN ('active','scheduled')`, [rt.clock.now().toISOString(), row.id]);
      if (res.changes === 0) throw conflict('Chiến dịch vừa đổi trạng thái, hãy tải lại.', 'invalid_state');
      await auditCtx(c, db, { action: 'campaign.pause', objectType: 'campaign', objectId: row.id, customerId: row.customer_id, diff: { state: { from: row.state, to: 'paused' } } });
    });
    await bumpManifest(rt);
    return c.json((await presentCampaigns(rt, [await loadCampaign(c, row.id)], external))[0]);
  });

  r.post('/:id/resume', requirePerm('campaigns', 'write'), async (c) => {
    const rt = getRt(c);
    const u = c.get('user');
    const row = await loadCampaign(c, c.req.param('id'), true);
    if (row.state !== 'paused') throw conflict('Chỉ tiếp tục được chiến dịch đang tạm dừng.', 'invalid_state');
    if (external) {
      // khach chi tiep tuc duoc chien dich do chinh ben khach tam dung; admin tam dung thi chi admin mo lai
      const last = (
        await rt.db.query<{ account_kind: string }>(
          `SELECT a.account_kind FROM audit_log l JOIN admins a ON a.id = l.actor_id
            WHERE l.object_type = 'campaign' AND l.object_id = ? AND l.action = 'campaign.pause' ORDER BY l.ts DESC, l.id DESC LIMIT 1`,
          [row.id],
        )
      )[0];
      if (!last || last.account_kind === 'internal') throw forbidden('Chiến dịch được quản trị viên tạm dừng, chỉ quản trị viên mới tiếp tục được.', 'paused_by_admin');
    }
    void u;
    const nowIso = rt.clock.now().toISOString();
    const next = row.funding_state === 'reserved' ? (row.start_at && row.start_at > nowIso ? 'scheduled' : 'active') : 'awaiting_funds';
    await rt.db.tx(async (db) => {
      const res = await db.run(`UPDATE campaigns SET state = ?, updated_at = ? WHERE id = ? AND state = 'paused'`, [next, nowIso, row.id]);
      if (res.changes === 0) throw conflict('Chiến dịch vừa đổi trạng thái, hãy tải lại.', 'invalid_state');
      await auditCtx(c, db, { action: 'campaign.resume', objectType: 'campaign', objectId: row.id, customerId: row.customer_id, diff: { state: { from: 'paused', to: next } } });
    });
    await bumpManifest(rt);
    return c.json((await presentCampaigns(rt, [await loadCampaign(c, row.id)], external))[0]);
  });

  if (external) return r;

  // ===== chi quan tri =====
  r.post('/:id/approve', requirePerm('campaigns', 'approve'), async (c) => {
    const rt = getRt(c);
    const u = c.get('user');
    const row = await loadCampaign(c, c.req.param('id'), true);
    if (row.state !== 'pending_review') throw conflict('Chỉ duyệt được chiến dịch đang chờ duyệt.', 'invalid_state');
    const cust = (await rt.db.query<{ state: string }>('SELECT state FROM customers WHERE id = ?', [row.customer_id]))[0];
    if (!cust || ['paused', 'terminated'].includes(cust.state)) throw conflict('Khách hàng đang tạm dừng hoặc đã chấm dứt hợp tác, không thể duyệt.', 'customer_inactive');
    if (num(row.budget_cap_vnd) <= 0) throw unprocessable('Ngân sách phải lớn hơn 0.', 'budget_required');
    const creatives = await rt.db.query<{ id: string; review_state: string }>("SELECT id, review_state FROM creatives WHERE campaign_id = ? AND review_state NOT IN ('rejected','returned')", [row.id]);
    if (!creatives.length) throw unprocessable('Chiến dịch chưa có tệp creative hợp lệ. Hãy gắn tệp media trước khi duyệt.', 'no_creative');
    const nowIso = rt.clock.now().toISOString();
    // 1) danh dau da duyet nguyen tu (chong hai nguoi duyet cung luc); tien do FinancePort lo, thieu tien thi o lai awaiting_funds
    await rt.db.tx(async (db) => {
      const res = await db.run(
        `UPDATE campaigns SET state = 'awaiting_funds', funding_state = 'awaiting_funds', approved_budget_vnd = budget_cap_vnd, approved_by = ?, approved_at = ?, reject_reason = NULL, updated_at = ?
          WHERE id = ? AND state = 'pending_review'`,
        [u.id, nowIso, nowIso, row.id],
      );
      if (res.changes === 0) throw conflict('Chiến dịch vừa được người khác xử lý.', 'invalid_state');
      const ap = await db.run("UPDATE creatives SET review_state = 'approved', state = CASE WHEN state = 'uploading' THEN state ELSE 'ready' END, review_note = NULL WHERE campaign_id = ? AND review_state = 'pending'", [row.id]);
      // manifest chi phat chien dich co lich: tao lich ca ngay mac dinh neu admin chua xep lich rieng
      await ensureDefaultSlot(rt, db, row.id, jsonParse<string[]>(row.target_types, ['tv'])[0] ?? 'tv');
      await auditCtx(c, db, {
        action: 'campaign.approve', objectType: 'campaign', objectId: row.id, customerId: row.customer_id,
        diff: { approved_budget_vnd: num(row.budget_cap_vnd), creatives_approved: ap.changes },
      });
    });
    // 2) giu tien (a2): idempotent; loi tai chinh khong lam mat viec da duyet
    let status: string = 'awaiting_funds';
    let reserved = 0;
    let shortfall = num(row.budget_cap_vnd);
    let warning: string | undefined;
    try {
      const fin = await c.get('finance')();
      const rr = await fin.reserveForCampaign(rt, { campaignId: row.id, actorId: u.id });
      status = rr.campaign_state;
      reserved = rr.reserved_vnd;
      shortfall = rr.shortfall_vnd;
    } catch (e) {
      console.error('[campaign.approve] reserveForCampaign loi:', (e as Error).name);
      warning = 'Đã duyệt nhưng chưa giữ được tiền từ ví (lỗi tạm thời); hệ thống sẽ tự thử lại khi ví đủ.';
    }
    await bumpManifest(rt);
    const message = warning ?? (status === 'awaiting_funds' ? `Đã duyệt nhưng ví thiếu ${shortfall.toLocaleString('vi-VN')} ₫. Quảng cáo tự chạy sau khi nạp đủ.` : `Đã duyệt, đã giữ ${reserved.toLocaleString('vi-VN')} ₫ từ ví.`);
    await emailCampaignOwner(rt, row, `Chiến dịch "${row.name}" đã được duyệt`, `<p>Chiến dịch <b>${esc(row.name)}</b> đã được duyệt (${esc(status)}).</p>`);
    return c.json({ status, reserved_vnd: reserved, shortfall_vnd: shortfall, message, ...(warning ? { warning } : {}) });
  });

  r.post('/:id/reject', requirePerm('campaigns', 'approve'), async (c) => {
    const rt = getRt(c);
    const u = c.get('user');
    const row = await loadCampaign(c, c.req.param('id'), true);
    const b = await parseBody(c, z.object({ reason: z.string().trim().min(3, 'Nhập lý do (tối thiểu 3 ký tự)').max(500) }));
    if (!['pending_review', 'awaiting_funds', 'scheduled', 'active', 'paused'].includes(row.state)) throw conflict('Không thể trả lại chiến dịch ở trạng thái này.', 'invalid_state');
    const wasApproved = row.state !== 'pending_review';
    if (wasApproved) await releaseIfFunded(c, row, 'thu hồi duyệt'); // hoan phan giu chua dung truoc khi doi trang thai
    const nowIso = rt.clock.now().toISOString();
    await rt.db.tx(async (db) => {
      const res = await db.run(
        `UPDATE campaigns SET state = 'rejected', reject_reason = ?, approved_budget_vnd = 0, approved_by = NULL, approved_at = NULL, funding_state = CASE WHEN funding_state = 'none' THEN 'none' ELSE 'released' END, updated_at = ? WHERE id = ? AND state = ?`,
        [b.reason, nowIso, row.id, row.state],
      );
      if (res.changes === 0) throw conflict('Chiến dịch vừa đổi trạng thái, hãy tải lại.', 'invalid_state');
      await auditCtx(c, db, { action: 'campaign.reject', objectType: 'campaign', objectId: row.id, customerId: row.customer_id, diff: { state: { from: row.state, to: 'rejected' }, reason: b.reason, revoked: wasApproved } });
    });
    await bumpManifest(rt);
    void u;
    await emailCampaignOwner(rt, row, `Chiến dịch "${row.name}" cần chỉnh sửa`, `<p>Chiến dịch <b>${esc(row.name)}</b> được trả lại.</p><p>Lý do: ${esc(b.reason)}</p>`);
    return c.json((await presentCampaigns(rt, [await loadCampaign(c, row.id)], external))[0]);
  });

  r.post('/:id/end', requirePerm('campaigns', 'approve'), async (c) => {
    const rt = getRt(c);
    const row = await loadCampaign(c, c.req.param('id'), true);
    if (!['awaiting_funds', 'scheduled', 'active', 'paused'].includes(row.state)) throw conflict('Không thể kết thúc chiến dịch ở trạng thái này.', 'invalid_state');
    const rel = await releaseIfFunded(c, row, 'kết thúc chiến dịch');
    await rt.db.tx(async (db) => {
      const res = await db.run(`UPDATE campaigns SET state = 'ended', funding_state = CASE WHEN funding_state = 'none' THEN 'none' ELSE 'released' END, updated_at = ? WHERE id = ? AND state = ?`, [rt.clock.now().toISOString(), row.id, row.state]);
      if (res.changes === 0) throw conflict('Chiến dịch vừa đổi trạng thái, hãy tải lại.', 'invalid_state');
      await auditCtx(c, db, { action: 'campaign.end', objectType: 'campaign', objectId: row.id, customerId: row.customer_id, diff: { released_vnd: rel.released_vnd } });
    });
    await bumpManifest(rt);
    return c.json({ ...(await presentCampaigns(rt, [await loadCampaign(c, row.id)], external))[0], released_vnd: rel.released_vnd });
  });

  r.delete('/:id', requirePerm('campaigns', 'delete'), async (c) => {
    const rt = getRt(c);
    const row = await loadCampaign(c, c.req.param('id'), true);
    if (!['draft', 'rejected', 'pending_review', 'awaiting_funds'].includes(row.state)) throw conflict('Chỉ xóa được chiến dịch bản nháp, bị trả lại, chờ duyệt hoặc chờ nạp tiền. Chiến dịch đã chạy hãy kết thúc.', 'invalid_state');
    await releaseIfFunded(c, row, 'xóa chiến dịch');
    await rt.db.tx(async (db) => {
      await db.run('DELETE FROM schedule_slots WHERE campaign_id = ?', [row.id]);
      await db.run('DELETE FROM campaign_grants WHERE campaign_id = ?', [row.id]);
      await db.run('UPDATE creatives SET campaign_id = NULL WHERE campaign_id = ?', [row.id]); // giu lai thu vien media
      const res = await db.run('DELETE FROM campaigns WHERE id = ? AND state = ?', [row.id, row.state]);
      if (res.changes === 0) throw conflict('Chiến dịch vừa đổi trạng thái, hãy tải lại.', 'invalid_state');
      await auditCtx(c, db, { action: 'campaign.delete', objectType: 'campaign', objectId: row.id, customerId: row.customer_id, diff: { name: row.name, state: row.state } });
    });
    await bumpManifest(rt);
    return c.json({ ok: true });
  });

  return r;
}

export type { SqlFrag };
