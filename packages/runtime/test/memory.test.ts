import { describe, expect, it } from 'vitest';
import { MemoryKv, MemoryMailer, MemoryObjectStore, MemoryQueue, TestClock } from '../src/memory.js';
import { toPgPlaceholders, normalizeParams } from '../src/sql.js';

describe('memory adapters', () => {
  it('kv: ttl theo dong ho, incr giu ttl cua lan dau', async () => {
    const clock = new TestClock('2026-11-12T00:00:00Z');
    const kv = new MemoryKv(clock);
    await kv.set('a', '1', 10);
    expect(await kv.get('a')).toBe('1');
    clock.advance(11_000);
    expect(await kv.get('a')).toBeNull();
    expect(await kv.incr('n', 60)).toBe(1);
    clock.advance(30_000);
    expect(await kv.incr('n', 60)).toBe(2);
    clock.advance(31_000);
    expect(await kv.incr('n', 60)).toBe(1);
    await kv.del('n');
    expect(await kv.get('n')).toBeNull();
  });

  it('queue: giu tin truoc khi co subscriber, thu lai roi vao dead', async () => {
    const q = new MemoryQueue();
    await q.send('t', { n: 1 });
    const got: unknown[] = [];
    q.subscribe('t', async (m) => void got.push(m));
    await q.drain();
    expect(got).toEqual([{ n: 1 }]);
    let tries = 0;
    q.subscribe('bad', async () => {
      tries++;
      throw new Error('x');
    });
    await q.send('bad', { z: 1 });
    await q.drain();
    expect(tries).toBe(3);
    expect(q.dead.length).toBe(1);
  });

  it('objects va mail', async () => {
    const o = new MemoryObjectStore();
    const s = await o.putSigned('a/b.mp4', 'video/mp4', 60);
    expect(s.url).toContain('a/b.mp4');
    expect(s.headers['Content-Type']).toBe('video/mp4');
    expect(await o.head('a/b.mp4')).toBeNull();
    await o.put('a/b.mp4', new Uint8Array([1, 2, 3]), 'video/mp4');
    expect(await o.head('a/b.mp4')).toEqual({ size: 3, contentType: 'video/mp4' });
    expect(await o.get('a/b.mp4')).toEqual(new Uint8Array([1, 2, 3]));
    const m = new MemoryMailer();
    await m.send({ to: 'a@b.c', subject: 's', html: '<p>x</p>' });
    expect(m.outbox).toHaveLength(1);
  });

  it('toPgPlaceholders bo qua ? trong chuoi/chu thich; normalizeParams', () => {
    expect(toPgPlaceholders("SELECT * FROM t WHERE a = ? AND b = 'x?y' AND c = ? -- hoi?\n AND d = \"q?\" AND e = ?")).toBe(
      "SELECT * FROM t WHERE a = $1 AND b = 'x?y' AND c = $2 -- hoi?\n AND d = \"q?\" AND e = $3",
    );
    expect(normalizeParams([undefined, true, false, new Date('2026-01-01T00:00:00Z'), { a: 1 }, 5n])).toEqual([null, 1, 0, '2026-01-01T00:00:00.000Z', '{"a":1}', 5]);
  });
});
