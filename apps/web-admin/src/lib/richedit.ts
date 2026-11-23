// Thao tac soan thao tren mo hinh RichDoc theo vi tri ky tu tuyen tinh (cac doan noi nhau bang 1 ky tu xuong dong, khop richToPlain).
import { mergeRuns, richToPlain, RICH_LIMITS, type RichAlign, type RichDoc, type RichPara, type RichRun, type RichStyle } from './richtext';

export type Flag = 'i' | 'u' | 's';
const cloneDoc = (d: RichDoc): RichDoc => d.map((p) => ({ ...p, runs: p.runs.map((r) => ({ ...r })) }));
const paraLen = (p: RichPara): number => p.runs.reduce((n, r) => n + r.t.length, 0);
export const docLength = (d: RichDoc): number => richToPlain(d).length;

/** Cac doan [start,end] (vi tri ky tu trong doan) giao voi vung chon [a,b]. */
function eachPara(doc: RichDoc, a: number, b: number, fn: (p: RichPara, from: number, to: number, idx: number) => void): void {
  let pos = 0;
  doc.forEach((p, i) => {
    const len = paraLen(p);
    // doan duoc chon khi vung chon cham vao no (ke ca con tro dat trong doan rong)
    if (b >= pos && a <= pos + len) fn(p, Math.max(a, pos) - pos, Math.min(b, pos + len) - pos, i);
    pos += len + 1;
  });
}

/** Tach cac run quanh [from,to] cua mot doan va ap `fn` len phan nam trong. */
function mapRange(p: RichPara, from: number, to: number, fn: (r: RichRun) => RichRun): void {
  const out: RichRun[] = [];
  let pos = 0;
  for (const r of p.runs) {
    const s = pos;
    const e = pos + r.t.length;
    pos = e;
    const lo = Math.max(from, s);
    const hi = Math.min(to, e);
    if (hi <= lo) { out.push(r); continue; }
    if (lo > s) out.push({ ...r, t: r.t.slice(0, lo - s) });
    out.push(fn({ ...r, t: r.t.slice(lo - s, hi - s) }));
    if (hi < e) out.push({ ...r, t: r.t.slice(hi - s) });
  }
  p.runs = mergeRuns(out);
}

export function applyStyle(doc: RichDoc, a: number, b: number, patch: Partial<Record<keyof RichStyle, unknown>>): RichDoc {
  const d = cloneDoc(doc);
  eachPara(d, a, b, (p, from, to) => mapRange(p, from, to, (r) => {
    const n: Record<string, unknown> = { ...r };
    for (const [k, v] of Object.entries(patch)) { if (v === undefined || v === false) delete n[k]; else n[k] = v; }
    return n as unknown as RichRun;
  }));
  return d;
}

/** Cac run nam trong [a,b] (bo qua doan rong). */
function covered(doc: RichDoc, a: number, b: number): RichRun[] {
  const out: RichRun[] = [];
  eachPara(doc, a, b, (p, from, to) => {
    let pos = 0;
    for (const r of p.runs) { const s = pos; pos += r.t.length; if (Math.min(to, pos) > Math.max(from, s)) out.push(r); }
  });
  return out;
}

export function toggleFlag(doc: RichDoc, a: number, b: number, k: Flag): RichDoc {
  const runs = covered(doc, a, b);
  const all = runs.length > 0 && runs.every((r) => r[k]);
  return applyStyle(doc, a, b, { [k]: all ? undefined : true });
}
/** In dam: bat/tat 700 (co the doi cac muc khac bang selector do dam). */
export function toggleBold(doc: RichDoc, a: number, b: number): RichDoc {
  const runs = covered(doc, a, b);
  const all = runs.length > 0 && runs.every((r) => (r.w ?? 400) >= 700);
  return applyStyle(doc, a, b, { w: all ? 400 : 700 });
}
export function applyPara(doc: RichDoc, a: number, b: number, patch: { align?: RichAlign | undefined; lh?: number | undefined }): RichDoc {
  const d = cloneDoc(doc);
  eachPara(d, a, b, (p) => {
    if ('align' in patch) { if (patch.align && patch.align !== 'left') p.align = patch.align; else delete p.align; }
    if ('lh' in patch) { if (patch.lh) p.lh = patch.lh; else delete p.lh; }
  });
  return d;
}
export function clearFormat(doc: RichDoc, a: number, b: number): RichDoc {
  const d = cloneDoc(doc);
  eachPara(d, a, b, (p, from, to) => { mapRange(p, from, to, (r) => ({ t: r.t })); delete p.align; delete p.lh; });
  return d;
}

export interface Fmt { w: number | 'mixed'; i: boolean; u: boolean; s: boolean; color: string | 'mixed' | null; bg: string | 'mixed' | null; size: number | 'mixed' | null; fam: string | 'mixed' | null; ls: number | 'mixed'; align: RichAlign | 'mixed'; lh: number | 'mixed' | null }
const uniform = <T,>(vals: T[]): T | 'mixed' | undefined => (vals.length === 0 ? undefined : vals.every((v) => v === vals[0]) ? vals[0] : 'mixed');
/** Dinh dang chung cua vung chon (de hien thi trang thai thanh cong cu). */
export function selectionFormat(doc: RichDoc, a: number, b: number): Fmt {
  const runs = covered(doc, a, b);
  const paras: RichPara[] = [];
  eachPara(doc, a, b, (p) => paras.push(p));
  return {
    w: uniform(runs.map((r) => r.w ?? 400)) ?? 400,
    i: runs.length > 0 && runs.every((r) => !!r.i),
    u: runs.length > 0 && runs.every((r) => !!r.u),
    s: runs.length > 0 && runs.every((r) => !!r.s),
    color: uniform(runs.map((r) => r.color ?? null)) as string | 'mixed' | null,
    bg: uniform(runs.map((r) => r.bg ?? null)) as string | 'mixed' | null,
    size: uniform(runs.map((r) => r.size ?? null)) as number | 'mixed' | null,
    fam: uniform(runs.map((r) => r.fam ?? null)) as string | 'mixed' | null,
    ls: uniform(runs.map((r) => r.ls ?? 0)) ?? 0,
    align: uniform(paras.map((p) => p.align ?? 'left')) ?? 'left',
    lh: uniform(paras.map((p) => p.lh ?? null)) as number | 'mixed' | null,
  };
}

/** Cat doan ky tu [a,b] cua tai lieu (giu thuoc tinh doan dau/cuoi). */
function slice(doc: RichDoc, a: number, b: number): RichDoc {
  const out: RichDoc = [];
  let pos = 0;
  doc.forEach((p) => {
    const len = paraLen(p);
    const lo = Math.max(a, pos) - pos;
    const hi = Math.min(b, pos + len) - pos;
    if (b >= pos && a <= pos + len) {
      const q: RichPara = { ...p, runs: p.runs.map((r) => ({ ...r })) };
      const cut: RichRun[] = [];
      let o = 0;
      for (const r of q.runs) { const s = o; o += r.t.length; const l = Math.max(lo, s); const h = Math.min(hi, o); if (h > l) cut.push({ ...r, t: r.t.slice(l - s, h - s) }); }
      out.push({ ...q, runs: cut });
    }
    pos += len + 1;
  });
  return out;
}

/** Thay vung chon [a,b] bang `text` (xuong dong = doan moi), ke thua kieu cua ky tu dung truoc. Cat bot khi qua gioi han. */
export function replaceRange(doc: RichDoc, a: number, b: number, text: string, singleLine = false): { doc: RichDoc; caret: number } {
  const total = docLength(doc);
  const room = Math.max(0, RICH_LIMITS.chars - (total - (b - a)));
  const ins = (singleLine ? text.replace(/\s*[\r\n]+\s*/g, ' ') : text.replace(/\r\n?/g, '\n')).slice(0, room);
  const before = slice(doc, 0, a);
  const after = slice(doc, b, total);
  const base: RichStyle = (() => { const r = covered(doc, Math.max(0, a - 1), a)[0] ?? covered(doc, a, a + 1)[0]; return r ? { ...r, t: undefined } as RichStyle : {}; })();
  const lines = ins.split('\n').map((l) => ({ runs: l ? [{ ...base, t: l }] : [] }) as RichPara);
  const head = before.length ? before : [{ runs: [] } as RichPara];
  const tail = after.length ? after : [{ runs: [] } as RichPara];
  const merged: RichDoc = [...head.slice(0, -1)];
  const last = head[head.length - 1]!;
  const firstTail = tail[0]!;
  if (lines.length === 1) {
    merged.push({ ...last, runs: mergeRuns([...last.runs, ...lines[0]!.runs, ...firstTail.runs]) });
  } else {
    merged.push({ ...last, runs: mergeRuns([...last.runs, ...lines[0]!.runs]) });
    merged.push(...lines.slice(1, -1));
    merged.push({ ...firstTail, runs: mergeRuns([...lines[lines.length - 1]!.runs, ...firstTail.runs]) });
  }
  merged.push(...tail.slice(1));
  return { doc: merged, caret: a + ins.length };
}
