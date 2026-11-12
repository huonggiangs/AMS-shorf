import type { Db, EventStore, EventTable } from './types.js';

const TABLES: Record<EventTable, { table: string; cols: string[] }> = {
  heartbeat: {
    table: 'ev_heartbeat',
    cols: ['ts', 'device_id', 'shard', 'region', 'app_ver', 'soc_temp', 'rssi', 'dl_mbps', 'cache_used_mb', 'cache_slots', 'state'],
  },
  ad_impression: {
    table: 'ev_ad_impression',
    cols: ['ts', 'event_id', 'device_id', 'screen_id', 'campaign_id', 'creative_id', 'slot_id', 'partner_id', 'region_id', 'vcr_pct', 'valid', 'reject_reason', 'revenue_micro_vnd', 'reward_vnd'],
  },
  proof_of_play: {
    table: 'ev_proof_of_play',
    cols: ['ts', 'screen_id', 'creative_id', 'duration_ms', 'source'],
  },
};

const REQUIRED: Record<EventTable, string[]> = {
  heartbeat: ['ts', 'device_id'],
  ad_impression: ['ts', 'event_id', 'campaign_id'],
  proof_of_play: ['ts', 'screen_id', 'creative_id'],
};

const DEFAULTS: Record<string, unknown> = { shard: 0, vcr_pct: 0, valid: 1, revenue_micro_vnd: 0, reward_vnd: 0, duration_ms: 0 };

function hourOf(ts: string): string {
  return ts.slice(0, 13) + ':00:00.000Z';
}

/** EventStore ghi vao bang ev_* (Postgres/SQLite/D1). ad_impression khu trung theo event_id va cong don impression_hourly. */
export class DbEventStore implements EventStore {
  constructor(private db: Db) {}

  async append(table: EventTable, rows: Record<string, unknown>[]): Promise<void> {
    const spec = TABLES[table];
    if (!spec) throw new Error(`bang su kien khong hop le: ${String(table)}`);
    if (rows.length === 0) return;
    for (const r of rows) {
      for (const k of REQUIRED[table]) if (r[k] === undefined || r[k] === null) throw new Error(`su kien ${table} thieu truong ${k}`);
    }
    const cols = spec.cols;
    const ph = cols.map(() => '?').join(',');
    if (table === 'ad_impression') {
      await this.db.tx(async (t) => {
        for (const r of rows) {
          const vals = cols.map((c) => (r[c] !== undefined ? r[c] : (DEFAULTS[c] ?? null)));
          const res = await t.run(`INSERT INTO ev_ad_impression (${cols.join(',')}) VALUES (${ph}) ON CONFLICT (event_id) DO NOTHING`, vals);
          if (res.changes === 0) continue; // trung event_id: bo qua, khong cong don
          const valid = Number(r.valid ?? 1) ? 1 : 0;
          await t.run(
            `INSERT INTO impression_hourly (hour, campaign_id, partner_id, region, impressions, valid, revenue_micro_vnd, reward_vnd)
             VALUES (?, ?, ?, ?, 1, ?, ?, ?)
             ON CONFLICT (hour, campaign_id, partner_id, region) DO UPDATE SET
               impressions = impression_hourly.impressions + 1,
               valid = impression_hourly.valid + excluded.valid,
               revenue_micro_vnd = impression_hourly.revenue_micro_vnd + excluded.revenue_micro_vnd,
               reward_vnd = impression_hourly.reward_vnd + excluded.reward_vnd`,
            [hourOf(String(r.ts)), r.campaign_id, r.partner_id ?? '', r.region_id ?? '', valid, valid ? Number(r.revenue_micro_vnd ?? 0) : 0, valid ? Number(r.reward_vnd ?? 0) : 0],
          );
        }
      });
      return;
    }
    await this.db.batch(
      rows.map((r) => ({
        sql: `INSERT INTO ${spec.table} (${cols.join(',')}) VALUES (${ph})`,
        params: cols.map((c) => (r[c] !== undefined ? r[c] : (DEFAULTS[c] ?? null))),
      })),
    );
  }

  async countImpressions(campaignId: string, sinceIso?: string): Promise<number> {
    const rows = sinceIso
      ? await this.db.query<{ n: number }>('SELECT COUNT(*) AS n FROM ev_ad_impression WHERE campaign_id = ? AND valid = 1 AND ts >= ?', [campaignId, sinceIso])
      : await this.db.query<{ n: number }>('SELECT COUNT(*) AS n FROM ev_ad_impression WHERE campaign_id = ? AND valid = 1', [campaignId]);
    return Number(rows[0]?.n ?? 0);
  }
}
