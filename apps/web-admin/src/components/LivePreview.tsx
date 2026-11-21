import { useEffect, useMemo, useRef, useState } from 'react';
import { isMediaZone, zoneName, ASPECT, type Orientation, type Zone } from '../lib/layout';

export interface PreviewItem {
  id: string;
  zoneId: string | null;
  kind: 'video' | 'image';
  url: string | null;
  /** thoi luong (giay); video that tu chuyen khi ket thuc, anh dung gia tri nay (mac dinh 10) */
  duration_s?: number | null;
  name?: string | null;
}

const CSS = `
.lp-frame{position:relative;background:#000;overflow:hidden;border-radius:10px;margin:0 auto;box-shadow:0 0 0 1px rgba(0,0,0,.2)}
.lp-zone{position:absolute;overflow:hidden;color:#fff}
.lp-fill{width:100%;height:100%;object-fit:contain;background:#000;display:block}
.lp-ph{width:100%;height:100%;display:flex;align-items:center;justify-content:center;text-align:center;font-size:11px;padding:4px;background:#1f2937;color:#d1d5db}
.lp-fx-fade{animation:lp-fade .6s both}.lp-fx-slide-left{animation:lp-sl .6s both}.lp-fx-slide-right{animation:lp-sr .6s both}.lp-fx-zoom{animation:lp-zoom .6s both}
@keyframes lp-fade{from{opacity:0}to{opacity:1}}@keyframes lp-sl{from{transform:translateX(100%)}to{transform:none}}
@keyframes lp-sr{from{transform:translateX(-100%)}to{transform:none}}@keyframes lp-zoom{from{transform:scale(.7);opacity:0}to{transform:none;opacity:1}}
.lp-marq{display:inline-block;white-space:nowrap;padding-left:100%;animation:lp-marq var(--lp-dur,12s) linear infinite}
@keyframes lp-marq{from{transform:translateX(0)}to{transform:translateX(-100%)}}
.lp-paused *{animation-play-state:paused!important}
.lp-bar{position:absolute;left:0;right:0;padding:3px 8px;font-size:11px;background:rgba(0,0,0,.6);color:#fff;text-align:center;z-index:50;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
`;

function Clock({ z }: { z: Zone }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  return <div style={{ ...center, background: z.bg_color ?? '#111827', color: z.text_color ?? '#fff', fontSize: `${Math.max(10, (z.font_size ?? 24) * 0.6)}px` }}><b className="mono">{now.toLocaleTimeString('vi-VN')}</b></div>;
}
const center = { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center' } as const;

/** Mot vung video/anh: phat lan luot cac tep gan vao vung, lap vo han. Video that dung the <video>. */
function MediaZone({ z, items, playing, runKey }: { z: Zone; items: PreviewItem[]; playing: boolean; runKey: number }) {
  const [idx, setIdx] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => setIdx(0), [runKey]);
  const cur = items.length ? items[idx % items.length]! : null;
  const next = () => setIdx((i) => (i + 1) % Math.max(1, items.length));
  useEffect(() => {
    if (!cur || !playing) return;
    if (cur.kind === 'video' && cur.url) return; // chuyen khi video ket thuc (onEnded)
    if (items.length <= 1 && cur.kind === 'image') return; // mot anh: giu nguyen
    const t = setTimeout(next, Math.max(2, cur.duration_s ?? 10) * 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur?.id, idx, playing, items.length]);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (playing) void v.play?.()?.catch?.(() => undefined);
    else v.pause?.();
  }, [playing, cur?.id]);
  if (!cur) return <div className="lp-ph">{zoneName(z)}: chưa có tệp</div>;
  const fx = z.transition && z.transition !== 'none' ? `lp-fx-${z.transition}` : '';
  if (!cur.url) return <div key={`${cur.id}:${idx}`} className={`lp-ph ${fx}`}>{cur.name ?? cur.id}<br />(chưa có bản xem trước)</div>;
  if (cur.kind === 'image') return <img key={`${cur.id}:${idx}`} className={`lp-fill ${fx}`} src={cur.url} alt={cur.name ?? 'Ảnh'} />;
  return <video key={`${cur.id}:${idx}`} ref={video} className={`lp-fill ${fx}`} src={cur.url} muted playsInline autoPlay={playing} loop={items.length <= 1} onEnded={next} aria-label={cur.name ?? 'Video'} />;
}

function ZoneView({ z, items, playing, runKey }: { z: Zone; items: PreviewItem[]; playing: boolean; runKey: number }) {
  if (isMediaZone(z)) return <MediaZone z={z} items={items} playing={playing} runKey={runKey} />;
  if (z.type === 'marquee') {
    const dur = Math.max(4, Math.round(28 - (z.scroll_speed ?? 60) * 0.22));
    return <div style={{ ...center, justifyContent: 'flex-start', background: z.bg_color ?? '#DC2626', color: z.text_color ?? '#fff', fontSize: `${Math.max(9, (z.font_size ?? 16) * 0.7)}px`, overflow: 'hidden' }}><span className="lp-marq" style={{ ['--lp-dur' as string]: `${dur}s` }}>{z.text ?? ''}</span></div>;
  }
  if (z.type === 'text') return <div style={{ ...center, background: z.bg_color ?? '#111827', color: z.text_color ?? '#fff', fontSize: `${Math.max(9, (z.font_size ?? 24) * 0.6)}px`, padding: 6, overflow: 'hidden', whiteSpace: 'pre-wrap' }}>{z.text ?? ''}</div>;
  if (z.type === 'clock') return <Clock z={z} />;
  if (z.type === 'weather') return <div style={{ ...center, background: z.bg_color ?? '#1D4ED8', color: z.text_color ?? '#fff', fontSize: 12 }}>☀ 29°C · Hà Nội</div>;
  return <div style={{ ...center, background: '#fff', color: '#111' }}><svg viewBox="0 0 8 8" width="70%" height="70%" shapeRendering="crispEdges" aria-label="Mã QR"><rect width="8" height="8" fill="#fff" />{[0, 1, 2, 5, 6, 7].flatMap((x) => [0, 1, 2, 5, 6, 7].map((y) => ((x < 3 && y < 3) || (x > 4 && y < 3) || (x < 3 && y > 4) ? <rect key={`${x}${y}`} x={x} y={y} width="1" height="1" fill="#000" /> : null)))}<rect x="3" y="3" width="2" height="2" fill="#000" /></svg></div>;
}

/** Trinh phat mo phong: dung bo cuc da vung, phat that video/anh cua tung vung, chu chay, dong ho, header/footer. Xem truoc truoc khi gui xuong thiet bi. */
export function LivePreview({ orientation: o0, zones, items, header, footer, maxHeight = 460 }: { orientation: Orientation; zones: Zone[]; items: PreviewItem[]; header?: string | null; footer?: string | null; maxHeight?: number }) {
  const [orientation, setOrientation] = useState<Orientation>(o0);
  const [playing, setPlaying] = useState(true);
  const [runKey, setRunKey] = useState(0);
  useEffect(() => setOrientation(o0), [o0]);
  const firstMedia = zones.find(isMediaZone)?.id;
  const byZone = useMemo(() => {
    const ids = new Set(zones.filter(isMediaZone).map((z) => z.id));
    const m = new Map<string, PreviewItem[]>();
    for (const it of items) {
      const zid = it.zoneId && ids.has(it.zoneId) ? it.zoneId : firstMedia;
      if (zid) m.set(zid, [...(m.get(zid) ?? []), it]);
    }
    return m;
  }, [items, zones, firstMedia]);
  const sorted = [...zones].sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
  const aspect = ASPECT[orientation];
  const width = orientation === 'portrait' ? `min(100%, ${Math.round((maxHeight * 9) / 16)}px)` : `min(100%, ${Math.round((maxHeight * 16) / 9)}px)`;
  return (
    <div data-testid="live-preview">
      <style>{CSS}</style>
      <div className={`lp-frame${playing ? '' : ' lp-paused'}`} style={{ aspectRatio: aspect, width }} role="img" aria-label={`Xem trước ${orientation === 'portrait' ? '9:16' : '16:9'}`}>
        {header ? <div className="lp-bar" style={{ top: 0 }}>{header}</div> : null}
        {sorted.map((z) => (
          <div key={z.id} className="lp-zone" data-zone={z.id} style={{ left: `${z.x}%`, top: `${z.y}%`, width: `${z.w}%`, height: `${z.h}%`, zIndex: z.z ?? 0 }}>
            <ZoneView z={z} items={byZone.get(z.id) ?? []} playing={playing} runKey={runKey} />
          </div>
        ))}
        {footer ? <div className="lp-bar" style={{ bottom: 0 }}>{footer}</div> : null}
      </div>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn sm p" onClick={() => setPlaying((p) => !p)}>{playing ? 'Tạm dừng' : 'Phát'}</button>
        <button type="button" className="btn sm" onClick={() => { setRunKey((k) => k + 1); setPlaying(true); }}>Phát lại từ đầu</button>
        <button type="button" className="btn sm" aria-pressed={orientation === 'landscape'} onClick={() => setOrientation('landscape')}>16:9</button>
        <button type="button" className="btn sm" aria-pressed={orientation === 'portrait'} onClick={() => setOrientation('portrait')}>9:16</button>
      </div>
    </div>
  );
}
