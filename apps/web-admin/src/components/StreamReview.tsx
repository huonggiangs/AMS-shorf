// Xem trước + thông tin kiểm tra cho creative "dán link" (stream). Người duyệt PHẢI xem toàn bộ video rồi tick xác nhận (nội dung xa không thể quét mã độc/đóng băng).
import { useEffect, useRef, useState } from 'react';
import { Tag } from './ui';
import { fmtDateTime } from '../lib/format';
import type { StreamInfo } from '../api/schemas';

/** hls.js nạp từ cdnjs (chỉ khi trình duyệt không phát HLS gốc: Chrome/Firefox/Edge; Safari phát gốc). Phiên bản cố định. */
export const HLS_JS_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.13/hls.min.js';
type HlsCtor = { new (): { loadSource(u: string): void; attachMedia(v: HTMLVideoElement): void; destroy(): void }; isSupported(): boolean };
let hlsLoading: Promise<HlsCtor | null> | null = null;
export function loadHls(): Promise<HlsCtor | null> {
  const w = window as unknown as { Hls?: HlsCtor };
  if (w.Hls) return Promise.resolve(w.Hls);
  hlsLoading ??= new Promise((res) => {
    const s = document.createElement('script');
    s.src = HLS_JS_SRC;
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.onload = () => res(w.Hls ?? null);
    s.onerror = () => { hlsLoading = null; res(null); };
    document.head.appendChild(s);
  });
  return hlsLoading;
}

export const KIND_LABEL: Record<string, string> = { mp4: 'MP4 (tệp trực tiếp)', webm: 'WebM (tệp trực tiếp)', hls: 'HLS (.m3u8)', dash: 'DASH (.mpd)' };

export function StreamPlayer({ url, kind, label }: { url: string; kind: string; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    setMsg('');
    if (kind === 'hls' && !v.canPlayType('application/vnd.apple.mpegurl')) {
      let hls: { destroy(): void } | null = null;
      let gone = false;
      void loadHls().then((H) => {
        if (gone) return;
        if (!H || !H.isSupported()) return setMsg('Trình duyệt không xem trước được HLS. Mở liên kết bằng trình phát khác để xem toàn bộ video.');
        const h = new H();
        h.loadSource(url);
        h.attachMedia(v);
        hls = h;
      });
      return () => { gone = true; hls?.destroy(); };
    }
    if (kind === 'dash') setMsg('Trình duyệt không xem trước trực tiếp DASH (.mpd). Mở liên kết bằng trình phát DASH để xem toàn bộ video trước khi duyệt.');
    return undefined;
  }, [url, kind]);
  if (kind === 'dash') return <div className="ph" role="note">{msg}</div>;
  return (
    <>
      <video ref={ref} src={kind === 'hls' ? undefined : url} controls preload="metadata" aria-label={label} style={{ width: '100%', background: '#000' }} />
      {msg ? <p role="note" style={{ fontSize: 13, color: 'var(--mut)', margin: '6px 0 0' }}>{msg}</p> : null}
    </>
  );
}

export interface StreamView {
  stream_url: string;
  stream_host?: string;
  stream_kind: string;
  declared_duration_s: number;
  probe_status: string;
  needs_review: boolean;
  content_type?: string | null;
  content_length?: number | null;
  etag?: string | null;
  last_modified?: string | null;
  checked_at?: string | null;
  info?: StreamInfo | null;
  warnings?: { code?: string; message: string }[];
  reason?: string | null;
}

const PROBE: Record<string, [string, 'ok' | 'warn' | 'bad']> = { ok: ['Liên kết truy cập được', 'ok'], changed: ['Nội dung ở liên kết đã thay đổi', 'bad'], unreachable: ['Không truy cập được liên kết', 'bad'], http_error: ['Máy chủ trả lỗi HTTP', 'bad'] };
const sizeText = (b?: number | null) => (b == null ? null : b >= 1048576 ? `${(b / 1048576).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(b / 1024)).toLocaleString('vi-VN')} KB`);

/** Máy chủ (host), loại luồng, kết quả kiểm tra liên kết, thông tin tham khảo (codec/độ phân giải/fps - KHÔNG phải điều kiện từ chối) và cảnh báo. */
export function StreamInfoPanel({ s }: { s: StreamView }) {
  const [txt, tone] = PROBE[s.probe_status] ?? [s.probe_status, 'warn' as const];
  let host = s.stream_host ?? '';
  if (!host) { try { host = new URL(s.stream_url).hostname; } catch { host = ''; } }
  const i = s.info;
  const facts = [
    i?.width && i?.height ? `${i.width}×${i.height}${i.resolution_label ? ` (${i.resolution_label})` : ''}` : null,
    i?.codec,
    i?.fps ? `${i.fps} fps` : null,
    i?.duration_s ? `video dài ${i.duration_s} giây` : null,
    sizeText(s.content_length),
    s.content_type,
  ].filter(Boolean).join(' · ');
  return (
    <div aria-label="Thông tin liên kết video" style={{ fontSize: 13 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
        <Tag tone="info">{KIND_LABEL[s.stream_kind] ?? s.stream_kind}</Tag>
        <Tag tone={tone === 'ok' ? 'ok' : 'bad'}>{txt}</Tag>
        <Tag tone="warn">Không quét mã độc</Tag>
      </div>
      <div>Máy chủ phát: <b>{host || '—'}</b> · Thời lượng khai báo: <b>{s.declared_duration_s} giây</b></div>
      {facts ? <div style={{ color: 'var(--mut)' }}>{facts}</div> : null}
      {s.etag || s.last_modified ? <div style={{ color: 'var(--mut)' }}>{[s.etag ? `ETag ${s.etag}` : null, s.last_modified ? `Sửa lần cuối ${s.last_modified}` : null].filter(Boolean).join(' · ')}</div> : null}
      {s.checked_at ? <div style={{ color: 'var(--mut)' }}>Kiểm tra lần cuối: {fmtDateTime(s.checked_at)}</div> : null}
      {s.warnings?.length ? <ul aria-label="Cảnh báo về video" style={{ margin: '6px 0 0', paddingLeft: 18 }}>{s.warnings.map((w, k) => <li key={`${w.code ?? ''}${k}`}>{w.message}</li>)}</ul> : null}
    </div>
  );
}

/** Ô xác nhận bắt buộc trước khi duyệt creative dán link. */
export function FullViewConfirm({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 10, fontSize: 13 }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 3 }} />
      <span>Tôi đã xem toàn bộ nội dung video (nội dung từ liên kết không được quét mã độc và có thể bị bên lưu trữ thay đổi sau khi duyệt).</span>
    </label>
  );
}
