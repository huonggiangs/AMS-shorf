// WP-18 (phia API quan tri): cau hinh thuong chien dich + lenh chi tra tao tu app (ngan hang, thue) + xem tai khoan co audit.
import { beforeAll, describe, expect, it } from 'vitest';
import { encField } from '../src/lib/crypto.js';
import { login, setup } from './helpers.js';
import type { Env, Session } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
let env: Env;
let admin: Session;
let finance: Session;
let content: Session;
let lan: Session;
let camp: string;
const db = () => env.rt.db;

beforeAll(async () => {
  env = await setup({}, process.env['W2_SQLITE'] ? 'sqlite' : 'postgres');
  admin = await login(env, env.byRole('super_admin'));
  finance = await login(env, env.byRole('finance'));
  content = await login(env, env.byRole('content_manager'));
  lan = await login(env, 'lan@vinamilk.example');
  camp = (await db().query<{ id: string }>('SELECT id FROM campaigns ORDER BY id LIMIT 1'))[0]!.id;
}, 120_000);

describe('cau hinh thuong chien dich', () => {
  it('mac dinh performance, 0 d; super_admin dat cover/performance + don gia, ghi audit', async () => {
    const before = (await admin.json('GET', `/admin/v1/campaigns/${camp}`)).body;
    expect(before).toMatchObject({ reward_model: 'performance', interaction_reward_vnd: 0 });
    const r = await admin.json('PUT', `/admin/v1/campaigns/${camp}/reward-config`, { reward_model: 'cover', interaction_reward_vnd: 30 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ reward_model: 'cover', interaction_reward_vnd: 30 });
    const row = (await db().query<{ reward_model: string; interaction_reward_vnd: number }>('SELECT reward_model, interaction_reward_vnd FROM campaigns WHERE id = ?', [camp]))[0]!;
    expect([row.reward_model, Number(row.interaction_reward_vnd)]).toEqual(['cover', 30]);
    expect((await db().query('SELECT 1 FROM audit_log WHERE action = ?', ['campaign.reward_config'])).length).toBe(1);
  });
  it('kiem tra o may chu: tran don gia 50, gia tri la, quyen (finance/content/khach 403)', async () => {
    expect((await admin.req('PUT', `/admin/v1/campaigns/${camp}/reward-config`, { reward_model: 'cover', interaction_reward_vnd: 51 })).status).toBe(422);
    expect((await admin.req('PUT', `/admin/v1/campaigns/${camp}/reward-config`, { reward_model: 'hack', interaction_reward_vnd: 10 })).status).toBe(422);
    expect((await admin.req('PUT', `/admin/v1/campaigns/${camp}/reward-config`, { reward_model: 'cover', interaction_reward_vnd: -1 })).status).toBe(422);
    expect((await content.req('PUT', `/admin/v1/campaigns/${camp}/reward-config`, { reward_model: 'cover', interaction_reward_vnd: 10 })).status).toBe(403);
    expect((await lan.req('PUT', `/portal/v1/campaigns/${camp}/reward-config`, { reward_model: 'cover', interaction_reward_vnd: 10 })).status).toBe(404); // cong khach hang khong co route nay (chi noi bo)
    expect((await admin.req('PUT', `/admin/v1/campaigns/khong-co/reward-config`, { reward_model: 'cover', interaction_reward_vnd: 10 })).status).toBe(404);
  });
});

describe('chi tra tao tu app nguoi xem', () => {
  const uid = 'VIEW_U1';
  const pid = 'VIEW_P1';
  beforeAll(async () => {
    const t = '2026-11-12T00:00:00.000Z';
    await db().run('INSERT INTO end_users (id, display_name, created_at) VALUES (?,?,?)', [uid, 'Nguoi xem', t]);
    await db().run("INSERT INTO wallet_ledger (id, user_id, kind, amount_vnd, ref_type, ref_id, status, created_at) VALUES (?,?,?,?,?,?,?,?)", ['VL1', uid, 'reward', 150_000, 'test', null, 'posted', t]);
    const enc = await encField(env.rt, JSON.stringify({ n: '0123456789012', name: 'NGUYEN VAN A' }), `payout:${pid}`);
    await db().run("INSERT INTO payouts (id, user_id, amount_vnd, channel, status, requested_at, idempotency_key, bank_code, bank_name, account_enc, account_last4, tax_mode, requested_via) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", [pid, uid, 120_000, 'bank', 'pending', t, 'k-1234567', 'VCB', 'Vietcombank', enc, '9012', 'auto_pay', 'viewer_app']);
  });
  it('danh sach/chi tiet chi hien ngan hang, 4 so cuoi, che do thue; KHONG lo so tai khoan', async () => {
    const d = await finance.json('GET', `/admin/v1/payouts/${pid}`);
    expect(d.body).toMatchObject({ bank_name: 'Vietcombank', account_last4: '9012', tax_mode: 'auto_pay', requested_via: 'viewer_app', status: 'pending' });
    expect(JSON.stringify(d.body)).not.toContain('0123456789012');
    const l = await finance.json('GET', '/admin/v1/payouts?status=pending');
    expect(JSON.stringify(l.body)).not.toContain('0123456789012');
  });
  it('xem tai khoan day du: chi finance:approve, ghi audit moi lan, khong cache; content_manager 403', async () => {
    expect((await content.req('GET', `/admin/v1/payouts/${pid}/destination`)).status).toBe(403);
    const r = await finance.req('GET', `/admin/v1/payouts/${pid}/destination`);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(await r.json()).toMatchObject({ account_number: '0123456789012', account_name: 'NGUYEN VAN A', amount_vnd: 120_000 });
    await finance.req('GET', `/admin/v1/payouts/${pid}/destination`);
    expect((await db().query('SELECT 1 FROM audit_log WHERE action = ?', ['payout.reveal_destination'])).length).toBe(2);
    // lenh cu (seed) khong co tai khoan luu
    const seedP = (await db().query<{ id: string }>("SELECT id FROM payouts WHERE account_enc IS NULL LIMIT 1"))[0]!;
    expect((await finance.req('GET', `/admin/v1/payouts/${seedP.id}/destination`)).status).toBe(404);
  });
  it('chi tra van do nhan vien tai chinh bam: pay tru vi mot lan, khong du so du thi 409', async () => {
    const ok = await finance.json('POST', `/admin/v1/payouts/${pid}/pay`, { external_ref: 'FT-VIEW-1' });
    expect(ok.status).toBe(200);
    const rows = await db().query<{ amount_vnd: number }>("SELECT amount_vnd FROM wallet_ledger WHERE user_id = ? AND kind = 'payout'", [uid]);
    expect(rows.map((x) => Number(x.amount_vnd))).toEqual([-120_000]);
    expect((await finance.req('POST', `/admin/v1/payouts/${pid}/pay`, { external_ref: 'FT-VIEW-2' })).status).toBe(409);
  });
});
