import type { Db, EventStore, EventTable, Queue } from '../types.js';

/** Duong nong: append -> Queue `events.<bang>` (ingest-consumer ghi Pipelines/R2/D1). Dem impression doc tu D1 (ev_ad_impression). */
export class CfEventStore implements EventStore {
  constructor(private queue: Queue, private db: Db) {}
  async append(table: EventTable, rows: Record<string, unknown>[]): Promise<void> {
    for (let i = 0; i < rows.length; i += 50) await this.queue.send(`events.${table}`, rows.slice(i, i + 50));
  }
  async countImpressions(campaignId: string, sinceIso?: string): Promise<number> {
    const r = sinceIso
      ? await this.db.query<{ n: number }>('SELECT COUNT(*) AS n FROM ev_ad_impression WHERE campaign_id = ? AND valid = 1 AND ts >= ?', [campaignId, sinceIso])
      : await this.db.query<{ n: number }>('SELECT COUNT(*) AS n FROM ev_ad_impression WHERE campaign_id = ? AND valid = 1', [campaignId]);
    return Number(r[0]?.n ?? 0);
  }
}
