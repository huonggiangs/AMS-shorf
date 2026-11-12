import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { floorSchema, listOf, partnerSchema, type Floor } from '../api/schemas';
import { useAct } from '../api/hooks';
import { useAuth } from '../auth/AuthProvider';
import { ServerTable } from '../components/ServerTable';
import type { Col } from '../components/DataTable';
import { Btn, Field, Kpi, PageHead } from '../components/ui';
import { Dialog } from '../components/Dialog';
import { useT } from '../i18n';
import { vnd } from '../lib/format';

export default function Partners() {
  const t = useT();
  const { can } = useAuth();
  const act = useAct();
  const [edit, setEdit] = useState<Floor | null>(null);
  const [price, setPrice] = useState('');
  const [adding, setAdding] = useState(false);
  const nP = useQuery({ queryKey: ['/admin/v1/partners', 'count'], queryFn: () => api.get('/admin/v1/partners', { query: { page_size: 1 }, schema: listOf(partnerSchema) }) }).data?.total;
  const canWrite = can('partners', 'write');
  const cols: Col<Floor>[] = [
    { key: 'cat', label: 'Danh mục', sortKey: 'category', text: (r) => r.category },
    { key: 'p', label: 'Giá sàn CPM', sortKey: 'floor_cpm_vnd', num: true, text: (r) => r.floor_cpm_vnd, cell: (r) => vnd(r.floor_cpm_vnd) },
    { key: 'f', label: 'Lấp đầy', num: true, text: (r) => r.fill_rate ?? '', cell: (r) => (
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'flex-end' }}><div className="bar" style={{ width: 100 }}><i style={{ width: `${r.fill_rate ?? 0}%` }} /></div>{r.fill_rate ?? 0}%</div>) },
    { key: 'e', label: '', cell: (r) => canWrite ? <Btn className="sm" onClick={() => { setEdit(r); setPrice(String(r.floor_cpm_vnd)); }}>Sửa</Btn> : null },
  ];
  return (
    <>
      <PageHead title="Đối tác & Giá sàn RTB" sub="Mức giá tối thiểu, trạng thái tích hợp và đối soát." actions={canWrite ? <Btn tone="p" icon="plus" onClick={() => setAdding(true)}>{t('Thêm đối tác')}</Btn> : null} />
      <div className="g g4"><Kpi label="Đối tác kết nối" icon="link" value={nP ?? '—'} foot="Ad network & đơn vị thuê" /></div>
      <ServerTable id="fl" endpoint="/admin/v1/rtb-floors" itemSchema={floorSchema} cols={cols} title="Giá sàn RTB theo danh mục" exportName="gia-san" />
      <Dialog open={!!edit} onClose={() => setEdit(null)} label="Sửa giá sàn">
        <form onSubmit={async (e) => { e.preventDefault(); if (!edit) return; const r = await act(() => api.put(`/admin/v1/rtb-floors/${edit.id}`, { body: { floor_cpm_vnd: Math.round(+price) } }), 'Đã cập nhật giá sàn.'); if (r !== undefined) setEdit(null); }}>
          <h2 style={{ margin: '0 0 10px', fontSize: 18 }}>Sửa giá sàn · {edit?.category}</h2>
          <Field label="Giá sàn CPM (₫)"><input type="number" min={0} required value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
          <div className="da" style={{ marginTop: 14 }}><button type="button" className="btn" onClick={() => setEdit(null)}>{t('Hủy')}</button><button className="btn p" type="submit">{t('Lưu')}</button></div>
        </form>
      </Dialog>
      <AddPartner open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

export function AddPartner({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const act = useAct();
  const [f, setF] = useState({ name: '', protocol: '' });
  return (
    <Dialog open={open} onClose={onClose} label="Thêm đối tác">
      <form onSubmit={async (e) => { e.preventDefault(); const r = await act(() => api.post('/admin/v1/partners', { body: f }), 'Đã thêm đối tác.'); if (r !== undefined) onClose(); }}>
        <h2 style={{ margin: '0 0 10px', fontSize: 18 }}>{t('Thêm đối tác')}</h2>
        <Field label="Tên đối tác"><input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Giao thức"><input value={f.protocol} onChange={(e) => setF({ ...f, protocol: e.target.value })} placeholder="OpenRTB 2.5, REST, webhook…" /></Field>
        <div className="da" style={{ marginTop: 14 }}><button type="button" className="btn" onClick={onClose}>{t('Hủy')}</button><button className="btn p" type="submit">{t('Lưu')}</button></div>
      </form>
    </Dialog>
  );
}
