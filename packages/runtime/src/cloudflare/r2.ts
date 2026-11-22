import type { R2Bucket } from '@cloudflare/workers-types';
import { hmacRaw, toHex, utf8 } from '@ams/shared';
import { presignS3 } from '../sigv4.js';
import type { ObjectStore } from '../types.js';

export interface R2PresignConfig {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  /** Khoa HMAC ky URL xem tep qua Worker (mac dinh SESSION_SECRET). Rong = khong ky duoc. */
  signingSecret?: string;
  /** Tien to URL cong khai cua /storage tren Worker (vd /api/storage). */
  signedBaseUrl?: string;
}

/** R2 qua binding; URL ky bang SigV4 tren endpoint S3 cua R2 (binding khong co presign). */
export class R2ObjectStore implements ObjectStore {
  constructor(private bucket: R2Bucket, private cfg: R2PresignConfig, private clock: { now(): Date } = { now: () => new Date() }) {}
  /** Chi ky URL khi du khoa S3 (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME); thieu mot cai => tep di qua Worker (PUT /media/:id/content). */
  get signedPut(): boolean {
    const c = this.cfg;
    return !!(c.accountId.trim() && c.accessKeyId.trim() && c.secretAccessKey.trim() && c.bucketName.trim());
  }
  /** Ghi thang luong vao binding R2 (khong doc ca tep vao bo nho Worker). R2 can do dai biet truoc: dung FixedLengthStream. */
  async putStream(key: string, body: ReadableStream<Uint8Array>, contentType: string, size: number) {
    const FLS = (globalThis as unknown as { FixedLengthStream?: new (n: number) => TransformStream<Uint8Array, Uint8Array> }).FixedLengthStream;
    let stream: ReadableStream<Uint8Array> = body;
    if (FLS) {
      const fl = new FLS(size);
      void body.pipeTo(fl.writable).catch(() => undefined);
      stream = fl.readable;
    }
    await this.bucket.put(key, stream as never, { httpMetadata: { contentType } });
  }
  /**
   * Multipart qua BINDING (khong can khoa S3, khong CORS): createMultipartUpload / resumeMultipartUpload(key, uploadId) / uploadPart / complete / abort.
   * Phan tai bang luong can do dai biet truoc => FixedLengthStream; phan Uint8Array (nhap tu Drive) gui thang.
   */
  async multipartCreate(key: string, contentType: string) {
    const up = await this.bucket.createMultipartUpload(key, { httpMetadata: { contentType } });
    return { uploadId: up.uploadId };
  }
  async multipartUploadPart(key: string, uploadId: string, n: number, body: Uint8Array | ReadableStream<Uint8Array>, size: number) {
    const up = this.bucket.resumeMultipartUpload(key, uploadId);
    let value: ReadableStream<Uint8Array> | Uint8Array = body;
    if (!(body instanceof Uint8Array)) {
      const FLS = (globalThis as unknown as { FixedLengthStream?: new (n: number) => TransformStream<Uint8Array, Uint8Array> }).FixedLengthStream;
      if (FLS) {
        const fl = new FLS(size);
        void body.pipeTo(fl.writable).catch(() => undefined);
        value = fl.readable;
      }
    } else if (body.length !== size) throw new Error('part_size_mismatch');
    const part = await up.uploadPart(n, value as never);
    return { etag: part.etag };
  }
  async multipartComplete(key: string, uploadId: string, parts: { n: number; etag: string }[]) {
    const up = this.bucket.resumeMultipartUpload(key, uploadId);
    await up.complete([...parts].sort((a, b) => a.n - b.n).map((p) => ({ partNumber: p.n, etag: p.etag })));
  }
  async multipartAbort(key: string, uploadId: string) {
    try {
      await this.bucket.resumeMultipartUpload(key, uploadId).abort();
    } catch {
      /* da het han/da huy: idempotent */
    }
  }
  async delete(key: string) {
    await this.bucket.delete(key);
  }
  private base() {
    return `https://${this.cfg.accountId}.r2.cloudflarestorage.com`;
  }
  async putSigned(key: string, contentType: string, ttlSec: number) {
    const url = await presignS3({
      method: 'PUT', endpoint: this.base(), bucket: this.cfg.bucketName, key, region: 'auto',
      accessKeyId: this.cfg.accessKeyId, secretAccessKey: this.cfg.secretAccessKey, expiresSec: ttlSec,
      headers: { 'content-type': contentType }, now: this.clock.now(),
    });
    return { url, headers: { 'Content-Type': contentType } };
  }
  /**
   * Thieu khoa S3 thi URL presign la URL gia (403) => video/anh xem truoc den. Khi do ky HMAC URL do chinh Worker phuc vu
   * (`GET /storage/object/<key>?exp&sig`, ho tro Range), cung kieu voi adapter fs.
   */
  private async hmacHex(key: string, exp: number): Promise<string> {
    return toHex(await hmacRaw('SHA-256', utf8(this.cfg.signingSecret ?? ''), utf8(`get\n${key}\n${exp}\n\n0`)));
  }
  async getSigned(key: string, ttlSec: number) {
    if (!this.signedPut && this.cfg.signingSecret) {
      const exp = Math.floor(this.clock.now().getTime() / 1000) + ttlSec;
      const base = (this.cfg.signedBaseUrl || '/api/storage').replace(/\/$/, '');
      return `${base}/object/${key.split('/').map(encodeURIComponent).join('/')}?exp=${exp}&sig=${await this.hmacHex(key, exp)}`;
    }
    return presignS3({
      method: 'GET', endpoint: this.base(), bucket: this.cfg.bucketName, key, region: 'auto',
      accessKeyId: this.cfg.accessKeyId, secretAccessKey: this.cfg.secretAccessKey, expiresSec: ttlSec, now: this.clock.now(),
    });
  }
  async put(key: string, body: Uint8Array, contentType: string) {
    await this.bucket.put(key, body, { httpMetadata: { contentType } });
  }
  async get(key: string) {
    const o = await this.bucket.get(key);
    return o ? new Uint8Array(await o.arrayBuffer()) : null;
  }
  /** Kiem tra URL ky do `getSigned` tao khi khong co khoa S3 (chi thao tac 'get'). */
  async verifySigned(op: 'put' | 'get', key: string, q: URLSearchParams): Promise<{ ok: boolean; reason?: string; contentType?: string; maxBytes?: number }> {
    if (op !== 'get' || !this.cfg.signingSecret || this.signedPut) return { ok: false, reason: 'unsupported' };
    const exp = Number(q.get('exp'));
    const sig = q.get('sig') ?? '';
    if (!Number.isFinite(exp) || !sig) return { ok: false, reason: 'missing' };
    if (exp * 1000 < this.clock.now().getTime()) return { ok: false, reason: 'expired' };
    const want = await this.hmacHex(key, exp);
    if (want.length !== sig.length) return { ok: false, reason: 'bad_signature' };
    let diff = 0;
    for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
    return diff === 0 ? { ok: true, contentType: '', maxBytes: 0 } : { ok: false, reason: 'bad_signature' };
  }
  async getRange(key: string, offset: number, length: number) {
    if (length <= 0) return new Uint8Array(0);
    const o = await this.bucket.get(key, { range: { offset, length } });
    return o ? new Uint8Array(await o.arrayBuffer()) : null;
  }
  async head(key: string) {
    const o = await this.bucket.head(key);
    return o ? { size: o.size, contentType: o.httpMetadata?.contentType ?? 'application/octet-stream' } : null;
  }
}
