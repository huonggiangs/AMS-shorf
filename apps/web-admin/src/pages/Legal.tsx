import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, errMsg } from '../api/client';
import { useAct } from '../api/hooks';
import { useAuth } from '../auth/AuthProvider';
import { ServerTable } from '../components/ServerTable';
import type { Col } from '../components/DataTable';
import { Btn, ErrorBlock, Field, LoadingBlock, Note, PageHead, Tabs, Tag } from '../components/ui';
import { Dialog } from '../components/Dialog';
import { fmtDateTime } from '../lib/format';
import { anyRow, LEGAL_KIND_LABEL, LEGAL_STATUS_LABEL, n, s, type Row } from '../lib/p4';

type Tab = 'docs' | 'acc' | 'cov';

/** Quản trị văn bản pháp lý (ĐKSD, Chính sách bảo mật, SLA). Bản nháp chỉ phát hành khi quản trị cấp cao xác nhận luật sư đã duyệt. */
export default function Legal() {
  const [tab, setTab] = useState<Tab>('docs');
  return (
    <>
      <PageHead title="Văn bản pháp lý" sub="Điều khoản sử dụng, chính sách bảo mật và cam kết dịch vụ có phiên bản. Khách hàng bên ngoài phải chấp nhận khi đăng nhập lần đầu và mỗi khi có phiên bản mới." />
      <Tabs label="Văn bản pháp lý" value={tab} onChange={setTab} items={[{ id: 'docs', label: 'Văn bản' }, { id: 'acc', label: 'Lịch sử chấp nhận' }, { id: 'cov', label: 'Tiến độ chấp nhận' }]} />
      {tab === 'docs' ? <Docs /> : tab === 'acc' ? <Acceptances /> : <Coverage />}
    </>
  );
}

function Docs() {
  const { can } = useAuth();
  const act = useAct();
  const canWrite = can('admin', 'write');
  const canPublish = can('admin', 'approve');
  const [edit, setEdit] = useState<{ id: string | null } | null>(null);
  const [pub, setPub] = useState<Row | null>(null);
  const cols: Col<Row>[] = [
    { key: 'kind', label: 'Loại', sortKey: 'kind', text: (r) => LEGAL_KIND_LABEL[s(r.kind)] ?? s(r.kind) },
    { key: 'version', label: 'Phiên bản', sortKey: 'version', text: (r) => s(r.version) },
    { key: 'title', label: 'Tiêu đề', text: (r) => s(r.title) },
    { key: 'status', label: 'Trạng thái', sortKey: 'status', text: (r) => LEGAL_STATUS_LABEL[s(r.status)]?.label ?? s(r.status), cell: (r) => <Tag tone={LEGAL_STATUS_LABEL[s(r.status)]?.tone ?? 'info'}>{LEGAL_STATUS_LABEL[s(r.status)]?.label ?? s(r.status)}</Tag> },
    { key: 'req', label: 'Bắt buộc chấp nhận', text: (r) => (r.requires_acceptance ? 'Có' : 'Không') },
    { key: 'pub', label: 'Phát hành lúc', sortKey: 'published_at', text: (r) => (r.published_at ? fmtDateTime(s(r.published_at)) : '—') },
    {
      key: 'act', label: '', text: () => '',
      cell: (r) => (
        <span style={{ display: 'flex', gap: 6 }}>
          <Btn onClick={() => setEdit({ id: s(r.id) })}>{r.status === 'draft' && canWrite ? 'Sửa' : 'Xem'}</Btn>
          {r.status === 'draft' && canPublish ? <Btn tone="p" onClick={() => setPub(r)}>Phát hành</Btn> : null}
          {r.status === 'published' && canPublish ? <Btn onClick={() => { if (window.confirm('Gỡ văn bản đang phát hành? Khách sẽ không còn bị yêu cầu chấp nhận bản này.')) void act(() => api.post(`/admin/v1/legal/documents/${s(r.id)}/retire`), 'Đã gỡ văn bản.', ['/admin/v1/legal']); }}>Gỡ</Btn> : null}
        </span>
      ),
    },
  ];
  return (
    <>
      <Note warn>Các văn bản mẫu chỉ là BẢN NHÁP do kỹ thuật soạn, chưa có giá trị pháp lý. Phải có luật sư rà soát và chốt nội dung trước khi bấm “Phát hành”. Văn bản đã phát hành không sửa được; muốn đổi hãy tạo phiên bản mới.</Note>
      {canWrite ? <div style={{ margin: '8px 0' }}><Btn tone="p" onClick={() => setEdit({ id: null })}>Tạo phiên bản mới</Btn></div> : null}
      <ServerTable id="legal-docs" endpoint="/admin/v1/legal/documents" itemSchema={anyRow} cols={cols} exportName="van-ban-phap-ly" rowKey={(r) => s(r.id)} />
      {edit ? <DocDialog id={edit.id} canWrite={canWrite} onClose={() => setEdit(null)} /> : null}
      {pub ? <PublishDialog doc={pub} onClose={() => setPub(null)} /> : null}
    </>
  );
}

function DocDialog({ id, canWrite, onClose }: { id: string | null; canWrite: boolean; onClose: () => void }) {
  const act = useAct();
  const q = useQuery({ queryKey: ['/admin/v1/legal/documents', 'one', id], enabled: !!id, queryFn: () => api.get(`/admin/v1/legal/documents/${id}`) as Promise<Row> });
  const [f, setF] = useState<{ kind: string; version: string; title: string; body_md: string; requires_acceptance: boolean; change_note: string } | null>(id ? null : { kind: 'terms', version: '', title: '', body_md: '', requires_acceptance: true, change_note: '' });
  const cur = f ?? (q.data ? { kind: s(q.data.kind), version: s(q.data.version), title: s(q.data.title), body_md: s(q.data.body_md), requires_acceptance: !!q.data.requires_acceptance, change_note: s(q.data.change_note) } : null);
  const editable = !id ? canWrite : canWrite && q.data?.status === 'draft';
  const problems = (q.data?.draft_problems as string[] | undefined) ?? [];
  const [err, setErr] = useState('');
  const save = async () => {
    if (!cur) return;
    setErr('');
    try {
      if (id) await api.put(`/admin/v1/legal/documents/${id}`, { body: { title: cur.title, body_md: cur.body_md, requires_acceptance: cur.requires_acceptance, change_note: cur.change_note || undefined } });
      else await api.post('/admin/v1/legal/documents', { body: { kind: cur.kind, version: cur.version, title: cur.title, body_md: cur.body_md, requires_acceptance: cur.requires_acceptance, change_note: cur.change_note || undefined } });
      await act(async () => undefined, id ? 'Đã lưu bản nháp.' : 'Đã tạo bản nháp.', ['/admin/v1/legal']);
      onClose();
    } catch (e) {
      setErr(errMsg(e));
    }
  };
  const set = (p: Partial<NonNullable<typeof cur>>) => cur && setF({ ...cur, ...p });
  return (
    <Dialog open onClose={onClose} width="min(760px,96vw)" label="Văn bản pháp lý">
      <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <h2 style={{ margin: '0 0 10px', fontSize: 18 }}>{id ? 'Văn bản pháp lý' : 'Tạo phiên bản văn bản'}</h2>
        {id && q.isLoading ? <LoadingBlock /> : null}
        {id && q.error ? <ErrorBlock error={q.error} /> : null}
        {cur ? (
          <>
            {!id ? (
              <div className="g g2">
                <Field label="Loại văn bản"><select className="sel" value={cur.kind} onChange={(e) => set({ kind: e.target.value })}>{Object.entries(LEGAL_KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                <Field label="Phiên bản" hint="Ví dụ 2026-01 hoặc 1.1"><input value={cur.version} onChange={(e) => set({ version: e.target.value })} required /></Field>
              </div>
            ) : <p className="sub">{LEGAL_KIND_LABEL[cur.kind] ?? cur.kind} · phiên bản {cur.version} · {n(q.data?.acceptances)} lượt chấp nhận</p>}
            {problems.length ? <Note warn>Văn bản còn dấu hiệu bản nháp: {problems.join('; ')}.</Note> : null}
            <Field label="Tiêu đề"><input value={cur.title} onChange={(e) => set({ title: e.target.value })} disabled={!editable} required /></Field>
            <Field label="Nội dung (Markdown)"><textarea rows={14} value={cur.body_md} onChange={(e) => set({ body_md: e.target.value })} disabled={!editable} required style={{ width: '100%', fontFamily: 'inherit' }} /></Field>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0' }}><input type="checkbox" checked={cur.requires_acceptance} disabled={!editable} onChange={(e) => set({ requires_acceptance: e.target.checked })} /> Bắt buộc khách chấp nhận</label>
            <Field label="Ghi chú thay đổi"><input value={cur.change_note} onChange={(e) => set({ change_note: e.target.value })} disabled={!editable} /></Field>
          </>
        ) : null}
        {err ? <Note warn>{err}</Note> : null}
        <div className="da" style={{ marginTop: 14 }}>
          <button type="button" className="btn" onClick={onClose}>Đóng</button>
          {editable && cur ? <button type="submit" className="btn p">Lưu bản nháp</button> : null}
        </div>
      </form>
    </Dialog>
  );
}

function PublishDialog({ doc, onClose }: { doc: Row; onClose: () => void }) {
  const act = useAct();
  const q = useQuery({ queryKey: ['/admin/v1/legal/documents', 'one', s(doc.id)], queryFn: () => api.get(`/admin/v1/legal/documents/${s(doc.id)}`) as Promise<Row> });
  const problems = (q.data?.draft_problems as string[] | undefined) ?? [];
  const [ok, setOk] = useState(false);
  const [ref, setRef] = useState('');
  const [force, setForce] = useState(false);
  const [err, setErr] = useState('');
  const submit = async () => {
    setErr('');
    try {
      await api.post(`/admin/v1/legal/documents/${s(doc.id)}/publish`, { body: { confirm_lawyer_approved: true, lawyer_ref: ref || undefined, allow_draft_markers: force || undefined } });
      await act(async () => undefined, 'Đã phát hành văn bản. Khách hàng sẽ được yêu cầu chấp nhận.', ['/admin/v1/legal']);
      onClose();
    } catch (e) {
      setErr(errMsg(e));
    }
  };
  return (
    <Dialog open onClose={onClose} width="min(560px,96vw)" label="Phát hành văn bản">
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <h2 style={{ margin: '0 0 10px', fontSize: 18 }}>Phát hành {LEGAL_KIND_LABEL[s(doc.kind)] ?? s(doc.kind)} · {s(doc.version)}</h2>
        <Note warn>Phát hành sẽ bắt buộc mọi tài khoản khách hàng bên ngoài đọc và chấp nhận trước khi dùng tiếp. Bản đang phát hành cùng loại sẽ được gỡ.</Note>
        {problems.length ? <Note warn>Văn bản còn dấu hiệu bản nháp ({problems.join('; ')}). Nên để luật sư hoàn thiện trước.</Note> : null}
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '10px 0' }}><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> Tôi xác nhận luật sư đã duyệt nội dung văn bản này</label>
        <Field label="Tham chiếu ý kiến luật sư (không bắt buộc)"><input value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
        {problems.length ? <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0' }}><input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} /> Vẫn phát hành dù còn dấu hiệu bản nháp</label> : null}
        {err ? <Note warn>{err}</Note> : null}
        <div className="da" style={{ marginTop: 14 }}>
          <button type="button" className="btn" onClick={onClose}>Hủy</button>
          <button type="submit" className="btn p" disabled={!ok}>Phát hành</button>
        </div>
      </form>
    </Dialog>
  );
}

function Acceptances() {
  const cols: Col<Row>[] = [
    { key: 'at', label: 'Thời điểm', sortKey: 'accepted_at', text: (r) => fmtDateTime(s(r.accepted_at)) },
    { key: 'who', label: 'Tài khoản', text: (r) => s(r.email) },
    { key: 'cu', label: 'Khách hàng', sortKey: 'customer', text: (r) => s(r.customer) || '—' },
    { key: 'kind', label: 'Văn bản', sortKey: 'kind', text: (r) => `${LEGAL_KIND_LABEL[s(r.kind)] ?? s(r.kind)} · ${s(r.version)}` },
    { key: 'sha', label: 'Dấu vân tay (SHA-256)', text: (r) => s(r.sha256).slice(0, 12) },
    { key: 'ip', label: 'IP', text: (r) => s(r.ip) },
  ];
  return <ServerTable id="legal-acc" endpoint="/admin/v1/legal/acceptances" itemSchema={anyRow} cols={cols} exportName="lich-su-chap-nhan" rowKey={(r) => s(r.id)} />;
}

function Coverage() {
  const q = useQuery({ queryKey: ['/admin/v1/legal/coverage'], queryFn: () => api.get('/admin/v1/legal/coverage') as Promise<{ external_accounts: number; items: Row[] }> });
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;
  const items = q.data?.items ?? [];
  return (
    <div className="card cp" style={{ marginTop: 8 }}>
      <p className="sub">{n(q.data?.external_accounts)} tài khoản bên ngoài đang hoạt động.</p>
      {items.length === 0 ? <Note>Chưa có văn bản nào được phát hành, nên chưa yêu cầu khách chấp nhận.</Note> : (
        <table className="tb"><thead><tr><th>Văn bản</th><th>Phiên bản</th><th>Đã chấp nhận</th><th>Chưa chấp nhận</th></tr></thead>
          <tbody>{items.map((i) => <tr key={s(i.document_id)}><td>{LEGAL_KIND_LABEL[s(i.kind)] ?? s(i.kind)}</td><td>{s(i.version)}</td><td>{n(i.accepted)}</td><td>{n(i.pending)}</td></tr>)}</tbody></table>
      )}
    </div>
  );
}
