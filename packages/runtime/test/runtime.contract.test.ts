import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrationsFor } from '@ams/db';
import { createTestRuntime, type TestRuntime } from '../src/test.js';

const NOW = '2026-11-12T03:00:00.000Z';
const ALL_TABLES = [
  'tenants', 'admins', 'campaign_grants', 'upload_quotas', 'audit_log', 'admin_permissions', 'end_users', 'devices',
  'device_attestations', 'venues', 'screens', 'screen_groups', 'customers', 'customer_contacts', 'contracts',
  'contract_lines', 'contract_templates', 'receivables', 'advertisers', 'campaigns', 'creatives', 'schedule_slots',
  'partners', 'rtb_floors', 'ad_wallets', 'wallet_entries', 'topups', 'payment_webhooks', 'activation_rules',
  'activation_log', 'payouts', 'wallet_ledger', 'invoices', 'sessions', 'invites', 'mfa', 'settings',
  'refund_requests', 'notifications', 'pairing_codes', 'ev_heartbeat', 'ev_ad_impression', 'ev_proof_of_play',
  'impression_hourly', '_migrations',
];

async function mkCustomer(rt: TestRuntime, code: string, balance = 0) {
  const tenant = (await rt.db.query<{ id: string }>('SELECT id FROM tenants LIMIT 1'))[0]?.id ?? rt.id();
  if (!(await rt.db.query('SELECT 1 FROM tenants WHERE id = ?', [tenant])).length)
    await rt.db.run('INSERT INTO tenants (id, name, created_at) VALUES (?,?,?)', [tenant, 'AMS', NOW]);
  const id = rt.id();
  await rt.db.run(
    "INSERT INTO customers (id, tenant_id, legal_name, short_name, payment_code, state, created_at) VALUES (?,?,?,?,?, 'active', ?)",
    [id, tenant, 'Cong ty ' + code, code, code, NOW],
  );
  await rt.db.run('INSERT INTO ad_wallets (customer_id, balance_vnd, reserved_vnd, spent_vnd, updated_at) VALUES (?,?,0,0,?)', [id, balance, NOW]);
  return id;
}

for (const dialect of ['postgres', 'sqlite'] as const) {
  describe(`runtime contract [${dialect}]`, () => {
    let rt: TestRuntime;
    beforeAll(async () => {
      rt = await createTestRuntime({ dialect, now: NOW });
    });
    afterAll(async () => {
      await rt.close();
    });

    it('dialect dung va migration sach: du bang, _migrations day du, chay lai khong doi', async () => {
      expect(rt.db.dialect).toBe(dialect);
      const names = dialect === 'postgres'
        ? (await rt.db.query<{ n: string }>("SELECT table_name AS n FROM information_schema.tables WHERE table_schema = 'public'")).map((r) => r.n)
        : (await rt.db.query<{ n: string }>("SELECT name AS n FROM sqlite_master WHERE type = 'table'")).map((r) => r.n);
      for (const t of ALL_TABLES) expect(names, `thieu bang ${t}`).toContain(t);
      const applied = (await rt.db.query<{ name: string }>('SELECT name FROM _migrations ORDER BY name')).map((r) => r.name);
      expect(applied).toEqual(migrationsFor(dialect).map((m) => m.name));
      const { migrate } = await import('@ams/db');
      const again = await migrate(rt.db);
      expect(again.applied).toEqual([]);
      expect(again.skipped.length).toBe(applied.length);
    });

    it('giao dich: commit giu, loi thi rollback, long nhau dung savepoint', async () => {
      await rt.db.run('CREATE TABLE tx_t (id TEXT PRIMARY KEY, n BIGINT)');
      await rt.db.tx(async (t) => {
        await t.run('INSERT INTO tx_t VALUES (?, ?)', ['a', 1]);
      });
      await expect(
        rt.db.tx(async (t) => {
          await t.run('INSERT INTO tx_t VALUES (?, ?)', ['b', 2]);
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      await rt.db.tx(async (t) => {
        await t.run('INSERT INTO tx_t VALUES (?, ?)', ['c', 3]);
        await expect(
          t.tx(async (t2) => {
            await t2.run('INSERT INTO tx_t VALUES (?, ?)', ['d', 4]);
            throw new Error('inner');
          }),
        ).rejects.toThrow('inner');
        await t.tx(async (t2) => {
          await t2.run('INSERT INTO tx_t VALUES (?, ?)', ['e', 5]);
        });
      });
      const ids = (await rt.db.query<{ id: string }>('SELECT id FROM tx_t ORDER BY id')).map((r) => r.id);
      expect(ids).toEqual(['a', 'c', 'e']);
      // loi SQL (UNIQUE) ben trong tx cung rollback toan bo
      await expect(
        rt.db.tx(async (t) => {
          await t.run('INSERT INTO tx_t VALUES (?, ?)', ['z', 9]);
          await t.run('INSERT INTO tx_t VALUES (?, ?)', ['a', 9]);
        }),
      ).rejects.toThrow();
      expect((await rt.db.query('SELECT 1 FROM tx_t WHERE id = ?', ['z'])).length).toBe(0);
    });

    it('batch nguyen tu: cau thu hai loi thi cau dau bi huy', async () => {
      await expect(
        rt.db.batch([
          { sql: 'INSERT INTO tx_t VALUES (?, ?)', params: ['bx', 1] },
          { sql: 'INSERT INTO tx_t VALUES (?, ?)', params: ['a', 1] },
        ]),
      ).rejects.toThrow();
      expect((await rt.db.query('SELECT 1 FROM tx_t WHERE id = ?', ['bx'])).length).toBe(0);
      const r = await rt.db.batch([{ sql: 'UPDATE tx_t SET n = n + 1 WHERE id = ?', params: ['a'] }, { sql: 'DELETE FROM tx_t WHERE id = ?', params: ['nope'] }]);
      expect(r.map((x) => x.changes)).toEqual([1, 0]);
    });

    it('kieu du lieu: bigint lon, boolean, NULL, dau ? trong chuoi khong bi doi', async () => {
      await rt.db.run('CREATE TABLE ty_t (id TEXT PRIMARY KEY, big BIGINT, flag INTEGER, note TEXT)');
      const big = 9_000_000_000_000; // 9 nghin ty dong, < 2^53
      await rt.db.run("INSERT INTO ty_t VALUES (?, ?, ?, 'hoi? that ''la?''')", ['k', big, true]);
      const row = (await rt.db.query<{ big: number; flag: number; note: string | null }>('SELECT big, flag, note FROM ty_t WHERE id = ?', ['k']))[0]!;
      expect(row.big).toBe(big);
      expect(typeof row.big).toBe('number');
      expect(row.flag).toBe(1);
      expect(row.note).toBe("hoi? that 'la?'");
      const sum = (await rt.db.query<{ s: number; c: number }>('SELECT SUM(big) AS s, COUNT(*) AS c FROM ty_t'))[0]!;
      expect(sum.s).toBe(big);
      expect(sum.c).toBe(1);
    });

    it('UNIQUE: payment_code, tax_code_hash, provider_txn_id', async () => {
      const a = await mkCustomer(rt, 'U001');
      await expect(mkCustomer(rt, 'U001')).rejects.toThrow();
      await rt.db.run('UPDATE customers SET tax_code_hash = ? WHERE id = ?', ['h1', a]);
      const b = await mkCustomer(rt, 'U002');
      await expect(rt.db.run('UPDATE customers SET tax_code_hash = ? WHERE id = ?', ['h1', b])).rejects.toThrow();
      const ins = (txn: string) =>
        rt.db.run("INSERT INTO topups (id, customer_id, amount_vnd, provider_txn_id, status, requested_at) VALUES (?,?,?,?, 'pending', ?)", [rt.id(), a, 5_000_000, txn, NOW]);
      await ins('T1');
      await expect(ins('T1')).rejects.toThrow();
      await ins('T2');
    });

    it('rang buoc CHECK: so du, tai khoan ngoai bat buoc customer_id', async () => {
      const c = await mkCustomer(rt, 'C001', 100);
      await expect(rt.db.run('UPDATE ad_wallets SET reserved_vnd = 101 WHERE customer_id = ?', [c])).rejects.toThrow();
      await expect(rt.db.run('UPDATE ad_wallets SET balance_vnd = -1 WHERE customer_id = ?', [c])).rejects.toThrow();
      const tenant = (await rt.db.query<{ id: string }>('SELECT id FROM tenants LIMIT 1'))[0]!.id;
      const mk = (kind: string, role: string, cust: string | null) =>
        rt.db.run('INSERT INTO admins (id, tenant_id, email, name, role, account_kind, customer_id, created_at) VALUES (?,?,?,?,?,?,?,?)', [rt.id(), tenant, rt.id() + '@x.vn', 'n', role, kind, cust, NOW]);
      await expect(mk('customer', 'customer', null)).rejects.toThrow();
      await expect(mk('internal', 'finance', c)).rejects.toThrow();
      await expect(mk('internal', 'customer', null)).rejects.toThrow();
      await mk('customer', 'customer', c);
      await mk('internal', 'finance', null);
    });

    it('dua tien: 12 yeu cau dong thoi giu 30 tren so du kha dung 100 -> dung 3 thanh cong', async () => {
      const c = await mkCustomer(rt, 'R001', 100);
      const results = await Promise.all(
        Array.from({ length: 12 }, () =>
          rt.db.run('UPDATE ad_wallets SET reserved_vnd = reserved_vnd + ? WHERE customer_id = ? AND balance_vnd - reserved_vnd >= ?', [30, c, 30]),
        ),
      );
      expect(results.filter((r) => r.changes === 1).length).toBe(3);
      const w = (await rt.db.query<{ reserved_vnd: number }>('SELECT reserved_vnd FROM ad_wallets WHERE customer_id = ?', [c]))[0]!;
      expect(w.reserved_vnd).toBe(90);
    });

    it('dua tien trong giao dich: 2 chien dich tranh 1 so du, chi 1 thang', async () => {
      const c = await mkCustomer(rt, 'R002', 100);
      const reserve = (need: number) =>
        rt.db.tx(async (t) => {
          const r = await t.run('UPDATE ad_wallets SET reserved_vnd = reserved_vnd + ? WHERE customer_id = ? AND balance_vnd - reserved_vnd >= ?', [need, c, need]);
          return r.changes === 1;
        });
      const [x, y] = await Promise.all([reserve(70), reserve(70)]);
      expect([x, y].filter(Boolean).length).toBe(1);
      const w = (await rt.db.query<{ reserved_vnd: number; balance_vnd: number }>('SELECT * FROM ad_wallets WHERE customer_id = ?', [c]))[0]!;
      expect(w.reserved_vnd).toBe(70);
      expect(w.balance_vnd).toBe(100);
    });

    it('bat bien: audit_log va wallet_entries khong UPDATE/DELETE duoc', async () => {
      const c = await mkCustomer(rt, 'A001', 0);
      await rt.db.run('INSERT INTO audit_log (id, ts, actor_id, action, object_type, object_id, diff) VALUES (?,?,?,?,?,?,?)', ['al1', NOW, null, 'login', 'admin', 'x', '{}']);
      await rt.db.run("INSERT INTO wallet_entries (id, customer_id, kind, amount_vnd, balance_after, ref_type, ref_id, created_at) VALUES (?,?, 'topup', 10, 10, 'topup', 'tp1', ?)", ['we1', c, NOW]);
      await expect(rt.db.run("UPDATE audit_log SET action = 'x' WHERE id = 'al1'")).rejects.toThrow(/INSERT|bat bien/);
      await expect(rt.db.run("DELETE FROM audit_log WHERE id = 'al1'")).rejects.toThrow(/INSERT|bat bien/);
      await expect(rt.db.run('UPDATE wallet_entries SET amount_vnd = 99 WHERE id = ?', ['we1'])).rejects.toThrow(/INSERT|bat bien/);
      await expect(rt.db.run('DELETE FROM wallet_entries WHERE id = ?', ['we1'])).rejects.toThrow(/INSERT|bat bien/);
      expect((await rt.db.query('SELECT 1 FROM wallet_entries WHERE id = ? AND amount_vnd = 10', ['we1'])).length).toBe(1);
      // idempotent: mot topup chi ghi so cai mot lan
      await expect(
        rt.db.run("INSERT INTO wallet_entries (id, customer_id, kind, amount_vnd, balance_after, ref_type, ref_id, created_at) VALUES (?,?, 'topup', 10, 20, 'topup', 'tp1', ?)", ['we2', c, NOW]),
      ).rejects.toThrow();
    });

    it('EventStore: khu trung event_id, cong don impression_hourly, heartbeat, proof_of_play', async () => {
      const c = await mkCustomer(rt, 'E001');
      const camp = rt.id();
      await rt.db.run("INSERT INTO campaigns (id, customer_id, name, created_at, updated_at) VALUES (?,?,?,?,?)", [camp, c, 'Camp', NOW, NOW]);
      const ev = (id: string, valid = 1) => ({ ts: '2026-11-12T03:10:00.000Z', event_id: id, campaign_id: camp, device_id: 'd1', valid, revenue_micro_vnd: 5000, reward_vnd: 10, partner_id: 'p1', region_id: 'HN' });
      await rt.events.append('ad_impression', [ev('e1'), ev('e2'), ev('e1')]); // e1 lap trong cung lo
      await rt.events.append('ad_impression', [ev('e2'), ev('e3', 0)]); // e2 lap giua cac lo
      expect(await rt.events.countImpressions(camp)).toBe(2); // e3 invalid khong dem
      expect(await rt.events.countImpressions(camp, '2026-11-12T04:00:00.000Z')).toBe(0);
      const h = await rt.db.query<{ impressions: number; valid: number; revenue_micro_vnd: number; reward_vnd: number }>('SELECT * FROM impression_hourly WHERE campaign_id = ?', [camp]);
      expect(h.length).toBe(1);
      expect(h[0]).toMatchObject({ impressions: 3, valid: 2, revenue_micro_vnd: 10000, reward_vnd: 20 });
      // 5 lan gui trung chi tinh mot lan
      await Promise.all(Array.from({ length: 5 }, () => rt.events.append('ad_impression', [ev('dup')])));
      expect(await rt.events.countImpressions(camp)).toBe(3);
      await rt.events.append('heartbeat', [{ ts: NOW, device_id: 'd1', soc_temp: 55, dl_mbps: 12.5 }]);
      await rt.events.append('proof_of_play', [{ ts: NOW, screen_id: 's1', creative_id: 'cr1', duration_ms: 15000, source: 'led' }]);
      expect((await rt.db.query<{ n: number }>('SELECT COUNT(*) AS n FROM ev_heartbeat'))[0]!.n).toBe(1);
      expect((await rt.db.query<{ n: number }>('SELECT COUNT(*) AS n FROM ev_proof_of_play'))[0]!.n).toBe(1);
      await expect(rt.events.append('ad_impression', [{ ts: NOW }])).rejects.toThrow(/thieu/);
    });

    it('phan trang theo customer_id dung chi muc (loc + sap xep on dinh)', async () => {
      const c = await mkCustomer(rt, 'P001');
      for (let i = 0; i < 25; i++)
        await rt.db.run("INSERT INTO campaigns (id, customer_id, name, state, created_at, updated_at) VALUES (?,?,?,?,?,?)", [rt.id(), c, 'c' + i, i % 2 ? 'draft' : 'active', `2026-11-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`, NOW]);
      const page = await rt.db.query<{ name: string }>('SELECT name FROM campaigns WHERE customer_id = ? AND state = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?', [c, 'active', 5, 5]);
      expect(page.map((r) => r.name)).toEqual(['c14', 'c12', 'c10', 'c8', 'c6']);
    });
  });
}
