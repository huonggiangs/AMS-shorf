import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueries, useQuery } from '@tanstack/react-query';
import { api, errMsg } from '../api/client';
import { approveResultSchema, campaignSchema, customerSchema, listOf, mediaSchema, screenSchema, type Campaign } from '../api/schemas';
import { useAct, useBase } from '../api/hooks';
import { useAuth } from '../auth/AuthProvider';
import { ServerTable } from '../components/ServerTable';
import type { Col } from '../components/DataTable';
import { Btn, Field, Kpi, NameCell, PageHead, StatusTag, Tabs, LoadingBlock } from '../components/ui';
import { PaceBar } from '../components/charts';
import { Drawer } from '../components/Drawer';
import { Dialog } from '../components/Dialog';
import { PromptDialog } from '../components/Prompt';
import { Icon } from '../components/Icon';
import { useT } from '../i18n';
import { vnd, num, fmtDate } from '../lib/format';
import { ELEVATOR_SIZES, checkCreative, parsePx, type ScreenType } from '../lib/creative';
import { STATUS_LABEL } from '../lib/status';

const TABS = ['all', 'active', 'scheduled', 'pending', 'awaiting_funds', 'draft', 'paused'] as const;
const tabLabel = (s: string) => (s === 'all' ? 'Tất cả' : STATUS_LABEL(s));

export default function Campaigns() {
  const t = useT();
  const { can } = useAuth();
  const base = useBase();
  const act = useAct();
  const [sp, setSp] = useSearchParams();
  const [tab, setTab] = useState<(typeof TABS)[number]>('all');
  const [reject, setReject] = useState<string | null>(null);
  const openId = sp.get('open');
  const showNew = sp.get('new') === '1';

  const counts = useQueries({
    queries: TABS.map((s) => ({
      queryKey: [base.campaigns, 'count', s],
      queryFn: () => api.get(base.campaigns, { query: { page: 1, page_size: 1, filter: s === 'all' ? undefined : `status:${s}` }, schema: listOf(campaignSchema) }),
    })),
  });
  const cnt = (s: string) => counts[TABS.indexOf(s as never)]?.data?.total;

  const cols: Col<Campaign>[] = useMemo(
    () => [
      { key: 'name', label: 'Chiến dịch & nhãn hàng', sortKey: 'name', text: (r) => r.name, cell: (r) => <NameCell icon="ads" a={r.name} b={`${r.brand ?? ''}${r.duration_sec ? ` · ${r.duration_sec} giây` : ''} · #${r.id}`} /> },
      ...(base.isExternal ? [] : [{ key: 'source', label: 'Nguồn / kênh RTB', text: (r: Campaign) => r.source ?? '', cell: (r: Campaign) => <span style={{ fontWeight: 600, fontSize: 13 }}>{r.source ?? '—'}</span> }]),
      { key: 'budget', label: 'Ngân sách', sortKey: 'budget_vnd', num: true, text: (r) => r.budget_vnd, cell: (r) => vnd(r.budget_vnd) },
      { key: 'pacing', label: 'Tiến độ pacing', sortKey: 'pacing_pct', text: (r) => r.pacing_pct ?? '', cell: (r) => (
        <div style={{ minWidth: 130 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', font: '12px var(--mono)', marginBottom: 4 }}>
            <b>{r.pacing_pct ?? 0}%</b><span style={{ color: 'var(--mut)' }}>{num(r.impressions)} lượt</span>
          </div>
          <PaceBar pct={r.pacing_pct ?? 0} />
        </div>) },
      { key: 'start', label: 'Bắt đầu', sortKey: 'start_date', text: (r) => r.start_date ?? '', cell: (r) => fmtDate(r.start_date) },
      { key: 'status', label: 'Trạng thái', sortKey: 'status', text: (r) => STATUS_LABEL(r.status), cell: (r) => <StatusTag status={r.status} /> },
    ],
    [base.isExternal],
  );

  const total = cnt('all');
  return (
    <>
      <PageHead
        title="Quảng cáo"
        sub="Điều phối ngân sách, chỉ tiêu lượt phát, pacing và tiến độ các chiến dịch trên mạng lưới màn hình."
        actions={can('campaigns', 'write') ? <Btn tone="p" icon="plus" onClick={() => setSp({ new: '1' })}>{t('Tạo chiến dịch mới')}</Btn> : null}
      />
      <div className="g g4">
        <Kpi label="Chiến dịch đang chạy" icon="ads" value={cnt('active') ?? '—'} foot={total != null ? `/ ${total} chiến dịch` : ''} />
        <Kpi label="Chờ duyệt" icon="doc" value={cnt('pending') ?? '—'} foot="Cần người có quyền duyệt" />
        <Kpi label="Chờ nạp tiền" icon="card" value={cnt('awaiting_funds') ?? '—'} foot="Tự chạy khi ví đủ" />
        <Kpi label="Đã lên lịch" icon="cal" value={cnt('scheduled') ?? '—'} foot="Tự chạy đúng ngày bắt đầu" />
      </div>
      <Tabs value={tab} onChange={setTab} label="status" items={TABS.map((s) => ({ id: s, label: `${t(tabLabel(s))}${cnt(s) != null ? ` · ${cnt(s)}` : ''}` }))} />
      <ServerTable
        id="ads"
        endpoint={base.campaigns}
        itemSchema={campaignSchema}
        cols={cols}
        exportName="chien-dich"
        extra={useMemo(() => (tab === 'all' ? undefined : { status: tab }), [tab])}
        onOpen={(r) => setSp({ open: r.id })}
        bulk={can('campaigns', 'write') ? [{ key: 'pause', label: t('Tạm dừng') }, ...(can('campaigns', 'delete') ? [{ key: 'del', label: t('Xóa'), tone: 'd' as const }] : [])] : []}
        onBulk={(k, ids, done) => void (async () => {
          for (const id of ids) await act(() => (k === 'del' ? api.del(`${base.campaigns}/${id}`) : api.post(`${base.campaigns}/${id}/pause`)), undefined, [base.campaigns]);
          done();
        })()}
      />
      <CampaignDrawer id={openId} onClose={() => setSp({})} onReject={(id) => setReject(id)} />
      <PromptDialog open={!!reject} title="Trả lại chiến dịch" label="Lý do trả lại (khách hàng sẽ nhận email)" onClose={() => setReject(null)} onSubmit={async (reason) => { if (reject) await act(() => api.post(`/admin/v1/campaigns/${reject}/reject`, { body: { reason } }), 'Đã trả lại.', ['/admin/v1', '/portal/v1']); }} />
      <CampaignForm open={showNew} onClose={() => setSp({})} />
    </>
  );
}

export function CampaignDrawer({ id, onClose, onReject }: { id: string | null; onClose: () => void; onReject: (id: string) => void }) {
  const t = useT();
  const { can } = useAuth();
  const base = useBase();
  const act = useAct();
  const q = useQuery({ queryKey: [base.campaigns, 'one', id], enabled: !!id, queryFn: () => api.get(`${base.campaigns}/${id}`, { schema: campaignSchema }) });
  const c = q.data;
  const [msg, setMsg] = useState('');
  const ep = (a: string) => `${base.campaigns}/${id}/${a}`;
  const run = (a: string, ok: string) => act(() => api.post(ep(a)), ok, ['/admin/v1', '/portal/v1']);
  return (
    <Drawer open={!!id} onClose={onClose}>
      {q.isLoading ? <LoadingBlock /> : q.isError ? <p role="alert" style={{ color: 'var(--bad)' }}>{errMsg(q.error)}</p> : c ? (
        <>
          <h2>{c.name}</h2>
          <p className="sub">{c.brand} {c.duration_sec ? `· ${c.duration_sec} giây` : ''}</p>
          <div style={{ margin: '14px 0' }}>
            <div className="tv"><div className="scr"><div className="ph">{c.media_name ?? 'CREATIVE'}</div></div></div>
          </div>
          <StatusTag status={c.status} />
          <dl className="kv">
            <dt>Mã</dt><dd className="mono">{c.id}</dd>
            <dt>Người gửi</dt><dd>{c.creator ?? '—'}</dd>
            <dt>Ngân sách</dt><dd>{vnd(c.budget_vnd)}</dd>
            {c.reserved_vnd ? (<><dt>Đã giữ từ ví</dt><dd>{vnd(c.reserved_vnd)}</dd></>) : null}
            <dt>Thời gian</dt><dd>{fmtDate(c.start_date)} → {fmtDate(c.end_date)}</dd>
            <dt>Lượt xem</dt><dd>{num(c.impressions)}</dd>
            {c.reject_reason ? (<><dt>Lý do trả lại</dt><dd>{c.reject_reason}</dd></>) : null}
          </dl>
          {msg ? <div className="note"><Icon n="info" /><span>{msg}</span></div> : null}
          <div className="acts">
            {c.status === 'draft' && can('campaigns', 'write') ? <Btn tone="p" onClick={() => void run('submit', 'Đã gửi duyệt.')}>{t('Gửi duyệt')}</Btn> : null}
            {c.status === 'pending' && can('campaigns', 'approve') && !base.isExternal ? (
              <>
                <Btn tone="p" onClick={async () => { const r = await act(() => api.post(ep('approve'), { schema: approveResultSchema }), undefined, ['/admin/v1']); if (r) setMsg(r.message ?? (r.status === 'awaiting_funds' ? `Đã duyệt nhưng ví thiếu ${vnd(r.shortfall_vnd)}. Quảng cáo tự chạy sau khi nạp đủ.` : `Đã duyệt${r.reserved_vnd ? `, đã giữ ${vnd(r.reserved_vnd)} từ ví` : ''}.`)); }}>{t('Duyệt')}</Btn>
                <Btn onClick={() => onReject(c.id)}>{t('Trả lại')}</Btn>
              </>
            ) : null}
            {c.status === 'active' && can('campaigns', 'write') ? <Btn onClick={() => void run('pause', 'Đã tạm dừng.')}>{t('Tạm dừng')}</Btn> : null}
            {c.status === 'paused' && can('campaigns', 'write') ? <Btn tone="p" onClick={() => void run('resume', 'Đã tiếp tục.')}>{t('Tiếp tục')}</Btn> : null}
            {can('campaigns', 'delete') ? <Btn tone="d" onClick={async () => { if (confirm('Xóa chiến dịch?')) { await act(() => api.del(`${base.campaigns}/${c.id}`), 'Đã xóa.'); onClose(); } }}>{t('Xóa')}</Btn> : null}
          </div>
        </>
      ) : null}
    </Drawer>
  );
}

const SCREEN_OPTS: { id: ScreenType; label: string }[] = [
  { id: 'tv', label: 'Smart TV (16:9)' }, { id: 'elevator', label: 'Màn hình thang máy (dọc 9:16)' }, { id: 'led', label: 'Bảng LED P5' },
];

export const BUDGET_MIN = 1000;
export const BUDGET_STEP = 1000;
/** Kiểm tra ngân sách (VND): số nguyên, >= tối thiểu, bội số của bước. */
export function budgetError(v: string): string | null {
  const n = Number(v);
  if (v.trim() === '' || !Number.isFinite(n)) return 'Nhập ngân sách hợp lệ.';
  if (n < BUDGET_MIN) return `Ngân sách tối thiểu ${vnd(BUDGET_MIN)}.`;
  if (n % BUDGET_STEP !== 0) return `Ngân sách phải là bội số của ${vnd(BUDGET_STEP)}.`;
  return null;
}

export function CampaignForm({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const base = useBase();
  const act = useAct();
  const [f, setF] = useState({ name: '', customer_id: '', screen_type: 'tv' as ScreenType, elev: '21.5', led: '', media_id: '', budget: '5000000', duration: '15', start: '', end: '' });
  const [err, setErr] = useState('');
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  const custs = useQuery({ queryKey: ['/admin/v1/customers', 'pick'], enabled: open && !base.isExternal, queryFn: () => api.get('/admin/v1/customers', { query: { page_size: 200 }, schema: listOf(customerSchema) }) });
  const leds = useQuery({ queryKey: ['/admin/v1/screens', 'led'], enabled: open && f.screen_type === 'led' && !base.isExternal, queryFn: () => api.get('/admin/v1/screens', { query: { page_size: 100, filter: 'type:led' }, schema: listOf(screenSchema) }) });
  const media = useQuery({ queryKey: [base.media, 'pick', f.customer_id], enabled: open, queryFn: () => api.get(base.media, { query: { page_size: 100, filter: `status:approved${f.customer_id ? `,customer_id:${f.customer_id}` : ''}` }, schema: listOf(mediaSchema) }) });
  const m = media.data?.items.find((x) => x.id === f.media_id);
  const target = { type: f.screen_type, px: f.screen_type === 'led' ? parsePx(leds.data?.items.find((x) => x.id === f.led)?.resolution) : f.screen_type === 'elevator' ? ELEVATOR_SIZES[f.elev] : null };
  const check = m ? checkCreative(target, m) : null;

  const submit = async (send: boolean) => {
    setErr('');
    if (!f.name.trim()) return setErr('Nhập tên chiến dịch.');
    if (!base.isExternal && !f.customer_id) return setErr('Chọn khách hàng.');
    const bErr = budgetError(f.budget);
    if (bErr) return setErr(bErr);
    if (m && check && !check.ok) return setErr(check.message);
    const created = await act(() => api.post(base.campaigns, { body: { name: f.name.trim(), customer_id: f.customer_id || undefined, screen_type: f.screen_type, screen_id: f.screen_type === 'led' ? f.led || undefined : undefined, media_id: f.media_id || undefined, budget_vnd: Math.round(+f.budget), duration_sec: +f.duration, start_date: f.start || undefined, end_date: f.end || undefined }, schema: campaignSchema }), undefined, ['/admin/v1', '/portal/v1']);
    if (!created) return;
    if (send) await act(() => api.post(`${base.campaigns}/${created.id}/submit`), 'Đã gửi duyệt. Gửi được cả khi ví chưa đủ.', ['/admin/v1', '/portal/v1']);
    else await act(async () => undefined, 'Đã lưu bản nháp.');
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} width="min(560px,96vw)" label="Tạo chiến dịch">
      <form onSubmit={(e) => { e.preventDefault(); void submit(true); }}>
        <h2 style={{ margin: '0 0 10px', fontSize: 18 }}>Tạo chiến dịch mới</h2>
        <Field label="Tên chiến dịch"><input value={f.name} onChange={(e) => set('name', e.target.value)} required /></Field>
        {!base.isExternal ? (
          <Field label="Khách hàng">
            <select value={f.customer_id} onChange={(e) => set('customer_id', e.target.value)} required>
              <option value="">—</option>
              {custs.data?.items.map((c) => <option key={c.id} value={c.id}>{c.short_name ?? c.legal_name} · {c.code ?? c.id}</option>)}
            </select>
          </Field>
        ) : null}
        <Field label="Loại màn hình">
          <select value={f.screen_type} onChange={(e) => set('screen_type', e.target.value as ScreenType)}>{SCREEN_OPTS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
        </Field>
        {f.screen_type === 'elevator' ? <Field label="Kích thước màn"><select value={f.elev} onChange={(e) => set('elev', e.target.value)}>{Object.entries(ELEVATOR_SIZES).map(([k, v]) => <option key={k} value={k}>{k}&quot; · {v.w}×{v.h}</option>)}</select></Field> : null}
        {f.screen_type === 'led' && !base.isExternal ? <Field label="Bảng LED"><select value={f.led} onChange={(e) => set('led', e.target.value)}><option value="">—</option>{leds.data?.items.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.resolution}</option>)}</select></Field> : null}
        <Field label="Tệp creative (đã duyệt)">
          <select value={f.media_id} onChange={(e) => set('media_id', e.target.value)}><option value="">Chưa chọn (tải sau)</option>{media.data?.items.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.width ?? '?'}×{x.height ?? '?'}</option>)}</select>
        </Field>
        {check ? <p role="status" style={{ margin: '6px 0 0', color: check.ok ? 'var(--ok)' : 'var(--bad)', fontSize: 13 }}>{check.message}</p> : null}
        <div className="g g2" style={{ margin: '0' }}>
          <Field label="Ngân sách đề xuất (₫)" hint={`Tối thiểu ${vnd(BUDGET_MIN)}, bội số của ${vnd(BUDGET_STEP)}.`}><input type="number" min={BUDGET_MIN} step={BUDGET_STEP} value={f.budget} onChange={(e) => set('budget', e.target.value)} /></Field>
          <Field label="Thời lượng"><select value={f.duration} onChange={(e) => set('duration', e.target.value)}>{['10', '15', '30', '60'].map((d) => <option key={d} value={d}>{d} giây</option>)}</select></Field>
          <Field label="Ngày bắt đầu"><input type="date" value={f.start} onChange={(e) => set('start', e.target.value)} /></Field>
          <Field label="Ngày kết thúc"><input type="date" value={f.end} min={f.start} onChange={(e) => set('end', e.target.value)} /></Field>
        </div>
        {err ? <p role="alert" style={{ color: 'var(--bad)', margin: '8px 0 0' }}>{err}</p> : null}
        <div className="da" style={{ marginTop: 14 }}>
          <button type="button" className="btn" onClick={onClose}>{t('Hủy')}</button>
          <button type="button" className="btn" onClick={() => void submit(false)}>Lưu nháp</button>
          <button type="submit" className="btn p">{t('Gửi duyệt')}</button>
        </div>
      </form>
    </Dialog>
  );
}

