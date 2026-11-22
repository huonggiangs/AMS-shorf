import { useState } from 'react';
import { API_BASE } from '../../api/client';
import { Icon } from '../../components/Icon';
import { resolveThumbUrl } from '../../lib/thumbnail';
import type { Media } from '../../api/schemas';

export const typeLabel = (m: Pick<Media, 'kind' | 'mime'>): string => (m.kind === 'link' ? 'Liên kết' : m.kind === 'image' || m.mime?.startsWith('image/') ? 'Ảnh' : 'Video');
const hostOf = (u: string | null | undefined): string => { try { return u ? new URL(u).hostname.replace(/^www\./, '') : ''; } catch { return ''; } };

/** Thumbnail trong danh sách: ảnh đại diện do máy chủ lưu (tải lười); chưa có / lỗi => ảnh giữ chỗ + nhãn loại (liên kết: tên miền). */
export function MediaThumb({ m }: { m: Media }) {
  const [bad, setBad] = useState(false);
  const src = bad ? null : resolveThumbUrl(m.thumb_url, API_BASE);
  const label = typeLabel(m);
  return (
    <div className="scr" data-testid="media-thumb" style={{ width: 96, flex: 'none', borderRadius: 8 }}>
      {src ? <img src={src} alt={`Ảnh xem trước ${m.name}`} loading="lazy" decoding="async" onError={() => setBad(true)} /> : (
        <div className="ph" aria-label={`${label}, chưa có ảnh xem trước`}>
          <span style={{ display: 'grid', justifyItems: 'center', gap: 4 }}><Icon n={m.kind === 'link' ? 'link' : m.kind === 'image' ? 'img' : 'film'} />{m.kind === 'link' ? <span style={{ fontSize: 10 }}>{hostOf(m.source_url)}</span> : null}</span>
        </div>
      )}
      <span style={{ position: 'absolute', left: 6, bottom: 6, fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 6, background: 'rgba(15,23,42,.72)', color: '#fff' }}>{label}</span>
    </div>
  );
}
