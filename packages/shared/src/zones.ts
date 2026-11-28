// Nhom vung (zone group): mot vung `type:'group'` la KHUNG chua cac vung con (`parent_id` = id nhom). Toa do vung con tinh theo % cua NHOM (0..100).
// Chi 1 cap long. Dung chung api (kiem tra), gateway (lam phang manifest cho app cu) va test. Xem docs/PLAYLIST.md muc "Nhom vung".

export const GROUP_ZONE_TYPE = 'group';
/** vung cap ngoai cung (gom ca nhom); giu nguyen gioi han cu cua bo cuc phang */
export const MAX_TOP_ZONES = 8;
export const MAX_GROUP_CHILDREN = 50;
export const MAX_ZONES_TOTAL = 100;

export interface GroupableZone {
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z?: number;
  parent_id?: string | null;
}

export interface ZoneTreeIssue { code: 'zone_group_invalid'; message: string }

const isGroup = (z: { type: string }): boolean => z.type === GROUP_ZONE_TYPE;
const r3 = (n: number): number => Math.round(n * 1000) / 1000;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/**
 * Kiem tra cay vung: parent_id phai ton tai, tro toi vung `group`, chi 1 cap (nhom khong co cha, khong tu tro), <= 50 vung con/nhom,
 * <= 100 vung tong, <= 8 vung cap ngoai. Tra ve loi dau tien hoac null.
 */
export function zoneTreeIssue(zones: readonly GroupableZone[]): ZoneTreeIssue | null {
  const bad = (message: string): ZoneTreeIssue => ({ code: 'zone_group_invalid', message });
  if (zones.length > MAX_ZONES_TOTAL) return bad(`Tối đa ${MAX_ZONES_TOTAL} vùng (tính cả vùng trong nhóm)`);
  const byId = new Map(zones.map((z) => [z.id, z]));
  const kids = new Map<string, number>();
  let top = 0;
  for (const z of zones) {
    if (z.parent_id == null) { top++; continue; }
    if (z.parent_id === z.id) return bad(`Vùng "${z.id}" không thể là cha của chính nó`);
    if (isGroup(z)) return bad(`Nhóm "${z.id}" không được nằm trong nhóm khác (chỉ một cấp)`);
    const p = byId.get(z.parent_id);
    if (!p) return bad(`Vùng "${z.id}" thuộc nhóm "${z.parent_id}" không tồn tại`);
    if (!isGroup(p)) return bad(`Vùng "${z.id}": "${z.parent_id}" không phải là nhóm`);
    if (p.parent_id != null) return bad(`Nhóm "${z.parent_id}" không được nằm trong nhóm khác (chỉ một cấp)`);
    const n = (kids.get(p.id) ?? 0) + 1;
    if (n > MAX_GROUP_CHILDREN) return bad(`Mỗi nhóm tối đa ${MAX_GROUP_CHILDREN} vùng`);
    kids.set(p.id, n);
  }
  if (top > MAX_TOP_ZONES) return bad(`Tối đa ${MAX_TOP_ZONES} vùng ngoài nhóm (nhóm tính là một vùng)`);
  return null;
}

/** Hop le neu khong co loi (xem `zoneTreeIssue`). */
export const isValidZoneTree = (zones: readonly GroupableZone[]): boolean => zoneTreeIssue(zones) === null;

/** Toa do tuyet doi (% man hinh) cua vung con co box tuong doi `c` trong nhom `g`; ket qua trong 0..100 (x+w, y+h <= 100). */
export function absBox(g: Pick<GroupableZone, 'x' | 'y' | 'w' | 'h'>, c: Pick<GroupableZone, 'x' | 'y' | 'w' | 'h'>): { x: number; y: number; w: number; h: number } {
  const x = clamp(g.x + (c.x * g.w) / 100, 0, 100);
  const y = clamp(g.y + (c.y * g.h) / 100, 0, 100);
  const w = clamp((c.w * g.w) / 100, 0, 100 - x);
  const h = clamp((c.h * g.h) / 100, 0, 100 - y);
  return { x: r3(x), y: r3(y), w: r3(w), h: r3(h) };
}

/**
 * Lam phang bo cuc nhom cho app cu: bo moi vung `group`, vung con duoc doi sang toa do TUYET DOI (% man hinh, kep 0..100), bo `parent_id` va them
 * `group_id` (thong tin). Thu tu: theo thu tu mang cap ngoai, vung con ngay sau vi tri nhom cua chung (theo thu tu mang); `z` = min(20, thu tu phat)
 * de giu lop (nhom truoc, con sau). Bo cuc khong co nhom/parent_id duoc tra NGUYEN VEN (cung doi tuong). Vung con mo coi (cha khong con) coi nhu vung ngoai.
 */
export function flattenZones<T extends GroupableZone>(zones: readonly T[]): (Omit<T, 'parent_id'> & { group_id?: string })[] {
  if (!zones.some((z) => isGroup(z) || z.parent_id != null)) return zones as unknown as (Omit<T, 'parent_id'> & { group_id?: string })[];
  const groups = new Map(zones.filter((z) => isGroup(z) && z.parent_id == null).map((g) => [g.id, g]));
  const kidsOf = new Map<string, T[]>();
  for (const z of zones) if (z.parent_id != null && groups.has(z.parent_id) && !isGroup(z)) kidsOf.set(z.parent_id, [...(kidsOf.get(z.parent_id) ?? []), z]);
  const out: (Omit<T, 'parent_id'> & { group_id?: string })[] = [];
  const push = (z: T, over: Partial<GroupableZone> & { group_id?: string }): void => {
    const { parent_id: _p, ...rest } = z;
    void _p;
    out.push({ ...rest, ...over, z: Math.min(20, out.length) } as Omit<T, 'parent_id'> & { group_id?: string });
  };
  for (const z of zones) {
    if (isGroup(z)) {
      const g = groups.get(z.id);
      if (!g) continue; // nhom long nhau/khong hop le: bo
      for (const c of kidsOf.get(g.id) ?? []) push(c, { ...absBox(g, c), group_id: g.id });
      continue;
    }
    if (z.parent_id != null && groups.has(z.parent_id)) continue; // da phat cung nhom
    push(z, {});
  }
  return out;
}
