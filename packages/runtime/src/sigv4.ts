// AWS SigV4 presign thuan Web Crypto (R2/MinIO/S3), chay duoc tren Workers. Kiem chung bang test so voi @aws-sdk.
import { hmacRaw, sha256Hex, toHex, utf8 } from '@ams/shared';

export interface PresignInput {
  method: 'GET' | 'PUT';
  endpoint: string; // vd https://<account>.r2.cloudflarestorage.com
  bucket: string;
  key: string;
  region: string; // R2: 'auto'
  accessKeyId: string;
  secretAccessKey: string;
  expiresSec: number;
  /** header phai ky (vd content-type cho PUT) - client phai gui dung gia tri nay */
  headers?: Record<string, string>;
  now?: Date;
  pathStyle?: boolean; // mac dinh true: endpoint/bucket/key
}

function enc(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

export async function presignS3(i: PresignInput): Promise<string> {
  const u = new URL(i.endpoint);
  const now = i.now ?? new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const scope = `${date}/${i.region}/s3/aws4_request`;
  const pathStyle = i.pathStyle ?? true;
  const host = pathStyle ? u.host : `${i.bucket}.${u.host}`;
  const keyPath = i.key.split('/').map(enc).join('/');
  const path = pathStyle ? `/${enc(i.bucket)}/${keyPath}` : `/${keyPath}`;
  const hdrs: Record<string, string> = { host };
  for (const [k, v] of Object.entries(i.headers ?? {})) hdrs[k.toLowerCase()] = v.trim();
  const names = Object.keys(hdrs).sort();
  const signedHeaders = names.join(';');
  const q: [string, string][] = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Content-Sha256', 'UNSIGNED-PAYLOAD'],
    ['X-Amz-Credential', `${i.accessKeyId}/${scope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(i.expiresSec)],
    ['X-Amz-SignedHeaders', signedHeaders],
  ];
  q.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const query = q.map(([k, v]) => `${enc(k)}=${enc(v)}`).join('&');
  const canonical = [i.method, path, query, names.map((n) => `${n}:${hdrs[n]}\n`).join(''), signedHeaders, 'UNSIGNED-PAYLOAD'].join('\n');
  const sts = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonical)].join('\n');
  let k = await hmacRaw('SHA-256', utf8('AWS4' + i.secretAccessKey), utf8(date));
  for (const part of [i.region, 's3', 'aws4_request']) k = await hmacRaw('SHA-256', k, utf8(part));
  const sig = toHex(await hmacRaw('SHA-256', k, utf8(sts)));
  return `${u.protocol}//${host}${path}?${query}&X-Amz-Signature=${sig}`;
}
