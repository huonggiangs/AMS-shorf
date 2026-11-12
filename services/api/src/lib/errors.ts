// Loi API theo PLAN §2: { error: { code, message, details? } }
export class HttpError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 500 | 502 | 503,
    public code: string,
    message: string,
    public details?: unknown,
    public headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (message: string, code = 'bad_request', details?: unknown) => new HttpError(400, code, message, details);
export const unauthorized = (message = 'Chưa đăng nhập hoặc phiên đã hết hạn.', code = 'unauthorized') => new HttpError(401, code, message);
export const forbidden = (message = 'Bạn không có quyền thực hiện thao tác này.', code = 'forbidden', details?: unknown) => new HttpError(403, code, message, details);
/** 404 dung chung cho "khong co" va "thuoc khach khac" de khong lo ton tai. */
export const notFound = (message = 'Không tìm thấy dữ liệu.', code = 'not_found') => new HttpError(404, code, message);
export const conflict = (message: string, code = 'conflict', details?: unknown) => new HttpError(409, code, message, details);
export const unprocessable = (message: string, code = 'validation_error', details?: unknown) => new HttpError(422, code, message, details);
export const tooMany = (message: string, retryAfterSec: number, code = 'too_many_requests') =>
  new HttpError(429, code, message, { retry_after_sec: retryAfterSec }, { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterSec))) });
