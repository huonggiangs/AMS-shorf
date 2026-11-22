import { useState } from 'react';
import { api, errMsg } from '../api/client';
import { useAct } from '../api/hooks';
import { Dialog } from './Dialog';
import { Note } from './ui';

/** Số thiết bị tối đa mỗi lần gọi (khớp máy chủ). */
export const DEVICE_DELETE_BATCH = 200;
interface Res { deleted: number; requested: number; skipped: string[] }

/**
 * Xác nhận xóa thiết bị (một hoặc nhiều). Liệt kê tên thiết bị; xóa là "xóa mềm": thiết bị bị thu hồi khóa, ngừng phục vụ và phải ghép lại,
 * lịch sử lượt xem / doanh thu được giữ nguyên.
 */
export function DeleteDevicesDialog({ items, onClose, onDone }: { items: { id: string; name: string }[]; onClose: () => void; onDone: (deletedIds: string[]) => void }) {
  const act = useAct();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async () => {
    setBusy(true); setErr('');
    try {
      let deleted = 0, skipped = 0;
      const ids = items.map((i) => i.id);
      for (let i = 0; i < ids.length; i += DEVICE_DELETE_BATCH) {
        const chunk = ids.slice(i, i + DEVICE_DELETE_BATCH);
        const r = (await act(() => (chunk.length === 1 ? api.del(`/admin/v1/devices/${chunk[0]}`) : api.post('/admin/v1/devices/bulk-delete', { body: { ids: chunk } })) as Promise<Res>)) as Res | undefined;
        if (!r) throw new Error('Xóa thiết bị không thành công.');
        deleted += r.deleted; skipped += r.skipped.length;
      }
      await act(async () => undefined, `Đã xóa ${deleted} thiết bị${skipped ? ` (bỏ qua ${skipped})` : ''}.`);
      onDone(ids);
      onClose();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const shown = items.slice(0, 15);
  return (
    <Dialog open onClose={onClose} size="md" label="Xóa thiết bị">
      <h2 style={{ margin: '0 0 10px', fontSize: 18 }}>Xóa {items.length} thiết bị?</h2>
      <Note warn>Thiết bị sẽ bị thu hồi khóa và ngừng nhận nội dung ngay (TV hiện yêu cầu ghép lại), bị gỡ khỏi màn hình và chương trình phát. Lịch sử lượt xem, doanh thu và nhật ký được giữ nguyên.</Note>
      <ul aria-label="Thiết bị sẽ xóa" style={{ margin: '10px 0', paddingLeft: 18, maxHeight: 220, overflow: 'auto' }}>
        {shown.map((d) => <li key={d.id}>{d.name}</li>)}
        {items.length > shown.length ? <li>… và {items.length - shown.length} thiết bị khác</li> : null}
      </ul>
      {err ? <p role="alert" style={{ color: 'var(--bad)' }}>{err}</p> : null}
      <div className="da" style={{ marginTop: 14 }}>
        <button type="button" className="btn" onClick={onClose} disabled={busy}>Hủy</button>
        <button type="button" className="btn d" onClick={() => void submit()} disabled={busy}>{busy ? 'Đang xóa…' : `Xóa ${items.length} thiết bị`}</button>
      </div>
    </Dialog>
  );
}
