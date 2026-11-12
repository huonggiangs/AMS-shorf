import { Field } from './ui';

/** Định dạng quảng cáo (khớp AD_FORMATS của @ams/shared). */
export const AD_FORMAT_OPTIONS: { id: string; label: string }[] = [
  { id: 'fullscreen', label: 'Toàn màn hình' },
  { id: 'menu_banner', label: 'Banner menu' },
  { id: 'l_banner', label: 'Banner chữ L' },
  { id: 'pause_ad', label: 'Quảng cáo khi tạm dừng' },
  { id: 'qr_corner', label: 'QR góc màn hình' },
  { id: 'reward', label: 'Quảng cáo thưởng' },
];

export interface OverlayDraft {
  format: string;
  sponsor_tag: string;
  headline: string;
  hotline_number: string;
  hotline_label: string;
  qr_url: string;
  qr_label: string;
  qr_title: string;
}
export const emptyOverlay = (): OverlayDraft => ({ format: 'fullscreen', sponsor_tag: '', headline: '', hotline_number: '', hotline_label: '', qr_url: '', qr_label: '', qr_title: '' });

/** Trả về `undefined` khi không nhập gì (không gửi overlay); ngược lại là đối tượng đúng lược đồ máy chủ. */
export function overlayPayload(d: OverlayDraft): Record<string, unknown> | undefined {
  const o: Record<string, unknown> = {};
  if (d.sponsor_tag.trim()) o['sponsor_tag'] = d.sponsor_tag.trim();
  if (d.headline.trim()) o['headline'] = d.headline.trim();
  if (d.hotline_number.trim()) o['hotline'] = { number: d.hotline_number.trim(), ...(d.hotline_label.trim() ? { label: d.hotline_label.trim() } : {}) };
  if (d.qr_url.trim()) o['qr'] = { url: d.qr_url.trim(), ...(d.qr_label.trim() ? { label: d.qr_label.trim() } : {}), ...(d.qr_title.trim() ? { title: d.qr_title.trim() } : {}) };
  return Object.keys(o).length ? o : undefined;
}

/** Kiểm tra nhanh phía trình duyệt (máy chủ vẫn kiểm tra lại): QR phải là https, hotline chỉ gồm số/ký hiệu gọi điện. */
export function overlayError(d: OverlayDraft): string | null {
  if (d.qr_url.trim() && !/^https:\/\/\S+$/i.test(d.qr_url.trim())) return 'Liên kết voucher/QR phải bắt đầu bằng https://';
  if (d.hotline_number.trim() && !/^[0-9 .+()-]{5,20}$/.test(d.hotline_number.trim())) return 'Hotline chỉ gồm chữ số, khoảng trắng và + . ( ) -';
  if (d.headline.length > 120) return 'Tiêu đề tối đa 120 ký tự.';
  return null;
}

export function OverlayForm({ value, onChange }: { value: OverlayDraft; onChange: (v: OverlayDraft) => void }) {
  const set = (k: keyof OverlayDraft, v: string) => onChange({ ...value, [k]: v });
  return (
    <fieldset style={{ border: '1px solid var(--line, #e5e7eb)', borderRadius: 12, padding: 12, marginTop: 12 }}>
      <legend style={{ fontSize: 13, color: 'var(--mut)', padding: '0 6px' }}>Định dạng và lớp phủ trên TV (tùy chọn)</legend>
      <Field label="Định dạng quảng cáo">
        <select value={value.format} onChange={(e) => set('format', e.target.value)} aria-label="Định dạng quảng cáo">
          {AD_FORMAT_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </Field>
      <Field label="Nhãn nhà tài trợ"><input value={value.sponsor_tag} maxLength={40} onChange={(e) => set('sponsor_tag', e.target.value)} placeholder="Tài trợ bởi …" /></Field>
      <Field label="Tiêu đề"><input value={value.headline} maxLength={120} onChange={(e) => set('headline', e.target.value)} /></Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Hotline"><input value={value.hotline_number} inputMode="tel" onChange={(e) => set('hotline_number', e.target.value)} placeholder="1900 1234" /></Field>
        <Field label="Nhãn hotline"><input value={value.hotline_label} maxLength={40} onChange={(e) => set('hotline_label', e.target.value)} placeholder="Đặt hàng" /></Field>
      </div>
      <Field label="Liên kết voucher / QR (https)"><input type="url" value={value.qr_url} onChange={(e) => set('qr_url', e.target.value)} placeholder="https://…" /></Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Tiêu đề QR"><input value={value.qr_title} maxLength={60} onChange={(e) => set('qr_title', e.target.value)} placeholder="Quét nhận ưu đãi" /></Field>
        <Field label="Nhãn QR"><input value={value.qr_label} maxLength={40} onChange={(e) => set('qr_label', e.target.value)} /></Field>
      </div>
    </fieldset>
  );
}
