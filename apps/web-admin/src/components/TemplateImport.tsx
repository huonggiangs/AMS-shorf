import { useRef, useState } from 'react';
import { api, errMsg, postBlob } from '../api/client';
import { useAct } from '../api/hooks';
import { Dialog } from './Dialog';
import { Field, LoadingBlock, Note } from './ui';

const BASE = '/admin/v1/contract-docs';
export const IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const IMPORT_ACCEPT = '.docx,.txt,.md,.html,.htm,.json';
interface Article { key: string; title: string; body: string; numbered?: boolean }
interface Preview { source: 'docx' | 'txt' | 'md' | 'html' | 'json'; name: string; articles: Article[]; issues: { code: string; message: string }[]; warnings: string[]; mapped: { from: string; to: string }[] }

/** Kiểm tra tệp ở trình duyệt trước khi gửi (máy chủ kiểm tra lại): trả về lỗi tiếng Việt hoặc chuỗi rỗng. */
export function checkImportFile(f: { name: string; size: number }): string {
  if (!/\.(docx|txt|md|html?|json)$/i.test(f.name)) return 'Chỉ nhập được tệp .docx, .txt, .md, .html hoặc .json.';
  if (f.size === 0) return 'Tệp rỗng.';
  if (f.size > IMPORT_MAX_BYTES) return 'Tệp quá lớn (tối đa 2 MB).';
  return '';
}

/** Nhập mẫu hợp đồng từ máy tính: chọn tệp -> máy chủ phân tích và làm sạch (chỉ văn bản) -> xem trước, sửa tên -> lưu thành phiên bản NHÁP mới. */
export function ImportTemplateDialog({ onClose }: { onClose: () => void }) {
  const act = useAct();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pv, setPv] = useState<Preview | null>(null);
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const pick = async (f: File | undefined) => {
    setPv(null); setErr('');
    if (!f) return;
    const bad = checkImportFile(f);
    if (bad) return setErr(bad);
    setFile(f); setBusy(true);
    try {
      const r = await postBlob<Preview>(`${BASE}/templates/import-preview`, f, { filename: f.name });
      setPv(r); setName(r.name);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (!pv || !file) return;
    const r = await act(() => api.post(`${BASE}/templates`, { body: { code: 'ads-service', name: name.trim(), articles: pv.articles, change_note: `Nhập từ tệp ${file.name}`.slice(0, 500), import_source: pv.source } }), 'Đã lưu mẫu thành bản nháp mới. Cần luật sư duyệt trước khi chốt hợp đồng.', [BASE]);
    if (r !== undefined) onClose();
  };
  return (
    <Dialog open onClose={onClose} size="lg" label="Nhập mẫu hợp đồng từ máy tính">
      <h2 style={{ margin: '0 0 10px', fontSize: 18 }}>Nhập mẫu từ máy tính</h2>
      <Field label="Tệp mẫu (.docx, .txt, .md, .html hoặc .json xuất từ hệ thống; tối đa 2 MB)">
        <input ref={input} type="file" accept={IMPORT_ACCEPT} onChange={(e) => void pick(e.target.files?.[0])} />
      </Field>
      <Note>Chỉ giữ lại văn bản: mã HTML/script bị loại bỏ, bảng giá được thay bằng {'{{price_table}}'}, trường dạng [Tên khách hàng] được đổi sang biến {'{{customer.legal_name}}'} khi nhận ra. Mẫu nhập vào luôn là bản NHÁP.</Note>
      {busy ? <LoadingBlock /> : null}
      {err ? <p role="alert" style={{ color: 'var(--bad)' }}>{err}</p> : null}
      {pv ? (
        <div style={{ marginTop: 10 }}>
          <Field label="Tên mẫu"><input value={name} onChange={(e) => setName(e.target.value)} minLength={3} maxLength={200} /></Field>
          {pv.issues.length ? <div role="alert"><Note warn>Chưa lưu được, cần sửa tệp: {pv.issues.map((i) => i.message).join(' ')}</Note></div> : null}
          {pv.warnings.map((w) => <Note key={w} warn>{w}</Note>)}
          {pv.mapped.length ? <details><summary>Đã đổi {pv.mapped.length} trường sang biến chuẩn</summary><ul>{pv.mapped.map((m) => <li key={m.from + m.to}><span className="mono">{m.from}</span> → <span className="mono">{m.to}</span></li>)}</ul></details> : null}
          <h3 style={{ margin: '12px 0 6px', fontSize: 15 }}>Xem trước · {pv.articles.length} điều khoản</h3>
          <div style={{ maxHeight: 320, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 8, padding: '4px 10px' }}>
            {pv.articles.map((a, i) => <details key={a.key} open={i === 0}><summary>{a.numbered === false ? a.title : `Điều ${i + (pv.articles[0]?.numbered === false ? 0 : 1)}. ${a.title}`}</summary><pre style={{ whiteSpace: 'pre-wrap', font: 'inherit', fontSize: 13 }}>{a.body}</pre></details>)}
          </div>
        </div>
      ) : null}
      <div className="da" style={{ marginTop: 14 }}>
        <button type="button" className="btn" onClick={onClose}>Hủy</button>
        <button type="button" className="btn p" disabled={!pv || busy || pv.issues.length > 0 || name.trim().length < 3} onClick={() => void save()}>Lưu thành bản nháp mới</button>
      </div>
    </Dialog>
  );
}

/** Tải mẫu về máy dưới dạng .json (nhập lại được bằng chính hộp thoại trên). */
export async function exportTemplateFile(id: string, label: string): Promise<void> {
  const data = await api.get(`${BASE}/templates/${id}/export`);
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${label.replace(/[^A-Za-z0-9._-]/g, '_') || 'mau-hop-dong'}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
