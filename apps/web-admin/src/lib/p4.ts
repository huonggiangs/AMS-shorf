// Hang so va nhan tieng Viet cho cac trang phap ly / hoa don / cong no / tuan thu (p4). Khop @ams/shared compliance.
import { z } from 'zod';
import { api } from '../api/client';

/** Hang bat ky (phan hoi server co them cot; khong rang buoc hinh dang). */
export const anyRow = z.object({}).passthrough();
export type Row = Record<string, unknown>;
export const s = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
export const n = (v: unknown): number => Number(v ?? 0) || 0;

export const LEGAL_KIND_LABEL: Record<string, string> = { terms: 'Điều khoản sử dụng', privacy: 'Chính sách bảo mật', sla: 'Cam kết dịch vụ (SLA)' };
export const LEGAL_STATUS_LABEL: Record<string, { label: string; tone: 'ok' | 'info' | 'warn' | 'bad' }> = {
  draft: { label: 'Bản nháp', tone: 'warn' }, published: { label: 'Đang phát hành', tone: 'ok' }, retired: { label: 'Đã gỡ', tone: 'info' },
};
export const EINVOICE_STATUS: Record<string, { label: string; tone: 'ok' | 'info' | 'warn' | 'bad' }> = {
  pending: { label: 'Đang chờ', tone: 'warn' }, issued: { label: 'Đã phát hành', tone: 'ok' }, failed: { label: 'Lỗi', tone: 'bad' }, cancelled: { label: 'Đã hủy', tone: 'info' }, rejected: { label: 'Bị từ chối', tone: 'bad' },
};
export const EINVOICE_KIND: Record<string, string> = { original: 'Hóa đơn gốc', adjustment: 'Hóa đơn điều chỉnh', cancellation: 'Chứng từ hủy' };
export const PROVIDER_LABEL: Record<string, string> = { manual: 'Thủ công (kế toán nhập số hóa đơn)', misa: 'MISA meInvoice', viettel: 'Viettel S-Invoice' };
export const RECV_STATE: Record<string, { label: string; tone: 'ok' | 'info' | 'warn' | 'bad' }> = {
  open: { label: 'Chưa đến hạn', tone: 'info' }, overdue: { label: 'Quá hạn', tone: 'bad' }, partial: { label: 'Thanh toán một phần', tone: 'warn' }, paid: { label: 'Đã thanh toán', tone: 'ok' },
};
export const DUNNING_KIND: Record<string, string> = {
  reminder: 'Nhắc thanh toán', overdue: 'Đánh dấu quá hạn', auto_pause: 'Tự động tạm dừng chiến dịch', low_balance: 'Cảnh báo số dư thấp', einvoice_adjust: 'Hóa đơn điều chỉnh',
};
export const KYC_STATE: Record<string, { label: string; tone: 'ok' | 'info' | 'warn' | 'bad' }> = {
  none: { label: 'Chưa nộp', tone: 'info' }, draft: { label: 'Đang soạn', tone: 'info' }, submitted: { label: 'Chờ duyệt', tone: 'warn' }, approved: { label: 'Đã duyệt', tone: 'ok' }, rejected: { label: 'Bị từ chối', tone: 'bad' },
};
export const KYC_DOC_LABEL: Record<string, string> = {
  business_registration: 'Giấy chứng nhận đăng ký doanh nghiệp', industry_licence: 'Giấy phép ngành nghề', ad_content_permit: 'Giấy xác nhận nội dung quảng cáo', authorization_letter: 'Giấy ủy quyền', other: 'Khác',
};
export const KYC_DOC_STATE: Record<string, { label: string; tone: 'ok' | 'info' | 'warn' | 'bad' }> = {
  pending: { label: 'Chờ duyệt', tone: 'warn' }, approved: { label: 'Đã duyệt', tone: 'ok' }, rejected: { label: 'Từ chối', tone: 'bad' },
};
export const AD_CATEGORY_LABEL: Record<string, string> = {
  general: 'Chung', food_beverage: 'Ăn uống', retail: 'Bán lẻ', real_estate: 'Bất động sản', education: 'Giáo dục', automotive: 'Ô tô - xe máy', technology: 'Công nghệ', entertainment: 'Giải trí',
  finance_banking: 'Tài chính - ngân hàng', health_pharma: 'Y tế - dược', supplement: 'Thực phẩm chức năng', alcohol: 'Rượu bia', tobacco: 'Thuốc lá', gambling: 'Cá cược - cờ bạc',
  loan_credit: 'Vay tiêu dùng', adult: 'Nội dung người lớn', political_religious: 'Chính trị - tôn giáo',
};
export const RESTRICTED_CATEGORIES = ['finance_banking', 'health_pharma', 'supplement', 'alcohol', 'tobacco', 'gambling', 'loan_credit', 'adult', 'political_religious'];
export const DSR_STATE: Record<string, { label: string; tone: 'ok' | 'info' | 'warn' | 'bad' }> = {
  requested: { label: 'Chờ xử lý', tone: 'warn' }, completed: { label: 'Đã hoàn tất', tone: 'ok' }, rejected: { label: 'Đã từ chối', tone: 'bad' },
};
export const DSR_KIND: Record<string, string> = { export: 'Xuất dữ liệu', anonymize: 'Ẩn danh (xóa)' };
export const SUBJECT_TYPE: Record<string, string> = { customer_contact: 'Người liên hệ / tài khoản khách hàng', end_user: 'Người xem (end-user)' };

/** Tai ve mot doi tuong JSON (xuat du lieu chu the): khong luu o dau khac. */
export function downloadJson(name: string, data: unknown): void {
  try {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    /* moi truong khong ho tro tai tep */
  }
}

/** Tai tep len URL da ky (PUT) roi xac nhan; dung cho ho so KYC. */
export async function uploadKycFile(base: string, file: File, meta: { doc_type: string; category?: string; expires_on?: string }): Promise<void> {
  const u = (await api.post(`${base}/documents/upload-url`, { body: { ...meta, file_name: file.name, content_type: file.type || 'application/octet-stream', size_bytes: file.size } })) as { id: string; url: string; method?: string; headers?: Record<string, string> };
  const put = await fetch(u.url, { method: u.method ?? 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream', ...(u.headers ?? {}) }, body: file });
  if (!put.ok) throw new Error(`Tải lên kho lưu trữ thất bại (${put.status}).`);
  await api.post(`${base}/documents/${u.id}/confirm`);
}
