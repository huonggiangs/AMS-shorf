// Tai len / tai xuong tep qua API khi OBJECT_STORE=fs (Docker local khong co S3). URL do FsObjectStore ky HMAC sau khi
// POST /admin|portal/v1/media/upload-url da xac thuc + kiem tra loai/kich thuoc/quota => cung kieu "presigned" cua S3/R2.
// Buoc /confirm giu nguyen (head + doc anh + sha256 + gioi han). Khong gan authenticate o day: chu ky la thong tin xac thuc.
import { Hono } from 'hono';
import { ALLOWED_MIME } from '../lib/creative.js';
import type { AppEnv } from '../types.js';
import { HttpError, notFound } from '../lib/errors.js';

interface SignedStore {
  verifySigned(op: 'put' | 'get', key: string, q: URLSearchParams): { ok: boolean; reason?: string; contentType?: string; maxBytes?: number };
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  head(key: string): Promise<{ size: number; contentType: string } | null>;
}
const isSigned = (o: unknown): o is SignedStore => typeof (o as SignedStore)?.verifySigned === 'function';

export const STORAGE_UPLOAD_PATH = '/storage/upload/';

function keyOf(path: string, prefix: string): string {
  try {
    return decodeURIComponent(path.slice(path.indexOf(prefix) + prefix.length));
  } catch {
    throw new HttpError(400, 'bad_key', 'Khóa tệp không hợp lệ.');
  }
}

async function readCapped(body: ReadableStream<Uint8Array> | null, max: number): Promise<Uint8Array> {
  if (!body) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let n = 0;
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > max) {
      await reader.cancel().catch(() => undefined);
      throw new HttpError(413, 'payload_too_large', 'Tệp vượt quá giới hạn đã khai báo.', { limit_bytes: max });
    }
    chunks.push(value);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

export function storageRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.put('/upload/*', async (c) => {
    const rt = c.get('rt');
    if (!isSigned(rt.objects)) throw notFound();
    const key = keyOf(new URL(c.req.url).pathname, STORAGE_UPLOAD_PATH);
    if (!key.startsWith('media/')) throw new HttpError(403, 'forbidden', 'Chỉ được tải lên thư mục media/.');
    const chk = rt.objects.verifySigned('put', key, new URL(c.req.url).searchParams);
    if (!chk.ok) throw new HttpError(403, chk.reason === 'expired' ? 'upload_expired' : 'bad_signature', 'Đường dẫn tải lên không hợp lệ hoặc đã hết hạn. Hãy yêu cầu đường dẫn mới.');
    const ct = (c.req.header('content-type') ?? '').trim();
    if (ct !== chk.contentType) throw new HttpError(422, 'content_type_mismatch', 'Loại tệp gửi lên khác loại đã khai báo.');
    const mime = ct.toLowerCase().split(';')[0]!.trim();
    if (!(ALLOWED_MIME as readonly string[]).includes(mime)) throw new HttpError(422, 'unsupported_type', 'Chỉ nhận MP4, MOV, WebM, PNG hoặc JPG.');
    const hardCap = Math.max(1, Number(rt.config.env['OBJECT_STORE_MAX_UPLOAD_MB'] ?? 600)) * 1024 * 1024;
    const max = chk.maxBytes ? Math.min(chk.maxBytes, hardCap) : hardCap;
    const declared = Number(c.req.header('content-length'));
    if (Number.isFinite(declared) && declared > max) throw new HttpError(413, 'payload_too_large', 'Tệp vượt quá giới hạn đã khai báo.', { limit_bytes: max });
    const body = await readCapped(c.req.raw.body, max);
    await rt.objects.put(key, body, ct);
    return c.body(null, 200);
  });

  r.get('/object/*', async (c) => {
    const rt = c.get('rt');
    if (!isSigned(rt.objects)) throw notFound();
    const key = keyOf(new URL(c.req.url).pathname, '/storage/object/');
    const chk = rt.objects.verifySigned('get', key, new URL(c.req.url).searchParams);
    if (!chk.ok) throw new HttpError(403, 'bad_signature', 'Đường dẫn không hợp lệ hoặc đã hết hạn.');
    const [head, bytes] = [await rt.objects.head(key), await rt.objects.get(key)];
    if (!head || !bytes) throw notFound();
    return c.body(bytes as Uint8Array<ArrayBuffer>, 200, {
      'Content-Type': head.contentType,
      'Content-Length': String(bytes.length),
      'Content-Security-Policy': "sandbox; default-src 'none'", // tep nguoi dung tai len: khong chay script neu mo truc tiep
      'Cache-Control': 'private, max-age=60',
    });
  });

  return r;
}
