import { useRef, useState, type PointerEvent } from 'react';
import { Field } from './ui';
import { ASPECT, MAX_ZONES, TRANSITIONS, ZONE_LABEL, ZONE_TYPES, clampZone, isMediaZone, newZone, zoneName, type Orientation, type Zone, type ZoneType } from '../lib/layout';

const COLORS: Record<string, string> = { video: '#2563EB', image: '#059669', marquee: '#DC2626', text: '#475569', clock: '#7C3AED', weather: '#0891B2', qr: '#B45309' };
type Drag = { id: string; mode: 'move' | 'resize'; sx: number; sy: number; orig: Zone };

/** Trinh soan vung: keo de di chuyen, keo goc duoi-phai de doi kich thuoc (theo % khung), kem bang thuoc tinh cua vung dang chon. */
export function ZoneEditor({ orientation, zones, onChange, selected, onSelect }: { orientation: Orientation; zones: Zone[]; onChange: (z: Zone[]) => void; selected: string | null; onSelect: (id: string | null) => void }) {
  const canvas = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const sel = zones.find((z) => z.id === selected) ?? null;
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
  const add = (t: ZoneType) => {
    if (zones.length >= MAX_ZONES) return;
    const z = newZone(t, zones);
    onChange([...zones, z]);
    onSelect(z.id);
  };
  const num = (k: 'x' | 'y' | 'w' | 'h' | 'z') => (
    <Field label={{ x: 'Trái (%)', y: 'Trên (%)', w: 'Rộng (%)', h: 'Cao (%)', z: 'Lớp (0–20)' }[k]}>
      <input type="number" min={0} max={k === 'z' ? 20 : 100} step={k === 'z' ? 1 : 0.5} value={sel ? sel[k] : 0} onChange={(e) => sel && set(sel.id, { [k]: Number(e.target.value) })} />
    </Field>
  );
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) minmax(240px, 1fr)', gap: 14, alignItems: 'start' }}>
      <div>
        <div
          ref={canvas}
          data-testid="zone-canvas"
          onPointerMove={move}
          onPointerUp={() => setDrag(null)}
          onPointerCancel={() => setDrag(null)}
          onPointerDown={() => onSelect(null)}
          style={{ position: 'relative', aspectRatio: ASPECT[orientation], width: orientation === 'portrait' ? 'min(100%, 260px)' : '100%', background: '#111827', borderRadius: 8, touchAction: 'none', userSelect: 'none', margin: '0 auto', backgroundImage: 'linear-gradient(rgba(255,255,255,.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.06) 1px, transparent 1px)', backgroundSize: '10% 10%' }}
        >
          {zones.map((z, i) => (
            <div
              key={z.id}
              data-zone={z.id}
              role="button"
              tabIndex={0}
              aria-label={`Vùng ${zoneName(z, i)}`}
              aria-pressed={z.id === selected}
              onPointerDown={(e) => start(e, z, 'move')}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(z.id); }}
              style={{ position: 'absolute', left: `${z.x}%`, top: `${z.y}%`, width: `${z.w}%`, height: `${z.h}%`, zIndex: z.z, background: `${COLORS[z.type]}66`, border: `2px solid ${z.id === selected ? '#FBBF24' : COLORS[z.type]}`, color: '#fff', fontSize: 11, overflow: 'hidden', cursor: 'move', boxSizing: 'border-box', padding: 2 }}
            >
              {zoneName(z, i)}
              <span aria-hidden onPointerDown={(e) => start(e, z, 'resize')} style={{ position: 'absolute', right: 0, bottom: 0, width: 14, height: 14, background: '#FBBF24', cursor: 'nwse-resize' }} />
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          {ZONE_TYPES.map((t) => <button key={t} type="button" className="btn sm" disabled={zones.length >= MAX_ZONES} onClick={() => add(t)}>+ {ZONE_LABEL[t]}</button>)}
        </div>
        <div style={{ color: 'var(--mut)', fontSize: 12, marginTop: 6 }}>{zones.length}/{MAX_ZONES} vùng. Kéo vùng để di chuyển, kéo góc vàng để đổi kích thước.</div>
      </div>
      <div>
        {sel ? (
          <div role="group" aria-label="Thuộc tính vùng">
            <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>Vùng: {zoneName(sel)}</h3>
            <Field label="Tên vùng"><input maxLength={60} value={sel.name ?? ''} onChange={(e) => onChange(zones.map((z) => (z.id === sel.id ? { ...z, name: e.target.value } : z)))} /></Field>
            <Field label="Loại vùng"><select value={sel.type} onChange={(e) => set(sel.id, { type: e.target.value as ZoneType })}>{ZONE_TYPES.map((t) => <option key={t} value={t}>{ZONE_LABEL[t]}</option>)}</select></Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>{num('x')}{num('y')}{num('w')}{num('h')}{num('z')}</div>
            {isMediaZone(sel) ? <Field label="Chuyển cảnh"><select value={sel.transition} onChange={(e) => set(sel.id, { transition: e.target.value })}>{TRANSITIONS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></Field> : null}
            {sel.type === 'marquee' ? (
              <>
                <Field label="Nội dung chữ chạy"><input maxLength={200} value={sel.text ?? ''} onChange={(e) => set(sel.id, { text: e.target.value })} /></Field>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <Field label="Màu nền"><input type="color" value={sel.bg_color ?? '#DC2626'} onChange={(e) => set(sel.id, { bg_color: e.target.value.toUpperCase() })} /></Field>
                  <Field label="Màu chữ"><input type="color" value={sel.text_color ?? '#FFFFFF'} onChange={(e) => set(sel.id, { text_color: e.target.value.toUpperCase() })} /></Field>
                  <Field label="Cỡ chữ"><input type="number" min={8} max={200} value={sel.font_size ?? 18} onChange={(e) => set(sel.id, { font_size: Number(e.target.value) })} /></Field>
                  <Field label="Tốc độ (0–100)"><input type="number" min={0} max={100} value={sel.scroll_speed ?? 60} onChange={(e) => set(sel.id, { scroll_speed: Number(e.target.value) })} /></Field>
                </div>
              </>
            ) : null}
            {sel.type === 'text' ? (
              <>
                <Field label="Nội dung văn bản"><textarea maxLength={200} rows={3} value={sel.text ?? ''} onChange={(e) => set(sel.id, { text: e.target.value })} /></Field>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <Field label="Màu nền"><input type="color" value={sel.bg_color ?? '#111827'} onChange={(e) => set(sel.id, { bg_color: e.target.value.toUpperCase() })} /></Field>
                  <Field label="Màu chữ"><input type="color" value={sel.text_color ?? '#FFFFFF'} onChange={(e) => set(sel.id, { text_color: e.target.value.toUpperCase() })} /></Field>
                  <Field label="Cỡ chữ"><input type="number" min={8} max={200} value={sel.font_size ?? 24} onChange={(e) => set(sel.id, { font_size: Number(e.target.value) })} /></Field>
                </div>
              </>
            ) : null}
            {sel.type === 'qr' ? <Field label="Liên kết mã QR"><input maxLength={500} value={sel.url ?? ''} onChange={(e) => set(sel.id, { url: e.target.value })} /></Field> : null}
            <button type="button" className="btn sm d" onClick={() => { onChange(zones.filter((z) => z.id !== sel.id)); onSelect(null); }}>Xóa vùng này</button>
          </div>
        ) : <p style={{ color: 'var(--mut)' }}>Chọn một vùng trên khung để sửa thuộc tính, hoặc thêm vùng mới bên dưới khung.</p>}
      </div>
    </div>
  );
}
