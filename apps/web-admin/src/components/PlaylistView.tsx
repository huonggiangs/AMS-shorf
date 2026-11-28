// Hien thi danh sach phat cua 1 vung bang bo may lib/playlistPlayer: video nap san (2 the <video> luan phien) de khong nhay den khi het video.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPlaylistPlayer, WAIT_RETRY_MS, type PlayerState, type PlaylistPlayer } from '../lib/playlistPlayer';
import type { PlaylistItemStyle } from '../lib/playlist';
import { RichView } from './RichText';

export interface ViewItem {
  id: string;
  type: 'video' | 'image' | 'text';
  name: string;
  url: string | null;
  note?: string | null;
  /** giay; video: chi khi nguoi dung dat de cat; anh/text: mac dinh 8 */
  duration?: number | null;
  mediaId?: string;
  text?: string;
  style?: PlaylistItemStyle;
}
export interface ViewCtl { muted: boolean; onTime?: (t: number, d: number) => void; registerSeek?: (fn: ((t: number) => void) | null) => void; onRetry?: (mediaId: string) => void }

const center = { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center' } as const;
const errMsg = (code?: number): string => (code === 4 ? 'định dạng/đường dẫn không phát được (cần MP4 H.264)' : code === 2 ? 'lỗi mạng khi tải' : code === 3 ? 'tệp hỏng hoặc không giải mã được' : 'không tải được');

function TextBody({ it }: { it: ViewItem }) {
  const s = it.style ?? {};
  return (
    <div data-testid="pl-text" style={{ ...center, background: s.bg_color ?? '#111827', color: s.text_color ?? '#fff', fontSize: `${Math.max(9, (s.font_size ?? 24) * 0.6)}px`, padding: 6, overflow: 'hidden', whiteSpace: 'pre-wrap' }}>
      {s.rich ? <RichView html={s.rich} k={0.6} /> : it.text ?? ''}
    </div>
  );
}

interface SlotProps {
  item: ViewItem | null;
  active: boolean;
  restart: number;
  playing: boolean;
  ctl: ViewCtl;
  primary: boolean;
  videoRef: (el: HTMLVideoElement | null) => void;
  onReady: () => void;
  onFail: (reason: string, active: boolean, item: ViewItem) => void;
}
function Slot({ item, active, restart, playing, ctl, primary, videoRef, onReady, onFail }: SlotProps) {
  const v = useRef<HTMLVideoElement | null>(null);
  const img = useRef<HTMLImageElement | null>(null);
  const setV = (el: HTMLVideoElement | null) => { v.current = el; videoRef(el); };
  useEffect(() => {
    const el = v.current;
    if (!el) return;
    el.muted = ctl.muted;
    if (active && playing) void el.play?.()?.catch?.(() => undefined);
    else el.pause?.();
  }, [active, playing, ctl.muted, item?.url, restart]);
  useEffect(() => {
    const el = v.current;
    if (active && el && restart) { try { el.currentTime = 0; } catch { /* chua co du lieu */ } }
  }, [active, restart]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!active || !item) return;
    if (item.type === 'video' && v.current && v.current.readyState >= 2) onReady();
    if (item.type === 'image' && img.current?.complete && img.current.naturalWidth > 0) onReady();
  }, [active, restart, item?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!item) return null;
  if (item.type === 'text') return <TextBody it={item} />;
  if (!item.url) return <div className="lp-ph">{item.name}<br />{item.note ?? '(chưa có bản xem trước)'}</div>;
  if (item.type === 'image') return <img ref={img} className="lp-fill" src={item.url} alt={item.name} onLoad={() => active && onReady()} onError={() => onFail('không tải được ảnh (liên kết hết hạn hoặc tệp lỗi)', active, item)} />;
  return (
    <video
      ref={setV}
      className="lp-fill"
      src={item.url}
      muted={ctl.muted}
      playsInline
      preload="auto"
      onLoadedData={() => active && onReady()}
      onTimeUpdate={(e) => { if (active && primary) ctl.onTime?.(e.currentTarget.currentTime, e.currentTarget.duration); }}
      onEnded={() => active && onFail('', true, item)}
      onError={(e) => onFail(errMsg(e.currentTarget.error?.code), active, item)}
      aria-label={item.name}
    />
  );
}

/** onFail voi reason rong + video ended duoc xu ly rieng (ended). */
export function PlaylistView({ items, loop, playing, runKey, ctl, primary, transition, isPreview = true, waitMs = WAIT_RETRY_MS }: { items: ViewItem[]; loop: boolean; playing: boolean; runKey: number; ctl: ViewCtl; primary: boolean; transition?: string | null; isPreview?: boolean; waitMs?: number }) {
  const [st, setSt] = useState<PlayerState>({ phase: 'idle', index: 0, seq: 0 });
  const player = useRef<PlaylistPlayer | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const bad = useRef<Set<string>>(new Set());
  const retried = useRef<Set<string>>(new Set());
  const vids = useRef<(HTMLVideoElement | null)[]>([null, null]);
  const key = `${loop}|${items.map((i) => `${i.id}:${i.type}:${i.duration ?? ''}`).join(',')}|${runKey}`;
  const playingRef = useRef(playing);
  playingRef.current = playing;

  useEffect(() => {
    bad.current.clear(); retried.current.clear();
    const p = createPlaylistPlayer({
      items: itemsRef.current.map((i) => ({ id: i.id, type: i.type, duration: i.duration, name: i.name })),
      loop, isPreview, waitMs, onState: setSt,
      onLog: (m, d) => console.warn(`[playlist] ${m}`, d ?? ''),
    });
    player.current = p;
    if (!playingRef.current) p.pause();
    p.start();
    return () => { p.stop(); player.current = null; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (playing) player.current?.resume(); else player.current?.pause(); }, [playing]);

  const n = items.length;
  const single = n <= 1;
  const cur = st.phase === 'playing' || st.phase === 'finished' ? st.index : -1;
  const nextIdx = !single && cur >= 0 && (loop || cur + 1 < n) ? (cur + 1) % n : -1;
  const curSlot = single ? 0 : st.seq % 2;
  const slotIdx = [-1, -1];
  if (cur >= 0) { slotIdx[curSlot] = cur; if (nextIdx >= 0) slotIdx[1 - curSlot] = nextIdx; }
  const curItem = cur >= 0 ? items[cur] ?? null : null;

  // muc dang phat chua co nguon / da loi luc nap san -> bo qua
  useEffect(() => {
    if (!curItem || st.phase !== 'playing') return;
    if (curItem.type !== 'text' && !curItem.url) player.current?.error(curItem.note ?? 'chưa có bản xem trước', st.index);
    else if (bad.current.has(curItem.id)) player.current?.error('đã lỗi khi nạp sẵn', st.index);
  }, [st.seq, st.phase]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!primary || !ctl.registerSeek) return;
    ctl.registerSeek((t) => { const v = vids.current[curSlot]; if (v && Number.isFinite(v.duration)) v.currentTime = Math.max(0, Math.min(v.duration, t)); });
    return () => ctl.registerSeek?.(null);
  }, [primary, curSlot, st.seq]); // eslint-disable-line react-hooks/exhaustive-deps

  const onFail = (reason: string, active: boolean, it: ViewItem) => {
    if (!reason) { player.current?.ended(); return; } // video phat xong
    if (!active) { bad.current.add(it.id); return; }
    if (it.mediaId && !retried.current.has(it.id) && ctl.onRetry) { retried.current.add(it.id); ctl.onRetry(it.mediaId); return; } // URL ky het han: xin URL moi 1 lan
    player.current?.error(reason, st.index);
  };

  const fxCls = transition && transition !== 'none' ? `lp-fx-${transition}` : '';
  const stat = useMemo(() => items.length, [items.length]);
  if (stat === 0) return <div className="lp-ph" data-testid="pl-empty">Danh sách phát trống</div>;
  return (
    <div className="lp-pl" data-testid="pl-view" data-phase={st.phase} data-index={st.index}>
      {[0, 1].map((s) => {
        const idx = slotIdx[s]!;
        const it = idx >= 0 ? items[idx] ?? null : null;
        const active = idx >= 0 && idx === cur && s === curSlot && st.phase !== 'waiting';
        return (
          <div key={s} className={`lp-slot ${fxCls}${active ? '' : ' off'}`} data-slot={s} data-active={active ? '1' : '0'} aria-hidden={!active}>
            <Slot item={it} active={active} restart={active ? st.seq : 0} playing={playing} ctl={ctl} primary={primary} videoRef={(el) => { vids.current[s] = el; }} onReady={() => player.current?.ready()} onFail={onFail} />
          </div>
        );
      })}
      {st.phase === 'waiting' ? (
        <div className="lp-err" role="status" data-testid="pl-wait"><span>⚠ Không phát được mục nào trong danh sách. Thử lại sau {Math.round(waitMs / 1000)} giây…</span>
          {items.slice(0, 4).map((i) => <small key={i.id}>{i.name}: {i.note ?? (i.url || i.type === 'text' ? 'không tải được' : '(chưa có bản xem trước)')}</small>)}</div>
      ) : null}
    </div>
  );
}
