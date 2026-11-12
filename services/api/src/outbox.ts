// Xu ly outbox cua API (P0 muc 2): duyet chien dich -> giu tien -> bao gateway xay lai manifest.
// Thay doi trang thai + dong outbox duoc ghi CUNG giao dich (routes/campaigns.ts); o day la cac handler idempotent va bo xu ly,
// goi duoc tu Node (setInterval), Cloudflare (cron) va test.
import { enqueueOutbox, processOutbox, type OutboxHandlers, type OutboxOptions, type OutboxResult, type Runtime } from '@ams/runtime';
import { MANIFEST_EPOCH_KEY } from '@ams/shared';
import type { FinancePort } from './ports.js';

export const TOPIC_CAMPAIGN_APPROVED = 'campaign.approved';
export const TOPIC_MANIFEST_BUMP = 'manifest.bump';

export interface CampaignApprovedPayload {
  campaignId: string;
  actorId: string | null;
  approvedAt: string;
}

/** Khoa khu trung cua viec "giu tien sau duyet": duyet lai sau khi bi tra (approved_at moi) la viec moi. */
export const approvedKey = (campaignId: string, approvedAt: string): string => `${TOPIC_CAMPAIGN_APPROVED}:${campaignId}:${approvedAt}`;

/** Ghi viec "xay lai manifest" trong giao dich dang chay (khoa ULID: moi lan doi trang thai deu bao). */
export function enqueueManifestBump(db: Parameters<typeof enqueueOutbox>[0], rt: Pick<Runtime, 'clock' | 'id'>, reason: string, campaignId: string): Promise<boolean> {
  return enqueueOutbox(db, rt, { topic: TOPIC_MANIFEST_BUMP, payload: { reason, campaignId }, dedupeKey: `${TOPIC_MANIFEST_BUMP}:${reason}:${campaignId}:${rt.id()}` });
}

/**
 * Handler (moi cai idempotent):
 *  - campaign.approved: giu tien qua FinancePort.reserveForCampaign (idempotent theo funding_state + UPDATE co dieu kien), sau do GHI viec manifest.bump
 *    voi khoa khu trung co dinh. Mat dien sau buoc giu tien: lan thu lai giu tien = no-op, ghi manifest.bump = no-op neu da co => hoi tu.
 *  - manifest.bump: tang epoch manifest trong kv (tang them lan nua chi khien gateway xay lai manifest them mot lan: vo hai). Loi kv NEM ra de thu lai.
 */
export function createOutboxHandlers(getFinance: () => Promise<FinancePort>): OutboxHandlers {
  return {
    [TOPIC_CAMPAIGN_APPROVED]: async (msg, rt) => {
      const p = msg.payload as CampaignApprovedPayload | null;
      if (!p?.campaignId) return; // payload hong: bo (khong thu lai vo han)
      const c = (await rt.db.query<{ state: string }>('SELECT state FROM campaigns WHERE id = ?', [p.campaignId]))[0];
      // da bi xoa / tra lai / ket thuc truoc khi worker chay: khong giu tien
      if (!c || !['awaiting_funds', 'scheduled', 'active', 'paused'].includes(c.state)) return;
      const fin = await getFinance();
      await fin.reserveForCampaign(rt, { campaignId: p.campaignId, actorId: p.actorId });
      await enqueueOutbox(rt.db, rt, {
        topic: TOPIC_MANIFEST_BUMP,
        payload: { reason: TOPIC_CAMPAIGN_APPROVED, campaignId: p.campaignId },
        dedupeKey: `${TOPIC_MANIFEST_BUMP}:${approvedKey(p.campaignId, p.approvedAt)}`,
      });
    },
    [TOPIC_MANIFEST_BUMP]: async (_msg, rt) => {
      await rt.kv.incr(MANIFEST_EPOCH_KEY);
    },
  };
}

/** Xu ly cac viec den han (khong nem). Dung chung: sau commit trong request, setInterval Node, cron Cloudflare, test. */
export function runOutbox(rt: Runtime, getFinance: () => Promise<FinancePort>, opts?: OutboxOptions): Promise<OutboxResult> {
  return processOutbox(rt, createOutboxHandlers(getFinance), opts);
}

/**
 * Bo doi soat cho engine khong co giao dich (D1): chien dich da duyet (awaiting_funds, co approved_at) ma khong co dong outbox
 * (mat dien giua UPDATE trang thai va INSERT outbox) thi ghi bu. Idempotent nho khoa khu trung; an toan chay moi phut.
 */
export async function reconcileApprovals(rt: Runtime): Promise<number> {
  const rows = await rt.db.query<{ id: string; approved_by: string | null; approved_at: string }>(
    `SELECT c.id, c.approved_by, c.approved_at FROM campaigns c
      WHERE c.state = 'awaiting_funds' AND c.funding_state = 'awaiting_funds' AND c.approved_at IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.dedupe_key = ? || c.id || ':' || c.approved_at)
      LIMIT 200`,
    [`${TOPIC_CAMPAIGN_APPROVED}:`],
  );
  let n = 0;
  for (const r of rows) {
    const payload: CampaignApprovedPayload = { campaignId: r.id, actorId: r.approved_by, approvedAt: r.approved_at };
    if (await enqueueOutbox(rt.db, rt, { topic: TOPIC_CAMPAIGN_APPROVED, payload, dedupeKey: approvedKey(r.id, r.approved_at) })) n++;
  }
  return n;
}

/** Mot lan quet day du (cron/interval): doi soat roi xu ly. */
export async function sweepOutbox(rt: Runtime, getFinance: () => Promise<FinancePort>, opts?: OutboxOptions): Promise<OutboxResult & { requeued: number }> {
  const requeued = await reconcileApprovals(rt);
  return { ...(await runOutbox(rt, getFinance, opts)), requeued };
}
