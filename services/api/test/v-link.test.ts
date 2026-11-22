// v-link: creative "dan link" (stream): SSRF, khong tai video, 8K nhan, rang buoc noi dung + kiem tra lai, cong duyet, portal IDOR.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProbeError, probeStreamUrl, setProbeDeps, type ProbeDeps } from '../src/lib/stream-probe.js';
import { recheckStream, streamRecheckTick } from '../src/lib/video-link.js';
import { login, setup } from './helpers.js';
import type { Env, Session } from './helpers.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const tag = (s: string) => [...s].map((c) => c.charCodeAt(0));
const cat = (...p: (number[] | Uint8Array)[]) => Uint8Array.from(p.flatMap((x) => [...x]));
const box = (type: string, body: number[] | Uint8Array) => cat(be32(8 + body.length), tag(type), body);
/** MP4 faststart (moov ngay sau ftyp) voi kich thuoc/thoi luong tuy y + codec (stsd). */
function mp4(w: number, h: number, durS: number, fcc = 'avc1'): Uint8Array {
  const ts = 1000;
  const stsd = box('stsd', cat([0, 0, 0, 0], be32(1), be32(16), tag(fcc), new Array(8).fill(0)));
  const tkhd = box('tkhd', [0, 0, 0, 7, ...be32(0), ...be32(0), ...be32(1), ...be32(0), ...be32(durS * ts), ...new Array(8).fill(0), ...new Array(8).fill(0), ...new Array(36).fill(0), ...be32(w << 16), ...be32(h << 16)]);
  const mvhd = box('mvhd', [0, 0, 0, 0, ...be32(0), ...be32(0), ...be32(ts), ...be32(durS * ts), ...new Array(80).fill(0)]);
  const moov = box('moov', cat(mvhd, box('trak', cat(tkhd, box('mdia', box('minf', box('stbl', stsd)))))));
  return cat(box('ftyp', [...tag('isom'), 0, 0, 2, 0, ...tag('isom')]), moov, box('mdat', [1, 2, 3, 4]));
}

interface Remote {
  status?: number;
  headStatus?: number;
  headers?: Record<string, string>;
  body?: Uint8Array | string;
  /** tong so byte gia lap khi may chu bo qua Range (de kiem tra tran 64 KB) */
  bigBody?: number;
  redirect?: string;
  throwNetwork?: boolean;
}
const remotes = new Map<string, Remote>();
const log: { method: string; url: string; range: string | null }[] = [];
let bytesPulled = 0;
let resolveMap: Record<string, string[]> = {};
const fakeFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  const method = init?.method ?? 'GET';
  log.push({ method, url, range: (init?.headers as Record<string, string> | undefined)?.['range'] ?? null });
  const r = remotes.get(url);
  if (!r || r.throwNetwork) throw new TypeError('network');
  if (r.redirect) return new Response(null, { status: 302, headers: { location: r.redirect } });
  const h = new Headers(r.headers ?? {});
  if (method === 'HEAD') return new Response(null, { status: r.headStatus ?? r.status ?? 200, headers: h });
  if ((r.status ?? 200) >= 400) return new Response('err', { status: r.status });
  if (r.bigBody) {
    const chunk = new Uint8Array(16 * 1024).fill(7);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(ctrl) {
        if (sent >= r.bigBody!) return ctrl.close();
        bytesPulled += chunk.length;
        sent += chunk.length;
        ctrl.enqueue(chunk);
      },
    });
    return new Response(stream, { status: 200, headers: h });
  }
  const b = typeof r.body === 'string' ? new TextEncoder().encode(r.body) : (r.body ?? new Uint8Array());
  return new Response(b.slice(0, 65536), { status: 206, headers: h });
};
const deps: ProbeDeps = { fetch: fakeFetch, resolve: async (host) => resolveMap[host] ?? ['93.184.216.34'] };
const H = (extra: Record<string, string> = {}) => ({ 'content-type': 'video/mp4', 'content-length': '5000000', etag: '"v1"', 'last-modified': 'Wed, 01 Jan 2025 00:00:00 GMT', ...extra });
const URL1 = 'https://cdn.adhost.vn/ads/spot-8k.mp4';

let env: Env;
let admin: Session;
let lan: Session;
let dang: Session;
let K001: string;

beforeAll(async () => {
  setProbeDeps(deps);
  env = await setup({});
  K001 = env.seed.customers['K001']!;
  admin = await login(env, env.byRole('super_admin'));
  lan = await login(env, 'lan@vinamilk.example');
  dang = await login(env, 'dang@unilever.example');
  for (const c of [K001, env.seed.customers['K008']!]) {
    await env.rt.db.run('DELETE FROM upload_quotas WHERE customer_id = ?', [c]);
    await env.rt.db.run('INSERT INTO upload_quotas (customer_id, max_files_per_day, max_mb_per_file, max_total_gb) VALUES (?, 500, 500, 50)', [c]);
  }
}, 120_000);
afterAll(() => setProbeDeps(null));

let burst = false; // true: khong tien dong ho (de thu gioi han toc do)
const link = (s: Session, body: Record<string, unknown>, prefix = 'admin') => {
  if (!burst) env.rt.clock.advance(61_000);
  return s.json('POST', `/${prefix}/v1/media/link`, body);
};
const sRow = async (id: string) => (await env.rt.db.query<any>('SELECT * FROM creative_stream WHERE creative_id = ?', [id]))[0];
const cRow = async (id: string) => (await env.rt.db.query<any>('SELECT scan_state, review_state, state, source, storage_key, sha256, size_bytes FROM creatives WHERE id = ?', [id]))[0];
async function create(url = URL1, extra: Record<string, unknown> = {}, who: Session = admin) {
  remotes.set(url, { headers: H(), body: mp4(7680, 4320, 15) });
  const r = await link(who, { url, duration_sec: 15, ...(who === admin ? { customer_id: K001 } : {}), ...extra });
  expect(r.status).toBe(201);
  return r.body;
}

describe('POST /admin/v1/media/link: tao creative stream', () => {
  it('video 8K (7680x4320): nhan, khong gioi han do phan giai; may chu chi HEAD + Range <= 64 KB, khong luu tep', async () => {
    log.length = 0;
    remotes.set(URL1, { headers: H(), body: mp4(7680, 4320, 15) });
    const r = await link(admin, { url: URL1, duration_sec: 15, customer_id: K001, name: 'Spot 8K' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ delivery: 'stream', kind: 'stream', mime: 'video/mp4', duration_sec: 15, status: 'pending', scan_state: 'needs_manual_review', width: 7680, height: 4320 });
    expect(r.body.stream).toMatchObject({ stream_kind: 'mp4', stream_host: 'cdn.adhost.vn', declared_duration_s: 15, probe_status: 'ok', etag: '"v1"', content_length: 5000000 });
    expect(r.body.stream.info).toMatchObject({ width: 7680, height: 4320, resolution_label: '8K', codec: 'H.264', duration_s: 15 });
    expect(r.body.blocker).toMatchObject({ code: 'creative_needs_manual_review', action: 'manual_review' });
    expect(log.map((l) => l.method)).toEqual(['HEAD', 'GET']);
    expect(log[1]!.range).toBe('bytes=0-65535');
    const c = await cRow(r.body.id);
    expect(c).toMatchObject({ source: 'url', storage_key: null, sha256: null, size_bytes: null });
    const v = (await env.rt.db.query<any>('SELECT engine, detail FROM creative_validation WHERE creative_id = ?', [r.body.id]))[0];
    expect(v.engine).toBe('remote_stream');
    expect(JSON.parse(v.detail).reasons).toContain('remote_stream_unscanned');
    const a = (await env.rt.db.query<any>("SELECT diff FROM audit_log WHERE action = 'media.link_create' AND object_id = ?", [r.body.id]))[0];
    expect(a.diff).not.toContain('spot-8k'); // audit chi ghi host, khong ghi duong dan/token cua URL
  });

  it('codec AV1/fps bat ky chi la CANH BAO, khong tu choi', async () => {
    const u = 'https://cdn.adhost.vn/ads/av1-4k.mp4';
    remotes.set(u, { headers: H({ 'content-length': '900000000' }), body: mp4(3840, 2160, 15, 'vp08') });
    const r = await link(admin, { url: u, duration_sec: 15, customer_id: K001 });
    expect(r.status).toBe(201);
    expect(r.body.stream.warnings.map((w: any) => w.code)).toContain('codec_unusual');
  });

  it('HLS .m3u8 (master 8K) va DASH .mpd nhan; DASH/HLS khong HTML', async () => {
    const m3u8 = 'https://cdn.adhost.vn/live/master.m3u8';
    remotes.set(m3u8, { headers: H({ 'content-type': 'application/vnd.apple.mpegurl', etag: '"h1"' }), body: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=80000000,RESOLUTION=7680x4320,CODECS="hvc1.2.4.L186.B0,mp4a.40.2",FRAME-RATE=120\nv.m3u8\n' });
    const r = await link(admin, { url: m3u8, duration_sec: 20, customer_id: K001 });
    expect(r.status).toBe(201);
    expect(r.body.stream).toMatchObject({ stream_kind: 'hls' });
    expect(r.body.stream.info).toMatchObject({ width: 7680, height: 4320, fps: 120, resolution_label: '8K' });
    const mpd = 'https://cdn.adhost.vn/vod/manifest.mpd';
    remotes.set(mpd, { headers: H({ 'content-type': 'application/dash+xml' }), body: '<?xml version="1.0"?><MPD mediaPresentationDuration="PT20S"><Representation width="3840" height="2160" codecs="avc1.640033"/></MPD>' });
    expect((await link(admin, { url: mpd, duration_sec: 20, customer_id: K001 })).body.stream.stream_kind).toBe('dash');
    const bad = 'https://cdn.adhost.vn/x/fake.m3u8';
    remotes.set(bad, { headers: H({ 'content-type': 'application/vnd.apple.mpegurl' }), body: '<html>login</html>' });
    const rb = await link(admin, { url: bad, duration_sec: 20, customer_id: K001 });
    expect(rb.status).toBe(422);
    expect(rb.body.error.code).toBe('hls_invalid');
  });

  it('thoi luong bat buoc + theo loai man hinh; thang may can do phan giai dung', async () => {
    remotes.set(URL1, { headers: H(), body: mp4(1920, 1080, 15) });
    expect((await link(admin, { url: URL1, customer_id: K001 })).status).toBe(422);
    const long = await link(admin, { url: URL1, customer_id: K001, duration_sec: 120 });
    expect(long.body.error.code).toBe('duration_out_of_range');
    const el = await link(admin, { url: URL1, customer_id: K001, duration_sec: 15, target_type: 'elevator' });
    expect(el.body.error.code).toBe('dimensions_required');
    const el2 = await link(admin, { url: URL1, customer_id: K001, duration_sec: 15, target_type: 'elevator', width: 1080, height: 1920 });
    expect(el2.status).toBe(201);
    expect(el2.body.target_type).toBe('elevator');
  });

  it('ma gay hieu nham: trang HTML, content-type json, loi 404, khong nhan ra loai', async () => {
    remotes.set('https://cdn.adhost.vn/page.mp4', { headers: H({ 'content-type': 'text/html' }), body: '<html></html>' });
    expect((await link(admin, { url: 'https://cdn.adhost.vn/page.mp4', duration_sec: 15, customer_id: K001 })).body.error.code).toBe('not_video');
    remotes.set('https://cdn.adhost.vn/gone.mp4', { status: 404 });
    const nf = await link(admin, { url: 'https://cdn.adhost.vn/gone.mp4', duration_sec: 15, customer_id: K001 });
    expect(nf.status).toBe(422);
    expect(nf.body.error.code).toBe('stream_http_error');
    remotes.set('https://cdn.adhost.vn/blob', { headers: H({ 'content-type': 'application/octet-stream' }), body: mp4(1920, 1080, 15) });
    expect((await link(admin, { url: 'https://cdn.adhost.vn/blob', duration_sec: 15, customer_id: K001 })).body.error.code).toBe('stream_kind_unknown');
  });
});

describe('SSRF: URL va chuyen huong', () => {
  const bad: [string, string, string][] = [
    ['http', 'http://cdn.adhost.vn/a.mp4', 'url_not_https'],
    ['userinfo', 'https://user:pass@cdn.adhost.vn/a.mp4', 'url_credentials'],
    ['cong khac 443', 'https://cdn.adhost.vn:8443/a.mp4', 'url_port'],
    ['IPv6 loopback', 'https://[::1]/a.mp4', 'url_ip_literal'],
    ['IPv6 mapped', 'https://[::ffff:127.0.0.1]/a.mp4', 'url_ip_literal'],
    ['IPv4', 'https://127.0.0.1/a.mp4', 'url_ip_literal'],
    ['IP cong khai', 'https://93.184.216.34/a.mp4', 'url_ip_literal'],
    ['thap phan', 'https://2130706433/a.mp4', 'url_ip_literal'],
    ['hex', 'https://0x7f000001/a.mp4', 'url_ip_literal'],
    ['bat phan', 'https://0177.0.0.1/a.mp4', 'url_ip_literal'],
    ['metadata IP', 'https://169.254.169.254/latest/meta-data/', 'url_ip_literal'],
    ['metadata host', 'https://metadata.google.internal/a.mp4', 'url_host_internal'],
    ['localhost', 'https://localhost/a.mp4', 'url_host_internal'],
    ['.local', 'https://nas.local/a.mp4', 'url_host_internal'],
    ['ten khong co dau cham', 'https://intranet/a.mp4', 'url_host_internal'],
    ['nip.io (rebinding)', 'https://127.0.0.1.nip.io/a.mp4', 'url_wildcard_dns'],
    ['sslip.io', 'https://a-169-254-169-254.sslip.io/a.mp4', 'url_wildcard_dns'],
    ['nhan ten la IP noi bo', 'https://10-0-0-5.cdn.adhost.vn/a.mp4', 'url_host_internal'],
    ['file://', 'file:///etc/passwd', 'url_not_https'],
    ['YouTube', 'https://www.youtube.com/watch?v=abc', 'url_page_not_stream'],
    ['youtu.be', 'https://youtu.be/abc', 'url_page_not_stream'],
    ['Vimeo', 'https://vimeo.com/123', 'url_page_not_stream'],
    ['Google Drive', 'https://drive.google.com/file/d/1/view', 'url_page_not_stream'],
  ];
  it.each(bad)('tu choi: %s', async (_n, url, code) => {
    log.length = 0;
    const r = await link(admin, { url, duration_sec: 15, customer_id: K001 });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe(code);
    expect(log).toHaveLength(0); // khong bao gio goi ra ngoai
  });
  it('YouTube: thong bao tieng Viet co goi y', async () => {
    const r = await link(admin, { url: 'https://youtu.be/abc', duration_sec: 15, customer_id: K001 });
    expect(r.body.error.message).toContain('.mp4');
  });

  it('DNS rebinding: ten mien cong khai nhung giai ma ra IP noi bo bi chan (moi dia chi)', async () => {
    resolveMap = { 'evil.adhost.vn': ['93.184.216.34', '10.0.0.7'] };
    remotes.set('https://evil.adhost.vn/a.mp4', { headers: H(), body: mp4(1920, 1080, 15) });
    log.length = 0;
    const r = await link(admin, { url: 'https://evil.adhost.vn/a.mp4', duration_sec: 15, customer_id: K001 });
    expect(r.body.error.code).toBe('host_resolves_private');
    expect(log).toHaveLength(0);
    for (const ip of ['127.0.0.1', '169.254.169.254', '192.168.1.1', '172.16.0.1', '100.64.0.1', '::1', 'fe80::1', 'fd00::1', '::ffff:10.0.0.1', '::ffff:7f00:1', '0.0.0.0']) {
      resolveMap = { 'evil.adhost.vn': [ip] };
      await expect(probeStreamUrl('https://evil.adhost.vn/a.mp4', { deps })).rejects.toMatchObject({ code: 'host_resolves_private' });
    }
    resolveMap = {};
  });

  it('chuyen huong toi dia chi noi bo bi chan o tung buoc; qua 3 lan bi chan; chuyen huong hop le theo duoc', async () => {
    remotes.set('https://cdn.adhost.vn/r1.mp4', { redirect: 'http://169.254.169.254/latest/meta-data/' });
    const a = await link(admin, { url: 'https://cdn.adhost.vn/r1.mp4', duration_sec: 15, customer_id: K001 });
    expect(a.body.error.code).toBe('redirect_blocked');
    remotes.set('https://cdn.adhost.vn/r2.mp4', { redirect: '//localhost/x.mp4' });
    expect((await link(admin, { url: 'https://cdn.adhost.vn/r2.mp4', duration_sec: 15, customer_id: K001 })).body.error.code).toBe('redirect_blocked');
    remotes.set('https://cdn.adhost.vn/r3.mp4', { redirect: 'https://user:p@cdn.adhost.vn/x.mp4' });
    expect((await link(admin, { url: 'https://cdn.adhost.vn/r3.mp4', duration_sec: 15, customer_id: K001 })).body.error.code).toBe('redirect_blocked');
    for (let i = 0; i < 5; i++) remotes.set(`https://cdn.adhost.vn/loop${i}.mp4`, { redirect: `https://cdn.adhost.vn/loop${i + 1}.mp4` });
    expect((await link(admin, { url: 'https://cdn.adhost.vn/loop0.mp4', duration_sec: 15, customer_id: K001 })).body.error.code).toBe('stream_http_error');
    remotes.set('https://cdn.adhost.vn/hop1.mp4', { redirect: '/hop2.mp4' });
    remotes.set('https://cdn.adhost.vn/hop2.mp4', { headers: H(), body: mp4(3840, 2160, 15) });
    const ok = await link(admin, { url: 'https://cdn.adhost.vn/hop1.mp4', duration_sec: 15, customer_id: K001 });
    expect(ok.status).toBe(201);
  });

  it('may chu bo qua Range va tra tep khong lo: chi doc toi da 64 KB roi huy', async () => {
    const u = 'https://cdn.adhost.vn/huge.mp4';
    remotes.set(u, { headers: H(), body: undefined, bigBody: 500 * 1024 * 1024 });
    bytesPulled = 0;
    await link(admin, { url: u, duration_sec: 15, customer_id: K001 }); // khong phai MP4 that: ket qua khong quan trong
    expect(bytesPulled).toBeLessThanOrEqual(64 * 1024 + 2 * 16 * 1024);
  });

  it('timeout 5 giay: loi mang -> unreachable (422)', async () => {
    remotes.set('https://cdn.adhost.vn/down.mp4', { throwNetwork: true });
    const r = await link(admin, { url: 'https://cdn.adhost.vn/down.mp4', duration_sec: 15, customer_id: K001 });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('stream_unreachable');
  });
});

describe('cong duyet va rang buoc noi dung', () => {
  it('duyet phai xac nhan da xem toan bo; noi dung xa phai con nguyen; duyet ghi nhan binding', async () => {
    const m = await create('https://cdn.adhost.vn/ads/approve.mp4');
    const base = `/admin/v1/media/${m.id}`;
    expect((await admin.json('POST', `${base}/approve`, { content_version: m.content_version })).status).toBe(422); // chua kiem tra thu cong
    const noConfirm = await admin.json('POST', `${base}/approve`, { manual_review_note: 'da xem het', content_version: m.content_version });
    expect(noConfirm.status).toBe(422);
    expect(noConfirm.body.error.code).toBe('confirm_full_view_required');
    // noi dung xa doi giua luc xem va luc duyet -> 409, phai xem lai
    remotes.set('https://cdn.adhost.vn/ads/approve.mp4', { headers: H({ etag: '"v2"' }), body: mp4(7680, 4320, 15) });
    const changed = await admin.json('POST', `${base}/approve`, { manual_review_note: 'da xem het', content_version: m.content_version, confirm_full_view: true });
    expect(changed.status).toBe(409);
    expect(changed.body.error.code).toBe('content_changed');
    const m2 = (await admin.json('GET', base)).body;
    expect(m2.content_version).toBeGreaterThan(m.content_version);
    expect(m2.stream.etag).toBe('"v2"');
    expect(m2.preview_url).toBe('https://cdn.adhost.vn/ads/approve.mp4');
    const ok = await admin.json('POST', `${base}/approve`, { manual_review_note: 'da xem het video v2', content_version: m2.content_version, confirm_full_view: true });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('approved');
    const s = await sRow(m.id);
    expect(s).toMatchObject({ needs_review: 0, probe_status: 'ok' });
    expect(s.approved_binding).toBe(s.binding);
    const sec = (await env.rt.db.query<any>('SELECT content_version, approved_version, approved_hash FROM creative_security WHERE creative_id = ?', [m.id]))[0];
    expect(sec.approved_version).toBe(sec.content_version);
    expect(sec.approved_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('thay doi ETag/do dai/Last-Modified/URL loi sau khi duyet => huy duyet, cho kiem tra thu cong, bi loai khoi manifest', async () => {
    const u = 'https://cdn.adhost.vn/ads/watch.mp4';
    const m = await create(u);
    await admin.json('POST', `/admin/v1/media/${m.id}/approve`, { manual_review_note: 'da xem het', content_version: m.content_version, confirm_full_view: true });
    expect(await cRow(m.id)).toMatchObject({ review_state: 'approved', scan_state: 'clean', state: 'ready' });
    const v0 = (await env.rt.db.query<any>('SELECT content_version FROM creative_security WHERE creative_id = ?', [m.id]))[0].content_version;

    // khong doi gi: giu nguyen
    expect(await recheckStream(env.rt, m.id, deps)).toBe('unchanged');
    expect(await cRow(m.id)).toMatchObject({ review_state: 'approved' });

    const cases: [string, Remote][] = [
      ['etag', { headers: H({ etag: '"other"' }), body: mp4(7680, 4320, 15) }],
      ['length', { headers: H({ 'content-length': '123' }), body: mp4(7680, 4320, 15) }],
      ['last-modified', { headers: H({ 'last-modified': 'Thu, 02 Jan 2025 00:00:00 GMT' }), body: mp4(7680, 4320, 15) }],
    ];
    for (const [what, r] of cases) {
      await env.rt.db.run("UPDATE creatives SET review_state = 'approved', scan_state = 'clean', state = 'ready' WHERE id = ?", [m.id]);
      await env.rt.db.run("UPDATE creative_stream SET needs_review = 0, probe_status = 'ok', binding = (SELECT binding FROM creative_stream WHERE creative_id = ?) WHERE creative_id = ?", [m.id, m.id]);
      // dat lai binding goc bang cach tao lai tu remote goc
      remotes.set(u, { headers: H(), body: mp4(7680, 4320, 15) });
      const s0 = await sRow(m.id);
      await env.rt.db.run('UPDATE creative_stream SET etag = ?, content_length = ?, last_modified = ? WHERE creative_id = ?', ['"v1"', 5000000, 'Wed, 01 Jan 2025 00:00:00 GMT', m.id]);
      void s0;
      remotes.set(u, r);
      // binding luu la cua noi dung goc: tinh lai de test doc lap
      const { streamBinding } = await import('../src/lib/stream-probe.js');
      await env.rt.db.run('UPDATE creative_stream SET binding = ? WHERE creative_id = ?', [await streamBinding(u, { kind: 'mp4', etag: '"v1"', content_length: 5000000, last_modified: 'Wed, 01 Jan 2025 00:00:00 GMT', body_hash: null }), m.id]);
      expect(await recheckStream(env.rt, m.id, deps), what).toBe('flagged');
      expect(await cRow(m.id), what).toMatchObject({ review_state: 'pending', scan_state: 'needs_manual_review' });
      expect(await sRow(m.id), what).toMatchObject({ probe_status: 'changed', needs_review: 1 });
    }
    const v1 = (await env.rt.db.query<any>('SELECT content_version, approved_version FROM creative_security WHERE creative_id = ?', [m.id]))[0];
    expect(v1.content_version).toBeGreaterThan(v0);
    expect(v1.approved_version).not.toBe(v1.content_version); // hieu luc duyet bi huy
    const a = (await env.rt.db.query<any>("SELECT diff FROM audit_log WHERE action = 'media.stream_flagged' AND object_id = ?", [m.id]));
    expect(a.length).toBeGreaterThan(0);
  });

  it('URL loi: 4xx gan co ngay; 5xx/mang can 2 lan lien tiep', async () => {
    const mk = async (u: string) => {
      const m = await create(u);
      await admin.json('POST', `/admin/v1/media/${m.id}/approve`, { manual_review_note: 'da xem het', content_version: m.content_version, confirm_full_view: true });
      return m.id as string;
    };
    const a = await mk('https://cdn.adhost.vn/ads/e404.mp4');
    remotes.set('https://cdn.adhost.vn/ads/e404.mp4', { status: 404 });
    expect(await recheckStream(env.rt, a, deps)).toBe('flagged');
    expect(await sRow(a)).toMatchObject({ probe_status: 'http_error', needs_review: 1 });
    expect(await cRow(a)).toMatchObject({ review_state: 'pending', scan_state: 'needs_manual_review' });

    const b = await mk('https://cdn.adhost.vn/ads/e500.mp4');
    remotes.set('https://cdn.adhost.vn/ads/e500.mp4', { status: 503 });
    expect(await recheckStream(env.rt, b, deps)).toBe('pending_retry');
    expect(await cRow(b)).toMatchObject({ review_state: 'approved' });
    expect(await recheckStream(env.rt, b, deps)).toBe('flagged');
    expect(await sRow(b)).toMatchObject({ needs_review: 1, fail_count: 2 });

    const c = await mk('https://cdn.adhost.vn/ads/enet.mp4');
    remotes.set('https://cdn.adhost.vn/ads/enet.mp4', { throwNetwork: true });
    await recheckStream(env.rt, c, deps);
    expect(await recheckStream(env.rt, c, deps)).toBe('flagged');
    expect(await sRow(c)).toMatchObject({ probe_status: 'unreachable' });
  });

  it('job dinh ky: toi da 1 lan/gio/creative, bo qua creative da gan co', async () => {
    const u = 'https://cdn.adhost.vn/ads/hourly.mp4';
    const m = await create(u);
    await admin.json('POST', `/admin/v1/media/${m.id}/approve`, { manual_review_note: 'da xem het', content_version: m.content_version, confirm_full_view: true });
    log.length = 0;
    await streamRecheckTick(env.rt, { deps });
    expect(log.filter((l) => l.url === u)).toHaveLength(0); // vua kiem tra, chua den gio
    env.rt.clock.advance(61 * 60 * 1000);
    await streamRecheckTick(env.rt, { deps, limit: 200 });
    expect(log.filter((l) => l.url === u && l.method === 'HEAD')).toHaveLength(1);
    await streamRecheckTick(env.rt, { deps, limit: 200 });
    expect(log.filter((l) => l.url === u && l.method === 'HEAD')).toHaveLength(1); // khong lap lai trong cung gio
  });

  it('kiem tra lai thu cong (POST /:id/recheck) nhan noi dung moi de nguoi duyet xem lai', async () => {
    const u = 'https://cdn.adhost.vn/ads/manual.mp4';
    const m = await create(u);
    remotes.set(u, { headers: H({ etag: '"m2"' }), body: mp4(7680, 4320, 15) });
    const r = await admin.json('POST', `/admin/v1/media/${m.id}/recheck`);
    expect(r.status).toBe(200);
    expect(r.body.stream.etag).toBe('"m2"');
    expect(r.body.content_version).toBeGreaterThan(m.content_version);
    expect(r.body.stream.needs_review).toBe(true);
  });
});

describe('portal: IDOR + gioi han toc do', () => {
  it('khach tao link cho CHINH MINH (bo qua customer_id gui len), khach khac khong thay/khong duyet/khong kiem tra lai', async () => {
    const u = 'https://cdn.adhost.vn/ads/portal.mp4';
    remotes.set(u, { headers: H(), body: mp4(1920, 1080, 15) });
    const r = await link(lan, { url: u, duration_sec: 15, customer_id: env.seed.customers['K008'] }, 'portal');
    expect(r.status).toBe(201);
    expect((await env.rt.db.query<any>('SELECT customer_id FROM creatives WHERE id = ?', [r.body.id]))[0].customer_id).toBe(K001);
    expect((await dang.json('GET', `/portal/v1/media/${r.body.id}`)).status).toBe(404);
    expect((await dang.json('POST', `/portal/v1/media/${r.body.id}/recheck`)).status).toBe(404);
    expect((await dang.json('POST', `/portal/v1/media/${r.body.id}/approve`)).status).toBe(404); // cong khach khong co route duyet
    expect((await lan.json('GET', `/portal/v1/media/${r.body.id}`)).status).toBe(200);
    expect((await admin.json('GET', `/admin/v1/media?filter=delivery:stream&page_size=100`)).body.items.some((x: any) => x.id === r.body.id)).toBe(true);
  });

  it('gioi han toc do: qua 12 lan/phut -> 429', async () => {
    const u = 'https://cdn.adhost.vn/ads/rl.mp4';
    remotes.set(u, { headers: H(), body: mp4(1920, 1080, 15) });
    const res: number[] = [];
    burst = true;
    env.rt.clock.advance(61_000);
    for (let i = 0; i < 14; i++) res.push((await link(dang, { url: u, duration_sec: 15 }, 'portal')).status);
    burst = false;
    expect(res.slice(0, 12).every((x) => x === 201)).toBe(true);
    expect(res.slice(12)).toEqual([429, 429]);
  });

  it('nhieu hon han muc ngay -> 429 quota (khong bo qua han muc tai len)', async () => {
    const n = Number((await env.rt.db.query<any>('SELECT COUNT(*) AS n FROM creatives WHERE customer_id = ?', [K001]))[0].n);
    await env.rt.db.run('UPDATE upload_quotas SET max_files_per_day = ? WHERE customer_id = ?', [n, K001]);
    remotes.set(URL1, { headers: H(), body: mp4(1920, 1080, 15) });
    const r = await link(admin, { url: URL1, duration_sec: 15, customer_id: K001 });
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe('quota_files_per_day');
  });
});

describe('ProbeError', () => {
  it('ProbeError la Error co ma', () => {
    const e = new ProbeError('x', 'y');
    expect(e).toBeInstanceOf(Error);
    expect(e.status).toBe('invalid');
  });
});
