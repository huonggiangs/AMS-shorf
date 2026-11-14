import { afterEach, describe, expect, it, vi } from 'vitest';
import { bumpOpsCounter } from '@ams/runtime';
import { login, setup } from './helpers.js';
import { runOpsChecks, defaultRules, thresholds, withJobRun } from '../src/ops/checks.js';
import { validateWebhookUrl } from '../src/ops/notifier.js';

afterEach(() => vi.unstubAllGlobals());

const ENV = { OPS_ALERT_EMAILS: 'oncall@example.test', OPS_BACKUP_CHECK: '0' };

describe('p3-ops: kiem tra + canh bao', () => {
  it('mo su co khi 5xx vuot nguong, dedupe, cooldown, tu dong dong va gui thong bao resolved', async () => {
    const env = await setup();
    const rt = env.rt;
    Object.assign(rt.config.env, ENV);
    const sent = () => rt.mail.outbox.length;
    const base = sent();
    await bumpOpsCounter(rt, 'gateway_5xx', 7);
    const r1 = await runOpsChecks(rt);
    expect(r1.opened).toContain('gateway:5xx');
    expect(sent()).toBe(base + 1);
    // chay lai ngay: khong mo them, khong gui lai (cooldown)
    const r2 = await runOpsChecks(rt);
    expect(r2.opened).toHaveLength(0);
    expect(r2.reminded).toHaveLength(0);
    expect(sent()).toBe(base + 1);
    const inc = await rt.db.query<{ occurrences: number }>("SELECT occurrences FROM ops_incidents WHERE rule_key = 'gateway:5xx'");
    expect(inc).toHaveLength(1);
    expect(Number(inc[0]!.occurrences)).toBe(2);
    // qua cooldown S2 (4 gio) nhung o dem da het han -> dieu kien het -> resolved
    rt.clock.advance(5 * 3600_000);
    const r3 = await runOpsChecks(rt);
    expect(r3.resolved).toContain('gateway:5xx');
    expect(sent()).toBe(base + 2);
    const st = await rt.db.query<{ status: string }>("SELECT status FROM ops_incidents WHERE rule_key = 'gateway:5xx'");
    expect(st[0]!.status).toBe('resolved');
  });

  it('phat hien ví lệch sổ cái (S1) và nhac lai khi het cooldown, su co acked thi khong nhac', async () => {
    const env = await setup();
    const rt = env.rt;
    Object.assign(rt.config.env, ENV);
    const w = (await rt.db.query<{ customer_id: string }>('SELECT customer_id FROM ad_wallets LIMIT 1'))[0];
    if (!w) throw new Error('seed thieu vi');
    // lam lech bo nho dem so du (khong dung toi bang bat bien)
    await rt.db.run('UPDATE ad_wallets SET balance_vnd = balance_vnd + 1000 WHERE customer_id = ?', [w.customer_id]);
    const r1 = await runOpsChecks(rt);
    expect(r1.opened).toContain('ledger:drift');
    const row = (await rt.db.query<{ id: string; severity: string }>("SELECT id, severity FROM ops_incidents WHERE rule_key = 'ledger:drift'"))[0]!;
    expect(row.severity).toBe('S1');
    rt.clock.advance(31 * 60_000);
    const r2 = await runOpsChecks(rt);
    expect(r2.reminded).toContain('ledger:drift');
    await rt.db.run("UPDATE ops_incidents SET status = 'acked' WHERE id = ?", [row.id]);
    rt.clock.advance(31 * 60_000);
    const r3 = await runOpsChecks(rt);
    expect(r3.reminded).toHaveLength(0);
    expect(r3.resolved).toHaveLength(0);
  });

  it('backup cu/chua co -> backup:stale; bao cao moi -> tu dong dong', async () => {
    const env = await setup();
    const rt = env.rt;
    Object.assign(rt.config.env, { ...ENV, OPS_BACKUP_CHECK: '1', OPS_BACKUP_KINDS: 'postgres' });
    await withJobRun(rt, 'ops_checks', async () => undefined); // dat moc first_started_at
    rt.clock.advance(30 * 3600_000);
    const r1 = await runOpsChecks(rt, { notify: false });
    expect(r1.opened).toContain('backup:stale:postgres');
    await rt.db.run('INSERT INTO ops_backups (id, kind, ok, finished_at) VALUES (?,?,?,?)', ['b1', 'postgres', 1, rt.clock.now().toISOString()]);
    const r2 = await runOpsChecks(rt, { notify: false });
    expect(r2.resolved).toContain('backup:stale:postgres');
  });

  it('webhook chu ky sai nhieu lan -> webhook:rejected; webhook gui toi URL cau hinh (khong ghi URL vao DB nhat ky)', async () => {
    const env = await setup();
    const rt = env.rt;
    Object.assign(rt.config.env, { ...ENV, OPS_ALERT_WEBHOOK_URL: 'https://hooks.example.test/T/secret-token' });
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: URL, init: RequestInit) => {
      calls.push({ url: String(u), body: JSON.parse(String(init.body)) });
      return new Response('ok', { status: 200 });
    }));
    for (let i = 0; i < 3; i++) {
      await rt.db.run("INSERT INTO payment_webhooks (id, provider, event_id, signature_ok, received_at) VALUES (?,?,?,?,?)", [`w${i}`, 'sepay', `e${i}`, 0, rt.clock.now().toISOString()]);
    }
    const r = await runOpsChecks(rt);
    expect(r.opened).toContain('webhook:rejected');
    expect(calls).toHaveLength(1);
    expect(String(calls[0]!.body['text'])).toContain('S2');
    const logs = await rt.db.query<Record<string, unknown>>('SELECT channel, ok, error FROM ops_notifications');
    expect(JSON.stringify(logs)).not.toContain('secret-token');
    expect(logs.map((l) => l['channel']).sort()).toEqual(['email', 'webhook']);
  });

  it('loi webhook duoc ghi nhan, khong nem; rule loi khong dong su co', async () => {
    const env = await setup();
    const rt = env.rt;
    Object.assign(rt.config.env, { ...ENV, OPS_ALERT_WEBHOOK_URL: 'https://hooks.example.test/x' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 500 })));
    await bumpOpsCounter(rt, 'api_5xx', 50);
    const r = await runOpsChecks(rt);
    expect(r.opened).toContain('api:5xx');
    const bad = await rt.db.query<{ ok: number; error: string }>("SELECT ok, error FROM ops_notifications WHERE channel = 'webhook'");
    expect(Number(bad[0]!.ok)).toBe(0);
    expect(bad[0]!.error).toBe('HTTP 500');
    const rules = defaultRules(thresholds({})).map((x) => (x.group === 'gateway' ? { group: 'gateway', run: async () => { throw new Error('boom'); } } : x));
    const r2 = await runOpsChecks(rt, { rules, notify: false });
    expect(r2.ruleErrors[0]).toContain('gateway');
    expect(r2.resolved).not.toContain('api:5xx');
  });

  it('validateWebhookUrl chan http va dia chi noi bo', () => {
    expect(() => validateWebhookUrl('http://a.example.com/x')).toThrow();
    for (const u of ['https://localhost/x', 'https://127.0.0.1/x', 'https://10.0.0.5/x', 'https://192.168.1.1/x', 'https://169.254.169.254/x', 'https://[::1]/x', 'https://intranet/x']) expect(() => validateWebhookUrl(u), u).toThrow();
    expect(validateWebhookUrl('https://api.telegram.org/botX/sendMessage?chat_id=1').hostname).toBe('api.telegram.org');
  });
});

describe('p3-ops: /status cong khai va route quan tri', () => {
  it('GET /status khong can dang nhap, khong lo thong tin noi bo', async () => {
    const env = await setup();
    const rt = env.rt;
    Object.assign(rt.config.env, ENV);
    const ok = await env.app.request('/status');
    expect(ok.status).toBe(200);
    const b0 = (await ok.json()) as { status: string; components: { id: string; status: string }[] };
    expect(b0.status).toBe('operational');
    expect(b0.components.length).toBeGreaterThanOrEqual(4);
    await rt.kv.del('ops:public_status');
    await bumpOpsCounter(rt, 'gateway_5xx', 100); // S1 -> major_outage cho devices
    await rt.db.run("INSERT INTO ops_incidents (id, rule_key, severity, component, title, detail, public_note, metric_value, status, occurrences, opened_at, last_seen_at) VALUES ('i1','ledger:drift','S1','payments','Vi lech 3 khach K001','chi tiet noi bo K001 ABC','Thanh toán đang được kiểm tra.',3,'open',1,?,?)", [rt.clock.now().toISOString(), rt.clock.now().toISOString()]);
    const res = await env.app.request('/status');
    const text = await res.text();
    const b = JSON.parse(text) as { status: string; components: { id: string; status: string }[] };
    expect(b.status).toBe('major_outage');
    expect(b.components.find((c) => c.id === 'payments')!.status).toBe('major_outage');
    for (const leak of ['K001', 'ledger', 'chi tiet noi bo', 'drift', 'rule', 'detail']) expect(text).not.toContain(leak);
    expect(res.headers.get('cache-control')).toContain('max-age=30');
  });

  it('route quan tri: summary + ack + settings + test-notification can quyen; backup-report can token', async () => {
    const env = await setup();
    const rt = env.rt;
    Object.assign(rt.config.env, { ...ENV, OPS_REPORT_TOKEN: 'tok-test-1234567890' });
    const anon = await env.app.request('/admin/v1/ops/summary');
    expect(anon.status).toBe(401);
    const admin = await login(env, env.byRole('super_admin'));
    await bumpOpsCounter(rt, 'api_5xx', 20);
    const run = await admin.json('POST', '/admin/v1/ops/run?notify=0');
    expect(run.status).toBe(200);
    const sum = await admin.json<{ counts: { S2: number }; incidents: { id: string; rule_key: string; status: string }[] }>('GET', '/admin/v1/ops/summary');
    expect(sum.body.counts.S2).toBeGreaterThanOrEqual(1);
    const inc = sum.body.incidents.find((i) => i.rule_key === 'api:5xx')!;
    expect((await admin.json('POST', `/admin/v1/ops/incidents/${inc.id}/ack`, { note: 'da nhan' })).status).toBe(200);
    expect((await admin.json('POST', `/admin/v1/ops/incidents/${inc.id}/ack`, {})).status).toBe(409);
    expect((await admin.json('PUT', '/admin/v1/ops/settings', { webhook_url: 'http://x.example.com' })).status).toBe(422);
    expect((await admin.json('PUT', '/admin/v1/ops/settings', { emails: ['a@example.test'], webhook_url: 'https://hooks.example.test/abc' })).status).toBe(200);
    const sum2 = await admin.json<{ config: { webhook_configured: boolean; webhook_host: string; emails: string[] } }>('GET', '/admin/v1/ops/summary');
    expect(sum2.body.config).toMatchObject({ webhook_configured: true, webhook_host: 'hooks.example.test', emails: ['a@example.test'] });
    expect(JSON.stringify(sum2.body)).not.toContain('/abc');
    const stored = await rt.db.query<{ value: string }>("SELECT value FROM settings WHERE key = 'ops.alert_webhook'");
    expect(stored[0]!.value).not.toContain('hooks.example.test');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));
    const t = await admin.json<{ results: { channel: string; ok: boolean }[] }>('POST', '/admin/v1/ops/test-notification');
    expect(t.body.results.every((x) => x.ok)).toBe(true);
    // backup-report
    const bad = await env.app.request('/ops/backup-report', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer sai' }, body: '{}' });
    expect(bad.status).toBe(401);
    const good = await env.app.request('/ops/backup-report', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer tok-test-1234567890' }, body: JSON.stringify({ kind: 'postgres', ok: true, bytes: 10, encrypted: true, sha256: 'a'.repeat(64) }) });
    expect(good.status).toBe(200);
    expect(Number((await rt.db.query<{ n: number }>('SELECT COUNT(*) AS n FROM ops_backups'))[0]!.n)).toBe(1);
    // khong dat token -> endpoint tat
    delete rt.config.env['OPS_REPORT_TOKEN'];
    expect((await env.app.request('/ops/backup-report', { method: 'POST', body: '{}' })).status).toBe(404);
    // vai tro khong co quyen admin
    const fin = await login(env, env.byRole('finance'));
    expect((await fin.json('GET', '/admin/v1/ops/summary')).status).toBe(403);
  });
});

describe('p3-ops: SQLite/D1', () => {
  it('kiem tra + job run + status chay tren dialect sqlite', async () => {
    const env = await setup({}, 'sqlite');
    const rt = env.rt;
    Object.assign(rt.config.env, ENV);
    await bumpOpsCounter(rt, 'api_5xx', 30);
    await withJobRun(rt, 'ops_checks', async () => runOpsChecks(rt));
    expect(Number((await rt.db.query<{ n: number }>("SELECT COUNT(*) AS n FROM ops_incidents WHERE rule_key = 'api:5xx'"))[0]!.n)).toBe(1);
    const j = (await rt.db.query<{ runs: number; last_success_at: string }>("SELECT runs, last_success_at FROM ops_job_runs WHERE job = 'ops_checks'"))[0]!;
    expect(Number(j.runs)).toBe(1);
    expect(j.last_success_at).toBeTruthy();
    const s = (await (await env.app.request('/status')).json()) as { status: string };
    expect(s.status).toBe('degraded');
  });
});
