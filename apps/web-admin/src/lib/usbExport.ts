// Chep goi chuong trinh phat song ra o USB (thu muc ANIO) bang File System Access API; khong ho tro thi tai playlist.json + danh sach lien ket.
import type { UsbPackage } from '../api/schemas';

type DirHandle = {
  getDirectoryHandle(name: string, o?: { create?: boolean }): Promise<DirHandle>;
  getFileHandle(name: string, o?: { create?: boolean }): Promise<{ createWritable(): Promise<{ write(d: BufferSource | Blob | string): Promise<void>; close(): Promise<void> }> }>;
};

export const usbSupported = (): boolean => typeof window !== 'undefined' && typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';

export const playlistText = (pkg: UsbPackage): string => JSON.stringify(pkg.playlist, null, 2);

/** Danh sach "ten tep  lien ket" de chep tay khi trinh duyet khong ghi thang duoc USB. */
export const linksText = (pkg: UsbPackage): string => pkg.files.map((f) => `${f.name}\t${f.url}`).join('\n');

export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

function download(name: string, text: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export async function copyToUsb(pkg: UsbPackage, log: (m: string) => void): Promise<void> {
  if (!usbSupported()) {
    download('playlist.json', playlistText(pkg));
    download('danh-sach-tep.txt', linksText(pkg));
    log('Đã tải playlist.json và danh-sach-tep.txt. Tải từng tệp theo liên kết rồi chép vào thư mục ANIO trên USB (liên kết hết hạn sau 1 giờ).');
    return;
  }
  const root = (await (window as unknown as { showDirectoryPicker: (o: { mode: string }) => Promise<DirHandle> }).showDirectoryPicker({ mode: 'readwrite' }));
  const dir = await root.getDirectoryHandle(pkg.folder || 'ANIO', { create: true });
  let n = 0;
  for (const f of pkg.files) {
    n++;
    log(`(${n}/${pkg.files.length}) Đang tải ${f.name}…`);
    const res = await fetch(f.url);
    if (!res.ok || !res.body) throw new Error(`Không tải được ${f.name} (HTTP ${res.status}).`);
    const blob = await res.blob();
    if (f.sha256) {
      const got = await sha256Hex(await blob.arrayBuffer());
      if (got !== f.sha256.toLowerCase()) throw new Error(`Tệp ${f.name} bị lỗi khi tải (sai mã kiểm tra). Thử lại.`);
    }
    const w = await (await dir.getFileHandle(f.name, { create: true })).createWritable();
    await w.write(blob);
    await w.close();
  }
  const pl = await (await dir.getFileHandle('playlist.json', { create: true })).createWritable();
  await pl.write(playlistText(pkg));
  await pl.close();
  log(`Xong: đã chép ${pkg.files.length} tệp và playlist.json vào thư mục ${pkg.folder || 'ANIO'}. Hãy “Tháo USB an toàn” trước khi rút.`);
}
