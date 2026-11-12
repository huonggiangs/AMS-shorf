# Yêu cầu của f2-infra cho agent khác

## f1-foundation (package.json, packages/*)
1. `services/api/package.json`: thêm script `migrate` (chạy `migrate()` của @ams/db trên Postgres từ `DATABASE_URL`, thoát mã 0 khi xong, idempotent) và `seed` (nạp seed prototype, idempotent; chỉ tạo Super admin từ `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`; nếu có `SEED_ADMIN_TOTP_SECRET` (base32) thì dùng làm bí mật TOTP của admin mẫu để đăng nhập thử; in email/mật khẩu cuối lệnh). Container `migrate-seed` gọi `pnpm --filter @ams/api migrate` rồi `seed`.
2. D1 (Cloudflare): script deploy áp migration bằng `wrangler d1 migrations apply` (bảng theo dõi `d1_migrations`) từ bản sao đã lọc của `packages/db/migrations` (bỏ `*.postgres.sql`, đổi `*.sqlite.sql` -> `*.sql`). Vì vậy KHÔNG chạy `migrate()` của @ams/db trên D1 lúc khởi động (sẽ tạo bảng `_migrations` trùng chức năng). Nếu muốn tách D1 theo miền, đặt migration vào `packages/db/migrations/finance/` và `audit/` (script tự nhận); hiện chỉ D1 `core` nhận migration.
3. `packages/db/clickhouse/001_events.sql` dùng `ReplicatedMergeTree` (cần Keeper) nên không chạy trên ClickHouse đơn nút: compose áp DDL qua `infra/clickhouse/init/00-apply-ddl.sh`, thay `ReplicatedMergeTree` bằng `MergeTree` khi nạp local.
4. `.gitignore` gốc do f2 tạo (chưa có); thêm dòng nếu cần.
5. `apps/web-admin/pnpm-lock.yaml` là tệp lock thừa trong workspace (chỉ nên có lock ở gốc).

## a1-api-core (services/api)
1. `src/index.ts` là điểm vào Node: lắng nghe `PORT` (mặc định 8787) trên `0.0.0.0`, có `GET /health` trả 200 (không cần đăng nhập). Dockerfile gói bằng esbuild từ `src/index.ts` (không dùng script `start`).
2. Biến môi trường Docker (compose cấp): RUNTIME, DATABASE_URL, REDIS_URL, S3_ENDPOINT, S3_PUBLIC_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY, S3_FORCE_PATH_STYLE, SMTP_HOST, SMTP_PORT, SMTP_FROM, SESSION_SECRET, FIELD_ENC_KEY (base64 32 byte), SEPAY_MODE, SEPAY_WEBHOOK_SECRET, QUEUE_DRIVER (redis|memory|redpanda), KAFKA_BROKERS, CLICKHOUSE_URL/USER/PASSWORD, APP_PUBLIC_URL, PORTAL_PUBLIC_URL, API_PUBLIC_URL, PUBLIC_*; SEED_ADMIN_*. Nếu tên khác, báo f2 để đổi compose.
3. Cloudflare: điểm vào `services/api/src/worker.ts` (`export default { fetch, scheduled, queue }`). **Worker nhận URL có tiền tố `/api`** (route `ams.anio.vn/api/*`, không cắt tiền tố ở biên): trong `fetch`, nếu `pathname` bắt đầu bằng `/api/` thì bỏ `/api` trước khi vào Hono (Docker/nginx đã cắt sẵn). Bindings: DB_CORE/DB_FINANCE/DB_AUDIT (D1), KV, MEDIA/REPORTS/AUDIT_ARCHIVE (R2), JOBS_QUEUE (producer+consumer), PRESENCE (DO của gateway). Cron: `*/10 * * * *` (đối soát bù SePay) và `15 2 * * *` (đối soát hằng ngày) - phân biệt qua `event.cron`. Secrets: SESSION_SECRET, FIELD_ENC_KEY, SEPAY_WEBHOOK_SECRET (+ khóa R2 S3 cho presign).
4. Cookie `ams_session` dùng chung origin `ams.anio.vn` (web + /api): không cần `Domain`, nên đặt `Secure` khi `PUBLIC_ADMIN_URL` là https.
5. `/dev/sepay/simulate` không được mount khi RUNTIME != docker.
6. Biến SEPAY_WEBHOOK_URL (chỉ để hiển thị trên trang Cài đặt > SePay); production = https://ams.anio.vn/api/webhooks/payments/sepay.

## a3-gateway (services/edge-gateway, ingest-consumer, tools/sim)
1. `src/index.ts` (Node, cổng `PORT`: gateway 8788, ingest-consumer 8789) có `GET /health`; ingest-consumer cũng cần /health nếu muốn healthcheck (compose chưa đặt healthcheck cho consumer).
2. Cloudflare `services/edge-gateway/src/worker.ts`: export `fetch`, `queue` (consumer `ams-ingest-<env>`, xử lý cả heartbeat/events), `scheduled` (cron mỗi phút), và class Durable Object `PresenceShard` (SQLite-backed, khai báo migration v1). Bindings: INGEST_QUEUE, PRESENCE, KV, MEDIA, EVENTS_AE (Analytics Engine), DB_CORE/FINANCE/AUDIT. Gateway ở host `gw-ams.anio.vn` (không cắt tiền tố, đường dẫn `/v1/*`, `/health`).
3. `tools/sim` (@ams/sim) cần script `loadtest` nhận `--devices N --gateway URL` (Makefile/ams.ps1 gọi `pnpm --filter @ams/sim run loadtest -- --devices N --gateway http://localhost:8788`).

## a2-payments (services/payments)
- `src/index.ts` chỉ cần nếu chạy như worker nền riêng (profile compose `payments`, mặc định tắt). Nếu finance gắn vào api qua `mountFinance`, có thể bỏ service này khỏi compose.

## f3-web (apps/web-admin)
- Gọi API qua đường dẫn tương đối `import.meta.env.VITE_API_BASE` (mặc định `/api`): `/api/auth/login`, `/api/admin/v1/...`. nginx (`apps/web-admin/nginx.conf.template`) và Cloudflare (route /api/*) đều cùng origin.
- Script `build` phải xuất `apps/web-admin/dist/index.html` (Vite).
- Tên miền: cùng một SPA phục vụ admin và portal (admin.ams.localhost / portal.ams.localhost; production ams.anio.vn): phân biệt giao diện theo vai trò người dùng, không theo host (production chỉ có MỘT host).
