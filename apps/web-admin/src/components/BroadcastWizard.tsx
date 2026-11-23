import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { broadcastDevicePickSchema, broadcastDeliverySchema, broadcastSchema, listOf, mediaSchema, type Broadcast } from '../api/schemas';
import { useAct } from '../api/hooks';
import { Dialog } from './Dialog';
import { Btn, Field, LoadingBlock, Note, Tag } from './ui';
import { LivePreview } from './LivePreview';
import { QrEditor, WeatherEditor } from './ZoneExtras';
import { usePreviewItems } from './PreviewDialogs';
import { ZoneCanvas } from './ZoneCanvas';
import { IMAGE_DEFAULT_S, RES_LABEL, type Resolution, MAX_ZONES, PRESETS, TRANSITIONS, ZONE_LABEL, clampZone, isMediaZone, layoutError, newZone, templateSchema, zoneName, type Orientation, type Zone, type ZoneType } from '../lib/layout';
import { RichEditor } from './RichText';

const BASE = '/admin/v1/broadcast';
const TARGETS: { id: string; label: string; orientation: Orientation }[] = [
  { id: 'elevator', label: 'Thang máy (dọc 9:16)', orientation: 'portrait' },
  { id: 'tv', label: 'TV (ngang 16:9)', orientation: 'landscape' },
  { id: 'led_p5', label: 'LED P5 (dọc)', orientation: 'portrait' },
];
const STEPS = ['01. Thông tin chung', '02. Thiết kế phân vùng', '03. Chọn thiết bị', '04. Lập lịch & Phát hành'];
const TOOLS: ZoneType[] = ['video', 'image', 'marquee', 'text', 'clock', 'weather', 'qr'];
const toMin = (s: string): number => { const [h, m] = s.split(':').map(Number); return (h ?? 0) * 60 + (m ?? 0); };
const toTime = (n: number): string => `${String(Math.floor(n / 60) % 24).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
const CMD_LABEL: Record<string, string> = { pending: 'Đang chờ thiết bị nhận', delivered: 'Đã giao, chờ xác nhận', acked: 'Thiết bị đã nhận', failed: 'Lỗi', expired: 'Hết hạn (thiết bị sẽ tự đồng bộ)' };

const mk = (id: string, type: ZoneType, x: number, y: number, w: number, h: number, extra: Partial<Zone> = {}): Zone => ({ id, type, x, y, w, h, z: 0, transition: type === 'video' || type === 'image' ? 'fade' : 'none', ...extra });
const BAR: Partial<Zone> = { text: 'Chào mừng quý khách', bg_color: '#DC2626', text_color: '#FFFFFF', font_size: 18, scroll_speed: 60 };
/** Mau nhanh giong QuangBao Cloud: Toan man hinh, Chia doi 50/50, 3 vung + Chu chay. */
export function quickLayout(kind: 'full' | 'half' | 'three', o: Orientation): Zone[] {
  if (kind === 'full') return [mk('main', 'video', 0, 0, 100, 100)];
  if (kind === 'half') return o === 'portrait' ? [mk('top', 'video', 0, 0, 100, 50), mk('bottom', 'image', 0, 50, 100, 50)] : [mk('left', 'video', 0, 0, 50, 100), mk('right', 'image', 50, 0, 50, 100)];
  return o === 'portrait'
    ? [mk('main', 'video', 0, 0, 100, 55), mk('side', 'image', 0, 55, 100, 35), mk('bar', 'marquee', 0, 90, 100, 10, { z: 1, ...BAR })]
    : [mk('main', 'video', 0, 0, 70, 88), mk('side', 'image', 70, 0, 30, 88), mk('bar', 'marquee', 0, 88, 100, 12, { z: 1, ...BAR })];
}

interface Props { program: Broadcast | null; onClose: () => void; onSaved?: (p: Broadcast) => void }

/** Trinh tao/sua chuong trinh phat song 4 buoc (kieu QuangBao Cloud): thong tin -> thiet ke phan vung -> chon thiet bi -> lap lich & phat hanh (xem thu ngay). */
export function BroadcastWizard({ program, onClose, onSaved }: Props) {
  const act = useAct();
  const [step, setStep] = useState(0);
  const [saved, setSaved] = useState<Broadcast | null>(null); // sau khi luu/phat hanh
  const [busy, setBusy] = useState(false);
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
  const defOrientation = (t: string): Orientation => TARGETS.find((x) => x.id === t)?.orientation ?? 'portrait';
  const [orientation, setOrientation] = useState<Orientation>(program?.layout?.orientation ?? defOrientation(program?.target_type ?? 'elevator'));
  const [zones, setZones] = useState<Zone[]>((program?.layout?.zones as Zone[] | undefined) ?? quickLayout('full', program?.layout?.orientation ?? defOrientation(program?.target_type ?? 'elevator')));
  const [templateId, setTemplateId] = useState<string | null>(program?.layout?.template_id ?? null);
  const [ids, setIds] = useState<string[]>(program?.items.map((i) => i.creative_id) ?? []);
  const [itemZones, setItemZones] = useState<Record<string, string>>(Object.fromEntries((program?.items ?? []).flatMap((i) => (i.zone_id ? [[i.creative_id, i.zone_id] as [string, string]] : []))));
  const [resolution, setResolutionS] = useState<Resolution>(() => { try { const v = localStorage.getItem('ams-bw-res'); return v === 'fhd' || v === '4k' ? v : 'view'; } catch { return 'view'; } });
  const setResolution = (r: Resolution) => { setResolutionS(r); try { localStorage.setItem('ams-bw-res', r); } catch { /* ignore */ } };
  const [selected, setSelected] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [previewing, setPreviewing] = useState(false);
  const [devMode, setDevMode] = useState<'devices' | 'region'>(program && program.device_count === 0 ? 'region' : 'devices');
  const [deviceIds, setDeviceIds] = useState<string[]>(program?.device_ids ?? []);
  const [devQ, setDevQ] = useState('');
  const [devRegion, setDevRegion] = useState('');
  const [pickMedia, setPickMedia] = useState('');

  const tpls = useQuery({ queryKey: ['/admin/v1/layout-templates', 'wizard'], queryFn: () => api.get('/admin/v1/layout-templates', { query: { page_size: 100 }, schema: listOf(templateSchema) }) });
  const media = useQuery({ queryKey: ['/admin/v1/media', 'broadcast-pick'], queryFn: () => api.get('/admin/v1/media', { query: { page_size: 200, status: 'approved' }, schema: listOf(mediaSchema) }) });
  const pool = useMemo(() => (media.data?.items ?? []).filter((m) => (m as { campaign_id?: unknown }).campaign_id == null || ids.includes(m.id)), [media.data, ids]);
  const nameOf = (id: string) => media.data?.items.find((m) => m.id === id)?.name ?? program?.items.find((i) => i.creative_id === id)?.name ?? id;
  const signage = f.target_type === 'elevator' || f.target_type === 'led_p5';

  const mediaZones = zones.filter(isMediaZone);
  const firstMedia = mediaZones[0]?.id ?? null;
  const zoneOfItem = (id: string): string | null => {
    const z = itemZones[id];
    return z && mediaZones.some((m) => m.id === z) ? z : firstMedia;
  };
  const itemsIn = (z: Zone): string[] => ids.filter((id) => zoneOfItem(id) === z.id);
  const effZoneOf = useMemo(() => Object.fromEntries(ids.map((id) => [id, zoneOfItem(id)])), [ids, itemZones, zones]); // eslint-disable-line react-hooks/exhaustive-deps
  const allDur = useMemo(() => Object.assign({}, ...zones.map((z) => z.durations ?? {})) as Record<string, number>, [zones]);
  const prev = usePreviewItems(ids, effZoneOf, allDur);
  const itemsOfZone = (z: Zone) => prev.items.filter((i) => i.zoneId === z.id);
  const visibleZones = zones.filter((z) => !hidden.has(z.id));
  const layoutErr = layoutError(zones);
  const sel = zones.find((z) => z.id === selected) ?? null;

  const setZ = (id: string, patch: Partial<Zone>) => setZones((cur) => cur.map((z) => (z.id === id ? clampZone({ ...z, ...patch }) : z)));
  const reindex = (a: Zone[]) => a.map((z, i) => ({ ...z, z: Math.min(20, i) }));
  const addZone = (t: ZoneType) => {
    if (zones.length >= MAX_ZONES) return;
    const z = newZone(t, zones);
    setZones(reindex([...zones, z]));
    setSelected(z.id);
  };
  const delZone = (id: string) => { setZones(reindex(zones.filter((z) => z.id !== id))); if (selected === id) setSelected(null); };
  const moveZone = (i: number, d: number) => setZones((cur) => { const j = i + d; if (j < 0 || j >= cur.length) return cur; const n = [...cur]; [n[i], n[j]] = [n[j]!, n[i]!]; return reindex(n); });
  const applyZones = (z: Zone[], o: Orientation, tpl: string | null) => { setZones(z); setOrientation(o); setTemplateId(tpl); setSelected(null); setHidden(new Set()); };
  const pickTemplate = (id: string) => {
    const preset = PRESETS.find((p) => p.id === id);
    const tp = tpls.data?.items.find((x) => x.id === id);
    const src = preset ?? tp;
    if (src) applyZones(src.zones.map((z) => ({ ...z })), src.orientation, tp ? tp.id : null);
  };
  const addMedia = (zone: Zone, id: string) => {
    if (!id || ids.includes(id)) return;
    setIds([...ids, id]);
    setItemZones((c) => ({ ...c, [id]: zone.id }));
  };
  const setDur = (zid: string, cid: string, v: string) => setZones((cur) => cur.map((z) => { if (z.id !== zid) return z; const d = { ...(z.durations ?? {}) }; const n = Math.round(Number(v)); if (!v || !(n >= 1)) delete d[cid]; else d[cid] = Math.min(3600, n); return { ...z, durations: Object.keys(d).length ? d : null }; }));
  const removeMedia = (id: string) => { setZones((cur) => cur.map((z) => (z.durations && id in z.durations ? { ...z, durations: Object.fromEntries(Object.entries(z.durations).filter(([k]) => k !== id)) } : z))); setIds(ids.filter((x) => x !== id)); setItemZones((c) => { const n = { ...c }; delete n[id]; return n; }); };
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const dropMedia = (to: string) => {
    if (dragId && dragId !== to) setIds((cur) => { const n = cur.filter((x) => x !== dragId); n.splice(n.indexOf(to), 0, dragId); return n; });
    setDragId(null); setOverId(null);
  };
  const quick = (k: 'full' | 'half' | 'three') => {
    if (zones.length > 0 && !window.confirm('Áp dụng mẫu nhanh sẽ thay thế các vùng hiện có. Tiếp tục?')) return;
    applyZones(quickLayout(k, orientation), orientation, null);
  };
  const moveMedia = (id: string, d: number) => setIds((cur) => {
    const z = zoneOfItem(id);
    const same = cur.filter((x) => zoneOfItem(x) === z);
    const k = same.indexOf(id);
    const other = same[k + d];
    if (!other) return cur;
    const n = [...cur];
    const a = n.indexOf(id);
    const b = n.indexOf(other);
    [n[a], n[b]] = [n[b]!, n[a]!];
    return n;
  });

  // buoc 3: danh sach thiet bi de chon
  const pickQuery = useQuery({
    queryKey: [BASE, 'devices-pick', f.target_type, devRegion, devQ],
    queryFn: () => api.get(`${BASE}/devices-pick`, { query: { target: f.target_type, regions: devRegion, q: devQ }, schema: broadcastDevicePickSchema }),
    enabled: step === 2 && devMode === 'devices',
  });
  const shown = pickQuery.data?.items ?? [];
  const toggleDev = (id: string) => setDeviceIds((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  useEffect(() => { if (selected && !zones.some((z) => z.id === selected)) setSelected(null); }, [zones, selected]);

  const stepError = (s: number): string => {
    if (s === 0 && !f.name.trim()) return 'Nhập tên chương trình.';
    if (s >= 1 && layoutErr) return layoutErr;
    if (s >= 3 && f.start_date && f.end_date && f.end_date < f.start_date) return 'Ngày kết thúc phải sau ngày bắt đầu.';
    if (s >= 3 && f.end !== '24:00' && toMin(f.end) <= toMin(f.start)) return 'Giờ kết thúc phải sau giờ bắt đầu.';
    return '';
  };
  const go = (n: number) => {
    if (n > step) for (let s = step; s < n; s++) { const e = stepError(s); if (e) { setErr(e); setStep(s); return; } }
    setErr('');
    setStep(n);
  };
  const [err, setErr] = useState('');

  const body = () => {
    const endMin = f.end === '24:00' ? 1440 : toMin(f.end);
    const validZ = new Set(mediaZones.map((z) => z.id));
    return {
      name: f.name.trim(),
      target_type: f.target_type,
      regions: devMode === 'region' ? f.regions.split(',').map((x) => x.trim()).filter(Boolean) : [],
      start_date: f.start_date || null,
      end_date: f.end_date || null,
      start_min: toMin(f.start),
      end_min: endMin,
      priority: Number(f.priority),
      ...(signage ? { header: f.header.trim() === '' ? null : f.header, footer: f.footer.trim() === '' ? null : f.footer } : {}),
      creative_ids: ids,
      layout: { template_id: templateId, orientation, zones },
      item_zones: Object.fromEntries(ids.flatMap((id) => { const z = zoneOfItem(id); return z && validZ.has(z) ? [[id, z] as [string, string]] : []; })),
      device_ids: devMode === 'devices' ? deviceIds : [],
    };
  };
  const save = async (publish: boolean) => {
    for (let s = 0; s <= 3; s++) { const e = stepError(s); if (e) { setErr(e); setStep(s); return; } }
    if (devMode === 'devices' && deviceIds.length === 0) { setErr('Chọn ít nhất một thiết bị, hoặc chuyển sang "Theo khu vực".'); setStep(2); return; }
    if (publish && ids.length === 0) { setErr('Thêm ít nhất một tệp (video/ảnh) vào vùng để phát hành.'); setStep(1); return; }
    setErr('');
    setBusy(true);
    try {
      const b = body();
      let p = await act(() => (program ? api.put(`${BASE}/${program.id}`, { body: b, schema: broadcastSchema }) : api.post(BASE, { body: b, schema: broadcastSchema })), publish ? undefined : program ? 'Đã lưu chương trình.' : 'Đã lưu bản nháp.');
      if (!p) return;
      if (publish) {
        const pub = await act(() => api.post(`${BASE}/${p!.id}/publish`, { body: {}, schema: broadcastSchema }), (r) => `Đã phát hành, gửi lệnh tới ${r.push?.pushed ?? 0} thiết bị.`);
        if (!pub) { setSaved(p); onSaved?.(p); return; }
        p = pub;
        setSaved(p);
        onSaved?.(p);
      } else {
        onSaved?.(p);
        onClose();
      }
    } finally {
      setBusy(false);
    }
  };

  const deliver = useQuery({
    queryKey: [BASE, 'delivery', saved?.id],
    queryFn: () => api.get(`${BASE}/${saved!.id}/delivery`, { schema: broadcastDeliverySchema }),
    enabled: !!saved && saved.status === 'published',
    refetchInterval: 4000,
  });

  // ---------------------------------------------------------------- giao dien
  const head = (
    <div className="wz-head">
      <h2>{program ? 'Sửa chương trình phát sóng' : 'Tạo chương trình phát sóng mới'}</h2>
      <div className="wz-steps" role="tablist" aria-label="Các bước">
        {STEPS.map((s, i) => (
          <button key={s} type="button" role="tab" className={`wz-step${i < step ? ' done' : ''}`} aria-current={i === step ? 'step' : undefined} aria-selected={i === step} onClick={() => go(i)} disabled={!!saved}>{s}</button>
        ))}
      </div>
      <Btn aria-label="Đóng" onClick={onClose}>✕</Btn>
    </div>
  );

  const step1 = (
    <div style={{ maxWidth: 920, margin: '0 auto' }}>
      <Field label="Tên chương trình"><input required maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ví dụ: Ưu đãi cuối năm" /></Field>
      <Field label="Loại màn hình">
        <select value={f.target_type} onChange={(e) => { const t = e.target.value; setF({ ...f, target_type: t }); const o = defOrientation(t); if (o !== orientation) { setOrientation(o); setZones(quickLayout('full', o)); setTemplateId(null); setItemZones({}); } setDeviceIds([]); }}>
          {TARGETS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
      </Field>
      <Field label="Định hướng màn hình">
        <div style={{ display: 'flex', gap: 8 }}>
          {(['portrait', 'landscape'] as Orientation[]).map((o) => (
            <Btn key={o} tone={orientation === o ? 'p' : ''} aria-pressed={orientation === o} onClick={() => { if (o !== orientation) { setOrientation(o); setZones(quickLayout('full', o)); setTemplateId(null); setItemZones({}); setSelected(null); } }}>{o === 'portrait' ? 'Dọc 9:16' : 'Ngang 16:9'}</Btn>
          ))}
        </div>
      </Field>
      <Field label="Độ phân giải màn hình" hint="Chỉ để hiển thị nhãn kích thước điểm ảnh ở khung thiết kế bước 02."><select value={resolution} onChange={(e) => setResolution(e.target.value as Resolution)}>{(Object.keys(RES_LABEL) as Resolution[]).map((r) => <option key={r} value={r}>{RES_LABEL[r]}</option>)}</select></Field>
      <h3 style={{ margin: '18px 0 8px', fontSize: 15 }}>Mẫu bố cục có sẵn</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
        {[...PRESETS.filter((p) => p.orientation === orientation), ...(tpls.data?.items ?? []).filter((t) => t.orientation === orientation)].map((p) => (
          <button key={p.id} type="button" className="card cp" style={{ textAlign: 'left', cursor: 'pointer', border: templateId === p.id || (!templateId && JSON.stringify(zones) === JSON.stringify(p.zones)) ? '2px solid var(--pri, #2563EB)' : '1px solid var(--line)' }} onClick={() => pickTemplate(p.id)}>
            <b style={{ fontSize: 13 }}>{p.name}</b>
            <div style={{ color: 'var(--mut)', fontSize: 12, marginTop: 4 }}>{orientation === 'portrait' ? 'Dọc 9:16' : 'Ngang 16:9'} · {p.zones.length} vùng</div>
            <div style={{ color: 'var(--mut)', fontSize: 11.5, marginTop: 2 }}>{p.zones.map((z, i) => zoneName(z, i)).join(' · ')}</div>
          </button>
        ))}
      </div>
      <Note>Bố cục có thể chỉnh tiếp ở bước 02. Mẫu riêng của bạn được tạo ở trang "Mẫu bố cục".</Note>
    </div>
  );

  const layerList = (
    <div>
      <h3 style={{ margin: '0 0 10px', fontSize: 14 }}>Danh sách lớp thành phần ({zones.length})</h3>
      {zones.map((z, i) => (
        <div key={z.id} className="wz-layer" role="button" tabIndex={0} aria-pressed={z.id === selected} onClick={() => setSelected(z.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelected(z.id); }}>
          <div className="nm">{zoneName(z, i)}<small>{Math.round(z.x)}%, {Math.round(z.y)}% · {Math.round(z.w)}×{Math.round(z.h)}%</small></div>
          <button type="button" aria-label={`${hidden.has(z.id) ? 'Hiện' : 'Ẩn'} ${zoneName(z, i)}`} onClick={(e) => { e.stopPropagation(); setHidden((h) => { const n = new Set(h); if (n.has(z.id)) n.delete(z.id); else n.add(z.id); return n; }); }}>{hidden.has(z.id) ? '🚫' : '👁'}</button>
          <button type="button" aria-label={`Lên ${zoneName(z, i)}`} disabled={i === 0} onClick={(e) => { e.stopPropagation(); moveZone(i, -1); }}>↑</button>
          <button type="button" aria-label={`Xuống ${zoneName(z, i)}`} disabled={i === zones.length - 1} onClick={(e) => { e.stopPropagation(); moveZone(i, 1); }}>↓</button>
          <button type="button" aria-label={`Xóa ${zoneName(z, i)}`} style={{ color: '#DC2626' }} onClick={(e) => { e.stopPropagation(); delZone(z.id); }}>🗑</button>
        </div>
      ))}
      {layoutErr ? <p role="alert" style={{ color: 'var(--bad, #c0392b)', fontSize: 13 }}>{layoutErr}</p> : null}
    </div>
  );

  const props = sel ? (
    <div role="group" aria-label="Thuộc tính thành phần">
      <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Thuộc tính thành phần</h3>
      <Field label="Tên vùng"><input maxLength={60} value={sel.name ?? ''} onChange={(e) => setZones((c) => c.map((z) => (z.id === sel.id ? { ...z, name: e.target.value } : z)))} /></Field>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 6 }} className="wz-xywh">
        {(['x', 'y', 'w', 'h'] as const).map((k) => (
          <Field key={k} label={{ x: 'X (%)', y: 'Y (%)', w: 'Rộng (%)', h: 'Cao (%)' }[k]}>
            <input type="number" min={0} max={100} step={0.5} value={Math.round(sel[k] * 10) / 10} onChange={(e) => setZ(sel.id, { [k]: Number(e.target.value) })} />
          </Field>
        ))}
      </div>
      {isMediaZone(sel) ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '12px 0 6px' }}>
            <b style={{ fontSize: 13 }}>Danh sách tư liệu phát ({itemsIn(sel).length})</b>
          </div>
          {itemsIn(sel).length === 0 ? <p style={{ color: 'var(--mut)', fontSize: 13, margin: '0 0 8px' }}>Chưa có tư liệu. Thêm video/ảnh bên dưới.</p> : null}
          {itemsIn(sel).map((id) => {
            const it = prev.items.find((x) => x.id === id);
            return (
              <div key={id} className={`wz-media${overId === id ? ' over' : ''}`} draggable data-media={id} onDragStart={() => setDragId(id)} onDragOver={(e) => { e.preventDefault(); setOverId(id); }} onDragLeave={() => setOverId(null)} onDrop={(e) => { e.preventDefault(); dropMedia(id); }} onDragEnd={() => { setDragId(null); setOverId(null); }}>
                <div style={{ width: 40, height: 40, borderRadius: 6, overflow: 'hidden', background: '#111', flex: '0 0 auto' }}>
                  {it?.url ? (it.kind === 'image' ? <img src={it.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <video src={`${it.url}#t=0.5`} muted preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />) : null}
                </div>
                <div className="nm">{nameOf(id)}</div>
                <input type="number" min={1} max={3600} aria-label={`Số giây hiển thị ${nameOf(id)}`} title={it?.kind === 'image' ? 'Giây hiển thị (mặc định 5)' : 'Giây phát tối đa (trống = phát hết video)'} placeholder={it?.kind === 'image' ? String(IMAGE_DEFAULT_S) : 'Hết'} value={sel.durations?.[id] ?? ''} onChange={(e) => setDur(sel.id, id, e.target.value)} style={{ width: 52, height: 28, padding: '0 4px' }} />
                <span aria-hidden style={{ fontSize: 11, color: 'var(--mut)' }}>s</span>
                <button type="button" aria-label={`Lên ${nameOf(id)}`} onClick={() => moveMedia(id, -1)}>↑</button>
                <button type="button" aria-label={`Xuống ${nameOf(id)}`} onClick={() => moveMedia(id, 1)}>↓</button>
                <button type="button" aria-label={`Bỏ ${nameOf(id)}`} style={{ color: '#DC2626' }} onClick={() => removeMedia(id)}>🗑</button>
              </div>
            );
          })}
          <Field label="+ Thêm tư liệu (kho đã duyệt, chưa gắn chiến dịch)">
            <select value={pickMedia} onChange={(e) => { addMedia(sel, e.target.value); setPickMedia(''); }}>
              <option value="">{media.isLoading ? 'Đang tải…' : '— chọn tệp —'}</option>
              {pool.filter((m) => !ids.includes(m.id)).map((m) => <option key={m.id} value={m.id}>{m.delivery === 'stream' ? '[Link] ' : ''}{m.name}{m.width && m.height ? ` · ${m.width}×${m.height}` : ''}</option>)}
            </select>
          </Field>
          <Field label="Hiệu ứng chuyển cảnh"><select value={sel.transition} onChange={(e) => setZ(sel.id, { transition: e.target.value })}>{TRANSITIONS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></Field>
        </>
      ) : null}
      {sel.type === 'marquee' || sel.type === 'text' ? (
        <>
          <div className="fd">
            <label id={`rt-l-${sel.id}`}>{sel.type === 'marquee' ? 'Nội dung chữ chạy' : 'Nội dung hiển thị'}</label>
            <RichEditor key={`${sel.id}:${sel.type}`} label={sel.type === 'marquee' ? 'Nội dung chữ chạy' : 'Nội dung hiển thị'} line={sel.type === 'marquee'} rich={sel.rich} text={sel.text} baseColor={sel.text_color} baseBg={sel.bg_color ?? (sel.type === 'marquee' ? '#DC2626' : '#111827')} baseSize={sel.font_size ?? (sel.type === 'marquee' ? 18 : 24)} onChange={(v) => setZ(sel.id, { rich: v.rich || undefined, text: v.text })} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Field label="Màu nền"><input type="color" value={sel.bg_color ?? '#DC2626'} onChange={(e) => setZ(sel.id, { bg_color: e.target.value.toUpperCase() })} /></Field>
            <Field label="Màu chữ"><input type="color" value={sel.text_color ?? '#FFFFFF'} onChange={(e) => setZ(sel.id, { text_color: e.target.value.toUpperCase() })} /></Field>
            <Field label="Cỡ chữ"><input type="number" min={8} max={200} value={sel.font_size ?? 18} onChange={(e) => setZ(sel.id, { font_size: Number(e.target.value) })} /></Field>
            {sel.type === 'marquee' ? <Field label="Hướng chạy"><select value={sel.scroll_dir ?? 'left'} onChange={(e) => setZ(sel.id, { scroll_dir: e.target.value as 'left' | 'right' })}><option value="left">Từ phải sang trái</option><option value="right">Từ trái sang phải</option></select></Field> : null}
            {sel.type === 'marquee' ? <Field label="Tốc độ (0–100)"><input type="number" min={0} max={100} value={sel.scroll_speed ?? 60} onChange={(e) => setZ(sel.id, { scroll_speed: Number(e.target.value) })} /></Field> : null}
          </div>
        </>
      ) : null}
      {sel.type === 'clock' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <Field label="Định dạng giờ"><select value={sel.clock?.hour12 ? '12' : '24'} onChange={(e) => setZ(sel.id, { clock: { ...sel.clock, hour12: e.target.value === '12' } })}><option value="24">24 giờ</option><option value="12">12 giờ (AM/PM)</option></select></Field>
          <Field label="Múi giờ"><select value={sel.clock?.tz ?? ''} onChange={(e) => setZ(sel.id, { clock: { ...sel.clock, tz: e.target.value || undefined } })}><option value="">Theo thiết bị</option><option value="Asia/Ho_Chi_Minh">Việt Nam (GMT+7)</option><option value="Asia/Bangkok">Bangkok</option><option value="Asia/Singapore">Singapore</option><option value="Asia/Tokyo">Tokyo</option><option value="UTC">UTC</option></select></Field>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, gridColumn: '1 / -1' }}><input type="checkbox" checked={!!sel.clock?.date} onChange={(e) => setZ(sel.id, { clock: { ...sel.clock, date: e.target.checked } })} />Hiện ngày tháng</label>
        </div>
      ) : null}
      {sel.type === 'qr' ? <QrEditor zone={sel} set={(p) => setZ(sel.id, p)} /> : null}
      {sel.type === 'weather' ? <WeatherEditor zone={sel} set={(p) => setZ(sel.id, p)} /> : null}
      {sel.type === 'clock' || sel.type === 'weather' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <Field label="Màu nền"><input type="color" value={sel.bg_color ?? '#111827'} onChange={(e) => setZ(sel.id, { bg_color: e.target.value.toUpperCase() })} /></Field>
          <Field label="Màu chữ"><input type="color" value={sel.text_color ?? '#FFFFFF'} onChange={(e) => setZ(sel.id, { text_color: e.target.value.toUpperCase() })} /></Field>
        </div>
      ) : null}
    </div>
  ) : <p style={{ color: 'var(--mut)', fontSize: 13 }}>Chọn một vùng trên khung hoặc trong danh sách lớp để sửa thuộc tính và thêm tư liệu.</p>;

  const step2 = (
    <div className="wz-3" style={{ margin: '-18px -24px', height: 'calc(100% + 36px)' }}>
      <div>{layerList}</div>
      <div style={{ padding: 10 }}>
        {previewing ? (
          prev.loading ? <LoadingBlock /> : <LivePreview orientation={orientation} zones={visibleZones} items={prev.items} header={signage ? f.header : null} footer={signage ? f.footer : null} maxHeight={560} onRetry={prev.refresh} />
        ) : (
          <>
            <ZoneCanvas orientation={orientation} resolution={resolution} zones={zones} selected={selected} onSelect={setSelected} onChange={(z) => setZones(z)} itemsOf={itemsOfZone} hidden={hidden} maxHeight={560} />
            <div style={{ color: 'var(--mut)', fontSize: 12, marginTop: 8, textAlign: 'center' }}>{zones.length}/{MAX_ZONES} vùng · Kéo vùng để di chuyển, kéo tay nắm xanh để đổi kích thước · Phím mũi tên nhích 1% (Shift 5%, Alt đổi kích thước) · {orientation === 'portrait' ? 'Khung dọc 9:16' : 'Khung ngang 16:9'}</div>
          </>
        )}
      </div>
      <div>
        <h3 className="wz-sec">Thêm thành phần</h3>
        <div className="wz-add">
          {TOOLS.map((t) => <Btn key={t} disabled={zones.length >= MAX_ZONES} onClick={() => addZone(t)}>+ {ZONE_LABEL[t]}</Btn>)}
        </div>
        <h3 className="wz-sec">Mẫu nhanh</h3>
        <div className="wz-add" style={{ gridTemplateColumns: '1fr', marginBottom: 6 }}>
          <Btn onClick={() => quick('full')}>Toàn màn hình</Btn>
          <Btn onClick={() => quick('half')}>Chia đôi 50/50</Btn>
          <Btn onClick={() => quick('three')}>3 vùng + Chữ chạy</Btn>
        </div>
        <Btn className="wz-dark" aria-pressed={previewing} onClick={() => setPreviewing((v) => !v)}>{previewing ? '✎ Quay lại chỉnh sửa' : '👁 Xem trước'}</Btn>
        {props}
      </div>
    </div>
  );

  const step3 = (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <Btn tone={devMode === 'devices' ? 'p' : ''} aria-pressed={devMode === 'devices'} onClick={() => setDevMode('devices')}>Chọn từng thiết bị</Btn>
        <Btn tone={devMode === 'region' ? 'p' : ''} aria-pressed={devMode === 'region'} onClick={() => setDevMode('region')}>Theo khu vực (tất cả thiết bị cùng loại màn)</Btn>
      </div>
      {devMode === 'region' ? (
        <Field label="Khu vực" hint="Mã khu vực cách nhau bằng dấu phẩy (vd HN, HCM). Để trống = tất cả thiết bị đã duyệt cùng loại màn."><input value={f.regions} onChange={(e) => setF({ ...f, regions: e.target.value })} /></Field>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) minmax(180px, 1fr) auto auto', gap: 10, alignItems: 'end' }}>
            <Field label="Tìm thiết bị"><input value={devQ} onChange={(e) => setDevQ(e.target.value)} placeholder="Tên hoặc mã thiết bị" /></Field>
            <Field label="Khu vực (lọc)"><input value={devRegion} onChange={(e) => setDevRegion(e.target.value)} placeholder="HN, HCM…" /></Field>
            <Btn style={{ marginBottom: 14 }} onClick={() => setDeviceIds((c) => [...new Set([...c, ...shown.map((d) => d.id)])])}>Chọn tất cả ({shown.length})</Btn>
            <Btn style={{ marginBottom: 14 }} onClick={() => setDeviceIds([])}>Bỏ chọn</Btn>
          </div>
          <p style={{ margin: '4px 0 8px', fontSize: 13 }}>Đã chọn <b>{deviceIds.length}</b> thiết bị. Chỉ hiện thiết bị đã duyệt, không bị khóa và đúng loại màn.</p>
          {pickQuery.isLoading ? <LoadingBlock /> : shown.length === 0 ? <Note warn>Không có thiết bị nào khớp. Kiểm tra loại màn ở bước 01 hoặc duyệt thiết bị ở trang Mạng lưới thiết bị.</Note> : (
            <table className="tbl">
              <thead><tr><th style={{ width: 40 }} /><th>Thiết bị</th><th>Khu vực</th><th>Loại</th><th>Trạng thái</th></tr></thead>
              <tbody>
                {shown.map((d) => (
                  <tr key={d.id}>
                    <td><input type="checkbox" aria-label={`Chọn ${d.name ?? d.id}`} checked={deviceIds.includes(d.id)} onChange={() => toggleDev(d.id)} /></td>
                    <td><b>{d.name ?? d.id}</b><div className="mono" style={{ fontSize: 11, color: 'var(--mut)' }}>{d.id}</div></td>
                    <td className="mono">{d.region ?? '—'}</td>
                    <td>{d.kind}</td>
                    <td><Tag tone={d.online ? 'ok' : 'warn'}>{d.online ? 'Trực tuyến' : 'Ngoại tuyến'}</Tag></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {pickQuery.data?.truncated ? <Note warn>Chỉ hiện 500 thiết bị đầu tiên. Lọc theo khu vực để thu hẹp.</Note> : null}
        </>
      )}
    </div>
  );

  const target = TARGETS.find((x) => x.id === f.target_type);
  const step4 = saved ? (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <Note>{saved.status === 'published' ? `Chương trình "${saved.name}" đã được phát hành.` : 'Đã lưu chương trình.'}{saved.push ? ` Đã gửi lệnh làm mới tới ${saved.push.pushed} thiết bị${saved.push.skipped ? ` (${saved.push.skipped} thiết bị bỏ qua)` : ''}; thiết bị sẽ tải video và nội dung mới ngay khi nhận lệnh.` : ''}</Note>
      <h3 style={{ margin: '14px 0 8px', fontSize: 15 }}>Tình trạng từng thiết bị</h3>
      {deliver.isLoading ? <LoadingBlock /> : (
        <table className="tbl">
          <thead><tr><th>Thiết bị</th><th>Khu vực</th><th>Trạng thái thiết bị</th><th>Lệnh làm mới</th></tr></thead>
          <tbody>
            {(deliver.data?.items ?? []).map((d) => (
              <tr key={d.id}>
                <td><b>{d.name ?? d.id}</b></td>
                <td className="mono">{d.region ?? '—'}</td>
                <td><Tag tone={d.online ? 'ok' : 'warn'}>{d.online ? 'Trực tuyến' : 'Ngoại tuyến'}</Tag></td>
                <td>{d.command ? <Tag tone={d.command.status === 'acked' ? 'ok' : d.command.status === 'failed' ? 'bad' : 'info'}>{CMD_LABEL[d.command.status] ?? d.command.status}</Tag> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p style={{ color: 'var(--mut)', fontSize: 12.5 }}>Bảng tự cập nhật 4 giây một lần. Thiết bị ngoại tuyến sẽ nhận nội dung ở lần đồng bộ kế tiếp.</p>
    </div>
  ) : (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1fr) minmax(280px, 420px)', gap: 24, alignItems: 'start' }}>
      <div>
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
        <h3 style={{ margin: '16px 0 6px', fontSize: 15 }}>Tóm tắt</h3>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.7 }}>
          <li><b>{f.name || '(chưa đặt tên)'}</b> · {target?.label} · {orientation === 'portrait' ? 'Dọc 9:16' : 'Ngang 16:9'}</li>
          <li>{zones.length} vùng · {ids.length} tệp video/ảnh</li>
          <li>{devMode === 'devices' ? `${deviceIds.length} thiết bị được chọn` : f.regions.trim() ? `Khu vực: ${f.regions}` : 'Tất cả thiết bị đã duyệt cùng loại màn'}</li>
          <li>{f.start_date || '…'} → {f.end_date || '…'} · {f.start}–{f.end} · ưu tiên {f.priority}</li>
        </ul>
        <Note>"Phát hành" sẽ lưu chương trình, xuất bản và gửi lệnh làm mới xuống các thiết bị đích để video, nội dung hiện lên ngay. "Lưu nháp" chưa gửi gì xuống thiết bị.</Note>
      </div>
      <div>
        <h3 style={{ margin: '0 0 8px', fontSize: 15, textAlign: 'center' }}>Xem thử ngay trước khi phát</h3>
        {prev.loading ? <LoadingBlock /> : ids.length === 0 ? <p style={{ color: 'var(--mut)', textAlign: 'center' }}>Chưa có tệp để xem thử. Thêm tư liệu ở bước 02.</p> : <LivePreview orientation={orientation} zones={visibleZones.length ? visibleZones : zones} items={prev.items} header={signage ? f.header : null} footer={signage ? f.footer : null} maxHeight={440} onRetry={prev.refresh} />}
      </div>
    </div>
  );

  return (
    <Dialog open onClose={onClose} size="wiz" label="Chương trình phát sóng">
      {head}
      <div className="wz-body" style={step === 1 ? { padding: '18px 24px' } : undefined}>{[step1, step2, step3, step4][step]}</div>
      <div className="wz-foot">
        <div style={{ flex: 1, minWidth: 0 }}>{err ? <span role="alert" style={{ color: 'var(--bad, #c0392b)', fontSize: 13 }}>{err}</span> : null}</div>
        {saved ? (
          <Btn tone="p" onClick={onClose}>Đóng</Btn>
        ) : (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {step > 0 ? <Btn onClick={() => go(step - 1)}>← Quay lại</Btn> : <Btn onClick={onClose}>Hủy</Btn>}
            {step < 3 ? <Btn tone="p" onClick={() => go(step + 1)}>Bước tiếp theo →</Btn> : (
              <>
                <Btn disabled={busy} onClick={() => void save(false)}>Lưu nháp</Btn>
                <Btn tone="p" disabled={busy} onClick={() => void save(true)}>Phát hành</Btn>
              </>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
