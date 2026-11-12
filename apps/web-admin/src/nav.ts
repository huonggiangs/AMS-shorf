import type { Module } from './api/schemas';

export interface PageDef { id: string; path: string; label: string; module: Module | null }
export const PAGE_DEFS: PageDef[] = [
  { id: 'overview', path: '/overview', label: 'Tổng quan', module: 'overview' },
  { id: 'devices', path: '/devices', label: 'Thiết bị', module: 'devices' },
  { id: 'tvexp', path: '/tv-experience', label: 'Trải nghiệm trên TV', module: 'tv_experience' },
  { id: 'ads', path: '/ads', label: 'Quảng cáo', module: 'campaigns' },
  { id: 'customers', path: '/customers', label: 'Khách hàng & Hợp đồng', module: 'customers' },
  { id: 'approvals', path: '/approvals', label: 'Phê duyệt', module: 'approvals' },
  { id: 'media', path: '/media', label: 'Nội dung & Media', module: 'media' },
  { id: 'screens', path: '/screens', label: 'Màn hình thang máy & LED', module: 'screens' },
  { id: 'formats', path: '/formats', label: 'Mẫu hiển thị TV', module: 'campaigns' },
  { id: 'schedule', path: '/schedule', label: 'Lịch phát', module: 'schedule' },
  { id: 'finance', path: '/finance', label: 'Thanh toán & thuế', module: 'finance' },
  { id: 'integrity', path: '/integrity', label: 'Kiểm soát hoa hồng', module: 'finance' },
  { id: 'history', path: '/history', label: 'Lịch sử xem', module: 'finance' },
  { id: 'partners', path: '/partners', label: 'Đối tác & Giá sàn RTB', module: 'partners' },
  { id: 'integrations', path: '/integrations', label: 'Tích hợp API', module: 'partners' },
  { id: 'access', path: '/access', label: 'Người dùng & Phân quyền', module: 'admin' },
  { id: 'audit', path: '/audit', label: 'Nhật ký hoạt động', module: 'admin' },
  { id: 'profile', path: '/profile', label: 'Hồ sơ của tôi', module: null },
];
export const PAGE_BY_ID = Object.fromEntries(PAGE_DEFS.map((p) => [p.id, p])) as Record<string, PageDef>;

export interface GroupDef { id: string; label: string; icon: string; pages: string[] }
export const GROUPS: GroupDef[] = [
  { id: 'g1', label: 'Tổng quan', icon: 'home', pages: ['overview', 'devices', 'tvexp'] },
  { id: 'g2', label: 'Quảng cáo', icon: 'ads', pages: ['ads', 'customers', 'approvals', 'media', 'screens', 'formats', 'schedule'] },
  { id: 'g3', label: 'Doanh thu', icon: 'coin', pages: ['finance', 'integrity', 'history'] },
  { id: 'g4', label: 'Đối tác', icon: 'link', pages: ['partners', 'integrations'] },
  { id: 'g5', label: 'Quản trị', icon: 'users', pages: ['access', 'audit', 'profile'] },
];
/** Pages an external (customer/partner) account may ever see: ads, media, wallet. */
export const EXTERNAL_PAGES = ['ads', 'media', 'finance'];

export const groupOf = (pageId: string): GroupDef => GROUPS.find((g) => g.pages.includes(pageId)) ?? GROUPS[0]!;

export function visiblePages(can: (m: Module) => boolean, external: boolean): string[] {
  return PAGE_DEFS.filter((p) => {
    if (external) return EXTERNAL_PAGES.includes(p.id) && (p.module ? can(p.module) : false);
    return p.module === null || can(p.module);
  }).map((p) => p.id);
}
