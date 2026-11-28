// Nhom vung o trinh soan: cay 1 cap (nhom -> vung con). Vung con luu trong cung mang `zones` voi `parent_id`; x/y/w/h cua vung con la % cua NHOM.
// Cac ham thuan (khong React) de test; khop packages/shared/src/zones.ts (flattenZones) va docs/PLAYLIST.md "Nhom vung".
import { MAX_GROUP_CHILDREN, MAX_ZONES, MAX_ZONES_TOTAL, clampZone, newZone, type Zone, type ZoneType } from './layout';

export const isGroup = (z: Pick<Zone, 'type'>): boolean => z.type === 'group';
export const isTop = (z: Zone): boolean => !z.parent_id;
export const childrenOf = (zones: Zone[], gid: string): Zone[] => zones.filter((z) => z.parent_id === gid);
export const groupOf = (zones: Zone[], z: Zone): Zone | undefined => (z.parent_id ? zones.find((g) => g.id === z.parent_id && isGroup(g)) : undefined);
export const hasGroups = (zones: Zone[]): boolean => zones.some((z) => isGroup(z) || z.parent_id);
const r1 = (n: number): number => Math.round(n * 10) / 10;
const r3 = (n: number): number => Math.round(n * 1000) / 1000;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** Sap xep: moi nhom ngay truoc cac vung con cua no; vung con mo coi (cha khong con) thanh vung ngoai (bo parent_id). */
export function normalizeTree(zones: Zone[]): Zone[] {
  const gids = new Set(zones.filter((z) => isGroup(z) && !z.parent_id).map((z) => z.id));
  const fixed = zones.map((z) => (z.parent_id && (!gids.has(z.parent_id) || isGroup(z)) ? stripParent(z) : z));
  const out: Zone[] = [];
  for (const z of fixed) {
    if (z.parent_id) continue;
    out.push(z);
    if (isGroup(z)) out.push(...fixed.filter((c) => c.parent_id === z.id));
  }
  return out;
}
const stripParent = (z: Zone): Zone => { const { parent_id: _p, ...rest } = z; void _p; return rest as Zone; };

/** z = thu tu: vung ngoai theo thu tu trong cac vung ngoai, vung con theo thu tu trong nhom (toi da 20). */
export function reindexTree(zones: Zone[]): Zone[] {
  const n = normalizeTree(zones);
  const cnt = new Map<string, number>();
  let top = 0;
  return n.map((z) => {
    if (!z.parent_id) return { ...z, z: Math.min(20, top++) };
    const k = cnt.get(z.parent_id) ?? 0;
    cnt.set(z.parent_id, k + 1);
    return { ...z, z: Math.min(20, k) };
  });
}

/** So thu tu hien thi trong ten mac dinh (`Video 2`): vung ngoai dem trong cac vung ngoai, vung con dem trong nhom. Bo cuc phang: nhu cu (thu tu mang + 1 - 1). */
export function displayIndex(zones: Zone[]): Map<string, number> {
  const m = new Map<string, number>();
  const cnt = new Map<string, number>();
  let top = 0;
  for (const z of zones) {
    if (!z.parent_id || !zones.some((g) => g.id === z.parent_id)) m.set(z.id, top++);
    else { const k = cnt.get(z.parent_id) ?? 0; cnt.set(z.parent_id, k + 1); m.set(z.id, k); }
  }
  return m;
}

/** Hop con cua vung `c` (tuong doi trong nhom `g`) -> toa do tuyet doi (% man hinh), kep 0..100. */
export function absBox(g: Pick<Zone, 'x' | 'y' | 'w' | 'h'>, c: Pick<Zone, 'x' | 'y' | 'w' | 'h'>): Pick<Zone, 'x' | 'y' | 'w' | 'h'> {
  const x = clamp(g.x + (c.x * g.w) / 100, 0, 100);
  const y = clamp(g.y + (c.y * g.h) / 100, 0, 100);
  return { x: r3(x), y: r3(y), w: r3(clamp((c.w * g.w) / 100, 0, 100 - x)), h: r3(clamp((c.h * g.h) / 100, 0, 100 - y)) };
}
/** Nguoc lai: toa do tuyet doi -> % cua nhom (giu nguyen vi tri nhin thay khi dua vao nhom), kep trong nhom, toi thieu 5%. */
export function relBox(g: Pick<Zone, 'x' | 'y' | 'w' | 'h'>, a: Pick<Zone, 'x' | 'y' | 'w' | 'h'>): Pick<Zone, 'x' | 'y' | 'w' | 'h'> {
  const w = clamp(r1(g.w ? (a.w / g.w) * 100 : 100), 5, 100);
  const h = clamp(r1(g.h ? (a.h / g.h) * 100 : 100), 5, 100);
  return { w, h, x: clamp(r1(g.w ? ((a.x - g.x) / g.w) * 100 : 0), 0, 100 - w), y: clamp(r1(g.h ? ((a.y - g.y) / g.h) * 100 : 0), 0, 100 - h) };
}

/** Giong flattenZones o packages/shared: nhom bi bo, vung con -> toa do tuyet doi + group_id (dung de ve mau/xem truoc phang). */
export function flattenZones(zones: Zone[]): (Zone & { group_id?: string })[] {
  if (!hasGroups(zones)) return zones;
  const out: (Zone & { group_id?: string })[] = [];
  for (const z of normalizeTree(zones)) {
    if (isGroup(z)) continue;
    const g = z.parent_id ? zones.find((x) => x.id === z.parent_id) : undefined;
    out.push(g ? { ...stripParent(z), ...absBox(g, z), group_id: g.id, z: Math.min(20, out.length) } : { ...z, z: Math.min(20, out.length) });
  }
  return out;
}

// ---------------------------------------------------------------- thao tac
const CHILD_H: Partial<Record<ZoneType, number>> = { video: 50, image: 40, text: 15, marquee: 12, clock: 15, weather: 15, qr: 25, playlist: 50 };
const CHILD_W: Partial<Record<ZoneType, number>> = { qr: 40, clock: 50, weather: 50 };

/** Nhom dich khi them vung moi: dang chon nhom -> nhom do; dang chon vung con -> nhom cua no; con lai khong co (vung ngoai). */
export function targetGroup(zones: Zone[], selected: string | null): Zone | undefined {
  const s = zones.find((z) => z.id === selected);
  if (!s) return undefined;
  return isGroup(s) ? s : groupOf(zones, s);
}

export function canAdd(zones: Zone[], type: ZoneType, selected: string | null): boolean {
  if (zones.length >= MAX_ZONES_TOTAL) return false;
  const g = type === 'group' ? undefined : targetGroup(zones, selected);
  return g ? childrenOf(zones, g.id).length < MAX_GROUP_CHILDREN : zones.filter(isTop).length < MAX_ZONES;
}

/** Them vung: `group` luon la vung ngoai; loai khac vao nhom dang chon (hoac nhom cua vung con dang chon), xep doc duoi cac vung con co san. */
export function addZoneTo(zones: Zone[], type: ZoneType, selected: string | null): { zones: Zone[]; id: string } | null {
  if (!canAdd(zones, type, selected)) return null;
  const g = type === 'group' ? undefined : targetGroup(zones, selected);
  const z = newZone(type, zones);
  if (!g) return { zones: reindexTree([...zones, z]), id: z.id };
  const kids = childrenOf(zones, g.id);
  const bottom = kids.reduce((m, k) => Math.max(m, k.y + k.h), 0);
  const dh = CHILD_H[type] ?? 20;
  const room = 100 - bottom;
  const h = room >= 5 ? Math.min(dh, room) : dh;
  const y = room >= 5 ? bottom : 100 - dh;
  const w = CHILD_W[type] ?? 100;
  const child: Zone = { ...z, parent_id: g.id, x: r1((100 - w) / 2), y, w, h };
  return { zones: reindexTree([...zones, child]), id: child.id };
}

/** Xoa vung; xoa nhom thi xoa luon vung con. */
export function deleteZone(zones: Zone[], id: string): Zone[] {
  const z = zones.find((x) => x.id === id);
  if (!z) return zones;
  return reindexTree(zones.filter((x) => x.id !== id && !(isGroup(z) && x.parent_id === id)));
}

/** Doi thu tu trong CUNG cap anh em (vung ngoai: ca khoi nhom + con di cung; vung con: trong nhom). */
export function moveSibling(zones: Zone[], id: string, d: -1 | 1): Zone[] {
  const n = normalizeTree(zones);
  const z = n.find((x) => x.id === id);
  if (!z) return zones;
  const sibs = n.filter((x) => (x.parent_id ?? null) === (z.parent_id ?? null));
  const i = sibs.findIndex((x) => x.id === id);
  const j = i + d;
  if (j < 0 || j >= sibs.length) return zones;
  const order = [...sibs];
  [order[i], order[j]] = [order[j]!, order[i]!];
  if (z.parent_id) return reindexTree([...n.filter((x) => x.parent_id !== z.parent_id), ...order]); // normalizeTree dua con ve sau nhom
  return reindexTree(order.flatMap((t) => (isGroup(t) ? [t, ...n.filter((c) => c.parent_id === t.id)] : [t])));
}
/** Vi tri anh em dau/cuoi (de vo hieu hoa nut len/xuong). */
export function siblingPos(zones: Zone[], id: string): { first: boolean; last: boolean } {
  const z = zones.find((x) => x.id === id);
  if (!z) return { first: true, last: true };
  const sibs = zones.filter((x) => (x.parent_id ?? null) === (z.parent_id ?? null));
  const i = sibs.findIndex((x) => x.id === id);
  return { first: i <= 0, last: i === sibs.length - 1 };
}

/** Dua vung vao nhom `gid` (xep cuoi nhom, doi toa do sang % nhom giu nguyen vi tri) hoac ra ngoai (gid=null: toa do tuyet doi, dat ngay sau nhom cu). Tra ve null neu vuot gioi han. */
export function setParent(zones: Zone[], id: string, gid: string | null): Zone[] | null {
  const z = zones.find((x) => x.id === id);
  if (!z || isGroup(z)) return null;
  const cur = z.parent_id ?? null;
  if (cur === gid) return zones;
  const from = cur ? zones.find((g) => g.id === cur) : undefined;
  const to = gid ? zones.find((g) => g.id === gid && isGroup(g)) : undefined;
  if (gid && !to) return null;
  if (to ? childrenOf(zones, to.id).length >= MAX_GROUP_CHILDREN : zones.filter(isTop).length >= MAX_ZONES) return null;
  const abs = from ? absBox(from, z) : { x: z.x, y: z.y, w: z.w, h: z.h };
  const box = to ? relBox(to, abs) : clampZone({ ...z, ...abs } as Zone);
  const moved: Zone = to ? { ...z, ...box, parent_id: to.id } : { ...stripParent(z), x: box.x, y: box.y, w: box.w, h: box.h };
  const rest = zones.filter((x) => x.id !== id);
  if (to) return reindexTree([...rest, moved]);
  const at = from ? rest.findIndex((x) => x.id === from.id) : rest.length - 1; // ngay sau khoi nhom cu
  const end = from ? at + childrenOf(rest, from.id).length : at;
  return reindexTree([...rest.slice(0, end + 1), moved, ...rest.slice(end + 1)]);
}

/** Go nhom: vung con thanh vung ngoai (toa do tuyet doi, giu thu tu) o vi tri nhom; xoa nhom. Tra ve null neu vuot 8 vung ngoai. */
export function ungroup(zones: Zone[], gid: string): Zone[] | null {
  const g = zones.find((x) => x.id === gid && isGroup(x));
  if (!g) return null;
  const kids = childrenOf(zones, gid);
  if (zones.filter(isTop).length - 1 + kids.length > MAX_ZONES) return null;
  const out = zones.flatMap((z) => (z.id === gid ? kids.map((k) => ({ ...stripParent(k), ...absBox(g, k) }) as Zone) : z.parent_id === gid ? [] : [z]));
  return reindexTree(out);
}

export const topCount = (zones: Zone[]): number => zones.filter(isTop).length;
