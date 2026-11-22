// Phia nguoi xem tren workerd: ghep doi, thuong luot xem (khong cong kep), vi, rut tien (lenh dieu kien nguyen tu D1 batch).
import { describe, expect, it } from 'vitest';
import { hmacSha256Hex, sha256Hex } from '@ams/shared';
import { Dev, SECRETS, getWorld, impression, seedMoney, sleep, waitFor, type World } from '../src/world.js';

const J = async (r: Response): Promise<any> => r.json();

async function pairedPhone(w: World) {
  const phone = await Dev.create(w, { kind: 'phone', pair: false });
  const tv = await Dev.create(w, { pair: false });
  const code = (await J(await tv.call('POST', '/v1/pair', {}))).code as string;
  const r = await phone.call('POST', '/v1/viewer/pair', { code });
  expect(r.status).toBe(200);
  return { phone, tv, body: await J(r) };
}

describe('viewer tren workerd', () => {
  it('ghep doi + vi: thuong luot xem cong dung 1 lan du gui trung + 8 lo song song', async () => {
    const w = await getWorld();
    const m = await seedMoney(w);
    const { phone, tv } = await pairedPhone(w);
    await tv.call('GET', '/v1/manifest');
    const evs = Array.from({ length: 6 }, () => impression(m));
    const rs = await Promise.all(Array.from({ length: 8 }, () => tv.events(evs)));
    expect(rs.every((r) => r.status === 202)).toBe(true);
    await waitFor(async () => (await w.rt.db.query<{ n: number }>("SELECT COUNT(*) n FROM wallet_ledger WHERE kind='reward' AND ref_type='impression'"))[0]!.n >= 6, 'thuong duoc ghi');
    await sleep(1500);
    const wal = await J(await phone.call('GET', '/v1/wallet'));
    expect(wal).toMatchObject({ paired: true, views: 6 });
    const rows = await w.rt.db.query<{ n: number }>("SELECT COUNT(DISTINCT ref_id) n FROM wallet_ledger WHERE ref_type='impression' AND ref_id IN (" + evs.map(() => '?').join(',') + ')', evs.map((e) => e['event_id']));
    expect(rows[0]!.n).toBe(6);
    const tot = await w.rt.db.query<{ n: number }>("SELECT COUNT(*) n FROM wallet_ledger WHERE ref_type='impression' AND ref_id IN (" + evs.map(() => '?').join(',') + ')', evs.map((e) => e['event_id']));
    expect(tot[0]!.n).toBe(6); // khong thuong kep
    const l1 = await J(await phone.call('GET', '/v1/wallet/ledger?limit=2'));
    expect(l1.items.length).toBe(2);
    expect(typeof l1.next_cursor).toBe('string');
  });

  it('tuong tac: thiet bi chua ghep bi tu choi; QR scan tu dien thoai da ghep', async () => {
    const w = await getWorld();
    const m = await seedMoney(w);
    const lone = await Dev.create(w, { kind: 'phone', pair: false });
    const c = m.fixture.campaigns[0]!;
    const ev = (id: string) => ({ event_id: id, ts: new Date(Date.now() - 2000).toISOString(), kind: 'qr_scan', campaign_id: c.id, creative_id: c.creatives[0]!.id });
    const r = await J(await lone.call('POST', '/v1/interactions', { events: [ev(impression(m)['event_id'] as string)] }));
    expect(r.valid).toBe(0);
    expect(r.rejected[0].reason).toBe('untrusted_device');
  });

  it('RUT TIEN: 6 yeu cau song song (khac khoa idempotent) -> dung 1 lenh; cung khoa song song -> 1 lenh; so du khop', async () => {
    const w = await getWorld();
    const { phone } = await pairedPhone(w);
    const uid = (await w.rt.db.query<{ user_id: string }>('SELECT user_id FROM devices WHERE id = ?', [phone.id]))[0]!.user_id ?? null;
    // phone co user qua viewer/pair
    const user = uid ?? '';
    expect(user).not.toBe('');
    // gieo so du 300.000 d + so dien thoai da xac minh (kenh OTP that can SMS: cai dat truc tiep trong D1/KV)
    await w.rt.db.run("INSERT INTO wallet_ledger (id, user_id, kind, amount_vnd, ref_type, ref_id, status, created_at) VALUES (?, ?, 'reward', 300000, 'seed', ?, 'posted', ?)", [w.rt.id(), user, 'seed-' + user, new Date().toISOString()]);
    const { encryptField } = await import('@ams/shared');
    await w.rt.db.run('UPDATE end_users SET phone_hash = ?, phone_enc = ?, phone_verified_at = ? WHERE id = ?', ['h' + user, await encryptField(SECRETS.FIELD_ENC_KEY, '0912345678', `phone:${user}`), new Date().toISOString(), user]);
    const bank = { bank_name: 'Vietcombank', account_number: '0123456789', account_name: 'NGUYEN VAN A' };
    const ctx = await sha256Hex(`100000|${bank.account_number}|${bank.bank_name}`);
    const plantOtp = async (code: string) => w.rt.kv.set(`votp:withdraw:${user}`, await hmacSha256Hex(SECRETS.VIEWER_OTP_SECRET, `withdraw|${user}|${ctx}|${code}`), 300);
    await plantOtp('123456');
    const mk = (key: string) => phone.call('POST', '/v1/withdraw', { amount_vnd: 100000, bank, idempotency_key: key, otp: '123456', tax_authorization: 'auto_pay' });
    const rs = await Promise.all(['idem-aaaaaaaa-0001', 'idem-aaaaaaaa-0002', 'idem-aaaaaaaa-0003', 'idem-aaaaaaaa-0004', 'idem-aaaaaaaa-0005', 'idem-aaaaaaaa-0006'].map(mk));
    const codes = rs.map((r) => r.status).sort();
    const bodies = await Promise.all(rs.map((r) => r.clone().text()));
    const created = codes.filter((c) => c === 201).length;
    expect(created, JSON.stringify(bodies)).toBe(1);
    expect((await w.rt.db.query<{ n: number }>("SELECT COUNT(*) n FROM payouts WHERE user_id = ? AND status='pending'", [user]))[0]!.n).toBe(1);
    expect((await w.rt.db.query<{ n: number }>("SELECT COUNT(*) n FROM audit_log WHERE action='viewer.withdraw' AND actor_id = ?", [user]))[0]!.n).toBe(1);
    // cung khoa idempotent: phat lai tra lenh cu
    const win = bodies.map((b) => { try { return JSON.parse(b); } catch { return {}; } }).find((b) => b.status === 'pending' && !b.idempotent_replay)!;
    const key = (await w.rt.db.query<{ idempotency_key: string }>('SELECT idempotency_key FROM payouts WHERE user_id = ?', [user]))[0]!.idempotency_key;
    const again = await J(await mk(key));
    expect(again).toMatchObject({ idempotent_replay: true, payout_id: win.payout_id });
    const wal = await J(await phone.call('GET', '/v1/wallet'));
    expect(wal.pending_payout_vnd).toBe(100000);
  });
});
