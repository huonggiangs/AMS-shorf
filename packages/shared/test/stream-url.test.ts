import { describe, expect, it } from 'vitest';
import { isBlockedIp, streamKindFromContentType, streamKindFromPath, validateStreamUrl } from '../src/stream-url.js';

describe('validateStreamUrl (SSRF)', () => {
  it.each([
    'https://cdn.adhost.vn/a.mp4', 'https://x.r2.dev/a.webm', 'https://stream.cloudflarestream.com/abc/manifest/video.m3u8', 'https://cdn.adhost.vn/v.mpd', 'https://cdn.adhost.vn:443/a.mp4',
  ])('nhan %s', (u) => {
    expect(validateStreamUrl(u).ok).toBe(true);
  });
  it.each([
    ['http://a.vn/x.mp4', 'url_not_https'], ['ftp://a.vn/x.mp4', 'url_not_https'], ['https://u:p@a.vn/x.mp4', 'url_credentials'], ['https://a.vn:8443/x.mp4', 'url_port'],
    ['https://[::1]/x', 'url_ip_literal'], ['https://[fd00::1]/x', 'url_ip_literal'], ['https://127.0.0.1/x', 'url_ip_literal'], ['https://2130706433/x', 'url_ip_literal'],
    ['https://0x7f000001/x', 'url_ip_literal'], ['https://017700000001/x', 'url_ip_literal'], ['https://10.0.0.1/x', 'url_ip_literal'],
    ['https://localhost/x', 'url_host_internal'], ['https://a.internal/x', 'url_host_internal'], ['https://printer/x', 'url_host_internal'],
    ['https://1.2.3.4.nip.io/x', 'url_wildcard_dns'], ['https://www.youtube.com/watch?v=1', 'url_page_not_stream'], ['https://vimeo.com/1', 'url_page_not_stream'],
  ])('tu choi %s', (u, code) => {
    const r = validateStreamUrl(u);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(code);
  });
  it('bo #hash, nhan dang loai', () => {
    const r = validateStreamUrl('https://a.vn/x.M3U8#frag');
    expect(r.ok && r.url.hash).toBe('');
    expect(r.ok && r.kindHint).toBe('hls');
    expect(streamKindFromPath('/a.mpd')).toBe('dash');
    expect(streamKindFromContentType('application/x-mpegURL; charset=utf-8')).toBe('hls');
    expect(streamKindFromContentType('text/html')).toBeNull();
  });
});

describe('isBlockedIp', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::', '::1', 'fe80::1', 'fc00::1', 'fd12::1', '::ffff:127.0.0.1', '::ffff:a00:1', '64:ff9b::7f00:1', 'garbage'])('chan %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });
  it.each(['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])('cho %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(false);
  });
});
