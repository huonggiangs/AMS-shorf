// Vận hành thiết bị TV (w-dev): ghép mã, gán chủ sở hữu, lệnh thiết bị (tạo/hủy/xem trạng thái).
// Lệnh đi qua heartbeat (polling), KHÔNG realtime: giao diện luôn nói rõ điều này.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { api, ApiError, errMsg } from '../api/client';
import { useUi } from '../state/ui';
import { Btn, ErrorBlock, Field, LoadingBlock, Note, Tag } from './ui';
import { OpsDialog } from './OpsDialog';
import { fmtDateTime } from '../lib/format';

/** Mã lỗi máy chủ -> câu tiếng Việt cho người vận hành (nếu không có mã thì dùng thông điệp máy chủ). */
export const PAIR_ERRORS: Record<string, string> = {
  pair_code_not_found: 'Mã không đúng. Kiểm tra lại 6 số đang hiện trên màn hình TV.',
  pair_code_expired: 'Mã đã hết hạn (5 phút). Hãy mở lại màn ghép trên TV để lấy mã mới.',
  pair_code_used: 'Mã này đã được dùng. Nếu TV vẫn chưa ghép, hãy lấy mã mới trên TV.',
  pair_locked: 'Nhập sai quá nhiều lần. Chờ vài phút rồi thử lại.',
  device_blocked: 'Thiết bị này đang bị chặn nên không ghép được. Bỏ chặn trước.',
  too_many_requests: 'Bạn nhập mã quá nhiều lần. Chờ vài phút rồi thử lại.',
  forbidden: 'Bạn không có quyền ghép thiết bị (cần quyền ghi trên Thiết bị).',
  validation_error: 'Mã ghép gồm đúng 6 chữ số.',
};
export const CMD_ERRORS: Record<string, string> = {
  device_not_approved: 'Thiết bị chưa được cấp quyền. Bấm "Cấp quyền" trước khi gửi lệnh.',
  command_not_for_kind: 'Lệnh này không áp dụng cho loại thiết bị này.',
  command_ttl_too_long: 'Thời gian hết hạn của lệnh quá dài.',
  device_not_paired: 'TV chưa ghép mã. Hãy ghép mã hiển thị trên TV trước khi gửi lệnh.',
  device_blocked: 'Thiết bị đang bị chặn, không gửi lệnh được.',
  command_type_unsupported: 'Loại lệnh này chưa được hỗ trợ.',
  command_args_invalid: 'Tham số lệnh chưa hợp lệ.',
  idempotency_conflict: 'Khóa chống trùng này đã dùng cho một lệnh khác.',
  too_many_requests: 'Gửi lệnh quá nhiều. Chờ vài phút rồi thử lại.',
  queue_full: 'TV đang có quá nhiều lệnh chờ. Hủy bớt lệnh cũ hoặc chờ TV xử lý.',
  command_not_cancellable: 'Lệnh đã hoàn tất, hết hạn hoặc đã hủy nên không hủy được nữa.',
  forbidden: 'Bạn không có quyền gửi lệnh tới thiết bị.',
};
export const mapErr = (e: unknown, table: Record<string, string>): string => (e instanceof ApiError && table[e.code] ? table[e.code]! : errMsg(e));

/* ------------------------------------------------------------------ ghép mã */
export function PairDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone?: (deviceId: string) => void }) {
  const { notify } = useUi();
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [owner, setOwner] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const valid = /^\d{6}$/.test(code);
  const close = () => { setCode(''); setOwner(''); setErr(''); onClose(); };
  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true); setErr('');
    try {
      const r = (await api.post('/admin/v1/devices/pair', { body: { code, ...(owner.trim() ? { owner_name: owner.trim() } : {}) } })) as { device_id: string };
      notify('Đã ghép TV (mức tin cậy 1). Xác minh tính hoa hồng là bước riêng.');
      await qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/admin/v1/devices') });
      onDone?.(r.device_id);
      close();
    } catch (e) {
      setErr(mapErr(e, PAIR_ERRORS));
      setCode('');
    } finally { setBusy(false); }
  };
  return (
    <OpsDialog open={open} onClose={close} label="Ghép mã TV" width="min(460px,96vw)">
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <h2 style={{ margin: '0 0 6px', fontSize: 18 }}>Ghép mã TV</h2>
        <p className="sub" style={{ margin: '0 0 10px' }}>Trên TV mở ứng dụng Brain-rot, bật &quot;Kết nối quảng cáo AMS&quot; rồi nhập 6 số đang hiện (còn hiệu lực 5 phút).</p>
        <Field label="Mã 6 số trên TV">
          <input inputMode="numeric" autoComplete="off" autoFocus maxLength={6} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} style={{ fontSize: 24, letterSpacing: 6, textAlign: 'center' }} />
        </Field>
        <Field label="Chủ sở hữu / khách hàng (tùy chọn)" hint="Ví dụ tên khách sạn, nhà trọ hoặc phòng. Có thể gán lại sau.">
          <input value={owner} maxLength={100} onChange={(e) => setOwner(e.target.value)} />
        </Field>
        {err ? <p role="alert" style={{ color: 'var(--bad)', margin: '8px 0 0' }}>{err}</p> : null}
        <Note>Ghép mã chỉ đưa TV lên mức tin cậy 1 (đã liên kết). Muốn tính hoa hồng phải bấm &quot;Xác minh&quot; riêng (mức 2, cần quyền duyệt thiết bị).</Note>
        <div className="da" style={{ marginTop: 14 }}>
          <button type="button" className="btn" onClick={close}>Hủy</button>
          <button type="submit" className="btn p" disabled={!valid || busy}>{busy ? 'Đang ghép…' : 'Ghép TV'}</button>
        </div>
      </form>
    </OpsDialog>
  );
}

/* ------------------------------------------------------------------ chủ sở hữu */
export function OwnerForm({ deviceId, current, paired }: { deviceId: string; current?: string | null; paired: boolean }) {
  const { notify } = useUi();
  const qc = useQueryClient();
  const [name, setName] = useState(current ?? '');
  const [busy, setBusy] = useState(false);
  if (!paired) return <p className="sub">TV chưa ghép mã nên chưa gán được chủ sở hữu.</p>;
  const save = async () => {
    setBusy(true);
    try {
      await api.put(`/admin/v1/devices/${deviceId}/owner`, { body: { owner_name: name.trim() } });
      notify('Đã gán chủ sở hữu.');
      await qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/admin/v1/devices') });
    } catch (e) { notify(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 180 }}><Field label="Chủ sở hữu / khách hàng"><input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} /></Field></div>
      <Btn disabled={busy || !name.trim() || name.trim() === (current ?? '')} onClick={() => void save()}>Gán</Btn>
    </div>
  );
}

/* ------------------------------------------------------------------ lệnh thiết bị */
const cmdSchema = z.object({
  id: z.string(), type: z.string(), label: z.string(), args: z.record(z.unknown()).nullable(), state: z.string(), expires_at: z.string(), created_at: z.string(),
  created_by: z.string().nullish(), result: z.string().nullish(), deliveries: z.number(),
  timeline: z.array(z.object({ at: z.string(), event: z.string(), note: z.string().nullish() })),
}).passthrough();
const listSchema = z.object({
  items: z.array(cmdSchema),
  delivery: z.object({ mode: z.string(), realtime: z.boolean(), note: z.string(), paired_cap_s: z.number().nullable().optional() }),
  types: z.array(z.object({ type: z.string(), label: z.string(), desc: z.string(), support: z.string(), risky: z.boolean(), default_ttl_s: z.number().optional() })),
});
export type CmdItem = z.infer<typeof cmdSchema>;

export const CMD_STATE: Record<string, { label: string; tone: 'ok' | 'warn' | 'bad' | 'info' }> = {
  pending: { label: 'Đang chờ TV nhận', tone: 'warn' },
  delivered: { label: 'Đã giao, chờ TV xác nhận', tone: 'info' },
  acked: { label: 'TV đã xác nhận', tone: 'ok' },
  failed: { label: 'TV báo thất bại', tone: 'bad' },
  expired: { label: 'Hết hạn', tone: 'bad' },
  cancelled: { label: 'Đã hủy', tone: 'bad' },
};
const EVENT: Record<string, string> = { created: 'Tạo lệnh', delivered: 'Giao cho TV (heartbeat)', acked: 'TV xác nhận (ACK)', failed: 'TV báo thất bại', expired: 'Hết hạn', cancelled: 'Hủy bởi quản trị' };
const TTL_OPTS: [number, string][] = [[300, '5 phút'], [3600, '1 giờ'], [6 * 3600, '6 giờ'], [86400, '24 giờ'], [7 * 86400, '7 ngày']];
const newKey = () => `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function DeviceCommands({ deviceId, paired, canWrite, signage = false }: { deviceId: string; paired: boolean; canWrite: boolean; signage?: boolean }) {
  const { notify } = useUi();
  const qc = useQueryClient();
  const key = ['/admin/v1/devices', 'commands', deviceId];
  const q = useQuery({ queryKey: key, queryFn: () => api.get(`/admin/v1/devices/${deviceId}/commands`, { schema: listSchema }), refetchInterval: 30_000 });
  const [type, setType] = useState('message');
  const [text, setText] = useState('');
  const [secs, setSecs] = useState('15');
  const [reason, setReason] = useState('');
  const [vol, setVol] = useState('50');
  const [orient, setOrient] = useState('portrait');
  const [ttl, setTtl] = useState(3600);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [idem, setIdem] = useState(newKey()); // khóa chống trùng: giữ nguyên khi bấm lại (lỗi mạng) và đổi khi nội dung lệnh đổi hoặc sau khi gửi xong
  if (q.isLoading) return <LoadingBlock />;
  if (q.isError || !q.data) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;
  const { items, delivery, types } = q.data;
  const def = types.find((t) => t.type === type);
  // Thang may/LED: message{text, duration_s?}; TV: message{text, seconds}
  const args = (): Record<string, unknown> => (type === 'message' ? (signage ? { text: text.trim(), ...(Number(secs) ? { duration_s: Number(secs) } : {}) } : { text: text.trim(), seconds: Number(secs) || 15 })
    : type === 'set_volume' ? { percent: Number(vol) } : type === 'set_orientation' ? { orientation: orient } : type === 'lock' && reason.trim() ? { reason: reason.trim() } : {});
  const send = async () => {
    if (def?.risky && !window.confirm(`Gửi lệnh "${def.label}" tới TV? Lệnh sẽ được thực thi khi TV nhận ở heartbeat kế tiếp.`)) return;
    setBusy(true);
    try {
      await api.post(`/admin/v1/devices/${deviceId}/commands`, { body: { type, args: args(), ...(def?.default_ttl_s && ttl === 3600 ? {} : { ttl_s: ttl }), idempotency_key: idem } });
      notify('Đã xếp lệnh. TV sẽ nhận ở lần heartbeat kế tiếp, chưa phải ngay lập tức.');
      setIdem(newKey()); setText('');
      await qc.invalidateQueries({ queryKey: key });
    } catch (e) { notify(mapErr(e, CMD_ERRORS)); } finally { setBusy(false); }
  };
  const cancel = async (c: CmdItem) => {
    try {
      const r = (await api.post(`/admin/v1/devices/${deviceId}/commands/${c.id}/cancel`, { body: {} })) as { cancel_note?: string | null };
      notify(r.cancel_note ?? 'Đã hủy lệnh.');
      await qc.invalidateQueries({ queryKey: key });
    } catch (e) { notify(mapErr(e, CMD_ERRORS)); }
  };
  return (
    <section aria-label="Lệnh thiết bị">
      <h3 style={{ margin: '18px 0 8px', fontSize: 15 }}>Lệnh gửi TV</h3>
      <Note warn>{delivery.note}</Note>
      {!paired ? <p className="sub">{signage ? 'Thiết bị chưa được cấp quyền nên chưa gửi lệnh được.' : 'TV chưa ghép mã nên chưa gửi lệnh được.'}</p> : canWrite ? (
        <div style={{ margin: '10px 0' }}>
          <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))' }}>
            <Field label="Loại lệnh">
              <select value={type} onChange={(e) => { setType(e.target.value); setIdem(newKey()); }}>
                {types.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="Hết hạn sau"><select value={ttl} onChange={(e) => { setTtl(Number(e.target.value)); setIdem(newKey()); }}>{TTL_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          </div>
          {def ? <p className="sub" style={{ margin: '4px 0' }}>{def.desc}{def.support === 'brainrot' ? ' (Tên lệnh theo Brain-rot; cần ứng dụng TV nhận lệnh từ heartbeat.)' : ''}</p> : null}
          {type === 'message' ? (
            <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 110px' }}>
              <Field label="Nội dung (tối đa 200 ký tự)"><input value={text} maxLength={200} onChange={(e) => { setText(e.target.value); setIdem(newKey()); }} /></Field>
              <Field label="Hiện (giây)"><input type="number" min={signage ? 3 : 5} max={120} value={secs} onChange={(e) => { setSecs(e.target.value); setIdem(newKey()); }} /></Field>
            </div>
          ) : null}
          {type === 'set_volume' ? <Field label="Âm lượng (0–100)"><input type="number" min={0} max={100} value={vol} onChange={(e) => { setVol(e.target.value); setIdem(newKey()); }} /></Field> : null}
          {type === 'set_orientation' ? <Field label="Hướng màn hình"><select value={orient} onChange={(e) => { setOrient(e.target.value); setIdem(newKey()); }}><option value="portrait">Dọc (portrait)</option><option value="landscape">Ngang (landscape)</option></select></Field> : null}
          {type === 'lock' ? <Field label="Lý do (tùy chọn)"><input value={reason} maxLength={120} onChange={(e) => { setReason(e.target.value); setIdem(newKey()); }} /></Field> : null}
          <Btn tone="p" disabled={busy || (type === 'message' && !text.trim()) || type === 'display-settings'} onClick={() => void send()}>{busy ? 'Đang gửi…' : 'Gửi lệnh'}</Btn>
          {type === 'display-settings' ? <span className="sub" style={{ marginLeft: 8 }}>Cài đặt giao diện: dùng API (tham số do ứng dụng TV định nghĩa).</span> : null}
        </div>
      ) : null}
      {items.length === 0 ? <p className="sub">Chưa có lệnh nào.</p> : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {items.map((c) => {
            const st = CMD_STATE[c.state] ?? { label: c.state, tone: 'info' as const };
            return (
              <li key={c.id} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 10, marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <b>{c.label}</b>
                  <Tag tone={st.tone}>{st.label}</Tag>
                </div>
                <div className="sub" style={{ fontSize: 12.5 }}>
                  {fmtDateTime(c.created_at)}{c.created_by ? ` · ${c.created_by}` : ''} · hết hạn {fmtDateTime(c.expires_at)}
                  {c.type === 'message' && c.args ? ` · “${String(c.args['text'] ?? '')}”` : ''}
                  {c.result ? ` · Kết quả: ${c.result}` : ''}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  <button type="button" className="btn sm" aria-expanded={open === c.id} onClick={() => setOpen(open === c.id ? null : c.id)}>Dòng thời gian</button>
                  {canWrite && (c.state === 'pending' || c.state === 'delivered') ? <button type="button" className="btn sm" onClick={() => void cancel(c)}>Hủy lệnh</button> : null}
                </div>
                {open === c.id ? (
                  <ol style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13 }}>
                    {c.timeline.map((t, i) => <li key={i}>{fmtDateTime(t.at)} · {EVENT[t.event] ?? t.event}{t.note ? ` (${t.note})` : ''}</li>)}
                  </ol>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
