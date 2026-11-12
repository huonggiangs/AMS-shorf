import type { Transporter } from 'nodemailer';
import type { Mailer } from './types.js';

export interface SmtpConfig {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  from: string;
}

/** SMTP qua nodemailer (Mailpit o cong 1025 khi chay local). `transport` cho phep tiem ban gia khi test. */
export class SmtpMailer implements Mailer {
  private t?: Promise<Transporter>;
  constructor(private cfg: SmtpConfig, private inject?: Transporter) {}
  private transporter() {
    this.t ??= this.inject
      ? Promise.resolve(this.inject)
      : import('nodemailer').then((m) =>
          m.default.createTransport({
            host: this.cfg.host,
            port: this.cfg.port,
            secure: this.cfg.port === 465,
            ...(this.cfg.user ? { auth: { user: this.cfg.user, pass: this.cfg.pass ?? '' } } : {}),
          }),
        );
    return this.t;
  }
  async send(m: { to: string; subject: string; html: string; text?: string }) {
    const t = await this.transporter();
    await t.sendMail({ from: this.cfg.from, to: m.to, subject: m.subject, html: m.html, ...(m.text ? { text: m.text } : {}) });
  }
}
