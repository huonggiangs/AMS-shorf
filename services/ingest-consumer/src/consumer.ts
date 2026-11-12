// ingest-consumer: nhan lo su kien tu queue, khu trung, ghi event store, tru chi tieu chien dich (qua ham duoc tiem vao).
// Khong import @ams/payments: ben tai chinh cung cap SpendFn khi gan consumer vao tien trinh.
import { DbEventStore, type EventStore, type Runtime } from '@ams/runtime';
import { sha256Hex } from '@ams/shared';
import { INGEST_TOPIC, type ImpressionRow, type IngestMessage } from './contract.js';

export interface SpendRequest {
  campaignId: string;
  customerId: string;
  /** tong doanh thu cua cac impression hop le MOI trong lo nay, micro-VND (1 VND = 1.000.000). Ben tai chinh quyet dinh lam tron/cong don. */
  amountMicroVnd: number;
  impressions: number;
  /** on dinh theo tap event_id: goi lai voi cung khoa PHAI khong tru lan hai */
  idempotencyKey: string;
  firstTs: string;
  lastTs: string;
}
export type SpendFn = (req: SpendRequest) => Promise<void>;

export interface IngestOptions {
  /** noi ghi su kien. Mac dinh: Cloudflare -> DbEventStore(rt.db) (tranh vong lap voi CfEventStore); con lai rt.events */
  sink?: EventStore;
  spend?: SpendFn;
  dedupeTtlSec?: number;
  log?: (msg: string) => void;
}

export interface IngestStats {
  messages: number;
  received: number;
  duplicates: number;
  appended: number;
  invalid: number;
  spendCalls: number;
  spendSkippedNoFn: number;
  pops: number;
  errors: number;
}

export interface IngestConsumer {
  handle(msg: IngestMessage): Promise<void>;
  handleRows(table: 'heartbeat' | 'ad_impression' | 'proof_of_play', rows: Record<string, unknown>[]): Promise<void>;
  /** dang ky vao rt.queue (ingest.events + events.*) */
  subscribe(): void;
  stats: IngestStats;
}

const DEDUPE_TTL = 7 * 24 * 3600;
const chunk = <T,>(a: T[], n: number): T[][] => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

export function createIngestConsumer(rt: Runtime, opts: IngestOptions = {}): IngestConsumer {
  const sink: EventStore = opts.sink ?? (rt.config.runtime === 'cloudflare' ? new DbEventStore(rt.db) : rt.events);
  const ttl = opts.dedupeTtlSec ?? DEDUPE_TTL;
  const stats: IngestStats = { messages: 0, received: 0, duplicates: 0, appended: 0, invalid: 0, spendCalls: 0, spendSkippedNoFn: 0, pops: 0, errors: 0 };
  const customerCache = new Map<string, { at: number; customerId: string | null }>();

  async function customerOf(campaignId: string): Promise<string | null> {
    const now = rt.clock.now().getTime();
    const hit = customerCache.get(campaignId);
    if (hit && now - hit.at < 300_000) return hit.customerId;
    const r = await rt.db.query<{ customer_id: string }>('SELECT customer_id FROM campaigns WHERE id = ?', [campaignId]);
    const v = r[0]?.customer_id ?? null;
    if (customerCache.size > 10_000) customerCache.clear();
    customerCache.set(campaignId, { at: now, customerId: v });
    return v;
  }

  /** Giu cho event_id bang kv (nguyen tu tren Redis); tra ve cac id GIANH DUOC. */
  async function claim(prefix: string, ids: string[]): Promise<Set<string>> {
    const won = new Set<string>();
    for (const id of ids) if ((await rt.kv.incr(`${prefix}${id}`, ttl)) === 1) won.add(id);
    return won;
  }
  async function release(prefix: string, ids: Iterable<string>): Promise<void> {
    for (const id of ids) await rt.kv.del(`${prefix}${id}`).catch(() => undefined);
  }

  /** Tang 2: event_id da co trong bang (kv het han / mat) */
  async function existingIds(ids: string[]): Promise<Set<string>> {
    const out = new Set<string>();
    for (const part of chunk(ids, 50)) {
      const rows = await rt.db.query<{ event_id: string }>(`SELECT event_id FROM ev_ad_impression WHERE event_id IN (${part.map(() => '?').join(',')})`, part);
      for (const r of rows) out.add(r.event_id);
    }
    return out;
  }

  async function ingestImpressions(rows: ImpressionRow[]): Promise<void> {
    stats.received += rows.length;
    const byId = new Map<string, ImpressionRow>();
    for (const r of rows) if (!byId.has(r.event_id)) byId.set(r.event_id, r);
    const ids = [...byId.keys()];
    const won = await claim('ingest:imp:', ids);
    try {
      const have = won.size > 0 ? await existingIds([...won]) : new Set<string>();
      const fresh = [...won].filter((id) => !have.has(id)).map((id) => byId.get(id)!);
      stats.duplicates += rows.length - fresh.length;
      if (fresh.length === 0) return;
      // THU TU: chi tieu truoc, ghi su kien sau. Chi tieu idempotent theo tap event_id nen giao lai an toan
      // (neu ghi su kien that bai sau khi da tru, lan thu lai tru-lai la no-op). Dao nguoc thu tu se mat chi tieu khi giao lai.
      const billable = fresh.filter((r) => r.valid === 1 && r.revenue_micro_vnd > 0);
      const byCampaign = new Map<string, ImpressionRow[]>();
      for (const r of billable) byCampaign.set(r.campaign_id, [...(byCampaign.get(r.campaign_id) ?? []), r]);
      for (const [campaignId, list] of byCampaign) {
        if (!opts.spend) {
          stats.spendSkippedNoFn += list.length;
          continue;
        }
        const customerId = await customerOf(campaignId);
        if (!customerId) {
          opts.log?.(`ingest: chien dich ${campaignId} khong ton tai, bo qua chi tieu cua ${list.length} impression`);
          continue;
        }
        const sorted = list.map((r) => r.event_id).sort();
        await opts.spend({
          campaignId,
          customerId,
          amountMicroVnd: list.reduce((s, r) => s + Number(r.revenue_micro_vnd), 0),
          impressions: list.length,
          idempotencyKey: 'imp:' + (await sha256Hex(sorted.join(','))).slice(0, 32),
          firstTs: list.reduce((m, r) => (r.ts < m ? r.ts : m), list[0]!.ts),
          lastTs: list.reduce((m, r) => (r.ts > m ? r.ts : m), list[0]!.ts),
        });
        stats.spendCalls++;
      }
      await sink.append('ad_impression', fresh as unknown as Record<string, unknown>[]); // DbEventStore: UNIQUE + impression_hourly
      stats.appended += fresh.length;
      stats.invalid += fresh.filter((r) => r.valid !== 1).length;
    } catch (e) {
      stats.errors++;
      // tra lai quyen giu de lan giao lai (queue retry) xu ly lai; chi tieu idempotent theo tap event_id, ghi su kien idempotent theo UNIQUE
      await release('ingest:imp:', won);
      throw e;
    }
  }

  async function ingestPops(device: string, pops: IngestMessage['pops']): Promise<void> {
    const ids = pops.map((p) => p.event_id);
    const won = await claim('ingest:pop:', ids);
    try {
      const fresh = pops.filter((p) => won.has(p.event_id));
      if (fresh.length === 0) return;
      await sink.append('proof_of_play', fresh.map((p) => ({ ts: p.ts, screen_id: p.screen_id, creative_id: p.creative_id, duration_ms: p.duration_ms, source: p.source ?? device })));
      stats.pops += fresh.length;
    } catch (e) {
      stats.errors++;
      await release('ingest:pop:', won);
      throw e;
    }
  }

  const consumer: IngestConsumer = {
    stats,
    async handle(msg) {
      stats.messages++;
      if (!msg || msg.v !== 1) return; // phien ban la: bo (khong retry vo han)
      if (msg.impressions?.length) await ingestImpressions(msg.impressions);
      if (msg.pops?.length) await ingestPops(msg.device_id, msg.pops);
    },
    async handleRows(table, rows) {
      stats.messages++;
      if (table === 'ad_impression') return ingestImpressions(rows as unknown as ImpressionRow[]);
      await sink.append(table, rows);
    },
    subscribe() {
      rt.queue.subscribe(INGEST_TOPIC, (m) => consumer.handle(m as IngestMessage));
      // duong CfEventStore: events.<bang>
      rt.queue.subscribe('events.heartbeat', (m) => consumer.handleRows('heartbeat', m as Record<string, unknown>[]));
      rt.queue.subscribe('events.proof_of_play', (m) => consumer.handleRows('proof_of_play', m as Record<string, unknown>[]));
      rt.queue.subscribe('events.ad_impression', (m) => consumer.handleRows('ad_impression', m as Record<string, unknown>[]));
    },
  };
  return consumer;
}
