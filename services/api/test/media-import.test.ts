// Nhap tu Google Drive / Dropbox / URL truc tiep tren Worker: fetch gia lap (khong goi mang that).
import { beforeAll, describe, expect, it } from 'vitest';
import { createCfCreativeValidator } from '../src/lib/cf-creative-validate.js';
import { DRIVE_FAIL_MSG, IMPORT_MAX_BYTES, createMediaImporter, parseDriveId, planImport, sniffImportMime } from '../src/lib/media-import.js';
import { runOutbox } from '../src/outbox.js';
import { login, setup } from './helpers.js';
import type { Env, Session } from './helpers.js';
import { bigMp4 } from './mp4-fixture.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const PART = 131072;
const FILE_ID = '1cfoXZesra4gI_XZNDOFXMpYXo2BgFIvF';
const DRIVE_LINK = `https://drive.google.com/file/d/${FILE_ID}/view?usp=sharing`;
let env: Env;
let admin: Session;
let lan: Session;
let dang: Session;
let K001: string;
const rows = (sql: string, p: unknown[] = []) => env.rt.db.query<any>(sql, p);
const finance = async () => ({}) as any;

/** Body luong theo manh `chunk` byte; `failAfter`: nem loi mang sau so byte nay. */
function bodyOf(b: Uint8Array, chunk = 40_000, failAfter?: number): ReadableStream<Uint8Array> {
  let o = 0;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (failAfter !== undefined && o >= failAfter) return c.error(new TypeError('network connection lost'));
      if (o >= b.length) return c.close();
      const n = Math.min(chunk, b.length - o, failAfter !== undefined ? failAfter - o : Infinity);
      c.enqueue(b.slice(o, o + n));
      o += n;
    },
  });
}
const mp4Res = (b: Uint8Array, h: Record<string, string> = {}, failAfter?: number) => new Response(bodyOf(b, 40_000, failAfter), { status: 200, headers: { 'content-type': 'video/mp4', 'content-length': String(b.length), ...h } });

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;
let handler: Handler = () => new Response('khong co', { status: 500 });
const calls: { url: string; range: string | null; cookie: string | null }[] = [];
const fetchMock = async (input: string | URL, init: RequestInit = {}) => {
  const u = new URL(String(input));
  const hd = new Headers(init.headers);
  calls.push({ url: u.toString(), range: hd.get('range'), cookie: hd.get('cookie') });
  return handler(u, init);
};

beforeAll(async () => {
  env = await setup({}, 'postgres', { MEDIA_PART_SIZE_BYTES: String(PART) });
  K001 = env.seed.customers['K001']!;
  admin = await login(env, env.byRole('super_admin'));
  lan = await login(env, 'lan@vinamilk.example');
  dang = await login(env, 'dang@unilever.example');
  (env.rt.objects as any).signedPut = false;
  createCfCreativeValidator(env.rt).subscribe();
  createMediaImporter(env.rt, { fetch: fetchMock as any, finance }).subscribe();
}, 120_000);

let CUST = '';
const importLink = (s: Session, prefix: string, body: Record<string, unknown>) => s.json('POST', `${prefix}/media/import`, { ...(prefix === '/admin/v1' ? { customer_id: CUST || K001 } : {}), ...body });
const settle = async () => {
  for (let i = 0; i < 4; i++) {
    await env.rt.queue.drain();
    await runOutbox(env.rt, finance);
  }
  await env.rt.queue.drain();
};
const get = async (s: Session, prefix: string, id: string) => (await s.json('GET', `${prefix}/media/${id}`)).body;
const store = () => env.rt.objects as any;

describe('phan tich lien ket (don vi)', () => {
  it('ma tep Drive: /file/d/, /open?id=, /uc?id=, usercontent; thu muc va ten mien la bi tu choi', () => {
    expect(parseDriveId(DRIVE_LINK)).toEqual({ id: FILE_ID });
    expect(parseDriveId(`https://drive.google.com/open?id=${FILE_ID}`)).toEqual({ id: FILE_ID });
    expect(parseDriveId(`https://drive.google.com/uc?export=download&id=${FILE_ID}`)).toEqual({ id: FILE_ID });
    expect(parseDriveId(`https://drive.google.com/file/u/0/d/${FILE_ID}/view`)).toEqual({ id: FILE_ID });
    expect(parseDriveId(`https://drive.usercontent.google.com/download?id=${FILE_ID}`)).toEqual({ id: FILE_ID });
    expect(parseDriveId('https://drive.google.com/drive/folders/1abcdefghijklmnop')).toMatchObject({ error: expect.stringMatching(/thư mục/) });
    expect(parseDriveId('https://drive.google.com/file/d/ngan/view')).toMatchObject({ error: expect.any(String) });
    expect(parseDriveId('https://evil.com/file/d/' + FILE_ID)).toMatchObject({ error: expect.any(String) });
  });
  it('planImport: Drive -> drive.usercontent.google.com ... confirm=t; Dropbox -> dl=1; YouTube bao ro; URL truc tiep chi khi duoc phep', () => {
    const d = planImport('drive', DRIVE_LINK, false);
    expect(d.start.toString()).toBe(`https://drive.usercontent.google.com/download?id=${FILE_ID}&export=download&confirm=t`);
    const x = planImport('dropbox', 'https://www.dropbox.com/s/abc/file.mp4?dl=0', false);
    expect(x.start.searchParams.get('dl')).toBe('1');
    expect(() => planImport('youtube', 'https://www.youtube.com/watch?v=abc', true)).toThrow(/Chưa hỗ trợ tải từ YouTube/);
    expect(() => planImport('url', 'https://cdn.example.com/a.mp4', false)).toThrow(/chỉ nhập từ Google Drive/);
    expect(planImport('url', 'https://cdn.example.com/a.mp4', true).start.hostname).toBe('cdn.example.com');
    expect(() => planImport('url', 'https://127.0.0.1/a.mp4', true)).toThrow();
    expect(() => planImport('url', 'http://cdn.example.com/a.mp4', true)).toThrow();
    expect(() => planImport('dropbox', 'https://evil.com/s/a.mp4', true)).toThrow(/dropbox\.com/);
  });
  it('nhan dang noi dung theo byte dau (khong tin Content-Type)', () => {
    expect(sniffImportMime(bigMp4(1080, 1920, 15, 10))).toBe('video/mp4');
    expect(sniffImportMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]))).toBe('image/png');
    expect(sniffImportMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('image/jpeg');
    expect(sniffImportMime(new TextEncoder().encode('<!DOCTYPE html><html>'))).toBeNull();
  });
});

describe('nhap tu Drive (fetch gia lap)', () => {
  it('tep mp4 dung: tai ve R2 theo phan, ten lay tu Content-Disposition, chay luong xac nhan + quet nhu tep tai len, co audit va tien do 100%', async () => {
    const b = bigMp4(1080, 1920, 15, 300_000);
    calls.length = 0;
    handler = (u) => {
      expect(u.hostname).toBe('drive.usercontent.google.com');
      expect(u.searchParams.get('id')).toBe(FILE_ID);
      expect(u.searchParams.get('confirm')).toBe('t');
      return mp4Res(b, { 'content-disposition': `attachment; filename="Quang cao thang may.mp4"; filename*=UTF-8''Quang%20cao%20thang%20may.mp4` });
    };
    const r = await importLink(admin, '/admin/v1', { source: 'drive', url: DRIVE_LINK });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ source: 'gdrive', status: 'processing', kind: 'link', blocker: { code: 'importing', action: 'wait' }, transfer: { kind: 'import' } });
    expect(['queued', 'running']).toContain(r.body.transfer.status);
    await settle();
    const m = await get(admin, '/admin/v1', r.body.id);
    expect(m.transfer, JSON.stringify(m)).toMatchObject({ kind: 'import', status: 'done', bytes_done: b.length, bytes_total: b.length, percent: 100, error_code: null });
    expect(m).toMatchObject({ source: 'upload', kind: 'video', mime: 'video/mp4', size_bytes: b.length, width: 1080, height: 1920, duration_sec: 15, name: 'Quang cao thang may.mp4' });
    expect(m.source_url).toContain(FILE_ID);
    expect(m.status).not.toBe('processing');
    expect(m.scan_state).not.toBe('pending'); // validator Cloudflare da chay (chung luong voi tep tai len)
    const key = (await rows('SELECT storage_key FROM creatives WHERE id = ?', [r.body.id]))[0].storage_key;
    expect(Array.from((await store().get(key))!)).toEqual(Array.from(b));
    expect(store().openMultipart()).toEqual([]);
    const act = (await rows("SELECT action FROM audit_log WHERE object_id = ? ORDER BY ts", [r.body.id])).map((x) => x.action);
    expect(act).toEqual(expect.arrayContaining(['media.import', 'media.import_done', 'media.confirm']));
    expect((await rows("SELECT 1 FROM outbox WHERE dedupe_key = ?", [`media.uploaded:${r.body.id}`])).length).toBe(1);
  });

  it('tep lon: trang xac nhan "khong quet duoc virus" -> gui lai form (uuid + cookie), roi tai duoc', async () => {
    const b = bigMp4(1080, 1920, 15, 200_000);
    calls.length = 0;
    handler = (u) => {
      if (!u.searchParams.has('uuid')) {
        return new Response(`<html><body><form id="download-form" action="https://drive.usercontent.google.com/download" method="get"><input type="hidden" name="id" value="${FILE_ID}"><input type="hidden" name="export" value="download"><input type="hidden" name="confirm" value="t"><input type="hidden" name="uuid" value="abc-123"></form></body></html>`, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'set-cookie': 'NID=xyz; Path=/' } });
      }
      return mp4Res(b);
    };
    const r = await importLink(admin, '/admin/v1', { source: 'drive', url: DRIVE_LINK, name: 'tep lon' });
    await settle();
    expect(calls.length).toBe(2);
    expect(calls[1]!.url).toContain('uuid=abc-123');
    expect(calls[1]!.cookie).toBe('NID=xyz');
    expect((await get(admin, '/admin/v1', r.body.id)).transfer.status).toBe('done');
  });

  it('trang HTML (dang nhap / vuot han muc / khong cong khai): loi tieng Viet, tep bi tu choi, co nut Thu lai; thu lai sau khi chia se cong khai -> thanh cong', async () => {
    handler = () => new Response('<html><title>Sign in</title><body>Please sign in</body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    const r = await importLink(lan, '/portal/v1', { source: 'drive', url: DRIVE_LINK });
    expect(r.status).toBe(201);
    await settle();
    let m = await get(lan, '/portal/v1', r.body.id);
    expect(m.transfer).toMatchObject({ status: 'failed', error_code: 'drive_not_public', error_message: DRIVE_FAIL_MSG });
    expect(m.status).toBe('rejected');
    expect(m.reject_reason).toBe(DRIVE_FAIL_MSG);
    expect(m.blocker).toMatchObject({ code: 'import_failed', action: 'retry' });
    expect(DRIVE_FAIL_MSG).toMatch(/không chia sẻ công khai hoặc vượt hạn mức tải/);
    expect((await rows("SELECT 1 FROM audit_log WHERE object_id = ? AND action = 'media.import_failed'", [r.body.id])).length).toBe(1);
    // nguoi khac (khach khac) khong thu lai duoc; khach tao tep thi duoc
    expect((await dang.json('POST', `/portal/v1/media/${r.body.id}/import/retry`, {})).status).toBe(404);
    expect((await admin.json('POST', `/admin/v1/media/${r.body.id}/import/retry`, {})).status).toBe(200); // noi bo co quyen media:approve
    await settle();
    expect((await get(lan, '/portal/v1', r.body.id)).transfer.status).toBe('failed'); // van HTML
    // chia se cong khai roi thu lai
    const b = bigMp4(1080, 1920, 15, 150_000);
    handler = () => mp4Res(b);
    const again = await lan.json('POST', `/portal/v1/media/${r.body.id}/import/retry`, {});
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(['queued', 'running']).toContain(again.body.transfer.status);
    await settle();
    m = await get(lan, '/portal/v1', r.body.id);
    expect(m.transfer).toMatchObject({ status: 'done', percent: 100 });
    expect(m).toMatchObject({ source: 'upload', size_bytes: b.length, reject_reason: null });
    expect((await lan.json('POST', `/portal/v1/media/${r.body.id}/import/retry`, {})).status).toBe(409); // khong con that bai
  });

  it('HTTP 403/429/404 tu Drive -> thong bao dung; 5xx -> thu lai roi bao loi mang', async () => {
    for (const [status, code] of [[403, 'drive_not_public'], [429, 'drive_not_public'], [404, 'source_not_found']] as const) {
      handler = () => new Response('x', { status });
      const r = await importLink(admin, '/admin/v1', { source: 'drive', url: DRIVE_LINK });
      await settle();
      expect((await get(admin, '/admin/v1', r.body.id)).transfer, String(status)).toMatchObject({ status: 'failed', error_code: code });
    }
    handler = () => new Response('busy', { status: 503 });
    const r = await importLink(admin, '/admin/v1', { source: 'drive', url: DRIVE_LINK });
    await settle();
    let t = (await get(admin, '/admin/v1', r.body.id)).transfer;
    expect(t.status).toBe('queued'); // loi tam thoi: se thu lai
    expect(t.attempts ?? 1).toBeDefined();
    for (let i = 0; i < 3; i++) {
      env.rt.clock.advance(120_000);
      await createMediaImporter(env.rt, { fetch: fetchMock as any, finance }).sweep();
      await settle();
    }
    t = (await get(admin, '/admin/v1', r.body.id)).transfer;
    expect(t).toMatchObject({ status: 'failed', error_code: 'import_network' });
  });

  it('tep vuot 200 MB (Content-Length) bi chan truoc khi tai; tep khong phai mp4/png/jpg bi tu choi (Content-Type noi doi cung khong qua)', async () => {
    handler = () => new Response(new ReadableStream({ start(c) { c.close(); } }), { status: 200, headers: { 'content-type': 'video/mp4', 'content-length': String(IMPORT_MAX_BYTES + 1) } });
    const a = await importLink(admin, '/admin/v1', { source: 'drive', url: DRIVE_LINK });
    await settle();
    expect((await get(admin, '/admin/v1', a.body.id)).transfer).toMatchObject({ status: 'failed', error_code: 'file_too_large' });
    expect((await get(admin, '/admin/v1', a.body.id)).transfer.error_message).toMatch(/200 MB/);
    handler = () => new Response(new TextEncoder().encode('MZ\x90\x00 chuong trinh doc hai, khong phai video'), { status: 200, headers: { 'content-type': 'video/mp4' } });
    const b = await importLink(admin, '/admin/v1', { source: 'drive', url: DRIVE_LINK });
    await settle();
    expect((await get(admin, '/admin/v1', b.body.id)).transfer).toMatchObject({ status: 'failed', error_code: 'not_media' });
    expect(store().openMultipart()).toEqual([]);
  });

  it('chuyen huong: trong allowlist Google duoc theo; ra ngoai allowlist / http / IP noi bo bi chan va KHONG goi toi may do', async () => {
    const b = bigMp4(1080, 1920, 15, 100_000);
    calls.length = 0;
    handler = (u) => (u.hostname === 'drive.usercontent.google.com' ? new Response(null, { status: 303, headers: { location: 'https://doc-0g-ac-docs.googleusercontent.com/docs/securesc/abc?e=download' } }) : mp4Res(b));
    const ok = await importLink(admin, '/admin/v1', { source: 'drive', url: DRIVE_LINK });
    await settle();
    expect((await get(admin, '/admin/v1', ok.body.id)).transfer.status).toBe('done');
    expect(calls.map((c) => new URL(c.url).hostname)).toEqual(['drive.usercontent.google.com', 'doc-0g-ac-docs.googleusercontent.com']);
    for (const loc of ['https://evil.example.com/x.mp4', 'http://drive.google.com/x', 'https://169.254.169.254/latest/meta-data', 'https://localhost/x', 'https://drive.google.com.evil.com/x']) {
      calls.length = 0;
      handler = () => new Response(null, { status: 302, headers: { location: loc } });
      const r = await importLink(admin, '/admin/v1', { source: 'drive', url: DRIVE_LINK });
      await settle();
      const t = (await get(admin, '/admin/v1', r.body.id)).transfer;
      expect(t, loc).toMatchObject({ status: 'failed', error_code: 'redirect_blocked' });
      expect(calls.length, loc).toBe(1); // khong co yeu cau toi dich chuyen huong
    }
    handler = () => new Response(null, { status: 302, headers: { location: DRIVE_LINK } }); // vong lap
    const loop = await importLink(admin, '/admin/v1', { source: 'drive', url: DRIVE_LINK });
    await settle();
    expect((await get(admin, '/admin/v1', loop.body.id)).transfer.error_code).toBe('too_many_redirects');
  });
});

describe('tiep tuc, bao tri, nguon khac', () => {
  beforeAll(() => {
    CUST = env.seed.customers['K002']!; // han muc 20 tep/ngay/khach: dung khach khac cho nhom test nay
  });
  it('mat ket noi giua chung: cac phan da tai duoc giu, lan sau xin Range tu byte da co (206) va ghep dung tep', async () => {
    const b = bigMp4(1080, 1920, 15, 400_000);
    calls.length = 0;
    let first = true;
    handler = (_u, init) => {
      const range = new Headers(init.headers).get('range');
      if (first) {
        first = false;
        return mp4Res(b, {}, PART * 2 + 5000); // dut sau 2 phan day + 5000 byte
      }
      const from = Number(/bytes=(\d+)-/.exec(range ?? '')![1]);
      return new Response(bodyOf(b.slice(from)), { status: 206, headers: { 'content-type': 'video/mp4', 'content-length': String(b.length - from), 'content-range': `bytes ${from}-${b.length - 1}/${b.length}` } });
    };
    const r = await importLink(admin, '/admin/v1', { source: 'drive', url: DRIVE_LINK });
    await settle();
    let t = (await get(admin, '/admin/v1', r.body.id)).transfer;
    expect(t.status).toBe('queued');
    expect(t.parts_done).toBe(2);
    env.rt.clock.advance(120_000);
    await createMediaImporter(env.rt, { fetch: fetchMock as any, finance }).sweep();
    await settle();
    t = (await get(admin, '/admin/v1', r.body.id)).transfer;
    expect(t).toMatchObject({ status: 'done', percent: 100 });
    expect(calls[1]!.range).toBe(`bytes=${PART * 2}-`);
    const key = (await rows('SELECT storage_key FROM creatives WHERE id = ?', [r.body.id]))[0].storage_key;
    expect(Array.from((await store().get(key))!)).toEqual(Array.from(b));
  });

  it('nguon khong ho tro Range (tra 200 day du): bo phien cu, tai lai tu dau, khong ghep sai', async () => {
    const b = bigMp4(1080, 1920, 15, 400_000);
    let n = 0;
    handler = () => (n++ === 0 ? mp4Res(b, {}, PART + 100) : mp4Res(b));
    const r = await importLink(admin, '/admin/v1', { source: 'drive', url: DRIVE_LINK });
    await settle();
    env.rt.clock.advance(120_000);
    await createMediaImporter(env.rt, { fetch: fetchMock as any, finance }).sweep();
    await settle();
    expect((await get(admin, '/admin/v1', r.body.id)).transfer.status).toBe('done');
    const key = (await rows('SELECT storage_key FROM creatives WHERE id = ?', [r.body.id]))[0].storage_key;
    expect(Array.from((await store().get(key))!)).toEqual(Array.from(b));
    expect(store().openMultipart()).toEqual([]);
  });

  it('viec "running" bi ket qua 10 phut duoc dat lai; chay lai tep da xong/da loi la no-op (idempotent)', async () => {
    const importer = createMediaImporter(env.rt, { fetch: fetchMock as any, finance });
    handler = () => mp4Res(bigMp4(1080, 1920, 15, 50_000));
    const r = await importLink(admin, '/admin/v1', { source: 'drive', url: DRIVE_LINK });
    await settle();
    expect(await importer.run(r.body.id)).toBe('skipped'); // da done
    await env.rt.db.run("UPDATE creative_transfers SET status = 'running', updated_at = ? WHERE creative_id = ?", [new Date(env.rt.clock.now().getTime() - 11 * 60_000).toISOString(), r.body.id]);
    expect(await importer.sweep()).toBeGreaterThanOrEqual(1);
    expect((await rows('SELECT status FROM creative_transfers WHERE creative_id = ?', [r.body.id]))[0].status).toBe('queued');
  });

  it('Dropbox (?dl=0 -> dl=1) va URL truc tiep .mp4: tai duoc; YouTube bao chua ho tro; Dropbox sai ten mien bi chan', async () => {
    const b = bigMp4(1080, 1920, 15, 80_000);
    calls.length = 0;
    handler = () => mp4Res(b);
    const d = await importLink(admin, '/admin/v1', { source: 'dropbox', url: 'https://www.dropbox.com/s/abc123/clip.mp4?dl=0' });
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    await settle();
    expect(calls[0]!.url).toBe('https://www.dropbox.com/s/abc123/clip.mp4?dl=1');
    expect((await get(admin, '/admin/v1', d.body.id)).transfer.status).toBe('done');
    const u = await importLink(admin, '/admin/v1', { source: 'url', url: 'https://cdn.example.com/media/qc.mp4' });
    await settle();
    expect(u.body.name).toBe('qc.mp4');
    expect((await get(admin, '/admin/v1', u.body.id)).transfer.status).toBe('done');
    const y = await importLink(admin, '/admin/v1', { source: 'youtube', url: 'https://youtu.be/abc123' });
    expect([y.status, y.body.error.code]).toEqual([422, 'youtube_unsupported']);
    expect((await importLink(admin, '/admin/v1', { source: 'dropbox', url: 'https://evil.com/a.mp4' })).status).toBe(422);
    expect((await importLink(admin, '/admin/v1', { source: 'drive', url: 'https://drive.google.com/drive/folders/1abcdefghijklmnop' })).body.error.message).toMatch(/thư mục/);
  });

  it('quyen: phai co media:write; khach chi nhap vao thu vien cua minh; tep nhap cua khach khong tu duyet; xoa tep dang nhap huy phien', async () => {
    const fin = await login(env, env.byRole('finance'));
    expect((await importLink(fin, '/admin/v1', { source: 'drive', url: DRIVE_LINK })).status).toBe(403);
    expect((await env.app.request('/admin/v1/media/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'drive', url: DRIVE_LINK }) })).status).toBe(401);
    handler = () => mp4Res(bigMp4(1080, 1920, 15, 60_000));
    const r = await importLink(lan, '/portal/v1', { source: 'drive', url: DRIVE_LINK });
    await settle();
    const m = await get(lan, '/portal/v1', r.body.id);
    expect(m.transfer.status).toBe('done');
    expect(m.status).not.toBe('approved'); // khach: van cho duyet
    expect((await dang.json('GET', `/portal/v1/media/${r.body.id}`)).status).toBe(404);
    // xoa khi dang nhap (dang 'queued', chua tai): don dep, khong con dong tien trinh
    handler = () => new Response('x', { status: 500 });
    const q = await lan.json('POST', '/portal/v1/media/import', { source: 'drive', url: DRIVE_LINK });
    expect(q.status).toBe(201);
    const bulk = await admin.json('POST', '/admin/v1/media/bulk-delete', { ids: [q.body.id] });
    expect(bulk.body.deleted_count).toBe(1);
    await settle();
    expect((await rows('SELECT 1 FROM creative_transfers WHERE creative_id = ?', [q.body.id])).length).toBe(0);
  });
});
