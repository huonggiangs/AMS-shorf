# i1-integration - ghép nối các gói + chạy trên dịch vụ thật

STATUS: IN-PROGRESS (e2e smoke 30/30 PASS; typecheck sạch; test từng gói xanh; Dockerfile/compose đã rà; còn: web-admin UI, mục Windows)
UPDATED: 2026-11-12

## Đã xong
- Migration `packages/db/migrations/0003_integration.sql` (creatives.sha256/format/overlay, admins.phone/expires_at, campaigns.spend_remainder_micro, bảng spend_dedupe); `migrations.gen.ts` sinh lại bằng `node scripts/embed.mjs`.
- Ghép: ingest-consumer <- `@ams/payments.createSpendFn` (idempotent theo idempotencyKey); API redeemPairingCode (`POST /admin/v1/devices/pair`), xóa kv `dev:<id>` khi chặn thiết bị, tăng `manifest:epoch` khi đổi chiến dịch/creative/lịch; gateway manifest phát format/overlay/sha256 từ DB.
- `pnpm e2e:smoke` (tests/e2e/smoke.ts): Postgres 16 + Redis 7 thật, S3/SMTP giả -> 30 bước PASS.
- `pnpm --filter @ams/e2e bundle-check` (tests/e2e/bundle-check.ts): bundle esbuild đúng tham số Dockerfile, `node index.mjs` cho api/gateway/consumer, /health 200 trên Postgres+Redis thật.

## Lỗi ghép nối đã tìm và sửa (cái gì / ở đâu)
1. Manifest không bao giờ làm mới trên instance bận (TTL bộ nhớ trượt, ghi lại mỗi lần hit) - `services/edge-gateway/src/manifest.ts` (chỉ ghi mem khi nạp từ kv/DB) + epoch `manifest:epoch`.
2. Dashboard đếm cả impression không hợp lệ - `services/api/src/routes/dashboard.ts` (SUM(valid)).
3. Bản đóng gói Docker của API KHÔNG BAO GIỜ khởi động: `src/index.ts` chỉ tự chạy khi argv khớp đường dẫn nguồn, mà image chạy `node index.mjs`. Sửa: khớp thêm `index.mjs` + `ENV AMS_API_START=1` trong `services/api/Dockerfile`.
4. compose truyền `SMTP_FROM` nhưng code đọc `MAIL_FROM`; thiếu `PUBLIC_ADMIN_URL`, `SMTP_USER/PASS`, `SEPAY_API_KEY/API_TOKEN/WEBHOOK_URL`, `TRUST_PROXY`, `GATEWAY_DEV_ENDPOINTS` - `infra/docker/docker-compose.yml`, `.env.example`.
5. Không có tiến trình nào tiêu thụ hàng đợi impression trong profile `core` (ingest-consumer nằm ở `events` và ép `QUEUE_DRIVER=redpanda`, biến này không được code đọc) -> không tính tiền. Sửa: ingest-consumer vào profile `core`, dùng Redis.
6. Service `payments` trong compose chạy `src/index.ts` chỉ export thư viện -> thoát ngay; tài chính thực ra mount trong API. Đã bỏ service.
7. Bucket media đặt `anonymous none` nhưng manifest trả URL không ký cho TV -> 403. Sửa: `mc anonymous set download` cho bucket media (bucket reports vẫn riêng tư).
8. IP khách: Caddy chỉ nối thêm XFF (client giả được), nginx web-admin đặt X-Real-IP = IP container Caddy (mọi người dùng chung 1 IP rate-limit). Sửa: Caddy `header_up X-Forwarded-For/X-Real-IP {remote_host}` + xóa `CF-Connecting-IP`; nginx dùng IP do Caddy đặt.
9. `up-events` (ams.ps1/Makefile) đặt QUEUE_DRIVER=redpanda vô tác dụng - đã bỏ.

## Giới hạn đã biết
- spendFn trên D1 (Cloudflare) không atomic giữa các câu lệnh (idempotency vẫn nhờ UNIQUE spend_dedupe).
- Tệp > 128 MB: sha256 để null, gateway băm trong bộ nhớ.
- Cache: manifest ~15 s, thiết bị ~30 s (mặc định) trễ sau khi đổi dữ liệu nếu epoch không bump được.
- esbuild trong kiểm tra cục bộ là 0.21.5 (Dockerfile ghim 0.25.0).
