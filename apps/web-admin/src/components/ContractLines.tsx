import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { contractLinesSchema, quoteSchema, type ContractLine } from '../api/schemas';
import { useAct } from '../api/hooks';
import { useAuth } from '../auth/AuthProvider';
import { Btn, EmptyBlock, ErrorBlock, Field, LoadingBlock, Note, Tag } from './ui';
import { Dialog } from './Dialog';
import { fmtDate } from '../lib/format';
import { emptyLineForm, lineFormToBody, type LineForm } from '../lib/contractLines';

const SCREEN: Record<string, string> = { '': 'Mọi loại màn', tv: 'TV', elevator: 'Thang máy', led_p5: 'LED' };
const DAYPART: Record<string, string> = { '': 'Cả ngày', peak: 'Cao điểm (17–22h)', off_peak: 'Giờ thường' };
const SOURCE: Record<string, string> = { contract: 'Hợp đồng', rate_card: 'Bảng giá', placeholder: 'Giá tạm', legacy: 'Giá cũ' };
const PREVIEW_SCREENS = ['tv', 'elevator', 'led_p5'];

const priceOf = (l: ContractLine) => (l.model === 'cpm' ? `${l.cpm_vnd ?? ''} ₫ / 1.000 lượt (CPM)` : `${l.impression_price_vnd ?? ''} ₫ / lượt`);
const toForm = (l: ContractLine): LineForm => ({
  screen_type: l.screen_type ?? '', daypart: l.daypart ?? '', region_id: l.region_id ?? '', model: l.model,
  price: (l.model === 'cpm' ? l.cpm_vnd : l.impression_price_vnd) ?? '', effective_from: l.effective_from ?? '', effective_to: l.effective_to ?? '',
  frequency: l.frequency == null ? '' : String(l.frequency), duration_s: l.duration_s == null ? '' : String(l.duration_s), qty: String(l.qty ?? 1),
});

/** Dong gia thoa thuan cua mot hop dong (finance:view xem, finance:approve them/sua/xoa) + bao gia hieu luc (giá áp dụng cho chiến dịch mới). */
export function ContractLinesPanel({ contractId, customerId }: { contractId: string; customerId: string }) {
  const { can } = useAuth();
  const act = useAct();
  const canView = can('finance', 'view');
  const canWrite = can('finance', 'approve');
  const [edit, setEdit] = useState<{ line: ContractLine | null } | null>(null);
  const key = ['/admin/v1/contracts', contractId, 'lines'];
  const q = useQuery({ queryKey: key, enabled: canView, queryFn: () => api.get(`/admin/v1/contracts/${contractId}/lines`, { schema: contractLinesSchema }) });
  if (!canView) return <Note warn>Bạn không có quyền xem giá thỏa thuận của hợp đồng (cần quyền xem tài chính).</Note>;
  if (q.isLoading) return <LoadingBlock />;
  if (q.isError || !q.data) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const writable = canWrite && d.editable;
  const remove = async (l: ContractLine) => {
    if (!window.confirm('Xóa dòng giá này? Chiến dịch đã duyệt vẫn giữ giá đã chốt.')) return;
    await act(() => api.del(`/admin/v1/contracts/${contractId}/lines/${l.id}`), 'Đã xóa dòng giá.', ['/admin/v1/contracts', '/admin/v1/pricing']);
  };
  return (
    <section aria-label="Dòng giá hợp đồng">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, margin: '0 0 8px' }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>Dòng giá thỏa thuận ({d.items.length})</h3>
        {writable ? <Btn tone="p" className="sm" onClick={() => setEdit({ line: null })}>Thêm dòng giá</Btn> : null}
      </div>
      <Note>Giá thỏa thuận ghi đè bảng giá khi chiến dịch gắn với hợp đồng đang hiệu lực và vẫn bị nâng lên giá sàn. Chiến dịch đã duyệt giữ giá đã chốt.</Note>
      {!d.editable ? <Note warn>Hợp đồng ở trạng thái này không còn sửa được dòng giá.</Note> : null}
      {!canWrite ? <p className="sub">Chỉ xem: cần quyền duyệt tài chính để thêm, sửa hoặc xóa dòng giá.</p> : null}
      {!d.items.length ? <EmptyBlock>Hợp đồng chưa có dòng giá thỏa thuận. Giá theo bảng giá hiện hành.</EmptyBlock> : (
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ width: '100%', fontSize: 13 }}>
            <thead><tr><th>Loại màn</th><th>Khung giờ</th><th>Khu vực</th><th style={{ textAlign: 'right' }}>Giá</th><th>Hiệu lực</th>{writable ? <th /> : null}</tr></thead>
            <tbody>
              {d.items.map((l) => (
                <tr key={l.id}>
                  <td>{SCREEN[l.screen_type ?? ''] ?? l.screen_type}</td>
                  <td>{DAYPART[l.daypart ?? ''] ?? l.daypart}</td>
                  <td>{l.region_id || 'Mọi khu vực'}</td>
                  <td style={{ textAlign: 'right' }}><b>{priceOf(l)}</b>{l.model === 'cpm' ? <div style={{ color: 'var(--mut)', fontSize: 12 }}>≈ {l.impression_price_vnd} ₫ / lượt</div> : null}</td>
                  <td>{l.effective_from || l.effective_to ? `${l.effective_from ? fmtDate(l.effective_from) : '…'} → ${l.effective_to ? fmtDate(l.effective_to) : '…'}` : 'Theo thời hạn hợp đồng'}</td>
                  {writable ? <td style={{ whiteSpace: 'nowrap' }}><Btn className="sm" onClick={() => setEdit({ line: l })}>Sửa</Btn> <Btn className="sm" onClick={() => void remove(l)}>Xóa</Btn></td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <EffectivePreview contractId={contractId} customerId={customerId} refreshKey={d.items.map((l) => `${l.id}:${l.impression_price_micro_vnd}:${l.effective_from}:${l.effective_to}`).join('|')} contractStatus={d.status} />
      {edit ? <LineDialog contractId={contractId} line={edit.line} term={{ start: d.start_date, end: d.end_date }} onClose={() => setEdit(null)} /> : null}
    </section>
  );
}

/** Giá áp dụng thực tế cho chiến dịch mới theo bảng báo giá hiện có (nguồn: hợp đồng / bảng giá, có bị nâng lên sàn hay không). */
function EffectivePreview({ contractId, customerId, refreshKey, contractStatus }: { contractId: string; customerId: string; refreshKey: string; contractStatus?: string }) {
  const [screen, setScreen] = useState('tv');
  const q = useQuery({
    queryKey: ['/admin/v1/pricing', 'quote', contractId, customerId, screen, refreshKey],
    queryFn: () => api.get('/admin/v1/pricing/quote', { query: { screen_type: screen, customer_id: customerId, contract_id: contractId }, schema: quoteSchema }),
  });
  return (
    <div role="region" aria-label="Giá áp dụng" style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <b style={{ fontSize: 14 }}>Giá áp dụng cho chiến dịch mới</b>
        <select aria-label="Loại màn hình xem giá" value={screen} onChange={(e) => setScreen(e.target.value)}>{PREVIEW_SCREENS.map((s) => <option key={s} value={s}>{SCREEN[s]}</option>)}</select>
      </div>
      {contractStatus && contractStatus !== 'effective' ? <p className="sub" style={{ margin: '4px 0' }}>Hợp đồng chưa hiệu lực nên giá thỏa thuận chưa được áp dụng; bảng dưới là giá theo bảng giá.</p> : null}
      {q.isLoading ? <p style={{ fontSize: 13 }}>Đang tính giá…</p> : q.isError || !q.data ? <Note warn>Không tải được báo giá.</Note> : q.data.status === 'unavailable' ? <Note warn>{q.data.message ?? 'Chưa có bảng giá cho loại màn hình này.'}</Note> : (
        <table style={{ width: '100%', fontSize: 13, marginTop: 4, borderCollapse: 'collapse' }}>
          <tbody>
            {q.data.lines.map((l) => (
              <tr key={`${l.region_id}-${l.daypart}`}>
                <td>{DAYPART[l.daypart] ?? l.daypart}{l.region_id !== '*' ? ` · ${l.region_id}` : ''}</td>
                <td style={{ textAlign: 'right' }}><b>{l.unit_price_vnd} ₫</b>/lượt</td>
                <td>{l.source ? <Tag tone={l.source === 'contract' ? 'ok' : 'info'}>{SOURCE[l.source] ?? l.source}</Tag> : null}{l.floored ? <> <Tag tone="warn">Nâng lên giá sàn</Tag></> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function LineDialog({ contractId, line, term, onClose }: { contractId: string; line: ContractLine | null; term: { start?: string | null; end?: string | null }; onClose: () => void }) {
  const act = useAct();
  const [f, setF] = useState<LineForm>(line ? toForm(line) : emptyLineForm());
  const [err, setErr] = useState('');
  const set = <K extends keyof LineForm>(k: K, v: LineForm[K]) => setF((p) => ({ ...p, [k]: v }));
  const save = async () => {
    setErr('');
    const r = lineFormToBody(f, term);
    if ('error' in r) return setErr(r.error);
    const path = `/admin/v1/contracts/${contractId}/lines`;
    const ok = await act(() => (line ? api.put(`${path}/${line.id}`, { body: r.body }) : api.post(path, { body: r.body })), line ? 'Đã cập nhật dòng giá.' : 'Đã thêm dòng giá.', ['/admin/v1/contracts', '/admin/v1/pricing']);
    if (ok !== undefined) onClose();
  };
  return (
    <Dialog open onClose={onClose} size="md" label={line ? 'Sửa dòng giá' : 'Thêm dòng giá'}>
      <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <h2 style={{ margin: '0 0 10px', fontSize: 18 }}>{line ? 'Sửa dòng giá' : 'Thêm dòng giá'}</h2>
        <div className="g g2" style={{ margin: 0 }}>
          <Field label="Loại màn hình"><select value={f.screen_type} onChange={(e) => set('screen_type', e.target.value)}>{Object.entries(SCREEN).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Khung giờ"><select value={f.daypart} onChange={(e) => set('daypart', e.target.value)}>{Object.entries(DAYPART).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        </div>
        <Field label="Khu vực" hint="Để trống = mọi khu vực; hoặc mã như HN, HCM, DN."><input value={f.region_id} maxLength={16} onChange={(e) => set('region_id', e.target.value)} /></Field>
        <Field label="Mô hình giá"><select value={f.model} onChange={(e) => set('model', e.target.value as 'fixed' | 'cpm')}><option value="fixed">Giá cố định mỗi lượt</option><option value="cpm">CPM (giá mỗi 1.000 lượt)</option></select></Field>
        <Field label={f.model === 'cpm' ? 'Giá CPM (₫ / 1.000 lượt)' : 'Đơn giá (₫ / lượt)'} hint="Nhập theo đồng, tối đa 6 chữ số thập phân. Hệ thống lưu số nguyên micro-VND; CPM quy ra lượt bằng làm tròn lên."><input inputMode="decimal" value={f.price} onChange={(e) => set('price', e.target.value)} /></Field>
        <div className="g g2" style={{ margin: 0 }}>
          <Field label="Hiệu lực từ" hint={term.start ? `Hợp đồng từ ${fmtDate(term.start)}` : undefined}><input type="date" value={f.effective_from} onChange={(e) => set('effective_from', e.target.value)} /></Field>
          <Field label="Hiệu lực đến" hint={term.end ? `Hợp đồng đến ${fmtDate(term.end)}` : undefined}><input type="date" value={f.effective_to} onChange={(e) => set('effective_to', e.target.value)} /></Field>
        </div>
        {err ? <p role="alert" style={{ color: 'var(--bad)', margin: '8px 0 0' }}>{err}</p> : null}
        <div className="da" style={{ marginTop: 14 }}>
          <button type="button" className="btn" onClick={onClose}>Hủy</button>
          <button type="submit" className="btn p">Lưu</button>
        </div>
      </form>
    </Dialog>
  );
}
