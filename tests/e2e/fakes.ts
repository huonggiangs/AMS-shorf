// Dich vu gia cho e2e (khong co Docker/S3 that): S3 path-style toi gian + SMTP thu thu. Chay that qua TCP/HTTP,
// nen S3ObjectStore (presign SigV4 cua aws-sdk) va SmtpMailer (nodemailer) cua createDockerRuntime duoc dung nguyen ban.
import { createServer as createHttp, type Server } from 'node:http';
import { createServer as createTcp, type Server as TcpServer } from 'node:net';
import type { AddressInfo } from 'node:net';

export interface FakeS3 {
  url: string;
  port: number;
  objects: Map<string, { body: Buffer; contentType: string }>;
  puts: number;
  close(): Promise<void>;
}

/** Giai ma `aws-chunked` (SDK moi gui khi co checksum trailer). */
function decodeAwsChunked(buf: Buffer): Buffer {
  const out: Buffer[] = [];
  let i = 0;
  while (i < buf.length) {
    const eol = buf.indexOf('\r\n', i);
    if (eol < 0) break;
    const size = parseInt(buf.subarray(i, eol).toString('latin1').split(';')[0]!, 16);
    if (!Number.isFinite(size) || size === 0) break;
    out.push(buf.subarray(eol + 2, eol + 2 + size));
    i = eol + 2 + size + 2;
  }
  return Buffer.concat(out);
}

export async function startFakeS3(bucket: string): Promise<FakeS3> {
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  const state = { puts: 0 };
  const server: Server = createHttp((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    const parts = decodeURIComponent(u.pathname).split('/').filter(Boolean);
    if (parts[0] !== bucket) {
      res.writeHead(404, { 'content-type': 'application/xml' }).end('<Error><Code>NoSuchBucket</Code></Error>');
      return;
    }
    const key = parts.slice(1).join('/');
    // ghi can chu ky (presigned hoac Authorization); doc khong ky duoc (bucket media cong khai nhu MinIO policy download (che do S3; Docker local dung OBJECT_STORE=fs, xem services/api/test/storage-fs.test.ts))
    const signed = u.searchParams.has('X-Amz-Signature') || !!req.headers['authorization'];
    if (!signed && req.method === 'PUT') {
      res.writeHead(403, { 'content-type': 'application/xml' }).end('<Error><Code>AccessDenied</Code></Error>');
      return;
    }
    if (req.method === 'PUT') {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        let body: Buffer = Buffer.concat(chunks);
        if (String(req.headers['content-encoding'] ?? '').includes('aws-chunked') || req.headers['x-amz-content-sha256']?.toString().startsWith('STREAMING')) body = decodeAwsChunked(body);
        objects.set(key, { body, contentType: String(req.headers['content-type'] ?? 'application/octet-stream') });
        state.puts++;
        res.writeHead(200, { etag: '"fake"' }).end();
      });
      return;
    }
    const o = objects.get(key);
    if (!o) {
      res.writeHead(404, { 'content-type': 'application/xml' }).end(req.method === 'HEAD' ? undefined : '<Error><Code>NoSuchKey</Code></Error>');
      return;
    }
    const h = { 'content-type': o.contentType, 'content-length': String(o.body.length), etag: '"fake"', 'last-modified': new Date().toUTCString() };
    res.writeHead(200, h);
    res.end(req.method === 'HEAD' ? undefined : o.body);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    objects,
    get puts() {
      return state.puts;
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

export interface Mail {
  from: string;
  to: string[];
  raw: string;
  subject: string;
  text: string;
}
export interface FakeSmtp {
  port: number;
  mails: Mail[];
  close(): Promise<void>;
}

/** SMTP toi gian (HELO/EHLO, MAIL, RCPT, DATA, QUIT) du cho nodemailer. */
export async function startFakeSmtp(): Promise<FakeSmtp> {
  const mails: Mail[] = [];
  const server: TcpServer = createTcp((sock) => {
    let buf = '';
    let inData = false;
    let from = '';
    let to: string[] = [];
    let data = '';
    sock.write('220 fake.smtp ESMTP\r\n');
    sock.on('data', (c) => {
      buf += c.toString('utf8');
      for (;;) {
        if (inData) {
          const end = buf.indexOf('\r\n.\r\n');
          if (end < 0) {
            data += buf;
            buf = '';
            // giu 4 byte cuoi phong dau ket thuc bi cat doi
            if (data.length > 4) {
              buf = data.slice(-4);
              data = data.slice(0, -4);
            }
            return;
          }
          data += buf.slice(0, end);
          buf = buf.slice(end + 5);
          inData = false;
          const raw = data;
          const subj = /^subject:\s*(.*)$/im.exec(raw)?.[1] ?? '';
          mails.push({ from, to, raw, subject: decodeMime(subj), text: decodeBody(raw) });
          data = '';
          sock.write('250 queued\r\n');
          continue;
        }
        const nl = buf.indexOf('\r\n');
        if (nl < 0) return;
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO') sock.write('250-fake.smtp\r\n250 8BITMIME\r\n');
        else if (cmd === 'HELO') sock.write('250 fake.smtp\r\n');
        else if (cmd === 'MAIL') {
          from = /<([^>]*)>/.exec(line)?.[1] ?? '';
          to = [];
          sock.write('250 ok\r\n');
        } else if (cmd === 'RCPT') {
          to.push(/<([^>]*)>/.exec(line)?.[1] ?? '');
          sock.write('250 ok\r\n');
        } else if (cmd === 'DATA') {
          inData = true;
          sock.write('354 go\r\n');
        } else if (cmd === 'QUIT') {
          sock.write('221 bye\r\n');
          sock.end();
        } else sock.write('250 ok\r\n');
      }
    });
    sock.on('error', () => undefined);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  return { port: (server.address() as AddressInfo).port, mails, close: () => new Promise<void>((r) => server.close(() => r())) };
}

function decodeMime(s: string): string {
  return s.replace(/=\?utf-8\?([bq])\?([^?]*)\?=/gi, (_m, enc: string, t: string) => (enc.toLowerCase() === 'b' ? Buffer.from(t, 'base64').toString('utf8') : t.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (_x, h: string) => String.fromCharCode(parseInt(h, 16)))));
}
/** Lay than thu dang van ban (quoted-printable/base64 neu co). Du de tim lien ket kich hoat. */
function decodeBody(raw: string): string {
  const i = raw.indexOf('\r\n\r\n');
  const head = raw.slice(0, i);
  let body = raw.slice(i + 4);
  if (/content-transfer-encoding:\s*quoted-printable/i.test(head) || /content-transfer-encoding:\s*quoted-printable/i.test(body)) {
    body = body.replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
  }
  if (/content-transfer-encoding:\s*base64/i.test(head)) {
    try {
      body = Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8');
    } catch {
      /* giu nguyen */
    }
  }
  return body;
}
