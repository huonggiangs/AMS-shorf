// Thoi luong hien thi tung tu lieu trong vung video/anh cua bo cuc phat song: `zone.durations = { [creative_id]: giay }` (tuy chon, tuong thich nguoc).
export const IMAGE_DEFAULT_S = 5;
export const ITEM_DURATION_MIN_S = 1;
export const ITEM_DURATION_MAX_S = 3600;

/** Giay hien thi cua mot tu lieu: gia tri nguoi dung dat (kep 1..3600); anh thieu thi 5 s; video thieu thi `null` = phat het. */
export function itemDurationS(durations: Record<string, unknown> | null | undefined, creativeId: string, kind: 'image' | 'video'): number | null {
  const v = Number(durations?.[creativeId]);
  if (Number.isFinite(v) && v > 0) return Math.min(ITEM_DURATION_MAX_S, Math.max(ITEM_DURATION_MIN_S, Math.round(v)));
  return kind === 'image' ? IMAGE_DEFAULT_S : null;
}
