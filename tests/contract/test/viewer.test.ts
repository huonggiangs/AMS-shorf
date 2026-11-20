// HOP DONG phia nguoi xem (docs/VIEWER-API.md): app Mindo (kind=phone) <-> gateway. Chi dung HTTP cong khai + DB doi chieu.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@ams/edge-gateway/protocol';
import { Dev, createWorld, impression, type World } from '../src/world.js';

let w: World;
beforeAll(async () => {
  w = await createWorld({ campaigns: 2, creativesPerCampaign: 1, env: { HB_MIN_GAP_S: '0', VIEWER_WITHDRAW_ENABLED: '1' } });
});
afterAll(async () => w.close());

const J = async <T = any>(r: Response): Promise<T> => (await r.json()) as T;

async function expectError(r: Response, status: number, code: string): Promise<any> {
  expect(r.status).toBe(status);
  const b = await J(r);
  expect(Object.keys(b)).toEqual(['error']);
  expect(b.error.code).toBe(code);
  expect((ERROR_CODES as Record<string, number>)[code]).toBe(status);
  return b.error;
}

/** TV + dien thoai ghep qua ma 6 so that (luong cua app). */
async function pairedPhone(): Promise<{ phone: Dev; tv: Dev }> {
  const phone = await Dev.create(w, { kind: 'phone', pair: false });
  const tv = await Dev.create(w, { pair: false });
  const code = (await J(await tv.call('POST', '/v1/pair', {}))).code as string;
  const r = await phone.call('POST', '/v1/viewer/pair', { code });
  expect(r.status).toBe(200);
  return { phone, tv };
}

describe('viewer: ghep doi + vi', () => {
  it('chua ghep: vi rong paired=false; ma sai 404 invalid_code; ma dung 200 {paired, device_id, trust_level:1}', async () => {
    const phone = await Dev.create(w, { kind: 'phone', pair: false });
    const empty = await J(await phone.call('GET', '/v1/wallet'));
    expect(empty).toMatchObject({ paired: false, balance_vnd: 0, payouts: [], devices: [], phone_verified: false, withdraw_enabled: true, payout_threshold_vnd: 100000 });
    await expectError(await phone.call('POST', '/v1/viewer/pair', { code: '000000' }), 404, 'invalid_code');
    const tv = await Dev.create(w, { pair: false });
    const code = (await J(await tv.call('POST', '/v1/pair', {}))).code as string;
    const ok = await phone.call('POST', '/v1/viewer/pair', { code });
    expect(ok.status).toBe(200);
    expect(await J(ok)).toMatchObject({ paired: true, device_id: tv.id, trust_level: 1 });
    const wal = await J(await phone.call('GET', '/v1/wallet'));
    expect(wal).toMatchObject({ paired: true, balance_vnd: 0, devices: [{ device_id: tv.id }] });
    for (const k of ['balance_vnd', 'ledger_balance_vnd', 'pending_payout_vnd', 'total_paid_vnd', 'views', 'interactions', 'tax_mode', 'unit_price_vnd', 'payout_threshold_vnd']) expect(wal).toHaveProperty(k);
  });

  it('chi dien thoai doc vi (TV -> 403 forbidden); chua ky -> 401', async () => {
    const tv = await Dev.create(w);
    await expectError(await tv.call('GET', '/v1/wallet'), 403, 'forbidden');
    expect((await w.gw.app.request('/v1/wallet')).status).toBe(401);
  });

  it('luot xem chien dich cover tren TV da ghep -> vi dien thoai; sao ke phan trang; gui lai khong cong trung', async () => {
    const { phone, tv } = await pairedPhone();
    const ev = impression(w, { camp: 0 });
    expect((await tv.events([ev, impression(w, { camp: 0 })])).status).toBe(202);
    expect((await tv.events([ev])).status).toBe(202);
    const wal = await J(await phone.call('GET', '/v1/wallet'));
    expect(wal.views).toBe(2);
    expect(wal.balance_vnd).toBeGreaterThan(0);
    const l1 = await J(await phone.call('GET', '/v1/wallet/ledger?limit=1'));
    expect(l1.items.length).toBe(1);
    expect(typeof l1.next_cursor).toBe('string');
    expect(l1.items[0]).toMatchObject({ kind: 'reward', ref_type: 'impression' });
    const l2 = await J(await phone.call('GET', `/v1/wallet/ledger?limit=1&cursor=${encodeURIComponent(l1.next_cursor)}`));
    expect(l2.items[0].id).not.toBe(l1.items[0].id);
  });
});

describe('viewer: rut tien + OTP + thue', () => {
  it('khong co kenh OTP: /v1/viewer/phone -> 503 not_configured; rut khi chua xac minh -> 403 phone_not_verified; khong tao payouts', async () => {
    const { phone } = await pairedPhone();
    const e = await expectError(await phone.call('POST', '/v1/viewer/phone', { phone: '0912345678' }), 503, 'not_configured');
    expect(JSON.stringify(e)).not.toMatch(/\b\d{6}\b/);
    const body = { amount_vnd: 100000, bank: { bank_name: 'Vietcombank', account_number: '0123456789', account_name: 'NGUYEN VAN A' }, idempotency_key: 'idem-contract-0001' };
    await expectError(await phone.call('POST', '/v1/withdraw', body), 403, 'phone_not_verified');
    await expectError(await phone.call('POST', '/v1/withdraw', { amount_vnd: 'x' }), 422, 'validation_failed');
    expect(await w.rt.db.query('SELECT id FROM payouts')).toEqual([]);
  });

  it('uy quyen thue: phien ban dieu khoan sai -> 422; doi che do thanh cong; remittance_active luon false', async () => {
    const { phone } = await pairedPhone();
    const cur = await J(await phone.call('GET', '/v1/tax-authorization'));
    expect(cur).toMatchObject({ mode: 'none', remittance_active: false });
    await expectError(await phone.call('POST', '/v1/tax-authorization', { mode: 'auto_pay', consent_version: 'cu' }), 422, 'validation_failed');
    const ok = await J(await phone.call('POST', '/v1/tax-authorization', { mode: 'auto_pay', consent_version: cur.current_consent_version }));
    expect(ok).toMatchObject({ mode: 'auto_pay', tax_authorization: 'auto_pay', remittance_active: false });
  });
});

describe('viewer: tuong tac', () => {
  it('thiet bi chua ghep: bi tu choi untrusted_device, khong co dong so cai; body sai -> 422', async () => {
    const lone = await Dev.create(w, { kind: 'phone', pair: false });
    const c = w.fixture.campaigns[0]!;
    const t = w.rt.clock.now().getTime() - 2000;
    const ev = { event_id: impression(w, { camp: 0 })['event_id'], ts: new Date(t).toISOString(), kind: 'qr_scan', campaign_id: c.id, creative_id: c.creatives[0]!.id };
    const r = await J(await lone.call('POST', '/v1/interactions', { events: [ev] }));
    expect(r.valid).toBe(0);
    expect(r.rejected[0].reason).toBe('untrusted_device');
    await expectError(await lone.call('POST', '/v1/interactions', { events: [{ ...ev, event_id: 'abc' }] }), 422, 'validation_failed');
  });
});
