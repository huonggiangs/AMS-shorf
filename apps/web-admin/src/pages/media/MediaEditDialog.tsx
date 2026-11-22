import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, errMsg } from '../../api/client';
import { customerSchema, listOf, type Media } from '../../api/schemas';
import { useAct, useBase } from '../../api/hooks';
import { Field } from '../../components/ui';
import { Dialog } from '../../components/Dialog';

const parseTags = (s: string): string[] => [...new Set(s.split(/[,\n]/).map((x) => x.trim().replace(/^#/, '')).filter(Boolean))];

/** Sửa metadata: tên, mô tả, thẻ, thời lượng (ảnh), khách hàng (nhân viên, khi chưa gắn chiến dịch), đường dẫn (tệp liên kết: đổi => duyệt lại). */
export function MediaEditDialog({ m, onClose }: { m: Media; onClose: () => void }) {
  const base = useBase();
  const act = useAct();
  const isImage = m.kind === 'image' || !!m.mime?.startsWith('image/');
  const isLink = m.kind === 'link' || (!!m.source && m.source !== 'upload');
  const [name, setName] = useState(m.name);
  const [desc, setDesc] = useState(m.description ?? '');
  const [tags, setTags] = useState(m.tags.join(', '));
  const [dur, setDur] = useState(m.duration_sec ? String(m.duration_sec) : '');
  const [url, setUrl] = useState(m.source_url ?? '');
  const [cust, setCust] = useState(m.customer_id ?? '');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const canCust = !base.isExternal && !m.campaign_id;
  const custs = useQuery({ queryKey: ['/admin/v1/customers', 'pick'], enabled: canCust, queryFn: () => api.get('/admin/v1/customers', { query: { page_size: 200 }, schema: listOf(customerSchema) }) });
  const urlChanged = isLink && url.trim() !== (m.source_url ?? '');

  const submit = async () => {
    setErr('');
    const body: Record<string, unknown> = {};
    if (!name.trim()) return setErr('Nhập tên tệp.');
    if (name.trim() !== m.name) body.name = name.trim();
    if (desc.trim() !== (m.description ?? '')) body.description = desc.trim() || null;
    const tl = parseTags(tags);
    if (tl.join('|') !== m.tags.join('|')) {
      if (tl.length > 10) return setErr('Tối đa 10 thẻ.');
      body.tags = tl;
    }
    if (isImage && dur !== (m.duration_sec ? String(m.duration_sec) : '')) {
      const d = Number(dur);
      if (!Number.isInteger(d) || d < 1 || d > 3600) return setErr('Thời lượng ảnh phải là số giây từ 1 đến 3600.');
      body.duration_sec = d;
    }
    if (canCust && cust && cust !== m.customer_id) body.customer_id = cust;
    if (urlChanged) body.source_url = url.trim();
    if (!Object.keys(body).length) return setErr('Chưa có thay đổi nào để lưu.');
    setBusy(true);
    try {
      await api.patch(`${base.media}/${m.id}`, { body });
      await act(async () => undefined, urlChanged ? 'Đã lưu. Đường dẫn mới cần được duyệt lại.' : 'Đã lưu thay đổi.', [base.media, '/admin/v1/media', '/portal/v1/media']);
      onClose();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} size="md" label="Sửa media">
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <h2 style={{ margin: '0 0 10px', fontSize: 18 }}>Sửa thông tin: {m.name}</h2>
        <Field label="Tên hiển thị"><input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} required /></Field>
        <Field label="Mô tả"><textarea value={desc} maxLength={1000} onChange={(e) => setDesc(e.target.value)} /></Field>
        <Field label="Thẻ (cách nhau bằng dấu phẩy, tối đa 10)"><input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="tet, khuyen-mai" /></Field>
        {isImage ? <Field label="Thời lượng hiển thị của ảnh (giây)"><input type="number" min={1} max={3600} value={dur} onChange={(e) => setDur(e.target.value)} /></Field> : null}
        {canCust ? (
          <Field label="Khách hàng sở hữu" hint="Chỉ đổi được khi tệp chưa gắn chiến dịch.">
            <select value={cust} onChange={(e) => setCust(e.target.value)}>
              {!custs.data?.items.some((c) => c.id === m.customer_id) ? <option value={m.customer_id ?? ''}>{m.owner_name ?? 'Hiện tại'}</option> : null}
              {(custs.data?.items ?? []).map((c) => <option key={c.id} value={c.id}>{c.short_name || c.legal_name}{c.code ? ` (${c.code})` : ''}</option>)}
            </select>
          </Field>
        ) : null}
        {isLink ? <Field label="Đường dẫn video" hint="Đổi đường dẫn là đổi nội dung: tệp quay lại trạng thái chờ duyệt."><input type="url" value={url} onChange={(e) => setUrl(e.target.value)} required /></Field> : null}
        {urlChanged ? <p role="status" style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--warn, #B45309)' }}>Lưu thay đổi này sẽ đặt lại trạng thái duyệt: tệp cần được duyệt lại trước khi phát.</p> : null}
        {err ? <p role="alert" style={{ color: 'var(--bad)', margin: '8px 0 0' }}>{err}</p> : null}
        <div className="da" style={{ marginTop: 14 }}>
          <button type="button" className="btn" onClick={onClose}>Hủy</button>
          <button type="submit" className="btn p" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu thay đổi'}</button>
        </div>
      </form>
    </Dialog>
  );
}
