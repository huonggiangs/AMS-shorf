// Tao ma QR ngay tren trinh duyet (khong goi dich vu ngoai) + URL anh VietQR cong khai (img.vietqr.io, khong can khoa API).
import qrcode from 'qrcode-generator';

export interface VietQrInput { bin: string; account: string; name?: string; amount?: number; memo?: string; template?: 'compact' | 'compact2' | 'qr_only' | 'print' }
export interface QrConfig { mode: 'image' | 'url' | 'vietqr'; value?: string; vietqr?: VietQrInput }

export const BANKS: { bin: string; name: string }[] = [
  { bin: '970436', name: 'Vietcombank' }, { bin: '970415', name: 'VietinBank' }, { bin: '970418', name: 'BIDV' }, { bin: '970405', name: 'Agribank' },
  { bin: '970422', name: 'MB Bank' }, { bin: '970407', name: 'Techcombank' }, { bin: '970416', name: 'ACB' }, { bin: '970432', name: 'VPBank' },
  { bin: '970403', name: 'Sacombank' }, { bin: '970423', name: 'TPBank' }, { bin: '970441', name: 'VIB' }, { bin: '970443', name: 'SHB' },
  { bin: '970437', name: 'HDBank' }, { bin: '970448', name: 'OCB' }, { bin: '970426', name: 'MSB' },
];
export const MAX_QR_IMAGE_BYTES = 200 * 1024;

export function vietqrUrl(v: VietQrInput): string {
  const q = new URLSearchParams();
  if (v.amount) q.set('amount', String(v.amount));
  if (v.memo) q.set('addInfo', v.memo);
  if (v.name) q.set('accountName', v.name);
  const qs = q.toString();
  return `https://img.vietqr.io/image/${v.bin}-${v.account}-${v.template ?? 'qr_only'}.png${qs ? `?${qs}` : ''}`;
}

/** QR thuong (URL/van ban) -> data URL SVG, tao tai cho. */
export function qrSvgDataUrl(text: string, cell = 4): string {
  const qr = qrcode(0, 'M');
  qr.addData(text || ' ');
  qr.make();
  const svg = qr.createSvgTag({ cellSize: cell, margin: 2, scalable: true });
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** Nguon anh de ve vung QR (xem truoc): null = chua nhap du lieu. */
export function qrImageSrc(qr: QrConfig | undefined, legacyUrl?: string | null): string | null {
  if (!qr) return legacyUrl ? qrSvgDataUrl(legacyUrl) : null;
  if (qr.mode === 'vietqr') return qr.vietqr?.bin && qr.vietqr.account ? vietqrUrl(qr.vietqr) : null;
  if (qr.mode === 'image') return qr.value || null;
  return qr.value ? qrSvgDataUrl(qr.value) : null;
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpe?g|webp|svg\+xml)$/.test(file.type)) return reject(new Error('Chỉ nhận ảnh PNG, JPG, WEBP hoặc SVG.'));
    if (file.size > MAX_QR_IMAGE_BYTES) return reject(new Error('Ảnh QR tối đa 200 KB.'));
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Không đọc được tệp.'));
    r.readAsDataURL(file);
  });
}
