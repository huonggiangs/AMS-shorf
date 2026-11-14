// Van hanh: GET /status (cong khai), POST /ops/backup-report (script sao luu, Bearer OPS_REPORT_TOKEN), /admin/v1/ops/* (trang Canh bao).
import { Hono } from 'hono';
import { z } from 'zod';
import { timingSafeEqualStr } from '@ams/shared';
import { requirePerm } from '../auth/middleware.js';
import { writeAudit } from '../lib/audit.js';
import { conflict, notFound, unauthorized, unprocessable } from '../lib/errors.js';
import { getRt, num, parseBody } from '../lib/http.js';
import { runOpsChecks } from '../ops/checks.js';
import { loadAlertConfig, notifyIncident, saveAlertSettings, validateWebhookUrl } from '../ops/notifier.js';
import { computePublicStatus } from '../ops/status.js';
import type { AppEnv } from '../types.js';

export function publicOpsRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.get('/status', async (c) => {
    const { body, httpStatus } = await computePublicStatus(getRt(c));
    c.header('Cache-Control', 'public, max-age=30');
    c.header('Access-Control-Allow-Origin', '*');
    return c.json(body, httpStatus as 200 | 503);
  });
  const rep = z.object({
    kind: z.enum(['d1', 'postgres', 'media']),
    env: z.string().max(40).optional(),
    target: z.string().max(200).optional(),
    bytes: z.number().int().min(0).optional(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    encrypted: z.boolean().optional(),
    ok: z.boolean(),
    note: z.string().max(300).optional(),
    started_at: z.string().max(40).optional(),
    finished_at: z.string().max(40).optional(),
  });
  r.post('/ops/backup-report', async (c) => {
    const rt = getRt(c);
    const want = rt.config.env['OPS_REPORT_TOKEN'];
    if (!want) throw notFound('Không tìm thấy đường dẫn.');
    const got = (c.req.header('authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!got || !timingSafeEqualStr(got, want)) throw unauthorized('Sai mã báo cáo.', 'unauthorized');
    const b = await parseBody(c, rep);
    const now = rt.clock.now().toISOString();
    await rt.db.run('INSERT INTO ops_backups (id, kind, env, target, bytes, sha256, encrypted, ok, note, started_at, finished_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [rt.id(), b.kind, b.env ?? null, b.target ?? null, b.bytes ?? 0, b.sha256 ?? null, b.encrypted ? 1 : 0, b.ok ? 1 : 0, b.note ?? null, b.started_at ?? null, b.finished_at ?? now]);
    await rt.db.run('DELETE FROM ops_backups WHERE finished_at < ?', [new Date(rt.clock.now().getTime() - 400 * 86_400_000).toISOString()]).catch(() => undefined);
    return c.json({ ok: true });
  });
  return r;
}

export function opsRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get('/summary', requirePerm('admin', 'view'), async (c) => {
    const rt = getRt(c);
    const active = await rt.db.query<Record<string, unknown>>("SELECT id, rule_key, severity, component, title, detail, metric_value, status, occurrences, opened_at, last_seen_at, acked_at, ack_note, last_notified_at FROM ops_incidents WHERE status <> 'resolved' ORDER BY severity, opened_at");
    const recent = await rt.db.query<Record<string, unknown>>("SELECT id, rule_key, severity, component, title, opened_at, resolved_at FROM ops_incidents WHERE status = 'resolved' ORDER BY resolved_at DESC LIMIT 20");
    const jobs = await rt.db.query<Record<string, unknown>>('SELECT job, last_started_at, last_success_at, last_error_at, last_error, runs, failures FROM ops_job_runs ORDER BY job');
    const backups = await rt.db.query<Record<string, unknown>>('SELECT kind, MAX(finished_at) AS last_at FROM ops_backups WHERE ok = 1 GROUP BY kind');
    const lastBad = await rt.db.query<Record<string, unknown>>('SELECT channel, ok, error, sent_at FROM ops_notifications ORDER BY sent_at DESC LIMIT 10');
    const cfg = await loadAlertConfig(rt);
    let host: string | null = null;
    if (cfg.webhookUrl) {
      try {
        host = validateWebhookUrl(cfg.webhookUrl).hostname;
      } catch {
        host = 'không hợp lệ';
      }
    }
    return c.json({
      counts: { S1: active.filter((a) => a['severity'] === 'S1').length, S2: active.filter((a) => a['severity'] === 'S2').length, S3: active.filter((a) => a['severity'] === 'S3').length },
      incidents: active.map((a) => ({ ...a, metric_value: num(a['metric_value']), occurrences: num(a['occurrences']) })),
      recent,
      jobs: jobs.map((j) => ({ ...j, runs: num(j['runs']), failures: num(j['failures']) })),
      backups,
      notifications: lastBad.map((n) => ({ ...n, ok: num(n['ok']) === 1 })),
      config: { emails: cfg.emails, webhook_configured: !!cfg.webhookUrl, webhook_host: host, mail_configured: rt.config.runtime === 'test' ? true : !!(rt.config.env['MAIL_HTTP_URL'] || rt.config.env['SMTP_HOST']) },
    });
  });

  r.post('/incidents/:id/ack', requirePerm('admin', 'write'), async (c) => {
    const rt = getRt(c);
    const id = c.req.param('id') ?? '';
    const b = await parseBody(c, z.object({ note: z.string().max(300).optional() }));
    const u = c.get('user');
    const cur = (await rt.db.query<{ status: string; rule_key: string }>('SELECT status, rule_key FROM ops_incidents WHERE id = ?', [id]))[0];
    if (!cur) throw notFound('Không tìm thấy sự cố.');
    if (cur.status !== 'open') throw conflict('Sự cố không ở trạng thái "mở".', 'invalid_state');
    const n = await rt.db.run("UPDATE ops_incidents SET status = 'acked', acked_at = ?, acked_by = ?, ack_note = ? WHERE id = ? AND status = 'open'", [rt.clock.now().toISOString(), u.id, b.note ?? null, id]);
    if (n.changes === 0) throw conflict('Sự cố vừa đổi trạng thái.', 'invalid_state');
    await writeAudit(rt.db, { rt, ip: c.get('ip'), actorId: u.id }, { action: 'ops.incident.ack', objectType: 'ops_incident', objectId: id, diff: { rule: cur.rule_key } });
    return c.json({ ok: true });
  });

  r.post('/run', requirePerm('admin', 'write'), async (c) => {
    const rt = getRt(c);
    const res = await runOpsChecks(rt, { notify: c.req.query('notify') !== '0' });
    return c.json(res);
  });

  r.post('/test-notification', requirePerm('admin', 'write'), async (c) => {
    const rt = getRt(c);
    const u = c.get('user');
    const results = await notifyIncident(rt, { id: null, ruleKey: 'test', severity: 'S3', title: 'Thông báo thử từ AMS', detail: `Người gửi: ${u.name}. Nếu bạn nhận được tin này, kênh cảnh báo hoạt động.`, component: 'api' }, 'test');
    await writeAudit(rt.db, { rt, ip: c.get('ip'), actorId: u.id }, { action: 'ops.notification.test', objectType: 'ops', diff: { results: results.map((x) => ({ channel: x.channel, ok: x.ok, skipped: !!x.skipped })) } });
    return c.json({ results });
  });

  r.put('/settings', requirePerm('admin', 'write'), async (c) => {
    const rt = getRt(c);
    const u = c.get('user');
    const b = await parseBody(c, z.object({ emails: z.array(z.string().email().max(200)).max(10).optional(), webhook_url: z.string().max(500).nullable().optional() }));
    if (b.webhook_url) {
      try {
        validateWebhookUrl(b.webhook_url);
      } catch (e) {
        throw unprocessable((e as Error).message, 'bad_webhook_url');
      }
    }
    await saveAlertSettings(rt, u.id, { ...(b.emails ? { emails: b.emails } : {}), ...(b.webhook_url !== undefined ? { webhookUrl: b.webhook_url } : {}) });
    await writeAudit(rt.db, { rt, ip: c.get('ip'), actorId: u.id }, { action: 'ops.settings.update', objectType: 'ops', diff: { emails: b.emails?.length ?? undefined, webhook: b.webhook_url === undefined ? undefined : b.webhook_url ? 'đã đặt' : 'đã xóa' } });
    return c.json({ ok: true });
  });
  return r;
}
