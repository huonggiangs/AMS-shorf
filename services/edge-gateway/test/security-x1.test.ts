import { describe, expect, it } from 'vitest';
import { TestDevice, harness, impression, type Harness } from './helpers.js';

const J = async <T = any>(r: Response): Promise<T> => (await r.json()) as T;
async function paired(h: Harness): Promise<TestDevice> {
  const d = await TestDevice.create(h);
  await d.pair();
  return d;
}

describe('R1-04 tran impression/gio nguyen tu', () => {
  it('20 lo song song x 50 su kien: tong valid <= maxPerDeviceHour', async () => {
    const he = await harness({ env: { EVENTS_LIMIT_PER_MIN: '1000' }, gw: { policy: { maxPerDeviceHour: 120 } } });
    try {
      const d = await paired(he);
      const batches = Array.from({ length: 20 }, () => ({ events: Array.from({ length: 50 }, () => impression(he)) }));
      const res = await Promise.all(batches.map((b) => d.call('POST', '/v1/events', b)));
      let valid = 0;
      for (const r of res) {
        if (r.status === 202) valid += (await J(r)).valid;
      }
      expect(res.some((r) => r.status === 202)).toBe(true);
      expect(valid).toBeLessThanOrEqual(120);
      expect(valid).toBe(120);
    } finally {
      await he.close();
    }
  });
});

describe('R1-09 gioi han than yeu cau', () => {
  const chunked = (n: number, size = 64 * 1024) => {
    let sent = 0;
    return new ReadableStream<Uint8Array>({
      pull(ctrl) {
        if (sent >= n) return ctrl.close();
        ctrl.enqueue(new Uint8Array(Math.min(size, n - sent)).fill(65));
        sent += size;
      },
    });
  };
  it('chunked 5 MB toi /v1/register, /v1/pair, /v1/heartbeat -> 413, khong can xac thuc', async () => {
    const he = await harness();
    try {
      for (const p of ['/v1/register', '/v1/pair', '/v1/heartbeat', '/v1/events']) {
        const r = await he.gw.app.request(p, { method: 'POST', body: chunked(5 * 1024 * 1024), duplex: 'half' } as RequestInit);
        expect(r.status, p).toBe(413);
      }
      const big = await he.gw.app.request('/v1/register', { method: 'POST', headers: { 'content-length': '999999999' }, body: '{}' });
      expect(big.status).toBe(413);
    } finally {
      await he.close();
    }
  });
});

describe('R1-03 manifest chi phat tep da quet sach', () => {
  const ids = (m: any) => (m.creatives as { id: string }[]).map((c) => c.id);
  it('pending/unscanned bi loai; clean duoc phat; setting allow_unscanned_creatives cho phep', async () => {
    const he = await harness({ fixture: { creativesPerCampaign: 3 } });
    try {
      const [a, b, c] = he.fixture.campaigns[0]!.creatives;
      await he.rt.db.run("UPDATE creatives SET scan_state = 'pending' WHERE id = ?", [b!.id]);
      await he.rt.db.run("UPDATE creatives SET scan_state = 'unscanned' WHERE id = ?", [c!.id]);
      const d = await paired(he);
      let m = await J(await d.call('GET', '/v1/manifest'));
      expect(ids(m)).toEqual([a!.id]);
      await he.rt.db.run("INSERT INTO settings (key, value, updated_at) VALUES ('allow_unscanned_creatives', '1', ?)", [he.rt.clock.now().toISOString()]);
      he.rt.clock.advance(3600_000); // het han bo nho manifest
      m = await J(await d.call('GET', '/v1/manifest?etag=none'));
      expect(ids(m).sort()).toEqual([a!.id, b!.id, c!.id].sort());
    } finally {
      await he.close();
    }
  });

  it('co ban chuyen ma -> URL tro toi rendition + sha256 cua rendition, khong dung storage_key', async () => {
    const he = await harness();
    try {
      const cr = he.fixture.campaigns[0]!.creatives[0]!;
      const cust = he.fixture.customerId;
      const rkey = `renditions/${cust}/${cr.id}/tv-safe-h264.mp4`;
      const sha = 'a'.repeat(64);
      await he.rt.objects.put(rkey, new TextEncoder().encode('x'), 'video/mp4');
      await he.rt.objects.put(`renditions/${cust}/${cr.id}/manifest.json`, new TextEncoder().encode(JSON.stringify({ creative_id: cr.id, renditions: [{ profile: 'tv-safe-h264', key: rkey, content_type: 'video/mp4', size: 1, sha256: sha }] })), 'application/json');
      const d = await paired(he);
      const m = await J(await d.call('GET', '/v1/manifest'));
      const e = m.creatives.find((x: any) => x.id === cr.id);
      expect(e.url).toContain(`renditions/${cust}/${cr.id}/tv-safe-h264.mp4`);
      expect(e.url).not.toContain(`test/${cust}`);
      expect(e.sha256).toBe(sha);
    } finally {
      await he.close();
    }
  });
});

describe('R1-13 dev endpoints / bi mat mac dinh', () => {
  it('local: mount /v1/dev/pair-confirm; AMS_ENV=production: khong mount', async () => {
    const a = await harness({ env: { GATEWAY_DEV_ENDPOINTS: '1' } });
    const b = await harness({ env: { GATEWAY_DEV_ENDPOINTS: '1', AMS_ENV: 'production' } });
    try {
      const post = (h: Harness) => h.gw.app.request('/v1/dev/pair-confirm', { method: 'POST', body: JSON.stringify({ code: '000000' }), headers: { 'content-type': 'application/json' } });
      expect((await post(a)).status).toBe(404); // co route, ma khong ton tai
      expect(((await (await post(a)).json()) as any).error?.code ?? 'x').not.toBe('not_found_route');
      expect((await post(b)).status).toBe(404);
    } finally {
      await a.close();
      await b.close();
    }
  });
  it('AMS_ENV=production + FIELD_ENC_KEY=change-me* -> tu choi khoi tao; local thi cho', async () => {
    await expect(harness({ env: { AMS_ENV: 'production', FIELD_ENC_KEY: 'change-me-field-enc-key' } })).rejects.toThrow(/change-me|mac dinh/);
    const ok = await harness({ env: { FIELD_ENC_KEY: 'change-me-field-enc-key' } });
    await ok.close();
  });
});
