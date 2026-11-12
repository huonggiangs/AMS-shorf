import { hmacSha256Hex } from '@ams/shared';
import { createTestRuntime, type TestRuntime } from '@ams/runtime';
import { Hono } from 'hono';
import { mountFinance, saveSepayConfig, type FinanceActor, type MountResult } from '../src/index.js';

export const NOW = '2026-11-12T03:00:00.000Z';
export const SECRET = 'test-sepay-secret';

export async function mkRt(dialect: 'postgres' | 'sqlite', env: Record<string, string> = {}): Promise<TestRuntime> {
  const rt = await createTestRuntime({ dialect, now: NOW, env });
  await rt.db.run('INSERT INTO tenants (id, name, created_at) VALUES (?,?,?)', ['T1', 'AMS', NOW]);
  await saveSepayConfig(rt, rt.db, { enabled: true, bank: 'MBBank', account_number: '0123456789', account_holder: 'CONG TY MAU', prefix: 'AMS', min_amount_vnd: 5_000_000, auto_activate: true }, 'test');
  return rt;
}

export async function mkCustomer(rt: TestRuntime, code: string, o: { state?: string; email?: string | null; balance?: number } = {}): Promise<string> {
  const id = rt.id();
  await rt.db.run(
    'INSERT INTO customers (id, tenant_id, legal_name, short_name, payment_code, state, email, created_at) VALUES (?,?,?,?,?,?,?,?)',
    [id, 'T1', 'Cong ty ' + code, code, code, o.state ?? 'active', o.email === undefined ? `${code.toLowerCase()}@example.test` : o.email, NOW],
  );
  if (o.balance) {
    await rt.db.run('INSERT INTO ad_wallets (customer_id, balance_vnd, reserved_vnd, spent_vnd, updated_at) VALUES (?,?,0,0,?)', [id, o.balance, NOW]);
    await rt.db.run('INSERT INTO wallet_entries (id, customer_id, kind, amount_vnd, balance_after, reserved_after, ref_type, ref_id, created_at) VALUES (?,?,?,?,?,0,?,?,?)', [rt.id(), id, 'adjust', o.balance, o.balance, 'seed', null, NOW]);
  }
  return id;
}

let seq = 0;
export async function mkCampaign(rt: TestRuntime, customerId: string, budget: number, o: { startAt?: string | null; createdAt?: string } = {}): Promise<string> {
  const id = rt.id();
  seq++;
  await rt.db.run(
    "INSERT INTO campaigns (id, customer_id, name, state, budget_cap_vnd, start_at, created_at, updated_at) VALUES (?,?,?, 'awaiting_funds', ?, ?, ?, ?)",
    [id, customerId, 'C' + seq, budget, o.startAt === undefined ? '2026-11-01T00:00:00.000Z' : o.startAt, o.createdAt ?? NOW, NOW],
  );
  return id;
}

export async function mkContract(rt: TestRuntime, customerId: string, state = 'pending_sign'): Promise<string> {
  const id = rt.id();
  await rt.db.run('INSERT INTO contracts (id, no, customer_id, title, value_vnd, advance_pct, state, created_at) VALUES (?,?,?,?,?,?,?,?)', [id, 'HD-' + id.slice(-6), customerId, 'HD', 100_000_000, 30, state, NOW]);
  return id;
}

export function webhookBody(o: { id: number | string; amount: number; content: string; type?: string; account?: string }): string {
  return JSON.stringify({ id: o.id, gateway: 'MBBank', transactionDate: '2026-11-12 10:00:00', accountNumber: o.account ?? '0123456789', content: o.content, transferType: o.type ?? 'in', transferAmount: o.amount, referenceCode: 'FT1' });
}

export async function sign(rt: TestRuntime, body: string, o: { secret?: string; skewMs?: number } = {}): Promise<Record<string, string>> {
  const ts = String(Math.floor((rt.clock.now().getTime() + (o.skewMs ?? 0)) / 1000));
  return { 'content-type': 'application/json', 'x-sepay-timestamp': ts, 'x-sepay-signature': 'sha256=' + (await hmacSha256Hex(o.secret ?? SECRET, `${ts}.${body}`)) };
}

export function mkApp(rt: TestRuntime): { app: Hono; mounted: MountResult } {
  const app = new Hono();
  const mounted = mountFinance(app, rt, {
    resolveActor: async (c) => {
      const h = c.req.header('x-test-actor');
      return h ? (JSON.parse(h) as FinanceActor) : null;
    },
  });
  return { app, mounted };
}

export const actorHdr = (a: Partial<FinanceActor> & { id: string; role: string }): Record<string, string> => ({
  'content-type': 'application/json',
  'x-test-actor': JSON.stringify({ account_kind: 'internal', customer_id: null, perms: [], ip: '127.0.0.1', ...a }),
});
export const customerActor = (customerId: string, id = 'U-' + customerId) => actorHdr({ id, role: 'customer', account_kind: 'customer', customer_id: customerId });

export async function wallet(rt: TestRuntime, cid: string) {
  const r = (await rt.db.query<Record<string, unknown>>('SELECT balance_vnd, reserved_vnd, spent_vnd FROM ad_wallets WHERE customer_id = ?', [cid]))[0]!;
  return { balance: Number(r['balance_vnd']), reserved: Number(r['reserved_vnd']), spent: Number(r['spent_vnd']) };
}
export async function campaign(rt: TestRuntime, id: string) {
  const r = (await rt.db.query<Record<string, unknown>>('SELECT state, funding_state, reserved_vnd, spent_vnd FROM campaigns WHERE id = ?', [id]))[0]!;
  return { state: String(r['state']), funding: String(r['funding_state']), reserved: Number(r['reserved_vnd']), spent: Number(r['spent_vnd']) };
}
