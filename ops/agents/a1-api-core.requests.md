# Yêu cầu của a1-api-core gửi agent khác

## f1 (foundation, packages/db)
1. Thêm cột `admins.phone TEXT` và `admins.expires_at TEXT` bằng migration mới. Hiện a1 lưu hai giá trị này trong `settings` với khóa `admin_profile:<id>` (JSON) để không sửa schema; đổi sang cột sẽ gọn hơn và cho phép lọc/sắp xếp.
2. (Tùy chọn) bổ sung `UPDATE`-chặn trên `audit_log` cho SQLite/D1 giống Postgres (test hiện chỉ kiểm tra ở pglite).

## f3 (web-admin)
1. Hộp thoại tải media nội bộ nên có bộ chọn `customer_id` (API nội bộ bắt buộc chọn khách sở hữu tệp; tài khoản ngoài tự lấy từ phiên).
2. Trạng thái người dùng API trả `invited|active|locked`; hiển thị nhãn `active`.
3. Danh sách thiết bị trả `kind: 'unknown'` cho thiết bị `virtual`; chiến dịch trả `status: 'pending'` (nội bộ là `pending_review`).
4. `GET /admin/v1/dashboard/overview`: `slot_fill` luôn rỗng (chưa có dữ liệu khung giờ); giao diện cần hiển thị trạng thái trống.

## a2 (payments)
1. `mountFinanceRoutes` (services/api/src/finance-mount.ts) đã nối `mountFinance` của a2 với phiên của a1 qua `resolveActor` (cookie `ams_session` + `X-CSRF-Token`). Middleware `authenticate/requireInternal/requireExternal/csrfGuard` đã chạy trước các route `/admin/v1/*` và `/portal/v1/*` của a2 (a2 không cần tự kiểm tra lại).
2. `FinancePort.reserveForCampaign` được a1 gọi SAU khi đánh dấu `awaiting_funds` + `approved_budget_vnd`, ngoài giao dịch của a1 (không truyền `db`). Hợp đồng đầy đủ ở `services/api/src/ports.ts`.

## f2 (infra)
1. Biến môi trường a1 dùng: `PORT`, `FIELD_ENC_KEY`, `DATABASE_URL`, `REDIS_URL`, `S3_*`, `SMTP_*`, `PUBLIC_ADMIN_URL`, `PORTAL_PUBLIC_URL` (liên kết kích hoạt trong email), `TRUST_PROXY` (đặt `0` nếu API không đứng sau proxy tin cậy), `SCRYPT_N` (chỉ test).
2. Cloudflare: `worker.ts` ánh xạ `DB_CORE->DB`, `MEDIA->BUCKET`, `JOBS_QUEUE->QUEUE`; `DB_FINANCE/DB_AUDIT` chưa dùng (một DB duy nhất).
