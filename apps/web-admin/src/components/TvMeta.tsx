// Duyệt metadata hiển thị trên TV của creative (w-dev): kid_safe + ngữ cảnh (lock/fullscreen/pause/corner).
// Máy chủ kiểm tra mọi ràng buộc (quyền duyệt, ngành bị cấm, 16:9, màn khóa phải được bật, xác nhận gắn phiên bản nội dung).
import { useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { api, ApiError, errMsg } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { useUi } from '../state/ui';
import { Btn, EmptyBlock, ErrorBlock, Field, LoadingBlock, Note, Tag } from './ui';
import { OpsDialog } from './OpsDialog';
import { fmtDateTime } from '../lib/format';

const KEY = '/admin/v1/tv-experience/creatives';
const itemSchema = z.object({
  id: z.string(), name: z.string().nullish(), customer: z.string().nullish(), industry: z.string().nullish(), review_state: z.string(), duration_s: z.number().nullish(),
  kid_safe: z.boolean(), contexts: z.array(z.string()), content_version: z.number().default(1), lock_eligible: z.boolean(),
  kid_review: z.object({ current: z.boolean(), reviewed_at: z.string().nullable(), reviewed_by: z.string().nullable(), note: z.string().nullable() }).optional(),
}).passthrough();
const listSchema = z.object({ items: z.array(itemSchema), total: z.number() });
type Item = z.infer<typeof itemSchema>;

export const CTX: Record<string, string> = { lock: 'Màn khóa (trẻ em)', fullscreen: 'Toàn màn hình', pause: 'Khi tạm dừng', corner: 'Thẻ góc' };
export const TV_ERRORS: Record<string, string> = {
  reviewer_confirmation_required: 'Cần tích xác nhận "đã xem nội dung" và nhập ghi chú duyệt (tối thiểu 3 ký tự).',
  kid_safe_blocked: 'Creative chưa đủ điều kiện kid_safe (xem lý do bên dưới).',
  lock_ads_disabled: 'Quảng cáo ở màn khóa đang TẮT. Quản trị cấp cao bật trong trang "Trải nghiệm trên TV" trước.',
  kid_safe_required: 'Cần kid_safe trước khi cho phép màn khóa.',
  forbidden: 'Chỉ người có quyền duyệt TV mới xác nhận kid_safe và màn khóa.',
};

export function TvMetaSection() {
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const [pick, setPick] = useState<Item | null>(null);
  const allowed = can('tv_experience', 'view');
  const q = useQuery({ queryKey: [KEY, 'review', page], enabled: allowed, placeholderData: keepPreviousData, queryFn: () => api.get(KEY, { query: { page, page_size: 10, filter: 'review_state:approved' }, schema: listSchema }) });
  if (!allowed) return null;
  return (
    <section aria-label="Metadata hiển thị trên TV" style={{ marginTop: 28 }}>
      <h2 style={{ fontSize: 18, margin: '0 0 6px' }}>Hiển thị trên TV (kid_safe &amp; ngữ cảnh)</h2>
      <Note warn>Quảng cáo chỉ lên màn khóa trẻ em khi: nội dung đã duyệt, người duyệt xác nhận kid_safe cho đúng phiên bản nội dung hiện tại, ngữ cảnh có &quot;Màn khóa&quot; và quản trị đã bật màn khóa. Khách đổi nội dung thì xác nhận hết hiệu lực.</Note>
      {q.isLoading ? <LoadingBlock /> : q.isError ? <ErrorBlock error={q.error} onRetry={() => void q.refetch()} /> : !q.data?.items.length ? <EmptyBlock>Chưa có creative toàn màn hình nào được duyệt nội dung.</EmptyBlock> : (
        <div className="tw"><table>
          <thead><tr><th>Creative</th><th>Khách hàng</th><th>Ngữ cảnh</th><th>kid_safe</th><th /></tr></thead>
          <tbody>
            {q.data.items.map((m) => (
              <tr key={m.id}>
                <td><b>{m.name ?? m.id}</b><div className="sub" style={{ fontSize: 12 }}>v{m.content_version}</div></td>
                <td>{m.customer ?? '—'}{m.industry ? <div className="sub" style={{ fontSize: 12 }}>{m.industry}</div> : null}</td>
                <td>{m.contexts.map((c) => CTX[c] ?? c).join(', ')}</td>
                <td>{m.lock_eligible ? <Tag tone="ok">Lên màn khóa</Tag> : m.kid_safe ? <Tag tone="warn">{m.kid_review?.current ? 'kid_safe (màn khóa chưa bật)' : 'Cần xác nhận lại'}</Tag> : <Tag tone="info">Chưa duyệt</Tag>}
                  {m.kid_review?.reviewed_at ? <div className="sub" style={{ fontSize: 12 }}>{m.kid_review.reviewed_by ?? ''} · {fmtDateTime(m.kid_review.reviewed_at)}</div> : null}</td>
                <td><Btn className="sm" onClick={() => setPick(m)}>Cấu hình</Btn></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      {(q.data?.total ?? 0) > 10 ? <div className="pg">{Array.from({ length: Math.ceil((q.data?.total ?? 0) / 10) }, (_, i) => <button key={i} type="button" className={i + 1 === page ? 'on' : ''} aria-label={`Trang metadata ${i + 1}`} onClick={() => setPage(i + 1)}>{i + 1}</button>)}</div> : null}
      {pick ? <TvMetaDialog key={pick.id} item={pick} onClose={() => setPick(null)} /> : null}
    </section>
  );
}

export function TvMetaDialog({ item, onClose }: { item: Item; onClose: () => void }) {
  const { can } = useAuth();
  const { notify } = useUi();
  const qc = useQueryClient();
  const canApprove = can('tv_experience', 'approve');
  const [kid, setKid] = useState(item.kid_safe);
  const [ctx, setCtx] = useState<string[]>(item.contexts);
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const wantsLock = ctx.includes('lock');
  // cần xác nhận khi đặt/giữ kid_safe mà chưa có xác nhận còn hiệu lực cho phiên bản hiện tại, hoặc khi thêm màn khóa
  const needsConfirm = kid && (!item.kid_safe || !item.kid_review?.current || (wantsLock && !item.contexts.includes('lock')));
  const noteOk = note.trim().length >= 3;
  const canSave = !busy && ctx.length > 0 && (!needsConfirm || (confirm && noteOk)) && (!wantsLock || kid);
  const toggle = (c: string) => setCtx((x) => (x.includes(c) ? x.filter((y) => y !== c) : [...x, c]));
  const save = async () => {
    setBusy(true); setErr(''); setProblems([]);
    try {
      const body: Record<string, unknown> = { contexts: ctx };
      if (canApprove && (kid !== item.kid_safe || needsConfirm)) body['kid_safe'] = kid;
      if (needsConfirm) { body['confirm_reviewed'] = true; body['note'] = note.trim(); }
      await api.put(`/admin/v1/tv-experience/creatives/${item.id}`, { body });
      notify('Đã lưu metadata hiển thị trên TV.');
      await qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/admin/v1/tv-experience') });
      onClose();
    } catch (e) {
      if (e instanceof ApiError) {
        setErr(TV_ERRORS[e.code] ?? errMsg(e));
        const p = (e.details as { problems?: string[] } | undefined)?.problems;
        if (Array.isArray(p)) setProblems(p);
      } else setErr(errMsg(e));
    } finally { setBusy(false); }
  };
  return (
    <OpsDialog open onClose={onClose} label="Cấu hình hiển thị trên TV" width="min(520px,96vw)">
      <h2 style={{ margin: '0 0 4px', fontSize: 18 }}>{item.name ?? item.id}</h2>
      <p className="sub" style={{ margin: '0 0 10px' }}>Phiên bản nội dung v{item.content_version} · {item.customer ?? ''}</p>
      <Field label="Nơi hiển thị trên TV">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {Object.entries(CTX).map(([c, label]) => (
            <label key={c} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={ctx.includes(c)} disabled={!canApprove && c === 'lock'} onChange={() => toggle(c)} />{label}
            </label>
          ))}
        </div>
      </Field>
      {canApprove ? (
        <>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '10px 0' }}>
            <input type="checkbox" checked={kid} onChange={(e) => { setKid(e.target.checked); if (!e.target.checked) setCtx((x) => x.filter((y) => y !== 'lock')); }} />
            Phù hợp màn hình có trẻ em (kid_safe)
          </label>
          {wantsLock && !kid ? <p role="alert" style={{ color: 'var(--bad)' }}>Màn khóa chỉ dành cho creative kid_safe.</p> : null}
          {needsConfirm ? (
            <div className="note" style={{ display: 'block' }}>
              <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
                <span>Tôi xác nhận đã xem toàn bộ nội dung (hình, chữ, QR, hotline) của phiên bản v{item.content_version}, không thuộc ngành cấm và phù hợp trẻ em.</span>
              </label>
              <Field label="Ghi chú duyệt (ghi vào nhật ký, tối thiểu 3 ký tự)"><textarea value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></Field>
            </div>
          ) : kid && item.kid_review?.current ? <p className="sub">Đã xác nhận bởi {item.kid_review.reviewed_by ?? '—'} lúc {fmtDateTime(item.kid_review.reviewed_at)} cho phiên bản này.</p> : null}
        </>
      ) : <Note>Chỉ người có quyền duyệt TV mới xác nhận kid_safe và bật màn khóa. Bạn có thể đổi các ngữ cảnh khác.</Note>}
      {err ? <p role="alert" style={{ color: 'var(--bad)', margin: '8px 0 0' }}>{err}</p> : null}
      {problems.length ? <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 13 }}>{problems.map((p) => <li key={p}>{p}</li>)}</ul> : null}
      <div className="da" style={{ marginTop: 14 }}>
        <button type="button" className="btn" onClick={onClose}>Hủy</button>
        <button type="button" className="btn p" disabled={!canSave} onClick={() => void save()}>Lưu</button>
      </div>
    </OpsDialog>
  );
}
