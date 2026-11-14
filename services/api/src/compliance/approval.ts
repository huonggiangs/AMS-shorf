// Cong tuan thu khi DUYET chien dich (goi tu routes/campaigns.ts, trong cung luot goi approve):
//  1) KYC: khi settings.kyc_required_for_approval = 1, khach phai co KYC 'approved'.
//  2) Nganh han che (tu 3 nguon: campaign_gate.restricted_industry cua p2, customer_kyc.restricted_industry, campaign_compliance.category) chi duoc duyet khi
//     settings.allow_restricted_industries bat, KYC da duyet, va co "duyet lan hai" cua NGUOI KHAC voi nguoi duyet ngan sach (settings.restricted_second_approval != '0').
import type { Db } from '@ams/runtime';
import { isRestrictedCategory } from '@ams/shared';
import { unprocessable } from '../lib/errors.js';
import { num } from '../lib/http.js';

export const KYC_REQUIRED_KEY = 'kyc_required_for_approval';
export const SECOND_APPROVAL_KEY = 'restricted_second_approval';
const on = (v: string | undefined): boolean => v === '1' || v?.toLowerCase() === 'true';

const setting = async (db: Db, key: string): Promise<string | undefined> => (await db.query<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]))[0]?.value;

export interface RestrictionInfo {
  restricted: boolean;
  sources: string[];
  category: string;
  kyc_state: string;
  second_approved_by: string | null;
  second_approved_at: string | null;
}
export async function restrictionInfo(db: Db, campaignId: string, customerId: string): Promise<RestrictionInfo> {
  const gate = (await db.query<{ restricted_industry: unknown }>('SELECT restricted_industry FROM campaign_gate WHERE campaign_id = ?', [campaignId]))[0];
  const kyc = (await db.query<{ state: string; restricted_industry: unknown }>('SELECT state, restricted_industry FROM customer_kyc WHERE customer_id = ?', [customerId]))[0];
  const cc = (await db.query<{ category: string; second_approved_by: string | null; second_approved_at: string | null }>('SELECT category, second_approved_by, second_approved_at FROM campaign_compliance WHERE campaign_id = ?', [campaignId]))[0];
  const sources: string[] = [];
  if (num(gate?.restricted_industry) === 1) sources.push('campaign_gate');
  if (num(kyc?.restricted_industry) === 1) sources.push('kyc');
  if (isRestrictedCategory(cc?.category)) sources.push('category');
  return { restricted: sources.length > 0, sources, category: cc?.category ?? 'general', kyc_state: kyc?.state ?? 'none', second_approved_by: cc?.second_approved_by ?? null, second_approved_at: cc?.second_approved_at ?? null };
}

export async function assertComplianceForApproval(db: Db, c: { id: string; customer_id: string }, approverId: string): Promise<void> {
  const info = await restrictionInfo(db, c.id, c.customer_id);
  if (on(await setting(db, KYC_REQUIRED_KEY)) && info.kyc_state !== 'approved') {
    throw unprocessable('Khách hàng chưa được duyệt hồ sơ pháp lý (KYC). Hoàn tất KYC trước khi duyệt chiến dịch.', 'kyc_required', { kyc_state: info.kyc_state });
  }
  if (!info.restricted) return;
  if (!on(await setting(db, 'allow_restricted_industries'))) {
    throw unprocessable('Chiến dịch thuộc ngành hạn chế. Hiện chưa nhận ngành này (bật cài đặt allow_restricted_industries sau khi pháp lý duyệt quy trình).', 'restricted_industry_blocked', { sources: info.sources });
  }
  if ((await setting(db, SECOND_APPROVAL_KEY)) === '0') return;
  if (info.kyc_state !== 'approved') throw unprocessable('Ngành hạn chế yêu cầu KYC đã duyệt (kèm giấy phép ngành).', 'kyc_required', { kyc_state: info.kyc_state, sources: info.sources });
  if (!info.second_approved_by) throw unprocessable('Ngành hạn chế cần người thứ hai duyệt nội dung trước khi duyệt ngân sách.', 'second_approval_required', { sources: info.sources });
  if (info.second_approved_by === approverId) throw unprocessable('Người duyệt lần hai phải khác người duyệt ngân sách.', 'second_approval_same_person');
}
