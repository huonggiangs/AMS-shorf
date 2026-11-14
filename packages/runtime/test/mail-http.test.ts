import { describe, expect, it } from 'vitest';
import { HttpMailer, MailError, detectMailProvider, mailConfigFromEnv, parseAddress } from '../src/mail-http.js';

type Call = { url: string; init: RequestInit };
const fakeFetch = (status: number[] | number = 200) => {
  const calls: Call[] = [];
  const seq = Array.isArray(status) ? [...status] : [status];
  const f = (async (url: string | URL, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response('{}', { status: seq.length > 1 ? seq.shift()! : seq[0]! });
  }) as unknown as typeof fetch;
  return { f, calls };
};
const mail = { to: 'a@example.test', subject: 'Chào', html: '<b>x</b>', text: 'x' };
const hdr = (c: Call, k: string) => (c.init.headers as Record<string, string>)[k];

describe('HttpMailer', () => {
  it('resend: Bearer + to la mang', async () => {
    const { f, calls } = fakeFetch();
    await new HttpMailer({ url: 'https://api.resend.com/emails', key: 'k', from: 'AMS <no-reply@anio.vn>', fetch: f }).send(mail);
    expect(hdr(calls[0]!, 'authorization')).toBe('Bearer k');
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ from: 'AMS <no-reply@anio.vn>', to: ['a@example.test'], subject: 'Chào' });
  });
  it('postmark: token header + PascalCase', async () => {
    const { f, calls } = fakeFetch();
    await new HttpMailer({ url: 'https://api.postmarkapp.com/email', key: 'pk', from: 'x@anio.vn', fetch: f }).send(mail);
    expect(hdr(calls[0]!, 'x-postmark-server-token')).toBe('pk');
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ From: 'x@anio.vn', To: 'a@example.test', HtmlBody: '<b>x</b>' });
  });
  it('brevo: api-key header + sender/htmlContent', async () => {
    const { f, calls } = fakeFetch(201);
    await new HttpMailer({ url: 'https://api.brevo.com/v3/smtp/email', key: 'bk', from: 'AMS <no-reply@anio.vn>', replyTo: 'support@anio.vn', fetch: f }).send(mail);
    expect(hdr(calls[0]!, 'api-key')).toBe('bk');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ sender: { name: 'AMS', email: 'no-reply@anio.vn' }, to: [{ email: 'a@example.test' }], subject: 'Chào', htmlContent: '<b>x</b>', textContent: 'x', replyTo: { email: 'support@anio.vn' } });
  });
  it('mailgun: Basic api:key + form-urlencoded', async () => {
    const { f, calls } = fakeFetch();
    await new HttpMailer({ url: 'https://api.mailgun.net/v3/mg.anio.vn/messages', key: 'mk', from: 'AMS <no-reply@anio.vn>', fetch: f }).send(mail);
    expect(hdr(calls[0]!, 'authorization')).toBe(`Basic ${btoa('api:mk')}`);
    expect(hdr(calls[0]!, 'content-type')).toBe('application/x-www-form-urlencoded');
    const form = new URLSearchParams(String(calls[0]!.init.body));
    expect(form.get('to')).toBe('a@example.test');
    expect(form.get('from')).toBe('AMS <no-reply@anio.vn>');
    expect(form.get('subject')).toBe('Chào');
  });
  it('generic: doi ten header xac thuc, to la chuoi', async () => {
    const { f, calls } = fakeFetch();
    await new HttpMailer({ url: 'https://relay.example.test/send', key: 'gk', from: 'x@anio.vn', provider: 'generic', authHeader: 'X-Api-Key', fetch: f }).send(mail);
    expect(hdr(calls[0]!, 'x-api-key')).toBe('gk');
    expect(JSON.parse(String(calls[0]!.init.body)).to).toBe('a@example.test');
  });
  it('thu lai 429/5xx roi thanh cong; 4xx khac khong thu lai; khong lo khoa/dia chi trong loi', async () => {
    const ok = fakeFetch([503, 429, 200]);
    await new HttpMailer({ url: 'https://api.resend.com/emails', key: 'SECRETKEY', from: 'x@anio.vn', fetch: ok.f, sleep: async () => undefined }).send(mail);
    expect(ok.calls).toHaveLength(3);
    const bad = fakeFetch(401);
    const err = await new HttpMailer({ url: 'https://api.resend.com/emails', key: 'SECRETKEY', from: 'x@anio.vn', fetch: bad.f, sleep: async () => undefined }).send(mail).catch((e) => e as MailError);
    expect(bad.calls).toHaveLength(1);
    expect(err).toBeInstanceOf(MailError);
    expect(String((err as Error).message) + String(JSON.stringify(err))).not.toMatch(/SECRETKEY|a@example\.test/);
    expect((err as MailError).status).toBe(401);
  });
  it('chua cau hinh / URL http -> tu choi, khong goi mang', async () => {
    const { f, calls } = fakeFetch();
    await expect(new HttpMailer({ url: 'http://insecure.test', key: 'k', from: 'x@anio.vn', fetch: f }).send(mail)).rejects.toThrow(/chua cau hinh/);
    await expect(new HttpMailer({ url: 'https://x.test', key: '', from: 'x@anio.vn', fetch: f }).send(mail)).rejects.toThrow(/chua cau hinh/);
    expect(calls).toHaveLength(0);
  });
  it('detect + env + parseAddress', () => {
    expect(detectMailProvider('https://api.brevo.com/v3/smtp/email')).toBe('brevo');
    expect(detectMailProvider('https://api.eu.mailgun.net/v3/x/messages')).toBe('mailgun');
    expect(detectMailProvider('https://x.test', 'generic')).toBe('generic');
    expect(mailConfigFromEnv({ MAIL_HTTP_URL: 'https://api.postmarkapp.com/email', MAIL_HTTP_KEY: 'k' }, 'd@anio.vn')).toMatchObject({ provider: 'postmark', from: 'd@anio.vn' });
    expect(parseAddress('AMS <a@b.c>')).toEqual({ name: 'AMS', email: 'a@b.c' });
    expect(parseAddress('a@b.c')).toEqual({ email: 'a@b.c' });
  });
});
