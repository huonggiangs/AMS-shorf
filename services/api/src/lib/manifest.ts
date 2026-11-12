import type { Runtime } from '@ams/runtime';
import { MANIFEST_EPOCH_KEY } from '@ams/shared';

/**
 * Bao moi instance gateway xay lai manifest (chien dich/creative/lich vua doi). Goi SAU khi giao dich da commit.
 * Gateway doc `manifest:epoch` khi bo nho dem het han (<=15 giay), nen hieu luc trong chuc giay; loi kv khong lam hong thao tac.
 */
export async function bumpManifest(rt: Runtime): Promise<void> {
  try {
    await rt.kv.incr(MANIFEST_EPOCH_KEY);
  } catch (e) {
    console.error('[api] khong tang manifest epoch:', (e as Error).name);
  }
}

/** Xoa cache thiet bi cua gateway (`dev:<id>`) sau khi khoa/mo/doi tin cay: hieu luc ngay o kv; bo nho tung instance het han <=30 giay. */
export async function dropDeviceCache(rt: Runtime, ids: string[]): Promise<void> {
  for (const id of ids) await rt.kv.del(`dev:${id}`).catch(() => undefined);
}

/** Tao lich phat mac dinh (ca ngay, uu tien 3) cho chien dich chua co lich nao: manifest chi phat chien dich co it nhat mot slot. */
export async function ensureDefaultSlot(rt: Runtime, db: import('@ams/runtime').Db, campaignId: string, targetType: string): Promise<boolean> {
  const r = await db.run(
    `INSERT INTO schedule_slots (id, campaign_id, partner_id, screen_group_id, target_type, daypart, start_min, end_min, priority, reward_points, regions)
     SELECT ?, ?, NULL, NULL, ?, 'all_day', 0, 1440, 3, 0, NULL WHERE NOT EXISTS (SELECT 1 FROM schedule_slots WHERE campaign_id = ?)`,
    [rt.id(), campaignId, targetType, campaignId],
  );
  return r.changes === 1;
}
