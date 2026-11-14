import type { Mailer } from './types.js';

/**
 * Gui thu qua HTTP API (chay duoc tren Workers va Node, khong phu thuoc goi ngoai).
 *  - resend  : POST {from,to:[..],subject,html,text,reply_to} + Bearer key. Dung cho Resend va moi dich vu "tuong thich Resend".
 *  - postmark: POST {From,To,Subject,HtmlBody,TextBody,ReplyTo,MessageStream} + X-Postmark-Server-Token.
 *  - generic : POST {from,to,subject,html,text,reply_to} (to la chuoi) + Bearer key; MAIL_HTTP_AUTH_HEADER doi ten header (gia tri = key, khong co "Bearer").
 * Khong bao gio dua key/dia chi nguoi nhan vao thong bao loi (loi co the di vao log).
 */
export type MailProvider = 'resend' | 'postmark' | 'generic';

export interface HttpMailConfig {
  url: string;
  key: string;
  from: string;
  provider?: MailProvider;
  replyTo?: string;
  /** generic: ten header xac thuc (mac dinh Authorization: Bearer <key>) */
  authHeader?: string;
  timeoutMs?: number;
  /** so lan thu lai khi 429/5xx/loi mang (mac dinh 2) */
  retries?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

type Mail = { to: string; subject: string; html: string; text?: string };

export class MailError extends Error {
  constructor(message: string, public retryable: boolean, public status?: number) {
    super(message);
    this.name = 'MailError';
  }
}

export function detectMailProvider(url: string, explicit?: string): MailProvider {
  const e = (explicit ?? '').toLowerCase();
  if (e === 'resend' || e === 'postmark' || e === 'generic') return e;
  if (/postmarkapp\.com/i.test(url)) return 'postmark';
  return 'resend';
}

export class HttpMailer implements Mailer {
  private provider: MailProvider;
  constructor(private cfg: HttpMailConfig) {
    this.provider = cfg.provider ?? detectMailProvider(cfg.url);
  }
  /** true khi du cau hinh de gui that. */
  get configured(): boolean {
    return /^https:\/\//i.test(this.cfg.url) && this.cfg.key.length > 0;
  }
  private build(m: Mail): { headers: Record<string, string>; body: unknown } {
    const c = this.cfg;
    const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' };
    if (this.provider === 'postmark') {
      headers['x-postmark-server-token'] = c.key;
      return { headers, body: { From: c.from, To: m.to, Subject: m.subject, HtmlBody: m.html, ...(m.text ? { TextBody: m.text } : {}), ...(c.replyTo ? { ReplyTo: c.replyTo } : {}), MessageStream: 'outbound' } };
    }
    if (this.provider === 'generic' && c.authHeader) headers[c.authHeader.toLowerCase()] = c.key;
    else headers['authorization'] = `Bearer ${c.key}`;
    const to = this.provider === 'generic' ? m.to : [m.to];
    return { headers, body: { from: c.from, to, subject: m.subject, html: m.html, ...(m.text ? { text: m.text } : {}), ...(c.replyTo ? { reply_to: c.replyTo } : {}) } };
  }
  async send(m: Mail): Promise<void> {
    if (!this.configured) throw new MailError('chua cau hinh gui thu (MAIL_HTTP_URL phai la https va co MAIL_HTTP_KEY)', false);
    const f = this.cfg.fetch ?? fetch;
    const sleep = this.cfg.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const { headers, body } = this.build(m);
    const max = Math.max(0, this.cfg.retries ?? 2);
    let last: MailError | null = null;
    for (let attempt = 0; attempt <= max; attempt++) {
      if (attempt > 0) await sleep(300 * 2 ** (attempt - 1));
      try {
        const res = await f(this.cfg.url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 10_000) });
        if (res.ok) return;
        last = new MailError(`gui thu that bai: HTTP ${res.status}`, res.status === 429 || res.status >= 500, res.status);
      } catch (e) {
        last = new MailError(`gui thu that bai: ${(e as Error).name}`, true);
      }
      if (!last.retryable) break;
    }
    throw last ?? new MailError('gui thu that bai', false);
  }
}

/** Doc cau hinh thu HTTP tu bien moi truong: MAIL_HTTP_URL, MAIL_HTTP_KEY, MAIL_FROM, MAIL_PROVIDER?, MAIL_REPLY_TO?, MAIL_HTTP_AUTH_HEADER?. */
export function mailConfigFromEnv(env: Record<string, string | undefined>, defaultFrom: string): HttpMailConfig {
  const url = env['MAIL_HTTP_URL'] ?? '';
  return {
    url,
    key: env['MAIL_HTTP_KEY'] ?? '',
    from: env['MAIL_FROM'] ?? defaultFrom,
    provider: detectMailProvider(url, env['MAIL_PROVIDER']),
    ...(env['MAIL_REPLY_TO'] ? { replyTo: env['MAIL_REPLY_TO'] } : {}),
    ...(env['MAIL_HTTP_AUTH_HEADER'] ? { authHeader: env['MAIL_HTTP_AUTH_HEADER'] } : {}),
  };
}

export function createMailer(env: Record<string, string | undefined>, defaultFrom = 'AMS <no-reply@ams.vn>'): HttpMailer {
  return new HttpMailer(mailConfigFromEnv(env, defaultFrom));
}
