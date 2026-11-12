import { describe, expect, it } from 'vitest';
import { canonicalRequest, ed25519Sign, ed25519Verify, sha256Hex } from '@ams/shared';

// Vector kiem thu cong bo trong docs/DEVICE-PROTOCOL.md muc 3.4: app TV phai tao dung cac chuoi/chu ky nay.
const PRIV = 'MC4CAQAwBQYDK2VwBCIEIAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8g';
const PUB = 'ebVWLo_mVPlAeLES6KmLp5AfhTrmlb7X4OORC60ElmQ';

describe('vector chu ky trong DEVICE-PROTOCOL.md', () => {
  it('POST /v1/heartbeat', async () => {
    const body = '{"state":1,"app_ver":"2.4.1"}';
    expect(await sha256Hex(body)).toBe('9c988fe6254f7a3302fb33f879385e791d10bda67dc85368fe881620f4382373');
    const msg = canonicalRequest('POST', '/v1/heartbeat', '1790000000', 'dGVzdC1ub25jZS0wMDAxMjM0NQ', await sha256Hex(body));
    expect(msg).toBe('POST\n/v1/heartbeat\n1790000000\ndGVzdC1ub25jZS0wMDAxMjM0NQ\n9c988fe6254f7a3302fb33f879385e791d10bda67dc85368fe881620f4382373');
    const sig = await ed25519Sign(PRIV, msg);
    expect(sig).toBe('CXnm2wux9_DA7w9k-ffoDVttGjqKMHjnqqfFVyE27vpclPh3_0WZ3ygHkxv8XPjybGuxllXWqns0Faj8MlvoCQ');
    expect(await ed25519Verify(PUB, sig, msg)).toBe(true);
  });
  it('GET /v1/manifest?etag=... (body rong)', async () => {
    const msg = canonicalRequest('GET', '/v1/manifest?etag=0123456789abcdef', '1790000000', 'dGVzdC1ub25jZS0wMDAyMzQ1Ng', await sha256Hex(''));
    const sig = await ed25519Sign(PRIV, msg);
    expect(sig).toBe('mXpRgShahnYz44uqDrSX6u8DA7shknkoBs5gFUwr4locDX74EgL8DU3XwagpYkjBeych2IcTcg-K9lMe_W4gCg');
  });
});
