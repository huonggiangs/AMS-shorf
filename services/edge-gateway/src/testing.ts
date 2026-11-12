// Tien ich cho test/sim: du lieu quang cao mau va ky yeu cau. KHONG dung trong production.
import type { Runtime } from '@ams/runtime';
import { canonicalRequest, ed25519Sign, generateEd25519KeyPair, sha256Hex, toBase64Url, randomBytes, utf8, type Ed25519KeyPair } from '@ams/shared';
import { HEADER } from './protocol.js';

export interface FixtureCreative {
  id: string;
  sha256: string;
}
export interface FixtureCampaign {
  id: string;
  slotId: string;
  creatives: FixtureCreative[];
}
export interface AdFixture {
  tenantId: string;
  customerId: string;
  campaigns: FixtureCampaign[];
}

export interface FixtureOpts {
  campaigns?: number;
  creativesPerCampaign?: number;
  regions?: string[] | null;
  rewardPoints?: number;
  targetType?: 'tv' | 'elevator' | 'led_p5';
  px?: { w: number; h: number };
  durationS?: number;
  state?: string;
  withObjects?: boolean;
}

/** Tao tenant/khach/chien dich active + lich + creative da duyet (+ tep trong object store de co sha256). */
export async function seedAdFixture(rt: Runtime, o: FixtureOpts = {}): Promise<AdFixture> {
  const now = rt.clock.now().toISOString();
  const start = new Date(rt.clock.now().getTime() - 86400_000).toISOString();
  const end = new Date(rt.clock.now().getTime() + 30 * 86400_000).toISOString();
  const tenantId = rt.id();
  const customerId = rt.id();
  await rt.db.run('INSERT INTO tenants (id, name, created_at) VALUES (?, ?, ?)', [tenantId, 'Tenant test', now]);
  await rt.db.run(`INSERT INTO customers (id, tenant_id, legal_name, short_name, payment_code, state, created_at) VALUES (?, ?, ?, ?, ?, 'active', ?)`, [
    customerId, tenantId, 'Khach test', 'KT', 'K' + customerId.slice(-6), now,
  ]);
  const campaigns: FixtureCampaign[] = [];
  for (let i = 0; i < (o.campaigns ?? 1); i++) {
    const cid = rt.id();
    await rt.db.run(
      `INSERT INTO campaigns (id, customer_id, name, state, budget_cap_vnd, approved_budget_vnd, reserved_vnd, spent_vnd, funding_state, start_at, end_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 50000000, 50000000, 50000000, 0, 'reserved', ?, ?, ?, ?)`,
      [cid, customerId, `Chien dich ${i + 1}`, o.state ?? 'active', start, end, now, now],
    );
    const slotId = rt.id();
    const regions = o.regions === null ? null : JSON.stringify(o.regions ?? ['HN', 'HCM']);
    await rt.db.run(
      `INSERT INTO schedule_slots (id, campaign_id, target_type, daypart, start_min, end_min, priority, reward_points, regions) VALUES (?, ?, ?, 'all_day', 0, 1440, 2, ?, ?)`,
      [slotId, cid, o.targetType ?? 'tv', o.rewardPoints ?? 10, regions],
    );
    const creatives: FixtureCreative[] = [];
    for (let k = 0; k < (o.creativesPerCampaign ?? 1); k++) {
      const id = rt.id();
      const key = `test/${customerId}/${id}.mp4`;
      const bytes = utf8(`creative-${id}`);
      if (o.withObjects !== false) await rt.objects.put(key, bytes, 'video/mp4');
      const w = o.px?.w ?? 1920 - k * 640;
      const h = o.px?.h ?? 1080 - k * 360;
      await rt.db.run(
        `INSERT INTO creatives (id, campaign_id, customer_id, name, target_type, px_w, px_h, orientation, kind, source, storage_key, mime, size_bytes, duration_s, scan_state, review_state, state, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'landscape', 'video', 'upload', ?, 'video/mp4', ?, ?, 'clean', 'approved', 'ready', ?)`,
        [id, cid, customerId, `c${k}.mp4`, o.targetType ?? 'tv', w, h, key, bytes.length, o.durationS ?? 15, now],
      );
      creatives.push({ id, sha256: await sha256Hex(bytes) });
    }
    campaigns.push({ id: cid, slotId, creatives });
  }
  return { tenantId, customerId, campaigns };
}

export interface SignedInit {
  method: string;
  path: string; // gom ca query
  body?: string;
  deviceId?: string;
  ts?: number;
  nonce?: string;
}

export function newNonce(): string {
  return toBase64Url(randomBytes(16));
}

/** Tao header + body da ky theo docs/DEVICE-PROTOCOL.md. */
export async function signRequest(privateKey: string, init: SignedInit): Promise<{ headers: Record<string, string>; body: string | undefined }> {
  const ts = String(init.ts ?? Math.floor(Date.now() / 1000));
  const nonce = init.nonce ?? newNonce();
  const body = init.body ?? '';
  const sig = await ed25519Sign(privateKey, canonicalRequest(init.method, init.path, ts, nonce, await sha256Hex(body)));
  const headers: Record<string, string> = { [HEADER.timestamp]: ts, [HEADER.nonce]: nonce, [HEADER.signature]: sig };
  if (init.deviceId) headers[HEADER.deviceId] = init.deviceId;
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  return { headers, body: init.body };
}

export { generateEd25519KeyPair, type Ed25519KeyPair };
