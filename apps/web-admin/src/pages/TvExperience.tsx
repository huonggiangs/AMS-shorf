import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '../api/client';
import { useAct } from '../api/hooks';
import { useAuth } from '../auth/AuthProvider';
import { ServerTable } from '../components/ServerTable';
import type { Col } from '../components/DataTable';
import { Btn, ErrorBlock, Field, LoadingBlock, Note, PageHead, Tabs, Tag } from '../components/ui';
import { Dialog } from '../components/Dialog';
import { InvoicesPanel } from './FinanceInvoices';

const KEY = '/admin/v1/tv-experience';
const settingsSchema = z.object({
  lock_ads_enabled: z.boolean(),
  fullscreen_ads_enabled: z.boolean(),
  frequency: z.object({ per_hour: z.number(), min_gap_s: z.number(), same_creative_gap_s: z.number() }),
  banned_industries: z.array(z.string()),
});
type Settings = z.infer<typeof settingsSchema>;
const overviewSchema = z.object({ settings: settingsSchema, summary: z.object({ creatives: z.number(), kid_safe: z.number(), lock_eligible: z.number() }), can_approve: z.boolean() });

const creativeSchema = z
  .object({
    id: z.string(),
    name: z.string().nullable().optional(),
    customer: z.string().optional(),
    industry: z.string().nullable().optional(),
    campaign: z.string().nullable().optional(),
    review_state: z.string(),
    duration_s: z.number().nullable().optional(),
    kid_safe: z.boolean(),
    contexts: z.array(z.string()),
    lock_eligible: z.boolean(),
    problems: z.array(z.string()).optional(),
  })
  .passthrough();
type Creative = z.infer<typeof creativeSchema>;

const CTX_LABEL: Record<string, string> = { lock: 'Màn khóa', fullscreen: 'Toàn màn hình', pause: 'Tạm dừng', corner: 'Thẻ góc' };
const REVIEW: Record<string, string> = { pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Từ chối', returned: 'Trả lại' };

/** Trải nghiệm trên TV: duyệt kid_safe cho màn khóa, cài đặt tần suất, chi trả thưởng. Mọi ràng buộc do máy chủ kiểm. */
export default function TvExperience() {
  const [tab, setTab] = useState<'ads' | 'settings' | 'rewards'>('ads');
  const { can } = useAuth();
  const items = [{ id: 'ads' as const, label: 'Quảng cáo màn khóa' }, { id: 'settings' as const, label: 'Cài đặt TV' }, ...(can('finance', 'view') ? [{ id: 'rewards' as const, label: 'Ví thưởng & rút tiền' }] : [])];
  return (
    <>
      <PageHead title="Trải nghiệm trên TV" sub="Nội dung hiển thị ở các màn hình Smart TV." />
      <Tabs value={tab} onChange={setTab} items={items} />
      {tab === 'ads' ? <LockAds /> : tab === 'settings' ? <TvSettings /> : <InvoicesPanel only="pay" />}
    </>
  );
}

function LockAds() {
  const act = useAct();
  const ov = useQuery({ queryKey: [KEY, 'overview'], queryFn: () => api.get(KEY, { schema: overviewSchema }) });
  const [nonce, setNonce] = useState(0);
  const [pick, setPick] = useState<Creative | null>(null);
  const canWrite = useAuth().can('tv_experience', 'write');
  const canApprove = ov.data?.can_approve ?? false;
  const patch = async (id: string, body: unknown, ok: string) => {
    const r = await act(() => api.put(`${KEY}/creatives/${id}`, { body }), ok, [KEY]);
    if (r) setNonce((n) => n + 1);
    return r;
  };
  const cols: Col<Creative>[] = [
    { key: 'name', label: 'Creative', sortKey: 'name', text: (r) => r.name ?? r.id },
    { key: 'customer', label: 'Khách hàng', sortKey: 'customer', text: (r) => r.customer ?? '' },
    { key: 'industry', label: 'Ngành', text: (r) => r.industry ?? '' },
    { key: 'review_state', label: 'Duyệt nội dung', sortKey: 'review_state', cell: (r) => <Tag tone={r.review_state === 'approved' ? 'ok' : 'warn'}>{REVIEW[r.review_state] ?? r.review_state}</Tag>, text: (r) => REVIEW[r.review_state] ?? r.review_state },
    { key: 'contexts', label: 'Hiển thị', cell: (r) => r.contexts.map((c) => CTX_LABEL[c] ?? c).join(', '), text: (r) => r.contexts.join(' ') },
    { key: 'duration_s', label: 'Thời lượng', num: true, cell: (r) => (r.duration_s ? `${r.duration_s} giây` : '—'), text: (r) => r.duration_s ?? '' },
    { key: 'kid_safe', label: 'Phù hợp trẻ em', cell: (r) => (r.lock_eligible ? <Tag tone="ok">Lên màn khóa</Tag> : r.kid_safe ? <Tag tone="info">kid_safe (chưa bật màn khóa)</Tag> : <Tag tone="warn">Chưa duyệt</Tag>), text: (r) => (r.kid_safe ? 'kid_safe' : '') },
    { key: 'act', label: '', cell: (r) => (canWrite ? <Btn className="sm" onClick={() => setPick(r)}>Cấu hình</Btn> : null) },
  ];
  return (
    <>
      <Note warn>Quảng cáo chỉ lên màn khóa khi: được duyệt nội dung, người duyệt xác nhận kid_safe, bật ngữ cảnh màn khóa và quản trị bật mục này trong Cài đặt TV. Ngành rượu bia, thuốc lá, cá cược, vay nóng, người lớn, thực phẩm chức năng và thuốc bị chặn.</Note>
      {ov.isLoading ? <LoadingBlock /> : ov.isError ? <ErrorBlock error={ov.error} onRetry={() => void ov.refetch()} /> : ov.data ? (
        <p style={{ color: 'var(--mut)' }}>{ov.data.summary.creatives} creative toàn màn hình · {ov.data.summary.kid_safe} kid_safe · {ov.data.summary.lock_eligible} đủ điều kiện lên màn khóa</p>
      ) : null}
      <ServerTable
        key={nonce}
        id="tv-creatives"
        endpoint={`${KEY}/creatives`}
        itemSchema={creativeSchema}
        cols={cols}
        pageSize={10}
        filters={[{ key: 'kid_safe', label: 'kid_safe', options: [{ value: 'true', label: 'Đã xác nhận' }, { value: 'false', label: 'Chưa' }] }, { key: 'review_state', label: 'Duyệt', options: Object.entries(REVIEW).map(([value, label]) => ({ value, label })) }]}
        emptyText="Chưa có creative toàn màn hình."
      />
      <ConfigDialog item={pick} canApprove={canApprove} onClose={() => setPick(null)} onSave={(id, body, ok) => patch(id, body, ok)} />
    </>
  );
}

function ConfigDialog({ item, canApprove, onClose, onSave }: { item: Creative | null; canApprove: boolean; onClose: () => void; onSave: (id: string, body: unknown, ok: string) => Promise<unknown> }) {
  const [dur, setDur] = useState('');
  const [ctx, setCtx] = useState<string[]>([]);
  const [kid, setKid] = useState(false);
  const [seen, setSeen] = useState<string | null>(null);
  if (item && seen !== item.id) {
    setSeen(item.id);
    setDur(item.duration_s ? String(item.duration_s) : '');
    setCtx(item.contexts);
    setKid(item.kid_safe);
  }
  if (!item) return <Dialog open={false} onClose={onClose}>{null}</Dialog>;
  const d = Number(dur);
  const durOk = dur === '' || (Number.isInteger(d) && d >= 5 && d <= 60);
  const toggle = (c: string) => setCtx((x) => (x.includes(c) ? x.filter((y) => y !== c) : [...x, c]));
  const save = async () => {
    const body: Record<string, unknown> = { contexts: ctx.length ? ctx : ['fullscreen'] };
    if (dur !== '') body['duration_s'] = d;
    if (canApprove && kid !== item.kid_safe) body['kid_safe'] = kid;
    // đặt kid_safe trước ngữ cảnh lock trong cùng một yêu cầu: máy chủ kiểm cả hai
    if (await onSave(item.id, body, 'Đã lưu cấu hình hiển thị trên TV.')) {
      setSeen(null);
      onClose();
    }
  };
  return (
    <Dialog open onClose={() => { setSeen(null); onClose(); }} label="Cấu hình hiển thị trên TV" width="min(480px, 94vw)">
      <h2>{item.name ?? item.id}</h2>
      <Field label="Thời lượng hiển thị (5–60 giây)"><input type="number" min={5} max={60} value={dur} onChange={(e) => setDur(e.target.value)} /></Field>
      <Field label="Nơi hiển thị">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {Object.entries(CTX_LABEL).map(([c, label]) => (
            <label key={c} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={ctx.includes(c)} disabled={c === 'lock' && !canApprove && !item.contexts.includes('lock')} onChange={() => toggle(c)} />
              {label}
            </label>
          ))}
        </div>
      </Field>
      {canApprove ? (
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '10px 0' }}>
          <input type="checkbox" checked={kid} onChange={(e) => setKid(e.target.checked)} />
          Xác nhận phù hợp màn hình có trẻ em (kid_safe)
        </label>
      ) : <Note>Chỉ người có quyền duyệt mới xác nhận kid_safe và bật màn khóa.</Note>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
        <Btn onClick={() => { setSeen(null); onClose(); }}>Hủy</Btn>
        <Btn tone="p" disabled={!durOk} onClick={() => void save()}>Lưu</Btn>
      </div>
    </Dialog>
  );
}

function TvSettings() {
  const act = useAct();
  const { can } = useAuth();
  const q = useQuery({ queryKey: [KEY, 'settings'], queryFn: () => api.get(KEY, { schema: overviewSchema }) });
  const [draft, setDraft] = useState<Settings | null>(null);
  const [banned, setBanned] = useState('');
  if (q.isLoading) return <LoadingBlock />;
  if (q.isError || !q.data) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;
  const s = draft ?? q.data.settings;
  const bannedText = draft ? banned : s.banned_industries.join(', ');
  const set = (p: Partial<Settings>) => setDraft({ ...s, ...p });
  const num = (v: string) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : 0);
  const canWrite = can('tv_experience', 'write');
  return (
    <div className="card cp">
      <h2>Cài đặt TV</h2>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0' }}>
        <input type="checkbox" disabled={!canWrite} checked={s.fullscreen_ads_enabled} onChange={(e) => set({ fullscreen_ads_enabled: e.target.checked })} />
        Cho phép quảng cáo toàn màn hình
      </label>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0' }}>
        <input type="checkbox" disabled={!canWrite || (!q.data.can_approve && !s.lock_ads_enabled)} checked={s.lock_ads_enabled} onChange={(e) => set({ lock_ads_enabled: e.target.checked })} />
        Cho phép quảng cáo ở màn khóa phụ huynh (mặc định tắt; chỉ người duyệt được bật)
      </label>
      <div className="g g3">
        <Field label="Tối đa lượt/giờ (1–120)"><input type="number" disabled={!canWrite} value={s.frequency.per_hour} onChange={(e) => set({ frequency: { ...s.frequency, per_hour: num(e.target.value) } })} /></Field>
        <Field label="Cách nhau tối thiểu (giây)"><input type="number" disabled={!canWrite} value={s.frequency.min_gap_s} onChange={(e) => set({ frequency: { ...s.frequency, min_gap_s: num(e.target.value) } })} /></Field>
        <Field label="Cùng creative cách nhau (giây)"><input type="number" disabled={!canWrite} value={s.frequency.same_creative_gap_s} onChange={(e) => set({ frequency: { ...s.frequency, same_creative_gap_s: num(e.target.value) } })} /></Field>
      </div>
      <Field label="Ngành bị chặn kid_safe (cách nhau bằng dấu phẩy)">
        <input disabled={!canWrite} value={bannedText} onChange={(e) => { setBanned(e.target.value); setDraft({ ...s, banned_industries: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) }); }} />
      </Field>
      {canWrite ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <Btn tone="p" disabled={!draft} onClick={async () => {
            if (!draft) return;
            const turningOn = draft.lock_ads_enabled && !q.data.settings.lock_ads_enabled;
            if (turningOn && !window.confirm('Bật quảng cáo ở màn khóa là hiển thị quảng cáo cho trẻ em. Chỉ bật khi pháp lý và phụ huynh đã chấp thuận. Tiếp tục?')) return;
            if (await act(() => api.put(`${KEY}/settings`, { body: turningOn ? { ...draft, confirm_children_policy: true } : draft }), 'Đã lưu cài đặt TV.', [KEY])) { setDraft(null); void q.refetch(); }
          }}>Lưu cài đặt</Btn>
        </div>
      ) : null}
    </div>
  );
}
