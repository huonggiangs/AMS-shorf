import type { Runtime } from '@ams/runtime';
import { spendCampaign } from './ledger.js';
import { bumpManifest, iso, n, withTx } from './util.js';

/** Hinh dang tuong thich `SpendRequest`/`SpendFn` cua @ams/ingest-consumer (khong import de tranh vong phu thuoc). */
export interface ImpressionSpendRequest {
  campaignId: string;
  customerId: string;
  /** tong doanh thu cua cac impression hop le moi, micro-VND (1 VND = 1.000.000) */
  amountMicroVnd: number;
  impressions: number;
  /** on dinh theo tap event_id: goi lai cung khoa KHONG tru lan hai */
  idempotencyKey: string;
  firstTs: string;
  lastTs: string;
}
export type ImpressionSpendFn = (req: ImpressionSpendRequest) => Promise<void>;

const MICRO = 1_000_000;

/**
 * Chi tieu impression cho consumer: IDEMPOTENT theo `idempotencyKey` (bang spend_dedupe, khoa chinh) + cong don phan du micro-VND
 * theo chien dich (campaigns.spend_remainder_micro) roi moi tru so dong nguyen tu phan giu (`spendCampaign`: khong vuot phan giu,
 * het ngan sach thi chien dich tu dung). Moi thu nam trong MOT giao dich (pg/sqlite): giao lai message => dong khu trung da co => khong lam gi.
 * Tren D1 (khong hoan tac) thu tu: ghi khoa khu trung truoc roi moi tru; mat dien giua chung co the bo sot mot lo (an toan cho khach, khong thu thua).
 */
export function createSpendFn(rt: Runtime): ImpressionSpendFn {
  return async (req) => {
    const micro = Math.round(Number(req.amountMicroVnd));
    if (!Number.isSafeInteger(micro) || micro < 0) throw new Error('amountMicroVnd khong hop le');
    let exhausted = false;
    await withTx(rt.db, async (db) => {
      const ins = await db.run(
        'INSERT INTO spend_dedupe (idempotency_key, campaign_id, customer_id, amount_micro_vnd, impressions, charged_vnd, created_at) VALUES (?,?,?,?,?,0,?) ON CONFLICT (idempotency_key) DO NOTHING',
        [req.idempotencyKey, req.campaignId, req.customerId, micro, req.impressions, iso(rt)],
      );
      if (ins.changes === 0) return; // da xu ly
      if (micro === 0) return;
      const rows = await db.query<{ spend_remainder_micro: unknown }>(
        'UPDATE campaigns SET spend_remainder_micro = spend_remainder_micro + ? WHERE id = ? RETURNING spend_remainder_micro',
        [micro, req.campaignId],
      );
      if (!rows[0]) return; // chien dich da bi xoa: ghi nhan khoa, khong tru
      const acc = n(rows[0].spend_remainder_micro);
      const whole = Math.floor(acc / MICRO);
      if (whole <= 0) return;
      const r = await spendCampaign(rt, db, req.campaignId, whole, { type: 'impression_batch', id: req.idempotencyKey });
      // chi tru phan du tuong ung so da that su thu; phan bi tu choi (het phan giu) bi bo, khong du no
      const settled = r.charged + r.rejected;
      await db.run('UPDATE campaigns SET spend_remainder_micro = spend_remainder_micro - ? WHERE id = ?', [settled * MICRO, req.campaignId]);
      await db.run('UPDATE spend_dedupe SET charged_vnd = ? WHERE idempotency_key = ?', [r.charged, req.idempotencyKey]);
      exhausted = r.exhausted;
    });
    if (exhausted) await bumpManifest(rt);
  };
}
