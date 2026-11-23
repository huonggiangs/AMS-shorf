import { useEffect, useMemo, useRef, useState } from 'react';
import { isMediaZone, zoneName, ASPECT, type Orientation, type Zone } from '../lib/layout';
import { qrImageSrc, type QrConfig } from '../lib/qr';
import { fetchWeather, getGps, resolveCoords, weatherInfo, type WeatherNow } from '../lib/weather';
import { RichView } from './RichText';

export interface PreviewItem {
  id: string;
  zoneId: string | null;
  kind: 'video' | 'image';
  url: string | null;
  /** thoi luong (giay); video that tu chuyen khi ket thuc, anh dung gia tri nay (mac dinh 10) */
  duration_s?: number | null;
  name?: string | null;
  /** ly do chua xem truoc duoc (vd nguon YouTube/Drive chua tai ve kho) */
  note?: string | null;
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
.lp-err{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:8px;text-align:center;background:rgba(17,24,39,.92);color:#fecaca;font-size:11px;z-index:5}
.lp-err button{font-size:11px;padding:2px 8px}
.lp-tools{display:flex;gap:6px;justify-content:center;margin-top:8px;flex-wrap:wrap;align-items:center}
.lp-seek{width:min(100%,360px);margin:6px auto 0;display:flex;gap:6px;align-items:center;font-size:11px}.lp-seek input{flex:1}
.lp-bar{position:absolute;left:0;right:0;padding:3px 8px;font-size:11px;background:rgba(0,0,0,.6);color:#fff;text-align:center;z-index:50;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
`;

function Clock({ z }: { z: Zone }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  return <div style={{ ...center, background: z.bg_color ?? '#111827', color: z.text_color ?? '#fff', fontSize: `${Math.max(10, (z.font_size ?? 24) * 0.6)}px` }}><b className="mono">{now.toLocaleTimeString('vi-VN')}</b></div>;
}
const center = { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center' } as const;

/** Dieu khien phat chung cho cac vung video (tua, bat tieng) */
interface Ctl { muted: boolean; onTime?: (t: number, d: number) => void; registerSeek?: (fn: ((t: number) => void) | null) => void; onRetry?: (id: string) => void }

/** Mot vung video/anh: phat lan luot cac tep gan vao vung, lap vo han. Video that dung the <video>; loi hien ro thay vi khung den. */
function MediaZone({ z, items, playing, runKey, ctl, primary }: { z: Zone; items: PreviewItem[]; playing: boolean; runKey: number; ctl: Ctl; primary: boolean }) {
  const [idx, setIdx] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const retried = useRef<Set<string>>(new Set());
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => { setIdx(0); setErr(null); retried.current.clear(); }, [runKey]);
  const cur = items.length ? items[idx % items.length]! : null;
  const next = () => { setErr(null); setIdx((i) => (i + 1) % Math.max(1, items.length)); };
  useEffect(() => {
    if (!cur || !playing) return;
    if (cur.kind === 'video' && cur.url && !err) return; // chuyen khi video ket thuc (onEnded)
    if (items.length <= 1 && cur.kind === 'image') return; // mot anh: giu nguyen
    const wait = err ? 3000 : Math.max(2, cur.duration_s ?? 10) * 1000;
    if (err && items.length <= 1) return; // loi + chi mot tep: giu thong bao loi
    const t = setTimeout(next, wait);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur?.id, idx, playing, items.length, err]);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    v.muted = ctl.muted;
    if (playing) void v.play?.()?.catch?.(() => undefined);
    else v.pause?.();
  }, [playing, cur?.id, ctl.muted, err]);
  useEffect(() => {
    if (!primary || !ctl.registerSeek) return;
    ctl.registerSeek((t) => { const v = video.current; if (v && Number.isFinite(v.duration)) v.currentTime = Math.max(0, Math.min(v.duration, t)); });
    return () => ctl.registerSeek?.(null);
  }, [primary, cur?.id]);
  if (!cur) return <div className="lp-ph">{zoneName(z)}: chưa có tệp</div>;
  const fx = z.transition && z.transition !== 'none' ? `lp-fx-${z.transition}` : '';
  if (!cur.url) return <div key={`${cur.id}:${idx}`} className={`lp-ph ${fx}`}>{cur.name ?? cur.id}<br />{cur.note ?? '(chưa có bản xem trước)'}</div>;
  if (cur.kind === 'image') return <img key={`${cur.id}:${idx}`} className={`lp-fill ${fx}`} src={cur.url} alt={cur.name ?? 'Ảnh'} onError={() => setErr('Không tải được ảnh (liên kết hết hạn hoặc tệp lỗi).')} />;
  const fail = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const code = e.currentTarget.error?.code;
    // URL ky het han (mac dinh 15 phut): xin URL moi mot lan truoc khi bao loi
    if (!retried.current.has(cur.id) && ctl.onRetry) { retried.current.add(cur.id); ctl.onRetry(cur.id); return; }
    setErr(code === 4 ? 'Trình duyệt không phát được định dạng/đường dẫn này (cần MP4 H.264).' : code === 2 ? 'Lỗi mạng khi tải video.' : code === 3 ? 'Video bị hỏng hoặc không giải mã được.' : 'Không tải được video.');
  };
  return (
    <>
      <video
        key={`${cur.id}:${idx}:${cur.url}`}
        ref={video}
        className={`lp-fill ${fx}`}
        src={cur.url}
        muted={ctl.muted}
        playsInline
        preload="auto"
        autoPlay={playing}
        loop={items.length <= 1}
        onLoadedData={() => setErr(null)}
        onTimeUpdate={(e) => { if (primary) ctl.onTime?.(e.currentTarget.currentTime, e.currentTarget.duration); }}
        onEnded={next}
        onError={fail}
        aria-label={cur.name ?? 'Video'}
      />
      {err ? <div className="lp-err" role="alert"><span>⚠ {cur.name ?? 'Video'}: {err}</span><button type="button" className="btn sm" onClick={() => { retried.current.delete(cur.id); setErr(null); ctl.onRetry?.(cur.id); }}>Tải lại</button></div> : null}
    </>
  );
}

/** Ma QR that: anh tai len, QR tao tai cho tu URL/van ban, hoac anh VietQR. */
function QrZone({ z }: { z: Zone }) {
  const [bad, setBad] = useState(false);
  const src = qrImageSrc((z.qr as QrConfig | null | undefined) ?? undefined, z.url);
  useEffect(() => setBad(false), [src]);
  if (!src) return <div style={{ ...center, background: '#fff', color: '#6b7280', fontSize: 11 }}>Chưa có mã QR</div>;
  if (bad) return <div style={{ ...center, background: '#fff', color: '#b91c1c', fontSize: 11, padding: 4 }}>Không tải được ảnh QR (kiểm tra mạng/ngân hàng/số tài khoản)</div>;
  return <div style={{ ...center, background: '#fff', padding: '4%' }}><img src={src} alt="Mã QR" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} onError={() => setBad(true)} /></div>;
}

/** Thoi tiet that tu Open-Meteo, tu lam moi 10 phut; gps = vi tri trinh duyet (neu khong lay duoc thi dung toa do da chon). */
function WeatherZone({ z }: { z: Zone }) {
  const cfg = (z.weather as { mode: 'gps' | 'fixed'; lat?: number; lon?: number; label?: string } | null | undefined) ?? undefined;
  const [gps, setGps] = useState<{ lat: number; lon: number } | null>(null);
  const [data, setData] = useState<WeatherNow | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (cfg?.mode !== 'gps') { setGps(null); return; }
    let live = true;
    getGps().then((p) => live && setGps(p)).catch(() => undefined);
    return () => { live = false; };
  }, [cfg?.mode]);
  const where = resolveCoords(cfg, gps);
  useEffect(() => {
    const ac = new AbortController();
    const load = () => fetchWeather(where.lat, where.lon, ac.signal).then((d) => { setData(d); setErr(''); }).catch((e: Error) => { if (e.name !== 'AbortError') setErr('Không lấy được thời tiết'); });
    void load();
    const t = setInterval(load, 10 * 60_000);
    return () => { clearInterval(t); ac.abort(); };
  }, [where.lat, where.lon]);
  const info = data ? weatherInfo(data.code) : null;
  return (
    <div data-testid="weather-zone" style={{ ...center, flexDirection: 'column', gap: 2, background: z.bg_color ?? '#1D4ED8', color: z.text_color ?? '#fff', fontSize: 12, padding: 4 }}>
      {data && info ? (
        <>
          <div style={{ fontSize: 22, lineHeight: 1 }}>{info.icon} <b>{Math.round(data.temp)}°C</b></div>
          <div>{info.text} · {where.label}</div>
          <div style={{ opacity: 0.85, fontSize: 10 }}>Ẩm {Math.round(data.humidity)}% · Gió {Math.round(data.wind)} km/h</div>
        </>
      ) : <div>{err || 'Đang lấy thời tiết…'}<br /><small>{where.label}</small></div>}
    </div>
  );
}

function ZoneView({ z, items, playing, runKey, ctl, primary }: { z: Zone; items: PreviewItem[]; playing: boolean; runKey: number; ctl: Ctl; primary: boolean }) {
  if (isMediaZone(z)) return <MediaZone z={z} items={items} playing={playing} runKey={runKey} ctl={ctl} primary={primary} />;
  if (z.type === 'marquee') {
    const dur = Math.max(4, Math.round(28 - (z.scroll_speed ?? 60) * 0.22));
    return <div style={{ ...center, justifyContent: 'flex-start', background: z.bg_color ?? '#DC2626', color: z.text_color ?? '#fff', fontSize: `${Math.max(9, (z.font_size ?? 16) * 0.7)}px`, overflow: 'hidden' }}><span className="lp-marq" style={{ ['--lp-dur' as string]: `${dur}s` }}>{z.rich ? <RichView html={z.rich} line k={0.7} /> : z.text ?? ''}</span></div>;
  }
  if (z.type === 'text') return <div style={{ ...center, background: z.bg_color ?? '#111827', color: z.text_color ?? '#fff', fontSize: `${Math.max(9, (z.font_size ?? 24) * 0.6)}px`, padding: 6, overflow: 'hidden', whiteSpace: 'pre-wrap' }}>{z.rich ? <RichView html={z.rich} k={0.6} /> : z.text ?? ''}</div>;
  if (z.type === 'clock') return <Clock z={z} />;
  if (z.type === 'weather') return <WeatherZone z={z} />;
  return <QrZone z={z} />;
}

/** Trinh phat mo phong: dung bo cuc da vung, phat that video/anh cua tung vung, chu chay, dong ho, header/footer. Xem truoc truoc khi gui xuong thiet bi. */
export function LivePreview({ orientation: o0, zones, items, header, footer, maxHeight = 460, onRetry }: { orientation: Orientation; zones: Zone[]; items: PreviewItem[]; header?: string | null; footer?: string | null; maxHeight?: number; onRetry?: (id: string) => void }) {
  const [orientation, setOrientation] = useState<Orientation>(o0);
  const [muted, setMuted] = useState(true);
  const [prog, setProg] = useState<{ t: number; d: number } | null>(null);
  const seekFn = useRef<((t: number) => void) | null>(null);
  const ctl = useMemo<Ctl>(() => ({ muted, onRetry, onTime: (t, d) => setProg(Number.isFinite(d) && d > 0 ? { t, d } : null), registerSeek: (fn) => { seekFn.current = fn; } }), [muted, onRetry]);
  const [playing, setPlaying] = useState(true);
  const [runKey, setRunKey] = useState(0);
  useEffect(() => setOrientation(o0), [o0]);
  const firstMedia = zones.find(isMediaZone)?.id;
  const primaryId = zones.find((z) => z.type === 'video')?.id ?? firstMedia;
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
            <ZoneView z={z} items={byZone.get(z.id) ?? []} playing={playing} runKey={runKey} ctl={ctl} primary={z.id === primaryId} />
          </div>
        ))}
        {footer ? <div className="lp-bar" style={{ bottom: 0 }}>{footer}</div> : null}
      </div>
      {prog ? (
        <div className="lp-seek">
          <span className="mono">{fmt(prog.t)}</span>
          <input type="range" aria-label="Tua video" min={0} max={Math.floor(prog.d)} step={1} value={Math.floor(prog.t)} onChange={(e) => seekFn.current?.(Number(e.target.value))} />
          <span className="mono">{fmt(prog.d)}</span>
        </div>
      ) : null}
      <div className="lp-tools">
        <button type="button" className="btn sm p" onClick={() => setPlaying((p) => !p)}>{playing ? 'Tạm dừng' : 'Phát'}</button>
        <button type="button" className="btn sm" aria-pressed={!muted} onClick={() => setMuted((m) => !m)}>{muted ? '🔇 Bật tiếng' : '🔊 Tắt tiếng'}</button>
        <button type="button" className="btn sm" onClick={() => { setRunKey((k) => k + 1); setPlaying(true); }}>Phát lại từ đầu</button>
        <button type="button" className="btn sm" aria-pressed={orientation === 'landscape'} onClick={() => setOrientation('landscape')}>16:9</button>
        <button type="button" className="btn sm" aria-pressed={orientation === 'portrait'} onClick={() => setOrientation('portrait')}>9:16</button>
      </div>
    </div>
  );
}

const fmt = (n: number): string => `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}`;
