import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { listOf, noticeHistorySchema, noticeResultSchema } from '../api/schemas';
import { useAct } from '../api/hooks';
import { useAuth } from '../auth/AuthProvider';
import { Btn, EmptyBlock, Field, LoadingBlock, Note, PageHead } from '../components/ui';

const BASE = '/admin/v1/broadcast/notice';
const TARGETS = [
  { id: 'all', label: 'Tất cả thiết bị đã duyệt' },
  { id: 'elevator', label: 'Thang máy' },
  { id: 'tv', label: 'TV' },
  { id: 'led_p5', label: 'LED P5' },
];

/** Thông báo khẩn: chữ chạy hiện ngay trên các màn hình đã duyệt (qua lệnh `message`, thiết bị nhận ở lần đồng bộ kế tiếp). */
export default function EmergencyNotice() {
  const { can } = useAuth();
  const act = useAct();
  const canWrite = can('schedule', 'write');
  const [f, setF] = useState({ text: '', duration_s: '30', target: 'all', regions: '' });
  const hist = useQuery({ queryKey: [BASE], queryFn: () => api.get(BASE, { schema: listOf(noticeHistorySchema) }) });
  const send = async () => {
    const body = { text: f.text.trim(), duration_s: Number(f.duration_s), target: f.target, regions: f.regions.split(',').map((x) => x.trim()).filter(Boolean) };
    const r = await act(() => api.post(BASE, { body, schema: noticeResultSchema }), (x) => `Đã xếp thông báo cho ${x.queued}/${x.matched} thiết bị${x.skipped ? ` (${x.skipped} thiết bị đang đầy hàng đợi)` : ''}.`, ['/admin/v1/broadcast']);
    if (r) setF({ ...f, text: '' });
  };
  return (
    <>
      <PageHead eyebrow="Gửi ngay xuống màn hình" title="Thông báo khẩn" sub="Chữ chạy hiện tạm thời trên thiết bị đã duyệt. Thiết bị nhận ở lần đồng bộ kế tiếp (thường vài phút) và bỏ qua nếu quá 10 phút." />
      {canWrite ? (
        <form className="card cp" onSubmit={(e) => { e.preventDefault(); if (window.confirm(`Gửi thông báo này tới ${TARGETS.find((x) => x.id === f.target)?.label}${f.regions.trim() ? ` (khu vực ${f.regions})` : ''}?`)) void send(); }}>
          <Field label="Nội dung (tối đa 200 ký tự)"><textarea required maxLength={200} rows={3} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} /></Field>
          <Field label="Thời gian hiển thị (giây, 3–120)"><input type="number" min={3} max={120} value={f.duration_s} onChange={(e) => setF({ ...f, duration_s: e.target.value })} /></Field>
          <Field label="Gửi tới"><select value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })}>{TARGETS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></Field>
          <Field label="Khu vực" hint="Mã khu vực cách nhau bằng dấu phẩy (vd HN, HCM). Để trống = mọi khu vực."><input value={f.regions} onChange={(e) => setF({ ...f, regions: e.target.value })} /></Field>
          <Btn tone="p" type="submit" disabled={!f.text.trim()}>Gửi thông báo</Btn>
        </form>
      ) : null}
      <h3 style={{ margin: '18px 0 8px' }}>Đã gửi gần đây</h3>
      {hist.isLoading ? <LoadingBlock /> : !hist.data?.items.length ? <EmptyBlock>Chưa gửi thông báo nào.</EmptyBlock> : (
        <div className="card cp">
          <table className="tbl">
            <thead><tr><th>Lúc</th><th>Người gửi</th><th>Nội dung</th><th>Đích</th><th>Thiết bị</th></tr></thead>
            <tbody>
              {hist.data.items.map((h) => (
                <tr key={h.id}>
                  <td className="mono">{h.at.slice(0, 16).replace('T', ' ')}</td>
                  <td>{h.actor}</td>
                  <td>{h.text}</td>
                  <td>{TARGETS.find((x) => x.id === h.target)?.label ?? h.target}{h.regions?.length ? ` · ${h.regions.join(', ')}` : ''}</td>
                  <td className="mono">{h.queued ?? 0}/{h.matched ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Note>Thông báo chỉ gửi tới thiết bị đã được duyệt và không bị chặn. Màn hình cần dùng bản Signage Player/ứng dụng hỗ trợ lệnh “message”.</Note>
    </>
  );
}
