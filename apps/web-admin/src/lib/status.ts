/** Server status codes -> Vietnamese label + tag tone (prototype `tag()`). */
export type Tone = 'ok' | 'warn' | 'info' | 'mut' | 'bad';
const MAP: Record<string, [string, Tone]> = {
  // campaigns
  draft: ['Bản nháp', 'mut'], pending: ['Chờ duyệt', 'warn'], awaiting_funds: ['Chờ nạp tiền', 'warn'],
  scheduled: ['Đã lên lịch', 'info'], active: ['Đang phát', 'ok'], paused: ['Tạm dừng', 'mut'],
  rejected: ['Cần chỉnh sửa', 'bad'], ended: ['Đã kết thúc', 'mut'],
  // media / generic
  approved: ['Đã duyệt', 'ok'], processing: ['Đang xử lý', 'info'], returned: ['Cần chỉnh sửa', 'bad'],
  // devices
  online: ['Hoạt động', 'ok'], paired: ['Đã ghép đôi', 'ok'], verified: ['Hợp lệ', 'ok'], needs_update: ['Cần cập nhật', 'warn'],
  checking: ['Đang kiểm tra', 'warn'], blocked: ['Bị loại trừ', 'bad'], offline: ['Ngoại tuyến', 'bad'], unverified: ['Đang kiểm tra', 'warn'],
  // customers / contracts / users
  cooperating: ['Đang hợp tác', 'ok'], pending_payment: ['Chờ thanh toán', 'warn'], suspended: ['Tạm dừng', 'mut'],
  effective: ['Hiệu lực', 'ok'], pending_sign: ['Chờ ký', 'warn'], expired: ['Hết hạn', 'bad'],
  invited: ['Chờ xác nhận', 'warn'], locked: ['Đã khóa', 'bad'],
  // finance
  confirmed: ['Đã ghi nhận', 'ok'], credited: ['Đã ghi nhận', 'ok'], awaiting_confirm: ['Chờ xác nhận', 'warn'],
};
export const statusInfo = (code: string | null | undefined): { label: string; tone: Tone } => {
  const k = String(code ?? '');
  const m = MAP[k];
  return m ? { label: m[0], tone: m[1] } : { label: k || '—', tone: 'info' };
};
export const STATUS_LABEL = (c: string) => statusInfo(c).label;
export const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super admin', content_manager: 'Quản lý nội dung', finance: 'Tài chính',
  device_ops: 'Vận hành thiết bị', customer: 'Khách hàng (nhãn hàng)', partner: 'Đối tác (nhà cung cấp)',
};
export const ROLE_HELP: Record<string, string> = {
  super_admin: 'Toàn quyền: duyệt nội dung, ngân sách, chi trả, cấu hình.',
  content_manager: 'Tải media, tạo chiến dịch, duyệt media của khách hàng/đối tác. Không duyệt ngân sách.',
  finance: 'Đối soát, thuế, hóa đơn, chi trả, ví khách hàng, hợp đồng.',
  device_ops: 'Xem thiết bị, telemetry, xác minh/chặn TV, màn hình thang máy và LED.',
  customer: 'Tài khoản cấp cho nhãn hàng: tải video/ảnh cho chiến dịch của mình, nạp ví, xem trạng thái. Không duyệt, không thấy dữ liệu khách khác.',
  partner: 'Tài khoản cấp cho agency/nhà sản xuất video: tải video cho chiến dịch được giao. Không xem doanh thu, không xem khách khác.',
};
