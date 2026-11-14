// p1-pricing: gateway -> manifest (gia chot) -> ingest -> spend -> vi, don gia theo khung gio, giao lai khong tru kep, doi bang gia khong doi chien dich dang chay.
import { describe, expect, it } from 'vitest';
import { reconcileRevenue } from '@ams/payments';
import { MICRO_PER_VND, daypartAt, uuidv7 } from '@ams/shared';
import { Dev, createWorld, num, settleMoney, snapshot, type World } from '../src/world.js';

const vnd = (n: number) => n * MICRO_PER_VND;
const AT = '2026-11-12T03:00:00.000Z';

async function snap(w: World, campaignId: string, rows: { region?: string; daypart: 'peak' | 'off_peak'; unit: number; floor?: number; source?: string }[]): Promise<void> {
  await w.rt.db.run('DELETE FROM campaign_prices WHERE campaign_id = ?', [campaignId]);
  for (const r of rows) {
    await w.rt.db.run(
      `INSERT INTO campaign_prices (campaign_id, screen_type, region_id, daypart, unit_price_micro_vnd, floor_micro_vnd, list_price_micro_vnd, model, cpm_micro_vnd, source, source_ref, floored, resolved_by, resolved_at)
       VALUES (?,?,?,?,?,?,NULL,'per_impression',NULL,?,NULL,0,NULL,?)`,
      [campaignId, 'tv', r.region ?? '*', r.daypart, r.unit, r.floor ?? 0, r.source ?? 'rate_card', AT],
    );
  }
  await w.rt.kv.incr('manifest:epoch');
}

/** su kien o qua khu (<= 20h) co khung gio VN mong muon */
function evAt(w: World, want: 'peak' | 'off_peak', k = 0): Record<string, unknown> {
  const c = w.fixture.campaigns[0]!;
  const now = w.rt.clock.now().getTime();
  let t = now - 60_000;
  let hit = 0;
  for (let i = 0; i < 48; i++, t -= 30 * 60_000) {
    if (daypartAt(t) === want && hit++ === k) break;
  }
  return { type: 'impression', event_id: uuidv7(t), ts: new Date(t).toISOString(), campaign_id: c.id, creative_id: c.creatives[0]!.id, slot_id: c.slotId, vcr_pct: 100, played_ms: 15000 };
}

describe('gia that: gateway -> spend -> vi', () => {
  it('don gia theo khung gio cua su kien: peak va off_peak khac nhau; tong tien = tong don gia; spend_events ghi don gia tung luot', async () => {
    const w = await createWorld({ budgetVnd: 1_000_000 });
    try {
      const camp = w.campaignIds[0]!;
      await snap(w, camp, [{ daypart: 'peak', unit: vnd(40) }, { daypart: 'off_peak', unit: vnd(25) }]);
      const d = await Dev.create(w);
      const batch = [evAt(w, 'peak', 0), evAt(w, 'peak', 1), evAt(w, 'off_peak', 0)];
      const r = await d.events(batch);
      expect(await r.json()).toMatchObject({ accepted: 3, valid: 3, flagged: 0 });
      await settleMoney(w);
      const rows = await w.rt.db.query<{ event_id: string; revenue_micro_vnd: unknown }>('SELECT event_id, revenue_micro_vnd FROM ev_ad_impression');
      const byId = new Map(rows.map((x) => [x.event_id, num(x.revenue_micro_vnd)]));
      expect(byId.get(batch[0]!['event_id'] as string)).toBe(vnd(40));
      expect(byId.get(batch[1]!['event_id'] as string)).toBe(vnd(40));
      expect(byId.get(batch[2]!['event_id'] as string)).toBe(vnd(25));
      // spend_events: moi luot mot dong = don gia cua luot; tong = 105 d
      const se = await w.rt.db.query<{ event_id: string; amount_micro_vnd: unknown }>('SELECT event_id, amount_micro_vnd FROM spend_events WHERE campaign_id = ?', [camp]);
      expect(se.map((x) => num(x.amount_micro_vnd)).sort((a, b) => a - b)).toEqual([vnd(25), vnd(40), vnd(40)]);
      const dd = (await w.rt.db.query<{ amount_micro_vnd: unknown; impressions: unknown }>('SELECT amount_micro_vnd, impressions FROM spend_dedupe WHERE campaign_id = ?', [camp]))[0]!;
      expect(num(dd.amount_micro_vnd)).toBe(vnd(105));
      expect(num(dd.impressions)).toBe(3);
      const s = await snapshot(w);
      expect(s.campaigns[0]!.spent).toBe(105);
      expect(s.wallet.spent).toBe(105);
      expect(s.ledgerSpend).toBe(105);
    } finally {
      await w.close();
    }
  });

  it('lo giao lai (mat phan hoi) khong tru kep; doi so cho doanh thu impression van khop (reconcile-revenue)', async () => {
    const w = await createWorld({ budgetVnd: 1_000_000 });
    try {
      const camp = w.campaignIds[0]!;
      await snap(w, camp, [{ daypart: 'peak', unit: 33_333_333 }, { daypart: 'off_peak', unit: 33_333_333 }]);
      const d = await Dev.create(w);
      const batch = [evAt(w, 'peak', 0), evAt(w, 'peak', 1), evAt(w, 'off_peak', 0)];
      await d.events(batch);
      await d.events(batch); // thiet bi gui lai nguyen lo
      await settleMoney(w);
      await d.events(batch);
      await settleMoney(w);
      const s = await snapshot(w);
      expect(s.impressionRows).toHaveLength(3);
      const c = s.campaigns[0]!;
      expect(c.spent * MICRO_PER_VND + c.remainder).toBe(3 * 33_333_333); // dung 3 luot, khong lech micro
      const rec = await reconcileRevenue(w.rt, { days: 7, graceMinutes: 0 });
      expect(rec.found).toEqual([]);
    } finally {
      await w.close();
    }
  });

  it('doi bang gia / sua gia san SAU khi duyet khong doi gia chien dich dang chay (gia chot); gia san trong gia chot duoc ap', async () => {
    const w = await createWorld({ budgetVnd: 1_000_000 });
    try {
      const camp = w.campaignIds[0]!;
      // gia chot 10 d nhung san 18 d: charge = max(unit, floor)
      await snap(w, camp, [{ daypart: 'peak', unit: vnd(10), floor: vnd(18) }, { daypart: 'off_peak', unit: vnd(10), floor: vnd(18) }]);
      // bang gia hien hanh doi mat (khong lien quan den chien dich): tao dong moi cua khach
      await w.rt.db.run("INSERT INTO rate_cards (id, customer_id, screen_type, region_id, daypart, model, price_micro_vnd, floor_micro_vnd, effective_from, active, created_at) VALUES ('rcX','*','*','*','*','per_impression',999000000,0,?,1,?)", [AT, AT]);
      const d = await Dev.create(w);
      await d.events([evAt(w, 'peak', 0), evAt(w, 'off_peak', 0)]);
      await settleMoney(w);
      const rows = await w.rt.db.query<{ revenue_micro_vnd: unknown }>('SELECT revenue_micro_vnd FROM ev_ad_impression');
      expect(rows.map((r) => num(r.revenue_micro_vnd))).toEqual([vnd(18), vnd(18)]);
      expect((await snapshot(w)).campaigns[0]!.spent).toBe(36);
    } finally {
      await w.close();
    }
  });

  it('gia theo khu vuc cua thiet bi: HN co gia rieng, thiet bi o khu vuc khac dung gia "*"', async () => {
    const w = await createWorld({ budgetVnd: 1_000_000, campaigns: 1 });
    try {
      const camp = w.campaignIds[0]!;
      await snap(w, camp, [
        { daypart: 'peak', unit: vnd(40) }, { daypart: 'off_peak', unit: vnd(25) },
        { region: 'HN', daypart: 'peak', unit: vnd(48) }, { region: 'HN', daypart: 'off_peak', unit: vnd(25) },
      ]);
      const hn = await Dev.create(w, { region: 'HN' });
      const hcm = await Dev.create(w, { region: 'HCM' });
      const e1 = evAt(w, 'peak', 0);
      const e2 = evAt(w, 'peak', 1);
      await hn.events([e1]);
      await hcm.events([e2]);
      await settleMoney(w);
      const rows = await w.rt.db.query<{ event_id: string; revenue_micro_vnd: unknown }>('SELECT event_id, revenue_micro_vnd FROM ev_ad_impression');
      const m = new Map(rows.map((x) => [x.event_id, num(x.revenue_micro_vnd)]));
      expect(m.get(e1['event_id'] as string)).toBe(vnd(48));
      expect(m.get(e2['event_id'] as string)).toBe(vnd(40));
    } finally {
      await w.close();
    }
  });

  it('khong co gia chot va khong co gia du phong (production): impression bi danh dau no_price, khong tinh tien', async () => {
    const w = await createWorld({ budgetVnd: 1_000_000, gateway: { policy: { priceMicroVnd: 0 } } });
    try {
      const d = await Dev.create(w);
      const r = await d.events([evAt(w, 'peak', 0), evAt(w, 'off_peak', 0)]);
      expect(await r.json()).toMatchObject({ accepted: 2, valid: 0, flagged: 2 });
      await settleMoney(w);
      const rows = await w.rt.db.query<{ reject_reason: string; revenue_micro_vnd: unknown }>('SELECT reject_reason, revenue_micro_vnd FROM ev_ad_impression');
      expect(rows.map((x) => x.reject_reason)).toEqual(['no_price', 'no_price']);
      expect(rows.every((x) => num(x.revenue_micro_vnd) === 0)).toBe(true);
      expect((await snapshot(w)).wallet.spent).toBe(0);
    } finally {
      await w.close();
    }
  });
});
