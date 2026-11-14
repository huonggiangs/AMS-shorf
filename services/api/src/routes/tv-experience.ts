// Trai nghiem tren TV (ung dung Brain-rot): cau hinh man khoa/quang cao + duyet kid_safe cho creative.overlay.
// Tai lieu: docs/TV-APP-INTEGRATION.md muc 2(c) va 8.1. Moi quyen kiem o may chu (packages/config/rbac.ts):
//  - xem: tv_experience:view; sua cai dat/ngu canh khong phai man khoa/thoi luong/vung an toan: tv_experience:write
//  - dat kid_safe=true hoac them ngu canh `lock`: tv_experience:approve (chi super_admin theo mac dinh), khach khong bao gio co.
import { Hono } from 'hono';
import { z } from 'zod';
import { backgroundSizeProblem, parseOverlay, type CreativeOverlay } from '@ams/shared';
import { audit as auditCtx } from '../lib/audit-ctx.js';
import { diffObjects } from '../lib/audit.js';
import { forbidden, notFound, unprocessable } from '../lib/errors.js';
import { getRt, jsonParse, num, parseBody, runList } from '../lib/http.js';
import type { Ctx, ListSpec } from '../lib/http.js';
import { bumpManifest } from '../lib/manifest.js';
import { hasPerm, requirePerm } from '../auth/middleware.js';
import type { AppEnv } from '../types.js';

export const TV_SETTINGS_KEY = 'tv_experience';
/** Nganh khong phu hop man hinh co tre em (TV-APP-INTEGRATION 8.1): chan duyet kid_safe. */
export const DEFAULT_BANNED_INDUSTRIES = ['rượu bia', 'thuốc lá', 'cá cược', 'cờ bạc', 'vay nóng', 'người lớn', 'thực phẩm chức năng', 'thuốc'];
export const KID_SAFE_MAX_IMAGE_BYTES = 15 * 1024 * 1024;

export interface TvSettings {
  /** Cho phep quang cao o man khoa phu huynh (cung can creative kid_safe + phu huynh bat tren dien thoai). Mac dinh false. */
  lock_ads_enabled: boolean;
  fullscreen_ads_enabled: boolean;
  frequency: { per_hour: number; min_gap_s: number; same_creative_gap_s: number };
  banned_industries: string[];
}
export const DEFAULT_TV_SETTINGS: TvSettings = {
  lock_ads_enabled: false,
  fullscreen_ads_enabled: true,
  frequency: { per_hour: 30, min_gap_s: 60, same_creative_gap_s: 300 },
  banned_industries: DEFAULT_BANNED_INDUSTRIES,
};

const settingsBody = z.object({
  lock_ads_enabled: z.boolean(),
  fullscreen_ads_enabled: z.boolean(),
  frequency: z.object({
    per_hour: z.number().int().min(1).max(120),
    min_gap_s: z.number().int().min(10).max(3600),
    same_creative_gap_s: z.number().int().min(60).max(86_400),
  }),
  banned_industries: z.array(z.string().trim().min(1).max(40)).max(50),
});

export async function loadTvSettings(rt: { db: import('@ams/runtime').Db }): Promise<TvSettings> {
  const raw = (await rt.db.query<{ value: string }>('SELECT value FROM settings WHERE key = ?', [TV_SETTINGS_KEY]))[0]?.value;
  const p = settingsBody.safeParse(jsonParse<unknown>(raw, null));
  return p.success ? p.data : DEFAULT_TV_SETTINGS;
}

const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim();
export const isBannedIndustry = (industry: string | null | undefined, banned: readonly string[]): boolean => {
  const i = fold(industry ?? '');
  return !!i && banned.some((b) => { const x = fold(b); return !!x && (i.includes(x) || x.includes(i)); });
};

interface CRow {
  id: string;
  campaign_id: string | null;
  customer_id: string;
  name: string | null;
  kind: string | null;
  format: string | null;
  px_w: number | null;
  px_h: number | null;
  size_bytes: number | null;
  duration_s: number | null;
  review_state: string;
  state: string;
  overlay: string | null;
  owner_name: string;
  industry: string | null;
  campaign_name: string | null;
}
const C_SELECT = `m.id, m.campaign_id, m.customer_id, m.name, m.kind, m.format, m.px_w, m.px_h, m.size_bytes, m.duration_s, m.review_state, m.state, m.overlay,
  cu.short_name AS owner_name, cu.industry, ca.name AS campaign_name`;
const C_FROM = 'FROM creatives m JOIN customers cu ON cu.id = m.customer_id LEFT JOIN campaigns ca ON ca.id = m.campaign_id';

const overlayOf = (raw: string | null): CreativeOverlay => {
  if (!raw) return {};
  try {
    const r = parseOverlay(JSON.parse(raw), { reviewerFields: 'keep' });
    return r.ok && r.value ? r.value : {};
  } catch {
    return {};
  }
};

const present = (m: CRow) => {
  const o = overlayOf(m.overlay);
  const contexts = o.contexts ?? ['fullscreen'];
  const kid = o.kid_safe === true;
  return {
    id: m.id,
    name: m.name,
    customer_id: m.customer_id,
    customer: m.owner_name,
    industry: m.industry,
    campaign_id: m.campaign_id,
    campaign: m.campaign_name,
    format: m.format ?? 'fullscreen',
    kind: m.kind,
    px_w: m.px_w,
    px_h: m.px_h,
    review_state: m.review_state,
    duration_s: m.duration_s,
    kid_safe: kid,
    contexts,
    safe_area: o.safe_area ?? null,
    headline: o.headline ?? null,
    // chi len man khoa khi: duoc duyet noi dung + kid_safe + ngu canh lock
    lock_eligible: kid && contexts.includes('lock') && m.review_state === 'approved',
  };
};

const spec: ListSpec = {
  from: C_FROM,
  select: C_SELECT,
  where: [{ sql: "COALESCE(m.format, 'fullscreen') = 'fullscreen'", params: [] }],
  search: ['m.name', 'cu.short_name', 'ca.name'],
  sorts: { name: 'm.name', created_at: 'm.created_at', review_state: 'm.review_state', customer: 'cu.short_name' },
  defaultSort: 'created_at:desc',
  tiebreak: 'm.id',
  filters: {
    review_state: (v) => ({ sql: 'm.review_state = ?', params: [v] }),
    customer_id: (v) => ({ sql: 'm.customer_id = ?', params: [v] }),
    kid_safe: (v) => ({ sql: `COALESCE(m.overlay, '') ${v === 'true' || v === '1' ? '' : 'NOT '}LIKE '%"kid_safe":true%'`, params: [] }),
  },
};

async function loadCreative(c: Ctx, id: string): Promise<CRow> {
  const r = (await getRt(c).db.query<CRow>(`SELECT ${C_SELECT} ${C_FROM} WHERE m.id = ?`, [id]))[0];
  if (!r) throw notFound('Không tìm thấy creative.');
  return r;
}

/** Ly do chan duyet kid_safe (422 `kid_safe_blocked`). Rong = duoc phep. */
export function kidSafeProblems(m: CRow, settings: TvSettings): string[] {
  const out: string[] = [];
  if (m.review_state !== 'approved') out.push('Creative chưa được duyệt nội dung.');
  if ((m.format ?? 'fullscreen') !== 'fullscreen') out.push('Chỉ creative định dạng toàn màn hình mới lên màn khóa.');
  if (isBannedIndustry(m.industry, settings.banned_industries)) out.push(`Ngành "${m.industry}" thuộc nhóm cấm với màn hình có trẻ em.`);
  if (m.kind === 'image') {
    if (m.px_w && m.px_h) {
      const p = backgroundSizeProblem(m.px_w, m.px_h);
      if (p) out.push(p);
    } else out.push('Thiếu kích thước ảnh để kiểm tra 16:9.');
    if (m.size_bytes && num(m.size_bytes) > KID_SAFE_MAX_IMAGE_BYTES) out.push('Ảnh nền vượt 15 MB (giới hạn bộ giải mã TV).');
  }
  return out;
}

const patchBody = z
  .object({
    contexts: z.array(z.enum(['lock', 'fullscreen', 'pause', 'corner'])).min(1).max(4).optional(),
    duration_s: z.number().int().min(5).max(60).optional(),
    safe_area: z.object({ top: z.number().int().min(0).max(15), right: z.number().int().min(0).max(15), bottom: z.number().int().min(0).max(15), left: z.number().int().min(0).max(15) }).optional(),
    kid_safe: z.boolean().optional(),
  })
  .strict();

export function tvExperienceRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get('/', requirePerm('tv_experience', 'view'), async (c) => {
    const rt = getRt(c);
    const settings = await loadTvSettings(rt);
    // dem trong SQL; chi keo ve cac dong co overlay nhac toi kid_safe (tap thuc su bi tien loc, khong keo ca bang creatives)
    const total = num((await rt.db.query<{ n: number }>("SELECT COUNT(*) AS n FROM creatives WHERE COALESCE(format, 'fullscreen') = 'fullscreen'"))[0]?.n);
    const rows = await rt.db.query<{ overlay: string | null; review_state: string }>("SELECT overlay, review_state FROM creatives WHERE COALESCE(format, 'fullscreen') = 'fullscreen' AND overlay LIKE '%kid_safe%'");
    let kid = 0;
    let lock = 0;
    for (const x of rows) {
      const o = overlayOf(x.overlay);
      if (o.kid_safe) kid++;
      if (o.kid_safe && o.contexts?.includes('lock') && x.review_state === 'approved') lock++;
    }
    return c.json({
      settings,
      summary: { creatives: total, kid_safe: kid, lock_eligible: lock },
      can_approve: hasPerm(c, 'tv_experience', 'approve'),
    });
  });

  r.put('/settings', requirePerm('tv_experience', 'write'), async (c) => {
    const rt = getRt(c);
    const b = await parseBody(c, settingsBody);
    // bat quang cao man khoa la quyet dinh rui ro (tre em): can quyen duyet
    const before = await loadTvSettings(rt);
    if (b.lock_ads_enabled && !before.lock_ads_enabled && !hasPerm(c, 'tv_experience', 'approve')) throw forbidden('Chỉ người có quyền duyệt mới được bật quảng cáo ở màn khóa.', 'forbidden', { module: 'tv_experience', action: 'approve' });
    const next: TvSettings = { ...b, banned_industries: [...new Set(b.banned_industries.map((x) => x.trim()))] };
    const now = rt.clock.now().toISOString();
    await rt.db.tx(async (db) => {
      await db.run(
        'INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?,?,?,?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at',
        [TV_SETTINGS_KEY, JSON.stringify(next), c.get('user').id, now],
      );
      await auditCtx(c, db, { action: 'tv.settings.update', objectType: 'settings', objectId: TV_SETTINGS_KEY, diff: diffObjects(before as unknown as Record<string, unknown>, next as unknown as Record<string, unknown>) });
    });
    return c.json({ settings: next });
  });

  r.get('/creatives', requirePerm('tv_experience', 'view'), async (c) => {
    const res = await runList<CRow>(c, spec);
    return c.json({ ...res, items: res.items.map(present) });
  });

  r.get('/creatives/:id', requirePerm('tv_experience', 'view'), async (c) => {
    const m = await loadCreative(c, c.req.param('id'));
    return c.json({ ...present(m), overlay: overlayOf(m.overlay), kid_safe_problems: kidSafeProblems(m, await loadTvSettings(getRt(c))) });
  });

  // Doi ngu canh/thoi luong/vung an toan/kid_safe. Khong dung `PUT /media/:id/overlay` de dat kid_safe (route do cat bo am tham).
  r.put('/creatives/:id', requirePerm('tv_experience', 'write'), async (c) => {
    const rt = getRt(c);
    const m = await loadCreative(c, c.req.param('id'));
    const b = await parseBody(c, patchBody);
    if (Object.keys(b).length === 0) throw unprocessable('Nhập nội dung cần đổi.', 'nothing_to_update');
    const canApprove = hasPerm(c, 'tv_experience', 'approve');
    const cur = overlayOf(m.overlay);
    const next: CreativeOverlay = { ...cur };

    let kid = cur.kid_safe === true;
    if (b.kid_safe !== undefined && b.kid_safe !== kid) {
      if (b.kid_safe && !canApprove) throw forbidden('Chỉ người duyệt mới được xác nhận kid_safe.', 'forbidden', { module: 'tv_experience', action: 'approve' });
      kid = b.kid_safe;
    }
    let contexts = b.contexts ?? cur.contexts;
    if (contexts?.includes('lock') && !(cur.contexts ?? []).includes('lock') && !canApprove) throw forbidden('Chỉ người duyệt mới được cho phép hiển thị ở màn khóa.', 'forbidden', { module: 'tv_experience', action: 'approve' });
    if (!kid && contexts?.includes('lock')) {
      // bo kid_safe => tu rut ngu canh khoa; them lock ma chua kid_safe => tu choi
      if (b.contexts?.includes('lock')) throw unprocessable('Cần kid_safe trước khi cho phép màn khóa.', 'kid_safe_required');
      contexts = contexts.filter((x) => x !== 'lock');
      if (!contexts.length) contexts = ['fullscreen'];
    }
    if (kid && b.kid_safe === true) {
      const problems = kidSafeProblems(m, await loadTvSettings(rt));
      if (problems.length) throw unprocessable(`Không thể xác nhận kid_safe: ${problems.join(' ')}`, 'kid_safe_blocked', { problems });
    }
    if (kid) next.kid_safe = true;
    else delete next.kid_safe;
    if (contexts) next.contexts = contexts;
    if (b.duration_s !== undefined) next.duration_s = b.duration_s;
    if (b.safe_area) next.safe_area = b.safe_area;

    const check = parseOverlay(next, { reviewerFields: 'keep' });
    if (!check.ok) throw unprocessable('Lớp phủ không hợp lệ.', 'bad_overlay', check.errors);
    const json = check.value ? JSON.stringify(check.value) : null;
    await rt.db.tx(async (db) => {
      // duration_s dong bo sang creatives.duration_s de manifest co thoi luong (TV-APP-INTEGRATION request 1.4)
      await db.run('UPDATE creatives SET overlay = ?, duration_s = COALESCE(?, duration_s) WHERE id = ?', [json, b.duration_s ?? null, m.id]);
      await auditCtx(c, db, {
        action: b.kid_safe !== undefined ? (b.kid_safe ? 'tv.kid_safe.approve' : 'tv.kid_safe.revoke') : 'tv.creative.update',
        objectType: 'creative',
        objectId: m.id,
        customerId: m.customer_id,
        diff: { before: { kid_safe: cur.kid_safe === true, contexts: cur.contexts ?? null, duration_s: cur.duration_s ?? null, safe_area: cur.safe_area ?? null }, after: { kid_safe: kid, contexts: next.contexts ?? null, duration_s: next.duration_s ?? null, safe_area: next.safe_area ?? null } },
      });
    });
    if (m.campaign_id) await bumpManifest(rt);
    return c.json(present(await loadCreative(c, m.id)));
  });
  return r;
}
