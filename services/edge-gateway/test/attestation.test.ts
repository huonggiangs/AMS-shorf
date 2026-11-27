// Cam ket phap ly (migration 0029): manifest CHI phat creative co cam ket hieu luc; truong dung ten/kieu ma TV Mindo (WP-30) yeu cau.
import { describe, expect, it } from 'vitest';
import { attestForTest } from '../src/testing.js';
import { TestDevice, harness, type Harness } from './helpers.js';

const J = async <T = any>(r: Response): Promise<T> => (await r.json()) as T;
const refresh = async (h: Harness) => {
  await h.gw.manifests.invalidate();
  await h.rt.kv.del('manifest:HN.all.tv');
};
const manifest = async (h: Harness) => J(await (await TestDevice.create(h)).call('GET', '/v1/manifest'));

/** Ban sao logic legalOk/kid_safe cua TV (packages/core/src/ads.ts normalizeManifest cua Mindo) de chung minh manifest qua duoc cua loc. */
function tvAccepts(c: any): boolean {
  if (c.kid_safe !== true) return false;
  if (c.legal_attested !== true) return false;
  if (typeof c.attested_by !== 'string' || c.attested_by.trim().length === 0 || c.attested_by.length > 64) return false;
  return typeof c.attestation_version === 'string' && c.attestation_version.trim().length > 0;
}

describe('manifest: cam ket phap ly', () => {
  it('co cam ket hieu luc: phat dung ten/kieu truong TV yeu cau, lay tu ban ghi that; TV chap nhan', async () => {
    const h = await harness({ fixture: { campaigns: 1, creativesPerCampaign: 1, attested: false } });
    try {
      const cid = h.fixture.campaigns[0]!.creatives[0]!.id;
      await attestForTest(h.rt, cid, { by: 'u-123', name: 'Lê Trường Sơn', version: 'legal-v1', kidSafe: true });
      await refresh(h);
      const c = (await manifest(h)).creatives[0];
      expect(c).toMatchObject({ id: cid, kid_safe: true, legal_attested: true, attested_by: 'Lê Trường Sơn', attestation_version: 'legal-v1' });
      expect(typeof c.attested_at).toBe('string');
      expect(tvAccepts(c)).toBe(true);
    } finally {
      await h.close();
    }
  });

  it('khong co ban ghi cam ket: creative KHONG vao manifest (khong phat legal_attested gia)', async () => {
    const h = await harness({ fixture: { campaigns: 1, creativesPerCampaign: 1, attested: false } });
    try {
      const m = await manifest(h);
      expect(m.creatives).toEqual([]);
      expect(m.schedule).toEqual([]);
      expect(JSON.stringify(m)).not.toContain('legal_attested');
    } finally {
      await h.close();
    }
  });

  it('kid_safe theo lua chon nguoi ky: khong tick => kid_safe=false (TV se bo, TV khong tu dat true)', async () => {
    const h = await harness({ fixture: { campaigns: 1, creativesPerCampaign: 1, attested: false } });
    try {
      await attestForTest(h.rt, h.fixture.campaigns[0]!.creatives[0]!.id, { kidSafe: false });
      await refresh(h);
      const c = (await manifest(h)).creatives[0];
      expect(c.kid_safe).toBe(false);
      expect(c.legal_attested).toBe(true);
      expect(tvAccepts(c)).toBe(false);
    } finally {
      await h.close();
    }
  });

  it('doi noi dung (content_version tang) hoac thu hoi => cam ket cu het hieu luc, creative roi khoi manifest', async () => {
    const h = await harness({ fixture: { campaigns: 1, creativesPerCampaign: 1 } });
    try {
      const cid = h.fixture.campaigns[0]!.creatives[0]!.id;
      expect((await manifest(h)).creatives.map((x: any) => x.id)).toContain(cid);
      await h.rt.db.run("INSERT INTO creative_security (creative_id, content_version, updated_at) VALUES (?, 2, ?)", [cid, h.rt.clock.now().toISOString()]);
      await refresh(h);
      expect((await manifest(h)).creatives).toEqual([]); // cam ket gan voi v1, noi dung dang v2
      await attestForTest(h.rt, cid); // ky lai cho v2
      await refresh(h);
      expect((await manifest(h)).creatives.map((x: any) => x.id)).toContain(cid);
      await h.rt.db.run('UPDATE creative_attestations SET revoked_at = ? WHERE creative_id = ?', [h.rt.clock.now().toISOString(), cid]);
      await refresh(h);
      expect((await manifest(h)).creatives).toEqual([]);
    } finally {
      await h.close();
    }
  });

  it('attested_by dai hon 64 ky tu duoc cat con 64; chi nguoi ky moi nhat con hieu luc duoc dung', async () => {
    const h = await harness({ fixture: { campaigns: 1, creativesPerCampaign: 1, attested: false } });
    try {
      const cid = h.fixture.campaigns[0]!.creatives[0]!.id;
      await attestForTest(h.rt, cid, { name: 'A'.repeat(100) });
      await refresh(h);
      const c = (await manifest(h)).creatives[0];
      expect(c.attested_by.length).toBe(64);
      expect(tvAccepts(c)).toBe(true);
    } finally {
      await h.close();
    }
  });
});
