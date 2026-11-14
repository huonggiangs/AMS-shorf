import { useState } from 'react';
import { api } from '../api/client';
import { rateCardSchema, type RateCard } from '../api/schemas';
import { useAct } from '../api/hooks';
import { useAuth } from '../auth/AuthProvider';
import { ServerTable } from '../components/ServerTable';
import type { Col } from '../components/DataTable';
import { Btn, Field, Note, PageHead, Tag } from '../components/ui';
import { Dialog } from '../components/Dialog';
import { fmtDateTime } from '../lib/format';

const SCREEN: Record<string, string> = { '*': 'Mọi loại', tv: 'TV', elevator: 'Thang máy', led_p5: 'LED' };
const DAYPART: Record<string, string> = { '*': 'Cả ngày', peak: 'Cao điểm 17–22h', off_peak: 'Giờ thường' };
const STATUS: Record<string, { label: string; tone: 'ok' | 'info' | 'warn' | 'bad' }> = {
  current: { label: 'Đang áp dụng', tone: 'ok' }, scheduled: { label: 'Sắp hiệu lực', tone: 'info' }, expired: { label: 'Đã hết hạn', tone: 'warn' }, inactive: { label: 'Vô hiệu', tone: 'bad' },
};
const priceText = (r: RateCard) => `${r.price_vnd} ₫${r.model === 'cpm' ? ' / 1.000 lượt (CPM)' : ' / lượt'}`;

/** Quản trị bảng giá (finance:view xem; finance:approve tạo/sửa/kết thúc). Đổi giá = phiên bản mới có ngày hiệu lực; chiến dịch đã duyệt giữ giá đã chốt. */
export default function PriceBook() {
  const { can } = useAuth();
  const act = useAct();
  const canEdit = can('finance', 'approve');
  const [edit, setEdit] = useState<{ base: RateCard | null } | null>(null);
  const cols: Col<RateCard>[] = [
    { key: 'screen', label: 'Loại màn', sortKey: 'screen_type', text: (r) => SCREEN[r.screen_type] ?? r.screen_type },
    { key: 'region', label: 'Khu vực', sortKey: 'region_id', text: (r) => (r.region_id === '*' ? 'Mọi khu vực' : r.region_id) },
    { key: 'daypart', label: 'Khung giờ', sortKey: 'daypart', text: (r) => DAYPART[r.daypart] ?? r.daypart },
    { key: 'customer', label: 'Khách', text: (r) => (r.customer_id === '*' ? 'Mọi khách' : (r.customer_name ?? r.customer_id)) },
    { key: 'price', label: 'Giá', sortKey: 'price', num: true, text: priceText },
    { key: 'floor', label: 'Giá sàn / lượt', num: true, text: (r) => `${r.floor_vnd} ₫` },
    { key: 'from', label: 'Hiệu lực từ', sortKey: 'effective_from', text: (r) => fmtDateTime(r.effective_from) },
    { key: 'to', label: 'Đến', text: (r) => (r.effective_to ? fmtDateTime(r.effective_to) : '—') },
    { key: 'status', label: 'Trạng thái', text: (r) => STATUS[r.status]?.label ?? r.status, cell: (r) => <Tag tone={STATUS[r.status]?.tone ?? 'info'}>{STATUS[r.status]?.label ?? r.status}</Tag> },
    ...(canEdit
      ? [{
          key: 'act', label: '', text: () => '',
          cell: (r: RateCard) => r.status === 'current' || r.status === 'scheduled' ? (
            <span style={{ display: 'flex', gap: 6 }}>
              <Btn onClick={() => setEdit({ base: r })}>Đổi giá</Btn>
              <Btn onClick={() => { if (window.confirm('Kết thúc dòng giá này? Chiến dịch đã duyệt vẫn giữ giá đã chốt.')) void act(() => api.del(`/admin/v1/rate-cards/${r.id}`), 'Đã kết thúc dòng giá.', ['/admin/v1/rate-cards']); }}>Kết thúc</Btn>
            </span>
          ) : null,
        } as Col<RateCard>]
      : []),
  ];
  return (
    <>
      <PageHead title="Bảng giá" sub="Giá theo loại màn hình × khu vực × khung giờ. Đổi giá tạo phiên bản mới; chiến dịch đã duyệt giữ giá đã chốt lúc duyệt." />
      <Note warn>Chưa có dòng giá nào thì khách không gửi duyệt được chiến dịch. Hãy tạo dòng mặc định (mọi loại màn, mọi khu vực, cả ngày) trước, rồi thêm dòng cụ thể.</Note>
      {canEdit ? <div style={{ margin: '8px 0' }}><Btn tone="p" onClick={() => setEdit({ base: null })}>Thêm dòng giá</Btn></div> : null}
      <ServerTable id="rate-cards" endpoint="/admin/v1/rate-cards" itemSchema={rateCardSchema} cols={cols} extra={{ current: '1' }} exportName="bang-gia" />
      {edit ? <RateCardDialog base={edit.base} onClose={() => setEdit(null)} /> : null}
    </>
  );
}

function RateCardDialog({ base, onClose }: { base: RateCard | null; onClose: () => void }) {
  const act = useAct();
  const [f, setF] = useState({
    screen_type: base?.screen_type ?? '*', region_id: base?.region_id ?? '*', daypart: base?.daypart ?? '*', model: base?.model ?? 'per_impression',
    price: base?.price_vnd ?? '', floor: base?.floor_vnd ?? '0', note: base?.note ?? '',
  });
  const [err, setErr] = useState('');
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const save = async () => {
    setErr('');
    if (!/^\d+([.,]\d{1,6})?$/.test(f.price.trim()) || Number(f.price.replace(',', '.')) <= 0) return setErr('Nhập giá lớn hơn 0 (tối đa 6 chữ số thập phân).');
    if (!/^\d+([.,]\d{1,6})?$/.test(f.floor.trim())) return setErr('Giá sàn không hợp lệ.');
    const body = { price_vnd: f.price.trim(), floor_vnd: f.floor.trim(), note: f.note.trim() || undefined, model: f.model };
    const r = await act(() => (base ? api.put(`/admin/v1/rate-cards/${base.id}`, { body }) : api.post('/admin/v1/rate-cards', { body: { ...body, screen_type: f.screen_type, region_id: f.region_id.trim() || '*', daypart: f.daypart } })), base ? 'Đã tạo phiên bản giá mới.' : 'Đã thêm dòng giá.', ['/admin/v1/rate-cards']);
    if (r) onClose();
  };
  return (
    <Dialog open onClose={onClose} width="min(520px,96vw)" label={base ? 'Đổi giá' : 'Thêm dòng giá'}>
      <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <h2 style={{ margin: '0 0 10px', fontSize: 18 }}>{base ? 'Đổi giá (phiên bản mới)' : 'Thêm dòng giá'}</h2>
        {!base ? (
          <>
            <Field label="Loại màn hình"><select value={f.screen_type} onChange={(e) => set('screen_type', e.target.value)}>{Object.entries(SCREEN).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="Khu vực" hint="* = mọi khu vực; hoặc mã như HN, HCM, DN."><input value={f.region_id} onChange={(e) => set('region_id', e.target.value)} maxLength={16} /></Field>
            <Field label="Khung giờ"><select value={f.daypart} onChange={(e) => set('daypart', e.target.value)}>{Object.entries(DAYPART).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          </>
        ) : <p style={{ fontSize: 13 }}>{SCREEN[base.screen_type]} · {base.region_id === '*' ? 'mọi khu vực' : base.region_id} · {DAYPART[base.daypart]}. Dòng cũ giữ nguyên và kết thúc khi phiên bản mới có hiệu lực.</p>}
        <Field label="Mô hình"><select value={f.model} onChange={(e) => set('model', e.target.value)}><option value="per_impression">Giá cố định mỗi lượt</option><option value="cpm">CPM (giá mỗi 1.000 lượt)</option></select></Field>
        <div className="g g2" style={{ margin: 0 }}>
          <Field label={f.model === 'cpm' ? 'Giá CPM (₫ / 1.000 lượt)' : 'Giá (₫ / lượt)'}><input inputMode="decimal" value={f.price} onChange={(e) => set('price', e.target.value)} required /></Field>
          <Field label="Giá sàn (₫ / lượt)" hint="Không bán, không thỏa thuận dưới mức này."><input inputMode="decimal" value={f.floor} onChange={(e) => set('floor', e.target.value)} /></Field>
        </div>
        <Field label="Ghi chú"><input value={f.note} onChange={(e) => set('note', e.target.value)} maxLength={500} /></Field>
        {err ? <p role="alert" style={{ color: 'var(--bad)', margin: '8px 0 0' }}>{err}</p> : null}
        <div className="da" style={{ marginTop: 14 }}>
          <button type="button" className="btn" onClick={onClose}>Hủy</button>
          <button type="submit" className="btn p">Lưu</button>
        </div>
      </form>
    </Dialog>
  );
}
