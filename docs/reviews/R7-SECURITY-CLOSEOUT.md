# R7 Đóng mục bảo mật còn lại (agent p2-rest)

Ngày: 2026-11-22. Nối tiếp R6. Trạng thái: đóng = có mã + test/tệp bằng chứng; mở = cần quyết định/hạ tầng/con người.

| Mục | Trạng thái | Bằng chứng / việc còn lại |
|---|---|---|
| R1-21 xoay khóa AES-GCM (key id, v2, vòng khóa, tách khóa chỉ mục) | đóng | `packages/shared/src/aes.ts`; `shared/test/key-ring.test.ts`; `api/test/p2-rest.test.ts` (xoay thật + gỡ khóa cũ); quy trình `docs/ops/KEY-ROTATION.md` |
| Job/CLI mã hóa lại | đóng | `api/src/lib/reencrypt.ts`, `cli/reencrypt-fields.ts`, `POST /admin/v1/ops/reencrypt-fields` (super_admin, audit) |
| R1-21 AAD cố định theo cột (không gắn id hàng) | mở (chấp nhận) | Hoán đổi ciphertext giữa hàng cần quyền ghi DB; gắn AAD theo hàng cần migration lớn. |
| Xoay SESSION_SECRET | đóng | Chỉ ký URL kho tệp fs: `previousSecrets` / `SESSION_SECRET_PREV` (`runtime/test/fs-secret-rotation.test.ts`); phiên là token DB |
| R1-24 `__Host-` cookie | đóng | `shared/src/cookies.ts`, `auth/session.ts`; chọn tiền tố theo `isHttps` (HTTPS: `__Host-`, HTTP local: tên thường); web-admin đọc cả hai; `api/test/p2-rest.test.ts`. Còn nhận tên cũ khi đọc để chuyển đổi (ưu tiên `__Host-`) |
| Tiêu đề bảo mật API (CSP none, DENY, HSTS khi HTTPS, Permissions-Policy, COOP) | đóng | `app.ts`; `p2-rest.test.ts` |
| Tiêu đề + CSP strict web-admin (Workers assets + nginx) | đóng | `apps/web-admin/public/_headers`, `nginx-security-headers.conf` (sửa lỗi `add_header` ở location ghi đè tiêu đề cấp server); `src/test/security-headers.test.ts`. `style-src 'unsafe-inline'` (React style attr), `img/media/connect https:` do media nằm R2/CDN: thu hẹp khi cố định tên miền |
| Giới hạn tốc độ: auth, mfa/enroll, manifest công khai, viewer GET/withdraw | đóng | `auth/routes.ts`, `gateway.ts`, `viewer.ts`; `edge-gateway/test/p2-cors.test.ts`, `p2-rest.test.ts`. `/v1/register` đã có từ trước |
| Kiểm chứng khóa brute-force (login, MFA) | đóng | `p2-security.test.ts` (R1-19), `p2-rest.test.ts` (5 mã sai => mfa_expired) |
| R1-20 gateway bỏ qua TRUST_PROXY | đóng | `edge-gateway/src/util.ts` + test `TRUST_PROXY=0` |
| CORS viewer | đóng | `viewerCors`: `*`/`null` chỉ ở local/test, khớp chính xác, Vary, không credentials; `p2-cors.test.ts`. `/status` công khai giữ `*` (không có header ký) |
| Rà soát log (OTP/token/số tài khoản) | đóng | `shared/src/logging.ts` (`safeErr`), áp dụng ở console.*; `api/test/log-redaction.test.ts` quét tĩnh |
| Quét bí mật cây làm việc + lịch sử git (80 commit) | đóng | Không phát hiện token/khóa riêng (mẫu AKIA/ghp_/sk-/PEM/JWT/gán bí mật dài); tệp .env/.pem chưa từng được thêm. Người: bật gitleaks trong CI |
| `pnpm audit --prod` | đóng một phần | 27 -> 9. nodemailer 7.0.13 -> 10.0.13 (hết 20 cảnh báo), yaml 2.8.3. Còn: `zod` 3.x high (web-admin; cần zod 4, ReDoS tập hợp lớn, API đã giới hạn `max()`), `react-router` 6.x (2, cần v7; là SPA, không SSR/deserializeErrors, link nội bộ), `@hono/node-server` (cần 2.x; không dùng serveStatic), `uuid` qua aws-sdk (chỉ v4, không dùng buf) |
| Chuỗi băm audit_log chống sửa | mở | R1/THREAT-MODEL không yêu cầu; hiện bảo vệ bằng trigger chỉ-INSERT. Người: bản sao object-lock (DR) |
| R1-18 HMAC hai định dạng SePay | mở | Chờ xác nhận định dạng SePay thật |
| R1-22 SSRF import | mở (tiềm ẩn) | Chưa có downloader; chặn khi viết |
| R1-23 đối tác tạo chiến dịch mồ côi, R1-25 hoàn tiền một vai trò, R1-29 accountNumber thiếu | mở | Cần quyết định nghiệp vụ (đã nêu ở R6) |
| R1-17 còn customers/partners | mở | Cần chính sách che từng trường |
| R1-12 KV Cloudflare không nguyên tử | mở (p5) | Agent p5-rest |
| R1-10 presign không ràng độ dài | mở (runtime/cloudflare) | Agent khác |
| kid_safe lúc xây manifest | mở (p5) | `p2-security.requests.md` |
| Pen-test, NĐ13, quy trình xóa dữ liệu | mở (người) | Ngoài mã |

## Việc người phải làm
1. Triển khai theo thứ tự trong `docs/ops/KEY-ROTATION.md` (mã đọc v2 lên mọi dịch vụ trước khi nạp khóa mới); đặt `FIELD_INDEX_KEY` trước khi xoay lần đầu.
2. Chạy `pnpm install` (lockfile đã đổi: nodemailer 10, yaml) và kiểm tra gửi thư SMTP thật.
3. Sau triển khai HTTPS, người dùng đăng nhập lại một lần (cookie đổi tên `__Host-`).
4. Đặt `VIEWER_CORS_ORIGINS` là danh sách origin cụ thể (ví dụ `https://localhost,capacitor://localhost`), không dùng `*`.
5. Thu hẹp `img/media/connect-src` trong `_headers` theo tên miền R2/CDN thật; bật gitleaks + `pnpm audit` trong CI.
6. Quyết định các mục "mở" cần nghiệp vụ; lên lịch pen-test.
