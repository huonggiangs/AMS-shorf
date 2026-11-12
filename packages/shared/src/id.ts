import { randomBytes, toHex } from './encoding.js';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

let lastTime = -1;
let lastRand: number[] = [];

/** ULID 26 ky tu, don dieu trong cung mot mili giay. */
export function ulid(now: number = Date.now()): string {
  let rand: number[];
  if (now === lastTime) {
    rand = lastRand.slice();
    let i = 15;
    while (i >= 0) {
      if (rand[i]! < 31) {
        rand[i]!++;
        break;
      }
      rand[i] = 0;
      i--;
    }
  } else {
    const rb = randomBytes(16);
    rand = Array.from(rb, (b) => b & 31);
  }
  lastTime = now;
  lastRand = rand;
  let t = '';
  let n = now;
  for (let i = 0; i < 10; i++) {
    t = CROCKFORD[n % 32]! + t;
    n = Math.floor(n / 32);
  }
  // 16 ky tu ngau nhien (80 bit)
  return t + rand.map((x) => CROCKFORD[x]!).join('');
}

/** Lay thoi gian (ms) tu ULID. */
export function ulidTime(id: string): number {
  let n = 0;
  for (const ch of id.slice(0, 10)) n = n * 32 + CROCKFORD.indexOf(ch);
  return n;
}

/** UUID v7 (RFC 9562): 48 bit thoi gian ms + ngau nhien. */
export function uuidv7(now: number = Date.now()): string {
  const b = randomBytes(16);
  b[0] = (now / 2 ** 40) & 0xff;
  b[1] = (now / 2 ** 32) & 0xff;
  b[2] = (now / 2 ** 24) & 0xff;
  b[3] = (now / 2 ** 16) & 0xff;
  b[4] = (now / 2 ** 8) & 0xff;
  b[5] = now & 0xff;
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = toHex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
