const DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
const UNITS = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ', 'triệu tỷ', 'tỷ tỷ'];

function group3(x: number, full: boolean): string {
  const h = Math.floor(x / 100);
  const t = Math.floor((x % 100) / 10);
  const u = x % 10;
  const parts: string[] = [];
  if (h > 0 || full) parts.push(DIGITS[h]!, 'trăm');
  if (t > 1) {
    parts.push(DIGITS[t]!, 'mươi');
    if (u === 1) parts.push('mốt');
    else if (u === 5) parts.push('lăm');
    else if (u > 0) parts.push(DIGITS[u]!);
  } else if (t === 1) {
    parts.push('mười');
    if (u === 5) parts.push('lăm');
    else if (u > 0) parts.push(DIGITS[u]!);
  } else if (u > 0) {
    if (h > 0 || full) parts.push('lẻ');
    parts.push(DIGITS[u]!);
  }
  return parts.join(' ');
}

/** So tien (dong, nguyen) bang chu tieng Viet: 1250000 -> "một triệu hai trăm năm mươi nghìn đồng". */
export function vndToWordsVi(amount: number | bigint, opts: { capitalize?: boolean; suffix?: string } = {}): string {
  let n = typeof amount === 'bigint' ? amount : BigInt(Math.round(amount));
  const suffix = opts.suffix ?? 'đồng';
  if (n === 0n) return cap('không ' + suffix, opts.capitalize);
  let neg = false;
  if (n < 0n) {
    neg = true;
    n = -n;
  }
  const groups: number[] = [];
  while (n > 0n) {
    groups.unshift(Number(n % 1000n));
    n /= 1000n;
  }
  if (groups.length > UNITS.length) throw new Error('so qua lon');
  const out: string[] = [];
  groups.forEach((g, i) => {
    if (g === 0) return;
    const isLeading = out.length === 0;
    const w = group3(g, !isLeading);
    const unit = UNITS[groups.length - 1 - i]!;
    out.push(unit ? `${w} ${unit}` : w);
  });
  const s = (neg ? 'âm ' : '') + out.join(' ') + ' ' + suffix;
  return cap(s, opts.capitalize);
}

function cap(s: string, c?: boolean): string {
  return c ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** 1250000 -> "1.250.000 ₫" */
export function formatVnd(n: number | bigint): string {
  const s = (typeof n === 'bigint' ? n : BigInt(Math.round(n))).toString();
  const neg = s.startsWith('-');
  const digits = neg ? s.slice(1) : s;
  return (neg ? '-' : '') + digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' ₫';
}
