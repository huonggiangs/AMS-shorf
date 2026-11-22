// Địa điểm đặt thiết bị (d-tree): danh sách, thêm/sửa/xóa (xóa phải chuyển thiết bị đi), gán thiết bị vào địa điểm.
// Không dùng bản đồ ngoài: vĩ độ/kinh độ nhập tay, hiển thị dạng chữ.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { listOf } from '../api/schemas';
import { locationSchema, treeDeviceSchema, VENUE_TYPES, type Location } from '../api/deviceTree';
import { useAct } from '../api/hooks';
import { useAuth } from '../auth/AuthProvider';
import { treeErr, useLocationOptions } from '../components/DeviceTree';
import { OpsDialog } from '../components/OpsDialog';
import { Btn, EmptyBlock, ErrorBlock, Field, Kpi, LoadingBlock, Note, PageHead, Tag } from '../components/ui';
import { num } from '../lib/format';

const PAGE_SIZE = 50;
const blank = { name: '', address: '', province: '', district: '', lat: '', lng: '', venue_type: 'other', contact_name: '', contact_phone: '', notes: '', status: 'active' };
type Form = typeof blank;

function LocationForm({ edit, onClose }: { edit: Location | 'new' | null; onClose: () => void }) {
  const act = useAct();
  const [f, setF] = useState<Form>(blank);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!edit) return;
    setErr('');
    setF(edit === 'new' ? blank : { name: edit.name, address: edit.address ?? '', province: edit.province ?? '', district: edit.district ?? '', lat: edit.lat != null ? String(edit.lat) : '', lng: edit.lng != null ? String(edit.lng) : '', venue_type: edit.venue_type, contact_name: edit.contact_name ?? '', contact_phone: edit.contact_phone ?? '', notes: edit.notes ?? '', status: edit.status });
  }, [edit]);
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = async () => {
    setErr('');
    const num0 = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));
    const lat = num0(f.lat), lng = num0(f.lng);
    if ((lat !== null && !Number.isFinite(lat)) || (lng !== null && !Number.isFinite(lng))) { setErr('Vĩ độ / kinh độ phải là số.'); return; }
    const body = { name: f.name.trim(), address: f.address.trim() || null, province: f.province.trim() || null, district: f.district.trim() || null, lat, lng, venue_type: f.venue_type, contact_name: f.contact_name.trim() || null, contact_phone: f.contact_phone.trim() || null, notes: f.notes.trim() || null, status: f.status };
    try {
      if (edit === 'new') await api.post('/admin/v1/locations', { body }); else await api.patch(`/admin/v1/locations/${(edit as Location).id}`, { body });
      await act(async () => undefined, edit === 'new' ? `Đã thêm địa điểm "${body.name}".` : 'Đã lưu địa điểm.');
      onClose();
    } catch (e) { setErr(treeErr(e)); }
  };
  return (
    <OpsDialog open={!!edit} onClose={onClose} label={edit === 'new' ? 'Thêm địa điểm' : 'Sửa địa điểm'} width="min(640px,96vw)">
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>{edit === 'new' ? 'Thêm địa điểm đặt thiết bị' : 'Sửa địa điểm'}</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0 14px' }}>
          <Field label="Tên địa điểm *"><input value={f.name} maxLength={80} autoFocus onChange={set('name')} /></Field>
          <Field label="Loại địa điểm"><select value={f.venue_type} onChange={set('venue_type')}>{Object.entries(VENUE_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Địa chỉ"><input value={f.address} maxLength={200} onChange={set('address')} /></Field>
          <Field label="Quận / huyện"><input value={f.district} maxLength={60} onChange={set('district')} /></Field>
          <Field label="Tỉnh / thành phố"><input value={f.province} maxLength={60} onChange={set('province')} /></Field>
          <Field label="Trạng thái"><select value={f.status} onChange={set('status')}><option value="active">Đang hoạt động</option><option value="inactive">Tạm ngưng</option></select></Field>
          <Field label="Vĩ độ (lat)"><input inputMode="decimal" value={f.lat} placeholder="10.7769" onChange={set('lat')} /></Field>
          <Field label="Kinh độ (lng)"><input inputMode="decimal" value={f.lng} placeholder="106.7009" onChange={set('lng')} /></Field>
          <Field label="Người liên hệ"><input value={f.contact_name} maxLength={80} onChange={set('contact_name')} /></Field>
          <Field label="Số điện thoại"><input value={f.contact_phone} maxLength={20} inputMode="tel" onChange={set('contact_phone')} /></Field>
        </div>
        <Field label="Ghi chú"><textarea value={f.notes} maxLength={500} rows={2} onChange={set('notes')} /></Field>
        {err ? <p role="alert" style={{ color: 'var(--bad)', margin: '8px 0 0' }}>{err}</p> : null}
        <div className="da" style={{ marginTop: 14 }}>
          <button type="button" className="btn" onClick={onClose}>Hủy</button>
          <button type="submit" className="btn p" disabled={!f.name.trim()}>Lưu</button>
        </div>
      </form>
    </OpsDialog>
  );
}

function DeleteLocation({ loc, onClose }: { loc: Location | null; onClose: () => void }) {
  const act = useAct();
  const opts = useLocationOptions();
  const [to, setTo] = useState('none');
  const [err, setErr] = useState('');
  useEffect(() => { setTo('none'); setErr(''); }, [loc]);
  const n = loc?.device_count ?? 0;
  const submit = async () => {
    if (!loc) return;
    setErr('');
    try {
      await api.del(`/admin/v1/locations/${loc.id}`, { query: n > 0 ? { move_to: to } : {} });
      await act(async () => undefined, `Đã xóa địa điểm "${loc.name}".`);
      onClose();
    } catch (e) { setErr(treeErr(e)); }
  };
  return (
    <OpsDialog open={!!loc} onClose={onClose} label="Xóa địa điểm" width="min(480px,96vw)">
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>Xóa địa điểm &quot;{loc?.name}&quot;</h2>
        {n > 0 ? (
          <>
            <Note warn>Địa điểm đang có {n} thiết bị. Không thể xóa nếu chưa chuyển thiết bị đi.</Note>
            <Field label="Chuyển thiết bị sang">
              <select value={to} onChange={(e) => setTo(e.target.value)}>
                <option value="none">— Bỏ gắn địa điểm —</option>
                {(opts.data?.items ?? []).filter((l) => l.id !== loc?.id).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </Field>
          </>
        ) : <p className="sub">Địa điểm chưa có thiết bị nào. Thao tác này không thể hoàn tác.</p>}
        {err ? <p role="alert" style={{ color: 'var(--bad)', margin: '8px 0 0' }}>{err}</p> : null}
        <div className="da" style={{ marginTop: 14 }}>
          <button type="button" className="btn" onClick={onClose}>Hủy</button>
          <button type="submit" className="btn d">{n > 0 ? 'Chuyển thiết bị và xóa' : 'Xóa địa điểm'}</button>
        </div>
      </form>
    </OpsDialog>
  );
}

/** Gán thiết bị vào địa điểm: tìm thiết bị rồi tích chọn. */
function AssignDevices({ loc, onClose }: { loc: Location | null; onClose: () => void }) {
  const act = useAct();
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [err, setErr] = useState('');
  useEffect(() => { setQ(''); setPick(new Set()); setErr(''); }, [loc]);
  const list = useQuery({ enabled: !!loc, queryKey: ['/admin/v1/device-groups', 'assign-pick', q], queryFn: () => api.get('/admin/v1/device-groups/devices', { query: { ...(q ? { q } : {}), page_size: 50 }, schema: listOf(treeDeviceSchema) }) });
  const rows = (list.data?.items ?? []).filter((d) => d.location_id !== loc?.id);
  const submit = async () => {
    if (!loc) return;
    setErr('');
    try {
      await api.put('/admin/v1/locations/assign', { body: { device_ids: [...pick], location_id: loc.id } });
      await act(async () => undefined, `Đã gán ${pick.size} thiết bị vào "${loc.name}".`);
      onClose();
    } catch (e) { setErr(treeErr(e)); }
  };
  return (
    <OpsDialog open={!!loc} onClose={onClose} label="Gán thiết bị vào địa điểm" width="min(600px,96vw)">
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>Gán thiết bị vào &quot;{loc?.name}&quot;</h2>
        <Field label="Tìm thiết bị"><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tên, MAC, serial..." /></Field>
        <div style={{ maxHeight: 280, overflow: 'auto', margin: '8px 0' }}>
          {list.isLoading ? <LoadingBlock /> : !rows.length ? <EmptyBlock>Không có thiết bị phù hợp.</EmptyBlock> : rows.map((d) => (
            <label key={d.id} style={{ display: 'flex', gap: 8, padding: '6px 4px', alignItems: 'center' }}>
              <input type="checkbox" checked={pick.has(d.id)} onChange={() => setPick((s) => { const n = new Set(s); if (n.has(d.id)) n.delete(d.id); else n.add(d.id); return n; })} />
              <span><b>{d.name}</b> <span style={{ color: 'var(--mut)' }}>{[d.location_name ? `đang ở ${d.location_name}` : 'chưa gán địa điểm', d.mac].filter(Boolean).join(' · ')}</span></span>
            </label>
          ))}
        </div>
        {err ? <p role="alert" style={{ color: 'var(--bad)', margin: '8px 0 0' }}>{err}</p> : null}
        <div className="da" style={{ marginTop: 14 }}>
          <button type="button" className="btn" onClick={onClose}>Hủy</button>
          <button type="submit" className="btn p" disabled={!pick.size}>Gán {pick.size || ''} thiết bị</button>
        </div>
      </form>
    </OpsDialog>
  );
}

export default function Locations() {
  const { can } = useAuth();
  const canWrite = can('devices', 'write');
  const [sp, setSp] = useSearchParams();
  const q = sp.get('q') ?? '';
  const type = sp.get('type') ?? '';
  const [qDraft, setQDraft] = useState(q);
  const [edit, setEdit] = useState<Location | 'new' | null>(null);
  const [del, setDel] = useState<Location | null>(null);
  const [asg, setAsg] = useState<Location | null>(null);
  const setParam = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  useEffect(() => { const t = setTimeout(() => { if (qDraft !== q) setParam('q', qDraft.trim()); }, 350); return () => clearTimeout(t); }, [qDraft]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = useQuery({
    queryKey: ['/admin/v1/locations', 'list', q, type],
    queryFn: () => api.get('/admin/v1/locations', { query: { page_size: PAGE_SIZE, ...(q ? { q } : {}), ...(type ? { filter: `venue_type:${type}` } : {}) }, schema: listOf(locationSchema) }),
  });
  const rows = list.data?.items ?? [];
  const devTotal = rows.reduce((a, l) => a + l.device_count, 0);
  return (
    <>
      <PageHead title="Địa điểm đặt thiết bị" sub="Nơi lắp màn hình: siêu thị, sân bay, thang máy, F&B, bệnh viện, khách sạn. Gán thiết bị vào địa điểm để quản lý theo vị trí." actions={canWrite ? <Btn tone="p" icon="plus" onClick={() => setEdit('new')}>Thêm địa điểm</Btn> : undefined} />
      <div className="g g4">
        <Kpi label="Địa điểm" icon="link" value={num(list.data?.total ?? rows.length)} foot="Theo bộ lọc hiện tại" />
        <Kpi label="Thiết bị đã gán" icon="tv" value={num(devTotal)} foot="Trong các địa điểm đang hiển thị" />
      </div>
      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="cp" style={{ paddingBottom: 0 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
            <input id="loc-q" type="search" aria-label="Tìm địa điểm" value={qDraft} onChange={(e) => setQDraft(e.target.value)} placeholder="Tìm tên, địa chỉ, tỉnh, người liên hệ..." style={{ flex: 1, minWidth: 220 }} />
            <select id="loc-t" aria-label="Loại địa điểm" value={type} onChange={(e) => setParam('type', e.target.value)}>
              <option value="">Mọi loại địa điểm</option>
              {Object.entries(VENUE_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        </div>
        <div className="tw">
          {list.isLoading ? <LoadingBlock /> : list.isError ? <ErrorBlock error={list.error} onRetry={() => void list.refetch()} /> : !rows.length ? <EmptyBlock>Chưa có địa điểm nào{q || type ? ' khớp bộ lọc' : '. Bấm "Thêm địa điểm" để tạo địa điểm đầu tiên'}.</EmptyBlock> : (
            <table className="tbl">
              <thead><tr><th>Địa điểm</th><th>Loại</th><th>Địa chỉ</th><th>Liên hệ</th><th>Tọa độ</th><th>Thiết bị</th><th>Thao tác</th></tr></thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.id}>
                    <td><b>{l.name}</b>{l.status === 'inactive' ? <> <Tag tone="warn">Tạm ngưng</Tag></> : null}{l.notes ? <div style={{ color: 'var(--mut)', fontSize: 12.5 }}>{l.notes}</div> : null}</td>
                    <td>{VENUE_TYPES[l.venue_type] ?? l.venue_type}</td>
                    <td>{[l.address, l.district, l.province].filter(Boolean).join(', ') || '—'}</td>
                    <td>{l.contact_name ?? '—'}<div className="mono" style={{ color: 'var(--mut)', fontSize: 12.5 }}>{l.contact_phone ?? ''}</div></td>
                    <td className="mono">{l.lat != null && l.lng != null ? `${l.lat}, ${l.lng}` : '—'}</td>
                    <td className="mono">{l.online_count}/{l.device_count} <span style={{ color: 'var(--mut)' }}>trực tuyến</span></td>
                    <td>
                      {canWrite ? (
                        <div className="acts" style={{ flexWrap: 'wrap' }}>
                          <button type="button" className="btn sm" onClick={() => setAsg(l)}>Gán thiết bị</button>
                          <button type="button" className="btn sm" onClick={() => setEdit(l)}>Sửa</button>
                          <button type="button" className="btn sm d" onClick={() => setDel(l)}>Xóa</button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <LocationForm edit={edit} onClose={() => setEdit(null)} />
      <DeleteLocation loc={del} onClose={() => setDel(null)} />
      <AssignDevices loc={asg} onClose={() => setAsg(null)} />
    </>
  );
}
