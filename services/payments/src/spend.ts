import type { Db, Runtime } from '@ams/runtime';
import { spendCampaign } from './ledger.js';
import { bumpManifest, iso, n, withTx } from './util.js';

/** Hinh dang tuong thich `SpendRequest`/`SpendFn` cua @ams/ingest-consumer (khong import de tranh vong phu thuoc). */
export interface ImpressionSpendRequest {
  campaignId: string;
  customerId: string;
  /** tong doanh thu cua cac impression hop le moi, micro-VND (1 VND = 1.000.000). Bi bo qua khi co `events`. */
  amountMicroVnd: number;
  impressions: number;
  /** on dinh theo tap event_id: goi lai cung khoa KHONG tru lan hai (ban ghi kiem toan theo lo, bang spend_dedupe) */
  idempotencyKey: string;
  firstTs: string;
  lastTs: string;
  /**
   * Khu trung THEO TUNG SU KIEN (khuyen dung): moi event_id chi duoc tinh tien dung mot lan bat ke gom lo/giao lai/mat dien.
   * Neu co, so tien tinh = tong `micro` cua cac event_id CHUA TUNG duoc chiem.
   */
  events?: { id: string; micro: number }[];
}
export type ImpressionSpendFn = (req: ImpressionSpendRequest) => Promise<void>;

export const MICRO = 1_000_000;
/** Chien dich da tra lai/ket thuc: KHONG chi tieu (khong tru tien, khong chiem event). No-op idempotent: giao lai chi lai no-op. */
const CLOSED_STATES = ['rejected', 'ended'];
async function isClosed(db: Db, campaignId: string): Promise<boolean> {
  const row = (await db.query<{ state: string }>('SELECT state FROM campaigns WHERE id = ?', [campaignId]))[0];
  return !!row && CLOSED_STATES.includes(row.state);
}
const CHUNK = 50;

/**
 * Chi tieu impression. Hai buoc, moi buoc IDEMPOTENT va hoi tu sau mat dien o bat ky cau lenh nao:
 *
 *  A. GHI NHAN (nguyen tu, `db.batch`: giao dich tren pg/sqlite, batch nguyen tu tren D1): voi moi event_id,
 *     [chiem event_id trong spend_events (UNIQUE) ; cong micro vao campaigns.spend_remainder_micro CHI KHI chinh lan goi nay chiem duoc (so claim)].
 *     Chiem + cong la MOT don vi => khong the "da chiem ma chua cong" (mat tien) hay "cong hai lan" (tru kep).
 *  B. QUYET TOAN (`settleRemainder`): chuyen phan nguyen VND tu phan du sang so cai qua spendCampaign. Tren pg/sqlite chiem phan du + ghi so cai
 *     nam trong cung mot giao dich. Quyet toan dua tren TRANG THAI phan du (khong dua tren lan goi) nen bat ky lan goi ke tiep nao
 *     cho chien dich do (hoac job `settleSpendRemainders`) deu hoan tat buoc bi dut.
 *
 * Giao lai message => A khong cong gi (event da chiem), B chi quyet toan phan con du => khong tru kep, khong mat.
 * D1 (khong hoan tac): A van nguyen tu nho batch; B chiem phan du TRUOC roi moi ghi so cai, nen mat dien giua hai cau lenh nay co the bo sot toi da mot
 * so VND (nghieng ve phia khach, khong bao gio thu thua) — phat hien bang doi soat so cai.
 */
export function createSpendFn(rt: Runtime): ImpressionSpendFn {
  return async (req) => {
    if (req.events) return spendPerEvent(rt, req, req.events);
    return spendLegacy(rt, req);
  };
}

async function spendPerEvent(rt: Runtime, req: ImpressionSpendRequest, events: { id: string; micro: number }[]): Promise<void> {
  if (await isClosed(rt.db, req.campaignId)) return;
  const now = iso(rt);
  const uniq = new Map<string, number>();
  for (const e of events) {
    const m = Math.round(Number(e.micro));
    if (!Number.isSafeInteger(m) || m < 0) throw new Error('micro cua su kien khong hop le');
    if (!uniq.has(e.id)) uniq.set(e.id, m);
  }
  const list = [...uniq].filter(([, m]) => m > 0);
  // ban ghi kiem toan theo lo (khong quyet dinh tinh tien: quyet dinh la spend_events)
  await rt.db.run(
    'INSERT INTO spend_dedupe (idempotency_key, campaign_id, customer_id, amount_micro_vnd, impressions, charged_vnd, created_at) VALUES (?,?,?,?,?,0,?) ON CONFLICT (idempotency_key) DO NOTHING',
    [req.idempotencyKey, req.campaignId, req.customerId, list.reduce((s, [, m]) => s + m, 0), list.length, now],
  );
  for (let i = 0; i < list.length; i += CHUNK) {
    const claim = rt.id();
    const stmts: { sql: string; params: unknown[] }[] = [];
    for (const [id, micro] of list.slice(i, i + CHUNK)) {
      stmts.push({
        sql: 'INSERT INTO spend_events (event_id, campaign_id, amount_micro_vnd, claim, created_at) VALUES (?,?,?,?,?) ON CONFLICT (event_id) DO NOTHING',
        params: [id, req.campaignId, micro, claim, now],
      });
      stmts.push({
        sql: 'UPDATE campaigns SET spend_remainder_micro = spend_remainder_micro + ? WHERE id = ? AND EXISTS (SELECT 1 FROM spend_events WHERE event_id = ? AND claim = ?)',
        params: [micro, req.campaignId, id, claim],
      });
    }
    await rt.db.batch(stmts);
  }
  const r = await settleRemainder(rt, req.campaignId, req.idempotencyKey);
  if (r.charged > 0) await rt.db.run('UPDATE spend_dedupe SET charged_vnd = charged_vnd + ? WHERE idempotency_key = ?', [r.charged, req.idempotencyKey]);
  if (r.exhausted) await bumpManifest(rt);
}

/** Buoc B: quyet toan phan nguyen VND cua phan du. Idempotent, hoi tu: goi bao nhieu lan cung chi chuyen phan nguyen con lai. */
export async function settleRemainder(rt: Runtime, campaignId: string, ref: string): Promise<{ charged: number; exhausted: boolean }> {
  return withTx(rt.db, async (db: Db) => {
    if (await isClosed(db, campaignId)) return { charged: 0, exhausted: false };
    for (let attempt = 0; attempt < 5; attempt++) {
      const row = (await db.query<{ spend_remainder_micro: unknown }>('SELECT spend_remainder_micro FROM campaigns WHERE id = ?', [campaignId]))[0];
      if (!row) return { charged: 0, exhausted: false };
      const whole = Math.floor(n(row.spend_remainder_micro) / MICRO);
      if (whole <= 0) return { charged: 0, exhausted: false };
      const claim = await db.run('UPDATE campaigns SET spend_remainder_micro = spend_remainder_micro - ? WHERE id = ? AND spend_remainder_micro >= ?', [whole * MICRO, campaignId, whole * MICRO]);
      if (claim.changes !== 1) continue; // quyet toan dong thoi da lay phan nay: doc lai
      // phan vuot phan giu bi tu choi (da tru khoi phan du), khong thanh no
      const r = await spendCampaign(rt, db, campaignId, whole, { type: 'impression_batch', id: ref });
      return { charged: r.charged, exhausted: r.exhausted };
    }
    return { charged: 0, exhausted: false };
  });
}

/** Job dinh ky: quyet toan cac phan du >= 1 VND con sot (vd. mat dien giua buoc A va B khi chien dich khong con phat sinh impression moi). */
export async function settleSpendRemainders(rt: Runtime, limit = 200): Promise<number> {
  const rows = await rt.db.query<{ id: string }>("SELECT id FROM campaigns WHERE spend_remainder_micro >= ? AND state NOT IN ('rejected','ended') ORDER BY id LIMIT ?", [MICRO, limit]);
  let charged = 0;
  for (const c of rows) {
    const r = await settleRemainder(rt, c.id, `sweep:${iso(rt)}`);
    charged += r.charged;
    if (r.exhausted) await bumpManifest(rt);
  }
  return rows.length;
}

/** Xoa ban ghi khu trung cu (event cu hon gateway cho phep da bi tu choi; mac dinh giu 7 ngay). */
export async function pruneSpendEvents(rt: Runtime, keepDays = 7): Promise<number> {
  const cutoff = new Date(rt.clock.now().getTime() - keepDays * 86_400_000).toISOString();
  return (await rt.db.run('DELETE FROM spend_events WHERE created_at < ?', [cutoff])).changes;
}

/** Duong cu (khong co danh sach event): khu trung theo lo bang spend_dedupe. Giu cho client cu/test; consumer moi luon truyen `events`. */
async function spendLegacy(rt: Runtime, req: ImpressionSpendRequest): Promise<void> {
  const micro = Math.round(Number(req.amountMicroVnd));
  if (!Number.isSafeInteger(micro) || micro < 0) throw new Error('amountMicroVnd khong hop le');
  if (await isClosed(rt.db, req.campaignId)) return;
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
    if (!rows[0]) return;
    const whole = Math.floor(n(rows[0].spend_remainder_micro) / MICRO);
    if (whole <= 0) return;
    const r = await spendCampaign(rt, db, req.campaignId, whole, { type: 'impression_batch', id: req.idempotencyKey });
    await db.run('UPDATE campaigns SET spend_remainder_micro = spend_remainder_micro - ? WHERE id = ?', [(r.charged + r.rejected) * MICRO, req.campaignId]);
    await db.run('UPDATE spend_dedupe SET charged_vnd = ? WHERE idempotency_key = ?', [r.charged, req.idempotencyKey]);
    exhausted = r.exhausted;
  });
  if (exhausted) await bumpManifest(rt);
}
