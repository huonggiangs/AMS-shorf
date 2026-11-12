// Quet ma doc qua clamd (TCP, giao thuc INSTREAM). Adapter + ban gia cho test.
import { connect } from 'node:net';

export type ScanVerdict = { status: 'clean' } | { status: 'infected'; signature: string } | { status: 'unavailable'; reason: string };

export interface Scanner {
  scan(bytes: Uint8Array): Promise<ScanVerdict>;
}

export interface ClamdOptions {
  host: string;
  port: number;
  timeoutMs?: number;
  chunkSize?: number;
}

/** Ket qua 'unavailable' khi khong ket noi/loi/timeout: KHONG BAO GIO duoc coi la 'clean'. */
export class ClamdScanner implements Scanner {
  constructor(private o: ClamdOptions) {}

  scan(bytes: Uint8Array): Promise<ScanVerdict> {
    const { host, port } = this.o;
    const timeoutMs = this.o.timeoutMs ?? 60_000;
    const chunk = this.o.chunkSize ?? 64 * 1024;
    return new Promise((resolve) => {
      let done = false;
      let buf = '';
      const sock = connect({ host, port });
      const fin = (v: ScanVerdict) => {
        if (done) return;
        done = true;
        sock.destroy();
        resolve(v);
      };
      sock.setTimeout(timeoutMs, () => fin({ status: 'unavailable', reason: 'clamd timeout' }));
      sock.on('error', (e) => fin({ status: 'unavailable', reason: `clamd: ${(e as Error).message}` }));
      sock.on('data', (d) => {
        buf += d.toString('utf8');
      });
      sock.on('close', () => {
        const r = buf.replace(/\0/g, '').trim();
        if (/ OK$/.test(r)) return fin({ status: 'clean' });
        const m = r.match(/^stream:\s*(.+?)\s+FOUND$/);
        if (m) return fin({ status: 'infected', signature: m[1]! });
        fin({ status: 'unavailable', reason: r ? `clamd: ${r.slice(0, 200)}` : 'clamd dong ket noi khong tra loi' });
      });
      sock.on('connect', () => {
        sock.write('zINSTREAM\0');
        for (let i = 0; i < bytes.length; i += chunk) {
          const part = bytes.subarray(i, Math.min(i + chunk, bytes.length));
          const len = Buffer.alloc(4);
          len.writeUInt32BE(part.length);
          sock.write(len);
          sock.write(part);
        }
        sock.write(Buffer.alloc(4)); // ket thuc
      });
    });
  }
}

/** Khong cau hinh clamd. */
export class NoScanner implements Scanner {
  async scan(): Promise<ScanVerdict> {
    return { status: 'unavailable', reason: 'clamd chua duoc cau hinh (CLAMD_HOST)' };
  }
}

/** Ban gia cho test: gap chuoi EICAR hoac chuoi `matches` thi 'infected'. */
export class FakeScanner implements Scanner {
  calls = 0;
  constructor(private opts: { matches?: string[]; down?: boolean } = {}) {}
  async scan(bytes: Uint8Array): Promise<ScanVerdict> {
    this.calls++;
    if (this.opts.down) return { status: 'unavailable', reason: 'fake down' };
    const s = Buffer.from(bytes).toString('latin1');
    if (s.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')) return { status: 'infected', signature: 'Eicar-Test-Signature' };
    for (const m of this.opts.matches ?? []) if (s.includes(m)) return { status: 'infected', signature: `Fake.${m}` };
    return { status: 'clean' };
  }
}
