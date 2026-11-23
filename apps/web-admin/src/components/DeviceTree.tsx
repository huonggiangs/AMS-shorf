// Thành phần dùng chung của trang Nhóm thiết bị / Địa điểm / ngăn chi tiết thiết bị (d-tree):
// chọn nhóm, chọn địa điểm, hộp thoại đặt nhóm + địa điểm + MAC/serial, thanh trượt âm lượng từ xa.
// Âm lượng đi qua lệnh `set_volume` (heartbeat polling, KHÔNG realtime): giao diện luôn hiện trạng thái chờ / đã xác nhận.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, errMsg } from '../api/client';
import { listOf } from '../api/schemas';
import { flattenTree, groupTreeSchema, locationSchema, TREE_ERRORS, treeDeviceSchema, nextBeatText, volumeCapBadge, volumeStatus, type GroupNode, type TreeDevice } from '../api/deviceTree';
import { useAct } from '../api/hooks';
import { CMD_ERRORS } from './DeviceOps';
import { OpsDialog } from './OpsDialog';
import { Btn, Field, Note } from './ui';

export const treeErr = (e: unknown): string => (e instanceof ApiError && (TREE_ERRORS[e.code] ?? CMD_ERRORS[e.code]) ? (TREE_ERRORS[e.code] ?? CMD_ERRORS[e.code])! : errMsg(e));

export const useGroupTree = () => useQuery({ queryKey: ['/admin/v1/device-groups', 'tree'], queryFn: () => api.get('/admin/v1/device-groups', { schema: groupTreeSchema }) });
export const useLocationOptions = () =>
  useQuery({ queryKey: ['/admin/v1/locations', 'options'], queryFn: () => api.get('/admin/v1/locations', { query: { page_size: 200, sort: 'name:asc' }, schema: listOf(locationSchema) }) });

export function GroupSelect({ items, value, onChange, exclude, none = '— Chưa xếp nhóm —', id }: { items: GroupNode[]; value: string; onChange: (v: string) => void; exclude?: Set<string>; none?: string; id?: string }) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{none}</option>
      {flattenTree(items, exclude).map((g) => <option key={g.id} value={g.id}>{`${'— '.repeat(g.depth)}${g.label}`}</option>)}
    </select>
  );
}

/* ------------------------------------------------------------------ đặt nhóm / địa điểm / MAC / serial cho một thiết bị */
export function PlacementDialog({ device, onClose }: { device: Pick<TreeDevice, 'id' | 'name' | 'group_id' | 'location_id' | 'mac' | 'serial'> | null; onClose: () => void }) {
  const act = useAct();
  const tree = useGroupTree();
  const locs = useLocationOptions();
  const [f, setF] = useState({ name: '', group: '', loc: '', mac: '', serial: '' });
  const [err, setErr] = useState('');
  useEffect(() => { if (device) { setF({ name: device.name, group: device.group_id ?? '', loc: device.location_id ?? '', mac: device.mac ?? '', serial: device.serial ?? '' }); setErr(''); } }, [device]);
  const submit = async () => {
    if (!device) return;
    setErr('');
    try {
      await api.patch(`/admin/v1/device-groups/devices/${device.id}`, { body: { name: f.name.trim() || undefined, group_id: f.group || null, location_id: f.loc || null, mac: f.mac.trim() || null, serial: f.serial.trim() || null } });
      await act(async () => undefined, 'Đã lưu nhóm, địa điểm và thông tin thiết bị.');
      onClose();
    } catch (e) { setErr(treeErr(e)); }
  };
  return (
    <OpsDialog open={!!device} onClose={onClose} label="Nhóm và địa điểm thiết bị" width="min(520px,96vw)">
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <h2 style={{ margin: '0 0 6px', fontSize: 18 }}>Nhóm và địa điểm thiết bị</h2>
        <p className="sub" style={{ margin: '0 0 10px' }}>{device?.id}</p>
        <Field label="Tên vị trí màn hình"><input value={f.name} maxLength={100} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Cụm quản lý (nhóm)"><GroupSelect items={tree.data?.items ?? []} value={f.group} onChange={(v) => setF({ ...f, group: v })} /></Field>
        <Field label="Địa điểm đặt thiết bị">
          <select value={f.loc} onChange={(e) => setF({ ...f, loc: e.target.value })}>
            <option value="">— Chưa gán địa điểm —</option>
            {(locs.data?.items ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}{l.province ? ` · ${l.province}` : ''}</option>)}
          </select>
        </Field>
        <Field label="Địa chỉ MAC" hint="Dạng AA:BB:CC:DD:EE:FF. Do vận hành nhập tay, thiết bị không tự khai."><input value={f.mac} maxLength={17} placeholder="AA:BB:CC:DD:EE:FF" onChange={(e) => setF({ ...f, mac: e.target.value })} /></Field>
        <Field label="Số serial (SN)"><input value={f.serial} maxLength={64} onChange={(e) => setF({ ...f, serial: e.target.value })} /></Field>
        {err ? <p role="alert" style={{ color: 'var(--bad)', margin: '8px 0 0' }}>{err}</p> : null}
        <div className="da" style={{ marginTop: 14 }}>
          <button type="button" className="btn" onClick={onClose}>Hủy</button>
          <button type="submit" className="btn p">Lưu</button>
        </div>
      </form>
    </OpsDialog>
  );
}

/** Chuyển hàng loạt thiết bị sang một nhóm hoặc một địa điểm. */
export function BulkAssignDialog({ kind, ids, onClose, onDone }: { kind: 'group' | 'location' | null; ids: string[]; onClose: () => void; onDone: () => void }) {
  const act = useAct();
  const tree = useGroupTree();
  const locs = useLocationOptions();
  const [v, setV] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { setV(''); setErr(''); }, [kind]);
  const submit = async () => {
    setErr('');
    try {
      await api.put(kind === 'group' ? '/admin/v1/device-groups/assign' : '/admin/v1/locations/assign', { body: kind === 'group' ? { device_ids: ids, group_id: v || null } : { device_ids: ids, location_id: v || null } });
      await act(async () => undefined, `Đã cập nhật ${ids.length} thiết bị.`);
      onDone();
      onClose();
    } catch (e) { setErr(treeErr(e)); }
  };
  return (
    <OpsDialog open={!!kind} onClose={onClose} label={kind === 'group' ? 'Chuyển nhóm' : 'Gán địa điểm'} width="min(460px,96vw)">
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <h2 style={{ margin: '0 0 6px', fontSize: 18 }}>{kind === 'group' ? 'Chuyển nhóm' : 'Gán địa điểm'}</h2>
        <p className="sub" style={{ margin: '0 0 10px' }}>Áp dụng cho {ids.length} thiết bị đã chọn.</p>
        {kind === 'group' ? (
          <Field label="Nhóm đích"><GroupSelect items={tree.data?.items ?? []} value={v} onChange={setV} /></Field>
        ) : (
          <Field label="Địa điểm">
            <select value={v} onChange={(e) => setV(e.target.value)}>
              <option value="">— Bỏ gắn địa điểm —</option>
              {(locs.data?.items ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}{l.province ? ` · ${l.province}` : ''}</option>)}
            </select>
          </Field>
        )}
        {err ? <p role="alert" style={{ color: 'var(--bad)', margin: '8px 0 0' }}>{err}</p> : null}
        <div className="da" style={{ marginTop: 14 }}>
          <button type="button" className="btn" onClick={onClose}>Hủy</button>
          <button type="submit" className="btn p">Áp dụng</button>
        </div>
      </form>
    </OpsDialog>
  );
}

/* ------------------------------------------------------------------ thanh trượt âm lượng */
export const VOLUME_DEBOUNCE_MS = 500;
/**
 * Kéo thanh trượt -> chờ ngừng kéo (debounce) -> gửi MỘT lệnh set_volume. Giá trị hiển thị lạc quan (số bạn vừa chọn) cho tới khi thiết bị
 * báo âm lượng thật qua heartbeat. Trạng thái lệnh (đang chờ / đã xác nhận / lỗi) lấy từ máy chủ, không tự suy ra.
 */
export function VolumeSlider({ d, canWrite, onSent }: { d: TreeDevice; canWrite: boolean; onSent?: () => void }) {
  const act = useAct();
  const [draft, setDraft] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cmd = d.volume_cmd;
  const open = cmd && (cmd.state === 'pending' || cmd.state === 'delivered');
  // máy chủ đã có lệnh mới hơn bản nháp -> bỏ bản nháp để hiện số thật
  useEffect(() => { if (cmd) setDraft(null); }, [cmd?.id, cmd?.state]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const shown = draft ?? (open && cmd?.percent != null ? cmd.percent : d.volume ?? cmd?.percent ?? 0);
  const disabled = !canWrite || !d.controllable || d.can_set_volume === false;
  const badge = volumeCapBadge(d);
  const nowMs = Date.now();
  const send = (percent: number) => {
    setSending(true);
    void act(() => api.post(`/admin/v1/devices/${d.id}/commands`, { body: { type: 'set_volume', args: { percent } } }), `Đã xếp lệnh âm lượng ${percent}%. ${nextBeatText(d, Date.now())}.`)
      .then((r) => { if (r) onSent?.(); })
      .finally(() => { setSending(false); });
  };
  const change = (v: number) => {
    setDraft(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => send(v), VOLUME_DEBOUNCE_MS);
  };
  const st = draft !== null ? { text: 'Sẽ gửi khi bạn dừng kéo…', tone: 'info' as const } : sending ? { text: 'Đang gửi lệnh…', tone: 'warn' as const } : cmd ? volumeStatus(cmd, nowMs) : null;
  return (
    <div style={{ minWidth: 170, maxWidth: 200 }} title={disabled ? (!d.controllable ? 'Thiết bị chưa ghép mã / chưa cấp quyền hoặc đang bị chặn nên chưa gửi lệnh được.' : d.can_set_volume === false ? badge.title : 'Bạn không có quyền gửi lệnh tới thiết bị.') : undefined}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="range" min={0} max={100} step={1} value={shown} disabled={disabled} aria-label={`Âm lượng ${d.name}`} onChange={(e) => change(Number(e.target.value))} style={{ flex: 1 }} />
        <b className="mono" style={{ width: 42, textAlign: 'right' }}>{shown}%</b>
      </div>
      <div style={{ fontSize: 12, color: 'var(--mut)', marginTop: 2, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {st ? <span style={{ color: st.tone === 'ok' ? 'var(--ok)' : st.tone === 'bad' ? 'var(--bad)' : st.tone === 'warn' ? 'var(--warn)' : undefined, fontWeight: 600 }}>{st.text}</span> : null}
        {st && 'retry' in st && st.retry && cmd?.percent != null && !disabled ? <button type="button" className="btn" style={{ padding: '0 8px', fontSize: 12 }} disabled={sending} onClick={() => send(cmd.percent as number)}>Thử lại</button> : null}
        <span>{cmd?.state === 'acked' && cmd.applied_percent != null ? `Đang áp dụng: ${cmd.applied_percent}% (${cmd.mode === 'player' ? 'qua trình phát' : 'hệ thống'})` : d.volume != null ? `Thiết bị báo: ${d.volume}%` : 'Chưa nhận báo cáo âm lượng'}</span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--mut)', marginTop: 2 }}>
        <span data-testid="vol-cap" title={badge.title} style={{ fontWeight: 600, color: badge.tone === 'ok' ? 'var(--ok)' : badge.tone === 'bad' ? 'var(--bad)' : undefined }}>{badge.text}</span>
        {' · '}<span data-testid="vol-eta">{nextBeatText(d, nowMs)}</span>
      </div>
    </div>
  );
}

/** Hộp thoại đặt âm lượng chung (cả nhóm hoặc các thiết bị đã chọn). `run` trả về dòng kết quả để hiện cho người vận hành. */
export function BulkVolumeDialog({ open, title, count, onClose, run, extra }: { open: boolean; title: string; count: number; onClose: () => void; run: (percent: number) => Promise<string>; extra?: ReactNode }) {
  const [p, setP] = useState(50);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setMsg(''); setErr(''); } }, [open]);
  const go = async () => {
    setBusy(true); setErr(''); setMsg('');
    try { setMsg(await run(p)); } catch (e) { setErr(treeErr(e)); } finally { setBusy(false); }
  };
  return (
    <OpsDialog open={open} onClose={onClose} label={title} width="min(480px,96vw)">
      <form onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <h2 style={{ margin: '0 0 6px', fontSize: 18 }}>{title}</h2>
        <p className="sub" style={{ margin: '0 0 10px' }}>Áp dụng cho {count} thiết bị. Mỗi thiết bị nhận một lệnh riêng ở lần heartbeat kế tiếp (không tức thời).</p>
        <Field label="Âm lượng">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input type="range" min={0} max={100} value={p} aria-label="Âm lượng hàng loạt" onChange={(e) => setP(Number(e.target.value))} style={{ flex: 1 }} />
            <b className="mono" style={{ width: 44, textAlign: 'right' }}>{p}%</b>
          </div>
        </Field>
        {extra}
        {msg ? <Note>{msg}</Note> : null}
        {err ? <p role="alert" style={{ color: 'var(--bad)', margin: '8px 0 0' }}>{err}</p> : null}
        <div className="da" style={{ marginTop: 14 }}>
          <button type="button" className="btn" onClick={onClose}>Đóng</button>
          <button type="submit" className="btn p" disabled={busy || count === 0}>{busy ? 'Đang gửi…' : 'Đặt âm lượng'}</button>
        </div>
      </form>
    </OpsDialog>
  );
}

/** Nút nhỏ hiển thị nhóm/địa điểm của thiết bị trong ngăn chi tiết Danh sách thiết bị. */
export function DevicePlacement({ deviceId, canWrite }: { deviceId: string; canWrite: boolean }) {
  const q = useQuery({
    queryKey: ['/admin/v1/device-groups', 'dev', deviceId],
    queryFn: async () => (await api.get('/admin/v1/device-groups/devices', { query: { q: deviceId, page_size: 5 }, schema: listOf(treeDeviceSchema) })).items?.find((x) => x.id === deviceId) ?? null,
  });
  const [open, setOpen] = useState(false);
  const d = q.data;
  return (
    <>
      <dl className="kv">
        <dt>Nhóm</dt><dd>{d?.group_name ?? '—'}</dd><dt>Địa điểm</dt><dd>{d?.location_name ?? '—'}</dd>
        <dt>MAC / Serial</dt><dd className="mono">{[d?.mac, d?.serial].filter(Boolean).join(' · ') || '—'}</dd>
      </dl>
      {canWrite && d ? <div className="acts" style={{ marginTop: 8 }}><Btn onClick={() => setOpen(true)}>Đặt nhóm và địa điểm</Btn></div> : null}
      <PlacementDialog device={open && d ? d : null} onClose={() => setOpen(false)} />
    </>
  );
}
