import { useRef, useState, type PointerEvent } from 'react';
import { ASPECT, clampZone, isMediaZone, zoneName, type Orientation, type Zone } from '../lib/layout';
import type { PreviewItem } from './LivePreview';

const COLORS: Record<string, string> = { video: '#2563EB', image: '#059669', marquee: '#DC2626', text: '#475569', clock: '#7C3AED', weather: '#0891B2', qr: '#B45309' };
type Drag = { id: string; mode: 'move' | 'resize'; sx: number; sy: number; orig: Zone };

/** Noi dung that (anh/khung hinh dau cua video) hien trong vung de nguoi dung thay ngay dang dat tep nao o dau. */
function Thumb({ item }: { item: PreviewItem | undefined }) {
  if (!item?.url) return null;
  if (item.kind === 'image') return <img src={item.url} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none', display: 'block' }} />;
  return <video src={`${item.url}#t=0.5`} muted preload="metadata" playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none', display: 'block' }} />;
}

/** Khung thiet ke vung (keo di chuyen, keo goc vang doi kich thuoc theo %). Hien noi dung that cua tep dau tien trong vung; vung bi an thi mo di. */
export function ZoneCanvas({ orientation, zones, selected, onSelect, onChange, itemsOf, hidden, maxHeight = 520 }: {
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
  const start = (e: PointerEvent, z: Zone, mode: 'move' | 'resize') => {
    e.stopPropagation();
    onSelect(z.id);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDrag({ id: z.id, mode, sx: e.clientX, sy: e.clientY, orig: z });
  };
  const move = (e: PointerEvent) => {
    if (!drag || !canvas.current) return;
    const r = canvas.current.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dx = ((e.clientX - drag.sx) / r.width) * 100;
    const dy = ((e.clientY - drag.sy) / r.height) * 100;
    set(drag.id, drag.mode === 'move' ? { x: drag.orig.x + dx, y: drag.orig.y + dy } : { w: drag.orig.w + dx, h: drag.orig.h + dy });
  };
  const width = orientation === 'portrait' ? `min(100%, ${Math.round((maxHeight * 9) / 16)}px)` : `min(100%, ${Math.round((maxHeight * 16) / 9)}px)`;
  return (
    <div
      ref={canvas}
      data-testid="zone-canvas"
      onPointerMove={move}
      onPointerUp={() => setDrag(null)}
      onPointerCancel={() => setDrag(null)}
      onPointerDown={() => onSelect(null)}
      style={{ position: 'relative', aspectRatio: ASPECT[orientation], width, background: '#0f172a', borderRadius: 10, touchAction: 'none', userSelect: 'none', margin: '0 auto', overflow: 'hidden', backgroundImage: 'linear-gradient(rgba(255,255,255,.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.06) 1px, transparent 1px)', backgroundSize: '10% 10%' }}
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
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(z.id); }}
            style={{ position: 'absolute', left: `${z.x}%`, top: `${z.y}%`, width: `${z.w}%`, height: `${z.h}%`, zIndex: z.z, background: first?.url ? '#000' : `${COLORS[z.type]}55`, border: `2px solid ${isSel ? '#FBBF24' : COLORS[z.type]}`, color: '#fff', fontSize: 11, overflow: 'hidden', cursor: 'move', boxSizing: 'border-box', opacity: hidden.has(z.id) ? 0.25 : 1 }}
          >
            <Thumb item={first} />
            {z.type === 'marquee' || z.type === 'text' ? <div style={{ position: 'absolute', inset: 0, background: z.bg_color ?? '#DC2626', color: z.text_color ?? '#fff', display: 'flex', alignItems: 'center', padding: '0 6px', overflow: 'hidden', whiteSpace: 'nowrap', fontSize: Math.max(9, Math.min(16, (z.font_size ?? 16) * 0.6)) }}>{z.text ?? ''}</div> : null}
            <span style={{ position: 'absolute', left: 2, top: 2, background: 'rgba(0,0,0,.6)', padding: '1px 5px', borderRadius: 4, maxWidth: '90%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{zoneName(z, i)}</span>
            <span aria-hidden onPointerDown={(e) => start(e, z, 'resize')} style={{ position: 'absolute', right: 0, bottom: 0, width: 16, height: 16, background: '#FBBF24', cursor: 'nwse-resize' }} />
          </div>
        );
      })}
    </div>
  );
}
