// Kiem tra URL video "dan link" (stream) CHONG SSRF - thuan tuy, chay duoc tren Workers/Node/trinh duyet (khong dns, khong fetch).
// Dung o API (truoc MOI lan may chu goi ra ngoai, ke ca moi buoc chuyen huong) va o web-admin (kiem tra som cho nguoi dung).
// Quy tac: https, cong 443, khong user:pass, khong IP (ke ca IPv6 / thap phan / hex / bat phan), khong ten may noi bo/metadata, khong dich vu DNS thay the IP.
// Luu y: kiem tra ten mien chi chan duoc cac dang "ro rang"; viec giai ma DNS sang IP rieng tu (DNS rebinding) do lop probe (api/lib/stream-probe.ts) kiem tra bang isBlockedIp.

export const STREAM_KINDS = ['mp4', 'webm', 'hls', 'dash'] as const;
export type StreamKind = (typeof STREAM_KINDS)[number];
export const STREAM_MIME: Record<StreamKind, string> = { mp4: 'video/mp4', webm: 'video/webm', hls: 'application/vnd.apple.mpegurl', dash: 'application/dash+xml' };
export const STREAM_URL_MAX = 2048;

export type StreamUrlCheck = { ok: true; url: URL; host: string; kindHint: StreamKind | null } | { ok: false; code: string; message: string };

const fail = (code: string, message: string): StreamUrlCheck => ({ ok: false, code, message });

/** Trang xem video (khong phai tep/luong truc tiep): TV khong phat duoc bang ExoPlayer. */
const PAGE_HOSTS: [string, string][] = [
  ['youtube.com', 'YouTube'], ['youtu.be', 'YouTube'], ['vimeo.com', 'Vimeo'], ['facebook.com', 'Facebook'], ['fb.watch', 'Facebook'], ['tiktok.com', 'TikTok'],
  ['instagram.com', 'Instagram'], ['twitter.com', 'X'], ['x.com', 'X'], ['dailymotion.com', 'Dailymotion'], ['twitch.tv', 'Twitch'], ['drive.google.com', 'Google Drive'], ['docs.google.com', 'Google Drive'],
];
/** Dich vu DNS ky tu thay the (a-b-c-d.nip.io -> a.b.c.d): dung de vuot kiem tra ten mien tro ve IP noi bo. */
const WILDCARD_DNS = ['nip.io', 'sslip.io', 'xip.io', 'localtest.me', 'lvh.me', 'vcap.me', 'traefik.me', 'lacolhost.com', 'localhost.run', 'ngrok.io', 'ngrok-free.app', '1u.ms', 'local.gd'];
const INTERNAL_SUFFIX = ['.localhost', '.local', '.internal', '.intranet', '.lan', '.home', '.corp', '.private', '.home.arpa', '.localdomain', '.invalid', '.test', '.example', '.onion', '.arpa', '.svc', '.cluster.local'];

const isSuffix = (h: string, d: string): boolean => h === d || h.endsWith(`.${d}`);

export function streamKindFromPath(pathname: string): StreamKind | null {
  const p = pathname.toLowerCase();
  if (/\.(mp4|m4v)$/.test(p)) return 'mp4';
  if (/\.webm$/.test(p)) return 'webm';
  if (/\.m3u8?$/.test(p)) return 'hls';
  if (/\.mpd$/.test(p)) return 'dash';
  return null;
}
export function streamKindFromContentType(ct: string | null | undefined): StreamKind | null {
  const t = (ct ?? '').split(';')[0]!.trim().toLowerCase();
  if (t === 'video/mp4' || t === 'video/x-m4v') return 'mp4';
  if (t === 'video/webm') return 'webm';
  if (t === 'application/vnd.apple.mpegurl' || t === 'application/x-mpegurl' || t === 'audio/mpegurl' || t === 'audio/x-mpegurl') return 'hls';
  if (t === 'application/dash+xml') return 'dash';
  return null;
}

/** Hop le de may chu goi ra ngoai? Tra URL chuan hoa (bo #hash) hoac ly do tu choi (tieng Viet, co ma). */
export function validateStreamUrl(raw: string): StreamUrlCheck {
  const s = String(raw ?? '').trim();
  if (!s) return fail('url_required', 'Nhập liên kết video.');
  if (s.length > STREAM_URL_MAX) return fail('url_too_long', `Liên kết quá dài (tối đa ${STREAM_URL_MAX} ký tự).`);
  if (/[\u0000- \u007f]/.test(s)) return fail('url_invalid', 'Liên kết không được chứa khoảng trắng hoặc ký tự điều khiển.');
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return fail('url_invalid', 'Liên kết không hợp lệ. Hãy dán đầy đủ địa chỉ bắt đầu bằng https://');
  }
  if (u.protocol !== 'https:') return fail('url_not_https', 'Chỉ chấp nhận liên kết https:// (không dùng http, ftp, file...).');
  if (u.username || u.password) return fail('url_credentials', 'Liên kết không được chứa tên đăng nhập/mật khẩu (user:pass@).');
  if (u.port && u.port !== '443') return fail('url_port', 'Chỉ chấp nhận cổng 443 (cổng mặc định của https).');
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return fail('url_invalid', 'Liên kết thiếu tên miền.');
  // IPv6 literal / IPv4 (URL da chuan hoa thap phan 2130706433, hex 0x7f.1, bat phan 0177.0.0.1 ve dang a.b.c.d)
  if (host.startsWith('[') || host.includes(':')) return fail('url_ip_literal', 'Không chấp nhận địa chỉ IP (kể cả IPv6). Hãy dùng tên miền công khai.');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || /^[\d.]+$/.test(host) || /^0x[0-9a-f]*$/i.test(host)) return fail('url_ip_literal', 'Không chấp nhận địa chỉ IP. Hãy dùng tên miền công khai.');
  if (!host.includes('.') || host.length > 253) return fail('url_host_internal', 'Không chấp nhận tên máy nội bộ (cần tên miền công khai đầy đủ).');
  const labels = host.split('.');
  if (labels.some((l) => !l || l.length > 63 || !/^[a-z0-9_-]+$/.test(l))) return fail('url_invalid', 'Tên miền trong liên kết không hợp lệ.');
  const tld = labels[labels.length - 1]!;
  if (/^\d+$/.test(tld) || !/[a-z]/.test(tld)) return fail('url_ip_literal', 'Không chấp nhận địa chỉ IP hoặc tên miền cuối là số.');
  if (host === 'localhost' || INTERNAL_SUFFIX.some((x) => host.endsWith(x)) || host === 'metadata' || host.startsWith('metadata.')) return fail('url_host_internal', 'Không chấp nhận địa chỉ nội bộ (localhost, .local, .internal...).');
  if (WILDCARD_DNS.some((d) => isSuffix(host, d))) return fail('url_wildcard_dns', 'Không chấp nhận tên miền dạng nip.io/sslip.io (trỏ về địa chỉ IP). Hãy dùng tên miền của nơi lưu trữ video.');
  // moi nhan ten giong IP noi bo (127-0-0-1.example.com): dau hieu rebinding thu cong
  if (labels.some((l) => /^(127|10|0|169-254|192-168|172-(1[6-9]|2\d|3[01]))-\d{1,3}(-\d{1,3}){1,2}$/.test(l))) return fail('url_host_internal', 'Tên miền chứa địa chỉ IP nội bộ, không chấp nhận.');
  for (const [d, name] of PAGE_HOSTS) {
    if (isSuffix(host, d)) {
      return fail('url_page_not_stream', `Liên kết ${name} là trang xem video, TV không phát trực tiếp được. Hãy dán liên kết tệp video (.mp4/.webm) hoặc luồng HLS (.m3u8)/DASH (.mpd) trên máy chủ/CDN của bạn (xem hướng dẫn "Dán link video").`);
    }
  }
  u.hash = '';
  return { ok: true, url: u, host, kindHint: streamKindFromPath(u.pathname) };
}

// ---------------------------------------------------------------- IP da giai ma (chong DNS rebinding)
const v4 = (s: string): number[] | null => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  return o.every((x) => x >= 0 && x <= 255) ? o : null;
};
function blockedV4(o: number[]): boolean {
  const [a, b, c] = o as [number, number, number, number];
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 || // 0/8, rieng, loopback, multicast + du tru
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local + metadata cloud (169.254.169.254)
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) || (a === 192 && b === 0 && c === 2) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113) || // IETF/TEST-NET
    (a === 198 && (b === 18 || b === 19)) // benchmark
  );
}
function expandV6(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0]!;
  const dot = s.lastIndexOf('.');
  if (dot >= 0) {
    const tailStart = s.lastIndexOf(':') + 1;
    const o = v4(s.slice(tailStart));
    if (!o) return null;
    s = `${s.slice(0, tailStart)}${((o[0]! << 8) | o[1]!).toString(16)}:${((o[2]! << 8) | o[3]!).toString(16)}`;
  }
  const parts = s.split('::');
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(':') : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  const fill = parts.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (parts.length === 1 && head.length !== 8)) return null;
  const all = [...head, ...new Array(fill).fill('0'), ...tail];
  if (all.length !== 8 || all.some((h) => !/^[0-9a-f]{1,4}$/.test(h))) return null;
  return all.map((h) => parseInt(h, 16));
}
/** true = KHONG duoc ket noi (rieng/loopback/link-local/metadata/multicast/khong phan tich duoc). */
export function isBlockedIp(ip: string): boolean {
  const s = ip.trim();
  const a = v4(s);
  if (a) return blockedV4(a);
  const g = expandV6(s);
  if (!g) return true;
  if (g.every((x) => x === 0) || (g.slice(0, 7).every((x) => x === 0) && g[7] === 1)) return true; // :: va ::1
  if ((g[0]! & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  if ((g[0]! & 0xffc0) === 0xfe80 || (g[0]! & 0xffc0) === 0xfec0) return true; // link-local, site-local
  if ((g[0]! & 0xff00) === 0xff00) return true; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // tai lieu
  if (g[0] === 0x0100 && g.slice(1, 4).every((x) => x === 0)) return true; // discard
  const emb = [(g[6]! >> 8) & 255, g[6]! & 255, (g[7]! >> 8) & 255, g[7]! & 255];
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return blockedV4(emb); // ::ffff:a.b.c.d (IPv4-mapped) va ::a.b.c.d
  if (g[0] === 0x0064 && g[1] === 0xff9b) return blockedV4(emb); // NAT64 64:ff9b::/96
  if (g[0] === 0x2002) return blockedV4([(g[1]! >> 8) & 255, g[1]! & 255, (g[2]! >> 8) & 255, g[2]! & 255]); // 6to4
  return false;
}
