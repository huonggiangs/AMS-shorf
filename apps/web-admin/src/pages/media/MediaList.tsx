import type { ReactNode } from 'react';
import { StatusTag } from '../../components/ui';
import { Btn } from '../../components/ui';
import type { Media } from '../../api/schemas';
import { fmtDate } from '../../lib/format';
import { MediaThumb, typeLabel } from './MediaThumb';

export const fmtSize = (b: number | null | undefined): string => (b ? (b >= 1073741824 ? `${(b / 1073741824).toFixed(1)} GB` : b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`) : '—');
export const fmtDur = (s: number | null | undefined): string => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '—');

/** Dạng danh sách: thumbnail, tên, loại, thời lượng, dung lượng, trạng thái, chủ sở hữu, ngày tạo + Sửa/Xóa; chọn nhiều để xóa hàng loạt. */
export function MediaList({ items, selected, onToggle, onToggleAll, canEdit, canDelete, showOwner, onEdit, onDelete, extra, rowActions }: {
  items: Media[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (all: boolean) => void;
  canEdit: boolean;
  canDelete: boolean;
  showOwner: boolean;
  onEdit: (m: Media) => void;
  onDelete: (m: Media) => void;
  /** nội dung thêm dưới tên (vd. lý do chưa duyệt được + nút xử lý) */
  extra?: (m: Media) => ReactNode;
  /** nút thao tác sẵn có (Duyệt / Trả lại) */
  rowActions?: (m: Media) => ReactNode;
}) {
  const selectable = canDelete;
  const all = items.length > 0 && items.every((m) => selected.has(m.id));
  return (
    <div className="card" style={{ padding: 0 }}>
      <div className="tw">
        <table className="tbl mlist" aria-label="Danh sách media" style={{ width: '100%' }}>
          <thead>
            <tr>
              {selectable ? <th style={{ width: 36 }}><input type="checkbox" aria-label="Chọn tất cả trên trang" checked={all} onChange={(e) => onToggleAll(e.target.checked)} /></th> : null}
              <th>Xem trước</th><th>Tên</th><th>Loại</th><th>Thời lượng</th><th>Dung lượng</th><th>Trạng thái</th>{showOwner ? <th>Khách hàng</th> : null}<th>Ngày tạo</th><th style={{ textAlign: 'right' }}>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {items.map((m) => (
              <tr key={m.id} data-testid="media-row">
                {selectable ? <td><input type="checkbox" aria-label={`Chọn ${m.name}`} checked={selected.has(m.id)} onChange={() => onToggle(m.id)} /></td> : null}
                <td><MediaThumb m={m} /></td>
                <td style={{ minWidth: 150, maxWidth: 260 }}>
                  <b style={{ overflowWrap: 'anywhere' }}>{m.name}</b>
                  {m.tags.length ? <div style={{ color: 'var(--mut)', fontSize: 12.5 }}>{m.tags.map((t) => `#${t}`).join(' ')}</div> : null}
                  {m.reject_reason ? <div style={{ color: 'var(--bad)', fontSize: 12.5 }}>{m.reject_reason}</div> : null}
                  {extra?.(m)}
                </td>
                <td>{typeLabel(m)}{m.width && m.height ? <div style={{ color: 'var(--mut)', fontSize: 12.5 }}>{m.width}×{m.height}</div> : null}</td>
                <td>{fmtDur(m.duration_sec)}</td>
                <td>{fmtSize(m.size_bytes)}</td>
                <td><StatusTag status={m.status} /></td>
                {showOwner ? <td>{m.owner_name ?? '—'}</td> : null}
                <td>{fmtDate(m.created_at)}</td>
                <td style={{ textAlign: 'right', minWidth: 150 }}><div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                  {rowActions?.(m)}
                  {canEdit ? <Btn className="sm" icon="edit" aria-label={`Sửa ${m.name}`} title="Sửa" onClick={() => onEdit(m)} /> : null}
                  {canDelete ? <Btn className="sm" icon="trash" aria-label={`Xóa ${m.name}`} title="Xóa" onClick={() => onDelete(m)} /> : null}
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
