// Van ban dinh dang: hien thi (RichView) va trinh soan (RichEditor, contenteditable + thao tac tren mo hinh RichDoc, khong dung execCommand).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ClipboardEvent, type KeyboardEvent, type ReactNode } from 'react';
import { RICH_FONTS, RICH_WEIGHTS, parseRich, plainToDoc, richToPlain, serializeRich, singleLine as toSingleLine, type RichAlign, type RichDoc, type RichRun } from '../lib/richtext';
import { applyPara, applyStyle, clearFormat, replaceRange, selectionFormat, toggleBold, toggleFlag, type Fmt } from '../lib/richedit';

export const FONT_STACK: Record<string, string> = {
  Roboto: 'Roboto, Arial, sans-serif',
  Arial: 'Arial, Helvetica, sans-serif',
  Verdana: 'Verdana, Geneva, sans-serif',
  Tahoma: 'Tahoma, Geneva, sans-serif',
  Georgia: 'Georgia, serif',
  'Times New Roman': '"Times New Roman", Times, serif',
  'Courier New': '"Courier New", monospace',
  'sans-serif': 'sans-serif',
  serif: 'serif',
  monospace: 'monospace',
};
const WEIGHT_LABEL: Record<number, string> = { 300: 'Mảnh', 400: 'Thường', 500: 'Vừa', 700: 'Đậm', 900: 'Rất đậm' };
const FONT_LABEL: Record<string, string> = { 'sans-serif': 'Sans-serif (mặc định)', serif: 'Serif', monospace: 'Monospace' };

/** Html -> mo hinh; neu khong co `rich` thi dung van ban thuan `text` (zone cu). */
export const docOf = (rich: string | null | undefined, text: string | null | undefined): RichDoc => (rich ? parseRich(rich) : plainToDoc(text ?? ''));

function runStyle(r: RichRun, k: number): CSSProperties {
  const st: CSSProperties = {};
  if (r.w) st.fontWeight = r.w;
  if (r.i) st.fontStyle = 'italic';
  const deco = [r.u ? 'underline' : '', r.s ? 'line-through' : ''].filter(Boolean).join(' ');
  if (deco) st.textDecoration = deco;
  if (r.color) st.color = r.color;
  if (r.bg) st.backgroundColor = r.bg;
  if (r.size) st.fontSize = `${Math.max(6, Math.round(r.size * k * 10) / 10)}px`;
  if (r.fam) st.fontFamily = FONT_STACK[r.fam];
  if (r.ls) st.letterSpacing = `${Math.round(r.ls * k * 10) / 10}px`;
  return st;
}
function runNodes(runs: RichRun[], k: number): ReactNode[] {
  return runs.map((r, i) => (
    <span key={i} style={runStyle(r, k)}>
      {r.t.split('\n').map((line, j) => (j === 0 ? line : [<br key={`b${j}`} />, line]))}
    </span>
  ));
}

/** Ve tai lieu rich bang phan tu React (khong dung innerHTML). `k` = ti le co chu (preview thu nho). `line` = mot dong (chu chay). */
export function RichView({ html, text, k = 1, line = false }: { html?: string | null; text?: string | null; k?: number; line?: boolean }) {
  const doc = useMemo(() => { const d = docOf(html, text); return line ? toSingleLine(d) : d; }, [html, text, line]);
  if (line) return <>{doc.length ? runNodes(doc[0]!.runs, k) : null}</>;
  return (
    <div style={{ width: '100%' }} data-rich="">
      {doc.map((p, i) => (
        <div key={i} style={{ textAlign: p.align ?? 'left', ...(p.lh ? { lineHeight: p.lh } : {}), minHeight: '1em', overflowWrap: 'anywhere' }}>{runNodes(p.runs, k)}</div>
      ))}
    </div>
  );
}

// ---------- anh xa giua DOM cua contenteditable va vi tri ky tu tuyen tinh ----------
interface Item { node: Node; kind: 't' | 'br' | 'empty'; start: number; end: number }
const BLOCK_TAGS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'PRE', 'UL', 'OL']);
/** Cung quy tac voi parseRich: moi khoi la mot doan; <br> cuoi doan chi la cho giu; khoi long nhau trong khoi rong gop lai. */
export function linearize(root: Node): { items: Item[]; len: number } {
  const items: Item[] = [];
  let pos = 0;
  let paras = 0;
  let open = false;
  let empty = true;
  let pend: Item | null = null;
  const startPara = (): void => { if (paras > 0) pos += 1; paras++; open = true; empty = true; pend = null; };
  const endPara = (): void => { open = false; pend = null; };
  const countPend = (): void => { if (pend) { pend.end = pos + 1; pos += 1; pend = null; } };
  const walk = (n: Node): void => {
    n.childNodes.forEach((c) => {
      if (c.nodeType === 3) {
        const len = (c.nodeValue ?? '').length;
        if (!len) return;
        if (!open) startPara();
        countPend();
        items.push({ node: c, kind: 't', start: pos, end: pos + len });
        pos += len;
        empty = false;
      } else if (c.nodeType === 1) {
        const el = c as Element;
        if (el.tagName === 'BR') {
          if (!open) startPara();
          countPend();
          const it: Item = { node: el, kind: 'br', start: pos, end: pos };
          items.push(it);
          pend = it;
          return;
        }
        if (BLOCK_TAGS.has(el.tagName)) {
          if (!(open && empty && !pend)) { endPara(); startPara(); } // khoi long nhau trong doan rong thi gop lai
          const before = items.length;
          walk(el);
          if (items.length === before) items.push({ node: el, kind: 'empty', start: pos, end: pos });
          endPara();
        } else walk(el);
      }
    });
  };
  walk(root);
  return { items, len: pos };
}
function pointToOffset(items: Item[], len: number, root: Node, node: Node, off: number): number {
  if (node.nodeType === 3) { const it = items.find((x) => x.node === node); if (it) return Math.min(it.end, it.start + off); }
  if (node === root || node.nodeType === 1) {
    const child = node.childNodes[off];
    if (child) { const it = items.find((x) => child === x.node || child.contains(x.node)); if (it) return it.start; }
    else { const inside = items.filter((x) => node === x.node || node.contains(x.node)); const last = inside[inside.length - 1]; if (last) return last.end; }
  }
  const it = items.find((x) => node.contains(x.node));
  return it ? it.start : len;
}
function offsetToPoint(items: Item[], root: Node, pos: number): [Node, number] {
  for (const it of items) {
    if (pos < it.start || pos > it.end) continue;
    if (it.kind === 't') return [it.node, pos - it.start];
    const parent = it.node.parentNode ?? root;
    const idx = Array.prototype.indexOf.call(parent.childNodes, it.node) as number;
    if (it.kind === 'empty') return [it.node, 0];
    return [parent, pos > it.start ? idx + 1 : idx];
  }
  return [root, root.childNodes.length];
}

export interface RichChange { rich: string; text: string }
interface EditorProps {
  label: string;
  rich?: string | null;
  text?: string | null;
  onChange: (v: RichChange) => void;
  /** chu chay: mot dong, thanh cong cu rut gon */
  line?: boolean;
  baseColor?: string | null;
  baseBg?: string | null;
  baseSize?: number | null;
}

const ALIGNS: { v: RichAlign; label: string; icon: string }[] = [
  { v: 'left', label: 'Căn trái', icon: 'M3 5h18M3 10h12M3 15h18M3 20h12' },
  { v: 'center', label: 'Căn giữa', icon: 'M3 5h18M6 10h12M3 15h18M6 20h12' },
  { v: 'right', label: 'Căn phải', icon: 'M3 5h18M9 10h12M3 15h18M9 20h12' },
  { v: 'justify', label: 'Căn đều hai bên', icon: 'M3 5h18M3 10h18M3 15h18M3 20h18' },
];
const LH = [1, 1.2, 1.5, 1.8, 2];

export function RichEditor({ label, rich, text, onChange, line = false, baseColor, baseBg, baseSize }: EditorProps) {
  const root = useRef<HTMLDivElement>(null);
  const emitted = useRef<string | null>(null);
  const sel = useRef<{ s: number; e: number }>({ s: 0, e: 0 });
  const [fmt, setFmt] = useState<Fmt | null>(null);
  const [hint, setHint] = useState('');
  const initial = useMemo(() => { const d = docOf(rich, text); return line ? toSingleLine(d) : d; }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const render = (d: RichDoc): void => { if (root.current) root.current.innerHTML = d.length ? serializeRich(d) : '<p><br></p>'; };
  const readDoc = (): RichDoc => { const d = parseRich(root.current?.innerHTML ?? ''); return line ? toSingleLine(d) : d; };
  const emit = (d: RichDoc): void => {
    const html = d.length && richToPlain(d).trim() ? serializeRich(d) : '';
    emitted.current = html;
    onChange({ rich: html, text: richToPlain(d) });
  };
  const readSel = useCallback((): { s: number; e: number } | null => {
    const r = root.current;
    const s = window.getSelection();
    if (!r || !s || s.rangeCount === 0 || !r.contains(s.anchorNode) || !r.contains(s.focusNode)) return null;
    const { items, len } = linearize(r);
    const a = pointToOffset(items, len, r, s.anchorNode!, s.anchorOffset);
    const b = pointToOffset(items, len, r, s.focusNode!, s.focusOffset);
    return { s: Math.min(a, b), e: Math.max(a, b) };
  }, []);
  const writeSel = (s: number, e: number): void => {
    const r = root.current;
    const w = window.getSelection();
    if (!r || !w) return;
    const { items } = linearize(r);
    const [n1, o1] = offsetToPoint(items, r, s);
    const [n2, o2] = offsetToPoint(items, r, e);
    try { const rg = document.createRange(); rg.setStart(n1, o1); rg.setEnd(n2, o2); w.removeAllRanges(); w.addRange(rg); } catch { /* vung chon khong hop le: bo qua */ }
  };

  useLayoutEffect(() => { render(initial); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // gia tri doi tu ben ngoai (vd ap mau, hoan tac): ve lai; bo qua tieng vang cua chinh minh va lan dau (da ve o tren)
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    if (emitted.current !== null && (rich ?? '') === emitted.current) return;
    const d = docOf(rich, text);
    render(line ? toSingleLine(d) : d);
    emitted.current = rich ?? '';
  }, [rich, text, line]); // eslint-disable-line react-hooks/exhaustive-deps

  const track = useCallback(() => {
    const s = readSel();
    if (!s) return;
    sel.current = s;
    const d = parseRich(root.current?.innerHTML ?? '');
    setFmt(selectionFormat(d, s.s, s.e));
  }, [readSel]);
  useEffect(() => {
    document.addEventListener('selectionchange', track);
    return () => document.removeEventListener('selectionchange', track);
  }, [track]);

  /** Chay mot lenh len vung chon luu gan nhat (thanh cong cu co the lam mat vung chon thuc). */
  const run = (fn: (d: RichDoc, s: number, e: number) => RichDoc, needRange: boolean): void => {
    const { s, e } = sel.current;
    if (needRange && s === e) { setHint('Hãy bôi đen đoạn chữ cần định dạng.'); return; }
    setHint('');
    const d = fn(readDoc(), s, e);
    render(d);
    writeSel(s, e);
    emit(d);
    setFmt(selectionFormat(d, s, e));
  };
  const style = (patch: Parameters<typeof applyStyle>[3]) => run((d, s, e) => applyStyle(d, s, e, patch), true);

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Enter' && line) { e.preventDefault(); return; }
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'b') { e.preventDefault(); track(); run((d, s, en) => toggleBold(d, s, en), true); }
      else if (k === 'i') { e.preventDefault(); track(); run((d, s, en) => toggleFlag(d, s, en, 'i'), true); }
      else if (k === 'u') { e.preventDefault(); track(); run((d, s, en) => toggleFlag(d, s, en, 'u'), true); }
    }
  };
  const onPaste = (e: ClipboardEvent): void => {
    e.preventDefault();
    track();
    const t = e.clipboardData.getData('text/plain');
    if (!t) return;
    const { s, e: en } = sel.current;
    const r = replaceRange(readDoc(), s, en, t, line);
    render(r.doc);
    writeSel(r.caret, r.caret);
    emit(r.doc);
  };
  const onInput = (): void => { emit(readDoc()); track(); };

  const f = fmt;
  const pressed = (on: boolean | undefined) => ({ 'aria-pressed': !!on, className: `rt-b${on ? ' on' : ''}` });
  const keepSel = (e: { preventDefault: () => void }) => e.preventDefault();
  const sz = baseSize ?? 24;
  return (
    <div className="rt">
      <div className="rt-bar" role="toolbar" aria-label="Định dạng văn bản" onMouseDown={(e) => { if (!(e.target as HTMLElement).closest('select,input')) keepSel(e); }}>
        <button type="button" title="In đậm (Ctrl+B)" aria-label="In đậm" {...pressed(f ? (typeof f.w === 'number' ? f.w >= 700 : false) : false)} onClick={() => run((d, s, e) => toggleBold(d, s, e), true)}><b>B</b></button>
        <button type="button" title="In nghiêng (Ctrl+I)" aria-label="In nghiêng" {...pressed(f?.i)} onClick={() => run((d, s, e) => toggleFlag(d, s, e, 'i'), true)}><i>I</i></button>
        <button type="button" title="Gạch chân (Ctrl+U)" aria-label="Gạch chân" {...pressed(f?.u)} onClick={() => run((d, s, e) => toggleFlag(d, s, e, 'u'), true)}><u>U</u></button>
        <button type="button" title="Gạch ngang" aria-label="Gạch ngang" {...pressed(f?.s)} onClick={() => run((d, s, e) => toggleFlag(d, s, e, 's'), true)}><s>S</s></button>
        <label className="rt-c" title="Màu chữ">
          <span aria-hidden>A</span>
          <input type="color" aria-label="Màu chữ" value={typeof f?.color === 'string' && f.color !== 'mixed' ? f.color : baseColor ?? '#FFFFFF'} onChange={(e) => style({ color: e.target.value.toUpperCase() })} />
        </label>
        <label className="rt-c" title="Màu nền chữ (tô sáng)">
          <span aria-hidden style={{ background: '#FDE047', color: '#111', padding: '0 3px' }}>A</span>
          <input type="color" aria-label="Màu nền chữ" value={typeof f?.bg === 'string' && f.bg !== 'mixed' ? f.bg : '#FDE047'} onChange={(e) => style({ bg: e.target.value.toUpperCase() })} />
        </label>
        <button type="button" title="Bỏ màu nền chữ" aria-label="Bỏ màu nền chữ" className="rt-b" onClick={() => style({ bg: undefined })}>A̶</button>
        <select aria-label="Độ đậm nhạt" value={typeof f?.w === 'number' ? f.w : ''} onChange={(e) => style({ w: Number(e.target.value) })}>
          <option value="" disabled>Độ đậm</option>
          {RICH_WEIGHTS.map((w) => <option key={w} value={w}>{WEIGHT_LABEL[w]}</option>)}
        </select>
        {!line ? (
          <>
            <select aria-label="Phông chữ" value={typeof f?.fam === 'string' && f.fam !== 'mixed' ? f.fam : ''} onChange={(e) => style({ fam: e.target.value || undefined })}>
              <option value="">Phông mặc định</option>
              {RICH_FONTS.map((x) => <option key={x} value={x}>{FONT_LABEL[x] ?? x}</option>)}
            </select>
            <input type="number" aria-label="Cỡ chữ đoạn chọn" title="Cỡ chữ của đoạn chọn" min={8} max={200} placeholder="Cỡ" value={typeof f?.size === 'number' ? f.size : ''} onChange={(e) => { const n = Number(e.target.value); if (n >= 8 && n <= 200) style({ size: n }); }} />
            <input type="number" aria-label="Khoảng cách chữ" title="Khoảng cách chữ (px)" min={-5} max={40} step={0.5} value={typeof f?.ls === 'number' ? f.ls : 0} onChange={(e) => style({ ls: Number(e.target.value) || undefined })} />
            {ALIGNS.map((a) => (
              <button key={a.v} type="button" title={a.label} aria-label={a.label} {...pressed(f?.align === a.v)} onClick={() => run((d, s, e) => applyPara(d, s, e, { align: a.v }), false)}>
                <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d={a.icon} /></svg>
              </button>
            ))}
            <select aria-label="Giãn dòng" value={typeof f?.lh === 'number' ? f.lh : ''} onChange={(e) => run((d, s, en) => applyPara(d, s, en, { lh: Number(e.target.value) || undefined }), false)}>
              <option value="">Giãn dòng</option>
              {LH.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </>
        ) : null}
        <button type="button" className="rt-b" title="Xóa định dạng của đoạn chọn" aria-label="Xóa định dạng" onClick={() => run((d, s, e) => clearFormat(d, s, e), false)}>Tx</button>
      </div>
      <div
        ref={root}
        className="rt-ed"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline={!line}
        aria-label={label}
        spellCheck={false}
        style={{ color: baseColor ?? '#FFFFFF', background: baseBg ?? '#111827', fontSize: Math.min(sz, 40), whiteSpace: line ? 'nowrap' : 'pre-wrap', overflowX: line ? 'auto' : 'hidden', minHeight: line ? 40 : 96 }}
        onInput={onInput}
        onKeyDown={onKeyDown}
        onKeyUp={track}
        onMouseUp={track}
        onBlur={track}
        onPaste={onPaste}
        onDrop={(e) => e.preventDefault()}
      />
      <div className="rt-h" aria-live="polite">{hint || (line ? 'Chữ chạy là một dòng; định dạng áp dụng cho đoạn chữ được bôi đen.' : 'Enter để xuống dòng. Bôi đen chữ rồi chọn định dạng; căn lề áp dụng cho đoạn đang đặt con trỏ.')}</div>
    </div>
  );
}
