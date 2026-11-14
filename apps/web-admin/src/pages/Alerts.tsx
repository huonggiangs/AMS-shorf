import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '../api/client';
import { useAct } from '../api/hooks';
import { useAuth } from '../auth/AuthProvider';
import { Btn, EmptyBlock, ErrorBlock, Kpi, LoadingBlock, Note, PageHead, Tag } from '../components/ui';
import { fmtDateTime } from '../lib/format';

const incident = z.object({
  id: z.string(), rule_key: z.string(), severity: z.enum(['S1', 'S2', 'S3']), component: z.string(), title: z.string(), detail: z.string().nullable(),
  status: z.string(), occurrences: z.number(), opened_at: z.string(), last_seen_at: z.string(), acked_at: z.string().nullable().optional(), ack_note: z.string().nullable().optional(),
});
const summary = z.object({
  counts: z.object({ S1: z.number(), S2: z.number(), S3: z.number() }),
  incidents: z.array(incident),
  recent: z.array(z.object({ id: z.string(), rule_key: z.string(), severity: z.string(), title: z.string(), opened_at: z.string(), resolved_at: z.string().nullable() })),
  jobs: z.array(z.object({ job: z.string(), last_started_at: z.string().nullable(), last_success_at: z.string().nullable(), last_error_at: z.string().nullable(), last_error: z.string().nullable(), runs: z.number(), failures: z.number() })),
  backups: z.array(z.object({ kind: z.string(), last_at: z.string().nullable() })),
  notifications: z.array(z.object({ channel: z.string(), ok: z.boolean(), error: z.string().nullable(), sent_at: z.string() })),
  config: z.object({ emails: z.array(z.string()), webhook_configured: z.boolean(), webhook_host: z.string().nullable(), mail_configured: z.boolean() }),
});
type Summary = z.infer<typeof summary>;
const KEY = '/admin/v1/ops';
const TONE = { S1: 'bad', S2: 'warn', S3: 'info' } as const;
const SEV_LABEL = { S1: 'S1 Nghiêm trọng', S2: 'S2 Cao', S3: 'S3 Thấp' } as const;

/** Cảnh báo vận hành (p3-ops): sự cố đang mở, xác nhận (ack), kênh nhận thông báo, nhịp job nền, sao lưu. Quy trình: docs/ops/ONCALL.md. */
export default function Alerts() {
  const { can } = useAuth();
  const act = useAct();
  const canWrite = can('admin', 'write');
  const q = useQuery({ queryKey: [KEY, 'summary'], refetchInterval: 30_000, queryFn: () => api.get(`${KEY}/summary`, { schema: summary }) });
  if (q.isLoading) return <LoadingBlock />;
  if (q.isError || !q.data) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;
  const s = q.data;
  return (
    <>
      <PageHead title="Cảnh báo" sub="Sự cố vận hành tự phát hiện: webhook, ví lệch sổ cái, hàng đợi, gateway, sao lưu, thiết bị mất kết nối." actions={canWrite ? <Btn onClick={() => void act(() => api.post(`${KEY}/run`), 'Đã chạy kiểm tra.', [KEY])}>Kiểm tra ngay</Btn> : undefined} />
      <div className="kpis" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 12, marginBottom: 12 }}>
        <Kpi label="S1 Nghiêm trọng" value={s.counts.S1} icon="warn" foot="Gọi trực ngay" />
        <Kpi label="S2 Cao" value={s.counts.S2} icon="warn" foot="Xử lý trong 4 giờ" />
        <Kpi label="S3 Thấp" value={s.counts.S3} icon="info" foot="Trong ngày làm việc" />
      </div>
      {!s.config.emails.length && !s.config.webhook_configured ? <Note warn>Chưa có kênh nhận cảnh báo (email hoặc webhook). Cảnh báo chỉ hiện ở trang này cho tới khi bạn cấu hình bên dưới.</Note> : null}
      {s.config.emails.length && !s.config.mail_configured ? <Note warn>Đã đặt email nhận cảnh báo nhưng máy chủ chưa cấu hình gửi thư (MAIL_HTTP_URL hoặc SMTP). Xem docs/ops/EMAIL-SETUP.md.</Note> : null}
      <div className="card" style={{ overflowX: 'auto', marginBottom: 12 }}>
        <h3 style={{ margin: '12px 14px 0' }}>Đang mở</h3>
        {s.incidents.length === 0 ? <EmptyBlock>Không có sự cố nào đang mở.</EmptyBlock> : (
          <table className="tbl" style={{ width: '100%' }}>
            <thead><tr><th>Mức</th><th>Sự cố</th><th>Thành phần</th><th>Mở lúc</th><th>Lần thấy</th><th>Trạng thái</th><th /></tr></thead>
            <tbody>
              {s.incidents.map((i) => (
                <tr key={i.id}>
                  <td><Tag tone={TONE[i.severity]}>{SEV_LABEL[i.severity]}</Tag></td>
                  <td><b>{i.title}</b><div className="sub" style={{ maxWidth: 520 }}>{i.detail}</div></td>
                  <td>{i.component}</td>
                  <td>{fmtDateTime(i.opened_at)}</td>
                  <td>{i.occurrences}</td>
                  <td>{i.status === 'acked' ? <Tag tone="info">Đã nhận{i.ack_note ? `: ${i.ack_note}` : ''}</Tag> : <Tag tone="warn">Mở</Tag>}</td>
                  <td>{canWrite && i.status === 'open' ? <Btn className="sm" onClick={() => { const note = window.prompt('Ghi chú khi nhận xử lý (tùy chọn)') ?? ''; void act(() => api.post(`${KEY}/incidents/${i.id}/ack`, { body: note ? { note } : {} }), 'Đã nhận sự cố.', [KEY]); }}>Nhận xử lý</Btn> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {canWrite ? <Settings s={s} /> : null}
      <div className="card" style={{ overflowX: 'auto', marginBottom: 12 }}>
        <h3 style={{ margin: '12px 14px 0' }}>Job nền và sao lưu</h3>
        <table className="tbl" style={{ width: '100%' }}>
          <thead><tr><th>Job</th><th>Lần chạy gần nhất</th><th>Thành công gần nhất</th><th>Lỗi</th></tr></thead>
          <tbody>
            {s.jobs.map((j) => (<tr key={j.job}><td>{j.job}</td><td>{j.last_started_at ? fmtDateTime(j.last_started_at) : '-'}</td><td>{j.last_success_at ? fmtDateTime(j.last_success_at) : '-'}</td><td>{j.failures}{j.last_error ? ` (${j.last_error})` : ''}</td></tr>))}
            {s.backups.map((b) => (<tr key={b.kind}><td>Sao lưu {b.kind}</td><td colSpan={3}>Bản thành công gần nhất: {b.last_at ? fmtDateTime(b.last_at) : 'chưa có'}</td></tr>))}
            {!s.jobs.length && !s.backups.length ? <tr><td colSpan={4}>Chưa có dữ liệu.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <div className="card" style={{ overflowX: 'auto' }}>
        <h3 style={{ margin: '12px 14px 0' }}>Đã khắc phục gần đây</h3>
        {s.recent.length === 0 ? <EmptyBlock /> : (
          <table className="tbl" style={{ width: '100%' }}>
            <thead><tr><th>Mức</th><th>Sự cố</th><th>Mở lúc</th><th>Đóng lúc</th></tr></thead>
            <tbody>{s.recent.map((r) => (<tr key={r.id}><td>{r.severity}</td><td>{r.title}</td><td>{fmtDateTime(r.opened_at)}</td><td>{r.resolved_at ? fmtDateTime(r.resolved_at) : ''}</td></tr>))}</tbody>
          </table>
        )}
      </div>
    </>
  );
}

function Settings({ s }: { s: Summary }) {
  const act = useAct();
  const [emails, setEmails] = useState(s.config.emails.join(', '));
  const [hook, setHook] = useState('');
  const last = s.notifications[0];
  return (
    <div className="card cp" style={{ marginBottom: 12 }}>
      <h3 style={{ margin: '0 0 8px' }}>Kênh nhận cảnh báo</h3>
      <div style={{ display: 'grid', gap: 8, maxWidth: 640 }}>
        <label>Email nhận (cách nhau bằng dấu phẩy)<input className="inp" value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="truc1@anio.vn, truc2@anio.vn" /></label>
        <label>Webhook (Telegram/Slack/Discord, https){s.config.webhook_configured ? <span className="sub"> đang dùng: {s.config.webhook_host} (URL được ẩn)</span> : null}
          <input className="inp" value={hook} onChange={(e) => setHook(e.target.value)} placeholder={s.config.webhook_configured ? 'Để trống nếu giữ nguyên' : 'https://api.telegram.org/bot<token>/sendMessage?chat_id=<id>'} autoComplete="off" />
        </label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Btn tone="p" onClick={() => void act(() => api.put(`${KEY}/settings`, { body: { emails: emails.split(/[,;\s]+/).filter(Boolean), ...(hook ? { webhook_url: hook } : {}) } }), 'Đã lưu kênh cảnh báo.', [KEY]).then(() => setHook(''))}>Lưu</Btn>
          <Btn onClick={() => void act(() => api.post(`${KEY}/test-notification`), (r) => ((r as { results: { channel: string; ok: boolean; skipped?: boolean }[] }).results.map((x) => `${x.channel}: ${x.skipped ? 'chưa cấu hình' : x.ok ? 'gửi được' : 'LỖI'}`).join('; ')), [KEY])}>Gửi thử</Btn>
          {s.config.webhook_configured ? <Btn tone="d" onClick={() => void act(() => api.put(`${KEY}/settings`, { body: { webhook_url: null } }), 'Đã xóa webhook.', [KEY])}>Xóa webhook</Btn> : null}
        </div>
        {last ? <div className="sub">Lần gửi gần nhất: {last.channel} lúc {fmtDateTime(last.sent_at)}: {last.ok ? 'thành công' : `thất bại${last.error ? ` (${last.error})` : ''}`}</div> : null}
      </div>
    </div>
  );
}
