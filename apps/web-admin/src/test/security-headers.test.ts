// P2: CSP/headers cho web-admin phai khop giua Cloudflare (public/_headers) va Docker (nginx) va dung nguyen tac strict.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

function directives(csp: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const d of csp.split(';').map((s) => s.trim()).filter(Boolean)) {
    const [k, ...v] = d.split(/\s+/);
    out[k!] = v;
  }
  return out;
}
const cfCsp = /Content-Security-Policy:\s*(.+)/.exec(read('public/_headers'))![1]!;
const nginxCsp = /add_header Content-Security-Policy "([^"]+)"/.exec(read('nginx-security-headers.conf'))![1]!;

describe('web-admin security headers', () => {
  it('CSP strict: script chi self (khong unsafe-inline/eval), khong nhung khung, khong object, base-uri none', () => {
    for (const csp of [cfCsp, nginxCsp]) {
      const d = directives(csp);
      expect(d['default-src']).toEqual(["'none'"]);
      expect(d['script-src']).toEqual(["'self'", 'https://cdnjs.cloudflare.com']); // hls.js xem trước link video
      expect(d['frame-ancestors']).toEqual(["'none'"]);
      expect(d['object-src']).toEqual(["'none'"]);
      expect(d['base-uri']).toEqual(["'none'"]);
      expect(d['form-action']).toEqual(["'self'"]);
      expect(csp).not.toMatch(/unsafe-eval/);
      expect(d['script-src']!.join(' ')).not.toMatch(/unsafe-inline|\*|https:(?!\/\/cdnjs\.cloudflare\.com)/);
    }
  });
  it('Cloudflare _headers co du HSTS, nosniff, DENY, referrer, permissions-policy, COOP', () => {
    const h = read('public/_headers');
    expect(h).toMatch(/Strict-Transport-Security:\s*max-age=31536000/);
    expect(h).toMatch(/X-Content-Type-Options:\s*nosniff/);
    expect(h).toMatch(/X-Frame-Options:\s*DENY/);
    expect(h).toMatch(/Referrer-Policy:/);
    expect(h).toMatch(/Permissions-Policy:\s*camera=\(\)/);
    expect(h).toMatch(/Cross-Origin-Opener-Policy:\s*same-origin/);
  });
  it('nginx: tieu de nam trong snippet va duoc include o moi location phuc vu tep (add_header o location ghi de cap server)', () => {
    const t = read('nginx.conf.template');
    expect(t.match(/include \/etc\/nginx\/snippets\/ams-security-headers\.conf;/g)!.length).toBeGreaterThanOrEqual(3);
    expect(t).not.toMatch(/^\s{4}add_header (Content-Security-Policy|X-Frame-Options)/m);
    expect(read('Dockerfile')).toMatch(/ams-security-headers\.conf/);
    const s = read('nginx-security-headers.conf');
    for (const k of ['Strict-Transport-Security', 'X-Frame-Options', 'X-Content-Type-Options', 'Permissions-Policy', 'Referrer-Policy']) expect(s).toContain(k);
  });
  it('index.html khong co script inline', () => {
    const html = read('index.html');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
    expect(html).not.toMatch(/\son[a-z]+=/i);
  });
});
