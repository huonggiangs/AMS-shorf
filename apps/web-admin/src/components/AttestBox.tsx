import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, errMsg } from '../api/client';
import { Dialog } from './Dialog';
import { ATTEST_SOURCE_LABEL, ATTEST_STATUS_LABEL, KID_SAFE_HELP_VI, KID_SAFE_LABEL_VI, LEGAL_ATTESTATION_STATUS_NOTE, LEGAL_ATTESTATION_TEXT_VI, attestBody, type AttestationStatus } from '../lib/attest';
import { fmtDateTime } from '../lib/format';
import { Tag } from './ui';

export interface AttestState { accepted: boolean; kidSafe: boolean }
export const EMPTY_ATTEST: AttestState = { accepted: false, kidSafe: false };

/** Ô cam kết pháp lý (bắt buộc tick) + ô riêng "Phù hợp trẻ em" (mặc định bỏ trống = không an toàn cho trẻ). */
export function AttestBox({ value, onChange, showKid = true }: { value: AttestState; onChange: (v: AttestState) => void; showKid?: boolean }) {
  return (
    <fieldset style={{ border: '1px solid var(--line, #d9dde3)', borderRadius: 10, padding: '10px 12px', margin: '12px 0 0' }}>
      <legend style={{ fontSize: 13, fontWeight: 600, padding: '0 6px' }}>Cam kết pháp lý</legend>
      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13 }}>
        <input type="checkbox" checked={value.accepted} onChange={(e) => onChange({ ...value, accepted: e.target.checked })} style={{ marginTop: 3 }} aria-label="Cam kết pháp lý" />
        <span>{LEGAL_ATTESTATION_TEXT_VI}</span>
      </label>
      {showKid ? (
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, marginTop: 8 }}>
          <input type="checkbox" checked={value.kidSafe} onChange={(e) => onChange({ ...value, kidSafe: e.target.checked })} style={{ marginTop: 3 }} aria-label={KID_SAFE_LABEL_VI} />
          <span><b>{KID_SAFE_LABEL_VI}</b><br /><span style={{ color: 'var(--mut)' }}>{KID_SAFE_HELP_VI}</span></span>
        </label>
      ) : null}
      <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--mut)' }}>{LEGAL_ATTESTATION_STATUS_NOTE}. Tên và thời điểm xác nhận của bạn được lưu lại.</p>
    </fieldset>
  );
}

export const ATTEST_REQUIRED_MSG = 'Hãy tick ô cam kết pháp lý để tiếp tục.';

/** Nhãn trạng thái cam kết của creative đã duyệt. */
export function AttestTag({ a }: { a?: { status: string; signed_by_name?: string | null; signed_at?: string | null; kid_safe?: boolean } | null }) {
  if (!a) return null;
  const st = a.status as AttestationStatus;
  const tone = st === 'valid' ? 'ok' : st === 'stale' ? 'warn' : 'bad';
  const title = st === 'valid' ? `${a.signed_by_name ?? ''} ký ${a.signed_at ? fmtDateTime(a.signed_at) : ''}` : 'Chưa phát được xuống màn hình cho tới khi có người có quyền ký cam kết.';
  return <span title={title}><Tag tone={tone as 'ok'}>{ATTEST_STATUS_LABEL[st] ?? st}</Tag>{st === 'valid' ? <> <Tag tone="info">{a.kid_safe ? 'Phù hợp trẻ em' : 'Không dành cho trẻ em'}</Tag></> : null}</span>;
}

/** Hộp ký cam kết cho tệp đã duyệt (ký bổ sung từng tệp hoặc ký hàng loạt có xác nhận). */
export function SignDialog({ ids, label, bulk, onClose, onDone }: { ids: string[]; label: string; bulk: boolean; onClose: () => void; onDone: (msg: string) => void }) {
  const [v, setV] = useState<AttestState>(EMPTY_ATTEST);
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!v.accepted) return setErr(ATTEST_REQUIRED_MSG);
    if (bulk && !confirm) return setErr(`Hãy tick xác nhận bạn tự chịu trách nhiệm cho ${ids.length} tệp.`);
    setErr(''); setBusy(true);
    try {
      if (bulk) {
        let signed = 0; let skipped = 0;
        for (let i = 0; i < ids.length; i += 200) {
          const r = (await api.post('/admin/v1/media/attest-bulk', { body: { ids: ids.slice(i, i + 200), attest: attestBody(true, v.kidSafe), confirm: true } })) as { signed: string[]; skipped: unknown[] };
          signed += r.signed.length; skipped += r.skipped.length;
        }
        onDone(`Đã ký cam kết cho ${signed} tệp${skipped ? `, bỏ qua ${skipped} tệp (đã có cam kết hoặc chưa duyệt)` : ''}.`);
      } else {
        await api.post(`/admin/v1/media/${ids[0]}/attest`, { body: { attest: attestBody(true, v.kidSafe) } });
        onDone('Đã ký cam kết. Tệp có thể phát xuống màn hình.');
      }
      onClose();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} size="sm" label={bulk ? 'Ký xác nhận hàng loạt' : 'Ký cam kết pháp lý'}>
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <h2 style={{ margin: '0 0 6px', fontSize: 18 }}>{bulk ? 'Ký xác nhận hàng loạt' : 'Ký cam kết pháp lý'}</h2>
        <p className="sub" style={{ margin: '0 0 6px' }}>{label}</p>
        {bulk ? <p style={{ fontSize: 13, margin: '0 0 6px' }}>Mỗi tệp được ghi riêng tên và thời điểm ký của bạn. Lựa chọn "{KID_SAFE_LABEL_VI}" bên dưới áp dụng cho tất cả tệp trong đợt này (mặc định không tick).</p> : null}
        <AttestBox value={v} onChange={setV} />
        {bulk ? (
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, marginTop: 10 }}>
            <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} style={{ marginTop: 3 }} aria-label="Xác nhận ký hàng loạt" />
            <span>Tôi đã xem lại các tệp này và đồng ý ký cho {ids.length} tệp.</span>
          </label>
        ) : null}
        {err ? <p role="alert" style={{ color: 'var(--bad)', margin: '8px 0 0' }}>{err}</p> : null}
        <div className="da" style={{ marginTop: 14 }}>
          <button type="button" className="btn" onClick={onClose}>Hủy</button>
          <button type="submit" className="btn p" disabled={busy}>{bulk ? `Ký cho ${ids.length} tệp` : 'Ký cam kết'}</button>
        </div>
      </form>
    </Dialog>
  );
}

/** Lịch sử người ký (chi tiết creative). */
export interface AttestHistoryItem { id: string; version: string; kid_safe: boolean; signed_by_name: string; signed_at: string; source: string; revoked_at: string | null; revoked_reason: string | null; effective: boolean }
export function AttestHistory({ items }: { items: AttestHistoryItem[] }) {
  if (!items.length) return <p className="sub" style={{ margin: '8px 0 0' }}>Chưa có ai ký cam kết cho tệp này.</p>;
  return (
    <ul aria-label="Lịch sử ký cam kết" style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 13 }}>
      {items.map((h) => (
        <li key={h.id}>
          {h.signed_by_name} · {fmtDateTime(h.signed_at)} · {ATTEST_SOURCE_LABEL[h.source] ?? h.source} · {h.version} · {h.kid_safe ? 'phù hợp trẻ em' : 'không dành cho trẻ em'}
          {h.effective ? ' · đang có hiệu lực' : h.revoked_at ? ' · đã thu hồi' : ' · hết hiệu lực (nội dung đã đổi)'}
        </li>
      ))}
    </ul>
  );
}

/** Hộp duyệt có cam kết: bắt buộc tick ô cam kết pháp lý mới gọi onSubmit (gửi kèm attest). */
export function AttestApproveDialog({ title, label, submitLabel = 'Duyệt', onClose, onSubmit }: { title: string; label: string; submitLabel?: string; onClose: () => void; onSubmit: (attest: ReturnType<typeof attestBody>) => Promise<void> }) {
  const [v, setV] = useState<AttestState>(EMPTY_ATTEST);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onClose={onClose} size="sm" label={title}>
      <form onSubmit={async (e) => {
        e.preventDefault();
        if (!v.accepted) return setErr(ATTEST_REQUIRED_MSG);
        setErr(''); setBusy(true);
        try { await onSubmit(attestBody(true, v.kidSafe)); onClose(); } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
      }}>
        <h2 style={{ margin: '0 0 6px', fontSize: 18 }}>{title}</h2>
        <p className="sub" style={{ margin: '0 0 6px' }}>{label}</p>
        <AttestBox value={v} onChange={setV} />
        {err ? <p role="alert" style={{ color: 'var(--bad)', margin: '8px 0 0' }}>{err}</p> : null}
        <div className="da" style={{ marginTop: 14 }}>
          <button type="button" className="btn" onClick={onClose}>Hủy</button>
          <button type="submit" className="btn p" disabled={busy}>{submitLabel}</button>
        </div>
      </form>
    </Dialog>
  );
}

/** Tải và hiện lịch sử người ký của một creative (chi tiết creative). */
export function AttestHistoryLoader({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['/admin/v1/media', id, 'attestations'], queryFn: () => api.get(`/admin/v1/media/${id}/attestations`) as Promise<{ items: AttestHistoryItem[] }> });
  return (
    <div style={{ marginTop: 10 }}>
      <b style={{ fontSize: 13 }}>Lịch sử ký cam kết</b>
      {q.isLoading ? <p className="sub" style={{ margin: '4px 0 0' }}>Đang tải…</p> : q.isError ? <p className="sub" style={{ margin: '4px 0 0' }}>Không tải được lịch sử.</p> : <AttestHistory items={q.data?.items ?? []} />}
    </div>
  );
}
