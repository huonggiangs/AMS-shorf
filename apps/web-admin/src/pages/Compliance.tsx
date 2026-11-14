import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, errMsg } from '../api/client';
import { useAct } from '../api/hooks';
import { useAuth } from '../auth/AuthProvider';
import { ServerTable } from '../components/ServerTable';
import type { Col } from '../components/DataTable';
import { Btn, ErrorBlock, Field, LoadingBlock, Note, PageHead, Tabs, Tag } from '../components/ui';
import { Dialog } from '../components/Dialog';
import { PromptDialog } from '../components/Prompt';
import { fmtDateTime } from '../lib/format';
import { anyRow, downloadJson, DSR_KIND, DSR_STATE, n, s, SUBJECT_TYPE, type Row } from '../lib/p4';

type Tab = 'dsr' | 'ret' | 'reg';

/** Dữ liệu cá nhân (Nghị định 13/2023): yêu cầu chủ thể dữ liệu, lưu giữ dữ liệu, sổ đăng ký xử lý và đồng ý. */
export default function Compliance() {
  const [tab, setTab] = useState<Tab>('dsr');
  return (
    <>
      <PageHead title="Dữ liệu cá nhân & Lưu giữ" sub="Xử lý yêu cầu của chủ thể dữ liệu (xuất, ẩn danh), chính sách lưu giữ dữ liệu sự kiện và sổ đăng ký hoạt động xử lý dữ liệu." />
      <Tabs label="Tuân thủ dữ liệu" value={tab} onChange={setTab} items={[{ id: 'dsr', label: 'Yêu cầu chủ thể dữ liệu' }, { id: 'ret', label: 'Lưu giữ dữ liệu' }, { id: 'reg', label: 'Sổ đăng ký & đồng ý' }]} />
      {tab === 'dsr' ? <Dsr /> : tab === 'ret' ? <Retention /> : <Registers />}
    </>
  );
}

function Dsr() {
  const { can } = useAuth();
  const act = useAct();
  const canWrite = can('admin', 'write');
  const canExec = can('admin', 'approve');
  const [add, setAdd] = useState(false);
  const [rej, setRej] = useState<Row | null>(null);
  const run = async (r: Row) => {
    const anon = r.kind === 'anonymize';
    if (anon && !window.confirm('Ẩn danh không thể hoàn tác (sổ cái tài chính được giữ nguyên). Tiếp tục?')) return;
    const res = await act(async () => (await api.post(`/admin/v1/compliance/dsr/${s(r.id)}/execute`, { body: anon ? { confirm: true } : {} })) as { export?: unknown }, anon ? 'Đã ẩn danh dữ liệu.' : 'Đã xuất dữ liệu. Tệp JSON được tải về máy.', ['/admin/v1/compliance']);
    if (res?.export) downloadJson(`dsr-${s(r.id)}.json`, res.export);
  };
  const cols: Col<Row>[] = [
    { key: 'at', label: 'Tiếp nhận', sortKey: 'created_at', text: (r) => fmtDateTime(s(r.created_at)) },
    { key: 'kind', label: 'Yêu cầu', text: (r) => DSR_KIND[s(r.kind)] ?? s(r.kind) },
    { key: 'subj', label: 'Chủ thể', text: (r) => `${SUBJECT_TYPE[s(r.subject_type)] ?? s(r.subject_type)} · ${s(r.subject_id)}` },
    { key: 'cu', label: 'Khách hàng', text: (r) => s(r.customer) || '—' },
    { key: 'req', label: 'Người yêu cầu', text: (r) => s(r.requester) || '—' },
    { key: 'due', label: 'Hạn xử lý', sortKey: 'due_at', text: (r) => fmtDateTime(s(r.due_at)) },
    { key: 'state', label: 'Trạng thái', sortKey: 'state', text: (r) => DSR_STATE[s(r.state)]?.label ?? s(r.state), cell: (r) => <Tag tone={DSR_STATE[s(r.state)]?.tone ?? 'info'}>{DSR_STATE[s(r.state)]?.label ?? s(r.state)}</Tag> },
    ...(canExec ? [{
      key: 'act', label: '', text: () => '',
      cell: (r: Row) => r.state === 'requested' ? (
        <span style={{ display: 'flex', gap: 6 }}>
          <Btn tone="p" onClick={() => void run(r)}>{r.kind === 'anonymize' ? 'Thực hiện ẩn danh' : 'Xuất dữ liệu'}</Btn>
          <Btn onClick={() => setRej(r)}>Từ chối</Btn>
        </span>
      ) : null,
    } as Col<Row>] : []),
  ];
  return (
    <>
      <Note>Hạn xử lý mặc định theo quy định là 72 giờ kể từ khi tiếp nhận. Dữ liệu xuất ra chỉ được trả về trong phản hồi và tải về máy, hệ thống không lưu bản sao. Bút toán tài chính được giữ nguyên khi ẩn danh.</Note>
      {canWrite ? <div style={{ margin: '8px 0' }}><Btn tone="p" onClick={() => setAdd(true)}>Tạo yêu cầu</Btn></div> : null}
      <ServerTable id="dsr" endpoint="/admin/v1/compliance/dsr" itemSchema={anyRow} cols={cols} exportName="yeu-cau-du-lieu" rowKey={(r) => s(r.id)} emptyText="Chưa có yêu cầu nào." />
      {add ? <DsrDialog onClose={() => setAdd(false)} /> : null}
      <PromptDialog open={!!rej} title="Từ chối yêu cầu" label="Lý do từ chối" onClose={() => setRej(null)} onSubmit={async (reason) => { if (rej) await act(() => api.post(`/admin/v1/compliance/dsr/${s(rej.id)}/reject`, { body: { reason } }), 'Đã từ chối yêu cầu.', ['/admin/v1/compliance']); }} />
    </>
  );
}

function DsrDialog({ onClose }: { onClose: () => void }) {
  const act = useAct();
  const [f, setF] = useState({ kind: 'export', subject_type: 'customer_contact', subject_id: '', requester: '', note: '' });
  const [err, setErr] = useState('');
  const submit = async () => {
    setErr('');
    try {
      await api.post('/admin/v1/compliance/dsr', { body: { kind: f.kind, subject_type: f.subject_type, subject_id: f.subject_id.trim(), ...(f.requester ? { requester: f.requester } : {}), ...(f.note ? { note: f.note } : {}) } });
      await act(async () => undefined, 'Đã tạo yêu cầu.', ['/admin/v1/compliance']);
      onClose();
    } catch (e) {
      setErr(errMsg(e));
    }
  };
  return (
    <Dialog open onClose={onClose} width="min(520px,96vw)" label="Tạo yêu cầu chủ thể dữ liệu">
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <h2 style={{ margin: '0 0 10px', fontSize: 18 }}>Tạo yêu cầu chủ thể dữ liệu</h2>
        <Field label="Loại yêu cầu"><select className="sel" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(DSR_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Loại chủ thể"><select className="sel" value={f.subject_type} onChange={(e) => setF({ ...f, subject_type: e.target.value })}>{Object.entries(SUBJECT_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Mã chủ thể" hint="Mã tài khoản / người liên hệ / người xem trong hệ thống."><input value={f.subject_id} onChange={(e) => setF({ ...f, subject_id: e.target.value })} required /></Field>
        <Field label="Người yêu cầu"><input value={f.requester} onChange={(e) => setF({ ...f, requester: e.target.value })} /></Field>
        <Field label="Ghi chú"><textarea value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        {err ? <Note warn>{err}</Note> : null}
        <div className="da" style={{ marginTop: 14 }}>
          <button type="button" className="btn" onClick={onClose}>Hủy</button>
          <button type="submit" className="btn p">Tạo yêu cầu</button>
        </div>
      </form>
    </Dialog>
  );
}

const RET_FIELDS: { key: string; label: string }[] = [
  { key: 'ev_heartbeat_days', label: 'Nhịp thiết bị (ev_heartbeat)' },
  { key: 'ev_ad_impression_days', label: 'Lượt hiển thị quảng cáo (ev_ad_impression)' },
  { key: 'ev_proof_of_play_days', label: 'Bằng chứng phát (ev_proof_of_play)' },
  { key: 'impression_hourly_days', label: 'Tổng hợp theo giờ (impression_hourly)' },
];

function Retention() {
  const { can } = useAuth();
  const act = useAct();
  const canEdit = can('admin', 'write');
  const canRun = can('admin', 'approve');
  const q = useQuery({ queryKey: ['/admin/v1/compliance/retention'], queryFn: () => api.get('/admin/v1/compliance/retention') as Promise<{ policy: Record<string, number>; preview: Record<string, number> }> });
  const [f, setF] = useState<Record<string, string> | null>(null);
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;
  const cur = f ?? Object.fromEntries(Object.entries(q.data?.policy ?? {}).map(([k, v]) => [k, String(v)]));
  const preview = q.data?.preview ?? {};
  return (
    <div className="card cp" style={{ marginTop: 8 }}>
      <Note>Số ngày giữ dữ liệu sự kiện thô; 0 = giữ vĩnh viễn. Tối thiểu 7 ngày nếu bật xóa. Bút toán tài chính (sổ cái) không bao giờ bị xóa bởi tác vụ này.</Note>
      <form onSubmit={(e) => { e.preventDefault(); void act(() => api.put('/admin/v1/compliance/retention', { body: Object.fromEntries(RET_FIELDS.map((x) => [x.key, Number(cur[x.key]) || 0])) }), 'Đã lưu chính sách lưu giữ.', ['/admin/v1/compliance']).then(() => setF(null)); }}>
        {RET_FIELDS.map((x) => (
          <Field key={x.key} label={`${x.label} (ngày)`} hint={`Sẽ xóa theo chính sách hiện tại: ${n(preview[x.key.replace(/_days$/, '')] ?? preview[x.key])} dòng`}>
            <input type="number" min={0} value={cur[x.key] ?? ''} disabled={!canEdit} onChange={(e) => setF({ ...cur, [x.key]: e.target.value })} />
          </Field>
        ))}
        <div className="acts" style={{ marginTop: 10 }}>
          {canEdit ? <Btn tone="p" type="submit">Lưu chính sách</Btn> : null}
          {canRun ? <Btn tone="d" type="button" onClick={() => { if (window.confirm('Xóa dữ liệu sự kiện đã quá hạn lưu giữ ngay bây giờ? Không thể hoàn tác.')) void act(async () => (await api.post('/admin/v1/compliance/retention/run')) as { deleted?: Record<string, number> }, 'Đã chạy tác vụ lưu giữ dữ liệu.', ['/admin/v1/compliance']); }}>Chạy xóa ngay</Btn> : null}
        </div>
      </form>
    </div>
  );
}

function Registers() {
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['/admin/v1/compliance/processing-records'], queryFn: () => api.get('/admin/v1/compliance/processing-records') as Promise<{ items: Row[] }> });
  const canWrite = can('admin', 'write');
  const [add, setAdd] = useState(false);
  const cols: Col<Row>[] = [
    { key: 'at', label: 'Ghi nhận', sortKey: 'created_at', text: (r) => fmtDateTime(s(r.created_at)) },
    { key: 'who', label: 'Chủ thể', text: (r) => `${SUBJECT_TYPE[s(r.subject_type)] ?? s(r.subject_type)} · ${s(r.subject_id)}` },
    { key: 'purpose', label: 'Mục đích', sortKey: 'purpose', text: (r) => s(r.purpose) },
    { key: 'granted', label: 'Đồng ý', text: (r) => (n(r.granted) === 1 || r.granted === true ? 'Đồng ý' : 'Rút lại') },
    { key: 'src', label: 'Nguồn', text: (r) => s(r.source) || '—' },
  ];
  return (
    <>
      <div className="card cp" style={{ marginTop: 8 }}>
        <div className="ch"><h2>Sổ đăng ký hoạt động xử lý dữ liệu</h2></div>
        {q.isLoading ? <LoadingBlock /> : q.error ? <ErrorBlock error={q.error} onRetry={() => void q.refetch()} /> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tb"><thead><tr><th>Hoạt động</th><th>Mục đích</th><th>Loại dữ liệu</th><th>Căn cứ</th><th>Chuyển ra nước ngoài</th><th>Lưu giữ</th></tr></thead>
              <tbody>{(q.data?.items ?? []).map((r) => <tr key={s(r.id)}><td>{s(r.activity)}</td><td>{s(r.purpose)}</td><td>{s(r.data_categories)}</td><td>{s(r.legal_basis) || '—'}</td><td>{r.cross_border ? 'Có' : 'Không'}</td><td>{s(r.retention) || '—'}</td></tr>)}</tbody></table>
          </div>
        )}
        <p className="sub">Nội dung sổ là bản khởi tạo kỹ thuật; bộ phận pháp chế cần rà soát và bổ sung (căn cứ pháp lý, chuyển dữ liệu ra nước ngoài, hồ sơ đánh giá tác động).</p>
      </div>
      {canWrite ? <div style={{ margin: '8px 0' }}><Btn onClick={() => setAdd(true)}>Ghi nhận đồng ý</Btn></div> : null}
      <ServerTable id="consents" endpoint="/admin/v1/compliance/consents" itemSchema={anyRow} cols={cols} title="Lịch sử đồng ý xử lý dữ liệu" exportName="dong-y-du-lieu" rowKey={(r) => s(r.id)} emptyText="Chưa có bản ghi đồng ý." />
      {add ? <ConsentDialog onClose={() => setAdd(false)} /> : null}
    </>
  );
}

function ConsentDialog({ onClose }: { onClose: () => void }) {
  const act = useAct();
  const [f, setF] = useState({ subject_type: 'customer_contact', subject_id: '', purpose: '', granted: true, source: '' });
  const [err, setErr] = useState('');
  const submit = async () => {
    setErr('');
    try {
      await api.post('/admin/v1/compliance/consents', { body: { subject_type: f.subject_type, subject_id: f.subject_id.trim(), purpose: f.purpose, granted: f.granted, ...(f.source ? { source: f.source } : {}) } });
      await act(async () => undefined, 'Đã ghi nhận.', ['/admin/v1/compliance']);
      onClose();
    } catch (e) {
      setErr(errMsg(e));
    }
  };
  return (
    <Dialog open onClose={onClose} width="min(480px,96vw)" label="Ghi nhận đồng ý">
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <h2 style={{ margin: '0 0 10px', fontSize: 18 }}>Ghi nhận đồng ý / rút lại đồng ý</h2>
        <Field label="Loại chủ thể"><select className="sel" value={f.subject_type} onChange={(e) => setF({ ...f, subject_type: e.target.value })}>{Object.entries(SUBJECT_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Mã chủ thể"><input value={f.subject_id} onChange={(e) => setF({ ...f, subject_id: e.target.value })} required /></Field>
        <Field label="Mục đích"><input value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} required minLength={2} /></Field>
        <Field label="Nguồn (kênh)"><input value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} /></Field>
        <label style={{ display: 'flex', gap: 8, margin: '8px 0' }}><input type="checkbox" checked={f.granted} onChange={(e) => setF({ ...f, granted: e.target.checked })} /> Chủ thể đồng ý (bỏ chọn = rút lại đồng ý)</label>
        {err ? <Note warn>{err}</Note> : null}
        <div className="da" style={{ marginTop: 14 }}>
          <button type="button" className="btn" onClick={onClose}>Hủy</button>
          <button type="submit" className="btn p">Ghi nhận</button>
        </div>
      </form>
    </Dialog>
  );
}
