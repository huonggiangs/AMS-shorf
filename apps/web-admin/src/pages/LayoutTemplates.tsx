import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { listOf } from '../api/schemas';
import { useAct } from '../api/hooks';
import { useAuth } from '../auth/AuthProvider';
import { Btn, EmptyBlock, ErrorBlock, Field, LoadingBlock, Note, PageHead } from '../components/ui';
import { Dialog } from '../components/Dialog';
import { LivePreview } from '../components/LivePreview';
import { ZoneEditor } from '../components/ZoneEditor';
import { flattenZones } from '../lib/groups';
import { PRESETS, zoneName, layoutError, templateSchema, type LayoutTemplate, type Orientation, type Zone } from '../lib/layout';
import { useT } from '../i18n';

const BASE = '/admin/v1/layout-templates';

/** Mẫu bố cục đa vùng (video chính, ảnh phụ, chữ chạy, đồng hồ, thời tiết, QR) để dùng lại cho nhiều chương trình phát sóng. */
export default function LayoutTemplates() {
  const { can } = useAuth();
  const act = useAct();
  const [edit, setEdit] = useState<LayoutTemplate | 'new' | null>(null);
  const nav = useNavigate();
  const q = useQuery({ queryKey: [BASE], queryFn: () => api.get(BASE, { query: { page_size: 100 }, schema: listOf(templateSchema) }) });
  const canWrite = can('schedule', 'write');
  const canDelete = can('schedule', 'delete');
  // tao chuong trinh phat song (ban nhap) tu mau: doc -> thang may, ngang -> TV; chon tep o trang Chuong trinh phat song
  const useTemplate = async (t: LayoutTemplate) => {
    const r = await act(() => api.post('/admin/v1/broadcast', { body: { name: `${t.name} (nháp)`, target_type: t.orientation === 'portrait' ? 'elevator' : 'tv', layout: { template_id: t.id, orientation: t.orientation, zones: t.zones }, creative_ids: [] } }), 'Đã tạo chương trình nháp từ mẫu. Thêm tệp vào từng vùng rồi xuất bản.');
    if (r !== undefined) nav('/broadcast');
  };
  return (
    <>
      <PageHead eyebrow="Phát sóng nội bộ" title="Mẫu bố cục" sub="Thiết kế khung hiển thị nhiều vùng (video chính, ảnh phụ, chữ chạy, đồng hồ...) theo phần trăm màn hình rồi dùng lại khi tạo chương trình phát sóng." actions={canWrite ? <Btn tone="p" icon="plus" onClick={() => setEdit('new')}>Tạo mẫu bố cục</Btn> : null} />
      {q.isLoading ? <LoadingBlock /> : q.isError ? <ErrorBlock error={q.error} onRetry={() => void q.refetch()} /> : !q.data?.items.length ? <EmptyBlock>Chưa có mẫu bố cục nào. Bấm “Tạo mẫu bố cục” để bắt đầu từ mẫu có sẵn.</EmptyBlock> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
          {q.data.items.map((t) => (
            <div key={t.id} className="card cp">
              <div style={{ height: 150, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
                <MiniLayout orientation={t.orientation} zones={t.zones} />
              </div>
              <b>{t.name}</b>{t.system ? <span style={{ color: 'var(--mut)', fontSize: 12 }}> · Mẫu hệ thống</span> : null}
              <div style={{ color: 'var(--mut)', fontSize: 12 }}>{t.orientation === 'portrait' ? 'Dọc 9:16' : 'Ngang 16:9'} · {t.zones.length} vùng: {t.zones.map((z, i) => zoneName(z, i)).join(' · ')}</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                {canWrite ? <button type="button" className="btn sm p" onClick={() => void useTemplate(t)}>Sử dụng mẫu này</button> : null}
                {canWrite && !t.system ? <button type="button" className="btn sm" onClick={() => setEdit(t)}>Sửa</button> : null}
                {canDelete && !t.system ? <button type="button" className="btn sm d" onClick={() => { if (window.confirm(`Xóa mẫu "${t.name}"? Chương trình đã dùng mẫu này vẫn giữ bố cục đã chép.`)) void act(() => api.del(`${BASE}/${t.id}`), 'Đã xóa mẫu.'); }}>Xóa</button> : null}
              </div>
            </div>
          ))}
        </div>
      )}
      <Note>Bố cục được chép vào chương trình lúc chọn, nên sửa hoặc xóa mẫu không làm đổi chương trình đang phát.</Note>
      {edit ? <TemplateDialog key={edit === 'new' ? 'new' : edit.id} tpl={edit === 'new' ? null : edit} onClose={() => setEdit(null)} /> : null}
    </>
  );
}

function MiniLayout({ orientation, zones }: { orientation: Orientation; zones: Zone[] }) {
  return (
    <div style={{ position: 'relative', height: '100%', aspectRatio: orientation === 'portrait' ? '9 / 16' : '16 / 9', maxWidth: '100%', background: '#111827', borderRadius: 4 }}>
      {flattenZones(zones).map((z) => <div key={z.id} style={{ position: 'absolute', left: `${z.x}%`, top: `${z.y}%`, width: `${z.w}%`, height: `${z.h}%`, background: z.type === 'marquee' ? '#DC2626AA' : z.type === 'video' ? '#2563EBAA' : z.type === 'image' ? '#059669AA' : '#7C3AEDAA', border: '1px solid #fff6', boxSizing: 'border-box' }} />)}
    </div>
  );
}

function TemplateDialog({ tpl, onClose }: { tpl: LayoutTemplate | null; onClose: () => void }) {
  const t = useT();
  const act = useAct();
  const [name, setName] = useState(tpl?.name ?? '');
  const [orientation, setOrientation] = useState<Orientation>(tpl?.orientation ?? 'landscape');
  const [zones, setZones] = useState<Zone[]>(tpl?.zones ?? PRESETS[2]!.zones);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const err = layoutError(zones);
  const applyPreset = (id: string) => {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    if (zones.length > 0 && tpl === null && !window.confirm('Thay các vùng hiện tại bằng mẫu có sẵn này?')) return;
    setOrientation(p.orientation);
    setZones(p.zones.map((z) => ({ ...z })));
    setSelected(null);
  };
  const submit = async () => {
    const body = { name: name.trim(), orientation, zones: zones.map((z) => ({ ...z, name: z.name?.trim() ? z.name.trim() : undefined })) };
    const r = await act(() => (tpl ? api.put(`${BASE}/${tpl.id}`, { body }) : api.post(BASE, { body })), tpl ? 'Đã lưu mẫu bố cục.' : 'Đã tạo mẫu bố cục.');
    if (r !== undefined) onClose();
  };
  return (
    <Dialog open onClose={onClose} size="xl" label="Mẫu bố cục">
      <form onSubmit={(e) => { e.preventDefault(); if (!err) void submit(); }}>
        <h2 style={{ margin: '0 0 10px', fontSize: 18 }}>{tpl ? 'Sửa mẫu bố cục' : 'Tạo mẫu bố cục'}</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 2fr', gap: 10 }}>
          <Field label="Tên mẫu"><input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Hướng màn hình"><select value={orientation} onChange={(e) => setOrientation(e.target.value as Orientation)}><option value="landscape">Ngang 16:9</option><option value="portrait">Dọc 9:16</option></select></Field>
          <Field label="Bắt đầu từ mẫu có sẵn"><select value="" onChange={(e) => applyPreset(e.target.value)}><option value="">— chọn —</option>{PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        </div>
        <ZoneEditor orientation={orientation} zones={zones} onChange={setZones} selected={selected} onSelect={setSelected} />
        {err ? <p role="alert" style={{ color: 'var(--bad, #c0392b)' }}>{err}</p> : null}
        {preview ? <div style={{ marginTop: 12 }}><LivePreview orientation={orientation} zones={zones} items={[]} /></div> : null}
        <div className="da" style={{ marginTop: 14 }}>
          <button type="button" className="btn" onClick={() => setPreview((p) => !p)}>{preview ? 'Ẩn xem trước' : 'Xem trước bố cục'}</button>
          <button type="button" className="btn" onClick={onClose}>{t('Hủy')}</button>
          <button className="btn p" type="submit" disabled={!!err || !name.trim()}>{t('Lưu')}</button>
        </div>
      </form>
    </Dialog>
  );
}
