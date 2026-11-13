import type { Runtime } from '@ams/runtime';
import { PRESENCE_TTL_S } from './heartbeat-ttl.js';

export interface PresenceRec {
  ts: number; // epoch giay may chu
  state: number;
  region: string | null;
}

/** Presence suy dien: online neu last_seen < 2,5 x chu ky. Ban Cloudflare dung Durable Object (worker.ts). */
export interface Presence {
  /** Ghi nhan heartbeat, tra ts lan truoc (null = chua thay / het han). */
  touch(deviceId: string, rec: PresenceRec): Promise<{ prevTs: number | null }>;
}

export class KvPresence implements Presence {
  constructor(
    private kv: Runtime['kv'],
    private ttlS = PRESENCE_TTL_S,
  ) {}
  async touch(deviceId: string, rec: PresenceRec): Promise<{ prevTs: number | null }> {
    const k = `presence:${deviceId}`;
    const prev = await this.kv.get(k);
    await this.kv.set(k, JSON.stringify(rec), this.ttlS);
    if (!prev) return { prevTs: null };
    try {
      return { prevTs: (JSON.parse(prev) as PresenceRec).ts };
    } catch {
      return { prevTs: null };
    }
  }
}
