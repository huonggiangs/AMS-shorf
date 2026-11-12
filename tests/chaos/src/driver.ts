import { uuidv7 } from '@ams/shared';
import { Dev, impression, type World } from './world.js';
import { sleep } from './faults.js';

export interface Acked {
  byCampaign: Map<string, Set<string>>;
  /** event_id duoc 202 nhung bi danh dau KHONG hop le (flagged) */
  flagged: Set<string>;
  /** event_id -> so lan POST (de thay duoc gui lai that su xay ra) */
  attempts: Map<string, number>;
  rejected: { id: string; reason: string }[];
}
export const newAcked = (): Acked => ({ byCampaign: new Map(), flagged: new Set(), attempts: new Map(), rejected: [] });

/**
 * Thiet bi dung nhu docs/DEVICE-PROTOCOL.md muc 8.3/10: giu su kien, gui lo, khong biet da toi thi GUI LAI NGUYEN LO (nonce moi), den khi nhan 202.
 * Tra ve so lan gui. Nem loi neu het luot (mat kha nang giao = loi song con cua he thong).
 */
export async function pushBatch(w: World, dev: Dev, events: Record<string, unknown>[], acked: Acked, o: { maxAttempts?: number } = {}): Promise<number> {
  const max = o.maxAttempts ?? 60;
  for (let a = 1; a <= max; a++) {
    for (const e of events) acked.attempts.set(e['event_id'] as string, (acked.attempts.get(e['event_id'] as string) ?? 0) + 1);
    let res: Response | undefined;
    try {
      res = await dev.events(events);
    } catch {
      continue; // loi mang: gui lai
    }
    if (res.status === 202) {
      const b = (await res.json()) as { accepted: number; valid: number; flagged: number; rejected: { event_id?: string; reason: string }[] };
      for (const r of b.rejected) acked.rejected.push({ id: String(r.event_id ?? ''), reason: r.reason });
      const bad = new Set(b.rejected.map((r) => r.event_id));
      for (const e of events) {
        const id = e['event_id'] as string;
        if (bad.has(id)) continue;
        const camp = e['campaign_id'] as string;
        if (b.flagged > 0 && b.valid < events.length) acked.flagged.add(id);
        const set = acked.byCampaign.get(camp) ?? new Set<string>();
        if (!(b.flagged > 0 && b.valid < events.length)) set.add(id);
        acked.byCampaign.set(camp, set);
      }
      return a;
    }
    await res.arrayBuffer().catch(() => undefined);
    // 409 replay (mang gui trung), 429, 5xx: thu lai voi nonce moi
    if (res.status === 401 || res.status === 400 || res.status === 422 || res.status === 413) throw new Error(`gateway tu choi lo hop le: HTTP ${res.status}`);
    if (a % 5 === 0) await sleep(1);
  }
  throw new Error('khong giao duoc lo su kien sau ' + max + ' lan thu');
}

/** Tao lo ngau nhien: moi su kien event_id moi. */
export function makeBatch(w: World, rand: () => number, size: number, camps?: number[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < size; i++) {
    const camp = camps ? camps[Math.floor(rand() * camps.length)]! : 0;
    out.push(impression(w, { camp, id: uuidv7(w.rt.clock.now().getTime() - 5000 - Math.floor(rand() * 1000)) }));
  }
  return out;
}

/**
 * Tai hon hop: nhieu thiet bi chay DONG THOI; moi thiet bi gui cac lo moi, thinh thoang gui lai lo cu (khong biet da toi), va gui sai thu tu.
 */
export async function runLoad(w: World, devs: Dev[], acked: Acked, rand: () => number, o: { batchesPerDev?: number; maxBatch?: number; resendProb?: number; camps?: number[] } = {}): Promise<void> {
  await Promise.all(
    devs.map(async (dev) => {
      const sent: Record<string, unknown>[][] = [];
      const n = o.batchesPerDev ?? 8;
      for (let i = 0; i < n; i++) {
        const b = makeBatch(w, rand, 1 + Math.floor(rand() * (o.maxBatch ?? 8)), o.camps);
        sent.push(b);
      }
      // thu tu gui xao tron + gui lai ngau nhien lo cu
      const order = sent.map((_, i) => i).sort(() => rand() - 0.5);
      for (const i of order) {
        await pushBatch(w, dev, sent[i]!, acked);
        if (rand() < (o.resendProb ?? 0.3)) await pushBatch(w, dev, sent[Math.floor(rand() * sent.length)]!.filter(() => true), acked).catch(() => undefined);
        // chong lan: gui lai mot lo ghep tu hai lo
        if (rand() < 0.15 && sent.length > 1) {
          const a = sent[Math.floor(rand() * sent.length)]!;
          const b = sent[Math.floor(rand() * sent.length)]!;
          await pushBatch(w, dev, [...a.slice(0, 3), ...b.slice(0, 3)], acked).catch(() => undefined);
        }
      }
    }),
  );
}
