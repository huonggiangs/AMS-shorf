import type { Mailer } from '../types.js';

/** Gui thu qua HTTP API (tuong thich Resend: POST JSON {from,to,subject,html,text}, Bearer key). */
export class HttpMailer implements Mailer {
  constructor(private cfg: { url: string; key: string; from: string }) {}
  async send(m: { to: string; subject: string; html: string; text?: string }) {
    const res = await fetch(this.cfg.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.cfg.key}` },
      body: JSON.stringify({ from: this.cfg.from, to: [m.to], subject: m.subject, html: m.html, ...(m.text ? { text: m.text } : {}) }),
    });
    if (!res.ok) throw new Error(`gui thu that bai: HTTP ${res.status}`);
  }
}
