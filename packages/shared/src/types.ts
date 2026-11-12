// Kieu dung chung (PLAN §2-§4). Trang thai la chuoi de khop cot TEXT.
export const ROLES = ['super_admin', 'content_manager', 'finance', 'device_ops', 'customer', 'partner'] as const;
export type Role = (typeof ROLES)[number];

export const MODULES = [
  'overview',
  'devices',
  'tv_experience',
  'campaigns',
  'customers',
  'approvals',
  'media',
  'screens',
  'schedule',
  'finance',
  'partners',
  'admin',
] as const;
export type Module = (typeof MODULES)[number];

export const ACTIONS = ['view', 'write', 'approve', 'delete'] as const;
export type Action = (typeof ACTIONS)[number];

export type AccountKind = 'internal' | 'customer' | 'partner';

export type CampaignState =
  | 'draft'
  | 'pending_review'
  | 'awaiting_funds'
  | 'scheduled'
  | 'active'
  | 'paused'
  | 'rejected'
  | 'ended';
export type ContractState = 'draft' | 'pending_sign' | 'active' | 'paused' | 'expired' | 'terminated';
export type CustomerState = 'pending_payment' | 'active' | 'paused' | 'terminated';
export type TopupStatus = 'pending' | 'credited' | 'rejected' | 'unmatched';
export type WalletEntryKind = 'topup' | 'reserve' | 'release' | 'spend' | 'refund' | 'adjust';
export type ScreenType = 'tv' | 'elevator' | 'led_p5';

export const REGIONS: Record<string, string> = {
  HN: 'Hà Nội',
  HCM: 'TP.HCM',
  DN: 'Đà Nẵng',
  CT: 'Cần Thơ',
  HP: 'Hải Phòng',
};

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export type Page<T> = { items: T[]; page: number; page_size: number; total: number };
