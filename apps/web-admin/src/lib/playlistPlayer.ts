// Bo may phat danh sach (thuan, khong phu thuoc React/DOM) dung chung cho xem truoc va canvas.
// - Phat tuan tu; loop = quay lai dau; khong loop = dung o cuoi ('finished').
// - Anh/Text: het `duration` (mac dinh 8s) thi chuyen. Video: chuyen khi ended(); neu nguoi dung dat duration thi cat sau do.
// - Loi 1 muc (error()) -> bo qua muc do + ghi log. Tat ca muc loi lien tiep -> man hinh cho `waitMs` (8s) roi thu lai ca danh sach (khong lap vo han sat nhau).
// - isPreview = true: KHONG gui luot hien thi (impression).
export const DEFAULT_ITEM_S = 8;
export const WAIT_RETRY_MS = 8000;

export interface PlayerItem { id: string; type: 'video' | 'image' | 'text'; duration?: number | null; name?: string }
export type PlayerPhase = 'idle' | 'playing' | 'waiting' | 'finished';
export interface PlayerState {
  phase: PlayerPhase;
  /** chi so muc dang phat (khi waiting: muc loi cuoi) */
  index: number;
  /** tang moi lan bat dau mot muc (de UI khoi dong lai video khi phat lai cung muc) */
  seq: number;
}
export interface PlayerOptions {
  items: PlayerItem[];
  loop: boolean;
  isPreview?: boolean;
  defaultDurationS?: number;
  waitMs?: number;
  onState?: (s: PlayerState) => void;
  /** chi goi khi KHONG phai xem truoc */
  onImpression?: (item: PlayerItem, index: number) => void;
  onLog?: (msg: string, detail?: unknown) => void;
}
export interface PlaylistPlayer {
  start(): void;
  stop(): void;
  pause(): void;
  resume(): void;
  /** video phat xong */
  ended(): void;
  /** muc dang phat da san sang (anh tai xong / video co du lieu): xoa dem loi */
  ready(): void;
  /** muc `index` (mac dinh muc hien tai) loi: bo qua; loi o muc khac muc dang phat bi bo qua */
  error(reason?: string, index?: number): void;
  getState(): PlayerState;
}

export function createPlaylistPlayer(opts: PlayerOptions): PlaylistPlayer {
  const { items, loop } = opts;
  const defS = opts.defaultDurationS ?? DEFAULT_ITEM_S;
  const waitMs = opts.waitMs ?? WAIT_RETRY_MS;
  const log = opts.onLog ?? ((m: string, d?: unknown) => console.warn(`[playlist] ${m}`, d ?? ''));
  let st: PlayerState = { phase: 'idle', index: 0, seq: 0 };
  let timer: ReturnType<typeof setTimeout> | null = null;
  let timerAt = 0;
  let timerLeft = 0;
  let paused = false;
  let fails = 0;
  const set = (p: Partial<PlayerState>) => { st = { ...st, ...p }; opts.onState?.(st); };
  const clear = () => { if (timer) clearTimeout(timer); timer = null; };
  const arm = (ms: number, fn: () => void) => {
    clear();
    timerLeft = ms; timerAt = Date.now();
    if (paused) return;
    timer = setTimeout(() => { timer = null; fn(); }, ms);
  };
  const itemMs = (it: PlayerItem): number | null => {
    const d = it.duration && it.duration > 0 ? it.duration : null;
    if (it.type === 'video') return d ? d * 1000 : null;
    return (d ?? defS) * 1000;
  };
  let pendingFn: (() => void) | null = null;
  const armKeep = (ms: number, fn: () => void) => { pendingFn = fn; arm(ms, fn); };

  const wait = () => {
    clear();
    log(`Tất cả ${items.length} mục đều lỗi, chờ ${Math.round(waitMs / 1000)}s rồi thử lại cả danh sách.`);
    set({ phase: 'waiting' });
    armKeep(waitMs, () => { fails = 0; play(0); });
  };
  const next = () => {
    const n = st.index + 1;
    if (n < items.length) return play(n);
    if (loop) return play(0);
    clear();
    set({ phase: 'finished' });
  };
  const play = (i: number) => {
    clear(); pendingFn = null;
    const it = items[i];
    if (!it) { set({ phase: 'idle', index: 0 }); return; }
    set({ phase: 'playing', index: i, seq: st.seq + 1 });
    if (!opts.isPreview) opts.onImpression?.(it, i);
    if (it.type === 'text') fails = 0;
    const ms = itemMs(it);
    if (ms != null) armKeep(ms, next);
  };

  return {
    start() { paused = false; fails = 0; if (items.length === 0) { set({ phase: 'idle', index: 0 }); return; } play(0); },
    stop() { clear(); pendingFn = null; set({ phase: 'idle' }); },
    pause() { if (paused) return; paused = true; if (timer) { timerLeft = Math.max(0, timerLeft - (Date.now() - timerAt)); clear(); } },
    resume() { if (!paused) return; paused = false; if (pendingFn && st.phase !== 'finished' && st.phase !== 'idle') arm(timerLeft, pendingFn); },
    ended() { if (st.phase === 'playing' && items[st.index]?.type === 'video') next(); },
    ready() { if (st.phase === 'playing') fails = 0; },
    error(reason, index) {
      if (st.phase !== 'playing') return;
      if (index != null && index !== st.index) return;
      const it = items[st.index];
      log(`Lỗi phát "${it?.name ?? it?.id}": ${reason ?? 'không tải được'} → bỏ qua.`, it);
      fails++;
      if (fails >= items.length) return wait();
      next();
    },
    getState: () => st,
  };
}
