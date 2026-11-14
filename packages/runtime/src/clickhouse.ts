import type { EventStore, EventTable } from './types.js';

/**
 * Ghi su kien vao ClickHouse qua HTTP (JSONEachRow). CHUA kiem chung tren ClickHouse that (moi truong khong co Docker).
 * Hop dong: ingest-consumer phai gui hang da dung kieu cot theo packages/db/clickhouse/001_events.sql (id UInt64...).
 */
export class ClickHouseEventStore implements EventStore {
  constructor(private url: string, private database = 'default', private fetchFn: typeof fetch = fetch) {}

  async append(table: EventTable, rows: Record<string, unknown>[]): Promise<void> {
    if (rows.length === 0) return;
    const q = encodeURIComponent(`INSERT INTO ${this.database}.${table} FORMAT JSONEachRow`);
    const res = await this.fetchFn(`${this.url}/?query=${q}`, { method: 'POST', body: rows.map((r) => JSON.stringify(table === 'proof_of_play' ? { ...r, event_id: undefined } : r)).join('\n') });
    if (!res.ok) throw new Error(`ClickHouse insert ${table} loi ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  async countImpressions(campaignId: string, sinceIso?: string): Promise<number> {
    const since = sinceIso ? ` AND ts >= parseDateTimeBestEffort('${sinceIso.replace(/'/g, '')}')` : '';
    const id = String(campaignId).replace(/[^0-9]/g, '');
    const q = `SELECT count() FROM ${this.database}.ad_impression FINAL WHERE campaign_id = ${id || 0} AND valid = 1${since} FORMAT TabSeparated`;
    const res = await this.fetchFn(`${this.url}/?query=${encodeURIComponent(q)}`);
    if (!res.ok) throw new Error(`ClickHouse count loi ${res.status}`);
    return Number((await res.text()).trim() || 0);
  }
}
