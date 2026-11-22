import { describe, expect, it } from 'vitest';
import { redactLog, safeErr } from '../src/index.js';

describe('redactLog / safeErr', () => {
  it('che OTP, token, so tai khoan, email, Bearer', () => {
    expect(redactLog('otp=123456 token: abcDEF123 password="hunter2"')).not.toMatch(/123456|abcDEF123|hunter2/);
    expect(redactLog('tai khoan 0123456789012 chuyen')).not.toMatch(/0123456789012/);
    expect(redactLog('Key (email)=(a.b@example.com) already exists')).not.toMatch(/a\.b@example\.com/);
    expect(redactLog('Authorization: Bearer abcdefghijklmnop')).not.toMatch(/abcdefghijklmnop/);
    expect(redactLog('x'.repeat(10) + ' ' + 'A1'.repeat(20))).not.toMatch(/(A1){20}/);
  });
  it('giu thong tin chan doan khong nhay cam; cat do dai', () => {
    expect(redactLog('connection refused 5432')).toBe('connection refused 5432');
    expect(redactLog('a'.repeat(1000)).length).toBeLessThan(310);
  });
  it('safeErr khong bao gio tra stack/doi tuong', () => {
    const e = Object.assign(new Error('duplicate key phone=0912345678'), { detail: 'Key (phone_hash)=(secret)', stack: 'STACK' });
    const s = safeErr(e);
    expect(s).toMatch(/^Error: /);
    expect(s).not.toMatch(/0912345678|STACK|secret/);
    expect(safeErr('otp=111111')).not.toMatch(/111111/);
  });
});
