// P2: ra soat tinh moi console.* trong ma nguon dich vu: khong log doi tuong loi nguyen ban, OTP, token, mat khau, so tai khoan, so dien thoai.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = resolve(__dirname, '../../..');
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n === 'dist' || n === 'test') continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.ts$/.test(n) && !n.endsWith('.d.ts')) out.push(p);
  }
  return out;
}
const roots = ['services/api/src', 'services/edge-gateway/src', 'services/payments/src', 'services/media-worker/src', 'services/ingest-consumer/src', 'packages/runtime/src', 'packages/shared/src'];
const calls: { file: string; line: number; text: string }[] = [];
for (const r of roots) {
  for (const f of walk(join(repo, r))) {
    if (/\/cli\/|seed|bootstrap/.test(f)) continue; // CLI cai dat: in thong tin cho nguoi van hanh (khong chay tren may chu)
    readFileSync(f, 'utf8').split('\n').forEach((t, i) => { if (/console\.(log|warn|error|info|debug)\(/.test(t)) calls.push({ file: f.replace(repo + '/', ''), line: i + 1, text: t.trim() }); });
  }
}

describe('logging redaction (tinh)', () => {
  it('co console.* de kiem tra', () => expect(calls.length).toBeGreaterThan(10));
  it('khong log doi tuong loi nguyen ban: chi (e as Error).name | safeErr(e)', () => {
    const bad = calls.filter((c) => /,\s*(e|err|error)\s*\)/.test(c.text) || /,\s*(e|err|error)\.(stack|cause)/.test(c.text) || /\$\{(e|err)\}/.test(c.text) || /\(e as Error\)\.message/.test(c.text) || /err instanceof Error \? err\.message/.test(c.text));
    expect(bad, JSON.stringify(bad, null, 1)).toEqual([]);
  });
  it('khong log gia tri nhay cam (otp, token, mat khau, so tai khoan, so dien thoai, authorization, secret)', () => {
    const bad = calls.filter((c) => /\$\{[^}]*(otp|token|password|secret|account|phone|bank|authorization|signature|totp)[^}]*\}|,\s*(otp|code|token|password|secret|phone|body)\b/i.test(c.text));
    expect(bad, JSON.stringify(bad, null, 1)).toEqual([]);
  });
});
