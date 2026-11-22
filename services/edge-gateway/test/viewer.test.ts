// WP-18: phia nguoi xem. Chay tren SQLite (node:sqlite) va PostgreSQL (PGlite) cho luong chinh.
import { afterEach, describe, expect, it } from 'vitest';
import { TEST_FIELD_ENC_KEY } from '@ams/runtime';
import { decryptField, fieldKeyRingFromEnv, uuidv7 } from '@ams/shared';
import { harness, impression, TestDevice, type Harness } from './helpers.js';
import type { OtpSender } from '../src/gateway.js';

const J = async (r: Response): Promise<any> => r.json(); // eslint-disable-line @typescript-eslint/no-explicit-any

class Sms implements OtpSender {
  sent: { to: string; purpose: string; code: string }[] = [];
  async send(m: { to: string; purpose: 'phone_verify' | 'withdraw'; code: string; ttlS: number }): Promise<void> {
    this.sent.push({ to: m.to, purpose: m.purpose, code: m.code });
  }
  last(purpose: string): string {
    const m = [...this.sent].reverse().find((x) => x.purpose === purpose);
    if (!m) throw new Error('chua co OTP ' + purpose);
    return m.code;
  }
}

const open: Harness[] = [];
afterEach(async () => {
  while (open.length) await open.pop()!.close();
});

async function setup(o: { dialect?: 'sqlite' | 'postgres'; env?: Record<string, string>; fixture?: Parameters<typeof harness>[0] extends infer P ? (P extends { fixture?: infer F } ? F : never) : never; policy?: Record<string, unknown> } = {}) {
  const sms = new Sms();
  const h = await harness({ dialect: o.dialect, env: { VIEWER_WITHDRAW_ENABLED: '1', ...o.env }, fixture: o.fixture, gw: { viewer: { otpSender: sms, policy: o.policy as never } } });
  open.push(h);
  return { h, sms };
}
/** TV + dien thoai da ghep doi qua ma 6 so (luong that: TV xin ma, app nhap ma). */
async function pairedPair(h: Harness): Promise<{ tv: TestDevice; phone: TestDevice; userId: string }> {
  const tv = await TestDevice.create(h);
  const phone = await TestDevice.create(h, { kind: 'phone' });
  const code = (await J(await tv.call('POST', '/v1/pair', {}))).code;
  const r = await phone.call('POST', '/v1/viewer/pair', { code });
  expect(r.status).toBe(200);
  const userId = (await h.rt.db.query<{ user_id: string }>('SELECT user_id FROM devices WHERE id = ?', [phone.id]))[0]!.user_id;
  return { tv, phone, userId };
}
const ledger = (h: Harness, userId: string) => h.rt.db.query<{ kind: string; amount_vnd: unknown; ref_type: string; ref_id: string }>("SELECT kind, amount_vnd, ref_type, ref_id FROM wallet_ledger WHERE user_id = ? ORDER BY created_at, id", [userId]);
const sumRewards = async (h: Harness, userId: string) => (await ledger(h, userId)).reduce((s, r) => s + Number(r.amount_vnd), 0);
const interaction = (h: Harness, o: { camp?: number; creative?: number; kind?: string; id?: string; tsOffsetMs?: number } = {}) => {
  const c = h.fixture.campaigns[o.camp ?? 0]!;
  const t = h.rt.clock.now().getTime() + (o.tsOffsetMs ?? -2000);
  return { event_id: o.id ?? uuidv7(t), ts: new Date(t).toISOString(), kind: o.kind ?? 'qr_scan', campaign_id: c.id, creative_id: c.creatives[o.creative ?? 0]!.id, slot_id: c.slotId };
};
async function giveBalance(h: Harness, userId: string, vnd: number): Promise<void> {
  await h.rt.db.run("INSERT INTO wallet_ledger (id, user_id, kind, amount_vnd, ref_type, ref_id, status, created_at) VALUES (?,?,?,?,?,?,?,?)", [h.rt.id(), userId, 'reward', vnd, 'test', null, 'posted', h.rt.clock.now().toISOString()]);
}
async function verifyPhone(h: Harness, sms: Sms, phone: TestDevice, number = '0912345678'): Promise<void> {
  expect((await phone.call('POST', '/v1/viewer/phone', { phone: number })).status).toBe(202);
  const r = await phone.call('POST', '/v1/viewer/phone', { phone: number, otp: sms.last('phone_verify') });
  expect(r.status).toBe(200);
  expect((await J(r)).verified).toBe(true);
}
const bank = { bank_code: 'VCB', bank_name: 'Vietcombank', account_number: '0123456789012', account_name: 'NGUYEN VAN A' };

describe.each(['sqlite', 'postgres'] as const)('viewer API (%s)', (dialect) => {
  it('ghep doi: dien thoai nhap ma 6 so -> TV co nguoi dung va tin cay 1; ma dung mot lan', async () => {
    const { h } = await setup({ dialect });
    const { tv, phone, userId } = await pairedPair(h);
    const row = (await h.rt.db.query<{ user_id: string; trust_level: number }>('SELECT user_id, trust_level FROM devices WHERE id = ?', [tv.id]))[0]!;
    expect(row.user_id).toBe(userId);
    expect(Number(row.trust_level)).toBe(1);
    expect(Number((await h.rt.db.query<{ trust_level: number }>('SELECT trust_level FROM devices WHERE id = ?', [phone.id]))[0]!.trust_level)).toBe(1);
    expect(await J(await tv.call('POST', '/v1/pair', {}))).toMatchObject({ paired: true, trust_level: 1 });
    // ma da dung
    const used = (await h.rt.db.query<{ code: string }>('SELECT code FROM pairing_codes'))[0]!.code;
    const again = await phone.call('POST', '/v1/viewer/pair', { code: used });
    expect(again.status).toBe(404);
    expect((await J(again)).error.code).toBe('invalid_code');
    expect((await h.rt.db.query('SELECT 1 FROM audit_log WHERE action = ?', ['viewer.pair'])).length).toBe(1);
  });

  it('thuong luot xem chi voi chien dich phu (cover); performance khong ghi so cai; gui lai khong cong trung', async () => {
    const { h } = await setup({ dialect, fixture: { campaigns: 2 } });
    await h.rt.db.run("UPDATE campaigns SET reward_model = 'performance' WHERE id = ?", [h.fixture.campaigns[1]!.id]);
    const { tv, userId } = await pairedPair(h);
    const a = impression(h, { camp: 0 });
    const evs = [a, impression(h, { camp: 0 }), impression(h, { camp: 1 })];
    expect((await tv.call('POST', '/v1/events', { events: evs })).status).toBe(202);
    expect((await tv.call('POST', '/v1/events', { events: [a] })).status).toBe(202); // gui lai
    await h.rt.queue.drain();
    const l = await ledger(h, userId);
    expect(l.length).toBe(2);
    expect(l.every((r) => r.kind === 'reward' && r.ref_type === 'impression' && Number(r.amount_vnd) === 10)).toBe(true);
    const rows = await h.rt.db.query<{ campaign_id: string; reward_vnd: number }>('SELECT campaign_id, reward_vnd FROM ev_ad_impression');
    expect(rows.filter((r) => r.campaign_id === h.fixture.campaigns[1]!.id).every((r) => Number(r.reward_vnd) === 0)).toBe(true);
  });

  it('khong lam hong p1/p5: doanh thu/gia chot cua impression khong doi, gui lai giu nguyen reward_vnd va khong tru tran gio hai lan', async () => {
    const { h } = await setup({ dialect, fixture: { campaigns: 1 } });
    const { tv, userId } = await pairedPair(h);
    const a = impression(h, { camp: 0 });
    expect((await tv.call('POST', '/v1/events', { events: [a] })).status).toBe(202);
    expect((await tv.call('POST', '/v1/events', { events: [a] })).status).toBe(202);
    await h.rt.queue.drain();
    const rows = await h.rt.db.query<{ valid: number; revenue_micro_vnd: unknown; reward_vnd: unknown }>('SELECT valid, revenue_micro_vnd, reward_vnd FROM ev_ad_impression WHERE event_id = ?', [String(a['event_id'])]);
    expect(rows.length).toBe(1);
    expect(Number(rows[0]!.valid)).toBe(1);
    expect(Number(rows[0]!.revenue_micro_vnd)).toBeGreaterThan(0);
    expect(Number(rows[0]!.reward_vnd)).toBe(10);
    expect((await ledger(h, userId)).length).toBe(1);
  });

  it('vi: so du = so cai tru lenh dang cho; chi dien thoai moi doc; sao ke co phan trang', async () => {
    const { h } = await setup({ dialect });
    const { tv, phone, userId } = await pairedPair(h);
    for (let i = 0; i < 5; i++) {
      await giveBalance(h, userId, 1000);
      h.rt.clock.advance(1000);
    }
    const w = await J(await phone.call('GET', '/v1/wallet'));
    expect(w).toMatchObject({ paired: true, balance_vnd: 5000, ledger_balance_vnd: 5000, pending_payout_vnd: 0, total_paid_vnd: 0, payout_threshold_vnd: 100000, unit_price_vnd: 20, tax_mode: 'none', phone_verified: false });
    expect(w.devices.map((d: { device_id: string }) => d.device_id)).toEqual([tv.id]);
    expect((await tv.call('GET', '/v1/wallet')).status).toBe(403); // TV khong doc duoc vi
    const p1 = await J(await phone.call('GET', '/v1/wallet/ledger?limit=3'));
    expect(p1.items.length).toBe(3);
    const p2 = await J(await phone.call('GET', `/v1/wallet/ledger?limit=3&cursor=${p1.next_cursor}`));
    expect(p2.items.length).toBe(2);
    expect(p2.next_cursor).toBeUndefined();
    expect(new Set([...p1.items, ...p2.items].map((i: { id: string }) => i.id)).size).toBe(5);
    expect((await phone.call('GET', '/v1/wallet/ledger?cursor=@@')).status).toBe(422);
    const lone = await TestDevice.create(h, { kind: 'phone' });
    expect(await J(await lone.call('GET', '/v1/wallet'))).toMatchObject({ paired: false, balance_vnd: 0 });
  });

  it('tuong tac: thuong theo don gia chien dich (tran 50), khu trung event_id, tran theo chien dich, tu choi thiet bi chua ghep', async () => {
    const { h } = await setup({ dialect, fixture: { rewardModel: 'performance', interactionRewardVnd: 200 } });
    const { phone, userId } = await pairedPair(h);
    const e1 = interaction(h);
    const r1 = await J(await phone.call('POST', '/v1/interactions', { events: [e1] }));
    expect(r1).toMatchObject({ accepted: 1, valid: 1, credited_vnd: 50, rejected: [] }); // 200 bi ep ve tran 50
    const r2 = await J(await phone.call('POST', '/v1/interactions', { events: [e1] }));
    expect(r2).toMatchObject({ accepted: 1, credited_vnd: 0 });
    expect(r2.results[0].status).toBe('duplicate');
    expect(await sumRewards(h, userId)).toBe(50);
    // ten truong cu cua app (interaction thay vi kind) van nhan
    const legacy = { ...interaction(h, { kind: 'tap' }), type: 'interaction', interaction: 'tap' } as Record<string, unknown>;
    delete legacy['kind'];
    expect((await J(await phone.call('POST', '/v1/interactions', { events: [legacy] }))).credited_vnd).toBe(50);
    // tran 3 lan/chien dich/ngay: lan thu 4 bi tu choi
    await phone.call('POST', '/v1/interactions', { events: [interaction(h)] });
    const r4 = await J(await phone.call('POST', '/v1/interactions', { events: [interaction(h)] }));
    expect(r4.rejected).toEqual([{ event_id: expect.any(String), reason: 'campaign_cap' }]);
    expect(await sumRewards(h, userId)).toBe(150);
    // thiet bi chua ghep (trust 0): ghi nhan tu choi, khong tien
    const loner = await TestDevice.create(h, { kind: 'phone' });
    const r5 = await J(await loner.call('POST', '/v1/interactions', { events: [interaction(h)] }));
    expect(r5.rejected[0].reason).toBe('untrusted_device');
    expect(r5.credited_vnd).toBe(0);
    // creative la / chien dich sai
    const bad = { ...interaction(h), creative_id: 'khong-co' };
    expect((await J(await phone.call('POST', '/v1/interactions', { events: [bad] }))).rejected[0].reason).toBe('not_in_manifest');
    const mism = { ...interaction(h), campaign_id: 'khac' };
    expect((await J(await phone.call('POST', '/v1/interactions', { events: [mism] }))).rejected[0].reason).toBe('campaign_mismatch');
    expect((await J(await phone.call('POST', '/v1/interactions', { events: [interaction(h, { tsOffsetMs: -3 * 86400_000 })] }))).rejected[0].reason).toBe('ts_out_of_range');
  });

  it('rut tien: day du luong OTP, cho tai chinh duyet, khong tu chuyen tien, idempotent', async () => {
    const { h, sms } = await setup({ dialect });
    const { phone, userId } = await pairedPair(h);
    await giveBalance(h, userId, 150_000);
    const key = 'idem-' + h.rt.id();
    const body = (o: Record<string, unknown> = {}) => ({ amount_vnd: 120_000, bank, idempotency_key: key, ...o });
    const code = async (r: Response) => (await J(r)).error?.code;
    expect(await code(await phone.call('POST', '/v1/withdraw', body()))).toBe('phone_not_verified');
    await verifyPhone(h, sms, phone);
    expect(await code(await phone.call('POST', '/v1/withdraw', body()))).toBe('tax_consent_required');
    expect((await phone.call('POST', '/v1/tax-authorization', { mode: 'auto_pay', consent_version: 'v0-draft' })).status).toBe(200);
    expect(await code(await phone.call('POST', '/v1/withdraw', body({ amount_vnd: 99_999 })))).toBe('below_threshold');
    expect(await code(await phone.call('POST', '/v1/withdraw', body({ amount_vnd: 150_001 })))).toBe('insufficient_balance');
    // lan dau khong OTP => 403 otp_required + gui OTP toi so da xac minh
    const first = await phone.call('POST', '/v1/withdraw', body());
    expect(first.status).toBe(403);
    expect((await J(first)).error).toMatchObject({ code: 'otp_required', details: { phone_masked: '091****678' } });
    expect(sms.sent.at(-1)).toMatchObject({ to: '0912345678', purpose: 'withdraw' });
    const otp = sms.last('withdraw');
    // OTP gan voi so tien/tai khoan: doi so tien thi vo hieu
    expect(await code(await phone.call('POST', '/v1/withdraw', body({ amount_vnd: 110_000, otp })))).toBe('otp_invalid');
    const wrong = otp === '000000' ? '000001' : '000000';
    expect(await code(await phone.call('POST', '/v1/withdraw', body({ otp: wrong })))).toBe('otp_invalid');
    // (cac lan thu o tren da tieu thu/giu OTP; xin lai)
    const r0 = await phone.call('POST', '/v1/withdraw', body());
    expect((await J(r0)).error.code).toBe('otp_required');
    const ok = await phone.call('POST', '/v1/withdraw', body({ otp: sms.last('withdraw') }));
    expect(ok.status).toBe(201);
    const p = await J(ok);
    expect(p).toMatchObject({ status: 'pending', amount_vnd: 120_000, review: 'awaiting_finance_approval' });
    // so cai KHONG doi (khong tu chuyen tien); chi co payouts pending
    expect(await sumRewards(h, userId)).toBe(150_000);
    const row = (await h.rt.db.query<{ status: string; paid_at: string | null; external_ref: string | null; account_enc: string; account_last4: string; tax_mode: string; requested_via: string }>('SELECT status, paid_at, external_ref, account_enc, account_last4, tax_mode, requested_via FROM payouts WHERE id = ?', [p.payout_id]))[0]!;
    expect(row).toMatchObject({ status: 'pending', paid_at: null, external_ref: null, account_last4: '9012', tax_mode: 'auto_pay', requested_via: 'viewer_app' });
    expect(row.account_enc).not.toContain('0123456789012');
    expect(JSON.parse(await decryptField(fieldKeyRingFromEnv({ FIELD_ENC_KEY: TEST_FIELD_ENC_KEY }), row.account_enc, `payout:${p.payout_id}`))).toEqual({ n: bank.account_number, name: bank.account_name });
    // idempotent: gui lai cung khoa => cung lenh, khong can OTP; doi so tien => 409
    const rep = await phone.call('POST', '/v1/withdraw', body());
    expect(rep.status).toBe(200);
    expect(await J(rep)).toMatchObject({ payout_id: p.payout_id, idempotent_replay: true });
    expect(await code(await phone.call('POST', '/v1/withdraw', body({ amount_vnd: 130_000 })))).toBe('idempotency_conflict');
    expect((await h.rt.db.query('SELECT 1 FROM payouts WHERE user_id = ?', [userId])).length).toBe(1);
    // khoa khac khi con lenh cho: 409 (conflict hoac insufficient vi so du kha dung da tru lenh cho)
    const w = await J(await phone.call('GET', '/v1/wallet'));
    expect(w).toMatchObject({ balance_vnd: 30_000, pending_payout_vnd: 120_000, ledger_balance_vnd: 150_000 });
    expect(w.payouts[0]).toMatchObject({ id: p.payout_id, status: 'pending' });
    expect((await h.rt.db.query('SELECT 1 FROM audit_log WHERE action = ?', ['viewer.withdraw'])).length).toBe(1);
  });

  it('rut tien dong thoi: chi mot lenh duoc tao', async () => {
    const { h, sms } = await setup({ dialect });
    const { phone, userId } = await pairedPair(h);
    await giveBalance(h, userId, 500_000);
    await verifyPhone(h, sms, phone);
    await phone.call('POST', '/v1/tax-authorization', { mode: 'auto_pay', consent_version: 'v0-draft' });
    const b = { amount_vnd: 200_000, bank, idempotency_key: 'race-key-0001' };
    await phone.call('POST', '/v1/withdraw', b);
    const otp = sms.last('withdraw');
    const rs = await Promise.all([1, 2, 3].map(() => phone.call('POST', '/v1/withdraw', { ...b, otp })));
    const st = rs.map((r) => r.status).sort();
    expect(st.filter((s) => s === 201).length).toBeLessThanOrEqual(1);
    expect((await h.rt.db.query('SELECT 1 FROM payouts WHERE user_id = ?', [userId])).length).toBe(1);
  });

  it('khong cho lenh rut thu hai khi con lenh cho (khoa khac)', async () => {
    const { h, sms } = await setup({ dialect });
    const { phone, userId } = await pairedPair(h);
    await giveBalance(h, userId, 900_000);
    await verifyPhone(h, sms, phone);
    await phone.call('POST', '/v1/tax-authorization', { mode: 'delegate', consent_version: 'v0-draft', tax_code: '0123456789' });
    for (const [i, expected] of [[1, 201], [2, 409]] as const) {
      const b = { amount_vnd: 100_000, bank, idempotency_key: 'second-key-000' + i };
      await phone.call('POST', '/v1/withdraw', b);
      const r = await phone.call('POST', '/v1/withdraw', { ...b, otp: sms.last('withdraw') });
      expect(r.status).toBe(expected);
    }
    expect((await h.rt.db.query('SELECT 1 FROM payouts WHERE user_id = ?', [userId])).length).toBe(1);
  });
});

describe('viewer API (rieng le)', () => {
  it('mac dinh TAT rut tien: feature_disabled, khong ghi gi', async () => {
    const sms = new Sms();
    const h = await harness({ gw: { viewer: { otpSender: sms } } });
    open.push(h);
    const { phone, userId } = await pairedPair(h);
    await giveBalance(h, userId, 200_000);
    const r = await phone.call('POST', '/v1/withdraw', { amount_vnd: 100_000, bank, idempotency_key: 'disabled-key-1' });
    expect(r.status).toBe(403);
    expect((await J(r)).error.code).toBe('feature_disabled');
    expect(sms.sent.length).toBe(0);
    expect((await h.rt.db.query('SELECT 1 FROM payouts WHERE user_id = ?', [userId])).length).toBe(0);
  });

  it('khong co cong gui OTP o production-like: not_configured (khong lo OTP)', async () => {
    const h = await harness({ env: { VIEWER_WITHDRAW_ENABLED: '1' } });
    open.push(h);
    const { phone } = await pairedPair(h);
    const r = await phone.call('POST', '/v1/viewer/phone', { phone: '0912345678' });
    expect(r.status).toBe(503);
    expect((await J(r)).error.code).toBe('not_configured');
  });

  it('ghep doi chong do ma: sai 5 lan khoa thiet bi 15 phut; thiet bi khong phai dien thoai bi 403; chua ky 401', async () => {
    const { h } = await setup();
    const tv = await TestDevice.create(h);
    const phone = await TestDevice.create(h, { kind: 'phone' });
    await tv.call('POST', '/v1/pair', {});
    const real = (await h.rt.db.query<{ code: string }>('SELECT code FROM pairing_codes'))[0]!.code;
    const wrong = real === '123456' ? '654321' : '123456';
    for (let i = 0; i < 5; i++) expect((await phone.call('POST', '/v1/viewer/pair', { code: wrong })).status).toBe(404);
    const locked = await phone.call('POST', '/v1/viewer/pair', { code: real });
    expect(locked.status).toBe(429);
    expect(locked.headers.get('retry-after')).toBe('900');
    expect((await tv.call('POST', '/v1/viewer/pair', { code: real })).status).toBe(403);
    const anon = await h.gw.app.request('/v1/viewer/pair', { method: 'POST', body: JSON.stringify({ code: real }), headers: { 'content-type': 'application/json' } });
    expect(anon.status).toBe(401);
    h.rt.clock.advance(16 * 60_000);
    // ma het han (5 phut) => khong con hop le du da het khoa
    const late = await phone.call('POST', '/v1/viewer/pair', { code: real });
    expect(late.status).toBe(404);
    expect((await h.rt.db.query('SELECT user_id FROM devices WHERE id = ?', [phone.id]))[0]).toMatchObject({ user_id: null });
  });

  it('TV da ghep nguoi khac: 409 already_paired; toi da so TV moi tai khoan', async () => {
    const { h } = await setup({ policy: { maxTvsPerUser: 1 } });
    const a = await pairedPair(h);
    const tv2 = await TestDevice.create(h);
    const c2 = (await J(await tv2.call('POST', '/v1/pair', {}))).code;
    expect((await a.phone.call('POST', '/v1/viewer/pair', { code: c2 })).status).toBe(403); // vuot toi da 1 TV
    const b = await TestDevice.create(h, { kind: 'phone' });
    expect((await b.call('POST', '/v1/viewer/pair', { code: c2 })).status).toBe(200);
    const c3 = await TestDevice.create(h);
    await c3.call('POST', '/v1/pair', {});
    await h.rt.db.run('UPDATE devices SET user_id = ? WHERE id = ?', [a.userId, c3.id]);
    const code3 = (await h.rt.db.query<{ code: string }>('SELECT code FROM pairing_codes WHERE device_id = ?', [c3.id]))[0]!.code;
    expect((await J(await b.call('POST', '/v1/viewer/pair', { code: code3 }))).error.code).toBe('already_paired');
  });

  it('chu ky: sua than yeu cau => 401; nonce dung lai => 409; thieu chu ky => 401', async () => {
    const { h } = await setup();
    const { phone } = await pairedPair(h);
    const nonce = 'n'.repeat(24);
    expect((await phone.call('GET', '/v1/wallet', undefined, { nonce })).status).toBe(200);
    expect((await phone.call('GET', '/v1/wallet', undefined, { nonce })).status).toBe(409);
    const res = await h.gw.app.request('/v1/withdraw', { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
    // ky bang khoa khac => 401
    const other = await TestDevice.create(h, { kind: 'phone' });
    expect((await phone.call('GET', '/v1/wallet', undefined, { key: other.keys.privateKey })).status).toBe(401);
  });

  it('tran thuong/ngay: luot xem vuot tran thi khong cong va reward_vnd = 0', async () => {
    const { h } = await setup({ policy: { dailyRewardCapVnd: 25 } });
    const { tv, userId } = await pairedPair(h);
    expect((await tv.call('POST', '/v1/events', { events: [impression(h), impression(h), impression(h), impression(h)] })).status).toBe(202);
    await h.rt.queue.drain();
    expect(await sumRewards(h, userId)).toBe(20);
    const rows = await h.rt.db.query<{ reward_vnd: number }>('SELECT reward_vnd FROM ev_ad_impression');
    expect(rows.map((r) => Number(r.reward_vnd)).sort()).toEqual([0, 0, 10, 10]);
  });

  it('uy quyen thue: lich su chi them dong, phien ban dieu khoan phai khop, MST ma hoa; y chi thue di kem lenh rut', async () => {
    const { h, sms } = await setup();
    const { phone, userId } = await pairedPair(h);
    expect(await J(await phone.call('GET', '/v1/tax-authorization'))).toMatchObject({ mode: 'none', tax_authorization: 'none', remittance_active: false, current_consent_version: 'v0-draft' });
    expect((await phone.call('POST', '/v1/tax-authorization', { mode: 'delegate', consent_version: 'cu', tax_code: '0123456789' })).status).toBe(422);
    expect((await phone.call('POST', '/v1/tax-authorization', { mode: 'delegate', consent_version: 'v0-draft', tax_code: '12' })).status).toBe(422);
    expect((await phone.call('POST', '/v1/tax-authorization', { mode: 'self_declare', consent_version: 'v0-draft' })).status).toBe(422);
    expect((await phone.call('POST', '/v1/tax-authorization', { mode: 'delegate', consent_version: 'v0-draft', tax_code: '0123456789' })).status).toBe(200);
    h.rt.clock.advance(1000);
    expect((await phone.call('POST', '/v1/tax-authorization', { mode: 'none', consent_version: 'v0-draft' })).status).toBe(200);
    expect((await J(await phone.call('GET', '/v1/tax-authorization'))).mode).toBe('none');
    const rows = await h.rt.db.query<{ mode: string; tax_code_enc: string | null }>('SELECT mode, tax_code_enc FROM viewer_tax_authorizations WHERE user_id = ? ORDER BY created_at', [userId]);
    expect(rows.map((r) => r.mode)).toEqual(['delegate', 'none']);
    expect(rows[0]!.tax_code_enc).not.toContain('0123456789');
    // app Mindo gui tax_authorization trong chinh yeu cau rut: duoc ghi thanh dong y (khong can goi rieng)
    await giveBalance(h, userId, 300_000);
    await verifyPhone(h, sms, phone);
    const wb = { amount_vnd: 100_000, bank, idempotency_key: 'tax-with-key-1' };
    expect((await J(await phone.call('POST', '/v1/withdraw', wb))).error.code).toBe('tax_consent_required');
    const w2 = { ...wb, tax_authorization: 'auto_pay' };
    expect((await J(await phone.call('POST', '/v1/withdraw', w2))).error.code).toBe('otp_required');
    expect((await phone.call('POST', '/v1/withdraw', { ...w2, otp: sms.last('withdraw') })).status).toBe(201);
    expect((await J(await phone.call('GET', '/v1/wallet'))).tax_authorization).toBe('auto_pay');
    expect((await h.rt.db.query<{ tax_mode: string }>('SELECT tax_mode FROM payouts WHERE user_id = ?', [userId]))[0]!.tax_mode).toBe('auto_pay');
    expect((await J(await phone.call('POST', '/v1/withdraw', { ...wb, tax_authorization: 'none', idempotency_key: 'tax-with-key-2' }))).error.code).toBe('tax_consent_required');
  });

  it('CORS tuy chon cho app WebView: tat mac dinh, bat bang VIEWER_CORS_ORIGINS', async () => {
    const off = await harness();
    open.push(off);
    expect((await off.gw.app.request('/v1/wallet', { method: 'OPTIONS', headers: { origin: 'https://localhost' } })).headers.get('access-control-allow-origin')).toBeNull();
    const on = await harness({ env: { VIEWER_CORS_ORIGINS: 'https://localhost' } });
    open.push(on);
    const pre = await on.gw.app.request('/v1/wallet', { method: 'OPTIONS', headers: { origin: 'https://localhost' } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe('https://localhost');
    expect(pre.headers.get('access-control-allow-headers')).toContain('x-signature');
    expect((await on.gw.app.request('/v1/wallet', { method: 'OPTIONS', headers: { origin: 'https://evil.test' } })).status).toBe(403);
  });
});
