import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { listOf, screenSchema, type Screen } from '../api/schemas';
import { useAct } from '../api/hooks';
import { useAuth } from '../auth/AuthProvider';
import { ServerTable } from '../components/ServerTable';
import type { Col } from '../components/DataTable';
import { Btn, Field, Kpi, NameCell, Note, PageHead, StatusTag, Tabs, Tag } from '../components/ui';
import { Dialog } from '../components/Dialog';
import { useT } from '../i18n';

const EL: Record<string, [number, number, number]> = { '18.5': [18.5, 768, 1366], '21.5': [21.5, 1080, 1920], '23.8': [23.8, 1080, 1920] };
const LD: Record<string, [number, number]> = { '1.28': [1.28, 0.64], '2.56': [2.56, 1.28], '3.84': [3.84, 1.92], '0.96': [0.96, 1.92] };

/** Drop a local file onto the preview frame; kept in the browser session only (object URL). */
function Slot({ style, label }: { style: React.CSSProperties; label: React.ReactNode }) {
  const [url, setUrl] = useState('');
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  return (
    <label className="ov slot" style={{ ...style, ...(url ? { padding: 0, borderStyle: 'solid', background: '#000' } : {}) }}>
      {url ? <img src={url} alt="" /> : label}
      <input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) setUrl(URL.createObjectURL(f)); }} />
    </label>
  );
}

export default function Screens() {
  const { can } = useAuth();
  const [T, setT] = useState<'all' | 'elevator' | 'led'>('all');
  const [el, setEl] = useState('21.5');
  const [ld, setLd] = useState('2.56');
  const [add, setAdd] = useState(false);
  const count = (key: string, filter?: string) => useQuery({ queryKey: ['/admin/v1/screens', 'count', key], queryFn: () => api.get('/admin/v1/screens', { query: { page_size: 1, filter }, schema: listOf(screenSchema) }) }).data?.total; // eslint-disable-line react-hooks/rules-of-hooks
  const nEl = count('el', 'type:elevator'), nLed = count('led', 'type:led'), nAll = count('all');
  const e = EL[el]!, dm = e[0] * 25.4, ew = Math.round(dm * 0.4902), eh = Math.round(dm * 0.8716);
  const l = LD[ld]!, lw = Math.round((l[0] * 1000) / 5), lh = Math.round((l[1] * 1000) / 5);
  const showE = T === 'all' || T === 'elevator', showL = T === 'all' || T === 'led';
  const cols: Col<Screen>[] = useMemo(() => [
    { key: 'name', label: 'Vị trí', sortKey: 'name', text: (r) => r.name, cell: (r) => <NameCell icon={r.type === 'led' ? 'img' : 'tv'} a={r.name} b={r.id} /> },
    { key: 'type', label: 'Loại', sortKey: 'type', text: (r) => r.type, cell: (r) => <Tag tone={r.type === 'led' ? 'warn' : 'info'}>{r.type === 'led' ? 'LED P5' : 'Thang máy'}</Tag> },
    { key: 'kind', label: 'Nơi lắp', text: (r) => r.venue_kind ?? '' },
    { key: 'size', label: 'Kích thước', text: (r) => r.size ?? '' },
    { key: 'res', label: 'Độ phân giải', text: (r) => r.resolution ?? '', cell: (r) => <span className="mono">{r.resolution ?? '—'}</span> },
    { key: 'n', label: 'Số màn', num: true, text: (r) => r.screens },
    { key: 'region', label: 'Khu vực', sortKey: 'region', text: (r) => r.region ?? '' },
    { key: 'st', label: 'Trạng thái', text: (r) => r.status, cell: (r) => <StatusTag status={r.status} /> },
  ], []);
  const seg = (items: string[], cur: string, set: (v: string) => void, fmt: (i: string) => string) => <Tabs value={cur} onChange={set} items={items.map((i) => ({ id: i, label: fmt(i) }))} />;
  return (
    <>
      <PageHead title="Màn hình thang máy & LED" sub="Quản lý màn hình đứng trong thang máy chung cư và bảng LED P5 tại chung cư, bãi đỗ xe." actions={can('screens', 'write') ? <Btn tone="p" icon="plus" onClick={() => setAdd(true)}>Thêm vị trí</Btn> : null} />
      <div className="g g4">
        <Kpi label="Vị trí thang máy" icon="tv" value={nEl ?? '—'} />
        <Kpi label="Vị trí LED P5" icon="img" value={nLed ?? '—'} />
        <Kpi label="Tổng vị trí" icon="home" value={nAll ?? '—'} />
      </div>
      <Tabs value={T} onChange={setT} items={[{ id: 'all', label: 'Tất cả' }, { id: 'elevator', label: 'Thang máy' }, { id: 'led', label: 'LED P5' }]} />
      <div className="g g2">
        {showE ? (
          <div className="card cp">
            <div className="ch"><div><h2>Màn hình thang máy (dọc)</h2><p>Màn hình 18,5&quot;–23,8&quot;, đặt dọc 9:16, thường có loa; nội dung ngắn, xem trong 20–60 giây di chuyển.</p></div><Tag tone="info">Portrait</Tag></div>
            {seg(Object.keys(EL), el, setEl, (i) => `${i}"`)}
            <div style={{ display: 'grid', placeItems: 'center', background: 'var(--bg)', borderRadius: 10, padding: 18 }}>
              <div className="tv" style={{ width: 'min(190px,100%)', borderRadius: 14 }}>
                <div className="scr" style={{ aspectRatio: `${e[1]}/${e[2]}` }}>
                  <div className="ph" style={{ fontSize: 11 }}>NỘI DUNG<br /><small>{e[1]}×{e[2]}</small></div>
                  <Slot style={{ inset: 0 }} label={<>VIDEO / ẢNH<br />{e[1]}×{e[2]}</>} />
                  <span className="rb mono">{e[1]}×{e[2]}</span>
                </div>
              </div>
            </div>
            <dl className="kv" style={{ margin: '16px 0 0' }}>
              <dt>Kích thước màn</dt><dd className="mono">{e[0]}&quot; · khoảng {ew} × {eh} mm (đặt dọc)</dd>
              <dt>Độ phân giải</dt><dd className="mono">{e[1]} × {e[2]} px</dd><dt>Tỷ lệ</dt><dd>9:16 · không dùng ảnh ngang 16:9</dd>
              <dt>Định dạng</dt><dd>MP4 H.264 hoặc JPG/PNG, tối đa 30 MB</dd><dt>Thời lượng</dt><dd>10–30 giây, lặp liên tục</dd>
              <dt>Âm thanh</dt><dd>Mặc định tắt; bật theo quy định tòa nhà</dd><dt>Vùng an toàn</dt><dd>Lề 6% mỗi cạnh; chữ tối thiểu 36 px</dd>
            </dl>
          </div>
        ) : null}
        {showL ? (
          <div className="card cp">
            <div className="ch"><div><h2>Bảng LED P5 (ngoài trời)</h2><p>Chung cư và bãi đỗ xe. Bước điểm 5 mm, độ sáng cao, nhìn từ xa 5–30 m.</p></div><Tag tone="warn">P5 · 5 mm</Tag></div>
            {seg(Object.keys(LD), ld, setLd, (i) => `${LD[i]![0]} × ${LD[i]![1]} m`)}
            <div style={{ display: 'grid', placeItems: 'center', background: 'var(--bg)', borderRadius: 10, padding: 18 }}>
              <div style={{ width: `min(100%,${l[0] >= l[1] ? 420 : 190}px)`, aspectRatio: `${lw}/${lh}`, position: 'relative', background: '#05070b', border: '6px solid #1e293b', borderRadius: 6, overflow: 'hidden' }}>
                <div style={{ position: 'absolute', inset: 0, background: 'repeating-linear-gradient(135deg,#18304f 0 14px,#102139 14px 28px)' }} />
                <Slot style={{ inset: 0, borderRadius: 0 }} label={<>VIDEO / ẢNH<br />{lw}×{lh}</>} />
                <span className="rb mono">{lw}×{lh}</span>
              </div>
            </div>
            <dl className="kv" style={{ margin: '16px 0 0' }}>
              <dt>Kích thước bảng</dt><dd className="mono">{l[0]} × {l[1]} m</dd><dt>Độ phân giải</dt><dd className="mono">{lw} × {lh} px (5 mm / điểm ảnh)</dd>
              <dt>Định dạng</dt><dd>MP4 H.264 hoặc PNG/JPG đúng {lw}×{lh} px</dd><dt>Thời lượng</dt><dd>5–15 giây, không âm thanh</dd>
              <dt>Độ sáng</dt><dd>5.000–6.500 nit, tự giảm ban đêm (cảm biến ánh sáng)</dd><dt>Chống nước / bụi</dt><dd>IP65 mặt trước</dd>
              <dt>Quy tắc nội dung</dt><dd>Tương phản cao, chữ tối thiểu 16 px (≈ 8 cm), tối đa 7 từ, tránh chi tiết nhỏ và gradient mịn</dd>
            </dl>
          </div>
        ) : null}
      </div>
      <Note>Mỗi loại màn hình dùng tệp creative riêng đúng độ phân giải gốc. Màn hình dọc không dùng lại video ngang 16:9; bảng LED không co giãn tự động, hệ thống từ chối tệp sai kích thước. Ảnh thả vào khung chỉ lưu trong phiên trình duyệt.</Note>
      <ServerTable id="vn" endpoint="/admin/v1/screens" itemSchema={screenSchema} cols={cols} title="Vị trí lắp đặt" sub="Chung cư, thang máy và bãi đỗ xe" exportName="vi-tri-man-hinh"
        extra={useMemo(() => (T === 'all' ? undefined : { type: T }), [T])}
        filters={[{ key: 'region', label: 'Khu vực', options: ['Hà Nội', 'TP.HCM', 'Đà Nẵng'].map((v) => ({ value: v, label: v })) }]} />
      <AddVenue open={add} onClose={() => setAdd(false)} />
    </>
  );
}

function AddVenue({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const act = useAct();
  const [f, setF] = useState({ name: '', type: 'elevator', venue_kind: 'Chung cư', size: '21.5"', resolution: '1080×1920', screens: '1', region: 'Hà Nội' });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  return (
    <Dialog open={open} onClose={onClose} label="Thêm vị trí lắp đặt">
      <form onSubmit={async (e) => { e.preventDefault(); const r = await act(() => api.post('/admin/v1/screens', { body: { ...f, screens: +f.screens } }), 'Đã thêm vị trí.'); if (r !== undefined) onClose(); }}>
        <h2 style={{ margin: '0 0 10px', fontSize: 18 }}>Thêm vị trí lắp đặt</h2>
        <Field label="Tên vị trí"><input required value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Loại màn hình"><select value={f.type} onChange={(e) => set('type', e.target.value)}><option value="elevator">Thang máy</option><option value="led">LED P5</option></select></Field>
        <Field label="Nơi lắp"><select value={f.venue_kind} onChange={(e) => set('venue_kind', e.target.value)}><option>Chung cư</option><option>Bãi đỗ xe</option></select></Field>
        <Field label="Kích thước"><input value={f.size} onChange={(e) => set('size', e.target.value)} /></Field>
        <Field label="Độ phân giải (rộng×cao)"><input required pattern="\d+\s*[×x]\s*\d+" value={f.resolution} onChange={(e) => set('resolution', e.target.value)} /></Field>
        <Field label="Số màn"><input type="number" min={1} value={f.screens} onChange={(e) => set('screens', e.target.value)} /></Field>
        <Field label="Khu vực"><input value={f.region} onChange={(e) => set('region', e.target.value)} /></Field>
        <div className="da" style={{ marginTop: 14 }}><button type="button" className="btn" onClick={onClose}>{t('Hủy')}</button><button className="btn p" type="submit">{t('Lưu')}</button></div>
      </form>
    </Dialog>
  );
}
