// Giao dien giua API loi (a1) va tai chinh (a2). a2 cai dat FinancePort va gan route vi/nap tien/SePay
// qua mountFinance(app, rt) (xem finance-mount.ts). a1 chi goi cac ham duoi day, khong tu cham vao so cai vi.
import type { Hono } from 'hono';
import type { Runtime } from '@ams/runtime';
import type { AppEnv } from './types.js';

export type CampaignRunState = 'active' | 'scheduled' | 'awaiting_funds';

export interface ReserveResult {
  /** Trang thai chien dich sau khi thu giu tien. */
  campaign_state: CampaignRunState;
  /** So tien da giu (dong, nguyen). 0 neu chua du so du. */
  reserved_vnd: number;
  /** So tien con thieu de giu du ngan sach da duyet (0 neu da du). */
  shortfall_vnd: number;
}

export interface ReleaseResult {
  /** So tien giu chua dung da tra ve kha dung (dong). */
  released_vnd: number;
}

/**
 * Hop dong a1 <-> a2:
 *  - `reserveForCampaign`: DIEU KIEN TIEN QUYET: chien dich dang `awaiting_funds` va da co `approved_budget_vnd` (a1 da danh dau duyet,
 *    trong cung luot goi approve). Ham phai NGUYEN TU + IDEMPOTENT (goi lai khong giu 2 lan): neu kha dung (so du - dang giu) >= ngan sach duyet
 *    thi ghi so cai `reserve`, cap nhat campaigns.reserved_vnd/funding_state='reserved' va chuyen state sang `active` (start_at da den) hoac
 *    `scheduled`; neu khong du thi giu nguyen `awaiting_funds` va tra shortfall. Cung ham nay a2 dung cho bo kich hoat tu dong sau khi nap.
 *  - `releaseForCampaign`: tra phan giu chua dung ve kha dung (huy/ket thuc/thu hoi duyet/xoa), idempotent; dat funding_state='released'.
 *    a1 tu doi campaigns.state; a2 chi lo phan tien + funding_state + reserved_vnd.
 */
export interface FinancePort {
  reserveForCampaign(rt: Runtime, args: { campaignId: string; actorId: string | null }): Promise<ReserveResult>;
  releaseForCampaign(rt: Runtime, args: { campaignId: string; actorId: string | null; reason: string }): Promise<ReleaseResult>;
  /** Tuy chon: Cloudflare cron (chu ky 10 phut va 02:15 hang ngay) goi vao day. */
  scheduled?(rt: Runtime, cron: string): Promise<void>;
}

/**
 * Gan route tai chinh vao app (da co auth/CSRF cho /admin/v1/* va /portal/v1/*) va tra ve FinancePort.
 * Chay dong bo luc createApp; co the tra Promise (a1 cho khi can dung).
 */
export type MountFinance = (app: Hono<AppEnv>, rt: Runtime) => FinancePort | Promise<FinancePort>;

/** Ban tam khi a2 chua xong: KHONG di chuyen tien, chien dich duyet xong o lai `awaiting_funds`. */
export const nullFinancePort: FinancePort = {
  async reserveForCampaign(rt, { campaignId }) {
    const rows = await rt.db.query<{ approved_budget_vnd: number }>('SELECT approved_budget_vnd FROM campaigns WHERE id = ?', [campaignId]);
    const need = Number(rows[0]?.approved_budget_vnd ?? 0);
    return { campaign_state: 'awaiting_funds', reserved_vnd: 0, shortfall_vnd: need };
  },
  async releaseForCampaign() {
    return { released_vnd: 0 };
  },
};
