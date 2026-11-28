import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { broadcastSchema, listOf, type Broadcast } from '../api/schemas';
import { useAct } from '../api/hooks';
import { useAuth } from '../auth/AuthProvider';
import { Btn, EmptyBlock, ErrorBlock, LoadingBlock, Note, PageHead, Tag } from '../components/ui';
import { Dialog } from '../components/Dialog';
import { useT } from '../i18n';
import { fmtMin } from '../lib/format';
import { usbPackageSchema } from '../api/schemas';
import { copyToUsb, usbSupported } from '../lib/usbExport';
import { ProgramPreviewDialog } from '../components/PreviewDialogs';
import { BroadcastWizard } from '../components/BroadcastWizard';

const TARGETS: { id: string; label: string }[] = [
  { id: 'elevator', label: 'Thang máy (9:16)' },
  { id: 'tv', label: 'TV (16:9)' },
  { id: 'led_p5', label: 'LED P5' },
];
const STATUS: Record<string, { label: string; tone: 'ok' | 'warn' | 'info' | 'bad' }> = {
  draft: { label: 'Bản nháp', tone: 'warn' },
  published: { label: 'Đang phát', tone: 'ok' },
  ended: { label: 'Đã kết thúc', tone: 'info' },
};
const BASE = '/admin/v1/broadcast';

/** Chương trình phát sóng nội bộ: chọn media trong kho + loại màn + khu vực + khung giờ, xuất bản là thiết bị đã duyệt nhận được (không qua hợp đồng/thanh toán). */
export default function Broadcast() {
  const t = useT();
  const { can } = useAuth();
  const act = useAct();
  const [edit, setEdit] = useState<Broadcast | 'new' | null>(null);
  const [usb, setUsb] = useState<Broadcast | null>(null);
  const [view, setView] = useState<Broadcast | null>(null);
  const list = useQuery({ queryKey: [BASE], queryFn: () => api.get(BASE, { query: { page_size: 100 }, schema: listOf(broadcastSchema) }) });
  const canWrite = can('schedule', 'write');
  const [sp, setSp] = useSearchParams();
  useEffect(() => {
    const pid = sp.get('program');
    if (sp.get('new') === '1' && canWrite) setEdit('new');
    else if (pid && list.data) {
      const found = list.data.items.find((x) => x.id === pid);
      if (found && canWrite) setEdit(found);
    } else return;
    setSp({}, { replace: true });
  }, [sp, list.data, canWrite, setSp]);
  const canDelete = can('schedule', 'delete');
  const run = (p: Broadcast, action: 'publish' | 'unpublish', ok: string) => act(() => api.post(`${BASE}/${p.id}/${action}`, { body: {}, schema: broadcastSchema }), (r: Broadcast) => `${ok} Đã gửi lệnh tới ${r.push?.pushed ?? 0} thiết bị.`);
  return (
    <>
      <PageHead eyebrow="Nội dung nội bộ / không qua hợp đồng" title="Chương trình phát sóng" sub="Chọn video, ảnh trong kho, chọn loại màn và khu vực rồi xuất bản: thiết bị đã duyệt sẽ tự nhận ở lần đồng bộ kế tiếp." actions={canWrite ? <Btn tone="p" icon="plus" onClick={() => setEdit('new')}>Tạo chương trình</Btn> : null} />
      {list.isLoading ? <LoadingBlock /> : list.isError ? <ErrorBlock error={list.error} onRetry={() => void list.refetch()} /> : !list.data?.items.length ? <EmptyBlock>Chưa có chương trình phát sóng nào.</EmptyBlock> : (
        <div className="card cp">
          <table className="tbl">
            <thead><tr><th>Tên</th><th>Loại màn</th><th>Thiết bị / khu vực</th><th>Hiệu lực</th><th>Khung giờ</th><th>Số tệp</th><th>Trạng thái</th><th /></tr></thead>
            <tbody>
              {list.data.items.map((p) => (
                <tr key={p.id}>
                  <td><b>{p.name}</b></td>
                  <td>{TARGETS.find((x) => x.id === p.target_type)?.label ?? p.target_type}</td>
                  <td className="mono">{p.device_count ? `${p.device_count} thiết bị` : p.regions.length ? p.regions.join(', ') : 'Tất cả'}</td>
                  <td className="mono">{p.start_date ?? '…'} → {p.end_date ?? '…'}</td>
                  <td className="mono">{fmtMin(p.start_min)}–{fmtMin(p.end_min)}</td>
                  <td className="mono">{p.item_count}</td>
                  <td><Tag tone={STATUS[p.status]?.tone ?? 'info'}>{STATUS[p.status]?.label ?? p.status}</Tag></td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    {p.item_count > 0 ? <button type="button" className="btn sm" onClick={() => void api.get(`${BASE}/${p.id}`, { schema: broadcastSchema }).then(setView)}>Xem trước</button> : null}{' '}
                    {p.item_count > 0 ? <button type="button" className="btn sm" onClick={() => setUsb(p)}>Chép ra USB</button> : null}{' '}
                    {canWrite ? <button type="button" className="btn sm" onClick={() => void api.get(`${BASE}/${p.id}`, { schema: broadcastSchema }).then(setEdit)}>Sửa</button> : null}{' '}
                    {canWrite && p.status !== 'published' ? <button type="button" className="btn sm p" onClick={() => void run(p, 'publish', 'Đã xuất bản. Thiết bị sẽ nhận trong ít phút.')}>Xuất bản</button> : null}
                    {canWrite && p.status === 'published' ? <button type="button" className="btn sm" onClick={() => void run(p, 'unpublish', 'Đã dừng phát.')}>Dừng phát</button> : null}{' '}
                    {canDelete ? <button type="button" className="btn sm d" onClick={() => { if (window.confirm(`Xóa chương trình "${p.name}"?`)) void act(() => api.del(`${BASE}/${p.id}`), 'Đã xóa.'); }}>Xóa</button> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Note>Chỉ chọn được tệp đã duyệt và chưa gắn vào chiến dịch quảng cáo. Chương trình nội bộ không tính tiền và không có báo cáo doanh thu.</Note>
      {edit ? <BroadcastWizard key={edit === 'new' ? 'new' : edit.id} program={edit === 'new' ? null : edit} onClose={() => setEdit(null)} /> : null}
      {view ? <ProgramPreviewDialog title={view.name} orientation={view.layout?.orientation ?? (view.target_type === 'tv' ? 'landscape' : 'portrait')} zones={view.layout?.zones ?? null} ids={view.items.map((i) => i.creative_id)} zoneOf={Object.fromEntries(view.items.map((i) => [i.creative_id, i.zone_id ?? null]))} header={view.header} footer={view.footer} onClose={() => setView(null)} /> : null}
      {usb ? <UsbDialog program={usb} onClose={() => setUsb(null)} /> : null}
      <span hidden>{t('Hủy')}</span>
    </>
  );
}

function UsbDialog({ program, onClose }: { program: Broadcast; onClose: () => void }) {
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const supported = usbSupported();
  const start = async () => {
    setBusy(true);
    setErr('');
    setLog([]);
    try {
      const pkg = await api.get(`${BASE}/${program.id}/usb-package`, { schema: usbPackageSchema });
      await copyToUsb(pkg, (m) => setLog((l) => [...l.slice(-40), m]));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Không chép được ra USB.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} size="lg" label="Chép ra USB">
      <h2 style={{ margin: '0 0 10px', fontSize: 18 }}>Chép “{program.name}” ra USB</h2>
      <p style={{ margin: '0 0 10px' }}>Tạo thư mục <b>ANIO</b> trên ổ USB gồm các tệp phát và <b>playlist.json</b>. Cắm USB vào thiết bị chạy D Play (nguồn phát USB) để phát không cần mạng.</p>
      {supported ? <Note>Bấm “Chọn ổ USB”, chọn ổ/thư mục gốc của USB rồi cho phép ghi. Trình duyệt Chrome/Edge trên máy tính.</Note> : <Note warn>Trình duyệt này không cho ghi thẳng ra USB. Bấm “Tải danh sách” để lấy playlist.json và danh sách liên kết, rồi chép tay vào thư mục ANIO.</Note>}
      {err ? <p role="alert" style={{ color: 'var(--bad, #c0392b)' }}>{err}</p> : null}
      {log.length ? <pre style={{ maxHeight: 200, overflow: 'auto', fontSize: 12 }}>{log.join('\n')}</pre> : null}
      <div className="da" style={{ marginTop: 14 }}>
        <button type="button" className="btn" onClick={onClose}>Đóng</button>
        <button type="button" className="btn p" disabled={busy} onClick={() => void start()}>{busy ? 'Đang chép…' : supported ? 'Chọn ổ USB' : 'Tải danh sách'}</button>
      </div>
    </Dialog>
  );
}
