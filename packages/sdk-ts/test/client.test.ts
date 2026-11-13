import { describe, expect, it } from 'vitest';
import { generateEd25519KeyPair, ed25519Verify, canonicalRequest, sha256Hex } from '@ams/shared';
import { ApiError, createAdminClient, createDeviceSigner, createGatewayClient } from '../src/index.js';

type Call = { url: string; init: RequestInit };
function mock(status: number, body: unknown, calls: Call[] = []): { fetch: typeof fetch; calls: Call[] } {
  return {
    calls,
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch,
  };
}

describe('admin client', () => {
  it('dien path/query, gan CSRF cho phuong thuc ghi, gui JSON', async () => {
    const m = mock(200, { status: 'scheduled', reserved_vnd: 1000 });
    const c = createAdminClient({ baseUrl: 'http://api.test/', fetch: m.fetch, csrfToken: 'tok' });
    const r = await c.post('/admin/v1/campaigns/{id}/approve', { path: { id: 'c 1' } });
    expect(r.ok).toBe(true);
    expect(m.calls[0]!.url).toBe('http://api.test/admin/v1/campaigns/c%201/approve');
    expect((m.calls[0]!.init.headers as Record<string, string>)['x-csrf-token']).toBe('tok');
    if (r.ok) expect(r.data.status).toBe('scheduled');
  });

  it('GET danh sach: query + khong gui CSRF', async () => {
    const m = mock(200, { items: [], total: 0, page: 2, page_size: 5 });
    const c = createAdminClient({ baseUrl: 'http://api.test', fetch: m.fetch, csrfToken: 'tok' });
    const r = await c.get('/admin/v1/campaigns', { query: { page: 2, page_size: 5, q: 'abc' } });
    expect(m.calls[0]!.url).toBe('http://api.test/admin/v1/campaigns?page=2&page_size=5&q=abc');
    expect((m.calls[0]!.init.headers as Record<string, string>)['x-csrf-token']).toBeUndefined();
    if (r.ok) expect(r.data.total).toBe(0);
  });

  it('loi: dang { error:{code,message} } -> ok=false; call() nem ApiError', async () => {
    const m = mock(422, { error: { code: 'validation_error', message: 'Dữ liệu không hợp lệ.', details: { a: 1 } } });
    const c = createAdminClient({ baseUrl: 'http://x', fetch: m.fetch });
    const r = await c.post('/admin/v1/campaigns/{id}/reject', { path: { id: '1' }, body: { reason: 'ab' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('validation_error');
    await expect(c.call('post', '/admin/v1/campaigns/{id}/reject', { path: { id: '1' }, body: { reason: 'ab' } })).rejects.toBeInstanceOf(ApiError);
  });

  it('loi mang -> network_error, khong nem', async () => {
    const c = createAdminClient({ baseUrl: 'http://x', fetch: (async () => { throw new Error('boom'); }) as unknown as typeof fetch });
    const r = await c.get('/auth/me');
    expect(r).toMatchObject({ ok: false, status: 0, error: { code: 'network_error' } });
  });

  it('kieu: thieu tham so bat buoc la loi bien dich', () => {
    const c = createAdminClient({ baseUrl: 'http://x', fetch: mock(200, {}).fetch });
    const never = () => {
      // @ts-expect-error thieu path.id
      void c.post('/admin/v1/campaigns/{id}/approve', {});
      // @ts-expect-error reason phai la string theo zod
      void c.post('/admin/v1/campaigns/{id}/reject', { path: { id: '1' }, body: { reason: 5 } });
    };
    expect(typeof never).toBe('function'); // chi kiem tra luc bien dich (tsc), khong chay
  });
});

describe('device signer + gateway client', () => {
  it('chu ky khop canonicalRequest cua gateway va xac minh duoc bang ed25519Verify', async () => {
    const kp = await generateEd25519KeyPair();
    const m = mock(200, { ok: true, acked: 1, known: 1, unknown: 0 });
    const sign = createDeviceSigner({ deviceId: 'dev1', privateKey: kp.privateKey, now: () => 1_700_000_000_000, nonce: () => 'abcdefghijklmnop' });
    const c = createGatewayClient({ baseUrl: 'http://gw.test', fetch: m.fetch, sign });
    const body = { acks: [{ id: 'cmd1', status: 'ok' as const }] };
    const r = await c.post('/v1/commands/ack', { body });
    expect(r.ok).toBe(true);
    const h = m.calls[0]!.init.headers as Record<string, string>;
    expect(h['x-device-id']).toBe('dev1');
    expect(h['x-timestamp']).toBe('1700000000');
    const raw = new TextEncoder().encode(JSON.stringify(body));
    const msg = canonicalRequest('POST', '/v1/commands/ack', '1700000000', 'abcdefghijklmnop', await sha256Hex(raw));
    expect(await ed25519Verify(kp.publicKey, h['x-signature']!, msg)).toBe(true);
    expect(h['x-signature']).toHaveLength(86);
  });

  it('chu ky bao gom query', async () => {
    const kp = await generateEd25519KeyPair();
    const m = mock(304, undefined);
    const c = createGatewayClient({ baseUrl: 'http://gw.test', fetch: m.fetch, sign: createDeviceSigner({ deviceId: 'd', privateKey: kp.privateKey, now: () => 1_700_000_000_000, nonce: () => '0123456789abcdef' }) });
    const r = await c.get('/v1/manifest', { query: { etag: 'e1', delta: '1' }, headers: {} });
    expect(r.ok).toBe(true); // 304 coi nhu khong doi
    const h = m.calls[0]!.init.headers as Record<string, string>;
    const msg = canonicalRequest('GET', '/v1/manifest?etag=e1&delta=1', '1700000000', '0123456789abcdef', await sha256Hex(new Uint8Array()));
    expect(await ed25519Verify(kp.publicKey, h['x-signature']!, msg)).toBe(true);
  });
});
