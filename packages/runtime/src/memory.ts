import type { Clock, Kv, Mailer, ObjectStore, Queue } from './types.js';

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** Dong ho dieu khien duoc cho test. */
export class TestClock implements Clock {
  private t: number;
  private frozen: boolean;
  constructor(start?: Date | string | number) {
    this.frozen = start !== undefined;
    this.t = start === undefined ? Date.now() : new Date(start).getTime();
  }
  now(): Date {
    return this.frozen ? new Date(this.t) : new Date();
  }
  set(d: Date | string | number): void {
    this.frozen = true;
    this.t = new Date(d).getTime();
  }
  advance(ms: number): void {
    if (!this.frozen) {
      this.frozen = true;
      this.t = Date.now();
    }
    this.t += ms;
  }
}

export class MemoryKv implements Kv {
  private m = new Map<string, { v: string; exp: number | null }>();
  constructor(private clock: Clock = new SystemClock()) {}
  private live(k: string) {
    const e = this.m.get(k);
    if (!e) return undefined;
    if (e.exp !== null && e.exp <= this.clock.now().getTime()) {
      this.m.delete(k);
      return undefined;
    }
    return e;
  }
  async get(k: string) {
    return this.live(k)?.v ?? null;
  }
  async set(k: string, v: string, ttlSec?: number) {
    this.m.set(k, { v, exp: ttlSec ? this.clock.now().getTime() + ttlSec * 1000 : null });
  }
  async del(k: string) {
    this.m.delete(k);
  }
  async incr(k: string, ttlSec?: number) {
    const e = this.live(k);
    const n = (e ? Number(e.v) : 0) + 1;
    this.m.set(k, { v: String(n), exp: e ? e.exp : ttlSec ? this.clock.now().getTime() + ttlSec * 1000 : null });
    return n;
  }
}

const MAX_ATTEMPTS = 3;

/** Hang doi trong bo nho: giao theo thu tu, thu lai toi da 3 lan roi vao `dead`. `drain()` cho test. */
export class MemoryQueue implements Queue {
  private handlers = new Map<string, ((m: unknown) => Promise<void>)[]>();
  private pending = new Map<string, unknown[]>();
  private inflight = new Set<Promise<void>>();
  readonly dead: { topic: string; msg: unknown; error: unknown }[] = [];
  /** moi tin da gui (de assert trong test) */
  readonly sent: { topic: string; msg: unknown }[] = [];

  async send(topic: string, msg: unknown): Promise<void> {
    this.sent.push({ topic, msg });
    const hs = this.handlers.get(topic);
    if (!hs || hs.length === 0) {
      const p = this.pending.get(topic) ?? [];
      p.push(msg);
      this.pending.set(topic, p);
      return;
    }
    for (const h of hs) this.dispatch(topic, h, msg);
  }

  subscribe(topic: string, handler: (msg: unknown) => Promise<void>): void {
    const hs = this.handlers.get(topic) ?? [];
    hs.push(handler);
    this.handlers.set(topic, hs);
    const p = this.pending.get(topic);
    if (p) {
      this.pending.delete(topic);
      for (const m of p) this.dispatch(topic, handler, m);
    }
  }

  private dispatch(topic: string, h: (m: unknown) => Promise<void>, msg: unknown) {
    const run = async () => {
      let last: unknown;
      for (let a = 0; a < MAX_ATTEMPTS; a++) {
        try {
          await h(structuredClone(msg));
          return;
        } catch (e) {
          last = e;
        }
      }
      this.dead.push({ topic, msg, error: last });
    };
    const p = run().finally(() => this.inflight.delete(p));
    this.inflight.add(p);
  }

  /** Cho den khi moi tin dang xu ly xong (ke ca tin do handler gui them). */
  async drain(): Promise<void> {
    while (this.inflight.size > 0) await Promise.all([...this.inflight]);
  }
}

export class MemoryObjectStore implements ObjectStore {
  private m = new Map<string, { body: Uint8Array; contentType: string }>();
  readonly signed: { op: 'put' | 'get'; key: string; url: string; exp: number }[] = [];
  constructor(private clock: Clock = new SystemClock(), private base = 'http://objects.test') {}
  async putSigned(key: string, contentType: string, ttlSec: number) {
    const exp = this.clock.now().getTime() + ttlSec * 1000;
    const url = `${this.base}/upload/${encodeURI(key)}?exp=${exp}&sig=test`;
    this.signed.push({ op: 'put', key, url, exp });
    return { url, headers: { 'Content-Type': contentType } };
  }
  async getSigned(key: string, ttlSec: number) {
    const exp = this.clock.now().getTime() + ttlSec * 1000;
    const url = `${this.base}/${encodeURI(key)}?exp=${exp}&sig=test`;
    this.signed.push({ op: 'get', key, url, exp });
    return url;
  }
  async put(key: string, body: Uint8Array, contentType: string) {
    this.m.set(key, { body: body.slice(), contentType });
  }
  async get(key: string) {
    return this.m.get(key)?.body.slice() ?? null;
  }
  async head(key: string) {
    const e = this.m.get(key);
    return e ? { size: e.body.length, contentType: e.contentType } : null;
  }
  keys(): string[] {
    return [...this.m.keys()];
  }
}

export interface SentMail {
  to: string;
  subject: string;
  html: string;
  text?: string;
}
export class MemoryMailer implements Mailer {
  readonly outbox: SentMail[] = [];
  async send(m: SentMail) {
    this.outbox.push({ ...m });
  }
}
