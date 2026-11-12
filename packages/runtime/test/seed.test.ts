import { describe, expect, it } from 'vitest';
import { seed } from '@ams/db';
import { can } from '@ams/config';
import { decryptField, totp, verifyPassword, verifyTotp } from '@ams/shared';
import { createTestRuntime } from '../src/test.js';

const N = (r: { n: number }[]) => Number(r[0]!.n);

for (const dialect of ['postgres', 'sqlite'] as const) {
  describe(`seed [${dialect}]`, () => {
    it('nap du lieu tu prototype, nhat quan so cai, mat khau/TOTP dung, idempotent', async () => {
      const rt = await createTestRuntime({ dialect });
      const r = await seed(rt, { log: false, passwordParams: { N: 1024 }, adminPassword: 'Pw-Admin-1', adminTotpSecret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' });
      expect(r.skipped).toBe(false);
      expect(r.credentials.find((c) => c.role === 'super_admin')!.email).toBe('admin@ams.local');
      for (const role of ['super_admin', 'content_manager', 'finance', 'device_ops', 'customer', 'partner'])
        expect(r.credentials.some((c) => c.role === role)).toBe(true);

      expect(N(await rt.db.query('SELECT COUNT(*) AS n FROM devices'))).toBe(200);
      expect(N(await rt.db.query('SELECT COUNT(*) AS n FROM customers'))).toBe(12);
      expect(N(await rt.db.query('SELECT COUNT(*) AS n FROM contracts'))).toBe(9);
      expect(N(await rt.db.query('SELECT COUNT(*) AS n FROM campaigns'))).toBe(11);
      const states = (await rt.db.query<{ state: string }>('SELECT DISTINCT state FROM campaigns')).map((x) => x.state).sort();
      expect(states).toEqual(['active', 'awaiting_funds', 'draft', 'paused', 'pending_review', 'scheduled']);

      // so cai khop vi cache, kha dung >= 0, khop tong campaign
      const ws = await rt.db.query<{ customer_id: string; balance_vnd: number; reserved_vnd: number; spent_vnd: number }>('SELECT * FROM ad_wallets');
      expect(ws.length).toBe(12);
      for (const w of ws) {
        const last = (await rt.db.query<{ balance_after: number; reserved_after: number }>('SELECT balance_after, reserved_after FROM wallet_entries WHERE customer_id = ? ORDER BY created_at DESC, id DESC', [w.customer_id]))[0];
        if (last) {
          expect(last.balance_after).toBe(w.balance_vnd);
          expect(last.reserved_after).toBe(w.reserved_vnd);
        }
        const camp = Number((await rt.db.query<{ s: number | null }>("SELECT SUM(reserved_vnd) AS s FROM campaigns WHERE customer_id = ? AND funding_state = 'reserved'", [w.customer_id]))[0]!.s ?? 0);
        expect(camp).toBe(w.reserved_vnd);
        expect(w.balance_vnd).toBeGreaterThanOrEqual(w.reserved_vnd);
      }
      // nap SePay mau: MB Bank 60tr
      const mb = (await rt.db.query<{ balance_vnd: number }>("SELECT w.balance_vnd FROM ad_wallets w JOIN customers c ON c.id = w.customer_id WHERE c.payment_code = 'K004'"))[0]!;
      expect(mb.balance_vnd).toBe(60_000_000);
      expect((await rt.db.query("SELECT 1 FROM topups WHERE status = 'pending'")).length).toBe(1);

      // MST ma hoa, giai ma dung
      const c = (await rt.db.query<{ tax_code_enc: string }>("SELECT tax_code_enc FROM customers WHERE payment_code = 'K001'"))[0]!;
      expect(await decryptField(rt.config.env['FIELD_ENC_KEY']!, c.tax_code_enc, 'customers.tax_code')).toBe('0300588569');

      // dang nhap
      const a = (await rt.db.query<{ password_hash: string; totp_secret_enc: string; role: string }>("SELECT * FROM admins WHERE email = 'admin@ams.local'"))[0]!;
      expect(await verifyPassword('Pw-Admin-1', a.password_hash)).toBe(true);
      const secret = await decryptField(rt.config.env['FIELD_ENC_KEY']!, a.totp_secret_enc, 'admins.totp_secret');
      expect(secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
      expect((await verifyTotp(secret, await totp(secret))).ok).toBe(true);
      expect(can([], a.role, 'campaigns', 'approve')).toBe(true);
      // tai khoan khach gan customer_id, loi moi co token
      expect((await rt.db.query("SELECT 1 FROM admins WHERE account_kind <> 'internal' AND customer_id IS NULL")).length).toBe(0);
      expect(N(await rt.db.query('SELECT COUNT(*) AS n FROM invites'))).toBe(r.credentials.filter((x) => x.status === 'invited').length);

      // chay lai: bo qua
      const again = await seed(rt, { log: false });
      expect(again.skipped).toBe(true);
      expect(N(await rt.db.query('SELECT COUNT(*) AS n FROM customers'))).toBe(12);
      await rt.close();
    }, 60000);
  });
}
