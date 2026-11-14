// ingest-consumer: nhan lo su kien tu queue, khu trung, ghi event store, tru chi tieu chien dich (qua ham duoc tiem vao).
// Khong import @ams/payments: ben tai chinh cung cap SpendFn khi gan consumer vao tien trinh.
import { DbEventStore, kvClaimMany, type EventStore, type Runtime } from '@ams/runtime';
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
  /** danh sach su kien tinh tien (id + micro-VND): ben tai chinh khu trung THEO TUNG event_id, nen gom lo khac nhau / giao lai / mat dien deu khong tru kep hay mat */
  events?: { id: string; micro: number }[];
}
export type SpendFn = (req: SpendRequest) => Promise<void>;

export interface IngestOptions {
  /** noi ghi su kien. Mac dinh: Cloudflare -> DbEventStore(rt.db) (tranh vong lap voi CfEventStore); con lai rt.events */
  sink?: EventStore;
  spend?: SpendFn;
  dedupeTtlSec?: number;
  log?: (msg: string) => void;
  /** so vong nhan (subscribe) song song tren hang doi that (Redis). Mac dinh 1: MemoryQueue gui moi tin cho MOI handler nen khong tang trong test. */
  concurrency?: number;
  /** so thong diep toi da gom thanh mot lo (mot lan chi tieu/ghi/danh dau cho ca lo). Mac dinh 64. */
  maxBatch?: number;
  /** so lenh kv song song toi da trong mot lo (get/set/incr/del; ioredis day ong tren mot ket noi). Mac dinh 32. */
  ioConcurrency?: number;
  /** so lan xu ly that bai cua CUNG mot thong diep truoc khi chuyen vao dead-letter va xac nhan (ack). Mac dinh 3 (bang MAX_ATTEMPTS cua RedisQueue). */
  maxAttempts?: number;
}

/** Topic dead-letter: thong diep doc (that bai maxAttempts lan) duoc gui o day kem loi; gui lai vao INGEST_TOPIC de phat lai (moi buoc idempotent). */
export const DEAD_LETTER_TOPIC = 'ingest.events.dead';

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
  batches: number;
  deadLettered: number;
}

export interface IngestConsumer {
  handle(msg: IngestMessage): Promise<void>;
  handleRows(table: 'heartbeat' | 'ad_impression' | 'proof_of_play', rows: Record<string, unknown>[]): Promise<void>;
  /** dang ky vao rt.queue (ingest.events + events.*) */
  subscribe(): void;
  stats: IngestStats;
}

const DEDUPE_TTL = 7 * 24 * 3600;
const ATTEMPT_TTL = 24 * 3600;
/** map song song co gioi han (giu thu tu ket qua) */
async function pmap<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
const chunk = <T,>(a: T[], n: number): T[][] => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

export function createIngestConsumer(rt: Runtime, opts: IngestOptions = {}): IngestConsumer {
  const sink: EventStore = opts.sink ?? (rt.config.runtime === 'cloudflare' ? new DbEventStore(rt.db) : rt.events);
  const ttl = opts.dedupeTtlSec ?? DEDUPE_TTL;
  const ioN = Math.max(1, opts.ioConcurrency ?? 32);
  const maxBatch = Math.max(1, opts.maxBatch ?? 64);
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 3);
  const stats: IngestStats = { messages: 0, received: 0, duplicates: 0, appended: 0, invalid: 0, spendCalls: 0, spendSkippedNoFn: 0, pops: 0, errors: 0, batches: 0, deadLettered: 0 };
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
    // mot vong cho ca lo (Cloudflare: D1 batch nguyen tu; Redis: pipeline), theo cum de khong vuot gioi han cau lenh/lo
    for (const part of chunk(ids, 100)) {
      const res = await kvClaimMany(rt.kv, part.map((id) => `${prefix}${id}`), ttl);
      part.forEach((id, i) => res[i] && won.add(id));
    }
    return won;
  }
  async function release(prefix: string, ids: Iterable<string>): Promise<void> {
    await pmap([...ids], ioN, (id) => rt.kv.del(`${prefix}${id}`).catch(() => undefined));
  }

  /** Tang 2: event_id da co trong bang (kv het han / mat) */
  async function existingIds(ids: string[]): Promise<Set<string>> {
    const out = new Set<string>();
    for (const part of chunk(ids, 200)) {
      const rows = await rt.db.query<{ event_id: string }>(`SELECT event_id FROM ev_ad_impression WHERE event_id IN (${part.map(() => '?').join(',')})`, part);
      for (const r of rows) out.add(r.event_id);
    }
    return out;
  }

  async function ingestImpressions(rows: ImpressionRow[]): Promise<void> {
    stats.received += rows.length;
    const byId = new Map<string, ImpressionRow>();
    for (const r of rows) if (!byId.has(r.event_id)) byId.set(r.event_id, r);
    stats.duplicates += rows.length - byId.size;
    // Duong nhanh: cho "xong" (kv) chi duoc DAT SAU KHI chi tieu + ghi su kien deu thanh cong, nen mat dien/that bai
    // khong bao gio de lai dau "da xu ly" gia (khac cho chiem truoc, tung lam mat ca chi tieu lan su kien khi tien trinh chet giua chung).
    const all = [...byId.values()];
    const done = await pmap(all, ioN, async (r) => (await rt.kv.get(`ingest:done:${r.event_id}`).catch(() => null)) === '1');
    const pending = all.filter((_, i) => !done[i]);
    stats.duplicates += all.length - pending.length;
    if (pending.length === 0) return;
    // THU TU BAT BIEN: (1) chi tieu, (2) ghi su kien, (3) danh dau xong.
    // Chi tieu khu trung theo TUNG event_id o ben tai chinh nen (1) chay lai luon an toan; vi vay "su kien da co trong bang" => "chi tieu da ghi nhan",
    // va ta KHONG loc theo su kien da ton tai truoc khi chi tieu (neu loc, mat dien giua (1) va (2) hoac (2) ghi do se tru kep / mat tien).
    // Gom lo: mot lan chi tieu cho MOI chien dich trong ca lo (nhieu thong diep), mot lan existingIds/append/danh dau cho ca lo.
    const billable = pending.filter((r) => r.valid === 1 && r.revenue_micro_vnd > 0);
    const byCampaign = new Map<string, ImpressionRow[]>();
    for (const r of billable) {
      const l = byCampaign.get(r.campaign_id);
      if (l) l.push(r);
      else byCampaign.set(r.campaign_id, [r]);
    }
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
        events: list.map((r) => ({ id: r.event_id, micro: Number(r.revenue_micro_vnd) })),
      });
      stats.spendCalls++;
    }
    const have = await existingIds(pending.map((r) => r.event_id)); // su kien da ghi o lan truoc (ghi do): khong ghi lai
    const fresh = pending.filter((r) => !have.has(r.event_id));
    stats.duplicates += pending.length - fresh.length;
    if (fresh.length > 0) {
      await sink.append('ad_impression', fresh as unknown as Record<string, unknown>[]); // DbEventStore: UNIQUE + impression_hourly
      stats.appended += fresh.length;
      stats.invalid += fresh.filter((r) => r.valid !== 1).length;
    }
    await pmap(pending, ioN, (r) => rt.kv.set(`ingest:done:${r.event_id}`, '1', ttl).catch(() => undefined));
  }

  async function ingestPops(pops: { source: string; row: IngestMessage['pops'][number] }[]): Promise<void> {
    const won = await claim('ingest:pop:', pops.map((p) => p.row.event_id));
    try {
      const fresh = pops.filter((p) => won.has(p.row.event_id));
      if (fresh.length === 0) return;
      await sink.append('proof_of_play', fresh.map(({ row: p, source }) => ({ event_id: p.event_id, ts: p.ts, screen_id: p.screen_id, creative_id: p.creative_id, duration_ms: p.duration_ms, source: p.source ?? source })));
      stats.pops += fresh.length;
    } catch (e) {
      await release('ingest:pop:', won);
      throw e;
    }
  }

  /** Xu ly mot lo thong diep: gop moi impression / pop roi chay tung tang MOT LAN. Moi buoc idempotent nen ca lo giao lai deu an toan. */
  async function processMessages(msgs: IngestMessage[]): Promise<void> {
    stats.batches++;
    try {
      const imps: ImpressionRow[] = [];
      const pops: { source: string; row: IngestMessage['pops'][number] }[] = [];
      for (const m of msgs) {
        if (m.impressions?.length) imps.push(...m.impressions);
        if (m.pops?.length) for (const row of m.pops) pops.push({ source: m.device_id, row });
      }
      if (imps.length) await ingestImpressions(imps);
      if (pops.length) await ingestPops(pops);
    } catch (e) {
      stats.errors++;
      throw e; // moi buoc tren idempotent
    }
  }

  // ---- gom lo + thu lai co gioi han + dead-letter
  interface Entry {
    msg: IngestMessage;
    resolve(): void;
    reject(e: unknown): void;
  }
  const buf: Entry[] = [];
  let running = false;
  let scheduled = false;

  async function fingerprint(msg: IngestMessage): Promise<string> {
    return (await sha256Hex(JSON.stringify(msg))).slice(0, 32);
  }
  /** That bai: dem so lan cua CHINH thong diep nay (kv); du maxAttempts -> dead-letter + ack, nguoc lai nem loi de queue giao lai. */
  async function fail(e: Entry, err: unknown): Promise<void> {
    try {
      const key = `ingest:try:${await fingerprint(e.msg)}`;
      const n = await rt.kv.incr(key, ATTEMPT_TTL);
      if (n >= maxAttempts) {
        await rt.queue.send(DEAD_LETTER_TOPIC, { msg: e.msg, error: String((err as Error)?.message ?? err), attempts: n, at: rt.clock.now().toISOString() });
        await rt.kv.del(key).catch(() => undefined);
        stats.deadLettered++;
        opts.log?.(`ingest: thong diep doc sau ${n} lan loi, chuyen dead-letter (${DEAD_LETTER_TOPIC}): ${String((err as Error)?.message ?? err)}`);
        e.resolve();
        return;
      }
    } catch {
      /* kv/queue hong: khong dead-letter duoc, de queue giao lai */
    }
    e.reject(err);
  }
  async function runGroup(group: Entry[]): Promise<void> {
    try {
      await processMessages(group.map((e) => e.msg));
      for (const e of group) e.resolve();
      return;
    } catch (err) {
      if (group.length === 1) return fail(group[0]!, err);
    }
    // lo that bai: tach ra xu ly rieng de mot thong diep doc khong keo theo ca lo (idempotent nen chay lai an toan)
    for (const e of group) {
      try {
        await processMessages([e.msg]);
        e.resolve();
      } catch (err) {
        await fail(e, err);
      }
    }
  }
  async function pump(): Promise<void> {
    scheduled = false;
    if (running) return;
    running = true;
    try {
      while (buf.length > 0) await runGroup(buf.splice(0, maxBatch));
    } finally {
      running = false;
    }
  }
  /** Thong diep den dong thoi tu nhieu vong nhan se dung chung mot lo; khi dang xu ly, lo ke tiep tu lon dan theo tai (khong cong do tre co dinh). */
  function enqueue(msg: IngestMessage): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      buf.push({ msg, resolve, reject });
      if (!running && !scheduled) {
        scheduled = true;
        setImmediate(() => void pump());
      }
    });
  }

  const consumer: IngestConsumer = {
    stats,
    async handle(msg) {
      stats.messages++;
      if (!msg || msg.v !== 1) return; // phien ban la: bo (khong retry vo han)
      if (!msg.impressions?.length && !msg.pops?.length) return;
      await enqueue(msg);
    },
    async handleRows(table, rows) {
      stats.messages++;
      if (table === 'ad_impression') return ingestImpressions(rows as unknown as ImpressionRow[]);
      await sink.append(table, rows);
    },
    subscribe() {
      const n = Math.max(1, opts.concurrency ?? 1);
      for (let i = 0; i < n; i++) rt.queue.subscribe(INGEST_TOPIC, (m) => consumer.handle(m as IngestMessage));
      // duong CfEventStore: events.<bang>
      rt.queue.subscribe('events.heartbeat', (m) => consumer.handleRows('heartbeat', m as Record<string, unknown>[]));
      rt.queue.subscribe('events.proof_of_play', (m) => consumer.handleRows('proof_of_play', m as Record<string, unknown>[]));
      rt.queue.subscribe('events.ad_impression', (m) => consumer.handleRows('ad_impression', m as Record<string, unknown>[]));
    },
  };
  return consumer;
}
