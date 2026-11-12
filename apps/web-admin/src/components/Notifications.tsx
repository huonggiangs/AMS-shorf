import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { listOf, campaignSchema, topupSchema, mediaSchema } from '../api/schemas';
import { useAuth } from '../auth/AuthProvider';

export interface Notif { id: string; text: string; sub: string; page: string }

const readKey = 'ams-notif-read';
export const loadRead = (): Record<string, number> => {
  try { return JSON.parse(localStorage.getItem(readKey) ?? '{}'); } catch { return {}; }
};
export const saveRead = (r: Record<string, number>) => { try { localStorage.setItem(readKey, JSON.stringify(r)); } catch { /* ignore */ } };

/** Notifications derived from live API counts (no invented items). */
export function useNotifications(): { items: (Notif & { count: number })[]; loading: boolean } {
  const { can, isExternal } = useAuth();
  const approvals = useQuery({
    queryKey: ['notif', 'approvals'],
    enabled: can('approvals', 'view') && !isExternal,
    refetchInterval: 60_000,
    queryFn: () => api.get('/admin/v1/approvals', { query: { page: 1, page_size: 1 }, schema: listOf(campaignSchema) }),
  });
  const funds = useQuery({
    queryKey: ['notif', 'funds'],
    enabled: can('campaigns', 'view'),
    refetchInterval: 60_000,
    queryFn: () => api.get(isExternal ? '/portal/v1/campaigns' : '/admin/v1/campaigns', { query: { page: 1, page_size: 1, filter: 'status:awaiting_funds' }, schema: listOf(campaignSchema) }),
  });
  const topups = useQuery({
    queryKey: ['notif', 'topups'],
    enabled: can('finance', 'approve') && !isExternal,
    refetchInterval: 60_000,
    queryFn: () => api.get('/admin/v1/topups', { query: { page: 1, page_size: 1, filter: 'status:awaiting_confirm' }, schema: listOf(topupSchema) }),
  });
  const media = useQuery({
    queryKey: ['notif', 'media'],
    enabled: can('media', 'approve') && !isExternal,
    refetchInterval: 60_000,
    queryFn: () => api.get('/admin/v1/media', { query: { page: 1, page_size: 1, filter: 'status:pending' }, schema: listOf(mediaSchema) }),
  });
  const items: (Notif & { count: number })[] = [];
  const a = approvals.data?.total ?? 0, f = funds.data?.total ?? 0, t = topups.data?.total ?? 0, m = media.data?.total ?? 0;
  if (a) items.push({ id: 'approvals', text: `${a} chiến dịch đang chờ duyệt`, sub: 'Phê duyệt', page: '/approvals', count: a });
  if (m) items.push({ id: 'media', text: `${m} tệp media chờ kiểm duyệt`, sub: 'Nội dung & Media', page: '/media', count: m });
  if (f) items.push({ id: 'funds', text: `${f} chiến dịch chờ nạp tiền`, sub: 'Ví quảng cáo', page: '/finance', count: f });
  if (t) items.push({ id: 'topups', text: `${t} giao dịch nạp tiền chờ xác nhận`, sub: 'Thanh toán & thuế', page: '/finance', count: t });
  return { items, loading: approvals.isLoading || funds.isLoading || topups.isLoading || media.isLoading };
}
