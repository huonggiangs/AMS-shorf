import { useState } from 'react';
import type { Zone } from '../lib/layout';
import { BANKS, fileToDataUrl, qrImageSrc, type QrConfig, type VietQrInput } from '../lib/qr';
import { CITIES, getGps, type WeatherCfg } from '../lib/weather';
import { Field } from './ui';

type SetZ = (patch: Partial<Zone>) => void;
const MODES: { id: QrConfig['mode']; label: string }[] = [
  { id: 'url', label: 'Tạo từ liên kết/nội dung' },
  { id: 'vietqr', label: 'VietQR (chuyển khoản)' },
  { id: 'image', label: 'Tải ảnh QR' },
];

/** Thuoc tinh vung Ma QR: tai anh QR, tao QR tu URL/noi dung ngay tren web, hoac VietQR (anh cong khai img.vietqr.io). */
export function QrEditor({ zone, set }: { zone: Zone; set: SetZ }) {
  const qr: QrConfig = (zone.qr as QrConfig | null | undefined) ?? { mode: 'url', value: zone.url ?? '' };
  const [msg, setMsg] = useState('');
  const vq: VietQrInput = qr.vietqr ?? { bin: BANKS[0]!.bin, account: '' };
  const put = (next: QrConfig) => set({ qr: next, ...(next.mode === 'url' ? { url: next.value ?? '' } : {}) });
  const setVq = (p: Partial<VietQrInput>) => put({ mode: 'vietqr', vietqr: { ...vq, ...p } });
  const src = qrImageSrc(qr, zone.url);
  return (
    <div role="group" aria-label="Mã QR">
      <Field label="Kiểu mã QR">
        <select value={qr.mode} onChange={(e) => { const m = e.target.value as QrConfig['mode']; put(m === 'vietqr' ? { mode: m, vietqr: vq } : { mode: m, value: m === 'url' ? zone.url ?? '' : undefined }); }}>
          {MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </Field>
      {qr.mode === 'url' ? <Field label="Liên kết hoặc nội dung"><input maxLength={500} value={qr.value ?? ''} placeholder="https://anio.vn" onChange={(e) => put({ mode: 'url', value: e.target.value })} /></Field> : null}
      {qr.mode === 'vietqr' ? (
        <>
          <Field label="Ngân hàng">
            <select value={BANKS.some((b) => b.bin === vq.bin) ? vq.bin : 'other'} onChange={(e) => setVq({ bin: e.target.value === 'other' ? '' : e.target.value })}>
              {BANKS.map((b) => <option key={b.bin} value={b.bin}>{b.name} ({b.bin})</option>)}
              <option value="other">Khác (nhập mã BIN)</option>
            </select>
          </Field>
          {!BANKS.some((b) => b.bin === vq.bin) ? <Field label="Mã BIN (6 số)"><input inputMode="numeric" maxLength={6} value={vq.bin} onChange={(e) => setVq({ bin: e.target.value.replace(/\D/g, '') })} /></Field> : null}
          <Field label="Số tài khoản"><input maxLength={24} value={vq.account} onChange={(e) => setVq({ account: e.target.value.replace(/[^0-9A-Za-z]/g, '') })} /></Field>
          <Field label="Tên chủ tài khoản"><input maxLength={60} value={vq.name ?? ''} onChange={(e) => setVq({ name: e.target.value })} /></Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Field label="Số tiền (tuỳ chọn)"><input type="number" min={0} value={vq.amount ?? ''} onChange={(e) => setVq({ amount: e.target.value ? Math.floor(Number(e.target.value)) : undefined })} /></Field>
            <Field label="Nội dung chuyển khoản"><input maxLength={50} value={vq.memo ?? ''} onChange={(e) => setVq({ memo: e.target.value })} /></Field>
          </div>
          <p style={{ color: 'var(--mut)', fontSize: 12, margin: '0 0 6px' }}>Ảnh QR lấy từ dịch vụ công khai img.vietqr.io (cần mạng khi xem trước và khi thiết bị tải).</p>
        </>
      ) : null}
      {qr.mode === 'image' ? (
        <Field label="Ảnh QR (PNG/JPG/WEBP/SVG, tối đa 200 KB)">
          <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            fileToDataUrl(f).then((d) => { setMsg(''); put({ mode: 'image', value: d }); }).catch((er: Error) => setMsg(er.message));
          }} />
        </Field>
      ) : null}
      {msg ? <p role="alert" style={{ color: '#b91c1c', fontSize: 12 }}>{msg}</p> : null}
      {src ? <img src={src} alt="Xem trước mã QR" style={{ width: 96, height: 96, objectFit: 'contain', background: '#fff', border: '1px solid var(--line, #e5e7eb)', borderRadius: 6 }} /> : null}
    </div>
  );
}

/** Thuoc tinh vung Thoi tiet: vi tri GPS hoac dia diem co dinh (Open-Meteo, khong can khoa). */
export function WeatherEditor({ zone, set }: { zone: Zone; set: SetZ }) {
  const w: WeatherCfg = (zone.weather as WeatherCfg | null | undefined) ?? { mode: 'fixed', lat: CITIES[0]!.lat, lon: CITIES[0]!.lon, label: CITIES[0]!.label };
  const [msg, setMsg] = useState('');
  const put = (p: Partial<WeatherCfg>) => set({ weather: { ...w, ...p } });
  const city = CITIES.find((c) => c.lat === w.lat && c.lon === w.lon)?.label ?? 'custom';
  return (
    <div role="group" aria-label="Thời tiết">
      <Field label="Nguồn vị trí">
        <select value={w.mode} onChange={(e) => put({ mode: e.target.value as WeatherCfg['mode'] })}>
          <option value="fixed">Địa điểm cố định</option>
          <option value="gps">Tự động theo GPS (thiết bị/trình duyệt)</option>
        </select>
      </Field>
      <Field label={w.mode === 'gps' ? 'Địa điểm dự phòng (khi không có GPS)' : 'Thành phố'}>
        <select value={city} onChange={(e) => { const c = CITIES.find((x) => x.label === e.target.value); if (c) put({ lat: c.lat, lon: c.lon, label: c.label }); }}>
          {CITIES.map((c) => <option key={c.label} value={c.label}>{c.label}</option>)}
          <option value="custom">Tọa độ tuỳ chọn</option>
        </select>
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Field label="Vĩ độ"><input type="number" step="0.0001" min={-90} max={90} value={w.lat ?? ''} onChange={(e) => put({ lat: e.target.value === '' ? undefined : Number(e.target.value) })} /></Field>
        <Field label="Kinh độ"><input type="number" step="0.0001" min={-180} max={180} value={w.lon ?? ''} onChange={(e) => put({ lon: e.target.value === '' ? undefined : Number(e.target.value) })} /></Field>
      </div>
      <Field label="Tên hiển thị"><input maxLength={60} value={w.label ?? ''} onChange={(e) => put({ label: e.target.value })} /></Field>
      <button type="button" className="btn sm" onClick={() => { setMsg('Đang lấy vị trí…'); getGps().then((p) => { setMsg(''); put({ lat: Math.round(p.lat * 1e4) / 1e4, lon: Math.round(p.lon * 1e4) / 1e4, label: w.label || 'Vị trí hiện tại' }); }).catch((e: Error) => setMsg(e.message)); }}>📍 Dùng vị trí của tôi</button>
      {msg ? <p style={{ fontSize: 12, color: 'var(--mut)' }}>{msg}</p> : null}
      <p style={{ color: 'var(--mut)', fontSize: 12 }}>Dữ liệu từ Open-Meteo, tự làm mới mỗi 10 phút.</p>
    </div>
  );
}
