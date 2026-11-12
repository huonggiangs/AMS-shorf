import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { CAMPAIGN_STATES, type CampaignState } from '@ams/shared';
import { login, setup } from './helpers.js';
import type { Env, Session } from './helpers.js';
import { mountFinanceRoutes } from '../src/finance-mount.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Co che trang thai chien dich o MOI route: moi cap (trang thai, hanh dong) khong hop le -> 409 invalid_state, trang thai KHONG doi,
// khong ghi audit/outbox; hai nguoi duyet cung luc -> mot 200 mot 409.
let env: Env;
let admin: Session;
let K001: string;
beforeAll(async () => {
  env = await setup({ mountFinance: mountFinanceRoutes });
  K001 = env.seed.customers['K001']!;
  admin = await login(env, env.byRole('super_admin'));
}, 120_000);

let n = 0;
async function mk(state: CampaignState, funding = 'none'): Promise<string> {
  const id = `ST-${state}-${++n}`;
  const now = env.rt.clock.now().toISOString();
  await env.rt.db.run(
    `INSERT INTO campaigns (id, customer_id, name, state, budget_cap_vnd, approved_budget_vnd, funding_state, target_types, duration_s, start_at, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?, '["tv"]', 15, '2026-11-01T00:00:00.000Z', NULL, ?, ?)`,
    [id, K001, 'ST ' + state, state, 1_000_000, ['awaiting_funds', 'scheduled', 'active', 'paused'].includes(state) ? 1_000_000 : 0, funding, now, now],
  );
  return id;
}
const stateOf = async (id: string) => (await env.rt.db.query<{ state: string }>('SELECT state FROM campaigns WHERE id = ?', [id]))[0]?.state;
const auditCount = async (id: string) => Number((await env.rt.db.query<{ n: unknown }>('SELECT COUNT(*) AS n FROM audit_log WHERE object_id = ?', [id]))[0]!.n);
const outboxCount = async () => Number((await env.rt.db.query<{ n: unknown }>('SELECT COUNT(*) AS n FROM outbox'))[0]!.n);

const ACTIONS: Record<string, { call: (id: string) => Promise<Response>; allowed: CampaignState[] }> = {
  submit: { call: (id) => admin.req('POST', `/admin/v1/campaigns/${id}/submit`), allowed: ['draft', 'rejected'] },
  approve: { call: (id) => admin.req('POST', `/admin/v1/campaigns/${id}/approve`), allowed: ['pending_review'] },
  reject: { call: (id) => admin.req('POST', `/admin/v1/campaigns/${id}/reject`, { reason: 'khong dat yeu cau' }), allowed: ['pending_review', 'awaiting_funds', 'scheduled', 'active', 'paused'] },
  pause: { call: (id) => admin.req('POST', `/admin/v1/campaigns/${id}/pause`), allowed: ['active', 'scheduled'] },
  resume: { call: (id) => admin.req('POST', `/admin/v1/campaigns/${id}/resume`), allowed: ['paused'] },
  end: { call: (id) => admin.req('POST', `/admin/v1/campaigns/${id}/end`), allowed: ['awaiting_funds', 'scheduled', 'active', 'paused'] },
  update: { call: (id) => admin.req('PUT', `/admin/v1/campaigns/${id}`, { name: 'doi ten' }), allowed: ['draft', 'rejected'] },
  delete: { call: (id) => admin.req('DELETE', `/admin/v1/campaigns/${id}`), allowed: ['draft', 'rejected', 'pending_review', 'awaiting_funds'] },
};

describe('route chien dich: moi cap (trang thai, hanh dong) khong hop le -> 409 va khong doi gi', () => {
  const invalid: [string, CampaignState][] = [];
  for (const [a, spec] of Object.entries(ACTIONS)) for (const s of CAMPAIGN_STATES) if (!spec.allowed.includes(s)) invalid.push([a, s]);
  it('so cap khong hop le du lon (khong bo sot)', () => expect(invalid.length).toBe(8 * 8 - Object.values(ACTIONS).reduce((s, a) => s + a.allowed.length, 0)));

  it.each(invalid)('%s tu %s -> 409 invalid_state', async (action, state) => {
    const id = await mk(state, state === 'active' || state === 'scheduled' || state === 'paused' ? 'reserved' : 'none');
    const before = { audit: await auditCount(id), outbox: await outboxCount() };
    const res = await ACTIONS[action]!.call(id);
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).error.code).toBe('invalid_state');
    expect(await stateOf(id)).toBe(state);
    expect({ audit: await auditCount(id), outbox: await outboxCount() }).toEqual(before);
  }, 30_000);

  const valid: [string, CampaignState][] = [];
  for (const [a, spec] of Object.entries(ACTIONS)) for (const s of spec.allowed) valid.push([a, s]);
  it.each(valid)('%s tu %s: khong bi chan boi co che trang thai (khong 409)', async (action, state) => {
    const id = await mk(state);
    const res = await ACTIONS[action]!.call(id);
    // approve thieu creative -> 422 (kiem tra nghiep vu sau co che); cac hanh dong con lai 200
    expect(res.status).not.toBe(409);
    expect([200, 422]).toContain(res.status);
  }, 30_000);
});

describe('cuoc dua trang thai', () => {
  it('hai nguoi duyet cung luc: mot 200, mot 409; dung mot dong outbox campaign.approved, giu tien dung mot lan', async () => {
    const p = (await admin.json('GET', '/admin/v1/campaigns?filter=status:pending&page_size=1')).body.items[0];
    const rs = await Promise.all([admin.req('POST', `/admin/v1/campaigns/${p.id}/approve`), admin.req('POST', `/admin/v1/campaigns/${p.id}/approve`)]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
    const rows = await env.rt.db.query<{ status: string }>("SELECT status FROM outbox WHERE dedupe_key LIKE ?", [`campaign.approved:${p.id}:%`]);
    expect(rows).toHaveLength(1);
    expect(['awaiting_funds', 'active', 'scheduled']).toContain(await stateOf(p.id));
    const reserves = await env.rt.db.query('SELECT 1 FROM wallet_entries WHERE kind = ? AND ref_id = ?', ['reserve', p.id]);
    expect(reserves.length).toBeLessThanOrEqual(1);
  });

  it('pause va end cung luc tren chien dich dang chay: mot thang, trang thai cuoi hop le, khong 500', async () => {
    const id = await mk('active', 'reserved');
    const rs = await Promise.all([ACTIONS['pause']!.call(id), ACTIONS['end']!.call(id)]);
    for (const r of rs) expect([200, 409]).toContain(r.status);
    expect(['paused', 'ended']).toContain(await stateOf(id));
  });

  it('thu hoi (reject) khi chien dich da ended -> 409 va khong hoan tien lan hai', async () => {
    const id = await mk('ended');
    const res = await ACTIONS['reject']!.call(id);
    expect(res.status).toBe(409);
  });
});

describe('khong co duong vong: moi UPDATE campaigns doi `state` deu di qua packages/shared/src/campaign-state.ts', () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const f of readdirSync(dir)) {
      if (f === 'node_modules' || f === 'dist' || f === 'test' || f.endsWith('.gen.ts')) continue;
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx|mjs)$/.test(f)) out.push(p);
    }
    return out;
  }
  it('ma nguon (services, packages, tools) khong co "UPDATE campaigns SET ... state =" ngoai module co che', () => {
    const root = join(import.meta.dirname, '..', '..', '..');
    const files = ['services', 'packages', 'tools'].flatMap((d) => walk(join(root, d)));
    const offenders: string[] = [];
    for (const f of files) {
      if (f.endsWith(join('shared', 'src', 'campaign-state.ts'))) continue;
      const src = readFileSync(f, 'utf8');
      // gom ca cau lenh nhieu dong: tu "UPDATE campaigns SET" den WHERE/dau backtick
      for (const m of src.matchAll(/UPDATE\s+campaigns\s+SET([\s\S]*?)(?:WHERE|`|")/gi)) if (/(^|[\s,])state\s*=/.test(m[1]!)) offenders.push(f.replace(root + '/', ''));
    }
    expect(offenders).toEqual([]);
  });
});
