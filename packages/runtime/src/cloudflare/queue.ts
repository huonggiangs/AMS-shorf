import type { MessageBatch, Queue as CfQueueBinding } from '@cloudflare/workers-types';
import type { Queue } from '../types.js';

interface Envelope {
  topic: string;
  msg: unknown;
}

/**
 * Cloudflare Queues: mot hang doi vat ly, tin co phong bi {topic,msg}. `subscribe` chi dang ky handler;
 * Worker phai goi `queue.handleBatch(batch)` trong export `queue(batch, env)`.
 */
export class CfQueue implements Queue {
  private handlers = new Map<string, ((m: unknown) => Promise<void>)[]>();
  constructor(private q: CfQueueBinding<Envelope>) {}
  async send(topic: string, msg: unknown): Promise<void> {
    await this.q.send({ topic, msg });
  }
  subscribe(topic: string, handler: (msg: unknown) => Promise<void>): void {
    const l = this.handlers.get(topic) ?? [];
    l.push(handler);
    this.handlers.set(topic, l);
  }
  async handleBatch(batch: MessageBatch<Envelope>): Promise<void> {
    for (const m of batch.messages) {
      const hs = this.handlers.get(m.body.topic) ?? [];
      try {
        for (const h of hs) await h(m.body.msg);
        m.ack();
      } catch {
        m.retry();
      }
    }
  }
}
