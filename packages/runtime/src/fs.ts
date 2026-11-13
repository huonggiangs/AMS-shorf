import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { Clock, ObjectStore } from './types.js';

export interface FsObjectStoreConfig {
  /** Thu muc goc (volume dung chung). Tao neu chua co. */
  dir: string;
  /** Tien to URL ky (trinh duyet goi qua web-admin/nginx), vd `/api/storage` hoac `https://api.ams.localhost/storage`. */
  signedBaseUrl?: string;
  /** Khoa HMAC ky URL tai len/tai xuong (mac dinh nen la SESSION_SECRET). */
  signingSecret: string;
  clock?: Clock;
}

const EXT_MIME: Record<string, string> = {
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  json: 'application/json', txt: 'text/plain', pdf: 'application/pdf',
};
const MAX_KEY = 1024;
const META = '.meta'; // sidecar content-type: <dir>/.meta/<key>.json  (khoa khong duoc bat dau bang '.')
const TMP = '.tmp';

/** Ten khoa hop le: phan doan khong rong, khong '.'/'..', khong bat dau bang '.', khong ky tu dieu khien hoac '\\'. */
export function assertSafeKey(key: string): void {
  if (typeof key !== 'string' || key.length === 0 || key.length > MAX_KEY) throw new Error('khoa object khong hop le');
  if (key.startsWith('/') || key.endsWith('/') || key.includes('\\') || /[\u0000-\u001f\u007f]/.test(key)) throw new Error('khoa object khong hop le');
  for (const seg of key.split('/')) if (seg === '' || seg.startsWith('.')) throw new Error('khoa object khong hop le');
}

export type SignedOp = 'put' | 'get';
export interface SignedCheck {
  ok: boolean;
  reason?: 'missing' | 'expired' | 'bad_signature';
  contentType?: string;
  maxBytes?: number;
}

/** Kho tep tren he thong tep (Docker local khong co S3). Ngu nghia put/get/head giong S3ObjectStore. */
export class FsObjectStore implements ObjectStore {
  readonly root: string;
  private rootReal?: Promise<string>;
  private clock: Clock;
  private base: string;
  constructor(private cfg: FsObjectStoreConfig) {
    if (!cfg.dir) throw new Error('OBJECT_STORE_DIR trong');
    if (!cfg.signingSecret) throw new Error('thieu khoa ky cho FsObjectStore');
    this.root = resolve(cfg.dir);
    this.clock = cfg.clock ?? { now: () => new Date() };
    this.base = (cfg.signedBaseUrl ?? '/api/storage').replace(/\/+$/, '');
  }

  private async rootDir(): Promise<string> {
    this.rootReal ??= mkdir(this.root, { recursive: true }).then(() => realpath(this.root));
    return this.rootReal;
  }
  private path(key: string): string {
    assertSafeKey(key);
    const p = resolve(this.root, ...key.split('/'));
    if (!p.startsWith(this.root + sep)) throw new Error('khoa object khong hop le');
    return p;
  }
  private metaPath(key: string): string {
    return resolve(this.root, META, ...key.split('/')) + '.json';
  }
  /** Chong symlink thoat goc: thu muc cha that phai nam trong goc that. */
  private async guardParent(file: string): Promise<void> {
    const rr = await this.rootDir();
    const parent = await realpath(dirname(file));
    if (parent !== rr && !parent.startsWith(rr + sep)) throw new Error('duong dan thoat khoi kho');
  }
  private async writeAtomic(file: string, body: Uint8Array | string): Promise<void> {
    await this.rootDir();
    await mkdir(dirname(file), { recursive: true });
    await this.guardParent(file);
    const tmpDir = join(this.root, TMP);
    await mkdir(tmpDir, { recursive: true });
    const tmp = join(tmpDir, `${process.pid}-${randomBytes(8).toString('hex')}`);
    try {
      await writeFile(tmp, body, { mode: 0o644 });
      await rename(tmp, file);
    } catch (e) {
      await rm(tmp, { force: true });
      throw e;
    }
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    const file = this.path(key);
    const ct = (contentType || '').trim() || 'application/octet-stream';
    await this.writeAtomic(this.metaPath(key), JSON.stringify({ contentType: ct }));
    await this.writeAtomic(file, body); // du lieu ghi sau cung: nguoi doc thay du lieu thi luon co meta
  }

  async get(key: string): Promise<Uint8Array | null> {
    const file = this.path(key);
    try {
      await this.guardParent(file);
      const st = await lstat(file);
      if (!st.isFile()) return null;
      return new Uint8Array(await readFile(file));
    } catch (e) {
      if (isMissing(e)) return null;
      throw e;
    }
  }

  async head(key: string): Promise<{ size: number; contentType: string } | null> {
    const file = this.path(key);
    try {
      await this.guardParent(file);
      const st = await lstat(file);
      if (!st.isFile()) return null;
      return { size: st.size, contentType: await this.contentTypeOf(key) };
    } catch (e) {
      if (isMissing(e)) return null;
      throw e;
    }
  }

  /** Xoa khong loi neu khong ton tai (nhu S3 DeleteObject). */
  async delete(key: string): Promise<void> {
    const file = this.path(key);
    try {
      await this.guardParent(file);
    } catch (e) {
      if (isMissing(e)) return;
      throw e;
    }
    await rm(file, { force: true });
    await rm(this.metaPath(key), { force: true });
  }

  /** Liet ke theo tien to chuoi (nhu S3 ListObjectsV2), sap xep tang dan theo khoa. */
  async list(prefix = '', limit = 1000): Promise<{ key: string; size: number }[]> {
    const out: { key: string; size: number }[] = [];
    const walk = async (dir: string, rel: string): Promise<void> => {
      let ents;
      try {
        ents = await readdir(dir, { withFileTypes: true });
      } catch (e) {
        if (isMissing(e)) return;
        throw e;
      }
      ents.sort((a, b) => (a.name < b.name ? -1 : 1));
      for (const ent of ents) {
        if (ent.name.startsWith('.')) continue;
        const k = rel ? `${rel}/${ent.name}` : ent.name;
        if (ent.isDirectory()) {
          // chi di vao thu muc co the chua khoa khop tien to
          if (k.startsWith(prefix) || prefix.startsWith(`${k}/`)) await walk(join(dir, ent.name), k);
        } else if (ent.isFile() && k.startsWith(prefix)) {
          out.push({ key: k, size: (await stat(join(dir, ent.name))).size });
        }
        if (out.length >= limit) return;
      }
    };
    await this.rootDir();
    await walk(this.root, '');
    return out.slice(0, limit).sort((a, b) => (a.key < b.key ? -1 : 1));
  }

  private async contentTypeOf(key: string): Promise<string> {
    try {
      const j = JSON.parse(await readFile(this.metaPath(key), 'utf8')) as { contentType?: string };
      if (j.contentType) return j.contentType;
    } catch {
      /* khong co sidecar (vd tep chep tay): suy ra tu duoi tep */
    }
    const ext = key.split('.').pop()?.toLowerCase() ?? '';
    return EXT_MIME[ext] ?? 'application/octet-stream';
  }

  // ------------------------------------------------------------------ URL ky (HMAC) cho API /storage/*
  private sign(op: SignedOp, key: string, exp: number, ct: string, max: number): string {
    return createHmac('sha256', this.cfg.signingSecret).update(`${op}\n${key}\n${exp}\n${ct}\n${max}`).digest('hex');
  }
  async putSigned(key: string, contentType: string, ttlSec: number, opts: { maxBytes?: number } = {}) {
    assertSafeKey(key);
    const exp = Math.floor(this.clock.now().getTime() / 1000) + ttlSec;
    const max = opts.maxBytes ?? 0;
    const sig = this.sign('put', key, exp, contentType, max);
    const q = new URLSearchParams({ exp: String(exp), ct: contentType, max: String(max), sig });
    return { url: `${this.base}/upload/${encodeKey(key)}?${q}`, headers: { 'Content-Type': contentType } };
  }
  async getSigned(key: string, ttlSec: number): Promise<string> {
    assertSafeKey(key);
    const exp = Math.floor(this.clock.now().getTime() / 1000) + ttlSec;
    const q = new URLSearchParams({ exp: String(exp), sig: this.sign('get', key, exp, '', 0) });
    return `${this.base}/object/${encodeKey(key)}?${q}`;
  }
  /** Kiem tra tham so URL ky (dung boi API). Khong ghi gi. */
  verifySigned(op: SignedOp, key: string, q: URLSearchParams): SignedCheck {
    const exp = Number(q.get('exp'));
    const sig = q.get('sig') ?? '';
    if (!Number.isFinite(exp) || !sig) return { ok: false, reason: 'missing' };
    if (exp * 1000 < this.clock.now().getTime()) return { ok: false, reason: 'expired' };
    const ct = op === 'put' ? q.get('ct') ?? '' : '';
    const max = op === 'put' ? Number(q.get('max') ?? 0) || 0 : 0;
    const want = Buffer.from(this.sign(op, key, exp, ct, max));
    const got = Buffer.from(sig);
    if (want.length !== got.length || !timingSafeEqual(want, got)) return { ok: false, reason: 'bad_signature' };
    return { ok: true, contentType: ct, maxBytes: max };
  }
}

function encodeKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}
function isMissing(e: unknown): boolean {
  const c = (e as { code?: string })?.code;
  return c === 'ENOENT' || c === 'ENOTDIR' || c === 'EISDIR';
}
