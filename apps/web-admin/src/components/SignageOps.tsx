// Signage Player (man hinh thang may / LED 9:16): cap quyen, nhat ky thiet bi, cau hinh chu/hotline/cap nhat app, chu theo lich phat.
// Moi kiem tra quyen THAT nam o may chu; nut o day chi an/hien theo quyen hien co.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { api, errMsg } from '../api/client';
import { listOf, screenSchema } from '../api/schemas';
import { useUi } from '../state/ui';
import { Btn, ErrorBlock, Field, LoadingBlock, Note, Tag } from './ui';
import { Dialog } from './Dialog';
import { mapErr } from './DeviceOps';
import { fmtDateTime } from '../lib/format';

export const SIGNAGE_KINDS = ['elevator', 'led_p5'];
export const isSignage = (k?: string | null): boolean => !!k && SIGNAGE_KINDS.includes(k);
export const kindLabel = (k?: string | null): string => (k === 'elevator' ? 'Thang máy' : k === 'led_p5' ? 'LED P5' : (k ?? ''));

export const APPROVE_ERRORS: Record<string, string> = {
  use_pairing_code: 'Thiết bị này ghép bằng mã 6 số, không cấp quyền kiểu thang máy.',
  device_blocked: 'Thiết bị đang bị chặn. Bỏ chặn trước khi cấp quyền.',
  screen_kind_mismatch: 'Màn hình chọn không cùng loại với thiết bị (thang máy / LED).',
  screen_venue_mismatch: 'Màn hình không thuộc địa điểm đã chọn.',
  screen_taken: 'Màn hình này đã gán cho thiết bị khác.',
  no_free_screen: 'Địa điểm này không còn màn hình trống đúng loại. Thêm màn hình ở trang Màn hình thang máy & LED.',
  forbidden: 'Bạn không có quyền cấp quyền thiết bị (cần quyền duyệt trên Thiết bị).',
};

const invalidateDevices = (qc: ReturnType<typeof useQueryClient>) => qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/admin/v1/devices') });

/* ------------------------------------------------------------------ cap quyen */
export function ApproveDevice({ deviceId, kind, grantState, screenLabel, canApprove }: { deviceId: string; kind: string; grantState?: string | null; screenLabel?: string | null; canApprove: boolean }) {
  const { notify } = useUi();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [venue, setVenue] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const venues = useQuery({
    queryKey: ['/admin/v1/screens', 'approve-pick', kind], enabled: open,
    queryFn: () => api.get('/admin/v1/screens', { query: { page_size: 100, filter: `type:${kind === 'led_p5' ? 'led' : 'elevator'}` }, schema: listOf(screenSchema) }),
  });
  const granted = grantState === 'granted';
  const done = async (msg: string) => { notify(msg); await invalidateDevices(qc); setOpen(false); setErr(''); };
  const approve = async () => {
    setBusy(true); setErr('');
    try {
      await api.post(`/admin/v1/devices/${deviceId}/approve`, { body: { ...(venue ? { venue_id: venue } : {}), ...(name.trim() ? { name: name.trim() } : {}) } });
      await done('Đã cấp quyền. Màn hình sẽ nhận lịch phát ở lần heartbeat kế tiếp.');
    } catch (e) { setErr(mapErr(e, APPROVE_ERRORS)); } finally { setBusy(false); }
  };
  const revoke = async () => {
    if (!window.confirm('Thu hồi quyền? Màn hình sẽ ngừng nhận quảng cáo và được gỡ khỏi vị trí đã gán.')) return;
    setBusy(true);
    try { await api.post(`/admin/v1/devices/${deviceId}/revoke-approval`, { body: {} }); await done('Đã thu hồi quyền.'); } catch (e) { notify(mapErr(e, APPROVE_ERRORS)); } finally { setBusy(false); }
  };
  return (
    <section aria-label="Cấp quyền màn hình">
      <h3 style={{ margin: '18px 0 8px', fontSize: 15 }}>Cấp quyền {kindLabel(kind).toLowerCase()}</h3>
      <p className="sub" style={{ margin: '0 0 8px' }}>
        {granted ? <>Đã được cấp quyền{screenLabel ? <> · vị trí: <b>{screenLabel}</b></> : ' (chưa gán vị trí)'}.</> : grantState === 'blocked' ? 'Thiết bị đang bị chặn.' : 'Thiết bị đã tự đăng ký và đang chờ vận hành cấp quyền. Không cần mã 6 số.'}
      </p>
      {canApprove ? (
        <div className="acts">
          {granted ? <Btn tone="d" disabled={busy} onClick={() => void revoke()}>Thu hồi quyền</Btn> : null}
          {grantState !== 'blocked' ? <Btn tone="p" disabled={busy} onClick={() => setOpen(true)}>{granted ? 'Đổi vị trí' : 'Cấp quyền'}</Btn> : null}
        </div>
      ) : <p className="sub">Bạn không có quyền cấp quyền thiết bị.</p>}
      <Dialog open={open} onClose={() => setOpen(false)} label="Cấp quyền thiết bị">
        <form onSubmit={(e) => { e.preventDefault(); void approve(); }}>
          <h2 style={{ margin: '0 0 6px', fontSize: 18 }}>Cấp quyền {kindLabel(kind).toLowerCase()}</h2>
          <p className="sub" style={{ margin: '0 0 10px' }}>Chọn địa điểm (chung cư / bãi xe) để gán màn hình đang trống. Có thể bỏ trống và gán sau.</p>
          <Field label="Địa điểm lắp đặt">
            <select value={venue} onChange={(e) => setVenue(e.target.value)}>
              <option value="">— Chưa gán —</option>
              {venues.data?.items.map((v) => <option key={v.id} value={v.id}>{v.name}{v.region ? ` · ${v.region}` : ''}</option>)}
            </select>
          </Field>
          <Field label="Tên hiển thị (tùy chọn)"><input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} /></Field>
          {err ? <p role="alert" style={{ color: 'var(--bad)', margin: '8px 0 0' }}>{err}</p> : null}
          <Note>Cấp quyền đưa thiết bị lên mức tin cậy 1: nhận lịch phát và được ghi nhận lượt phát hợp lệ.</Note>
          <div className="da" style={{ marginTop: 14 }}>
            <button type="button" className="btn" onClick={() => setOpen(false)}>Hủy</button>
            <button type="submit" className="btn p" disabled={busy}>{busy ? 'Đang cấp…' : 'Cấp quyền'}</button>
          </div>
        </form>
      </Dialog>
    </section>
  );
}

/* ------------------------------------------------------------------ nhat ky */
const logsSchema = z.object({
  items: z.array(z.object({ id: z.coerce.string(), ts: z.string(), level: z.string(), tag: z.string().nullish(), message: z.string() })),
  total: z.number(), page: z.number().optional(), page_size: z.number().optional(), retention_days: z.number().optional(),
}).passthrough();
const LEVEL_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'info'> = { error: 'bad', warn: 'warn', info: 'info', debug: 'ok' };

export function DeviceLogs({ deviceId }: { deviceId: string }) {
  const [page, setPage] = useState(1);
  const [level, setLevel] = useState('');
  const size = 20;
  const q = useQuery({
    queryKey: ['/admin/v1/devices', 'logs', deviceId, page, level],
    queryFn: () => api.get(`/admin/v1/devices/${deviceId}/logs`, { query: { page, page_size: size, ...(level ? { filter: `level:${level}` } : {}) }, schema: logsSchema }),
  });
  const pages = q.data ? Math.max(1, Math.ceil(q.data.total / size)) : 1;
  return (
    <section aria-label="Nhật ký thiết bị">
      <h3 style={{ margin: '18px 0 8px', fontSize: 15 }}>Nhật ký thiết bị ({q.data?.retention_days ?? 7} ngày gần nhất)</h3>
      <div style={{ maxWidth: 220 }}>
        <Field label="Mức">
          <select value={level} onChange={(e) => { setLevel(e.target.value); setPage(1); }}>
            <option value="">Tất cả</option><option value="error">Lỗi</option><option value="warn">Cảnh báo</option><option value="info">Thông tin</option><option value="debug">Gỡ lỗi</option>
          </select>
        </Field>
      </div>
      {q.isLoading ? <LoadingBlock /> : q.isError ? <ErrorBlock error={q.error} onRetry={() => void q.refetch()} /> : !q.data?.items.length ? <p className="sub">Chưa có nhật ký nào.</p> : (
        <>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {q.data.items.map((l) => (
              <li key={l.id} style={{ borderBottom: '1px solid var(--line)', padding: '6px 0', fontSize: 12.5 }}>
                <Tag tone={LEVEL_TONE[l.level] ?? 'info'}>{l.level}</Tag> <span className="mono">{fmtDateTime(l.ts)}</span>{l.tag ? <span className="mono"> · {l.tag}</span> : null}
                <div style={{ wordBreak: 'break-word' }}>{l.message}</div>
              </li>
            ))}
          </ul>
          <div className="acts" style={{ marginTop: 8, alignItems: 'center' }}>
            <button type="button" className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Trước</button>
            <span className="sub">Trang {page}/{pages} · {q.data.total} dòng</span>
            <button type="button" className="btn sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Sau</button>
          </div>
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ cau hinh theo loai man */
const cfgSchema = z.object({ kinds: z.record(z.string(), z.object({
  header: z.string(), footer: z.string(), hotline: z.string(), fit: z.string(), image_duration_s: z.number(),
  min_app_version: z.string(), app_update_url: z.string(), app_update_sha256: z.string(),
}).passthrough()) }).passthrough();
type KindCfg = z.infer<typeof cfgSchema>['kinds'][string];
export const SG_ERRORS: Record<string, string> = {
  validation_error: 'Cấu hình chưa hợp lệ.',
  forbidden: 'Bạn không có quyền với thao tác này (đổi thông tin cập nhật app cần quyền duyệt thiết bị).',
};

export function SignageConfigCard({ canWrite }: { canWrite: boolean }) {
  const q = useQuery({ queryKey: ['/admin/v1/screens', 'signage-config'], queryFn: () => api.get('/admin/v1/screens/signage-config', { schema: cfgSchema }) });
  const [kind, setKind] = useState<'elevator' | 'led_p5'>('elevator');
  if (q.isLoading) return <LoadingBlock />;
  if (q.isError || !q.data) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;
  const cfg = q.data.kinds[kind];
  return (
    <div className="card cp" style={{ margin: '18px 0' }}>
      <div className="ch"><div><h2>Chữ, hotline và cập nhật app (Signage Player)</h2><p>Áp dụng cho mọi màn hình cùng loại. Màn hình nhận lại sau tối đa vài chục giây.</p></div></div>
      <div className="acts" role="tablist" aria-label="Loại màn hình">
        {(['elevator', 'led_p5'] as const).map((k) => <button key={k} type="button" role="tab" aria-selected={kind === k} className={`btn sm ${kind === k ? 'p' : ''}`} onClick={() => setKind(k)}>{kindLabel(k)}</button>)}
      </div>
      {cfg ? <SignageKindForm key={`${kind}-${JSON.stringify(cfg)}`} kind={kind} cfg={cfg} canWrite={canWrite} /> : null}
    </div>
  );
}

function SignageKindForm({ kind, cfg, canWrite }: { kind: string; cfg: KindCfg; canWrite: boolean }) {
  const { notify } = useUi();
  const qc = useQueryClient();
  const [f, setF] = useState({ header: cfg.header, footer: cfg.footer, hotline: cfg.hotline, fit: cfg.fit, image_duration_s: String(cfg.image_duration_s), min_app_version: cfg.min_app_version, app_update_url: cfg.app_update_url, app_update_sha256: cfg.app_update_sha256 });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const save = async () => {
    setBusy(true);
    try {
      await api.put(`/admin/v1/screens/signage-config/${kind}`, { body: { ...f, image_duration_s: Number(f.image_duration_s) } });
      notify('Đã lưu cấu hình.');
      await qc.invalidateQueries({ queryKey: ['/admin/v1/screens', 'signage-config'] });
    } catch (e) { notify(mapErr(e, SG_ERRORS)); } finally { setBusy(false); }
  };
  const ro = !canWrite;
  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} style={{ marginTop: 10 }}>
      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))' }}>
        <Field label="Chữ đầu màn hình (header)"><input readOnly={ro} maxLength={120} value={f.header} onChange={(e) => set('header', e.target.value)} /></Field>
        <Field label="Chữ cuối màn hình (footer)"><input readOnly={ro} maxLength={200} value={f.footer} onChange={(e) => set('footer', e.target.value)} /></Field>
        <Field label="Hotline / Zalo"><input readOnly={ro} maxLength={60} value={f.hotline} onChange={(e) => set('hotline', e.target.value)} /></Field>
        <Field label="Cách hiện hình"><select disabled={ro} value={f.fit} onChange={(e) => set('fit', e.target.value)}><option value="cover">Phủ kín khung (cover)</option><option value="fit">Vừa khung (fit)</option></select></Field>
        <Field label="Thời lượng ảnh mặc định (giây)"><input readOnly={ro} type="number" min={3} max={120} value={f.image_duration_s} onChange={(e) => set('image_duration_s', e.target.value)} /></Field>
      </div>
      <h3 style={{ margin: '14px 0 6px', fontSize: 14 }}>Cập nhật app từ xa</h3>
      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))' }}>
        <Field label="Phiên bản app tối thiểu"><input readOnly={ro} maxLength={32} value={f.min_app_version} onChange={(e) => set('min_app_version', e.target.value)} /></Field>
        <Field label="Địa chỉ tải bản cập nhật (HTTPS)"><input readOnly={ro} maxLength={300} value={f.app_update_url} onChange={(e) => set('app_update_url', e.target.value)} /></Field>
        <Field label="SHA-256 của tệp (64 ký tự hex)"><input readOnly={ro} className="mono" maxLength={64} value={f.app_update_sha256} onChange={(e) => set('app_update_sha256', e.target.value.toLowerCase())} /></Field>
      </div>
      <Note>Đổi thông tin cập nhật app cần quyền duyệt thiết bị. Chỉ nhập địa chỉ tải bạn tin cậy; app kiểm SHA-256 trước khi cài.</Note>
      {canWrite ? <div className="acts" style={{ marginTop: 10 }}><Btn tone="p" disabled={busy} onClick={() => void save()}>{busy ? 'Đang lưu…' : 'Lưu cấu hình'}</Btn></div> : null}
    </form>
  );
}

/* ------------------------------------------------------------------ chu theo lich phat */
export function SlotTextDialog({ slot, onClose }: { slot: { id: string; name: string; header?: string | null; footer?: string | null } | null; onClose: () => void }) {
  const { notify } = useUi();
  const qc = useQueryClient();
  const [header, setHeader] = useState(slot?.header ?? '');
  const [footer, setFooter] = useState(slot?.footer ?? '');
  const [busy, setBusy] = useState(false);
  if (!slot) return null;
  const save = async (clear: boolean) => {
    setBusy(true);
    try {
      await api.put(`/admin/v1/schedule/${slot.id}/text`, { body: clear ? { header: null, footer: null } : { header: header.trim() === '' && slot.header == null ? null : header, footer: footer.trim() === '' && slot.footer == null ? null : footer } });
      notify(clear ? 'Đã bỏ chữ riêng, dùng cấu hình chung.' : 'Đã lưu chữ riêng cho lịch phát.');
      await qc.invalidateQueries({ queryKey: ['/admin/v1/schedule'] });
      onClose();
    } catch (e) { notify(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open onClose={onClose} label="Chữ riêng cho lịch phát">
      <form onSubmit={(e) => { e.preventDefault(); void save(false); }}>
        <h2 style={{ margin: '0 0 6px', fontSize: 18 }}>Chữ riêng: {slot.name}</h2>
        <p className="sub" style={{ margin: '0 0 10px' }}>Ghi đè chữ đầu/cuối cho lịch phát này. Xóa hết chữ của một ô đã có chữ riêng = ẩn chữ đó ở lịch này; bấm &quot;Dùng cấu hình chung&quot; để bỏ ghi đè.</p>
        <Field label="Chữ đầu (header)"><input maxLength={120} value={header} onChange={(e) => setHeader(e.target.value)} /></Field>
        <Field label="Chữ cuối (footer)"><input maxLength={200} value={footer} onChange={(e) => setFooter(e.target.value)} /></Field>
        <div className="da" style={{ marginTop: 14 }}>
          <button type="button" className="btn" disabled={busy} onClick={() => void save(true)}>Dùng cấu hình chung</button>
          <button type="button" className="btn" onClick={onClose}>Hủy</button>
          <button type="submit" className="btn p" disabled={busy}>Lưu</button>
        </div>
      </form>
    </Dialog>
  );
}
