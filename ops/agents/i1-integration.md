# i1-integration - ghép nối các gói + chạy trên dịch vụ thật

STATUS: DONE (chờ báo cáo cuối) - e2e 30/30, typecheck sạch, test xanh; chưa kiểm: Docker thật, MinIO, Caddy, Cloudflare
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

## Cách chạy local trên Windows + Docker Desktop
Yêu cầu: Windows 10/11, Docker Desktop (WSL2 backend, đang chạy - biểu tượng cá voi xanh), Node.js 22 LTS (chỉ để chạy `scripts/setup.mjs`), PowerShell. Không cần cài `make`. Chưa chạy thật trên Windows trong phiên này (agent không có Docker): các lệnh dưới đây suy ra từ `scripts/ams.ps1` và compose đã kiểm cú pháp.

Mở PowerShell tại thư mục gốc repo (ví dụ `E:\Project\ANIO design\AMS Short`):
```powershell
# 0) Nếu PowerShell chặn script: dùng  powershell -ExecutionPolicy Bypass -File .\scripts\ams.ps1 <lệnh>
.\scripts\ams.ps1 doctor            # kiểm Docker, Node, cổng 80/443/5432/6379/8787... có đang bị chiếm không
.\scripts\ams.ps1 setup             # tạo .env từ .env.example, tự sinh SESSION_SECRET, FIELD_ENC_KEY, mật khẩu, TOTP seed
.\scripts\ams.ps1 config            # kiểm .env + `docker compose config` hợp lệ
.\scripts\ams.ps1 up                # build image + chạy profile core (proxy, web-admin, api, gateway, ingest-consumer, postgres, redis, minio, mailpit); in thông tin đăng nhập
.\scripts\ams.ps1 ps                # xem trạng thái (tất cả healthy; migrate-seed và minio-init "Exited (0)" là bình thường)
.\scripts\ams.ps1 logs -Service api # xem log một dịch vụ
.\scripts\ams.ps1 trust-ca          # (tùy chọn) xuất CA của Caddy để bỏ cảnh báo chứng chỉ
.\scripts\ams.ps1 down              # dừng (giữ dữ liệu);  .\scripts\ams.ps1 reset -Yes  xóa sạch dữ liệu local
node scripts/setup.mjs totp         # in mã TOTP 6 số hiện tại của Super admin mẫu (khi chưa có app xác thực)
.\scripts\ams.ps1 test              # typecheck + test toàn bộ (cần pnpm; không cần Docker)
```
Địa chỉ: web quản trị https://admin.ams.localhost, cổng khách hàng https://portal.ams.localhost, API https://api.ams.localhost, gateway https://gw.ams.localhost, Mailpit http://localhost:8025 (thư kích hoạt/mời), MinIO console http://localhost:9001. Đăng nhập: email `SEED_ADMIN_EMAIL`, mật khẩu `SEED_ADMIN_PASSWORD` trong `.env`, mã 6 số lấy bằng `node scripts/setup.mjs totp`.

Thử luồng thiết bị: `pnpm --filter @ams/sim run loadtest -- --devices 50 --gateway http://localhost:8788` (hoặc `.\scripts\ams.ps1 loadtest -N 50`). `GATEWAY_DEV_ENDPOINTS=1` đã bật sẵn ở local để bộ giả lập tự ghép đôi.
Thử nạp tiền không cần SePay thật: `SEPAY_MODE=mock` (mặc định) -> nút "Mô phỏng giao dịch" / `POST /dev/sepay/simulate`.

Lỗi thường gặp
- `running scripts is disabled`: dùng `powershell -ExecutionPolicy Bypass -File .\scripts\ams.ps1 ...` hoặc `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.
- `error during connect ... dockerDesktopLinuxEngine`: Docker Desktop chưa chạy / chưa bật WSL2. Mở Docker Desktop, đợi "Engine running".
- `Bind for 127.0.0.1:80 (hoặc 443/5432/6379) failed: port is already allocated`: IIS/World Wide Web Publishing, Skype, PostgreSQL/Redis cài sẵn đang chiếm cổng. Đổi `PROXY_HTTP_PORT`, `PROXY_HTTPS_PORT`, `POSTGRES_PORT`, `REDIS_PORT` trong `.env` (URL sẽ kèm cổng, ví dụ https://admin.ams.localhost:8443) rồi `up` lại. Tìm tiến trình: `netstat -ano | findstr :443`.
- `services.edge-gateway.depends_on.redpanda ... required`: Docker Compose cũ (< 2.20). Cập nhật Docker Desktop.
- Trình duyệt cảnh báo chứng chỉ: bình thường (CA nội bộ của Caddy). Chọn Tiếp tục, hoặc `trust-ca` rồi cài chứng chỉ vào Trusted Root.
- `*.ams.localhost` không phân giải: Chrome/Edge/Firefox tự trỏ `*.localhost` về 127.0.0.1; công cụ khác (curl cũ) cần thêm vào `C:\Windows\System32\drivers\etc\hosts`.
- Build lỗi `no space left` / hết RAM: tăng RAM trong `%UserProfile%\.wslconfig` (`[wsl2] memory=8GB`) rồi `wsl --shutdown`; `docker system prune`.
- `api` unhealthy lúc đầu: đợi `migrate-seed` xong (xem `logs -Service migrate-seed`); thiếu biến -> chạy lại `setup`/`config`.
- Đã `up` nhưng impression không tính tiền: kiểm `ingest-consumer` đang chạy (`ps`); không có nó hàng đợi không được tiêu thụ.
- TV/Android box thật không tải được media: `S3_PUBLIC_ENDPOINT` phải là IP LAN của PC (ví dụ http://192.168.1.10:9000), không phải localhost; mở cổng 9000/8788 trong Windows Firewall cho mạng riêng và đặt TV cùng mạng. Gateway cho TV: `http://<IP-PC>:8788` (cổng gateway mở ở 127.0.0.1 theo mặc định; đổi mapping cổng trong compose nếu cần cho LAN).
- SePay thật gọi webhook: cần URL công khai: `.\scripts\ams.ps1 tunnel` rồi dán URL in ra vào my.sepay.vn, đặt `SEPAY_MODE=sandbox`.
- `.env` bị lỗi sau khi sửa bằng Notepad (BOM/CRLF): lưu UTF-8 không BOM; chạy `config` để kiểm.
