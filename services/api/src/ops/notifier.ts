// Gui canh bao van hanh: email (rt.mail: SMTP hoac HTTP mail adapter) + webhook chung (Telegram/Slack/Discord/Zalo-bridge).
// Moi lan gui ghi ops_notifications (ok/loi). KHONG ghi URL/token vao DB hay log; thong bao loi chi co ten loi/HTTP status.
import type { Runtime } from '@ams/runtime';
import { decField, encField } from '../lib/crypto.js';
import { esc } from '../lib/mail.js';

export type NotifyEvent = 'opened' | 'reminder' | 'resolved' | 'test';
export interface IncidentInfo {
  id: string | null;
  ruleKey: string;
  severity: 'S1' | 'S2' | 'S3';
  title: string;
  detail: string;
  component: string;
}

export const SETTING_EMAILS = 'ops.alert_emails';
export const SETTING_WEBHOOK = 'ops.alert_webhook';
const WEBHOOK_AAD = 'settings.ops_alert_webhook';

/** Webhook chi nhan https, khong tro vao may noi bo (chong SSRF khi quan tri vien nhap URL). */
export function validateWebhookUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('URL không hợp lệ');
  }
  if (u.protocol !== 'https:') throw new Error('Webhook phải dùng https');
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local') || !h.includes('.') && !h.includes(':')) throw new Error('Webhook không được trỏ vào máy nội bộ');
  if (/^\[?(::1?|fe80|fc|fd)/i.test(h) || h.startsWith('[')) throw new Error('Webhook không được dùng địa chỉ IPv6 nội bộ');
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a >= 224) throw new Error('Webhook không được trỏ vào địa chỉ nội bộ');
  }
  return u;
}

export interface AlertConfig {
  emails: string[];
  webhookUrl: string | null;
  chatId: string | null;
}

async function setting(rt: Runtime, key: string): Promise<string | null> {
  const r = (await rt.db.query<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]))[0];
  return r ? r.value : null;
}

export async function loadAlertConfig(rt: Runtime): Promise<AlertConfig> {
  const env = rt.config.env;
  const rawEmails = (await setting(rt, SETTING_EMAILS).catch(() => null)) ?? env['OPS_ALERT_EMAILS'] ?? '';
  const emails = rawEmails.split(/[,;\s]+/).map((s) => s.trim()).filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
  let webhookUrl: string | null = null;
  const stored = await setting(rt, SETTING_WEBHOOK).catch(() => null);
  if (stored) {
    try {
      webhookUrl = await decField(rt, stored, WEBHOOK_AAD);
    } catch {
      webhookUrl = null; // khoa doi/hong: coi nhu chua cau hinh, trang Canh bao se bao
    }
  } else if (env['OPS_ALERT_WEBHOOK_URL']) webhookUrl = env['OPS_ALERT_WEBHOOK_URL'];
  return { emails, webhookUrl, chatId: env['OPS_ALERT_WEBHOOK_CHAT_ID'] || null };
}

export async function saveAlertSettings(rt: Runtime, actorId: string | null, v: { emails?: string[]; webhookUrl?: string | null }): Promise<void> {
  const now = rt.clock.now().toISOString();
  const put = (k: string, val: string) =>
    rt.db.run('INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?,?,?,?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at', [k, val, actorId, now]);
  if (v.emails) await put(SETTING_EMAILS, v.emails.join(','));
  if (v.webhookUrl !== undefined) {
    if (v.webhookUrl === null || v.webhookUrl === '') await rt.db.run('DELETE FROM settings WHERE key = ?', [SETTING_WEBHOOK]);
    else {
      validateWebhookUrl(v.webhookUrl);
      await put(SETTING_WEBHOOK, await encField(rt, v.webhookUrl, WEBHOOK_AAD));
    }
  }
}

const ICON: Record<NotifyEvent, string> = { opened: 'CẢNH BÁO', reminder: 'NHẮC LẠI', resolved: 'ĐÃ KHÁC PHỤC', test: 'THỬ' };

export function formatAlert(i: IncidentInfo, ev: NotifyEvent, env: string): { subject: string; text: string; html: string } {
  const head = `[AMS ${env}] ${ICON[ev]} ${i.severity}: ${i.title}`;
  const text = `${head}\nThành phần: ${i.component}\nChi tiết: ${i.detail}\nMã quy tắc: ${i.ruleKey}\n${ev === 'resolved' ? 'Điều kiện cảnh báo đã hết (tự động).' : 'Mở web admin > Cảnh báo để xác nhận (ack). Quy trình: docs/ops/ONCALL.md'}`;
  const html = `<p><b>${esc(head)}</b></p><p>Thành phần: ${esc(i.component)}<br>Chi tiết: ${esc(i.detail)}<br>Mã quy tắc: <code>${esc(i.ruleKey)}</code></p><p>${ev === 'resolved' ? 'Điều kiện cảnh báo đã hết (tự động).' : 'Mở web admin &gt; Cảnh báo để xác nhận (ack). Quy trình: docs/ops/ONCALL.md'}</p>`;
  return { subject: head, text, html };
}

async function logNotification(rt: Runtime, incidentId: string | null, channel: string, event: NotifyEvent, ok: boolean, error?: string): Promise<void> {
  await rt.db
    .run('INSERT INTO ops_notifications (id, incident_id, channel, event, ok, error, sent_at) VALUES (?,?,?,?,?,?,?)', [rt.id(), incidentId, channel, event, ok ? 1 : 0, error ? error.slice(0, 200) : null, rt.clock.now().toISOString()])
    .catch(() => undefined);
}

export interface SendResult {
  channel: 'email' | 'webhook';
  ok: boolean;
  skipped?: boolean;
  error?: string;
}

/** Gui qua moi kenh da cau hinh. Khong bao gio nem loi (canh bao hong khong duoc lam hong job). */
export async function notifyIncident(rt: Runtime, i: IncidentInfo, ev: NotifyEvent): Promise<SendResult[]> {
  const out: SendResult[] = [];
  let cfg: AlertConfig;
  try {
    cfg = await loadAlertConfig(rt);
  } catch (e) {
    console.error('[ops] doc cau hinh canh bao loi:', (e as Error).name);
    return out;
  }
  const envName = rt.config.env['AMS_ENV'] ?? rt.config.runtime;
  const msg = formatAlert(i, ev, envName);
  let anySent = false;

  if (cfg.emails.length) {
    let ok = true;
    let error: string | undefined;
    for (const to of cfg.emails) {
      try {
        await rt.mail.send({ to, subject: msg.subject, html: msg.html, text: msg.text });
      } catch (e) {
        ok = false;
        error = (e as Error).name + ((e as Error).message ? `: ${(e as Error).message.slice(0, 80)}` : '');
      }
    }
    await logNotification(rt, i.id, 'email', ev, ok, error);
    out.push({ channel: 'email', ok, ...(error ? { error } : {}) });
    anySent ||= ok;
  } else out.push({ channel: 'email', ok: false, skipped: true });

  if (cfg.webhookUrl) {
    let ok = false;
    let error: string | undefined;
    try {
      const u = validateWebhookUrl(cfg.webhookUrl);
      // text: Slack/Telegram/Mattermost; content: Discord; message: Zalo OA bridge/Google Chat-compatible; chat_id: Telegram (neu dat)
      const body = { text: msg.text, content: msg.text, message: msg.text, ...(cfg.chatId ? { chat_id: cfg.chatId } : {}), severity: i.severity, event: ev, rule: i.ruleKey, component: i.component };
      const res = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000), redirect: 'error' });
      ok = res.ok;
      if (!res.ok) error = `HTTP ${res.status}`;
    } catch (e) {
      error = (e as Error).name === 'Error' ? (e as Error).message.slice(0, 80) : (e as Error).name;
    }
    await logNotification(rt, i.id, 'webhook', ev, ok, error);
    out.push({ channel: 'webhook', ok, ...(error ? { error } : {}) });
    anySent ||= ok;
  } else out.push({ channel: 'webhook', ok: false, skipped: true });

  if (anySent && i.id && ev !== 'test') await rt.db.run('UPDATE ops_incidents SET last_notified_at = ? WHERE id = ?', [rt.clock.now().toISOString(), i.id]).catch(() => undefined);
  else if (!anySent && i.id && ev !== 'test') {
    // Khong kenh nao gui duoc: van danh dau da thu de khong thu lai moi 5 phut (cooldown), nhung giu loi trong ops_notifications.
    await rt.db.run('UPDATE ops_incidents SET last_notified_at = ? WHERE id = ?', [rt.clock.now().toISOString(), i.id]).catch(() => undefined);
  }
  return out;
}
