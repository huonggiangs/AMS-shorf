// Van ban dinh dang (rich text) cho vung "Van ban"/"Chu chay" cua bo cuc phat song.
// Mo hinh tai lieu gioi han: doan van (p) -> cac "run" (doan chu co kieu). Luu duoi dang tap con HTML da lam sach:
//   <p style="text-align:center;line-height:1.5"><span style="color:#FF0000;font-size:32px"><b><i>chu</i></b></span><br></p>
// Khong dung DOM: chay duoc o may chu (Workers), trinh duyet va test. BAN SAO GIONG HET o apps/web-admin/src/lib/richtext.ts (co test doi chieu).

export const RICH_FONTS = ['Roboto', 'Arial', 'Verdana', 'Tahoma', 'Georgia', 'Times New Roman', 'Courier New', 'sans-serif', 'serif', 'monospace'] as const;
export const RICH_WEIGHTS = [300, 400, 500, 700, 900] as const;
export const RICH_ALIGNS = ['left', 'center', 'right', 'justify'] as const;
export type RichAlign = (typeof RICH_ALIGNS)[number];
export const RICH_LIMITS = { chars: 5000, paras: 100, size: [8, 200], ls: [-5, 40], lh: [0.8, 3], html: 20000 } as const;

export interface RichStyle {
  /** do dam 300|400|500|700|900 (400 = mac dinh, khong luu) */
  w?: number;
  i?: boolean;
  u?: boolean;
  s?: boolean;
  /** #RRGGBB */
  color?: string;
  bg?: string;
  /** co chu theo cung don vi voi `font_size` cua vung (8..200) */
  size?: number;
  fam?: string;
  /** khoang cach chu (px) */
  ls?: number;
}
export interface RichRun extends RichStyle { t: string }
export interface RichPara { align?: RichAlign; lh?: number; runs: RichRun[] }
export type RichDoc = RichPara[];

const STYLE_KEYS = ['w', 'i', 'u', 's', 'color', 'bg', 'size', 'fam', 'ls'] as const;

// ---------- gia tri thuoc tinh ----------
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const round1 = (n: number): number => Math.round(n * 10) / 10;
const hex2 = (n: number): string => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0').toUpperCase();

export function normColor(v: string): string | undefined {
  const s = v.trim();
  let m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) return `#${m[1]!.toUpperCase()}`;
  m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s);
  if (m) return `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`.toUpperCase();
  m = /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/i.exec(s);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    if (a === 0) return undefined; // trong suot = khong co mau
    return `#${hex2(+m[1]!)}${hex2(+m[2]!)}${hex2(+m[3]!)}`;
  }
  return undefined;
}
const normWeight = (v: string): number | undefined => {
  const s = v.trim().toLowerCase();
  if (s === 'normal') return 400;
  if (s === 'bold' || s === 'bolder') return 700;
  if (s === 'lighter') return 300;
  if (!/^\d{3}$/.test(s)) return undefined;
  const n = +s;
  return n <= 350 ? 300 : n <= 450 ? 400 : n <= 550 ? 500 : n <= 750 ? 700 : 900;
};
const normSize = (v: string): number | undefined => {
  const m = /^(\d{1,3}(?:\.\d+)?)px$/i.exec(v.trim());
  return m ? clamp(Math.round(+m[1]!), RICH_LIMITS.size[0], RICH_LIMITS.size[1]) : undefined;
};
const normLs = (v: string): number | undefined => {
  const s = v.trim().toLowerCase();
  if (s === 'normal') return 0;
  const m = /^(-?\d{1,2}(?:\.\d+)?)px$/.exec(s);
  return m ? clamp(round1(+m[1]!), RICH_LIMITS.ls[0], RICH_LIMITS.ls[1]) : undefined;
};
const normLh = (v: string): number | undefined => {
  const m = /^(\d(?:\.\d+)?)$/.exec(v.trim());
  return m ? clamp(round1(+m[1]!), RICH_LIMITS.lh[0], RICH_LIMITS.lh[1]) : undefined;
};
export function normFamily(v: string): string | undefined {
  const first = (v.split(',')[0] ?? '').trim().replace(/^["']|["']$/g, '').trim().toLowerCase();
  return RICH_FONTS.find((f) => f.toLowerCase() === first);
}

/** Phan tich thuoc tinh style="..." thanh kieu run (chi nhan gia tri trong danh sach cho phep) + thuoc tinh doan. */
function parseStyle(style: string): { run: Partial<Record<keyof RichStyle, unknown>>; align?: RichAlign; lh?: number } {
  const run: Partial<Record<keyof RichStyle, unknown>> = {};
  let align: RichAlign | undefined;
  let lh: number | undefined;
  for (const decl of style.split(';')) {
    const k = decl.indexOf(':');
    if (k < 1) continue;
    const prop = decl.slice(0, k).trim().toLowerCase();
    const val = decl.slice(k + 1).trim();
    if (!val || /[\\<>{}]|url\(|expression|@import/i.test(val)) continue;
    if (prop === 'color') { const c = normColor(val); if (c) run.color = c; }
    else if (prop === 'background-color' || prop === 'background') { const c = normColor(val); if (c) run.bg = c; }
    else if (prop === 'font-size') { const n = normSize(val); if (n) run.size = n; }
    else if (prop === 'font-weight') { const n = normWeight(val); if (n) run.w = n; }
    else if (prop === 'font-style') { const v = val.toLowerCase(); if (v === 'italic' || v === 'oblique') run.i = true; else if (v === 'normal') run.i = false; }
    else if (prop === 'text-decoration' || prop === 'text-decoration-line') {
      const v = val.toLowerCase();
      if (v === 'none') { run.u = false; run.s = false; }
      else { if (/\bunderline\b/.test(v)) run.u = true; if (/\bline-through\b/.test(v)) run.s = true; }
    }
    else if (prop === 'font-family') { const f = normFamily(val); if (f) run.fam = f; }
    else if (prop === 'letter-spacing') { const n = normLs(val); if (n !== undefined) run.ls = n; }
    else if (prop === 'text-align') { const v = val.toLowerCase(); const a = v === 'start' ? 'left' : v === 'end' ? 'right' : v; if ((RICH_ALIGNS as readonly string[]).includes(a)) align = a as RichAlign; }
    else if (prop === 'line-height') { const n = normLh(val); if (n) lh = n; }
  }
  return { run, ...(align ? { align } : {}), ...(lh ? { lh } : {}) };
}

// ---------- phan tich HTML (bo tach tu khong dung DOM) ----------
const BLOCKS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'pre', 'tr', 'ul', 'ol', 'table']);
const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'template', 'noscript', 'textarea', 'title', 'head', 'svg', 'math', 'select', 'button']);
const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'wbr']);
const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s: string): string =>
  s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,6});/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n === 160 ? ' ' : n > 31 && n < 0x110000 && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '';
    }
    return ENT[e.toLowerCase()] ?? m;
  });
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

interface Open { tag: string; delta: Partial<Record<keyof RichStyle, unknown>>; block: boolean }
interface Cur extends RichPara { pend: boolean; hadBr: boolean }

export function parseRich(html: string): RichDoc {
  const doc: RichDoc = [];
  const stack: Open[] = [];
  let cur = null as Cur | null;
  let chars = 0;
  let skip = null as string | null;
  const flush = (): void => {
    if (cur) {
      if (doc.length < RICH_LIMITS.paras) doc.push({ ...(cur.align ? { align: cur.align } : {}), ...(cur.lh ? { lh: cur.lh } : {}), runs: cur.runs });
      cur = null;
    }
  };
  const style = (): RichStyle => {
    const st: Partial<Record<keyof RichStyle, unknown>> = {};
    for (const o of stack) Object.assign(st, o.delta);
    return st as RichStyle;
  };
  const para = (): Cur => (cur ??= { runs: [], pend: false, hadBr: false });
  const add = (text: string): void => {
    if (!text || chars >= RICH_LIMITS.chars) return;
    const t = text.slice(0, RICH_LIMITS.chars - chars);
    chars += t.length;
    const p = para();
    const st = style();
    const last = p.runs[p.runs.length - 1];
    if (last && sameStyle(last, st)) last.t += t;
    else p.runs.push({ ...clean(st), t });
  };
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^'">])*)>|([^<]+|<)/g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m[0].startsWith('<!--')) continue;
    if (m[4] !== undefined) {
      if (skip) continue;
      const text = decode(m[4].replace(/[\r\n\t]+/g, ' '));
      if (!text) continue;
      if (!cur && !text.trim()) continue; // khoang trang giua cac khoi
      if (cur?.pend) { add('\n'); cur.pend = false; }
      add(text);
      continue;
    }
    const closing = m[1] === '/';
    const tag = m[2]!.toLowerCase();
    if (skip) { if (closing && tag === skip) skip = null; continue; }
    if (!closing && DROP.has(tag)) { skip = tag; continue; }
    if (closing) {
      let i = stack.length - 1;
      while (i >= 0 && stack[i]!.tag !== tag) i--;
      if (i < 0) continue;
      while (stack.length > i) { const o = stack.pop()!; if (o.block) flush(); }
      continue;
    }
    if (tag === 'br') { const p = para(); if (p.pend) add('\n'); p.pend = true; p.hadBr = true; continue; }
    if (VOID.has(tag)) continue;
    const sm = /\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(m[3] ?? '');
    const ps = parseStyle(decode(sm?.[1] ?? sm?.[2] ?? ''));
    const delta: Partial<Record<keyof RichStyle, unknown>> = stack.length < 40 ? { ...ps.run } : {};
    if (tag === 'b' || tag === 'strong') delta.w = 700;
    else if (tag === 'i' || tag === 'em') delta.i = true;
    else if (tag === 'u' || tag === 'ins') delta.u = true;
    else if (tag === 's' || tag === 'strike' || tag === 'del') delta.s = true;
    const block = BLOCKS.has(tag);
    if (block) {
      if (cur && (cur.runs.length || cur.hadBr)) flush();
      else if (cur) cur = null;
      const c = para();
      if (ps.align) c.align = ps.align;
      if (ps.lh) c.lh = ps.lh;
    }
    if (!/\/\s*$/.test(m[3] ?? '')) stack.push({ tag, delta, block });
  }
  flush();
  return doc.map((p) => ({ ...p, runs: mergeRuns(p.runs) }));
}

function clean(st: RichStyle): RichStyle {
  const o: RichStyle = {};
  if (st.w && st.w !== 400) o.w = st.w;
  if (st.i) o.i = true;
  if (st.u) o.u = true;
  if (st.s) o.s = true;
  if (st.color) o.color = st.color;
  if (st.bg) o.bg = st.bg;
  if (st.size) o.size = st.size;
  if (st.fam) o.fam = st.fam;
  if (st.ls) o.ls = st.ls;
  return o;
}
export function sameStyle(a: RichStyle, b: RichStyle): boolean {
  const x = clean(a);
  const y = clean(b);
  return STYLE_KEYS.every((k) => x[k] === y[k]);
}
export function mergeRuns(runs: RichRun[]): RichRun[] {
  const out: RichRun[] = [];
  for (const r of runs) {
    if (!r.t) continue;
    const last = out[out.length - 1];
    if (last && sameStyle(last, r)) last.t += r.t;
    else out.push({ ...clean(r), t: r.t });
  }
  return out;
}

// ---------- xuat HTML chuan ----------
function runHtml(r: RichRun): string {
  const css: string[] = [];
  if (r.color) css.push(`color:${r.color}`);
  if (r.bg) css.push(`background-color:${r.bg}`);
  if (r.size) css.push(`font-size:${r.size}px`);
  if (r.fam) css.push(`font-family:${r.fam}`);
  if (r.w && r.w !== 400 && r.w !== 700) css.push(`font-weight:${r.w}`);
  if (r.ls) css.push(`letter-spacing:${r.ls}px`);
  let open = css.length ? `<span style="${css.join(';')}">` : '';
  let close = css.length ? '</span>' : '';
  for (const [on, tag] of [[r.w === 700, 'b'], [r.i, 'i'], [r.u, 'u'], [r.s, 's']] as const) {
    if (on) { open += `<${tag}>`; close = `</${tag}>${close}`; }
  }
  return open + r.t.split('\n').map(esc).join('<br>') + close;
}
export function serializeRich(doc: RichDoc): string {
  return doc
    .map((p) => {
      const css: string[] = [];
      if (p.align && p.align !== 'left') css.push(`text-align:${p.align}`);
      if (p.lh) css.push(`line-height:${p.lh}`);
      const runs = mergeRuns(p.runs);
      const body = runs.map(runHtml).join('');
      const text = runs.map((r) => r.t).join('');
      return `<p${css.length ? ` style="${css.join(';')}"` : ''}>${body}${text === '' || text.endsWith('\n') ? '<br>' : ''}</p>`;
    })
    .join('');
}

export const richToPlain = (doc: RichDoc): string => doc.map((p) => p.runs.map((r) => r.t).join('')).join('\n');
/** Chu chay: mot dong duy nhat (gop doan, xuong dong -> dau cach), bo can le/gian dong. */
export function singleLine(doc: RichDoc): RichDoc {
  const runs: RichRun[] = [];
  doc.forEach((p, i) => {
    if (i > 0 && runs.length) runs.push({ t: ' ' });
    for (const r of p.runs) runs.push({ ...r, t: r.t.replace(/\n/g, ' ') });
  });
  const m = mergeRuns(runs);
  return m.length ? [{ runs: m }] : [];
}
export function plainToDoc(text: string): RichDoc {
  return text.replace(/\r\n?/g, '\n').slice(0, RICH_LIMITS.chars).split('\n').slice(0, RICH_LIMITS.paras).map((l) => ({ runs: l ? [{ t: l }] : [] }));
}
export const plainToRich = (text: string): string => serializeRich(plainToDoc(text));

/** Lam sach HTML bat ky -> tap con cho phep. Tra '' neu khong co chu. */
export function sanitizeRich(html: string, opts: { singleLine?: boolean } = {}): string {
  let doc = parseRich(html.slice(0, RICH_LIMITS.html * 4));
  if (opts.singleLine) doc = singleLine(doc);
  if (!richToPlain(doc).trim()) return '';
  return serializeRich(doc);
}
/** Doc (da lam sach) -> van ban thuan cho thiet bi cu (`text`). */
export const richHtmlToPlain = (html: string): string => richToPlain(parseRich(html));
