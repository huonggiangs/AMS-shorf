import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { ASPECT, clampZone, isMediaZone, zoneName, type Orientation, type Zone } from '../lib/layout';
import type { PreviewItem } from './LivePreview';
import { RichView } from './RichText';

const COLORS: Record<string, string> = { video: '#2563EB', image: '#059669', marquee: '#DC2626', text: '#475569', clock: '#7C3AED', weather: '#0891B2', qr: '#B45309' };
type Dir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
type Drag = { id: string; mode: 'move' | Dir; sx: number; sy: number; orig: Zone };
const HANDLES: { d: Dir; st: React.CSSProperties; cur: string }[] = [
  { d: 'nw', st: { left: -5, top: -5 }, cur: 'nwse-resize' }, { d: 'n', st: { left: 'calc(50% - 5px)', top: -5 }, cur: 'ns-resize' }, { d: 'ne', st: { right: -5, top: -5 }, cur: 'nesw-resize' },
  { d: 'e', st: { right: -5, top: 'calc(50% - 5px)' }, cur: 'ew-resize' }, { d: 'se', st: { right: -5, bottom: -5 }, cur: 'nwse-resize' }, { d: 's', st: { left: 'calc(50% - 5px)', bottom: -5 }, cur: 'ns-resize' },
  { d: 'sw', st: { left: -5, bottom: -5 }, cur: 'nesw-resize' }, { d: 'w', st: { left: -5, top: 'calc(50% - 5px)' }, cur: 'ew-resize' },
];
const MIN = 5;
/** Kich thuoc diem anh o che do xem (khung 1080p thu nho mot nua). */
export const STAGE_PX: Record<Orientation, [number, number]> = { portrait: [540, 960], landscape: [960, 540] };

/** Noi dung that (anh/khung hinh dau cua video) hien trong vung de nguoi dung thay ngay dang dat tep nao o dau. */
function Thumb({ item }: { item: PreviewItem | undefined }) {
  if (!item?.url) return null;
  if (item.kind === 'image') return <img src={item.url} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none', display: 'block' }} />;
  return <video src={`${item.url}#t=0.5`} muted preload="metadata" playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none', display: 'block' }} />;
}

/** Khung thiet ke vung (keo di chuyen, keo goc vang doi kich thuoc theo %). Hien noi dung that cua tep dau tien trong vung; vung bi an thi mo di. */
export function ZoneCanvas({ orientation, zones, selected, onSelect, onChange, itemsOf, hidden, maxHeight = 600 }: {
  orientation: Orientation;
  zones: Zone[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onChange: (z: Zone[]) => void;
  itemsOf: (z: Zone) => PreviewItem[];
  hidden: Set<string>;
  maxHeight?: number;
}) {
  const canvas = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const set = (id: string, patch: Partial<Zone>) => onChange(zones.map((z) => (z.id === id ? clampZone({ ...z, ...patch }) : z)));
  const start = (e: PointerEvent, z: Zone, mode: Drag['mode']) => {
    e.stopPropagation();
    onSelect(z.id);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDrag({ id: z.id, mode, sx: e.clientX, sy: e.clientY, orig: z });
  };
  const move = (e: PointerEvent) => {
    if (!drag || !canvas.current) return;
    const r = canvas.current.getBoundingClientRect();
    if (!r.width || !r.height) return;
    // luoi 1%: lam tron theo tung don vi phan tram cua khung
    const dx = Math.round(((e.clientX - drag.sx) / r.width) * 100);
    const dy = Math.round(((e.clientY - drag.sy) / r.height) * 100);
    const o = drag.orig;
    if (drag.mode === 'move') { set(drag.id, { x: o.x + dx, y: o.y + dy }); return; }
    const m = drag.mode;
    const patch: Partial<Zone> = {};
    if (m.includes('e')) patch.w = Math.min(100 - o.x, Math.max(MIN, o.w + dx));
    if (m.includes('s')) patch.h = Math.min(100 - o.y, Math.max(MIN, o.h + dy));
    if (m.includes('w')) { const w = Math.min(o.x + o.w, Math.max(MIN, o.w - dx)); patch.w = w; patch.x = o.x + o.w - w; }
    if (m.includes('n')) { const h = Math.min(o.y + o.h, Math.max(MIN, o.h - dy)); patch.h = h; patch.y = o.y + o.h - h; }
    set(drag.id, patch);
  };
  /** Phim mui ten nhich 1% (Shift 5%); Alt+mui ten doi kich thuoc. */
  const onKey = (e: KeyboardEvent, z: Zone) => {
    if (e.key === 'Enter' || e.key === ' ') { onSelect(z.id); return; }
    const v: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const d = v[e.key];
    if (!d) return;
    e.preventDefault();
    onSelect(z.id);
    const n = e.shiftKey ? 5 : 1;
    set(z.id, e.altKey ? { w: z.w + d[0] * n, h: z.h + d[1] * n } : { x: z.x + d[0] * n, y: z.y + d[1] * n });
  };
  const width = orientation === 'portrait' ? `min(100%, ${Math.round((maxHeight * 9) / 16)}px)` : `min(100%, ${Math.round((maxHeight * 16) / 9)}px)`;
  const [pw, ph] = STAGE_PX[orientation];
  return (
    <div className="zc-stage">
    <div className="zc-label" aria-label="Kích thước khung">{pw} × {ph} · CHUẨN HIỂN THỊ DOOH</div>
    <div
      ref={canvas}
      data-testid="zone-canvas"
      onPointerMove={move}
      onPointerUp={() => setDrag(null)}
      onPointerCancel={() => setDrag(null)}
      onPointerDown={() => onSelect(null)}
      style={{ position: 'relative', aspectRatio: ASPECT[orientation], width, background: '#0f172a', borderRadius: 10, touchAction: 'none', userSelect: 'none', margin: '0 auto', backgroundImage: 'linear-gradient(rgba(255,255,255,.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.06) 1px, transparent 1px)', backgroundSize: '10% 10%', boxShadow: '0 4px 18px rgba(15,23,42,.25)' }}
    >
      {zones.map((z, i) => {
        const isSel = z.id === selected;
        const first = isMediaZone(z) ? itemsOf(z)[0] : undefined;
        return (
          <div
            key={z.id}
            data-zone={z.id}
            role="button"
            tabIndex={0}
            aria-label={`Vùng ${zoneName(z, i)}`}
            aria-pressed={isSel}
            onPointerDown={(e) => start(e, z, 'move')}
            onKeyDown={(e) => onKey(e, z)}
            style={{ position: 'absolute', left: `${z.x}%`, top: `${z.y}%`, width: `${z.w}%`, height: `${z.h}%`, zIndex: z.z, background: first?.url ? '#000' : `${COLORS[z.type]}55`, border: `2px solid ${isSel ? '#2563EB' : COLORS[z.type]}`, color: '#fff', fontSize: 11, overflow: 'hidden', cursor: 'move', boxSizing: 'border-box', opacity: hidden.has(z.id) ? 0.25 : 1 }}
          >
            <Thumb item={first} />
            {z.type === 'marquee' || z.type === 'text' ? <div style={{ position: 'absolute', inset: 0, background: z.bg_color ?? '#DC2626', color: z.text_color ?? '#fff', display: 'flex', alignItems: 'center', padding: '0 6px', overflow: 'hidden', whiteSpace: z.rich && z.type === 'text' ? 'normal' : 'nowrap', fontSize: Math.max(9, Math.min(16, (z.font_size ?? 16) * 0.6)) }}>{z.rich ? <RichView html={z.rich} line={z.type === 'marquee'} k={Math.max(9, Math.min(16, (z.font_size ?? 16) * 0.6)) / (z.font_size ?? 16)} /> : z.text ?? ''}</div> : null}
            <span style={{ position: 'absolute', left: 2, top: 2, background: 'rgba(0,0,0,.6)', padding: '1px 5px', borderRadius: 4, maxWidth: '90%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{zoneName(z, i)}</span>
          </div>
        );
      })}
      {zones.filter((z) => z.id === selected).map((z) => (
        <div key={`h-${z.id}`} style={{ position: 'absolute', left: `${z.x}%`, top: `${z.y}%`, width: `${z.w}%`, height: `${z.h}%`, zIndex: 40, pointerEvents: 'none' }}>
          {HANDLES.map((h) => <span key={h.d} aria-hidden data-handle={h.d} onPointerDown={(e) => start(e, z, h.d)} style={{ position: 'absolute', width: 10, height: 10, background: '#2563EB', border: '1px solid #fff', borderRadius: 2, cursor: h.cur, pointerEvents: 'auto', ...h.st }} />)}
        </div>
      ))}
    </div>
    </div>
  );
}
