// v-link: manifest cho creative "dan link" (stream): delivery/kind/duration_ms/etag, KHONG sha256/size; creative tai len khong doi; loai khi bi gan co.
import { describe, expect, it } from 'vitest';
import { TestDevice, harness, impression, type Harness } from './helpers.js';

const J = async <T = any>(r: Response): Promise<T> => (await r.json()) as T;
const STREAM_URL = 'https://cdn.adhost.vn/ads/8k.mp4';

async function addStream(h: Harness, o: { kind?: string; px?: boolean; state?: string } = {}): Promise<string> {
  const camp = h.fixture.campaigns[0]!;
  const id = h.rt.id();
  const now = h.rt.clock.now().toISOString();
  await h.rt.db.run(
    `INSERT INTO creatives (id, campaign_id, customer_id, name, target_type, px_w, px_h, orientation, kind, source, source_url, storage_key, mime, size_bytes, duration_s, scan_state, review_state, state, created_at)
     VALUES (?, ?, ?, 'stream.mp4', 'tv', ?, ?, 'landscape', 'video', 'url', ?, NULL, 'video/mp4', NULL, 20, 'clean', 'approved', 'ready', ?)`,
    [id, camp.id, h.fixture.customerId, o.px === false ? null : 7680, o.px === false ? null : 4320, STREAM_URL, now],
  );
  await h.rt.db.run(
    `INSERT INTO creative_stream (creative_id, delivery, stream_url, stream_kind, declared_duration_s, content_type, content_length, etag, last_modified, body_hash, binding, probe_status, fail_count, needs_review, checked_at, created_at)
     VALUES (?, 'stream', ?, ?, 20, 'video/mp4', 5000000, '"abc"', NULL, NULL, 'b1', 'ok', 0, 0, ?, ?)`,
    [id, STREAM_URL, o.kind ?? 'mp4', now, now],
  );
  return id;
}
const refresh = async (h: Harness) => {
  await h.gw.manifests.invalidate();
  await h.rt.kv.del('manifest:HN.all.tv');
};

describe('manifest: creative delivery=stream', () => {
  it('stream: url goc + delivery/kind/duration_ms/etag, khong sha256/size; tai len giu nguyen (khong co delivery)', async () => {
    const h = await harness({ fixture: { campaigns: 1, creativesPerCampaign: 1 } });
    try {
      const sid = await addStream(h, { kind: 'hls' });
      const d = await TestDevice.create(h);
      const m = await J(await d.call('GET', '/v1/manifest'));
      const s = m.creatives.find((x: any) => x.id === sid);
      expect(s).toMatchObject({ delivery: 'stream', url: STREAM_URL, kind: 'hls', duration_ms: 20000, duration_s: 20, etag: '"abc"', media_type: 'video', px_w: 7680, px_h: 4320, size_bytes: null });
      expect('sha256' in s).toBe(false);
      const up = m.creatives.find((x: any) => x.id === h.fixture.campaigns[0]!.creatives[0]!.id);
      expect(up.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect('delivery' in up).toBe(false);
      expect(up.url.startsWith('https://media.test/')).toBe(true);
      expect(m.schedule.flatMap((x: any) => x.creative_ids)).toContain(sid);
    } finally {
      await h.close();
    }
  });

  it('loai khoi manifest khi: needs_review=1, probe_status khac ok, scan_state khac clean, duyet bi huy (approved_version != content_version)', async () => {
    const h = await harness({ fixture: { campaigns: 1, creativesPerCampaign: 1 } });
    try {
      const sid = await addStream(h);
      const d = await TestDevice.create(h);
      const ids = async () => (await J(await d.call('GET', '/v1/manifest'))).creatives.map((x: any) => x.id);
      expect(await ids()).toContain(sid);
      for (const [sql, undo] of [
        ["UPDATE creative_stream SET needs_review = 1 WHERE creative_id = ?", "UPDATE creative_stream SET needs_review = 0 WHERE creative_id = ?"],
        ["UPDATE creative_stream SET probe_status = 'changed' WHERE creative_id = ?", "UPDATE creative_stream SET probe_status = 'ok' WHERE creative_id = ?"],
        ["UPDATE creative_stream SET probe_status = 'unreachable' WHERE creative_id = ?", "UPDATE creative_stream SET probe_status = 'ok' WHERE creative_id = ?"],
        ["UPDATE creatives SET scan_state = 'needs_manual_review' WHERE id = ?", "UPDATE creatives SET scan_state = 'clean' WHERE id = ?"],
        ["UPDATE creatives SET review_state = 'pending' WHERE id = ?", "UPDATE creatives SET review_state = 'approved' WHERE id = ?"],
      ] as const) {
        await h.rt.db.run(sql, [sid]);
        await refresh(h);
        expect(await ids(), sql).not.toContain(sid);
        await h.rt.db.run(undo, [sid]);
        await refresh(h);
        expect(await ids(), undo).toContain(sid);
      }
      // approved_version != content_version (noi dung xa doi sau duyet)
      await h.rt.db.run("INSERT INTO creative_security (creative_id, content_version, approved_version, updated_at) VALUES (?, 3, 2, ?)", [sid, h.rt.clock.now().toISOString()]);
      await refresh(h);
      expect(await ids()).not.toContain(sid);
      // allow_unscanned_creatives KHONG mo cua cho stream chua clean
      await h.rt.db.run("UPDATE creative_security SET approved_version = 3 WHERE creative_id = ?", [sid]);
      await h.rt.db.run("INSERT INTO settings (key, value, updated_by, updated_at) VALUES ('allow_unscanned_creatives', '1', NULL, ?)", [h.rt.clock.now().toISOString()]);
      await h.rt.db.run("UPDATE creatives SET scan_state = 'needs_manual_review' WHERE id = ?", [sid]);
      await refresh(h);
      expect(await ids()).not.toContain(sid);
    } finally {
      await h.close();
    }
  });

  it('impression stream: quy tac 0.9 x thoi luong khai bao (rebuffer lam played_ms ngan => flagged short_play); khong doi tinh tien', async () => {
    const h = await harness({ fixture: { campaigns: 1, creativesPerCampaign: 1 } });
    try {
      const sid = await addStream(h);
      const d = await TestDevice.create(h);
      await h.rt.db.run('UPDATE devices SET trust_level = 1 WHERE id = ?', [d.id]).catch(() => undefined);
      await d.call('GET', '/v1/manifest');
      const camp = h.fixture.campaigns[0]!;
      const mk = (played: number) => {
        const e = impression(h, { played });
        return { ...e, creative_id: sid, campaign_id: camp.id };
      };
      const r = await J(await d.call('POST', '/v1/events', { events: [mk(18000), mk(17000)] })); // >= 0.9 x 20 s hop le; 17 s (rebuffer ~3 s) < 18 s
      expect(r.valid + r.flagged).toBe(2);
      expect(r.flagged).toBeGreaterThanOrEqual(1);
      await h.rt.queue.drain();
      const rows = await h.rt.db.query<{ reject_reason: string | null; played_ms: number }>('SELECT reject_reason, vcr_pct FROM ev_ad_impression WHERE creative_id = ? ORDER BY reject_reason DESC', [sid]);
      expect(rows.map((x) => x.reject_reason)).toEqual(['short_play', null]);
    } finally {
      await h.close();
    }
  });
});

describe('Signage Player (thang may) + creative stream', () => {
  async function addElevatorStream(h: Harness, campId: string, customerId: string, w: number, hgt: number): Promise<string> {
    const id = h.rt.id();
    const now = h.rt.clock.now().toISOString();
    await h.rt.db.run(
      `INSERT INTO creatives (id, campaign_id, customer_id, name, target_type, px_w, px_h, orientation, kind, source, source_url, storage_key, mime, size_bytes, duration_s, scan_state, review_state, state, created_at)
       VALUES (?, ?, ?, 'st.mp4', 'elevator', ?, ?, 'portrait', 'video', 'url', ?, NULL, 'video/mp4', NULL, 15, 'clean', 'approved', 'ready', ?)`,
      [id, campId, customerId, w, hgt, STREAM_URL, now],
    );
    await h.rt.db.run(
      `INSERT INTO creative_stream (creative_id, delivery, stream_url, stream_kind, declared_duration_s, binding, probe_status, fail_count, needs_review, checked_at, created_at) VALUES (?, 'stream', ?, 'hls', 15, 'b', 'ok', 0, 0, ?, ?)`,
      [id, STREAM_URL, now, now],
    );
    return id;
  }

  it('thang may 1080x1920: entry stream di cung entry tai len, co fit, khong sha256; man 768 khong nhan ban 1080; giu nguyen rule bac', async () => {
    const h = await harness({ env: { HB_MIN_GAP_S: '0' }, fixture: { campaigns: 1, targetType: 'elevator', px: { w: 768, h: 1366 }, regions: null } });
    try {
      const camp = h.fixture.campaigns[0]!;
      const sid = await addElevatorStream(h, camp.id, h.fixture.customerId, 1080, 1920);
      const d1080 = await TestDevice.create(h, { kind: 'elevator', model: 'RK3568', os: 'android-11', app_version: '1.0.0', px_w: 1080, px_h: 1920 });
      const m = await J(await d1080.call('GET', '/v1/manifest'));
      const s = m.creatives.find((x: any) => x.id === sid);
      expect(s).toMatchObject({ delivery: 'stream', kind: 'hls', duration_ms: 15000, px_w: 1080, px_h: 1920, fit: expect.any(String) });
      expect('sha256' in s).toBe(false);
      expect(m.schedule.flatMap((x: any) => x.creative_ids)).toContain(sid);
      // man 768x1366: bac cao hon khong day xuong (ca stream lan tai len)
      const d768 = await TestDevice.create(h, { kind: 'elevator', model: 'RK3568', os: 'android-11', app_version: '1.0.0', px_w: 768, px_h: 1366 });
      expect((await J(await d768.call('GET', '/v1/manifest'))).creatives.map((x: any) => x.id)).not.toContain(sid);
    } finally {
      await h.close();
    }
  });
});
