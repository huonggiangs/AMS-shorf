import type { R2Bucket } from '@cloudflare/workers-types';
import { presignS3 } from '../sigv4.js';
import type { ObjectStore } from '../types.js';

export interface R2PresignConfig {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
}

/** R2 qua binding; URL ky bang SigV4 tren endpoint S3 cua R2 (binding khong co presign). */
export class R2ObjectStore implements ObjectStore {
  constructor(private bucket: R2Bucket, private cfg: R2PresignConfig, private clock: { now(): Date } = { now: () => new Date() }) {}
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
  async getSigned(key: string, ttlSec: number) {
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
  async head(key: string) {
    const o = await this.bucket.head(key);
    return o ? { size: o.size, contentType: o.httpMetadata?.contentType ?? 'application/octet-stream' } : null;
  }
}
