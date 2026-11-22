import { describe, expect, it } from 'vitest';
import { blindIndex, decryptField, encryptField, fieldKeyRingFromEnv, fieldTokenIsCurrent, fieldTokenKeyId, generateFieldKey } from '../src/index.js';

const A = generateFieldKey();
const B = generateFieldKey();
const C = generateFieldKey();

describe('P2 key ring (xoay FIELD_ENC_KEY)', () => {
  it('chi FIELD_ENC_KEY: ghi v2:k0, doc duoc token v1 cu', async () => {
    const ring = fieldKeyRingFromEnv({ FIELD_ENC_KEY: A });
    const v1 = await encryptField(A, 'secret', 'aad');
    expect(v1.startsWith('v1:')).toBe(true);
    expect(await decryptField(ring, v1, 'aad')).toBe('secret');
    const v2 = await encryptField(ring, 'secret', 'aad');
    expect(v2.startsWith('v2:k0:')).toBe(true);
    expect(fieldTokenKeyId(v2)).toBe('k0');
    expect(await decryptField(ring, v2, 'aad')).toBe('secret');
  });

  it('xoay: khoa moi la primary, token cu (v1 va v2:k0) van giai ma duoc, token moi dung khoa moi', async () => {
    const old = fieldKeyRingFromEnv({ FIELD_ENC_KEY: A });
    const oldTok = await encryptField(old, 'x', 'a');
    const oldV1 = await encryptField(A, 'y', 'a');
    const ring = fieldKeyRingFromEnv({ FIELD_ENC_KEYS: `k2:${B},k0:${A}` });
    expect(ring.primaryId).toBe('k2');
    expect(await decryptField(ring, oldTok, 'a')).toBe('x');
    expect(await decryptField(ring, oldV1, 'a')).toBe('y');
    const t = await encryptField(ring, 'z', 'a');
    expect(fieldTokenIsCurrent(ring, t)).toBe(true);
    expect(fieldTokenIsCurrent(ring, oldTok)).toBe(false);
    // chi co khoa moi: khong doc duoc token cu (phai chay re-encrypt truoc khi go khoa cu)
    const only = fieldKeyRingFromEnv({ FIELD_ENC_KEYS: `k2:${B}` });
    await expect(decryptField(only, oldTok, 'a')).rejects.toThrow();
    expect(await decryptField(only, t, 'a')).toBe('z');
  });

  it('FIELD_ENC_KEY_ID giu khoa ghi cu trong khi da nap khoa moi de doc (buoc 1 cua xoay khong gian doan)', async () => {
    const ring = fieldKeyRingFromEnv({ FIELD_ENC_KEYS: `k2:${B},k1:${A}`, FIELD_ENC_KEY_ID: 'k1' });
    expect(ring.primaryId).toBe('k1');
    const t = await encryptField(ring, 'v', 'a');
    expect(fieldTokenKeyId(t)).toBe('k1');
    const next = fieldKeyRingFromEnv({ FIELD_ENC_KEYS: `k2:${B},k1:${A}` });
    expect(await decryptField(next, t, 'a')).toBe('v');
  });

  it('AAD sai hoac khoa sai bi tu choi', async () => {
    const ring = fieldKeyRingFromEnv({ FIELD_ENC_KEY: A });
    const t = await encryptField(ring, 'v', 'aad1');
    await expect(decryptField(ring, t, 'aad2')).rejects.toThrow();
    await expect(decryptField(fieldKeyRingFromEnv({ FIELD_ENC_KEY: C }), t, 'aad1')).rejects.toThrow();
    await expect(decryptField(A, t, 'aad1')).rejects.toThrow(/v2/);
  });

  it('blind index on dinh qua xoay khi dat FIELD_INDEX_KEY (hoac giu FIELD_ENC_KEY cu)', async () => {
    const before = await blindIndex(fieldKeyRingFromEnv({ FIELD_ENC_KEY: A }), 'l', 'V');
    expect(before).toBe(await blindIndex(A, 'l', 'v'));
    const afterIdx = await blindIndex(fieldKeyRingFromEnv({ FIELD_ENC_KEYS: `k2:${B},k0:${A}`, FIELD_INDEX_KEY: A }), 'l', 'v');
    expect(afterIdx).toBe(before);
    const afterLegacy = await blindIndex(fieldKeyRingFromEnv({ FIELD_ENC_KEYS: `k2:${B}`, FIELD_ENC_KEY: A, FIELD_ENC_KEY_ID: 'k2' }), 'l', 'v');
    expect(afterLegacy).toBe(before);
  });

  it('cau hinh sai bi tu choi', () => {
    expect(() => fieldKeyRingFromEnv({})).toThrow();
    expect(() => fieldKeyRingFromEnv({ FIELD_ENC_KEY: 'abc' })).toThrow();
    expect(() => fieldKeyRingFromEnv({ FIELD_ENC_KEYS: `k1:${A},k1:${B}` })).toThrow(/trung/);
    expect(() => fieldKeyRingFromEnv({ FIELD_ENC_KEYS: `bad id:${A}` })).toThrow();
    expect(() => fieldKeyRingFromEnv({ FIELD_ENC_KEYS: `k1:${A}`, FIELD_ENC_KEY_ID: 'zz' })).toThrow();
  });
});
