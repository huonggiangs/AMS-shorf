// Job nen cua p4: thu lai hoa don dien tu (moi 10 phut) + job hang ngay (nhac no/tu tam dung, hoa don dieu chinh khi hoan tien, luu giu du lieu).
// Moi job duoc boc withJobRun (p3-ops) de co nhip "lan chay cuoi/loi cuoi"; mot job hong khong chan job con lai; khong bao gio nem loi.
import type { Runtime } from '@ams/runtime';
import { withJobRun } from '../ops/checks.js';
import { ensureDraftDocuments } from '../legal/service.js';
import { runRetention } from '../compliance/retention.js';
import { runDunning } from './dunning.js';
import { adjustPaidRefunds, retryDueEinvoices } from './einvoice.js';

async function guarded<T>(rt: Runtime, job: string, fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await withJobRun(rt, job, fn);
  } catch (e) {
    console.error(`[billing] job ${job} loi:`, (e as Error).name);
    return { error: String((e as Error).message ?? e).slice(0, 200) };
  }
}

/** Chu ky ngan (10 phut): thu lai chung tu hoa don dien tu den han. */
export async function billingFrequentTick(rt: Runtime): Promise<void> {
  await guarded(rt, 'einvoice_retry', () => retryDueEinvoices(rt));
}

/** Hang ngay (02:15 UTC): nhac no, tu tam dung, hoa don dieu chinh cho hoan tien da chi, luu giu du lieu, nap ban nhap van ban phap ly con thieu. */
export async function billingDailyTick(rt: Runtime): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  out['dunning'] = await guarded(rt, 'dunning', () => runDunning(rt));
  out['einvoice_adjust'] = await guarded(rt, 'einvoice_adjust', () => adjustPaidRefunds(rt));
  out['einvoice_retry'] = await guarded(rt, 'einvoice_retry', () => retryDueEinvoices(rt));
  out['retention'] = await guarded(rt, 'retention', async () => (await runRetention(rt)).deleted);
  out['legal_drafts'] = await guarded(rt, 'legal_drafts', () => ensureDraftDocuments(rt));
  return out;
}
