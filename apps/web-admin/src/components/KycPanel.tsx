import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, errMsg } from '../api/client';
import { useAct } from '../api/hooks';
import { Btn, ErrorBlock, Field, LoadingBlock, Note, Tag } from './ui';
import { fmtDateTime } from '../lib/format';
import { AD_CATEGORY_LABEL, KYC_DOC_LABEL, KYC_DOC_STATE, KYC_STATE, RESTRICTED_CATEGORIES, n, s, uploadKycFile, type Row } from '../lib/p4';

interface View { customer?: { id: string; name: string; industry: string | null }; profile: Row; documents: Row[] }
const PROFILE_FIELDS: { key: string; label: string; type?: string }[] = [
  { key: 'business_reg_no', label: 'Mã số doanh nghiệp / ĐKKD' },
  { key: 'business_reg_date', label: 'Ngày cấp', type: 'date' },
  { key: 'business_reg_place', label: 'Nơi cấp' },
  { key: 'legal_rep_name', label: 'Người đại diện pháp luật' },
  { key: 'legal_rep_title', label: 'Chức danh' },
];

/**
 * Hồ sơ pháp lý (KYC) của một khách hàng. `base` = `/portal/v1/kyc` (khách tự nộp) hoặc `/admin/v1/compliance/kyc/<id>` (nhân viên).
 * `canWrite`: nhập hồ sơ/tải tệp/nộp; `canReview`: duyệt từng tệp và ra quyết định (khác người nộp).
 */
export function KycPanel({ base, canWrite, canReview = false }: { base: string; canWrite: boolean; canReview?: boolean }) {
  const act = useAct();
  const q = useQuery({ queryKey: [base], queryFn: () => api.get(base) as Promise<View> });
  const [f, setF] = useState<Record<string, string> | null>(null);
  const [docType, setDocType] = useState('business_registration');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [dec, setDec] = useState<{ restricted: boolean; cats: string[]; note: string }>({ restricted: false, cats: [], note: '' });
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;
  const p = q.data?.profile ?? {};
  const docs = q.data?.documents ?? [];
  const state = s(p.state) || 'none';
  const form = f ?? Object.fromEntries(PROFILE_FIELDS.map((x) => [x.key, s(p[x.key])]));
  const editable = canWrite && state !== 'submitted' && state !== 'approved';
  const inv = [base];
  const upload = async () => {
    if (!file) return;
    setBusy(true);
    setErr('');
    try {
      await uploadKycFile(base, file, { doc_type: docType });
      setFile(null);
      await act(async () => undefined, 'Đã tải tệp lên.', inv);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div aria-label="Hồ sơ pháp lý">
      <p className="sub">Trạng thái hồ sơ: <Tag tone={KYC_STATE[state]?.tone ?? 'info'}>{KYC_STATE[state]?.label ?? state}</Tag>{s(p.review_note) ? <> · Ghi chú duyệt: {s(p.review_note)}</> : null}{p.restricted_industry ? <> · <Tag tone="warn">Ngành hạn chế</Tag></> : null}</p>
      <form onSubmit={(e) => { e.preventDefault(); void act(() => api.put(`${base}/profile`, { body: Object.fromEntries(PROFILE_FIELDS.map((x) => [x.key, form[x.key] ? form[x.key] : null])) }), 'Đã lưu thông tin doanh nghiệp.', inv).then(() => setF(null)); }}>
        <div className="g g2">
          {PROFILE_FIELDS.map((x) => <Field key={x.key} label={x.label}><input type={x.type ?? 'text'} value={form[x.key] ?? ''} disabled={!editable} onChange={(e) => setF({ ...form, [x.key]: e.target.value })} /></Field>)}
        </div>
        {editable ? <div className="acts" style={{ marginTop: 8 }}><Btn type="submit">Lưu thông tin</Btn></div> : null}
      </form>

      <h3 style={{ margin: '16px 0 6px', fontSize: 15 }}>Giấy tờ đính kèm</h3>
      {docs.length === 0 ? <Note>Chưa có tệp nào. Cần giấy chứng nhận đăng ký doanh nghiệp; ngành đặc thù cần thêm giấy phép ngành nghề.</Note> : (
        <div style={{ overflowX: 'auto' }}>
          <table className="tb">
            <thead><tr><th>Loại giấy tờ</th><th>Tệp</th><th>Hết hạn</th><th>Trạng thái</th><th /></tr></thead>
            <tbody>
              {docs.map((d) => (
                <tr key={s(d.id)}>
                  <td>{KYC_DOC_LABEL[s(d.doc_type)] ?? s(d.doc_type)}</td>
                  <td>{d.preview_url ? <a href={s(d.preview_url)} target="_blank" rel="noreferrer">{s(d.file_name)}</a> : s(d.file_name)} <small>({Math.ceil(n(d.size_bytes) / 1024)} KB)</small></td>
                  <td>{s(d.expires_on) || '—'}</td>
                  <td><Tag tone={KYC_DOC_STATE[s(d.state)]?.tone ?? 'info'}>{KYC_DOC_STATE[s(d.state)]?.label ?? s(d.state)}</Tag>{s(d.note) ? <small> {s(d.note)}</small> : null}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {canReview && s(d.state) === 'pending' ? (
                      <span style={{ display: 'flex', gap: 6 }}>
                        <Btn tone="p" onClick={() => void act(() => api.post(`${base}/documents/${s(d.id)}/review`, { body: { decision: 'approve' } }), 'Đã duyệt tệp.', inv)}>Duyệt tệp</Btn>
                        <Btn onClick={() => { const note = window.prompt('Lý do từ chối tệp'); if (note) void act(() => api.post(`${base}/documents/${s(d.id)}/review`, { body: { decision: 'reject', note } }), 'Đã từ chối tệp.', inv); }}>Từ chối tệp</Btn>
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editable ? (
        <div className="card cp" style={{ marginTop: 8 }}>
          <div className="g g2">
            <Field label="Loại giấy tờ"><select className="sel" value={docType} onChange={(e) => setDocType(e.target.value)}>{Object.entries(KYC_DOC_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="Tệp (PDF, PNG hoặc JPG)"><input type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
          </div>
          <div className="acts" style={{ marginTop: 8 }}>
            <Btn disabled={!file || busy} onClick={() => void upload()}>{busy ? 'Đang tải…' : 'Tải tệp lên'}</Btn>
            <Btn tone="p" onClick={() => void act(() => api.post(`${base}/submit`), 'Đã nộp hồ sơ để duyệt.', inv)}>Nộp hồ sơ để duyệt</Btn>
          </div>
        </div>
      ) : null}
      {err ? <Note warn>{err}</Note> : null}

      {canReview && state === 'submitted' ? (
        <div className="card cp" style={{ marginTop: 12 }} aria-label="Quyết định duyệt hồ sơ">
          <div className="ch"><h2>Quyết định duyệt hồ sơ</h2></div>
          <Note>Người duyệt phải khác người đã nộp hồ sơ. Ngành hạn chế sẽ cần duyệt lần hai ở từng chiến dịch.</Note>
          <label style={{ display: 'flex', gap: 8, margin: '8px 0' }}><input type="checkbox" checked={dec.restricted} onChange={(e) => setDec({ ...dec, restricted: e.target.checked })} /> Khách thuộc ngành hạn chế (cần duyệt lần hai nội dung)</label>
          {dec.restricted ? (
            <div role="group" aria-label="Nhóm ngành hạn chế" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, margin: '6px 0' }}>
              {RESTRICTED_CATEGORIES.map((c) => <label key={c} style={{ display: 'flex', gap: 4 }}><input type="checkbox" checked={dec.cats.includes(c)} onChange={(e) => setDec({ ...dec, cats: e.target.checked ? [...dec.cats, c] : dec.cats.filter((x) => x !== c) })} />{AD_CATEGORY_LABEL[c] ?? c}</label>)}
            </div>
          ) : null}
          <Field label="Ghi chú"><input value={dec.note} onChange={(e) => setDec({ ...dec, note: e.target.value })} /></Field>
          <div className="acts" style={{ marginTop: 8 }}>
            <Btn tone="p" onClick={() => void act(() => api.post(`${base}/decision`, { body: { decision: 'approve', restricted_industry: dec.restricted, restricted_categories: dec.cats, ...(dec.note ? { note: dec.note } : {}) } }), 'Đã duyệt hồ sơ.', inv)}>Duyệt hồ sơ</Btn>
            <Btn tone="d" onClick={() => { if (!dec.note.trim()) { setErr('Nhập ghi chú lý do từ chối.'); return; } void act(() => api.post(`${base}/decision`, { body: { decision: 'reject', note: dec.note } }), 'Đã từ chối hồ sơ.', inv); }}>Từ chối hồ sơ</Btn>
          </div>
        </div>
      ) : null}
      {s(p.submitted_at) ? <p className="sub">Nộp lúc {fmtDateTime(s(p.submitted_at))}{s(p.reviewed_at) ? ` · duyệt lúc ${fmtDateTime(s(p.reviewed_at))}` : ''}</p> : null}
    </div>
  );
}
