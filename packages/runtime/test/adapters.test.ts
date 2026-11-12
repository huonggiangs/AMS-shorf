import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { presignS3 } from '../src/sigv4.js';
import { S3ObjectStore } from '../src/s3.js';
import { SmtpMailer } from '../src/smtp.js';
import { ClickHouseEventStore } from '../src/clickhouse.js';
import { RedisKv, RedisQueue } from '../src/redis.js';

describe('SigV4 (Workers) khop @aws-sdk', () => {
  it('chu ky GET va PUT giong het SDK voi cung thoi diem', async () => {
    const { S3Client, GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    const cfg = { region: 'auto', forcePathStyle: true, endpoint: 'https://acc.r2.cloudflarestorage.com', credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret/key+x' } };
    const c = new S3Client(cfg);
    const now = new Date('2026-11-12T03:00:00Z');
    const key = 'media/kh 01/video (1).mp4';
    const sdkGet = await getSignedUrl(c, new GetObjectCommand({ Bucket: 'b', Key: key }), { expiresIn: 600, signingDate: now });
    const mineGet = await presignS3({ method: 'GET', endpoint: cfg.endpoint, bucket: 'b', key, region: 'auto', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret/key+x', expiresSec: 600, now, extraQuery: { 'x-amz-checksum-mode': 'ENABLED', 'x-id': 'GetObject' } });
    const sig = (u: string) => new URL(u).searchParams.get('X-Amz-Signature');
    expect(new URL(mineGet).pathname).toBe(new URL(sdkGet).pathname);
    expect(sig(mineGet)).toBe(sig(sdkGet));
    const sdkPut = await getSignedUrl(c, new PutObjectCommand({ Bucket: 'b', Key: key, ContentType: 'video/mp4' }), { expiresIn: 600, signingDate: now, signableHeaders: new Set(['content-type']) });
    const minePut = await presignS3({ method: 'PUT', endpoint: cfg.endpoint, bucket: 'b', key, region: 'auto', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret/key+x', expiresSec: 600, headers: { 'content-type': 'video/mp4' }, now, extraQuery: { 'x-id': 'PutObject', 'x-amz-checksum-crc32': 'AAAAAA==', 'x-amz-sdk-checksum-algorithm': 'CRC32' } });
    expect(new URL(sdkPut).searchParams.get('X-Amz-SignedHeaders')).toBe(new URL(minePut).searchParams.get('X-Amz-SignedHeaders'));
    expect(sig(minePut)).toBe(sig(sdkPut));
  });
});

describe('S3ObjectStore presign (khong can mang)', () => {
  it('URL ky dung host cong khai va header content-type', async () => {
    const s = new S3ObjectStore({ endpoint: 'http://minio:9000', publicEndpoint: 'http://localhost:9000', region: 'us-east-1', bucket: 'ams', accessKeyId: 'a', secretAccessKey: 'b' });
    const put = await s.putSigned('x/y.mp4', 'video/mp4', 300);
    expect(put.url.startsWith('http://localhost:9000/ams/x/y.mp4?')).toBe(true);
    expect(put.url).toContain('X-Amz-Signature=');
    expect(put.headers['Content-Type']).toBe('video/mp4');
    expect(await s.getSigned('x/y.mp4', 60)).toContain('X-Amz-Expires=60');
  });
});

describe('SmtpMailer / ClickHouseEventStore voi ban gia', () => {
  it('smtp goi sendMail dung tham so', async () => {
    const sent: unknown[] = [];
    const m = new SmtpMailer({ host: 'h', port: 1025, from: 'AMS <a@b.c>' }, { sendMail: async (x: unknown) => void sent.push(x) } as never);
    await m.send({ to: 'u@x.vn', subject: 'Moi', html: '<b>hi</b>' });
    expect(sent[0]).toMatchObject({ from: 'AMS <a@b.c>', to: 'u@x.vn', subject: 'Moi' });
  });
  it('clickhouse: JSONEachRow va loi HTTP', async () => {
    const calls: { url: string; body?: string }[] = [];
    const f = (async (url: string, init?: { body?: string }) => {
      calls.push({ url, body: init?.body });
      return url.includes('count') || url.includes('SELECT') ? new Response('7\n') : new Response('boom', { status: 500 });
    }) as unknown as typeof fetch;
    const ch = new ClickHouseEventStore('http://ch:8123', 'ams', f);
    await expect(ch.append('proof_of_play', [{ a: 1 }])).rejects.toThrow(/500/);
    expect(calls[0]!.body).toBe('{"a":1}');
    expect(await ch.countImpressions('42')).toBe(7);
  });
});

const REDIS_BIN = '/usr/bin/redis-server';
describe.skipIf(!existsSync(REDIS_BIN))('Redis that (redis-server tam, cong 16379)', () => {
  let proc: ChildProcess;
  let kv: RedisKv;
  beforeAll(async () => {
    proc = spawn(REDIS_BIN, ['--port', '16379', '--save', '', '--appendonly', 'no'], { stdio: 'ignore' });
    for (let i = 0; i < 50; i++) {
      try {
        kv = await RedisKv.connect('redis://127.0.0.1:16379');
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    throw new Error('redis khong khoi dong');
  });
  afterAll(async () => {
    await kv?.close();
    proc?.kill();
  });

  it('kv: set/get/del/ttl/incr nguyen tu', async () => {
    await kv.set('k', 'v');
    expect(await kv.get('k')).toBe('v');
    await kv.del('k');
    expect(await kv.get('k')).toBeNull();
    await kv.set('t', '1', 1);
    expect(await kv.client.ttl('t')).toBeGreaterThan(0);
    const rs = await Promise.all(Array.from({ length: 50 }, () => kv.incr('ctr', 60)));
    expect([...rs].sort((a, b) => a - b)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(await kv.client.ttl('ctr')).toBeGreaterThan(0);
  });

  it('queue: giao tin, thu lai 3 lan roi vao dead', async () => {
    const q = new RedisQueue(kv.client, 'test:q:');
    const got: unknown[] = [];
    q.subscribe('a', async (m) => void got.push(m));
    let tries = 0;
    q.subscribe('bad', async () => {
      tries++;
      throw new Error('x');
    });
    await q.send('a', { n: 1 });
    await q.send('bad', { z: 1 });
    for (let i = 0; i < 60 && (got.length < 1 || (await q.deadCount('bad')) < 1); i++) await new Promise((r) => setTimeout(r, 100));
    expect(got).toEqual([{ n: 1 }]);
    expect(tries).toBe(3);
    expect(await q.deadCount('bad')).toBe(1);
    await q.close();
  });
});
