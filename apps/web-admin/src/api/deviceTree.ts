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
    caps: z.array(z.string()).nullish(),
    /** true/false khi app tu khai (caps) hoac da tung ack set_volume kem ket qua; null = chua ro (van cho gui) */
    can_set_volume: z.boolean().nullish(),
    last_heartbeat_at: z.string().nullish(),
    next_heartbeat_at: z.string().nullish(),
    volume_cmd: z.object({ id: z.string(), state: z.enum(VOL_STATES), percent: n.nullable(), applied_percent: n.nullable().optional(), mode: z.enum(['system', 'player']).nullable().optional(), deliveries: n.nullish(), expires_at: z.string().nullish(), created_at: z.string() }).nullish(),
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

export const VOL_STALE_MS = 15 * 60_000;
export const VOL_NOT_RECEIVED = 'Thiết bị chưa nhận lệnh: app trên TV chưa hỗ trợ hoặc đang ngoại tuyến';
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
type VolCmd = NonNullable<TreeDevice['volume_cmd']>;
/** Trạng thái lệnh âm lượng thật cho người vận hành (kể cả "chờ quá lâu" và "app báo đã nhận nhưng không áp dụng"). */
export function volumeStatus(cmd: VolCmd, nowMs: number): { text: string; tone: 'info' | 'ok' | 'bad' | 'warn'; retry: boolean } {
  const age = nowMs - Date.parse(cmd.created_at);
  const stale = Number.isFinite(age) && age > VOL_STALE_MS;
  switch (cmd.state) {
    case 'pending': return stale ? { text: VOL_NOT_RECEIVED, tone: 'bad', retry: true } : { ...VOL_TEXT['pending']!, retry: false };
    case 'delivered': return stale ? { text: 'Thiết bị đã nhận lệnh nhưng không phản hồi: app có thể chưa hỗ trợ âm lượng', tone: 'bad', retry: true } : { ...VOL_TEXT['delivered']!, retry: false };
    case 'acked': return cmd.applied_percent != null ? { ...VOL_TEXT['acked']!, retry: false } : { text: 'Thiết bị báo đã nhận nhưng không báo mức đã áp dụng: app có thể chưa hỗ trợ âm lượng. Kiểm tra mức thiết bị báo ở dòng dưới', tone: 'warn', retry: true };
    case 'failed': return { text: 'Thiết bị báo lỗi hoặc không thực hiện được: app trên TV chưa hỗ trợ âm lượng?', tone: 'bad', retry: true };
    case 'expired': return { text: (cmd.deliveries ?? 0) > 0 ? 'Thiết bị đã nhận lệnh nhưng không phản hồi: app có thể chưa hỗ trợ âm lượng' : VOL_NOT_RECEIVED, tone: 'bad', retry: true };
    default: return { ...VOL_TEXT['cancelled']!, retry: true };
  }
}
/** Huy hiệu khả năng: dựa trên danh sách `caps` thiết bị tự khai, không đoán. */
export function volumeCapBadge(d: Pick<TreeDevice, 'can_set_volume'>): { text: string; tone: 'ok' | 'bad' | 'info'; title: string } {
  if (d.can_set_volume === true) return { text: 'App hỗ trợ âm lượng', tone: 'ok', title: 'App trên thiết bị đã khai hỗ trợ set_volume hoặc từng xác nhận lệnh âm lượng.' };
  if (d.can_set_volume === false) return { text: 'App chưa hỗ trợ âm lượng', tone: 'bad', title: 'App trên thiết bị khai không có set_volume. Cần cài bản app mới (xem docs/TV-APP-INTEGRATION.md).' };
  return { text: 'Chưa rõ app có hỗ trợ', tone: 'info', title: 'App chưa khai danh sách tính năng. Vẫn gửi được; nếu thiết bị không phản hồi thì app chưa hỗ trợ.' };
}
export const nextBeatText = (d: Pick<TreeDevice, 'next_heartbeat_at' | 'last_heartbeat_at'>, nowMs: number): string => {
  if (!d.next_heartbeat_at) return 'Chưa thấy nhịp heartbeat gần đây (thiết bị có thể đang ngoại tuyến)';
  const t = Date.parse(d.next_heartbeat_at);
  return t >= nowMs ? `Nhịp heartbeat kế tiếp dự kiến ${hhmm(d.next_heartbeat_at)} (còn ~${Math.max(1, Math.round((t - nowMs) / 1000))} giây)` : `Nhịp dự kiến ${hhmm(d.next_heartbeat_at)} đã qua, thiết bị chưa gọi lại`;
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
