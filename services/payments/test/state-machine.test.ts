import { describe, expect, it } from 'vitest';
import { CAMPAIGN_STATES, type CampaignState } from '@ams/shared';
import { createFinanceCore, endDueCampaigns, runActivation, startDueCampaigns } from '../src/index.js';
import { campaign, mkCampaign, mkCustomer, mkRt, wallet } from './helpers.js';

/* Co che trang thai o phia tai chinh/job: moi thay doi `campaigns.state` qua transitionCampaign (UPDATE co dieu kien). */

describe.each(['sqlite', 'postgres'] as const)('payments + co che trang thai (%s)', (dialect) => {
  async function put(rt: Awaited<ReturnType<typeof mkRt>>, cust: string, state: CampaignState, o: { funding?: string; start?: string | null; end?: string | null } = {}) {
    const id = await mkCampaign(rt, cust, 1_000_000, { startAt: o.start === undefined ? '2026-11-01T00:00:00.000Z' : o.start });
    await rt.db.run('UPDATE campaigns SET state = ?, funding_state = ?, approved_budget_vnd = 1000000, end_at = ? WHERE id = ?', [state, o.funding ?? 'none', o.end ?? null, id]);
    return id;
  }

  it('giu tien chi hop le khi chien dich o awaiting_funds; moi trang thai khac -> loi 409, khong cham vi', async () => {
    const rt = await mkRt(dialect);
    const cust = await mkCustomer(rt, 'SM1', { balance: 10_000_000 });
    const core = createFinanceCore(rt);
    for (const s of CAMPAIGN_STATES) {
      if (s === 'awaiting_funds') continue;
      const id = await put(rt, cust, s);
      await expect(core.reserveForCampaign(id, 1_000_000), s).rejects.toMatchObject({ status: 409 });
      expect((await campaign(rt, id)).state).toBe(s);
    }
    expect((await wallet(rt, cust)).reserved).toBe(0);
    const ok = await put(rt, cust, 'awaiting_funds');
    expect((await core.reserveForCampaign(ok, 1_000_000)).state).toBe('active');
    expect(await campaign(rt, ok)).toMatchObject({ state: 'active', funding: 'reserved' });
    await rt.close();
  }, 60_000);

  it('startDueCampaigns: chi scheduled da giu tien va den ngay; paused/active/awaiting_funds khong bi dung toi', async () => {
    const rt = await mkRt(dialect);
    const cust = await mkCustomer(rt, 'SM2', { balance: 10_000_000 });
    const due = await put(rt, cust, 'scheduled', { funding: 'reserved' });
    const notFunded = await put(rt, cust, 'scheduled', { funding: 'awaiting_funds' });
    const future = await put(rt, cust, 'scheduled', { funding: 'reserved', start: '2027-01-01T00:00:00.000Z' });
    const others = await Promise.all((['paused', 'active', 'awaiting_funds', 'ended', 'rejected', 'draft', 'pending_review'] as const).map((s) => put(rt, cust, s, { funding: 'reserved' })));
    expect(await startDueCampaigns(rt)).toBe(1);
    expect((await campaign(rt, due)).state).toBe('active');
    expect((await campaign(rt, notFunded)).state).toBe('scheduled');
    expect((await campaign(rt, future)).state).toBe('scheduled');
    expect(await Promise.all(others.map(async (i) => (await campaign(rt, i)).state))).toEqual(['paused', 'active', 'awaiting_funds', 'ended', 'rejected', 'draft', 'pending_review']);
    expect(await startDueCampaigns(rt)).toBe(0); // idempotent
    await rt.close();
  }, 60_000);

  it('endDueCampaigns: ket thuc active/scheduled/paused het han kem hoan tien; khong dung toi awaiting_funds/ended/rejected; chay lai khong doi', async () => {
    const rt = await mkRt(dialect);
    const cust = await mkCustomer(rt, 'SM3', { balance: 10_000_000 });
    const core = createFinanceCore(rt);
    const expired = '2026-11-10T00:00:00.000Z';
    const a = await put(rt, cust, 'awaiting_funds', { end: expired });
    await core.reserveForCampaign(a, 1_000_000); // -> active, da giu 1.000.000
    await rt.db.run('UPDATE campaigns SET end_at = ? WHERE id = ?', [expired, a]);
    const waiting = await put(rt, cust, 'awaiting_funds', { end: expired });
    const done = await put(rt, cust, 'ended', { end: expired });
    expect(await wallet(rt, cust)).toMatchObject({ reserved: 1_000_000 });
    expect(await endDueCampaigns(rt)).toBe(1);
    expect(await campaign(rt, a)).toMatchObject({ state: 'ended', funding: 'released', reserved: 0 });
    expect((await wallet(rt, cust)).reserved).toBe(0); // hoan phan giu
    expect((await campaign(rt, waiting)).state).toBe('awaiting_funds');
    expect((await campaign(rt, done)).state).toBe('ended');
    expect(await endDueCampaigns(rt)).toBe(0);
    await rt.close();
  }, 60_000);

  it('het ngan sach (chi tieu): chi chien dich da giu tien (scheduled/active/paused) -> ended; nhanh khac khong chuyen duoc', async () => {
    const rt = await mkRt(dialect);
    const cust = await mkCustomer(rt, 'SM4', { balance: 10_000_000 });
    const core = createFinanceCore(rt);
    const c = await put(rt, cust, 'awaiting_funds');
    await core.reserveForCampaign(c, 1_000_000);
    await rt.db.run("UPDATE campaigns SET state = 'paused' WHERE id = ?", [c]); // dang tam dung van tru duoc phan giu con lai
    const r = await core.spendForCampaign(c, 1_000_000);
    expect(r).toMatchObject({ charged: 1_000_000, exhausted: true });
    expect(await campaign(rt, c)).toMatchObject({ state: 'ended', funding: 'released', reserved: 0, spent: 1_000_000 });
    // chien dich chua giu tien khong bao gio bi chi tieu / ket thuc boi chi tieu
    const draft = await put(rt, cust, 'draft');
    expect(await core.spendForCampaign(draft, 100)).toMatchObject({ charged: 0, exhausted: true });
    expect((await campaign(rt, draft)).state).toBe('draft');
    await rt.close();
  }, 60_000);

  it('khach da kich hoat khi nap tien: chi awaiting_funds duoc tu chay; draft/pending_review/paused/ended khong bi doi', async () => {
    const rt = await mkRt(dialect);
    const cust = await mkCustomer(rt, 'SM5', { balance: 10_000_000 });
    const wait = await put(rt, cust, 'awaiting_funds', { funding: 'awaiting_funds' });
    const others = await Promise.all((['draft', 'pending_review', 'paused', 'ended', 'rejected'] as const).map((s) => put(rt, cust, s)));
    const r = await runActivation(rt, rt.db, cust, null);
    expect(r.actions.filter((a) => a.type === 'campaign_funded')).toHaveLength(1);
    expect((await campaign(rt, wait)).state).toBe('active');
    expect(await Promise.all(others.map(async (i) => (await campaign(rt, i)).state))).toEqual(['draft', 'pending_review', 'paused', 'ended', 'rejected']);
    await rt.close();
  }, 60_000);
});
