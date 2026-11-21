import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { broadcastSchema, listOf, mediaSchema, type Broadcast } from '../api/schemas';
import { useAct } from '../api/hooks';
import { useAuth } from '../auth/AuthProvider';
import { Btn, EmptyBlock, ErrorBlock, Field, LoadingBlock, Note, PageHead, Tag } from '../components/ui';
import { Dialog } from '../components/Dialog';
import { useT } from '../i18n';
import { fmtMin } from '../lib/format';

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
const toMin = (s: string): number => { const [h, m] = s.split(':').map(Number); return (h ?? 0) * 60 + (m ?? 0); };
const toTime = (n: number): string => `${String(Math.floor(n / 60) % 24).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
const BASE = '/admin/v1/broadcast';

/** Chương trình phát sóng nội bộ: chọn media trong kho + loại màn + khu vực + khung giờ, xuất bản là thiết bị đã duyệt nhận được (không qua hợp đồng/thanh toán). */
export default function Broadcast() {
  const t = useT();
  const { can } = useAuth();
  const act = useAct();
  const [edit, setEdit] = useState<Broadcast | 'new' | null>(null);
  const list = useQuery({ queryKey: [BASE], queryFn: () => api.get(BASE, { query: { page_size: 100 }, schema: listOf(broadcastSchema) }) });
  const canWrite = can('schedule', 'write');
  const canDelete = can('schedule', 'delete');
  const run = (p: Broadcast, action: 'publish' | 'unpublish', ok: string) => act(() => api.post(`${BASE}/${p.id}/${action}`, { body: {} }), ok);
  return (
    <>
      <PageHead eyebrow="Nội dung nội bộ / không qua hợp đồng" title="Chương trình phát sóng" sub="Chọn video, ảnh trong kho, chọn loại màn và khu vực rồi xuất bản: thiết bị đã duyệt sẽ tự nhận ở lần đồng bộ kế tiếp." actions={canWrite ? <Btn tone="p" icon="plus" onClick={() => setEdit('new')}>Tạo chương trình</Btn> : null} />
      {list.isLoading ? <LoadingBlock /> : list.isError ? <ErrorBlock error={list.error} onRetry={() => void list.refetch()} /> : !list.data?.items.length ? <EmptyBlock>Chưa có chương trình phát sóng nào.</EmptyBlock> : (
        <div className="card cp">
          <table className="tbl">
            <thead><tr><th>Tên</th><th>Loại màn</th><th>Khu vực</th><th>Hiệu lực</th><th>Khung giờ</th><th>Số tệp</th><th>Trạng thái</th><th /></tr></thead>
            <tbody>
              {list.data.items.map((p) => (
                <tr key={p.id}>
                  <td><b>{p.name}</b></td>
                  <td>{TARGETS.find((x) => x.id === p.target_type)?.label ?? p.target_type}</td>
                  <td className="mono">{p.regions.length ? p.regions.join(', ') : 'Tất cả'}</td>
                  <td className="mono">{p.start_date ?? '…'} → {p.end_date ?? '…'}</td>
                  <td className="mono">{fmtMin(p.start_min)}–{fmtMin(p.end_min)}</td>
                  <td className="mono">{p.item_count}</td>
                  <td><Tag tone={STATUS[p.status]?.tone ?? 'info'}>{STATUS[p.status]?.label ?? p.status}</Tag></td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
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
      {edit ? <ProgramDialog key={edit === 'new' ? 'new' : edit.id} program={edit === 'new' ? null : edit} onClose={() => setEdit(null)} /> : null}
      <span hidden>{t('Hủy')}</span>
    </>
  );
}

function ProgramDialog({ program, onClose }: { program: Broadcast | null; onClose: () => void }) {
  const t = useT();
  const act = useAct();
  const [f, setF] = useState({
    name: program?.name ?? '',
    target_type: program?.target_type ?? 'elevator',
    regions: (program?.regions ?? []).join(', '),
    start_date: program?.start_date ?? '',
    end_date: program?.end_date ?? '',
    start: toTime(program?.start_min ?? 0),
    end: program?.end_min === 1440 || !program ? '24:00' : toTime(program.end_min),
    priority: String(program?.priority ?? 3),
    header: program?.header ?? '',
    footer: program?.footer ?? '',
  });
  const [ids, setIds] = useState<string[]>(program?.items.map((i) => i.creative_id) ?? []);
  const media = useQuery({ queryKey: ['/admin/v1/media', 'broadcast-pick'], queryFn: () => api.get('/admin/v1/media', { query: { page_size: 200, status: 'approved' }, schema: listOf(mediaSchema) }) });
  const pool = useMemo(() => (media.data?.items ?? []).filter((m) => (m as { campaign_id?: unknown }).campaign_id == null || ids.includes(m.id)), [media.data, ids]);
  const signage = f.target_type === 'elevator' || f.target_type === 'led_p5';
  const move = (i: number, d: number) => setIds((cur) => { const n = [...cur]; const j = i + d; if (j < 0 || j >= n.length) return cur; [n[i], n[j]] = [n[j]!, n[i]!]; return n; });
  const nameOf = (id: string) => media.data?.items.find((m) => m.id === id)?.name ?? program?.items.find((i) => i.creative_id === id)?.name ?? id;
  const submit = async () => {
    const endMin = f.end === '24:00' ? 1440 : toMin(f.end);
    const body = {
      name: f.name.trim(),
      target_type: f.target_type,
      regions: f.regions.split(',').map((x) => x.trim()).filter(Boolean),
      start_date: f.start_date || null,
      end_date: f.end_date || null,
      start_min: toMin(f.start),
      end_min: endMin,
      priority: Number(f.priority),
      ...(signage ? { header: f.header.trim() === '' ? null : f.header, footer: f.footer.trim() === '' ? null : f.footer } : {}),
      creative_ids: ids,
    };
    const r = await act(() => (program ? api.put(`${BASE}/${program.id}`, { body }) : api.post(BASE, { body })), program ? 'Đã lưu chương trình.' : 'Đã tạo chương trình (bản nháp).');
    if (r !== undefined) onClose();
  };
  return (
    <Dialog open onClose={onClose} size="lg" label="Chương trình phát sóng">
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <h2 style={{ margin: '0 0 10px', fontSize: 18 }}>{program ? 'Sửa chương trình' : 'Tạo chương trình phát sóng'}</h2>
        <Field label="Tên chương trình"><input required maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Loại màn hình"><select value={f.target_type} onChange={(e) => setF({ ...f, target_type: e.target.value })}>{TARGETS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></Field>
        <Field label="Khu vực" hint="Mã khu vực cách nhau bằng dấu phẩy (vd HN, HCM). Để trống = tất cả thiết bị đã duyệt."><input value={f.regions} onChange={(e) => setF({ ...f, regions: e.target.value })} /></Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Từ ngày"><input type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></Field>
          <Field label="Đến ngày"><input type="date" value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} /></Field>
          <Field label="Giờ bắt đầu"><input type="time" step={1800} value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></Field>
          <Field label="Giờ kết thúc" hint="24:00 = hết ngày"><input type={f.end === '24:00' ? 'text' : 'time'} step={1800} value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></Field>
        </div>
        <Field label="Ưu tiên (1–5)"><select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select></Field>
        {signage ? (
          <>
            <Field label="Chữ header (đầu màn hình)" hint="Để trống = dùng chữ chung của loại màn."><input maxLength={120} value={f.header} onChange={(e) => setF({ ...f, header: e.target.value })} /></Field>
            <Field label="Chữ footer (cuối màn hình)"><input maxLength={200} value={f.footer} onChange={(e) => setF({ ...f, footer: e.target.value })} /></Field>
          </>
        ) : null}
        <h3 style={{ margin: '14px 0 6px', fontSize: 15 }}>Tệp phát ({ids.length})</h3>
        {ids.length ? (
          <ol style={{ margin: '0 0 8px', paddingLeft: 20 }}>
            {ids.map((id, i) => (
              <li key={id} style={{ marginBottom: 4 }}>{nameOf(id)}{' '}
                <button type="button" className="btn sm" aria-label={`Lên ${nameOf(id)}`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>{' '}
                <button type="button" className="btn sm" aria-label={`Xuống ${nameOf(id)}`} disabled={i === ids.length - 1} onClick={() => move(i, 1)}>↓</button>{' '}
                <button type="button" className="btn sm d" aria-label={`Bỏ ${nameOf(id)}`} onClick={() => setIds(ids.filter((x) => x !== id))}>Bỏ</button></li>
            ))}
          </ol>
        ) : <p style={{ color: 'var(--mut)', margin: '0 0 8px' }}>Chưa chọn tệp nào.</p>}
        <Field label="Thêm tệp từ kho (đã duyệt, chưa gắn chiến dịch)">
          <select value="" onChange={(e) => { if (e.target.value) setIds([...ids, e.target.value]); }}>
            <option value="">{media.isLoading ? 'Đang tải…' : '— chọn tệp —'}</option>
            {pool.filter((m) => !ids.includes(m.id)).map((m) => <option key={m.id} value={m.id}>{m.name}{m.width && m.height ? ` · ${m.width}×${m.height}` : ''}</option>)}
          </select>
        </Field>
        <div className="da" style={{ marginTop: 14 }}><button type="button" className="btn" onClick={onClose}>{t('Hủy')}</button><button className="btn p" type="submit">{t('Lưu')}</button></div>
      </form>
    </Dialog>
  );
}
