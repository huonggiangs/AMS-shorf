import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { API_BASE, ApiError, api, errMsg } from '../api/client';
import { useAct } from '../api/hooks';
import { useAuth } from '../auth/AuthProvider';
import { Btn, ErrorBlock, Field, LoadingBlock, Note, PageHead, Tabs, Tag } from '../components/ui';
import { Dialog } from '../components/Dialog';
import { ImportTemplateDialog, exportTemplateFile } from '../components/TemplateImport';
import { fmtDateTime } from '../lib/format';
import { DOC_STATUS, TPL_STATUS, VAR_GROUP, previewText, type DocArticle } from '../lib/ContractDocRender';
import { s, type Row } from '../lib/p4';

const BASE = '/admin/v1/contract-docs';
type Tab = 'doc' | 'tpl' | 'logo';
interface Var { key: string; label: string; group: string; source: 'auto' | 'manual'; default?: string }
interface PriceLine { screen_type: string; region: string; daypart: string; frequency: string; duration_s: string; qty: number; impression_price_vnd: string }
interface DocDetail {
  id: string; version: number; status: string; content_hash: string | null; computed_hash: string; finalized_at: string | null; template_code: string; template_version: number; template_status: string;
  variables: Record<string, string>; effective_variables: Record<string, string>; articles: DocArticle[]; price: { lines: PriceLine[]; value_vnd: number; vat_vnd: number; total_vnd: number; vat_rate: number };
  missing: string[]; text: string;
}

const pdfName = (name: string) => name.replace(/[^A-Za-z0-9._-]/g, '_');

/** Tải PDF bằng phiên đăng nhập hiện tại (cookie) rồi lưu thành tệp. */
async function downloadPdf(docId: string, label: string): Promise<void> {
  const res = await fetch(`${API_BASE}${BASE}/${docId}/pdf`, { credentials: 'include', headers: { Accept: 'application/pdf' } });
  if (!res.ok) {
    let msg = `Không xuất được PDF (${res.status}).`;
    try { msg = ((await res.json()) as { error?: { message?: string } }).error?.message ?? msg; } catch { /* giu thong bao mac dinh */ }
    throw new ApiError(res.status, 'pdf_failed', msg);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = `${pdfName(label)}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Soạn hợp đồng từ mẫu, sửa điều khoản, chốt bản ký và xuất PDF có logo mờ chống sao chép. */
export default function ContractDocEditor() {
  const [tab, setTab] = useState<Tab>('doc');
  return (
    <>
      <PageHead title="Soạn hợp đồng & xuất PDF" sub="Dựng hợp đồng từ mẫu có phiên bản, điền biến, sửa điều khoản, chốt bản ký và tải PDF A4 có logo mờ ở mọi trang." />
      <Tabs label="Soạn hợp đồng" value={tab} onChange={setTab} items={[{ id: 'doc', label: 'Bản soạn' }, { id: 'tpl', label: 'Mẫu hợp đồng' }, { id: 'logo', label: 'Logo watermark' }]} />
      {tab === 'doc' ? <Docs /> : tab === 'tpl' ? <Templates /> : <Logo />}
    </>
  );
}

function Docs() {
  const { can } = useAuth();
  const act = useAct();
  const [sp, setSp] = useSearchParams();
  const contractId = sp.get('contract') ?? '';
  const [docId, setDocId] = useState('');
  const [tplId, setTplId] = useState('');
  const contracts = useQuery({ queryKey: ['/admin/v1/contracts', 'picker'], queryFn: () => api.get('/admin/v1/contracts', { query: { page_size: 200, sort: 'number:asc' } }) as Promise<{ items: Row[] }> });
  const docs = useQuery({ queryKey: [BASE, 'by-contract', contractId], enabled: !!contractId, queryFn: () => api.get(`${BASE}/by-contract/${contractId}`) as Promise<{ items: Row[] }> });
  const tpls = useQuery({ queryKey: [BASE, 'templates'], queryFn: () => api.get(`${BASE}/templates`) as Promise<{ items: Row[] }> });
  const canWrite = can('customers', 'write');
  const items = docs.data?.items ?? [];
  useEffect(() => { setDocId((cur) => (items.some((d) => s(d.id) === cur) ? cur : s(items[0]?.id))); }, [items]);
  const create = async () => {
    const r = await act(() => api.post(`${BASE}/by-contract/${contractId}`, { body: tplId ? { template_id: tplId } : {} }) as Promise<Row>, 'Đã tạo bản soạn mới.', [BASE]);
    if (r) setDocId(s(r.id));
  };
  return (
    <div style={{ marginTop: 8 }}>
      <div className="card cp">
        <div className="g g2">
          <Field label="Hợp đồng">
            <select className="sel" value={contractId} onChange={(e) => { setSp(e.target.value ? { contract: e.target.value } : {}); setDocId(''); }}>
              <option value="">— Chọn hợp đồng —</option>
              {(contracts.data?.items ?? []).map((c) => <option key={s(c.id)} value={s(c.id)}>{s(c.number)} · {s(c.customer_name)}</option>)}
            </select>
          </Field>
          {contractId && canWrite ? (
            <Field label="Tạo bản soạn mới từ mẫu">
              <span style={{ display: 'flex', gap: 8 }}>
                <select className="sel" value={tplId} onChange={(e) => setTplId(e.target.value)} aria-label="Mẫu hợp đồng">
                  <option value="">Mẫu mới nhất (ưu tiên bản đã duyệt)</option>
                  {(tpls.data?.items ?? []).filter((t) => t.status !== 'retired').map((t) => <option key={s(t.id)} value={s(t.id)}>{s(t.name)} · v{s(t.version)} · {TPL_STATUS[s(t.status)]?.label}</option>)}
                </select>
                <Btn tone="p" onClick={() => void create()} disabled={items.some((d) => d.status === 'draft')} title={items.some((d) => d.status === 'draft') ? 'Hợp đồng này đã có bản nháp đang soạn' : undefined}>Tạo bản soạn</Btn>
              </span>
            </Field>
          ) : null}
        </div>
        {contracts.error ? <ErrorBlock error={contracts.error} /> : null}
        {contractId && docs.isLoading ? <LoadingBlock /> : null}
        {contractId && docs.error ? <ErrorBlock error={docs.error} onRetry={() => void docs.refetch()} /> : null}
        {contractId && !docs.isLoading && !items.length ? <Note>Hợp đồng này chưa có bản soạn. Bấm “Tạo bản soạn” để dựng từ mẫu.</Note> : null}
        {items.length ? (
          <div role="tablist" aria-label="Các phiên bản" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {items.map((d) => (
              <button key={s(d.id)} type="button" role="tab" aria-selected={s(d.id) === docId} className={`btn ${s(d.id) === docId ? 'p' : ''}`} onClick={() => setDocId(s(d.id))}>
                Phiên bản {s(d.version)} · {DOC_STATUS[s(d.status)]?.label ?? s(d.status)}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {!contractId ? <Note>Chọn một hợp đồng để soạn văn bản. Có thể mở nhanh từ danh sách hợp đồng bằng đường dẫn <span className="mono">?contract=&lt;mã hợp đồng&gt;</span>.</Note> : null}
      {docId ? <Editor key={docId} docId={docId} /> : null}
    </div>
  );
}

function Editor({ docId }: { docId: string }) {
  const { can } = useAuth();
  const act = useAct();
  const canWrite = can('customers', 'write');
  const canFinal = can('admin', 'approve');
  const q = useQuery({ queryKey: [BASE, 'doc', docId], queryFn: () => api.get(`${BASE}/${docId}`) as Promise<DocDetail> });
  const vars = useQuery({ queryKey: [BASE, 'variables'], queryFn: () => api.get(`${BASE}/variables`) as Promise<{ items: Var[] }> });
  const [localVars, setLocalVars] = useState<Record<string, string> | null>(null);
  const [localArts, setLocalArts] = useState<DocArticle[] | null>(null);
  const [open, setOpen] = useState('');
  const [fin, setFin] = useState(false);
  const [err, setErr] = useState('');
  const d = q.data;
  const editable = canWrite && d?.status === 'draft';
  const curVars = localVars ?? d?.variables ?? {};
  const curArts = localArts ?? d?.articles ?? [];
  const dirty = localVars !== null || localArts !== null;
  const priceLines = useMemo(() => (d?.price.lines ?? []).map((l, i) => `${i + 1}. ${l.screen_type} | ${l.region} | ${l.daypart} | ${l.frequency} lần | ${l.duration_s} giây | SL ${l.qty} | ${l.impression_price_vnd || '—'} ₫/lượt`).concat(d ? [`Trước thuế ${d.price.value_vnd.toLocaleString('vi-VN')} ₫ · VAT ${d.price.vat_rate}%: ${d.price.vat_vnd.toLocaleString('vi-VN')} ₫ · Tổng ${d.price.total_vnd.toLocaleString('vi-VN')} ₫`] : []), [d]);
  const live = useMemo(() => (d ? previewText(curArts, d.effective_variables, curVars, priceLines) : { text: '', missing: [] as string[] }), [d, curArts, curVars, priceLines]);
  if (q.isLoading) return <LoadingBlock />;
  if (q.error || !d) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;
  const groups = ['seller', 'customer', 'contract', 'payment', 'terms'];
  const overrides = () => {
    const o: Record<string, { title?: string; body?: string }> = {};
    for (const a of curArts) {
      const orig = d.articles.find((x) => x.key === a.key);
      if (!orig) continue;
      // chi gui dieu khoan da sua so voi mau: so sanh voi ban dang luu cua may chu cho nhanh
      if (a.overridden || a.body !== orig.body || a.title !== orig.title) o[a.key] = { title: a.title, body: a.body };
    }
    return o;
  };
  const save = async () => {
    setErr('');
    try {
      await api.put(`${BASE}/${docId}`, { body: { variables: curVars, article_overrides: overrides() } });
      setLocalVars(null);
      setLocalArts(null);
      await act(async () => undefined, 'Đã lưu bản soạn.', [BASE]);
    } catch (e) {
      setErr(errMsg(e));
    }
  };
  const setArt = (key: string, p: Partial<DocArticle>) => setLocalArts(curArts.map((a) => (a.key === key ? { ...a, ...p, overridden: true } : a)));
  return (
    <div className="g g2" style={{ marginTop: 10, alignItems: 'start' }}>
      <div>
        <div className="card cp">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Tag tone={DOC_STATUS[d.status]?.tone ?? 'info'}>{DOC_STATUS[d.status]?.label ?? d.status}</Tag>
            <span className="sub">Phiên bản {d.version} · mẫu {d.template_code} v{d.template_version} · <Tag tone={TPL_STATUS[d.template_status]?.tone ?? 'info'}>{TPL_STATUS[d.template_status]?.label ?? d.template_status}</Tag></span>
          </div>
          {d.status === 'draft' && d.template_status !== 'approved' ? <Note warn>Mẫu này chưa được luật sư duyệt. Bản PDF xuất ra mang dòng “BẢN NHÁP” và không thể chốt để ký cho đến khi mẫu được duyệt.</Note> : null}
          {d.status === 'draft' ? <Note>PDF của bản nháp luôn có dấu “BẢN NHÁP”. Chốt bản (người có quyền duyệt) để xuất bản ký không có dấu và khóa nội dung.</Note> : null}
          <div className="sub" style={{ margin: '6px 0' }}>Dấu vân tay nội dung (SHA-256): <span className="mono" data-testid="doc-hash">{(d.content_hash ?? d.computed_hash).slice(0, 24)}…</span>{d.finalized_at ? ` · chốt ${fmtDateTime(d.finalized_at)}` : ''}</div>
          {live.missing.length ? <Note warn>Còn {live.missing.length} thông tin trống: {live.missing.join(', ')}. Điền ở mục “Biến” bên dưới.</Note> : null}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            {editable ? <Btn tone="p" onClick={() => void save()} disabled={!dirty}>Lưu bản soạn</Btn> : null}
            <Btn onClick={() => void act(() => downloadPdf(docId, `HD-v${d.version}${d.status === 'draft' ? '-BAN-NHAP' : ''}`), 'Đã tải PDF.', [])} disabled={dirty} title={dirty ? 'Lưu trước khi xuất PDF' : undefined}>Tải PDF{d.status === 'draft' ? ' (bản nháp)' : ''}</Btn>
            {editable && canFinal ? <Btn tone="p" onClick={() => setFin(true)} disabled={dirty}>Chốt bản ký…</Btn> : null}
            {editable && !canFinal ? <span className="sub">Chỉ người có quyền duyệt (admin:approve) mới chốt được.</span> : null}
          </div>
          {err ? <Note warn>{err}</Note> : null}
        </div>

        <div className="card cp" style={{ marginTop: 10 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Biến</h3>
          <p className="sub">Ô để trống thì dùng giá trị tự động từ hồ sơ khách hàng và hợp đồng (hiện mờ). Nhập để ghi đè.</p>
          {groups.map((g) => (
            <fieldset key={g} style={{ border: 0, padding: 0, margin: '8px 0' }}>
              <legend style={{ fontWeight: 600, fontSize: 13.5 }}>{VAR_GROUP[g]}</legend>
              <div className="g g2">
                {(vars.data?.items ?? []).filter((v) => v.group === g).map((v) => (
                  <Field key={v.key} label={v.label}>
                    <input value={curVars[v.key] ?? ''} placeholder={d.effective_variables[v.key] ?? v.default ?? ''} disabled={!editable} onChange={(e) => setLocalVars({ ...curVars, [v.key]: e.target.value })} />
                  </Field>
                ))}
              </div>
            </fieldset>
          ))}
        </div>

        <div className="card cp" style={{ marginTop: 10 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Điều khoản</h3>
          {curArts.map((a, i) => {
            const no = a.numbered === false ? null : curArts.slice(0, i + 1).filter((x) => x.numbered !== false).length;
            const orig = d.articles.find((x) => x.key === a.key);
            return (
              <div key={a.key} style={{ borderTop: '1px solid var(--line, #ddd)', padding: '6px 0' }}>
                <button type="button" className="btn" aria-expanded={open === a.key} onClick={() => setOpen(open === a.key ? '' : a.key)}>
                  {no ? `Điều ${no}. ` : ''}{a.title}{a.overridden ? ' (đã sửa)' : ''}
                </button>
                {open === a.key ? (
                  <div style={{ marginTop: 6 }}>
                    <Field label="Tiêu đề"><input value={a.title} disabled={!editable} onChange={(e) => setArt(a.key, { title: e.target.value })} /></Field>
                    <Field label="Nội dung" hint="Dùng {{tên.biến}} để chèn biến; dòng trống tách đoạn; dòng bắt đầu bằng “- ” là gạch đầu dòng; **đậm**.">
                      <textarea rows={8} style={{ width: '100%', fontFamily: 'inherit' }} value={a.body} disabled={!editable} onChange={(e) => setArt(a.key, { body: e.target.value })} aria-label={`Nội dung ${a.title}`} />
                    </Field>
                    {editable && orig ? <Btn onClick={() => setLocalArts(curArts.map((x) => (x.key === a.key ? { ...x, title: orig.title, body: orig.body, overridden: false } : x)))}>Khôi phục theo mẫu</Btn> : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="card cp" style={{ position: 'sticky', top: 8 }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Xem trước nội dung {dirty ? <Tag tone="warn">Chưa lưu</Tag> : null}</h3>
        <pre data-testid="doc-preview" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '70vh', overflow: 'auto', font: 'inherit', fontSize: 13.5, margin: 0 }}>{live.text}</pre>
      </div>
      {fin ? <FinalizeDialog doc={d} onClose={() => setFin(false)} /> : null}
    </div>
  );
}

function FinalizeDialog({ doc, onClose }: { doc: DocDetail; onClose: () => void }) {
  const act = useAct();
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState('');
  const submit = async () => {
    setErr('');
    try {
      await api.post(`${BASE}/${doc.id}/finalize`, { body: { content_hash: doc.computed_hash } });
      await act(async () => undefined, 'Đã chốt bản ký. Nội dung không sửa được nữa.', [BASE]);
      onClose();
    } catch (e) {
      const miss = e instanceof ApiError && e.code === 'missing_variables' ? ((e.details as { missing?: string[] } | undefined)?.missing ?? []) : [];
      setErr(miss.length ? `Còn thông tin trống: ${miss.join(', ')}.` : errMsg(e));
    }
  };
  return (
    <Dialog open onClose={onClose} size="md" label="Chốt bản ký">
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <h2 style={{ margin: '0 0 10px', fontSize: 18 }}>Chốt bản ký phiên bản {doc.version}</h2>
        <Note warn>Sau khi chốt, nội dung bị khóa và dấu vân tay SHA-256 được ghi vào nhật ký. Muốn đổi phải tạo phiên bản mới. Mẫu phải đã được luật sư duyệt.</Note>
        <p className="sub">Dấu vân tay: <span className="mono">{doc.computed_hash}</span></p>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '10px 0' }}><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> Tôi đã kiểm tra nội dung và bảng giá của bản này</label>
        {err ? <Note warn>{err}</Note> : null}
        <div className="da" style={{ marginTop: 14 }}>
          <button type="button" className="btn" onClick={onClose}>Hủy</button>
          <button type="submit" className="btn p" disabled={!ok}>Chốt bản ký</button>
        </div>
      </form>
    </Dialog>
  );
}

function Templates() {
  const { can } = useAuth();
  const canApprove = can('admin', 'approve');
  const q = useQuery({ queryKey: [BASE, 'templates'], queryFn: () => api.get(`${BASE}/templates`) as Promise<{ items: Row[] }> });
  const [view, setView] = useState('');
  const [ap, setAp] = useState<Row | null>(null);
  const [imp, setImp] = useState(false);
  const act = useAct();
  const canImport = can('admin', 'write');
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;
  return (
    <div style={{ marginTop: 8 }}>
      <Note warn>Mẫu nạp sẵn là BẢN NHÁP do kỹ thuật soạn, chưa có giá trị pháp lý. Luật sư rà soát, điền các chỗ trống dạng [...], rồi người có quyền duyệt xác nhận. Chỉ mẫu đã duyệt mới chốt được bản ký.</Note>
      {canImport ? <div style={{ margin: '8px 0' }}><Btn tone="p" onClick={() => setImp(true)}>Nhập mẫu từ máy tính</Btn></div> : null}
      <div className="card cp">
        <table className="tb">
          <thead><tr><th>Mẫu</th><th>Phiên bản</th><th>Trạng thái</th><th>Điều khoản</th><th /></tr></thead>
          <tbody>
            {(q.data?.items ?? []).map((t) => (
              <tr key={s(t.id)}>
                <td>{s(t.name)}</td><td>{s(t.version)}</td>
                <td><Tag tone={TPL_STATUS[s(t.status)]?.tone ?? 'info'}>{TPL_STATUS[s(t.status)]?.label ?? s(t.status)}</Tag>{(t.draft_problems as string[]).length ? <div className="sub">{(t.draft_problems as string[]).join('; ')}</div> : null}</td>
                <td>{s(t.article_count)}</td>
                <td style={{ display: 'flex', gap: 6 }}>
                  <Btn onClick={() => setView(view === s(t.id) ? '' : s(t.id))}>{view === s(t.id) ? 'Ẩn' : 'Xem'}</Btn>
                  <Btn onClick={() => void act(() => exportTemplateFile(s(t.id), `${s(t.name)}-v${s(t.version)}`), 'Đã xuất mẫu ra tệp .json.', [])}>Xuất mẫu ra file</Btn>
                  {t.status === 'draft' && canApprove ? <Btn tone="p" onClick={() => setAp(t)}>Xác nhận luật sư đã duyệt</Btn> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {view ? <TemplateBody id={view} /> : null}
      </div>
      {ap ? <ApproveDialog tpl={ap} onClose={() => setAp(null)} /> : null}
      {imp ? <ImportTemplateDialog onClose={() => setImp(false)} /> : null}
    </div>
  );
}

function TemplateBody({ id }: { id: string }) {
  const q = useQuery({ queryKey: [BASE, 'template', id], queryFn: () => api.get(`${BASE}/templates/${id}`) as Promise<{ articles: DocArticle[] }> });
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} />;
  return <div style={{ marginTop: 10 }}>{(q.data?.articles ?? []).map((a) => <details key={a.key}><summary>{a.title}</summary><pre style={{ whiteSpace: 'pre-wrap', font: 'inherit', fontSize: 13 }}>{a.body}</pre></details>)}</div>;
}

function ApproveDialog({ tpl, onClose }: { tpl: Row; onClose: () => void }) {
  const act = useAct();
  const problems = (tpl.draft_problems as string[]) ?? [];
  const [ok, setOk] = useState(false);
  const [ref, setRef] = useState('');
  const [force, setForce] = useState(false);
  const [err, setErr] = useState('');
  const submit = async () => {
    setErr('');
    try {
      await api.post(`${BASE}/templates/${s(tpl.id)}/approve`, { body: { confirm_lawyer_approved: true, lawyer_ref: ref || undefined, allow_draft_markers: force || undefined } });
      await act(async () => undefined, 'Đã duyệt mẫu hợp đồng.', [BASE]);
      onClose();
    } catch (e) {
      setErr(errMsg(e));
    }
  };
  return (
    <Dialog open onClose={onClose} size="md" label="Duyệt mẫu hợp đồng">
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <h2 style={{ margin: '0 0 10px', fontSize: 18 }}>Duyệt mẫu {s(tpl.name)} · v{s(tpl.version)}</h2>
        {problems.length ? <Note warn>Mẫu còn dấu hiệu bản nháp ({problems.join('; ')}). Nên để luật sư hoàn thiện trước.</Note> : null}
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '10px 0' }}><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> Tôi xác nhận luật sư đã duyệt nội dung mẫu này</label>
        <Field label="Tham chiếu ý kiến luật sư (không bắt buộc)"><input value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
        {problems.length ? <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0' }}><input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} /> Vẫn duyệt dù còn dấu hiệu bản nháp</label> : null}
        {err ? <Note warn>{err}</Note> : null}
        <div className="da" style={{ marginTop: 14 }}>
          <button type="button" className="btn" onClick={onClose}>Hủy</button>
          <button type="submit" className="btn p" disabled={!ok}>Duyệt mẫu</button>
        </div>
      </form>
    </Dialog>
  );
}

const MAX_LOGO = 600 * 1024;
function Logo() {
  const { can } = useAuth();
  const act = useAct();
  const canWrite = can('admin', 'write');
  const q = useQuery({ queryKey: [BASE, 'logo'], queryFn: () => api.get(`${BASE}/logo`) as Promise<{ is_default: boolean; default_text: string; logo: Row | null }> });
  const [err, setErr] = useState('');
  const [bust, setBust] = useState(0);
  const pick = async (f: File | undefined) => {
    setErr('');
    if (!f) return;
    if (f.type !== 'image/png' && f.type !== 'image/jpeg') return setErr('Chỉ nhận ảnh PNG hoặc JPEG.');
    if (f.size > MAX_LOGO) return setErr('Logo tối đa 600 KB.');
    const dataUrl = await new Promise<string>((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result));
      fr.onerror = () => rej(new Error('Không đọc được tệp.'));
      fr.readAsDataURL(f);
    });
    const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const r = await act(() => api.put(`${BASE}/logo`, { body: { content_type: f.type, data_base64: b64 } }), 'Đã cập nhật logo watermark.', [BASE]);
    if (r) setBust((b) => b + 1);
  };
  if (q.isLoading) return <LoadingBlock />;
  if (q.error) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;
  const logo = q.data?.logo;
  return (
    <div className="card cp" style={{ marginTop: 8 }}>
      <p className="sub">Logo hiện mờ (khoảng 9%), xoay chéo, ở giữa mọi trang PDF và nằm dưới chữ. Chưa tải logo thì dùng chữ “{q.data?.default_text ?? 'ANIO'}”.</p>
      {logo ? (
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', margin: '10px 0' }}>
          <img key={bust} src={`${API_BASE}${BASE}/logo/image?v=${s(logo.sha256).slice(0, 8)}`} alt="Logo watermark hiện tại" style={{ maxWidth: 160, maxHeight: 120, background: '#fff', border: '1px solid var(--line, #ddd)' }} />
          <div className="sub">{s(logo.width)}×{s(logo.height)} điểm ảnh · {Math.round(Number(logo.bytes) / 1024)} KB · {s(logo.content_type)}</div>
        </div>
      ) : <Note>Đang dùng logo chữ mặc định “{q.data?.default_text ?? 'ANIO'}”.</Note>}
      {canWrite ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Field label="Tải logo mới (PNG nền trong suốt cho đẹp nhất, tối đa 600 KB)"><input type="file" accept="image/png,image/jpeg" onChange={(e) => void pick(e.target.files?.[0])} /></Field>
          {logo ? <Btn onClick={() => { if (window.confirm('Xóa logo và quay về logo chữ mặc định?')) void act(() => api.del(`${BASE}/logo`), 'Đã xóa logo.', [BASE]); }}>Xóa logo</Btn> : null}
        </div>
      ) : <Note>Chỉ quản trị viên có quyền ghi (admin) mới đổi được logo.</Note>}
      {err ? <Note warn>{err}</Note> : null}
    </div>
  );
}
