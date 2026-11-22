// "Dán link video": TV phát trực tiếp từ link, hệ thống không tải/chuyển mã/lưu video và không giảm chất lượng.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, errMsg } from '../api/client';
import { customerSchema, listOf } from '../api/schemas';
import { useAct, useBase } from '../api/hooks';
import { Field } from './ui';
import { Dialog } from './Dialog';
import { OverlayForm, emptyOverlay, overlayError, overlayPayload } from './OverlayForm';
import { checkStreamUrl } from '../lib/creative';

export function StreamLinkDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const base = useBase();
  const act = useAct();
  const [url, setUrl] = useState('');
  const [dur, setDur] = useState('');
  const [target, setTarget] = useState<'tv' | 'elevator' | 'led'>('tv');
  const [dimW, setDimW] = useState('');
  const [dimH, setDimH] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [ov, setOv] = useState(emptyOverlay());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const custs = useQuery({ queryKey: ['/admin/v1/customers', 'pick'], enabled: open && !base.isExternal, queryFn: () => api.get('/admin/v1/customers', { query: { page_size: 200 }, schema: listOf(customerSchema) }) });
  const check = url ? checkStreamUrl(url) : null;

  const submit = async () => {
    setErr('');
    const c = checkStreamUrl(url);
    if (!c.ok) return setErr(c.message);
    const d = Number(dur);
    if (!Number.isInteger(d) || d < 1) return setErr('Nhập thời lượng video (số giây nguyên).');
    if (target !== 'tv' && (!Number(dimW) || !Number(dimH))) return setErr('Màn thang máy/LED cần khai báo đúng độ phân giải video.');
    const oe = overlayError(ov);
    if (oe) return setErr(oe);
    setBusy(true);
    try {
      await api.post(`${base.media}/link`, { body: { url: url.trim(), duration_sec: d, target_type: target, ...(target !== 'tv' ? { width: Number(dimW), height: Number(dimH) } : {}), ...(customerId ? { customer_id: customerId } : {}), format: ov.format, ...(overlayPayload(ov) ? { overlay: overlayPayload(ov) } : {}) } });
      await act(async () => undefined, 'Đã nhận liên kết video. Hệ thống chỉ kiểm tra đầu liên kết; video chờ người có quyền xem toàn bộ rồi duyệt.', [base.media, '/admin/v1/media', '/portal/v1/media']);
      setUrl(''); setDur(''); setDimW(''); setDimH(''); setOv(emptyOverlay());
      onClose();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} size="lg" label="Dán link video">
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <h2 style={{ margin: '0 0 10px', fontSize: 18 }}>Dán link video</h2>
        {!base.isExternal ? (
          <Field label="Khách hàng sở hữu nội dung" hint="Để trống: lưu vào Kho chung.">
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} aria-label="Khách hàng sở hữu nội dung">
              <option value="">— Kho chung —</option>
              {(custs.data?.items ?? []).map((c) => <option key={c.id} value={c.id}>{c.short_name || c.legal_name}{c.code ? ` (${c.code})` : ''}</option>)}
            </select>
          </Field>
        ) : null}
        <Field label="Liên kết video (https)" hint="Dán liên kết tệp .mp4/.webm hoặc luồng HLS (.m3u8)/DASH (.mpd). TV phát trực tiếp từ liên kết: hệ thống KHÔNG tải, chuyển mã hay giảm chất lượng (2K–8K, mọi bitrate/fps đều nhận). Băng thông do nơi lưu trữ và TV chịu. Không dùng được trang YouTube/Vimeo/Drive.">
          <input type="url" placeholder="https://cdn.example.vn/quang-cao.mp4" value={url} onChange={(e) => setUrl(e.target.value)} required aria-label="Liên kết video" />
        </Field>
        <Field label="Thời lượng video (giây)" hint="Bắt buộc. TV: 5–60 giây; thang máy: 10–30; LED: 5–15. Lượt hiển thị hợp lệ khi TV phát đủ 90% thời lượng này.">
          <input type="number" min={1} max={3600} step={1} value={dur} onChange={(e) => setDur(e.target.value)} required aria-label="Thời lượng video (giây)" />
        </Field>
        <Field label="Loại màn hình">
          <select value={target} onChange={(e) => setTarget(e.target.value as 'tv' | 'elevator' | 'led')} aria-label="Loại màn hình">
            <option value="tv">TV (mọi độ phân giải 16:9, tới 8K)</option>
            <option value="elevator">Thang máy (độ phân giải đúng)</option>
            <option value="led">LED (độ phân giải đúng)</option>
          </select>
        </Field>
        {target !== 'tv' ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <Field label="Rộng (px)"><input type="number" min={1} value={dimW} onChange={(e) => setDimW(e.target.value)} aria-label="Rộng (px)" /></Field>
            <Field label="Cao (px)"><input type="number" min={1} value={dimH} onChange={(e) => setDimH(e.target.value)} aria-label="Cao (px)" /></Field>
          </div>
        ) : null}
        <OverlayForm value={ov} onChange={setOv} />
        {check ? <p role="status" style={{ margin: '6px 0 0', fontSize: 13, color: check.ok ? 'var(--mut)' : 'var(--bad)' }}>{check.message}</p> : null}
        {err ? <p role="alert" style={{ color: 'var(--bad)', margin: '8px 0 0' }}>{err}</p> : null}
        <div className="da" style={{ marginTop: 14 }}>
          <button type="button" className="btn" onClick={onClose}>Hủy</button>
          <button type="submit" className="btn p" disabled={busy}>{busy ? 'Đang kiểm tra…' : 'Thêm link video'}</button>
        </div>
      </form>
    </Dialog>
  );
}
