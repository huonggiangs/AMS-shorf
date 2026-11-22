// Hợp đồng dữ liệu cho cây nhóm thiết bị, địa điểm và âm lượng từ xa (d-tree). Khớp services/api/src/routes/device-groups.ts.
import { z } from 'zod';

const n = z.coerce.number();
export const groupNodeSchema = z.object({
  id: z.string(),
  parent_id: z.string().nullable(),
  name: z.string(),
  sort: n.default(0),
  path: z.string(),
  depth: n.default(1),
  direct_count: n.default(0),
  device_count: n.default(0),
  online_count: n.default(0),
});
export type GroupNode = z.infer<typeof groupNodeSchema>;
export const groupTreeSchema = z.object({ items: z.array(groupNodeSchema), total: n, total_online: n.default(0), unassigned: n.default(0), max_depth: n.default(6) });
export type GroupTree = z.infer<typeof groupTreeSchema>;

export const VOL_STATES = ['pending', 'delivered', 'acked', 'failed', 'expired', 'cancelled'] as const;
export const treeDeviceSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    kind: z.string().nullish(),
    model: z.string().nullish(),
    app_version: z.string().nullish(),
    status: z.string(),
    online: z.boolean().default(false),
    controllable: z.boolean().default(false),
    synced: z.boolean().default(false),
    last_seen_at: z.string().nullish(),
    px_w: n.nullish(),
    px_h: n.nullish(),
    orientation: z.string().nullish(),
    mac: z.string().nullish(),
    serial: z.string().nullish(),
    group_id: z.string().nullish(),
    group_name: z.string().nullish(),
    location_id: z.string().nullish(),
    location_name: z.string().nullish(),
    location_address: z.string().nullish(),
    volume: n.nullish(),
    volume_at: z.string().nullish(),
    volume_cmd: z.object({ id: z.string(), state: z.enum(VOL_STATES), percent: n.nullable(), created_at: z.string() }).nullish(),
  })
  .passthrough();
export type TreeDevice = z.infer<typeof treeDeviceSchema>;

export const VENUE_TYPES: Record<string, string> = { supermarket: 'Siêu thị', airport: 'Sân bay', elevator: 'Thang máy', fnb: 'F&B', hospital: 'Bệnh viện', hotel: 'Khách sạn', other: 'Khác' };
export const locationSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    address: z.string().nullish(),
    province: z.string().nullish(),
    district: z.string().nullish(),
    lat: n.nullish(),
    lng: n.nullish(),
    venue_type: z.string().default('other'),
    contact_name: z.string().nullish(),
    contact_phone: z.string().nullish(),
    notes: z.string().nullish(),
    status: z.string().default('active'),
    device_count: n.default(0),
    online_count: n.default(0),
  })
  .passthrough();
export type Location = z.infer<typeof locationSchema>;

/** Mã lỗi máy chủ -> tiếng Việt. */
export const TREE_ERRORS: Record<string, string> = {
  group_name_taken: 'Đã có nhóm cùng tên trong nhóm cha này.',
  group_cycle: 'Không thể chuyển nhóm vào chính nó hoặc nhóm con của nó.',
  group_too_deep: 'Cây nhóm tối đa 6 cấp.',
  group_not_found: 'Nhóm không còn tồn tại. Hãy tải lại trang.',
  group_empty: 'Nhóm chưa có thiết bị nào.',
  location_has_devices: 'Địa điểm đang có thiết bị. Hãy chọn nơi chuyển thiết bị đến trước khi xóa.',
  location_not_found: 'Địa điểm không còn tồn tại. Hãy tải lại trang.',
  mac_taken: 'Địa chỉ MAC này đã gắn cho thiết bị khác.',
  mac_invalid: 'Địa chỉ MAC không đúng định dạng (AA:BB:CC:DD:EE:FF).',
  device_not_found: 'Có thiết bị không còn tồn tại. Hãy tải lại trang.',
  forbidden: 'Bạn không có quyền thực hiện thao tác này (cần quyền ghi trên Thiết bị).',
};

/** Trạng thái lệnh âm lượng -> nhãn tiếng Việt cho người vận hành. */
export const VOL_TEXT: Record<string, { text: string; tone: 'info' | 'ok' | 'bad' | 'warn' }> = {
  pending: { text: 'Đang chờ thiết bị nhận lệnh', tone: 'warn' },
  delivered: { text: 'Đã gửi, chờ thiết bị xác nhận', tone: 'warn' },
  acked: { text: 'Thiết bị đã xác nhận', tone: 'ok' },
  failed: { text: 'Thiết bị báo lỗi', tone: 'bad' },
  expired: { text: 'Lệnh hết hạn, thiết bị không phản hồi', tone: 'bad' },
  cancelled: { text: 'Đã hủy', tone: 'info' },
};

/** Danh sách phẳng có thụt lề theo độ sâu, đúng thứ tự cây (cha trước con) để dùng trong <select>. */
export function flattenTree(items: GroupNode[], exclude?: Set<string>): { id: string; label: string; depth: number }[] {
  const kids = new Map<string | null, GroupNode[]>();
  for (const g of items) kids.set(g.parent_id, [...(kids.get(g.parent_id) ?? []), g]);
  const out: { id: string; label: string; depth: number }[] = [];
  const walk = (pid: string | null, d: number) => {
    for (const g of kids.get(pid) ?? []) {
      if (exclude?.has(g.id)) continue;
      out.push({ id: g.id, label: g.name, depth: d });
      walk(g.id, d + 1);
    }
  };
  walk(null, 0);
  return out;
}
export function subtree(items: GroupNode[], id: string): Set<string> {
  const out = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const g of items) if (g.parent_id && out.has(g.parent_id) && !out.has(g.id)) { out.add(g.id); grew = true; }
  }
  return out;
}
