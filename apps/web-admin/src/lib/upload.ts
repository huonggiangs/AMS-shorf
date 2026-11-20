// Gui tep len kho (3 duong: proxy qua Worker, tung phan, URL ky truc tiep) + dinh dang dung luong. Tach rieng khoi trang Media de hop thoai tai len dung chung.
import { errMsg, putBlob } from '../api/client';
import { uploadMultipart, type MultipartOptions } from './multipart';

export const fmtBytes = (n: number): string => (n >= 1073741824 ? `${(n / 1073741824).toFixed(2)} GB` : `${(n / 1048576).toFixed(1)} MB`);

/** Che chu ky/tham so cua URL ky truoc khi ghi console (chi giu origin + duong dan). */
export function redactUrl(raw: string): string {
  try {
    const x = new URL(raw, window.location.origin);
    return `${x.origin}${x.pathname}${x.search ? '?…' : ''}`;
  } catch {
    return '(url?)';
  }
}

/**
 * Gui tep len kho. `via='proxy'` (mac dinh tren Cloudflare khi chua co khoa S3): PUT cung origin toi API (phien + CSRF), khong can CORS.
 * `via='multipart'`: tep > 90 MB, tai TUNG PHAN (<= 32 MiB) tuan tu qua API, thu lai 3 lan/phan, hien tien do, huy duoc (lib/multipart.ts).
 * `via='direct'`: PUT toi URL ky cua R2. Loi co ma ngan de chan doan: UP-NET (mang/CORS), UP-403 (kho tu choi chu ky/khoa), UP-<status>, UP-PART-<n>-<status>, hoac ma loi cua API.
 */
export async function uploadToStore(mediaBase: string, u: { id: string; url: string; method?: string | undefined; headers?: Record<string, string> | undefined; via?: 'direct' | 'proxy' | 'multipart' | undefined }, file: File, opts: MultipartOptions = {}): Promise<void> {
  if (u.via === 'multipart') {
    await uploadMultipart(mediaBase, u.id, file, opts);
    return;
  }
  if (u.via === 'proxy') {
    try {
      await putBlob(`${mediaBase}/${u.id}/content`, file);
    } catch (e) {
      console.error('[upload] proxy that bai', { via: 'proxy', target: `${mediaBase}/${u.id}/content`, status: (e as { status?: number }).status, code: (e as { code?: string }).code });
      const code = (e as { code?: string }).code ?? 'UP-NET';
      throw new Error(`${errMsg(e)} (mã ${code})`);
    }
    return;
  }
  let put: Response;
  try {
    put = await fetch(u.url, { method: u.method ?? 'PUT', headers: { 'Content-Type': file.type, ...(u.headers ?? {}) }, body: file });
  } catch (e) {
    console.error('[upload] khong ket noi duoc kho', { via: 'direct', target: redactUrl(u.url), error: (e as Error).message });
    throw new Error('Không tải được tệp lên kho lưu trữ (mất kết nối hoặc kho chưa cho phép tải từ trình duyệt: CORS). Kiểm tra mạng và thử lại; nếu vẫn lỗi, báo quản trị cấu hình CORS cho kho R2. (mã UP-NET)');
  }
  if (!put.ok) {
    console.error('[upload] kho tu choi', { via: 'direct', target: redactUrl(u.url), status: put.status });
    throw new Error(put.status === 403 ? 'Kho từ chối chữ ký/khóa tải lên (mã UP-403). Nếu bạn chọn tệp từ hơn 15 phút trước, hãy tải lại; nếu vẫn lỗi, báo quản trị kiểm tra khóa R2.' : `Tải lên kho lưu trữ thất bại (mã UP-${put.status}).`);
  }
}

