import { describe, expect, it } from 'vitest';
import {
  canonicalRequest, decryptField, ed25519Sign, ed25519Verify, encryptField, formatVnd, fromBase32, fromBase64, fromHex,
  generateEd25519KeyPair, generateFieldKey, generateTotpSecret, hashPassword, hmacSha256Hex, isUuid, sha256Hex,
  timingSafeEqualStr, toBase32, toBase64, toHex, totp, totpFromKey, ulid, ulidTime, utf8, uuidv7, verifyHmacSha256Hex,
  verifyPassword, verifyTotp, vndToWordsVi,
} from '../src/index.js';

describe('id', () => {
  it('ulid: 26 ky tu, tang dan, mang thoi gian', () => {
    const t = Date.now();
    const a = ulid(t), b = ulid(t), c = ulid(t + 1);
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(a < b && b < c).toBe(true);
    expect(ulidTime(a)).toBe(t);
  });
  it('uuidv7: phien ban 7, variant 10, mang thoi gian', () => {
    const u = uuidv7(1700000000000);
    expect(isUuid(u)).toBe(true);
    expect(u[14]).toBe('7');
    expect('89ab').toContain(u[19]);
    expect(parseInt(u.replace(/-/g, '').slice(0, 12), 16)).toBe(1700000000000);
    expect(uuidv7(1700000000001) > u).toBe(true);
  });
});

describe('password', () => {
  it('scrypt dung/sai', async () => {
    const h = await hashPassword('Mat-khau-1', { N: 1024 });
    expect(h.startsWith('scrypt$1024$8$1$')).toBe(true);
    expect(await verifyPassword('Mat-khau-1', h)).toBe(true);
    expect(await verifyPassword('mat-khau-1', h)).toBe(false);
    expect(await verifyPassword('x', 'rac')).toBe(false);
    expect(await hashPassword('Mat-khau-1', { N: 1024 })).not.toBe(h); // muoi ngau nhien
  });
});

describe('TOTP RFC 6238', () => {
  const k1 = utf8('12345678901234567890');
  // Phu luc B RFC 6238 (SHA-1, 8 chu so)
  const vectors: [number, string][] = [
    [59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'],
    [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130'],
  ];
  for (const [t, code] of vectors) {
    it(`SHA-1 t=${t}`, async () => {
      expect(await totpFromKey(k1, t * 1000, { digits: 8 })).toBe(code);
    });
  }
  it('SHA-256 va SHA-512 (khoa dai theo RFC)', async () => {
    expect(await totpFromKey(utf8('12345678901234567890123456789012'), 59000, { digits: 8, algo: 'SHA-256' })).toBe('46119246');
    expect(await totpFromKey(utf8('1234567890123456789012345678901234567890123456789012345678901234'), 59000, { digits: 8, algo: 'SHA-512' })).toBe('90693936');
  });
  it('base32 va xac minh co cua so', async () => {
    const secret = toBase32(k1);
    expect(secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(fromBase32(secret)).toEqual(k1);
    const now = 1700000000000;
    const code = await totp(secret, now);
    expect((await verifyTotp(secret, code, { timeMs: now })).ok).toBe(true);
    expect((await verifyTotp(secret, code, { timeMs: now + 30000 })).ok).toBe(true);
    expect((await verifyTotp(secret, code, { timeMs: now + 90000 })).ok).toBe(false);
    expect((await verifyTotp(secret, '12345', { timeMs: now })).ok).toBe(false);
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });
});

describe('HMAC', () => {
  it('RFC 4231 test case 2', async () => {
    expect(await hmacSha256Hex('Jefe', 'what do ya want for nothing?')).toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
  });
  it('verify chap nhan tien to sha256= va tu choi sai', async () => {
    const sig = await hmacSha256Hex('k', 'body');
    expect(await verifyHmacSha256Hex('k', 'body', 'sha256=' + sig)).toBe(true);
    expect(await verifyHmacSha256Hex('k', 'body', sig.toUpperCase())).toBe(true);
    expect(await verifyHmacSha256Hex('k', 'body2', sig)).toBe(false);
    expect(await verifyHmacSha256Hex('k', 'body', 'zz')).toBe(false);
    expect(timingSafeEqualStr('abc', 'abc')).toBe(true);
    expect(timingSafeEqualStr('abc', 'abd')).toBe(false);
    expect(timingSafeEqualStr('abc', 'abcd')).toBe(false);
  });
  it('sha256 rong', async () => {
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

describe('AES-GCM', () => {
  it('khu hoi, aad, chong sua', async () => {
    const key = generateFieldKey();
    const tok = await encryptField(key, '0300588569', 'customers.tax_code');
    expect(tok.startsWith('v1:')).toBe(true);
    expect(await decryptField(key, tok, 'customers.tax_code')).toBe('0300588569');
    await expect(decryptField(key, tok, 'khac')).rejects.toBeTruthy();
    await expect(decryptField(generateFieldKey(), tok, 'customers.tax_code')).rejects.toBeTruthy();
    const bad = tok.slice(0, -4) + (tok.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    await expect(decryptField(key, bad, 'customers.tax_code')).rejects.toBeTruthy();
    expect(await encryptField(key, 'x')).not.toBe(await encryptField(key, 'x'));
  });
});

describe('Ed25519', () => {
  it('ky/xac minh, sai thong diep, sai khoa', async () => {
    const kp = await generateEd25519KeyPair();
    const msg = canonicalRequest('post', '/v1/heartbeat', '1700000000', 'n1', await sha256Hex('{}'));
    const sig = await ed25519Sign(kp.privateKey, msg);
    expect(await ed25519Verify(kp.publicKey, sig, msg)).toBe(true);
    expect(await ed25519Verify(kp.publicKey, sig, msg + 'x')).toBe(false);
    const other = await generateEd25519KeyPair();
    expect(await ed25519Verify(other.publicKey, sig, msg)).toBe(false);
    expect(await ed25519Verify('rac', sig, msg)).toBe(false);
    expect(msg.startsWith('POST\n/v1/heartbeat')).toBe(true);
  });
});

describe('encoding', () => {
  it('base64/hex khu hoi', () => {
    const b = new Uint8Array([0, 1, 2, 250, 251, 252, 253]);
    expect(fromBase64(toBase64(b))).toEqual(b);
    expect(toBase64(utf8('foobar'))).toBe('Zm9vYmFy');
    expect(fromHex(toHex(b))).toEqual(b);
  });
});

describe('vndToWordsVi', () => {
  const cases: [number, string][] = [
    [1250000, 'một triệu hai trăm năm mươi nghìn đồng'],
    [5000000, 'năm triệu đồng'],
    [21000, 'hai mươi mốt nghìn đồng'],
    [1000001, 'một triệu không trăm lẻ một đồng'],
    [0, 'không đồng'],
    [15, 'mười lăm đồng'],
    [105, 'một trăm lẻ năm đồng'],
    [1000, 'một nghìn đồng'],
    [100000000, 'một trăm triệu đồng'],
    [450000000, 'bốn trăm năm mươi triệu đồng'],
    [176200000, 'một trăm bảy mươi sáu triệu hai trăm nghìn đồng'],
    [84500000, 'tám mươi bốn triệu năm trăm nghìn đồng'],
    [2000000000, 'hai tỷ đồng'],
    [1000000000000, 'một nghìn tỷ đồng'],
    [1005000, 'một triệu không trăm lẻ năm nghìn đồng'],
    [25, 'hai mươi lăm đồng'],
    [11, 'mười một đồng'],
  ];
  for (const [n, s] of cases) it(`${n}`, () => expect(vndToWordsVi(n)).toBe(s));
  it('hoa chu dau, bigint, am', () => {
    expect(vndToWordsVi(1250000, { capitalize: true })).toMatch(/^Một triệu/);
    expect(vndToWordsVi(5000000n)).toBe('năm triệu đồng');
    expect(vndToWordsVi(-21000)).toBe('âm hai mươi mốt nghìn đồng');
  });
  it('formatVnd', () => {
    expect(formatVnd(1250000)).toBe('1.250.000 ₫');
    expect(formatVnd(0)).toBe('0 ₫');
  });
});

import { blindIndex, shardOf } from '../src/index.js';
describe('shard va blind index', () => {
  it('shardOf trong [0,4096) va on dinh', () => {
    expect(shardOf('abc')).toBe(shardOf('abc'));
    for (const id of ['a', 'b', '01JABCDEF']) expect(shardOf(id)).toBeLessThan(4096);
  });
  it('blindIndex on dinh, phan biet nhan, khong phan biet hoa thuong/khoang trang', async () => {
    const key = generateFieldKey();
    const a = await blindIndex(key, 'tax', '0300588569');
    expect(a).toBe(await blindIndex(key, 'tax', ' 0300588569 '));
    expect(a).not.toBe(await blindIndex(key, 'other', '0300588569'));
    expect(a).not.toBe(await blindIndex(generateFieldKey(), 'tax', '0300588569'));
  });
});
