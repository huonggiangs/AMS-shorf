// Bang thuoc tinh danh sach phat cua mot vung: them nhanh (+Video/+Anh/+Text), keo tha + nut len/xuong, Sua, Xoa, tong thoi luong, Loop.
import { useState } from 'react';
import { Field } from './ui';
import { RichEditor } from './RichText';
import { ITEM_DEFAULT_S, MAX_ITEM_S, TYPE_LABEL, fmtDur, newItem, playlistTotalS, type PlaylistItem, type PlaylistItemType } from '../lib/playlist';

export interface PoolMedia { id: string; name: string; kind?: string | null; mime?: string | null; delivery?: string | null; width?: number | null; height?: number | null; duration_sec?: number | null }
export interface PlaylistPanelProps {
  items: PlaylistItem[];
  loop: boolean;
  pool: PoolMedia[];
  loading?: boolean;
  /** anh/khung hinh xem nhanh theo media_id */
  thumbOf?: (mediaId: string) => { url: string; kind: 'video' | 'image' } | undefined;
  onItems: (items: PlaylistItem[]) => void;
  onLoop: (v: boolean) => void;
}

const isImg = (m: PoolMedia): boolean => m.kind === 'image' || !!m.mime?.startsWith('image/');
const clampS = (v: string): number | undefined => { const n = Math.round(Number(v)); return v && n >= 1 ? Math.min(MAX_ITEM_S, n) : undefined; };

export function PlaylistPanel({ items, loop, pool, loading, thumbOf, onItems, onLoop }: PlaylistPanelProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const meta = (id: string): number | null => pool.find((m) => m.id === id)?.duration_sec ?? null;
  const patch = (id: string, p: Partial<PlaylistItem>) => onItems(items.map((i) => (i.id === id ? { ...i, ...p } : i)));
  const clearDur = (id: string) => onItems(items.map((i) => { if (i.id !== id) return i; const { duration: _d, ...rest } = i; void _d; return rest; }));
  const add = (t: PlaylistItemType) => { const it = newItem(t, items); onItems([...items, it]); setEditing(it.id); };
  const move = (id: string, d: number) => { const i = items.findIndex((x) => x.id === id); const j = i + d; if (i < 0 || j < 0 || j >= items.length) return; const n = [...items]; [n[i], n[j]] = [n[j]!, n[i]!]; onItems(n); };
  const drop = (to: string) => {
    if (dragId && dragId !== to) { const n = items.filter((x) => x.id !== dragId); const mv = items.find((x) => x.id === dragId)!; n.splice(n.findIndex((x) => x.id === to), 0, mv); onItems(n); }
    setDragId(null); setOverId(null);
  };
  const total = playlistTotalS(items, meta);
  const unknown = items.some((i) => i.type === 'video' && !(i.duration && i.duration > 0) && !(i.media_id && meta(i.media_id)));

  const editor = (it: PlaylistItem) => (
    <div className="wz-pl-edit" role="group" aria-label={`Sửa mục ${it.name}`}>
      <Field label="Tên mục"><input maxLength={80} value={it.name} onChange={(e) => patch(it.id, { name: e.target.value })} /></Field>
      {it.type === 'text' ? (
        <>
          <div className="fd">
            <label id={`pl-rt-${it.id}`}>Nội dung văn bản</label>
            <RichEditor key={it.id} label="Nội dung văn bản" rich={it.style?.rich} text={it.text_content} baseColor={it.style?.text_color} baseBg={it.style?.bg_color ?? '#111827'} baseSize={it.style?.font_size ?? 24} onChange={(v) => patch(it.id, { text_content: v.text, style: { ...it.style, rich: v.rich || undefined } })} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <Field label="Màu nền"><input type="color" value={it.style?.bg_color ?? '#111827'} onChange={(e) => patch(it.id, { style: { ...it.style, bg_color: e.target.value.toUpperCase() } })} /></Field>
            <Field label="Màu chữ"><input type="color" value={it.style?.text_color ?? '#FFFFFF'} onChange={(e) => patch(it.id, { style: { ...it.style, text_color: e.target.value.toUpperCase() } })} /></Field>
            <Field label="Cỡ chữ"><input type="number" min={8} max={200} value={it.style?.font_size ?? 24} onChange={(e) => patch(it.id, { style: { ...it.style, font_size: Number(e.target.value) } })} /></Field>
          </div>
        </>
      ) : (
        <Field label={`Chọn tệp ${it.type === 'image' ? 'ảnh' : 'video'} (kho đã duyệt)`}>
          <select aria-label="Chọn tệp" value={it.media_id ?? ''} onChange={(e) => { const m = pool.find((x) => x.id === e.target.value); if (m) patch(it.id, { media_id: m.id, name: m.name }); else { const { media_id: _m, ...rest } = it; void _m; onItems(items.map((x) => (x.id === it.id ? rest : x))); } }}>
            <option value="">{loading ? 'Đang tải…' : '— chọn tệp —'}</option>
            {pool.filter((m) => (it.type === 'image') === isImg(m) || m.id === it.media_id).map((m) => <option key={m.id} value={m.id}>{m.delivery === 'stream' ? '[Link] ' : ''}{m.name}{m.width && m.height ? ` · ${m.width}×${m.height}` : ''}</option>)}
          </select>
        </Field>
      )}
      <button type="button" className="btn sm" onClick={() => setEditing(null)}>Xong</button>
    </div>
  );

  return (
    <div data-testid="playlist-panel">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '12px 0 6px' }}>
        <b style={{ fontSize: 13 }}>Danh sách phát ({items.length} mục)</b>
      </div>
      <div className="wz-pl-add" role="group" aria-label="Thêm mục vào danh sách phát">
        {(['video', 'image', 'text'] as PlaylistItemType[]).map((t) => <button key={t} type="button" className="btn sm" aria-label={`Thêm mục ${TYPE_LABEL[t]}`} onClick={() => add(t)}>+ {TYPE_LABEL[t]}</button>)}
      </div>
      {items.length === 0 ? <p style={{ color: 'var(--mut)', fontSize: 13, margin: '0 0 8px' }}>Chưa có mục nào. Bấm + Video / + Ảnh / + Text để thêm.</p> : null}
      {items.map((it) => {
        const th = it.media_id ? thumbOf?.(it.media_id) : undefined;
        const m = it.media_id ? meta(it.media_id) : null;
        return (
          <div key={it.id}>
            <div className={`wz-media${overId === it.id ? ' over' : ''}`} draggable data-item={it.id} data-media={it.media_id ?? it.id} onDragStart={() => setDragId(it.id)} onDragOver={(e) => { e.preventDefault(); setOverId(it.id); }} onDragLeave={() => setOverId(null)} onDrop={(e) => { e.preventDefault(); drop(it.id); }} onDragEnd={() => { setDragId(null); setOverId(null); }}>
              <div className={`wz-pl-th t-${it.type}`} aria-hidden>
                {th ? (th.kind === 'image' ? <img src={th.url} alt="" draggable={false} /> : <video src={`${th.url}#t=0.5`} muted preload="metadata" />) : <span>{it.type === 'text' ? 'Aa' : it.type === 'image' ? '🖼' : '▶'}</span>}
              </div>
              <div className="nm" title={it.name}>{it.name}<small>{TYPE_LABEL[it.type]}{it.type !== 'text' && !it.media_id ? ' · chưa chọn tệp' : ''}</small></div>
              <input type="number" min={1} max={MAX_ITEM_S} aria-label={`Số giây hiển thị ${it.name}`} title={it.type === 'video' ? 'Để trống = phát hết video (theo thời lượng thật)' : `Giây hiển thị (mặc định ${ITEM_DEFAULT_S})`} placeholder={it.type === 'video' ? (m ? String(Math.round(m)) : 'Hết') : String(ITEM_DEFAULT_S)} value={it.duration ?? ''} onChange={(e) => { const n = clampS(e.target.value); if (n) patch(it.id, { duration: n }); else clearDur(it.id); }} style={{ width: 52, height: 28, padding: '0 4px' }} />
              <span aria-hidden style={{ fontSize: 11, color: 'var(--mut)' }}>s</span>
              <button type="button" aria-label={`Lên ${it.name}`} onClick={() => move(it.id, -1)}>↑</button>
              <button type="button" aria-label={`Xuống ${it.name}`} onClick={() => move(it.id, 1)}>↓</button>
              <button type="button" aria-label={`Sửa ${it.name}`} aria-pressed={editing === it.id} onClick={() => setEditing(editing === it.id ? null : it.id)}>Sửa</button>
              <button type="button" aria-label={`Xóa ${it.name}`} style={{ color: '#DC2626' }} onClick={() => { onItems(items.filter((x) => x.id !== it.id)); if (editing === it.id) setEditing(null); }}>🗑</button>
            </div>
            {editing === it.id ? editor(it) : null}
          </div>
        );
      })}
      <div className="wz-pl-foot">
        <span data-testid="pl-total">Tổng thời lượng: <b>{fmtDur(total)}</b>{unknown ? ' (chưa rõ độ dài một số video)' : ''}</span>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={loop} onChange={(e) => onLoop(e.target.checked)} />Lặp lại (Loop)</label>
      </div>
    </div>
  );
}
