import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { summarySchema } from '../api/schemasBp';
import { ErrorBlock, EmptyBlock, Kpi, LoadingBlock, Note, PageHead, StatusTag } from '../components/ui';
import { Btn } from '../components/ui';
import { useAuth } from '../auth/AuthProvider';
import { fmtDateTime } from '../lib/format';

const TARGET: Record<string, string> = { tv: 'TV', elevator: 'Thang máy', led: 'LED', led_p5: 'LED P5', all: 'Tất cả' };

/** Bàn làm việc phát sóng nội bộ: số liệu chương trình, tệp chờ duyệt, thiết bị theo khu vực, thông báo gần đây và lối tắt. */
export default function Workbench() {
  const nav = useNavigate();
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['/admin/v1/broadcast-insights/summary'], queryFn: () => api.get('/admin/v1/broadcast-insights/summary', { schema: summarySchema }), refetchInterval: 60_000 });
  const d = q.data;
  const w = can('schedule', 'write');
  return (
    <>
      <PageHead eyebrow="Phát sóng nội bộ" title="Bàn làm việc" sub="Tình hình chương trình phát sóng, kho tư liệu và mạng lưới thiết bị trong một màn hình."
        actions={w ? <><Btn tone="p" icon="plus" onClick={() => nav('/broadcast')}>Tạo chương trình</Btn><Btn icon="bell" onClick={() => nav('/notice')}>Gửi thông báo khẩn</Btn><Btn icon="img" onClick={() => nav('/media')}>Tải media</Btn></> : undefined} />
      {q.isLoading ? <LoadingBlock /> : q.isError ? <ErrorBlock error={q.error} onRetry={() => void q.refetch()} /> : d ? (
        <>
          <div className="g g4">
            <Kpi label="Chương trình đang phát" icon="ads" value={d.programs.live} foot={`${d.programs.published} đã xuất bản · ${d.programs.draft} nháp · ${d.programs.expired} hết hạn`} />
            <Kpi label="Tệp chờ duyệt" icon="eye" value={d.media.pending_review} foot={`${d.media.approved} tệp đã duyệt trong kho`} />
            <Kpi label="Thiết bị trực tuyến" icon="tv" value={d.devices.online} foot={`${d.devices.offline} ngoại tuyến${d.devices.awaiting_approval ? ` · ${d.devices.awaiting_approval} chờ cấp quyền` : ''}`} />
            <Kpi label="Lệnh đang chờ" icon="clock" value={d.queue.pending + d.queue.delivered} foot={`${d.queue.failed} lệnh lỗi`} />
          </div>
          <div className="g g21">
            <div className="card cp">
              <div className="ch"><div><h2>Chương trình gần đây</h2><p>Cập nhật mới nhất</p></div><Btn onClick={() => nav('/broadcast')}>Xem tất cả</Btn></div>
              {!d.programs.recent.length ? <EmptyBlock>Chưa có chương trình nào.</EmptyBlock> : (
                <table className="tbl">
                  <thead><tr><th>Tên</th><th>Loại màn</th><th>Tệp</th><th>Trạng thái</th></tr></thead>
                  <tbody>{d.programs.recent.map((p) => (
                    <tr key={p.id}><td>{p.name}</td><td>{TARGET[p.target_type] ?? p.target_type}</td><td className="mono">{p.item_count}</td><td>{p.live ? <b>Đang phát</b> : <StatusTag status={p.status} />}</td></tr>
                  ))}</tbody>
                </table>
              )}
            </div>
            <div className="card cp">
              <div className="ch"><div><h2>Thiết bị theo khu vực</h2><p>Trực tuyến / tổng (đã duyệt)</p></div><Btn onClick={() => nav('/devices')}>Mạng lưới</Btn></div>
              {!d.devices.regions.length ? <EmptyBlock>Chưa có thiết bị đã duyệt.</EmptyBlock> : (
                <table className="tbl">
                  <thead><tr><th>Khu vực</th><th>Trực tuyến</th><th>Ngoại tuyến</th></tr></thead>
                  <tbody>{d.devices.regions.map((g) => <tr key={g.region}><td>{g.region}</td><td className="mono">{g.online}</td><td className="mono">{g.offline}</td></tr>)}</tbody>
                </table>
              )}
            </div>
          </div>
          <div className="card cp">
            <div className="ch"><div><h2>Thông báo khẩn gần đây</h2><p>5 thông báo mới nhất</p></div><Btn onClick={() => nav('/notice')}>Mở trang thông báo</Btn></div>
            {!d.notices.length ? <EmptyBlock>Chưa gửi thông báo nào.</EmptyBlock> : (
              <table className="tbl">
                <thead><tr><th>Lúc</th><th>Nội dung</th><th>Đích</th><th>Thiết bị</th></tr></thead>
                <tbody>{d.notices.map((n) => <tr key={n.id}><td className="mono">{fmtDateTime(n.at)}</td><td>{n.text}</td><td>{TARGET[n.target ?? ''] ?? n.target}{n.regions?.length ? ` · ${n.regions.join(', ')}` : ''}</td><td className="mono">{n.queued ?? 0}/{n.matched ?? 0}</td></tr>)}</tbody>
              </table>
            )}
          </div>
          {d.queue.failed > 0 ? <Note warn>Có {d.queue.failed} lệnh gửi thiết bị bị lỗi. Xem chi tiết ở “Hàng đợi &amp; Nhật ký”.</Note> : null}
        </>
      ) : null}
    </>
  );
}
