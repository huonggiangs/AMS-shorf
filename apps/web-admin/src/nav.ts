import type { Module } from './api/schemas';

export interface PageDef { id: string; path: string; label: string; module: Module | null }
export const PAGE_DEFS: PageDef[] = [
  { id: 'overview', path: '/overview', label: 'Tổng quan', module: 'overview' },
  { id: 'views', path: '/views', label: 'Báo cáo lượt xem', module: 'campaigns' },
  { id: 'devices', path: '/devices', label: 'Danh sách thiết bị', module: 'devices' },
  { id: 'deviceGroups', path: '/device-groups', label: 'Nhóm thiết bị', module: 'devices' },
  { id: 'locations', path: '/locations', label: 'Địa điểm', module: 'devices' },
  { id: 'tvexp', path: '/tv-experience', label: 'Trải nghiệm trên TV', module: 'tv_experience' },
  { id: 'ads', path: '/ads', label: 'Quảng cáo', module: 'campaigns' },
  { id: 'customers', path: '/customers', label: 'Khách hàng & Hợp đồng', module: 'customers' },
  { id: 'contractDoc', path: '/contract-docs', label: 'Soạn hợp đồng & PDF', module: 'customers' },
  { id: 'approvals', path: '/approvals', label: 'Phê duyệt', module: 'approvals' },
  { id: 'media', path: '/media', label: 'Kho tư liệu', module: 'media' },
  { id: 'creativeReview', path: '/creative-review', label: 'Duyệt creative', module: 'media' },
  { id: 'screens', path: '/screens', label: 'Màn hình thang máy & LED', module: 'screens' },
  { id: 'formats', path: '/formats', label: 'Mẫu hiển thị TV', module: 'campaigns' },
  { id: 'schedule', path: '/schedule', label: 'Lịch phát', module: 'schedule' },
  { id: 'broadcast', path: '/broadcast', label: 'Chương trình phát sóng', module: 'schedule' },
  { id: 'notice', path: '/notice', label: 'Thông báo khẩn', module: 'schedule' },
  { id: 'workbench', path: '/workbench', label: 'Bàn làm việc', module: 'schedule' },
  { id: 'templates', path: '/templates', label: 'Mẫu bố cục', module: 'schedule' },
  { id: 'smart', path: '/smart', label: 'Phân phối thông minh', module: 'schedule' },
  { id: 'queue', path: '/queue', label: 'Hàng đợi & Nhật ký', module: 'schedule' },
  { id: 'finance', path: '/finance', label: 'Thanh toán & thuế', module: 'finance' },
  { id: 'integrity', path: '/integrity', label: 'Kiểm soát hoa hồng', module: 'finance' },
  { id: 'history', path: '/history', label: 'Lịch sử xem', module: 'finance' },
  { id: 'partners', path: '/partners', label: 'Đối tác & Giá sàn RTB', module: 'partners' },
  { id: 'integrations', path: '/integrations', label: 'Tích hợp API', module: 'partners' },
  { id: 'access', path: '/access', label: 'Người dùng & Phân quyền', module: 'admin' },
  { id: 'audit', path: '/audit', label: 'Nhật ký hoạt động', module: 'admin' },
  { id: 'alerts', path: '/alerts', label: 'Cảnh báo', module: 'admin' },
  { id: 'legal', path: '/legal', label: 'Văn bản pháp lý', module: 'admin' },
  { id: 'billing', path: '/billing', label: 'Công nợ & Hóa đơn điện tử', module: 'finance' },
  { id: 'compliance', path: '/compliance', label: 'Dữ liệu cá nhân & Lưu giữ', module: 'admin' },
  { id: 'kyc', path: '/kyc', label: 'Hồ sơ pháp lý khách hàng', module: 'customers' },
  { id: 'profile', path: '/profile', label: 'Hồ sơ của tôi', module: null },
];
export const PAGE_BY_ID = Object.fromEntries(PAGE_DEFS.map((p) => [p.id, p])) as Record<string, PageDef>;

export interface GroupDef { id: string; label: string; icon: string; pages: string[] }
export const GROUPS: GroupDef[] = [
  { id: 'g1', label: 'Tổng quan', icon: 'home', pages: ['overview', 'views', 'tvexp'] },
  { id: 'g2', label: 'Quảng cáo', icon: 'ads', pages: ['ads', 'customers', 'contractDoc', 'approvals', 'creativeReview', 'screens', 'formats', 'schedule', 'kyc'] },
  { id: 'g6', label: 'Phát sóng nội bộ', icon: 'ads', pages: ['workbench', 'media', 'broadcast', 'templates', 'notice', 'smart', 'queue'] },
  { id: 'g7', label: 'Thiết bị', icon: 'tv', pages: ['devices', 'deviceGroups', 'locations'] },
  { id: 'g3', label: 'Doanh thu', icon: 'coin', pages: ['finance', 'billing', 'integrity', 'history'] },
  { id: 'g4', label: 'Đối tác', icon: 'link', pages: ['partners', 'integrations'] },
  { id: 'g5', label: 'Quản trị', icon: 'users', pages: ['access', 'audit', 'alerts', 'legal', 'compliance', 'profile'] },
];
/** Pages an external (customer/partner) account may ever see: views report (landing), ads, media, wallet. */
export const EXTERNAL_PAGES = ['views', 'ads', 'media', 'finance'];

export const groupOf = (pageId: string): GroupDef => GROUPS.find((g) => g.pages.includes(pageId)) ?? GROUPS[0]!;

export function visiblePages(can: (m: Module) => boolean, external: boolean): string[] {
  return PAGE_DEFS.filter((p) => {
    if (external) return EXTERNAL_PAGES.includes(p.id) && (p.module ? can(p.module) : false);
    if (p.id === 'views') return false; // noi bo xem bao cao o Lich su xem (tab Bao cao luot xem)
    return p.module === null || can(p.module);
  }).map((p) => p.id);
}
