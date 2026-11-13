// Xu ly outbox cua API (P0 muc 2): duyet chien dich -> giu tien -> bao gateway xay lai manifest.
// Thay doi trang thai + dong outbox duoc ghi CUNG giao dich (routes/campaigns.ts); o day la cac handler idempotent va bo xu ly,
// goi duoc tu Node (setInterval), Cloudflare (cron) va test.
import { enqueueOutbox, processOutbox, type OutboxHandlers, type OutboxOptions, type OutboxResult, type Runtime } from '@ams/runtime';
import { CAMPAIGN_DELETABLE_STATES, MANIFEST_EPOCH_KEY } from '@ams/shared';
import { writeAudit } from './lib/audit.js';
import type { FinancePort } from './ports.js';

export const TOPIC_CAMPAIGN_APPROVED = 'campaign.approved';
export const TOPIC_MANIFEST_BUMP = 'manifest.bump';
/** Tep tai len vua xac nhan -> bao media-worker quet/chuyen ma (cung ten chu de voi MEDIA_TOPIC cua @ams/media-worker). */
export const TOPIC_MEDIA_UPLOADED = 'media.uploaded';
/** Hoan phan tien giu chua dung cua chien dich da tra lai/ket thuc/xoa; ghi CUNG giao dich voi viec doi trang thai. */
export const TOPIC_CAMPAIGN_RELEASE = 'campaign.release';

export interface CampaignReleasePayload {
  campaignId: string;
  actorId: string | null;
  reason: string;
  /** Xoa chien dich sau khi hoan tien (chi dung khi chien dich con tien giu: hang cua DELETE /campaigns/:id). */
  deleteAfter?: boolean;
}

export function enqueueMediaUploaded(db: Parameters<typeof enqueueOutbox>[0], rt: Pick<Runtime, 'clock' | 'id'>, creativeId: string): Promise<boolean> {
  return enqueueOutbox(db, rt, { topic: TOPIC_MEDIA_UPLOADED, payload: { creative_id: creativeId }, dedupeKey: `${TOPIC_MEDIA_UPLOADED}:${creativeId}` });
}

/** Khoa khu trung theo (chien dich, lan chuyen trang thai): ULID de moi lan reject/end la mot viec rieng. */
export function enqueueCampaignRelease(db: Parameters<typeof enqueueOutbox>[0], rt: Pick<Runtime, 'clock' | 'id'>, p: CampaignReleasePayload): Promise<boolean> {
  return enqueueOutbox(db, rt, { topic: TOPIC_CAMPAIGN_RELEASE, payload: p, dedupeKey: `${TOPIC_CAMPAIGN_RELEASE}:${p.campaignId}:${rt.id()}` });
}

export const CAMPAIGN_RELEASABLE_STATES = ['rejected', 'ended'] as const;

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
    // Chuyen cho media-worker (queue); worker idempotent theo scan_state va con tu quet DB dinh ky, nen gui lai an toan.
    [TOPIC_MEDIA_UPLOADED]: async (msg, rt) => {
      const p = msg.payload as { creative_id?: string } | null;
      if (!p?.creative_id) return;
      await rt.queue.send(TOPIC_MEDIA_UPLOADED, { creative_id: p.creative_id });
    },
    // Hoan tien chua dung. CHI khi chien dich van o trang thai cuoi (rejected/ended): neu da duyet lai truoc khi worker chay thi bo qua
    // (khong giai phong tien cua lan duyet moi). releaseForCampaign idempotent => thu lai/chay song song an toan.
    [TOPIC_CAMPAIGN_RELEASE]: async (msg, rt) => {
      const p = msg.payload as CampaignReleasePayload | null;
      if (!p?.campaignId) return;
      const c = (await rt.db.query<{ state: string }>('SELECT state FROM campaigns WHERE id = ?', [p.campaignId]))[0];
      if (!c) return; // da xoa
      if (p.deleteAfter) {
        if (!(CAMPAIGN_DELETABLE_STATES as readonly string[]).includes(c.state)) return; // doi trang thai sau khi yeu cau xoa: khong xoa, khong hoan
      } else if (!(CAMPAIGN_RELEASABLE_STATES as readonly string[]).includes(c.state)) return;
      const fin = await getFinance();
      await fin.releaseForCampaign(rt, { campaignId: p.campaignId, actorId: p.actorId, reason: p.reason });
      if (p.deleteAfter) await deleteCampaignRows(rt, p);
    },
  };
}

/** Xoa chien dich (da hoan tien) + gui bao manifest + audit; mot giao dich, idempotent (dieu kien state + id). */
async function deleteCampaignRows(rt: Runtime, p: CampaignReleasePayload): Promise<void> {
  const states = CAMPAIGN_DELETABLE_STATES as readonly string[];
  await rt.db.tx(async (db) => {
    const row = (await db.query<{ state: string; customer_id: string; name: string }>('SELECT state, customer_id, name FROM campaigns WHERE id = ?', [p.campaignId]))[0];
    if (!row || !states.includes(row.state)) return;
    await db.run('DELETE FROM schedule_slots WHERE campaign_id = ?', [p.campaignId]);
    await db.run('DELETE FROM campaign_grants WHERE campaign_id = ?', [p.campaignId]);
    await db.run('UPDATE creatives SET campaign_id = NULL WHERE campaign_id = ?', [p.campaignId]);
    const res = await db.run(`DELETE FROM campaigns WHERE id = ? AND state IN (${states.map(() => '?').join(',')})`, [p.campaignId, ...states]);
    if (res.changes === 0) return;
    await writeAudit(db, { rt, ip: 'outbox', actorId: p.actorId }, { action: 'campaign.delete', objectType: 'campaign', objectId: p.campaignId, customerId: row.customer_id, diff: { name: row.name, state: row.state, via: 'outbox' } });
    await enqueueManifestBump(db, rt, 'campaign.delete', p.campaignId);
  });
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

/**
 * Doi soat hoan tien (D1 khong co giao dich): chien dich da rejected/ended ma van giu tien (funding_state='reserved') va chua co viec
 * hoan tien dang cho/da lam sau lan cap nhat cuoi => ghi bu. Khoa khu trung theo updated_at nen khong ghi lien tuc.
 */
export async function reconcileReleases(rt: Runtime): Promise<number> {
  const rows = await rt.db.query<{ id: string; updated_at: string }>(
    `SELECT id, updated_at FROM campaigns WHERE state IN ('rejected','ended') AND funding_state = 'reserved' LIMIT 200`,
  );
  let n = 0;
  for (const r of rows) {
    const payload: CampaignReleasePayload = { campaignId: r.id, actorId: null, reason: 'doi soat hoan tien' };
    if (await enqueueOutbox(rt.db, rt, { topic: TOPIC_CAMPAIGN_RELEASE, payload, dedupeKey: `${TOPIC_CAMPAIGN_RELEASE}:${r.id}:recon:${r.updated_at}` })) n++;
  }
  return n;
}

/** Mot lan quet day du (cron/interval): doi soat roi xu ly. */
export async function sweepOutbox(rt: Runtime, getFinance: () => Promise<FinancePort>, opts?: OutboxOptions): Promise<OutboxResult & { requeued: number }> {
  const requeued = (await reconcileApprovals(rt)) + (await reconcileReleases(rt));
  return { ...(await runOutbox(rt, getFinance, opts)), requeued };
}
