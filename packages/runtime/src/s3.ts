import type { ObjectStore } from './types.js';

export interface S3Config {
  endpoint: string; // dia chi noi bo, vd http://minio:9000
  publicEndpoint?: string; // dia chi trinh duyet truy cap duoc, vd http://localhost:9000 (dung de ky URL)
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** MinIO/S3 qua @aws-sdk/client-s3 (presign bang s3-request-presigner). */
export class S3ObjectStore implements ObjectStore {
  private sdk?: Promise<{
    client: import('@aws-sdk/client-s3').S3Client;
    signer: import('@aws-sdk/client-s3').S3Client;
    s3: typeof import('@aws-sdk/client-s3');
    presign: typeof import('@aws-sdk/s3-request-presigner').getSignedUrl;
  }>;
  constructor(private cfg: S3Config) {}

  private load() {
    this.sdk ??= (async () => {
      const s3 = await import('@aws-sdk/client-s3');
      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
      const base = { region: this.cfg.region, forcePathStyle: true, credentials: { accessKeyId: this.cfg.accessKeyId, secretAccessKey: this.cfg.secretAccessKey } };
      return {
        s3,
        presign: getSignedUrl,
        client: new s3.S3Client({ ...base, endpoint: this.cfg.endpoint }),
        signer: new s3.S3Client({ ...base, endpoint: this.cfg.publicEndpoint ?? this.cfg.endpoint }),
      };
    })();
    return this.sdk;
  }

  async putSigned(key: string, contentType: string, ttlSec: number) {
    const { s3, signer, presign } = await this.load();
    const url = await presign(signer, new s3.PutObjectCommand({ Bucket: this.cfg.bucket, Key: key, ContentType: contentType }), { expiresIn: ttlSec });
    return { url, headers: { 'Content-Type': contentType } };
  }
  async getSigned(key: string, ttlSec: number) {
    const { s3, signer, presign } = await this.load();
    return presign(signer, new s3.GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }), { expiresIn: ttlSec });
  }
  async put(key: string, body: Uint8Array, contentType: string) {
    const { s3, client } = await this.load();
    await client.send(new s3.PutObjectCommand({ Bucket: this.cfg.bucket, Key: key, Body: body, ContentType: contentType }));
  }
  async get(key: string) {
    const { s3, client } = await this.load();
    try {
      const r = await client.send(new s3.GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
      return r.Body ? await r.Body.transformToByteArray() : null;
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }
  async head(key: string) {
    const { s3, client } = await this.load();
    try {
      const r = await client.send(new s3.HeadObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
      return { size: Number(r.ContentLength ?? 0), contentType: r.ContentType ?? 'application/octet-stream' };
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }
}

function isNotFound(e: unknown): boolean {
  const x = e as { name?: string; $metadata?: { httpStatusCode?: number } };
  return x?.name === 'NoSuchKey' || x?.name === 'NotFound' || x?.$metadata?.httpStatusCode === 404;
}
