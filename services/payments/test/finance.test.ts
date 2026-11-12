import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TestRuntime } from '@ams/runtime';
import { applyBalance, createFinanceCore, createFinancePort, reconcileLedger, reconcileSepay, runDailyFinanceJobs, undoActivation, qrUrl, extractPaymentCode } from '../src/index.js';
import { actorHdr, campaign, customerActor, mkApp, mkCampaign, mkContract, mkCustomer, mkRt, sign, wallet, webhookBody } from './helpers.js';

for (const dialect of ['postgres', 'sqlite'] as const) {
  describe(`payments [${dialect}]`, () => {
    let rt: TestRuntime;
    let app: ReturnType<typeof mkApp>['app'];
    let port: ReturnType<typeof createFinanceCore>;
    let evt = 1000;
    beforeAll(async () => {
      rt = await mkRt(dialect);
      ({ app } = mkApp(rt));
      port = createFinanceCore(rt);
    });
    afterAll(async () => {
      await rt.close();
    });

    const post = async (body: string, headers: Record<string, string>) => app.request('/webhooks/payments/sepay', { method: 'POST', body, headers });
    const send = async (o: { id?: number; amount: number; content: string }) => {
      const body = webhookBody({ id: o.id ?? ++evt, amount: o.amount, content: o.content });
      return post(body, await sign(rt, body));
    };

    it('2 chien dich tranh 1 so du: tong giu <= so du, dung 1 chien dich duoc giu', async () => {
      const cid = await mkCustomer(rt, 'RACE1', { balance: 100_000_000 });
      const a = await mkCampaign(rt, cid, 70_000_000);
      const b = await mkCampaign(rt, cid, 70_000_000);
      const [ra, rb] = await Promise.all([port.reserveForCampaign(a, 70_000_000), port.reserveForCampaign(b, 70_000_000)]);
      expect([ra.state, rb.state].sort()).toEqual(['active', 'awaiting_funds']);
      const loser = ra.state === 'awaiting_funds' ? ra : rb;
      expect(loser.shortfall).toBe(40_000_000);
      const w = await wallet(rt, cid);
      expect(w.reserved).toBe(70_000_000);
      expect(w.reserved).toBeLessThanOrEqual(w.balance);
    });

    it('10 chien dich dong thoi, moi cai 30tr tren 100tr: dung 3 cai duoc giu', async () => {
      const cid = await mkCustomer(rt, 'RACE10', { balance: 100_000_000 });
      const ids = await Promise.all(Array.from({ length: 10 }, () => mkCampaign(rt, cid, 30_000_000)));
      const res = await Promise.all(ids.map((i) => port.reserveForCampaign(i, 30_000_000)));
      expect(res.filter((r) => r.state === 'active')).toHaveLength(3);
      const w = await wallet(rt, cid);
      expect(w.reserved).toBe(90_000_000);
      // reserve lap lai tren chien dich da giu: idempotent, khong giu them
      const first = ids[res.findIndex((r) => r.state === 'active')]!;
      expect((await port.reserveForCampaign(first, 30_000_000)).state).toBe('active');
      expect((await wallet(rt, cid)).reserved).toBe(90_000_000);
    });

    it('chien dich co ngay bat dau o tuong lai -> scheduled, den ngay thi job chuyen active', async () => {
      const cid = await mkCustomer(rt, 'SCHED', { balance: 10_000_000 });
      const c = await mkCampaign(rt, cid, 5_000_000, { startAt: '2026-11-20T00:00:00.000Z' });
      expect((await port.reserveForCampaign(c, 5_000_000)).state).toBe('scheduled');
      rt.clock.set('2026-11-21T00:00:00Z');
      await runDailyFinanceJobs(rt);
      expect((await campaign(rt, c)).state).toBe('active');
      rt.clock.set('2026-11-12T03:00:00Z');
    });

    it('webhook trung x5 (tuan tu va dong thoi) chi cong 1 lan; luu ca ban trung', async () => {
      const cid = await mkCustomer(rt, 'DUP5');
      const body = webhookBody({ id: 777001, amount: 12_000_000, content: 'AMS DUP5 chuyen tien' });
      const headers = await sign(rt, body);
      const rs = await Promise.all([1, 2, 3].map(() => post(body, headers)));
      rs.push(await post(body, headers), await post(body, headers));
      for (const r of rs) {
        expect(r.status).toBe(200);
        expect(await r.json()).toEqual({ success: true });
      }
      expect((await wallet(rt, cid)).balance).toBe(12_000_000);
      const entries = await rt.db.query("SELECT 1 AS x FROM wallet_entries WHERE customer_id = ? AND kind = 'topup'", [cid]);
      expect(entries).toHaveLength(1);
      expect(await rt.db.query("SELECT 1 AS x FROM topups WHERE provider_txn_id = '777001'")).toHaveLength(1);
      const hooks = await rt.db.query<{ result: string }>("SELECT result FROM payment_webhooks WHERE event_id = '777001' OR event_id LIKE 'dup:777001:%'");
      expect(hooks).toHaveLength(5); // moi lan gui deu luu nguyen van
      expect(hooks.filter((h) => h.result === 'credited')).toHaveLength(1);
    });

    it('sai chu ky / timestamp cu / thieu xac thuc bi tu choi nhung van luu nguyen van; khong cong tien', async () => {
      const cid = await mkCustomer(rt, 'BADSIG');
      const before = Number((await rt.db.query<{ k: unknown }>("SELECT COUNT(*) AS k FROM payment_webhooks WHERE result LIKE 'rejected:%'"))[0]!.k);
      const body = webhookBody({ id: 777100, amount: 9_000_000, content: 'AMS BADSIG' });
      expect((await post(body, await sign(rt, body, { secret: 'wrong' }))).status).toBe(401);
      expect((await post(body, await sign(rt, body, { skewMs: 6 * 60_000 }))).status).toBe(401);
      expect((await post(body, await sign(rt, body, { skewMs: -6 * 60_000 }))).status).toBe(401);
      expect((await post(body, { 'content-type': 'application/json' })).status).toBe(401);
      expect((await post(body, { authorization: 'Apikey nope' })).status).toBe(401);
      expect((await post(body + ' ', await sign(rt, body))).status).toBe(401); // sua than sau khi ky
      const after = Number((await rt.db.query<{ k: unknown }>("SELECT COUNT(*) AS k FROM payment_webhooks WHERE result LIKE 'rejected:%'"))[0]!.k);
      expect(after - before).toBe(6);
      expect((await wallet(rt, cid).catch(() => ({ balance: 0 }))).balance).toBe(0);
      const stored = await rt.db.query<{ payload: string }>("SELECT payload FROM payment_webhooks WHERE result LIKE 'rejected:%' ORDER BY id DESC LIMIT 6");
      expect(stored.some((s) => s.payload.includes('777100'))).toBe(true);
      // ke gia mao khong the 'dau doc' id that: gui that sau do van duoc cong
      expect((await post(body, await sign(rt, body))).status).toBe(200);
      expect((await wallet(rt, cid)).balance).toBe(9_000_000);
    });

    it('Authorization: Apikey duoc chap nhan; transferType out bi bo qua', async () => {
      const cid = await mkCustomer(rt, 'APIK');
      const body = webhookBody({ id: 777200, amount: 6_000_000, content: 'AMS APIK' });
      expect((await post(body, { authorization: 'Apikey test-sepay-apikey' })).status).toBe(200);
      expect((await wallet(rt, cid)).balance).toBe(6_000_000);
      const out = webhookBody({ id: 777201, amount: 6_000_000, content: 'AMS APIK', type: 'out' });
      expect((await post(out, await sign(rt, out))).status).toBe(200);
      expect((await wallet(rt, cid)).balance).toBe(6_000_000);
      expect((await rt.db.query<{ result: string }>("SELECT result FROM payment_webhooks WHERE event_id = '777201'"))[0]!.result).toBe('ignored_out');
    });

    it('khong khop ma / khach khong ton tai / so tien sai / tai khoan khoa -> hang doi thu cong, khong cong tien', async () => {
      const cid = await mkCustomer(rt, 'MANU');
      const blocked = await mkCustomer(rt, 'BLK', { state: 'terminated' });
      expect((await send({ amount: 8_000_000, content: 'chuyen tien linh tinh' })).status).toBe(200);
      expect((await send({ amount: 8_000_000, content: 'AMS ZZZ999' })).status).toBe(200);
      expect((await send({ amount: 8_000_000, content: 'AMS BLK' })).status).toBe(200);
      // co yeu cau nap 10tr dang cho nhung chuyen 7tr -> sai so tien
      const r = await app.request('/portal/v1/topups', { method: 'POST', headers: customerActor(cid), body: JSON.stringify({ amount_vnd: 10_000_000 }) });
      expect(r.status).toBe(201);
      expect((await send({ amount: 7_000_000, content: 'AMS MANU' })).status).toBe(200);
      const q = (await (await app.request('/admin/v1/payments/manual-queue', { headers: actorHdr({ id: 'F1', role: 'finance' }) })).json()) as { items: { reason: string; id: string; topup_id: string | null }[] };
      const reasons = q.items.map((i) => i.reason);
      expect(reasons).toEqual(expect.arrayContaining(['no_code', 'unknown_customer', 'customer_blocked', 'amount_mismatch']));
      expect((await wallet(rt, blocked).catch(() => ({ balance: 0 }))).balance).toBe(0);
      expect((await wallet(rt, cid).catch(() => ({ balance: 0 }))).balance).toBe(0);
      // tai chinh xu ly: khach khong ton tai -> gan thu cong
      const unknown = q.items.find((i) => i.reason === 'unknown_customer')!;
      const rs = await app.request(`/admin/v1/payments/manual-queue/${unknown.id}/resolve`, { method: 'POST', headers: actorHdr({ id: 'F1', role: 'finance' }), body: JSON.stringify({ customer_id: cid }) });
      expect(rs.status).toBe(200);
      expect((await wallet(rt, cid)).balance).toBe(8_000_000);
      // lan thu hai bi chan
      expect((await app.request(`/admin/v1/payments/manual-queue/${unknown.id}/resolve`, { method: 'POST', headers: actorHdr({ id: 'F1', role: 'finance' }), body: JSON.stringify({ customer_id: cid }) })).status).toBe(404);
      // sai so tien: xac nhan thu cong topup unmatched
      const mm = q.items.find((i) => i.reason === 'amount_mismatch')!;
      expect(mm.topup_id).toBeTruthy();
      expect((await app.request(`/admin/v1/topups/${mm.topup_id}/confirm`, { method: 'POST', headers: actorHdr({ id: 'F1', role: 'finance' }), body: '{}' })).status).toBe(200);
      expect((await wallet(rt, cid)).balance).toBe(15_000_000);
      expect((await app.request(`/admin/v1/topups/${mm.topup_id}/confirm`, { method: 'POST', headers: actorHdr({ id: 'F1', role: 'finance' }), body: '{}' })).status).toBe(409);
    });

    it('nap thieu muc toi thieu chi cong vi, khong kich hoat; du muc thi kich hoat + hop dong + tai khoan + email', async () => {
      const cid = await mkCustomer(rt, 'ACT1', { state: 'pending_payment' });
      const ct = await mkContract(rt, cid);
      const mails = rt.mail.outbox.length;
      await send({ amount: 3_000_000, content: 'AMS ACT1' });
      expect((await wallet(rt, cid)).balance).toBe(3_000_000);
      expect((await rt.db.query<{ state: string }>('SELECT state FROM customers WHERE id = ?', [cid]))[0]!.state).toBe('pending_payment');
      expect((await rt.db.query<{ state: string }>('SELECT state FROM contracts WHERE id = ?', [ct]))[0]!.state).toBe('pending_sign');
      expect(rt.mail.outbox.length).toBe(mails);
      expect(await rt.db.query('SELECT 1 AS x FROM activation_log WHERE customer_id = ?', [cid])).toHaveLength(0);
      // tong da nap dat muc toi thieu
      await send({ amount: 2_500_000, content: 'AMS ACT1' });
      expect((await rt.db.query<{ state: string }>('SELECT state FROM customers WHERE id = ?', [cid]))[0]!.state).toBe('active');
      const k = (await rt.db.query<{ state: string; paid_pct: unknown }>('SELECT state, paid_pct FROM contracts WHERE id = ?', [ct]))[0]!;
      expect(k.state).toBe('active');
      expect(Number(k.paid_pct)).toBe(30);
      const adm = await rt.db.query<{ status: string; role: string }>("SELECT status, role FROM admins WHERE customer_id = ?", [cid]);
      expect(adm).toEqual([{ status: 'invited', role: 'customer' }]);
      expect(rt.mail.outbox.length).toBe(mails + 1);
      expect(rt.mail.outbox.at(-1)!.to).toBe('act1@example.test');
      const logs = await rt.db.query<{ id: string }>('SELECT id FROM activation_log WHERE customer_id = ?', [cid]);
      expect(logs).toHaveLength(1);
      // hoan tac
      const out = await undoActivation(rt, rt.db, logs[0]!.id, 'F1');
      expect(out.undone.length).toBeGreaterThanOrEqual(3);
      expect((await rt.db.query<{ state: string }>('SELECT state FROM customers WHERE id = ?', [cid]))[0]!.state).toBe('pending_payment');
      expect((await rt.db.query<{ state: string }>('SELECT state FROM contracts WHERE id = ?', [ct]))[0]!.state).toBe('pending_sign');
      expect((await rt.db.query<{ status: string }>('SELECT status FROM admins WHERE customer_id = ?', [cid]))[0]!.status).toBe('disabled');
      expect((await wallet(rt, cid)).balance).toBe(5_500_000); // tien van o vi
      await expect(undoActivation(rt, rt.db, logs[0]!.id, 'F1')).rejects.toThrow();
    });

    it('nap mot lan >= toi thieu kich hoat ngay; chien dich awaiting_funds tu chay THEO THU TU DUYET', async () => {
      const cid = await mkCustomer(rt, 'ORD', { balance: 0 });
      await rt.db.run('INSERT INTO ad_wallets (customer_id, balance_vnd, reserved_vnd, spent_vnd, updated_at) VALUES (?,0,0,0,?) ON CONFLICT (customer_id) DO NOTHING', [cid, '2026-11-12T03:00:00.000Z']);
      const c1 = await mkCampaign(rt, cid, 20_000_000);
      const c2 = await mkCampaign(rt, cid, 5_000_000);
      const c3 = await mkCampaign(rt, cid, 4_000_000);
      expect((await port.reserveForCampaign(c1, 20_000_000)).state).toBe('awaiting_funds');
      rt.clock.set('2026-11-12T03:00:01Z');
      expect((await port.reserveForCampaign(c2, 5_000_000)).state).toBe('awaiting_funds');
      rt.clock.set('2026-11-12T03:00:02Z');
      expect((await port.reserveForCampaign(c3, 4_000_000)).state).toBe('awaiting_funds');
      rt.clock.set('2026-11-12T03:00:00Z');
      // nap 10tr: du cho c2 va c3 nhung c1 (duyet truoc) khong du -> khong nhay coc
      await send({ amount: 10_000_000, content: 'AMS ORD' });
      expect((await campaign(rt, c1)).state).toBe('awaiting_funds');
      expect((await campaign(rt, c2)).state).toBe('awaiting_funds');
      // nap them 15tr -> tong 25tr: c1 (20tr) chay, con 5tr -> c2 chay, c3 doi
      await send({ amount: 15_000_000, content: 'AMS ORD' });
      expect((await campaign(rt, c1)).state).toBe('active');
      expect((await campaign(rt, c2)).state).toBe('active');
      expect((await campaign(rt, c3)).state).toBe('awaiting_funds');
      const w = await wallet(rt, cid);
      expect(w.reserved).toBe(25_000_000);
    });

    it('het ngan sach tu dung; khong bao gio chi vuot phan da giu', async () => {
      const cid = await mkCustomer(rt, 'SPEND', { balance: 20_000_000 });
      const c = await mkCampaign(rt, cid, 10_000_000);
      await port.reserveForCampaign(c, 10_000_000);
      const r1 = await port.spendForCampaign(c, 4_000_000);
      expect(r1).toMatchObject({ charged: 4_000_000, remaining: 6_000_000, exhausted: false });
      // 5 luong chi dong thoi, moi luong 2tr -> tong yeu cau 10tr nhung chi con 6tr
      const rs = await Promise.all(Array.from({ length: 5 }, () => port.spendForCampaign(c, 2_000_000)));
      expect(rs.reduce((s, r) => s + r.charged, 0)).toBe(6_000_000);
      expect(rs.filter((r) => r.charged > 0 && r.exhausted)).toHaveLength(1);
      expect(rs.filter((r) => r.charged === 0)).toHaveLength(2);
      const cs = await campaign(rt, c);
      expect(cs).toMatchObject({ state: 'ended', reserved: 0, spent: 10_000_000, funding: 'released' });
      expect(await port.spendForCampaign(c, 1_000)).toMatchObject({ charged: 0, rejected: 1_000 });
      const w = await wallet(rt, cid);
      expect(w).toEqual({ balance: 10_000_000, reserved: 0, spent: 10_000_000 });
    });

    it('huy chien dich: hoan phan giu chua dung ve kha dung (idempotent) va cap cho chien dich dang cho', async () => {
      const cid = await mkCustomer(rt, 'REL', { balance: 10_000_000 });
      const a = await mkCampaign(rt, cid, 8_000_000);
      const b = await mkCampaign(rt, cid, 8_000_000);
      expect((await port.reserveForCampaign(a, 8_000_000)).state).toBe('active');
      expect((await port.reserveForCampaign(b, 8_000_000)).state).toBe('awaiting_funds');
      await port.spendForCampaign(a, 3_000_000);
      expect(await port.releaseForCampaign(a)).toEqual({ released: 5_000_000 });
      expect(await port.releaseForCampaign(a)).toEqual({ released: 0 });
      // con 7tr kha dung (10tr - 3tr da chi) < 8tr -> b van cho
      expect((await campaign(rt, b)).state).toBe('awaiting_funds');
      expect(await wallet(rt, cid)).toEqual({ balance: 7_000_000, reserved: 0, spent: 3_000_000 });
      await applyBalance(rt.db, rt, { customerId: cid, amount: 1_000_000, kind: 'topup', refType: 'topup', refId: 'x1' });
      // huy chien dich khac de kich hoat cascade
      const c = await mkCampaign(rt, cid, 100_000);
      await port.reserveForCampaign(c, 100_000);
      await port.releaseForCampaign(c);
      expect((await campaign(rt, b)).state).toBe('active');
    });

    it('FinancePort theo hop dong a1: reserve doc approved_budget_vnd, release, scheduled()', async () => {
      const a1 = createFinancePort();
      const cid = await mkCustomer(rt, 'A1P', { balance: 10_000_000 });
      const c = await mkCampaign(rt, cid, 6_000_000);
      await rt.db.run("UPDATE campaigns SET state = 'awaiting_funds', funding_state = 'awaiting_funds', approved_budget_vnd = 6000000 WHERE id = ?", [c]);
      expect(await a1.reserveForCampaign(rt, { campaignId: c, actorId: 'U' })).toEqual({ campaign_state: 'active', reserved_vnd: 6_000_000, shortfall_vnd: 0 });
      expect(await a1.reserveForCampaign(rt, { campaignId: c, actorId: 'U' })).toMatchObject({ reserved_vnd: 6_000_000 }); // idempotent
      const d = await mkCampaign(rt, cid, 6_000_000);
      await rt.db.run("UPDATE campaigns SET state = 'awaiting_funds', funding_state = 'awaiting_funds', approved_budget_vnd = 6000000 WHERE id = ?", [d]);
      expect(await a1.reserveForCampaign(rt, { campaignId: d, actorId: 'U' })).toEqual({ campaign_state: 'awaiting_funds', reserved_vnd: 0, shortfall_vnd: 2_000_000 });
      expect(await a1.releaseForCampaign(rt, { campaignId: c, actorId: 'U', reason: 'huy' })).toEqual({ released_vnd: 6_000_000 });
      expect((await campaign(rt, d)).state).toBe('active'); // tien giai phong tu cap cho chien dich dang cho
      await a1.scheduled!(rt, '15 2 * * *');
      await a1.scheduled!(rt, '*/10 * * * *');
    });

    it('so cai khop cache: reconcileLedger sach, va bat duoc khi cache bi sua tay', async () => {
      const clean = await reconcileLedger(rt);
      // cac vi seed tay o test (khong co dong cai tuong ung cho chien dich...) khong co: tat ca di qua so cai
      expect(clean.mismatches).toEqual([]);
      expect(clean.checked).toBeGreaterThan(5);
      const cid = (await rt.db.query<{ customer_id: string }>('SELECT customer_id FROM ad_wallets LIMIT 1'))[0]!.customer_id;
      await rt.db.run('UPDATE ad_wallets SET balance_vnd = balance_vnd + 1 WHERE customer_id = ?', [cid]);
      const bad = await reconcileLedger(rt);
      expect(bad.mismatches.some((m) => m.customer_id === cid && m.field === 'balance')).toBe(true);
      await rt.db.run('UPDATE ad_wallets SET balance_vnd = balance_vnd - 1 WHERE customer_id = ?', [cid]);
      expect((await reconcileLedger(rt)).mismatches).toEqual([]);
    });

    it('so cai bat bien: UPDATE/DELETE wallet_entries bi chan', async () => {
      await expect(rt.db.run('UPDATE wallet_entries SET amount_vnd = 1')).rejects.toThrow();
      await expect(rt.db.run('DELETE FROM wallet_entries')).rejects.toThrow();
    });

    it('doi soat bu SePay: xu ly giao dich thieu, bo qua cai da co (inject, khong goi mang)', async () => {
      const cid = await mkCustomer(rt, 'RECON');
      await send({ id: 888001, amount: 5_000_000, content: 'AMS RECON' });
      const fetched = [
        { id: 888001, transferType: 'in', transferAmount: 5_000_000, content: 'AMS RECON', accountNumber: '0123456789' },
        { id: 888002, transferType: 'in', transferAmount: 7_000_000, content: 'AMS RECON', accountNumber: '0123456789' },
        { id: 888003, transferType: 'in', transferAmount: 1_000_000, content: 'khong ma' },
        { bogus: true },
      ];
      let calledSince = '';
      const r = await reconcileSepay(rt, async (since) => ((calledSince = since), fetched));
      expect(calledSince).toBeTruthy();
      expect(r).toMatchObject({ checked: 4, missing: 2, credited: 1, queued: 1, skipped: 1, errors: 1 });
      expect((await wallet(rt, cid)).balance).toBe(12_000_000);
      const again = await reconcileSepay(rt, async () => fetched);
      expect(again.credited).toBe(0);
      expect((await wallet(rt, cid)).balance).toBe(12_000_000);
    });

    it('dieu chinh tay can hai nguoi khac nhau; hoan tien can nguoi co quyen duyet va chi phan chua dung', async () => {
      const cid = await mkCustomer(rt, 'TWO', { balance: 10_000_000 });
      const f1 = actorHdr({ id: 'F1', role: 'finance' });
      const f2 = actorHdr({ id: 'F2', role: 'finance' });
      const cm = actorHdr({ id: 'CM', role: 'content_manager' });
      const r = await app.request(`/admin/v1/wallets/${cid}/adjustments`, { method: 'POST', headers: f1, body: JSON.stringify({ amount_vnd: 2_000_000, reason: 'Sua loi nhap lieu' }) });
      expect(r.status).toBe(201);
      const { id } = (await r.json()) as { id: string };
      expect((await app.request(`/admin/v1/wallet-adjustments/${id}/approve`, { method: 'POST', headers: f1, body: '{}' })).status).toBe(403); // cung nguoi
      expect((await app.request(`/admin/v1/wallet-adjustments/${id}/approve`, { method: 'POST', headers: cm, body: '{}' })).status).toBe(403); // khong co quyen
      expect((await app.request(`/admin/v1/wallet-adjustments/${id}/approve`, { method: 'POST', headers: f2, body: '{}' })).status).toBe(200);
      expect((await app.request(`/admin/v1/wallet-adjustments/${id}/approve`, { method: 'POST', headers: f2, body: '{}' })).status).toBe(404);
      expect((await wallet(rt, cid)).balance).toBe(12_000_000);
      // hoan tien
      const c = await mkCampaign(rt, cid, 9_000_000);
      await port.reserveForCampaign(c, 9_000_000); // kha dung con 3tr
      const over = await app.request('/portal/v1/wallet/refund-requests', { method: 'POST', headers: customerActor(cid), body: JSON.stringify({ amount_vnd: 4_000_000 }) });
      expect(over.status).toBe(422);
      const ok = await app.request('/portal/v1/wallet/refund-requests', { method: 'POST', headers: customerActor(cid), body: JSON.stringify({ amount_vnd: 3_000_000, reason: 'Khong dung nua' }) });
      expect(ok.status).toBe(201);
      const rid = ((await ok.json()) as { id: string }).id;
      expect((await app.request(`/admin/v1/refund-requests/${rid}/approve`, { method: 'POST', headers: customerActor(cid), body: '{}' })).status).toBe(403);
      expect((await app.request(`/admin/v1/refund-requests/${rid}/approve`, { method: 'POST', headers: cm, body: '{}' })).status).toBe(403);
      expect((await app.request(`/admin/v1/refund-requests/${rid}/approve`, { method: 'POST', headers: f1, body: '{}' })).status).toBe(200);
      expect((await wallet(rt, cid)).balance).toBe(9_000_000);
      expect((await app.request(`/admin/v1/refund-requests/${rid}/paid`, { method: 'POST', headers: f1, body: JSON.stringify({ voucher_ref: 'UNC-001' }) })).status).toBe(200);
      expect((await reconcileLedger(rt)).mismatches).toEqual([]);
    });

    it('portal: khach A chi thay vi cua minh (khong IDOR); body customer_id bi bo qua; toi thieu 5tr; QR dung dinh dang', async () => {
      const a = await mkCustomer(rt, 'IDORA', { balance: 1_000_000 });
      const b = await mkCustomer(rt, 'IDORB', { balance: 9_000_000 });
      const w = (await (await app.request('/portal/v1/wallet', { headers: customerActor(a) })).json()) as Record<string, any>;
      expect(w.balance_vnd).toBe(1_000_000);
      expect(w.payment).toMatchObject({ bank: 'MBBank', account_number: '0123456789', prefix: 'AMS' });
      expect(JSON.stringify(w)).not.toContain(b);
      const t = await app.request('/portal/v1/topups', { method: 'POST', headers: customerActor(a), body: JSON.stringify({ customer_id: b, amount_vnd: 6_000_000 }) });
      expect(t.status).toBe(201);
      const tj = (await t.json()) as Record<string, any>;
      expect(tj.content).toBe('AMS IDORA');
      expect(tj.qr_url).toBe('https://qr.sepay.vn/img?acc=0123456789&bank=MBBank&amount=6000000&des=AMS%20IDORA');
      expect((await rt.db.query<{ customer_id: string }>('SELECT customer_id FROM topups WHERE id = ?', [tj.id]))[0]!.customer_id).toBe(a);
      const low = await app.request('/portal/v1/topups', { method: 'POST', headers: customerActor(a), body: JSON.stringify({ amount_vnd: 4_999_999 }) });
      expect(low.status).toBe(422);
      // khong dang nhap / tai khoan ngoai goi endpoint admin
      expect((await app.request('/portal/v1/wallet')).status).toBe(401);
      expect((await app.request('/admin/v1/wallets', { headers: customerActor(a) })).status).toBe(403);
      expect((await app.request(`/admin/v1/topups/x/confirm`, { method: 'POST', headers: customerActor(a), body: '{}' })).status).toBe(403);
      expect((await app.request('/admin/v1/settings/sepay', { headers: customerActor(a) })).status).toBe(403);
      // doi tac khong co mo-dun finance
      expect((await app.request('/portal/v1/wallet', { headers: actorHdr({ id: 'P', role: 'partner', account_kind: 'partner', customer_id: a }) })).status).toBe(403);
    });

    it('cau hinh SePay: GET/PUT/test, ngan hang ngoai danh sach bi tu choi, so tai khoan duoc ma hoa trong DB', async () => {
      const f = actorHdr({ id: 'F1', role: 'finance' });
      const g = (await (await app.request('/admin/v1/settings/sepay', { headers: f })).json()) as Record<string, any>;
      expect(g).toMatchObject({ bank: 'MBBank', prefix: 'AMS', env: 'mock', dev_mode: false, has_secret: true, sample_account: true });
      expect((await app.request('/admin/v1/settings/sepay', { method: 'PUT', headers: f, body: JSON.stringify({ bank: 'FakeBank' }) })).status).toBe(400);
      const put = await app.request('/admin/v1/settings/sepay', { method: 'PUT', headers: f, body: JSON.stringify({ bank: 'Vietcombank', account_number: '9704123456', account_holder: 'cong ty abc', prefix: 'ams', min_activate_vnd: 5_000_000 }) });
      expect(put.status).toBe(200);
      const stored = (await rt.db.query<{ value: string }>("SELECT value FROM settings WHERE key = 'sepay'"))[0]!.value;
      expect(stored).not.toContain('9704123456');
      const t = (await (await app.request('/admin/v1/settings/sepay/test', { method: 'POST', headers: f, body: '{}' })).json()) as Record<string, any>;
      expect(t).toMatchObject({ ok: true, signature_ok: true });
      expect((await app.request('/admin/v1/settings/sepay', { method: 'PUT', headers: actorHdr({ id: 'CM', role: 'content_manager' }), body: '{}' })).status).toBe(403);
      // khoi phuc
      await app.request('/admin/v1/settings/sepay', { method: 'PUT', headers: f, body: JSON.stringify({ bank: 'MBBank', account_number: '0123456789', account_holder: 'CONG TY MAU' }) });
    });

    it('cac ham thuan: QR + trich ma chuyen khoan', () => {
      expect(qrUrl({ account: '0123456789', bank: 'MBBank', amount: 1000, content: 'AMS K004' })).toBe('https://qr.sepay.vn/img?acc=0123456789&bank=MBBank&amount=1000&des=AMS%20K004');
      expect(extractPaymentCode('AMS', 'ams k004 chuyen tien')).toBe('K004');
      expect(extractPaymentCode('AMS', 'AMSK004')).toBe('K004');
      expect(extractPaymentCode('AMS', 'MB 123 AMS-K004.')).toBe('K004');
      expect(extractPaymentCode('AMS', 'khong co ma')).toBeNull();
    });
  });
}

describe('dev simulate khong lot vao production', () => {
  it('chi mount khi RUNTIME=docker va SEPAY_MODE != production', async () => {
    const base = await mkRt('sqlite');
    const mk = (runtime: 'docker' | 'cloudflare' | 'test' | 'k8s', env: Record<string, string>) => mkApp({ ...base, config: { runtime, env: { ...base.config.env, ...env } } } as TestRuntime);
    const sim = (app: ReturnType<typeof mkApp>['app']) => app.request('/dev/sepay/simulate', { method: 'POST', headers: actorHdr({ id: 'F1', role: 'finance' }), body: JSON.stringify({ transferAmount: 1, content: 'x' }) });
    expect((await sim(mk('test', { SEPAY_MODE: 'mock' }).app)).status).toBe(404);
    expect((await sim(mk('cloudflare', { SEPAY_MODE: 'sandbox' }).app)).status).toBe(404);
    expect((await sim(mk('docker', { SEPAY_MODE: 'production' }).app)).status).toBe(404);
    expect((await sim(mk('docker', { SEPAY_MODE: undefined as unknown as string }).app)).status).toBe(404); // khong dat = production
    const ok = mk('docker', { SEPAY_MODE: 'mock' });
    expect(ok.mounted.devSimulate).toBe(true);
    const cid = await mkCustomer(base, 'SIMC');
    const r = await ok.app.request('/dev/sepay/simulate', { method: 'POST', headers: actorHdr({ id: 'F1', role: 'finance' }), body: JSON.stringify({ transferAmount: 6_000_000, content: 'AMS SIMC chuyen tien' }) });
    expect(r.status).toBe(200);
    expect(Number((await base.db.query<{ b: unknown }>('SELECT balance_vnd AS b FROM ad_wallets WHERE customer_id = ?', [cid]))[0]!.b)).toBe(6_000_000);
    expect((await ok.app.request('/dev/sepay/simulate', { method: 'POST', headers: actorHdr({ id: 'CM', role: 'content_manager' }), body: '{}' })).status).toBe(403);
    const sett = (await (await ok.app.request('/admin/v1/settings/sepay', { headers: actorHdr({ id: 'F1', role: 'finance' }) })).json()) as { dev_mode: boolean };
    expect(sett.dev_mode).toBe(true);
    await base.close();
  });

  it('khoi dong that bai khi production thieu bi mat hoac SEPAY_MODE la', async () => {
    const base = await mkRt('sqlite');
    const cfg = (env: Record<string, string | undefined>) => ({ ...base, config: { runtime: 'docker', env } }) as TestRuntime;
    expect(() => mkApp(cfg({ SEPAY_MODE: 'production' }))).toThrow(/SEPAY_WEBHOOK_SECRET/);
    expect(() => mkApp(cfg({ SEPAY_MODE: 'prod' }))).toThrow(/SEPAY_MODE/);
    expect(() => mkApp(cfg({ SEPAY_MODE: 'production', SEPAY_WEBHOOK_SECRET: 'x' }))).not.toThrow();
    await base.close();
  });
});
