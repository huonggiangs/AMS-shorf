import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { campaignSchema, listOf, partnerSchema, slotSchema, type Slot } from '../api/schemas';
import { useAct } from '../api/hooks';
import { useAuth } from '../auth/AuthProvider';
import { Btn, EmptyBlock, ErrorBlock, Field, LoadingBlock, Note, PageHead } from '../components/ui';
import { Dialog } from '../components/Dialog';
import { useT } from '../i18n';
import { fmtMin, num } from '../lib/format';

const COLORS = ['#005BBF', '#059669', '#D97706', '#0284C7', '#0F172A', '#64748B'];
export const STEP = 30;
/** Snap minutes to the 30-minute grid and keep the block inside the day. */
export const snapMove = (start: number, end: number, deltaMin: number): [number, number] => {
  const len = end - start;
  let s = Math.round((start + deltaMin) / STEP) * STEP;
  s = Math.max(0, Math.min(1440 - len, s));
  return [s, s + len];
};

export default function Schedule() {
  const t = useT();
  const { can } = useAuth();
  const act = useAct();
  const qc = useQueryClient();
  const [add, setAdd] = useState(false);
  const slots = useQuery({ queryKey: ['/admin/v1/schedule'], queryFn: () => api.get('/admin/v1/schedule', { query: { page_size: 200 }, schema: listOf(slotSchema) }) });
  const partners = useQuery({ queryKey: ['/admin/v1/partners', 'cards'], queryFn: () => api.get('/admin/v1/partners', { query: { page_size: 50 }, schema: listOf(partnerSchema) }) });
  const canWrite = can('schedule', 'write');
  const save = (s: Slot, a: number, b: number) => act(() => api.put(`/admin/v1/schedule/${s.id}`, { body: { start_min: a, end_min: b } }), `Đã đổi giờ phát: ${fmtMin(a)}–${fmtMin(b)}`);
  return (
    <>
      <PageHead eyebrow="SmartTV programmatic CMS / 24h schedule grid" title="Lịch phát" sub="Phân phối khung giờ, tích hợp sàn đấu thầu programmatic RTB và mạng lưới Digital OOH." actions={canWrite ? <Btn tone="p" icon="plus" onClick={() => setAdd(true)}>Tạo lịch phát mới</Btn> : null} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '6px 0 12px', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: 17, margin: 0 }}>Mạng lưới đối tác & API ingestion RTB</h2>
      </div>
      {partners.isLoading ? <LoadingBlock /> : partners.isError ? <ErrorBlock error={partners.error} /> : !partners.data?.items.length ? <EmptyBlock /> : (
        <div className="g g4">
          {partners.data.items.map((p) => (
            <div className="card pnr" key={p.id}>
              <div className="top2"><b className="t3">{p.name}</b>
                <input type="checkbox" className="tgl" aria-label={`bật ${p.name}`} checked={!!p.enabled} disabled={!can('partners', 'write')} onChange={(e) => void act(() => api.put(`/admin/v1/partners/${p.id}`, { body: { enabled: e.target.checked } }), undefined, ['/admin/v1/partners'])} /></div>
              <div className="mono" style={{ color: 'var(--mut)', fontSize: 12, marginTop: 2 }}>{p.protocol ?? '—'}</div>
              <div className="mt"><div><span>eCPM</span><strong>{p.ecpm_vnd ? `${num(p.ecpm_vnd)} đ` : '—'}</strong></div><div><span>Tỷ lệ lấp</span><strong>{p.fill_rate != null ? `${p.fill_rate}%` : '—'}</strong></div></div>
              <div className={`st ${p.enabled ? '' : 'off'}`} style={{ marginTop: 12 }}><i style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />{p.status}</div>
            </div>
          ))}
        </div>
      )}
      <div className="card cp" style={{ margin: '18px 0' }}>
        <div className="ch"><div><h2>Khung giờ phát mặc định</h2><p>P1 06:00–08:30 · P2 11:30–13:30 · Prime 18:00–21:30 · P3 21:30–23:00</p></div>
          <div className="lg" style={{ margin: 0 }}><span><i style={{ background: '#005BBF' }} />Ưu tiên 1 (P1)</span><span><i style={{ background: '#059669' }} />Ưu tiên 2 (P2)</span><span><i style={{ background: '#D97706' }} />Giờ vàng prime</span></div></div>
        <div className="slotbar" style={{ ['--cols' as string]: '2.5fr 3fr 2fr 3.5fr 1.5fr' }}>
          <div style={{ background: '#005BBF' }}><span className="mono">06:00–08:30 · P1</span></div>
          <div style={{ background: '#059669' }}><span className="mono">11:30–13:30 · P2</span></div>
          <div style={{ background: '#E2E8F0', color: '#475569' }}><span className="mono">13:30–18:00</span></div>
          <div style={{ background: '#D97706' }}><span className="mono">18:00–21:30 · PRIME</span></div>
          <div style={{ background: '#0F172A' }}><span className="mono">21:30–23:00 · P3</span></div>
        </div>
      </div>
      <div className="card cp" style={{ marginBottom: 18 }}>
        <div className="ch"><div><h2>Timeline kéo thả</h2><p>{t('Kéo khối để đổi giờ phát')} · bước 30 phút · Asia/Ho_Chi_Minh</p></div></div>
        {slots.isLoading ? <LoadingBlock /> : slots.isError ? <ErrorBlock error={slots.error} onRetry={() => void slots.refetch()} /> : !slots.data?.items.length ? <EmptyBlock>Chưa có lịch phát nào.</EmptyBlock> : (
          <Timeline slots={slots.data.items} canWrite={canWrite} onCommit={(s, a, b) => void save(s, a, b)} onPreview={(id, a, b) => qc.setQueryData<{ items: Slot[] }>(['/admin/v1/schedule'], (o) => { return o ? { ...o, items: o.items.map((x) => (x.id === id ? { ...x, start_min: a, end_min: b } : x)) } : o; })} />
        )}
      </div>
      <Note>Doanh thu theo giờ và giám sát thiết bị trực tiếp sẽ hiện khi máy chủ cung cấp điểm cuối tương ứng.</Note>
      <NewSlot open={add} onClose={() => setAdd(false)} />
    </>
  );
}

export function Timeline({ slots, canWrite, onCommit, onPreview }: { slots: Slot[]; canWrite: boolean; onCommit: (s: Slot, a: number, b: number) => void; onPreview: (id: string, a: number, b: number) => void }) {
  const drag = useRef<{ s: Slot; x0: number; w: number; a0: number; b0: number; cur: [number, number] } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  return (
    <div className="tl"><div className="tl-inner">
      <div className="tlh"><span /><div className="tlt">{Array.from({ length: 24 }, (_, i) => <span key={i}>{i}h</span>)}</div></div>
      {slots.map((s, i) => (
        <div className="tlr" key={s.id}>
          <div style={{ fontSize: 14, paddingRight: 10 }}>{s.name}</div>
          <div className="lane" data-lane>
            <div
              className={`blk ${dragging === s.id ? 'drag' : ''}`}
              role="slider" aria-label={`${s.name} ${fmtMin(s.start_min)}–${fmtMin(s.end_min)}`} aria-valuemin={0} aria-valuemax={1440} aria-valuenow={s.start_min} tabIndex={0}
              style={{ left: `${(s.start_min / 1440) * 100}%`, width: `${((s.end_min - s.start_min) / 1440) * 100}%`, background: COLORS[(s.color ?? i) % COLORS.length], touchAction: 'none' }}
              onPointerDown={(e) => {
                if (!canWrite) return;
                const lane = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
                (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                drag.current = { s, x0: e.clientX, w: lane.width, a0: s.start_min, b0: s.end_min, cur: [s.start_min, s.end_min] };
                setDragging(s.id);
              }}
              onPointerMove={(e) => {
                const d = drag.current;
                if (!d) return;
                d.cur = snapMove(d.a0, d.b0, ((e.clientX - d.x0) / d.w) * 1440);
                onPreview(d.s.id, d.cur[0], d.cur[1]);
              }}
              onPointerUp={() => {
                const d = drag.current;
                drag.current = null;
                setDragging(null);
                if (d && (d.cur[0] !== d.a0 || d.cur[1] !== d.b0)) onCommit(d.s, d.cur[0], d.cur[1]);
              }}
              onKeyDown={(e) => {
                if (!canWrite || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
                e.preventDefault();
                const [a, b] = snapMove(s.start_min, s.end_min, e.key === 'ArrowLeft' ? -STEP : STEP);
                if (a !== s.start_min) { onPreview(s.id, a, b); onCommit(s, a, b); }
              }}
            >{fmtMin(s.start_min)}–{fmtMin(s.end_min)}</div>
          </div>
        </div>
      ))}
    </div></div>
  );
}

function NewSlot({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const act = useAct();
  const [f, setF] = useState({ campaign_id: '', start: '18:00', end: '21:00' });
  const camps = useQuery({ queryKey: ['/admin/v1/campaigns', 'pick-active'], enabled: open, queryFn: () => api.get('/admin/v1/campaigns', { query: { page_size: 100 }, schema: listOf(campaignSchema) }) });
  const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return (h ?? 0) * 60 + (m ?? 0); };
  return (
    <Dialog open={open} onClose={onClose} label="Tạo lịch phát">
      <form onSubmit={async (e) => { e.preventDefault(); const a = toMin(f.start), b = toMin(f.end); if (b <= a) return; const r = await act(() => api.post('/admin/v1/schedule', { body: { campaign_id: f.campaign_id, start_min: a, end_min: b } }), 'Đã tạo lịch phát.'); if (r !== undefined) onClose(); }}>
        <h2 style={{ margin: '0 0 10px', fontSize: 18 }}>Tạo lịch phát</h2>
        <Field label="Chiến dịch"><select required value={f.campaign_id} onChange={(e) => setF({ ...f, campaign_id: e.target.value })}><option value="">—</option>{camps.data?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Bắt đầu"><input type="time" step={1800} value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></Field>
        <Field label="Kết thúc"><input type="time" step={1800} value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></Field>
        <div className="da" style={{ marginTop: 14 }}><button type="button" className="btn" onClick={onClose}>{t('Hủy')}</button><button className="btn p" type="submit">{t('Lưu')}</button></div>
      </form>
    </Dialog>
  );
}
