import type { Db, Runtime } from '@ams/runtime';

/**
 * Cong tai chinh ma a1 (API loi) goi khi duyet/huy chien dich.
 * a1 co the dinh nghia lai o services/api/src/ports.ts; hinh dang tuong thich.
 * `opts.db`: neu a1 dang o trong db.tx(t) thi truyen `t` vao (tranh deadlock tren sqlite/pglite).
 */
export interface FundingResult {
  /** 'paused' chi xuat hien khi chien dich co activate_on_approve = 0 (da giu tien nhung khong tu chay) */
  state: 'active' | 'scheduled' | 'awaiting_funds' | 'paused';
  /** so tien con thieu de giu du ngan sach (0 neu da giu) */
  shortfall: number;
}

export interface SpendResult {
  charged: number;
  /** phan yeu cau vuot qua phan da giu: khong bao gio tru */
  rejected: number;
  remaining: number;
  exhausted: boolean;
}

export interface FinanceCore {
  reserveForCampaign(campaignId: string, approvedBudgetVnd: number, opts?: { db?: Db }): Promise<FundingResult>;
  /** Hoan phan giu chua dung ve so du kha dung (huy, thu hoi duyet, ket thuc). Idempotent. */
  releaseForCampaign(campaignId: string, opts?: { db?: Db }): Promise<{ released: number }>;
  /** Tru tien theo impression da doi soat; khong bao gio vuot phan da giu; het ngan sach thi chien dich tu dung. */
  spendForCampaign(campaignId: string, amountVnd: number, ref?: { type: string; id: string }, opts?: { db?: Db }): Promise<SpendResult>;
}

/**
 * Hop dong a1 <-> a2 (khop services/api/src/ports.ts, a1 so huu). Tu a1: reserveForCampaign doc approved_budget_vnd tu DB
 * (a1 da danh dau duyet, state=awaiting_funds). `spendForCampaign` la phan mo rong cho bo doi soat impression.
 */
export interface FinancePort {
  reserveForCampaign(rt: Runtime, args: { campaignId: string; actorId: string | null }): Promise<{ campaign_state: 'active' | 'scheduled' | 'awaiting_funds'; reserved_vnd: number; shortfall_vnd: number }>;
  releaseForCampaign(rt: Runtime, args: { campaignId: string; actorId: string | null; reason: string }): Promise<{ released_vnd: number }>;
  scheduled?(rt: Runtime, cron: string): Promise<void>;
  spendForCampaign(rt: Runtime, args: { campaignId: string; amountVnd: number; ref?: { type: string; id: string } }): Promise<SpendResult>;
}

export class FinanceError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 409,
    public details?: unknown,
  ) {
    super(message);
  }
}
