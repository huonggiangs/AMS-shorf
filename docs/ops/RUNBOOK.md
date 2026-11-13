# AMS: sổ tay vận hành (runbook)

Phạm vi: Docker local và Cloudflare (staging, production). Hạ tầng riêng (k8s) mới có khung (`infra/k8s/`), chưa có quy trình vận hành.
Tài liệu liên quan: `docs/DEPLOY-CLOUDFLARE.md` (triển khai), `docs/ops/DISASTER-RECOVERY.md` (sao lưu, khôi phục), `docs/ops/RELEASE-CHECKLIST.md`, `docs/THREAT-MODEL.md`.

> **Trạng thái kiểm chứng:** lệnh Docker và Cloudflare dưới đây được viết từ cấu hình trong repo (`infra/docker/docker-compose.yml`, `infra/cloudflare/*/wrangler.toml`, mã nguồn `services/*`). Môi trường soạn tài liệu **không có Docker daemon và không có tài khoản Cloudflare**, nên các lệnh `docker compose`, `wrangler` **chưa được chạy thật**. Đã chạy thật: câu SQL trên PostgreSQL 16 (bảng `outbox`, `payment_webhooks`...) và `scripts/backup-postgres.sh` ở chế độ `--direct`. Gặp lệnh sai: ghi lại thông báo lỗi, sửa tài liệu này.

Quy ước: `DC` = `docker compose --env-file .env -f infra/docker/docker-compose.yml`. Windows không có `make`: dùng `scripts/ams.ps1 <lệnh>` thay `make <lệnh>`.
Mọi lệnh thay đổi dữ liệu thật (production) cần **hai người** biết và ghi vào nhật ký sự cố (mục 9).

## 1. Sơ đồ thành phần (để biết cái gì hỏng thì ảnh hưởng gì)

| Thành phần | Docker local | Cloudflare | Nếu hỏng |
|---|---|---|---|
| Web admin + cổng khách | `web-admin` (nginx :8080), qua Caddy | Worker `ams-web-admin-<env>` | Không vào được giao diện; thiết bị vẫn chạy |
| API (admin, portal, auth, webhook SePay, tài chính) | `api` :8787 | Worker `ams-api-<env>` (route `/api/*`) | Không nạp ví, không duyệt chiến dịch; thiết bị vẫn phát lịch đã có |
| Gateway thiết bị (`/v1/*`) | `edge-gateway` :8788 | Worker `ams-edge-gateway-<env>` + Durable Object `PresenceShard` | TV không heartbeat/gửi sự kiện (TV giữ hàng đợi ngoại tuyến) |
| Ghi sự kiện, trừ tiền | `ingest-consumer` :8789 | consumer của Queue `ams-ingest-<env>` (trong Worker gateway) | **Lượt hiển thị không được tính tiền** (sự kiện nằm chờ trong hàng đợi) |
| CSDL giao dịch | `postgres` | D1 `ams-core-<env>` (finance/audit tách sẵn nhưng hiện chưa dùng, xem DR mục 1) | Hệ thống dừng |
| KV, rate limit, hàng đợi | `redis` (AOF bật) | KV `ams-kv-<env>`, Queues | Mất rate limit/cache; Redis mất hàng đợi sự kiện chưa xử lý |
| Tệp media | volume `mediadata` (`/data/objects`, `OBJECT_STORE=fs`) | R2 `ams-media-<env>`, `ams-reports-<env>`, `ams-audit-<env>` | Không tải/xem media |
| Email | `mailpit` (chỉ bắt thư thử) | Chưa cấu hình dịch vụ gửi thư thật (DEPLOY-CLOUDFLARE mục 5) | Không gửi được thư mời/kích hoạt |

## 2. Khởi động và dừng

### Docker local
| Việc | Lệnh | Thành công khi |
|---|---|---|
| Lần đầu | `make setup` (tạo `.env`, sinh khóa) | Có `.env`; **sao lưu `FIELD_ENC_KEY` ngay** |
| Chạy | `make up` rồi `make seed` (lần đầu) | `make ps` thấy các dịch vụ `healthy`; `make up` in tài khoản Super admin |
| Thêm ClickHouse | `make up-events` | `clickhouse` healthy (xem mục 6) |
| Thêm Grafana/OTel | `make up-obs` | Grafana ở http://localhost:3000 |
| Dừng (giữ dữ liệu) | `make down` | `make ps` rỗng |
| **Xóa sạch dữ liệu local** | `make reset` (hỏi gõ `xoa`) | **Mất Postgres, volume media, Redis, Mailpit**. Sao lưu trước: `scripts/backup-postgres.sh backup` |
| Chẩn đoán | `make doctor` | In công cụ, `.env`, container, cổng |
| Xem log | `make logs` hoặc `make logs S=api` | |

Thứ tự khởi động do `depends_on` lo: postgres, redis, mailpit, `migrate-seed`, rồi `api`, `edge-gateway`, `ingest-consumer`, `web-admin`, `proxy`. Khởi động lại một dịch vụ: `$DC restart api`.
Dừng **an toàn khi cần bảo trì DB**: dừng nơi ghi trước, giữ DB: `$DC stop proxy api edge-gateway ingest-consumer`.

### Cloudflare
| Việc | Lệnh | Ghi chú |
|---|---|---|
| Deploy | `node scripts/deploy-cloudflare.mjs --env staging` (thêm `--dry-run` để xem trước) | Chi tiết: `docs/DEPLOY-CLOUDFLARE.md` mục 6 |
| Quay lui mã | `node scripts/deploy-cloudflare.mjs --env production --rollback` | Chỉ mã Worker, không đụng dữ liệu |
| Xem log | `npx wrangler tail ams-api-production` (và `ams-edge-gateway-production`) hoặc Dashboard > Workers > Logs | Gateway chỉ lấy mẫu 10% log (`head_sampling_rate = 0.1`) |
| **Dừng khẩn cấp web** | Dashboard > Workers > `ams-web-admin-<env>` > Domains & Routes > gỡ tên miền | Thiết bị vẫn chạy qua gateway (DEPLOY-CLOUDFLARE mục 8.4) |
| Dừng nhận tiền tự động | Web admin > Cài đặt > SePay > tắt (`PUT /admin/v1/settings/sepay` với `enabled=false`) | Webhook trả 403 `webhook_disabled` và vẫn được lưu nguyên văn; SePay sẽ gửi lại sau khi bật |

## 3. Kiểm tra sức khỏe

| Kiểm tra | Docker | Cloudflare (production) | Kỳ vọng |
|---|---|---|---|
| API | `curl -s http://localhost:8787/health` | `curl -s https://ams.anio.vn/api/health` | HTTP 200, `{"ok":true,"service":"ams-api","runtime":...}` |
| Gateway | `curl -s http://localhost:8788/health` | `curl -s https://gw-ams.anio.vn/health` | HTTP 200, có `time` |
| Ingest-consumer | `$DC exec ingest-consumer wget -qO- http://127.0.0.1:8789/health` | không có (consumer nằm trong Worker gateway) | HTTP 200 |
| Web | `curl -sI http://localhost:8080/healthz` | mở `https://ams.anio.vn/` | 200 / trang đăng nhập |
| Container | `make ps` | không áp dụng | `healthy` hết (Caddy dùng `:2019/config/`) |
| Postgres | `$DC exec postgres pg_isready -U ams -d ams` | không áp dụng | `accepting connections` |
| Redis | `$DC exec redis redis-cli ping` (đã đặt `REDISCLI_AUTH`) | không áp dụng | `PONG` |
| Hàng đợi sự kiện | `$DC exec redis redis-cli LLEN ams:q:ingest.events` | Dashboard > Queues > `ams-ingest-production` (backlog) | Gần 0; tăng liên tục là sự cố (mục 4.1) |
| Hàng đợi chết | `$DC exec redis redis-cli LLEN ams:q:ingest.events:dead` | Dashboard > Queues > `ams-ingest-dlq-production` | 0 |
| Outbox | SQL ở mục 4.1 | cùng SQL qua `wrangler d1 execute` | `pending` nhỏ, `dead` = 0 |
| Đối soát ví | Thông báo "Đối soát ví lệch sổ cái" (`reconcileLedger`, chạy hằng ngày 02:15 UTC) | như Docker | Không có thông báo |

`/health` chỉ cho biết tiến trình sống; **không** kiểm tra DB, Redis hay hàng đợi. Vì vậy phải xem thêm backlog hàng đợi và outbox (dưới đây).
Thiết bị online: web admin > Thiết bị (online nếu `last_seen < 2,5 × chu kỳ`, xem ARCHITECTURE 2.1).
Chạy kiểm thử nhanh sau deploy: `pnpm e2e:smoke` (`tests/e2e/smoke.ts`); mục 7 của DEPLOY-CLOUDFLARE là danh sách kiểm tra tay.

SQL dùng được trên cả Postgres và D1 (D1: `npx wrangler d1 execute ams-core-production --remote --env production -c infra/cloudflare/api/wrangler.generated.toml --command "<SQL>"`; Postgres: `$DC exec postgres psql -U ams -d ams -c "<SQL>"`).

## 4. Sự cố thường gặp

Mỗi mục: **Triệu chứng, Chẩn đoán, Xử lý, Xác nhận xong**. Nếu không xử lý được trong 30 phút hoặc có nghi ngờ mất tiền/dữ liệu: dừng nhận tiền (mục 2), báo CTO, mở nhật ký sự cố.

### 4.1 Hàng đợi tồn đọng (ingest, outbox)

**Hai hàng đợi khác nhau, đừng nhầm:**
1. **Hàng đợi sự kiện thiết bị** (Redis list `ams:q:ingest.events`; Cloudflare Queue `ams-ingest-<env>`). Consumer ghi `ev_*`/`impression_hourly` và **trừ tiền chiến dịch** (khử trùng theo `event_id`, `spend_dedupe`).
2. **Outbox** (bảng `outbox`): việc sau duyệt chiến dịch (`campaign.approved` giữ tiền, `manifest.bump` báo gateway dựng lại manifest). Worker xử lý mỗi 5 giây (Docker, `OUTBOX_INTERVAL_MS`) hoặc cron phút (Cloudflare).

**Triệu chứng:** doanh thu/lượt hiển thị trên dashboard đứng yên; chiến dịch vừa duyệt mãi ở `awaiting_funds`; TV không nhận lịch mới.

**Chẩn đoán:**
```
# Docker: độ sâu hàng đợi sự kiện và hàng chết (tin hỏng sau 3 lần thử vào ...:dead)
$DC exec redis redis-cli LLEN ams:q:ingest.events
$DC exec redis redis-cli LLEN ams:q:ingest.events:dead
$DC ps ingest-consumer            # có chạy và healthy không
$DC logs --tail=100 ingest-consumer

# Outbox (SQL)
SELECT status, COUNT(*) FROM outbox GROUP BY status;
SELECT id, topic, attempts, available_at, last_error FROM outbox WHERE status IN ('pending','dead') ORDER BY created_at LIMIT 20;
```
Nguyên nhân hay gặp: `ingest-consumer` dừng (khi đó **không có ai** đọc hàng đợi), Postgres/D1 chậm hoặc đầy (mục 4.2), lỗi mã gây ném ngoại lệ lặp lại (xem `last_error`/log).

**Xử lý:**
1. Consumer chết: `$DC up -d ingest-consumer` (hoặc `$DC restart ingest-consumer`). Tin trong Redis còn nguyên (Redis bật AOF); consumer tự xử lý hết backlog. Xử lý idempotent theo `event_id` nên chạy lại an toàn.
2. Backlog lớn do tải: tăng bản sao consumer (`$DC up -d --scale ingest-consumer=3`); khử trùng đảm bảo không trừ tiền hai lần. Giảm tải đầu vào: mục 4.4.
3. Hàng chết (`...:dead` > 0): sửa nguyên nhân gốc rồi chuyển tin về hàng chính, mỗi tin một lần: `$DC exec redis redis-cli LMOVE ams:q:ingest.events:dead ams:q:ingest.events RIGHT LEFT` (lặp N lần; tin giữ bộ đếm thử cũ nên chỉ còn thêm tối đa 1 lần thử trước khi vào lại hàng chết). **Không** xóa hàng chết khi chưa lưu bản sao: đó là sự kiện có thể quy ra tiền (`redis-cli LRANGE ams:q:ingest.events:dead 0 -1 > dead-<ngày>.json`).
4. Outbox `dead` (hết 8 lần thử, cần người xử lý): đọc `last_error`, sửa nguyên nhân, rồi cho chạy lại: `UPDATE outbox SET status='pending', attempts=0, available_at='<ISO-8601 hiện tại>' WHERE id='<id>' AND status='dead'`. Handler idempotent nên chạy lại an toàn. Chiến dịch kẹt `awaiting_funds` mà không có dòng outbox sẽ được `reconcileApprovals` ghi bù mỗi lần cron.
5. Cloudflare: backlog Queue tăng, consumer Worker lỗi: xem log `ams-edge-gateway-<env>`; tin hỏng sau 5 lần thử vào `ams-ingest-dlq-<env>`. Xử lý tin trong DLQ cần kỹ sư (chưa có script phát lại; chưa kiểm chứng trên Cloudflare thật).

**Xác nhận xong:** `LLEN` về gần 0 và không tăng lại sau 10 phút; `outbox` không còn `dead`; dashboard số lượt hiển thị tăng trở lại; đối soát ví sạch (mục 4.3 bước cuối).

### 4.2 Cơ sở dữ liệu đầy

**Triệu chứng:** API trả 500, log có `no space left on device` (Postgres) hoặc lỗi giới hạn dung lượng (D1: tối đa 10 GB mỗi DB, xem ARCHITECTURE mục 6); ghi `ev_*` thất bại; backlog tăng.

**Chẩn đoán (Postgres):**
```
$DC exec postgres psql -U ams -d ams -c "SELECT pg_size_pretty(pg_database_size('ams'))"
$DC exec postgres psql -U ams -d ams -c "SELECT relname, pg_size_pretty(pg_total_relation_size(oid)) FROM pg_class WHERE relkind='r' AND relnamespace='public'::regnamespace ORDER BY pg_total_relation_size(oid) DESC LIMIT 10"
docker system df
```
Bảng phình nhanh nhất thường là `ev_heartbeat`, `ev_ad_impression`, `ev_proof_of_play` (sự kiện), rồi `impression_hourly`, `outbox`, `spend_events`. **Hiện mã chỉ tự dọn `outbox` (giữ 14 ngày) và `spend_events`; các bảng `ev_*` không có chính sách giữ dữ liệu tự động ở chế độ Postgres/D1** (ClickHouse có `TTL` 14 ngày cho `heartbeat` trong `packages/db/clickhouse/001_events.sql`). Đây là khoảng trống đã biết: ghi vào backlog.

**Xử lý:**
1. **Sao lưu trước khi xóa bất cứ gì:** `scripts/backup-postgres.sh backup`. Media local (volume `ams_mediadata`): sao lưu bằng tar, xem DISASTER-RECOVERY mục 2.3.
2. Dọn sự kiện nóng cũ (chỉ heartbeat, giá trị thấp nhất): `DELETE FROM ev_heartbeat WHERE ts < '<ISO-8601 cách đây 14 ngày>'` rồi `VACUUM (ANALYZE) ev_heartbeat` (Postgres; ngoài giờ cao điểm, xóa theo lô nếu bảng rất lớn). **Không** xóa `ev_ad_impression` đã gộp vào `impression_hourly` khi chưa chạy đối soát doanh thu; **không bao giờ** sửa/xóa `audit_log`, `wallet_entries`, `wallet_ledger` (trigger chặn và đó là bằng chứng tài chính).
3. Đĩa Docker đầy: `docker system prune` **chỉ** xóa image/cache không dùng; **không** chạy `docker volume prune` (xóa volume dữ liệu) và không `make reset`. Mở rộng đĩa hoặc chuyển volume `pgdata` sang ổ lớn hơn.
4. D1 gần 10 GB: chuyển bảng sự kiện sang kho khác (kế hoạch giai đoạn 2: ClickHouse/R2 Parquet, COST-MODEL); trước mắt dọn `ev_heartbeat` như trên.

**Xác nhận xong:** còn trống >= 20% đĩa; `make ps` healthy; backlog về 0; thêm thử một bản ghi (đăng nhập, tạo thông báo) thành công.

### 4.3 Webhook SePay lỗi (không nhận được, bị từ chối, hoặc không cộng ví)

**Nguyên tắc:** mọi webhook, kể cả bị từ chối, đều được lưu nguyên văn trong `payment_webhooks` (`result` = `rejected:<lý do>`). Tiền chỉ cộng khi webhook xác thực đúng, `transferType = in`, khớp mã `AMS <mã khách>` và số tiền. Cộng ví idempotent theo `event_id` và ràng buộc UNIQUE nên **gửi lại an toàn**.

**Chẩn đoán:**
```
-- 24 giờ gần nhất theo kết quả
SELECT result, COUNT(*) FROM payment_webhooks WHERE received_at > '<ISO-8601 24 giờ trước>' GROUP BY result;
-- Các webhook bị từ chối / chờ xử lý tay
SELECT received_at, result, event_id FROM payment_webhooks WHERE result LIKE 'rejected:%' OR result LIKE 'manual:%' ORDER BY received_at DESC LIMIT 50;
```
| `result` | Nghĩa | Việc làm |
|---|---|---|
| `credited` | Đã cộng ví | Không |
| `duplicate` | Gửi trùng, không cộng lần hai | Không (bình thường) |
| `ignored_out` | Giao dịch tiền ra | Không |
| `rejected:bad_signature` / `no_auth` / `bad_timestamp` / `stale_timestamp` | Sai chữ ký/thiếu header/lệch giờ > 5 phút | Kiểm tra `SEPAY_WEBHOOK_SECRET` khớp với my.sepay.vn (mục 5.2); kiểm tra đồng hồ |
| `rejected:no_secret_configured` | Server chưa có khóa | Đặt secret (DEPLOY-CLOUDFLARE mục 5) |
| `rejected:disabled` | Nhận tiền tự động đang tắt trong Cài đặt > SePay | Bật lại nếu là nhầm |
| `rejected:bad_payload` / `too_large` | Thân yêu cầu sai/quá 64 KB | Xem `payload`; liên hệ SePay nếu định dạng đổi |
| `manual:no_code` / `unknown_customer` / `amount_mismatch` / `account_mismatch` / `customer_blocked` / `daily_limit` / `invalid_amount` | Không tự khớp được | Tài chính xử lý trong web admin: hàng đợi thủ công `GET /admin/v1/payments/manual-queue`, xử lý bằng `POST /admin/v1/payments/manual-queue/:id/resolve` (cần quyền `finance`/`approve`) |

**Xử lý:**
1. **Không thấy webhook nào đến** (khách báo đã chuyển tiền): kiểm tra URL trong my.sepay.vn > Webhooks đúng (`https://ams.anio.vn/api/webhooks/payments/sepay`); xem log SePay; kiểm tra Cloudflare WAF/rate-limit không chặn; Worker `ams-api-production` còn chạy (`/api/health`). Docker local: URL tunnel đổi mỗi lần `make tunnel`.
2. **Bị từ chối do chữ ký:** sửa secret rồi dùng "Gửi lại" trong nhật ký SePay (SePay tự gửi lại tối đa 7 lần theo DEPLOY-CLOUDFLARE mục 8.3). Cloudflare: cron `*/10` chạy đối soát bù (`reconcileSepay`) **chỉ khi** đặt `SEPAY_API_TOKEN` và `SEPAY_MODE != mock`; không có token thì không có đối soát bù, phải gửi lại tay.
3. **Cộng sai/thiếu:** không sửa số dư bằng SQL. Dùng điều chỉnh có hai người duyệt (`wallet-adjustments`, `POST /admin/v1/wallet-adjustments/:id/approve`) hoặc hoàn tác kích hoạt (`POST /admin/v1/activation-log/:id/undo`).
4. Cuối cùng chạy đối soát: job hằng ngày 02:15 UTC tự làm; kiểm tra thủ công bằng truy vấn trong `scripts/backup-postgres.sh verify` (mục "Ví lệch sổ cái") hoặc thông báo `reconcile_mismatch`.

### 4.4 Bão thiết bị (heartbeat/đăng ký/sự kiện tăng vọt)

**Triệu chứng:** gateway 429/503 nhiều, CPU/Worker request tăng, backlog hàng đợi tăng, hóa đơn Cloudflare tăng; thường do TV khởi động lại đồng loạt sau mất điện/lỗi app, hoặc kẻ tấn công đăng ký thiết bị giả.

**Cơ chế sẵn có (đã có trong mã `services/edge-gateway`):** jitter ±20%, `next_interval` do server điều khiển, `Retry-After`, giới hạn đăng ký theo IP (`REGISTER_LIMIT_PER_HOUR`, mặc định 20), sự kiện theo thiết bị (`EVENTS_LIMIT_PER_MIN`, 30), khoảng cách tối thiểu heartbeat (`HB_MIN_GAP_S`, 5 giây), tự giảm tải khi tải vượt `GW_SHED_AT`.

**Công tắc khẩn cấp (không cần deploy):** gateway đọc khóa KV `ctl:gateway` (JSON, bộ nhớ đệm 10 giây):
| Mục tiêu | Giá trị |
|---|---|
| Từ chối heartbeat/manifest bằng 503 + `Retry-After` | `{"shed":true}` |
| Từ chối cả lô sự kiện | `{"shed":true,"shed_events":true}` (TV giữ sự kiện ngoại tuyến, gửi lại sau) |
| Kéo giãn chu kỳ heartbeat | `{"interval_multiplier":4}` hoặc `{"interval_override_s":900}` |
| Tắt | xóa khóa (`del`) |
```
# Docker
$DC exec redis redis-cli SET ctl:gateway '{"shed":true}'
$DC exec redis redis-cli DEL ctl:gateway
# Cloudflare (cú pháp theo phiên bản wrangler; chưa chạy thật): lấy kv_id trong infra/cloudflare/ids.<env>.json
npx wrangler kv key put ctl:gateway '{"shed":true}' --namespace-id <kv_id> --remote
npx wrangler kv key delete ctl:gateway --namespace-id <kv_id> --remote
```
**Chẩn đoán nguồn:** log gateway theo IP/`device_id`; web admin > Thiết bị lọc theo `trust_level = 0` / vừa đăng ký. Thiết bị giả: chặn hàng loạt `POST /admin/v1/devices/bulk` với `action=block` (có audit `device.bulk_block`); bổ sung luật WAF theo IP/ASN ở Cloudflare (Terraform `infra/cloudflare/terraform` chỉ có rate-limit cho `/api/auth/*` và `/api/webhooks/*`, **chưa có luật cho gateway**: cần thêm thủ công).
**Xác nhận xong:** tỉ lệ 429/503 về bình thường, backlog về 0 (mục 4.1), xóa `ctl:gateway`, theo dõi 30 phút.

### 4.5 Xoay vòng khóa bí mật

Luôn: làm **staging trước**, ghi nhật ký, không dán khóa vào chat/email, không commit. Xoay ngay khi nghi lộ.

| Khóa | Tác động | Cách làm | Lưu ý |
|---|---|---|---|
| `SESSION_SECRET` | Mọi người dùng bị đăng xuất | Đặt giá trị mới (Cloudflare: `wrangler secret put SESSION_SECRET -c infra/cloudflare/api/wrangler.toml --env <env>`; Docker: sửa `.env` rồi `$DC up -d api`) | Làm ngoài giờ cao điểm; hỏi 2FA lại là bình thường |
| `SEPAY_WEBHOOK_SECRET` | Webhook bị từ chối tới khi hai phía khớp | 1) Đặt secret mới trên Worker; 2) **ngay sau đó** cập nhật cùng giá trị ở my.sepay.vn > Webhooks > Bảo mật; 3) bấm "Gửi thử" và kiểm `payment_webhooks` | Khoảng hở vài phút: webhook bị `rejected:bad_signature`; sau đó gửi lại từ nhật ký SePay hoặc chờ đối soát bù. Server cũng đọc khóa từ `settings` nếu biến môi trường trống |
| `SEPAY_API_KEY` / `SEPAY_API_TOKEN` | Chế độ Apikey / đối soát bù ngừng nếu sai | Cấp lại ở my.sepay.vn, đặt secret, `POST /admin/v1/settings/sepay/test` | |
| `FIELD_ENC_KEY` | **Không có cơ chế xoay vòng trong mã hiện tại**: không có phiên bản khóa và không có script mã hóa lại. Đổi giá trị = không giải mã được MST, số tài khoản, TOTP, bí mật SePay đã lưu | **Chỉ xoay khi nghi lộ**, và cần kỹ sư viết script giải mã bằng khóa cũ, mã hóa bằng khóa mới, trong một giao dịch, chạy trên bản sao trước (ghi vào backlog; THREAT-MODEL mục 7.2 cũng ghi yêu cầu "theo phiên bản") | Sao lưu khóa cũ tới khi xong. Mất khóa = mất dữ liệu mã hóa |
| Khóa Ed25519 của thiết bị | Thiết bị bị lộ khóa | Chặn thiết bị (web admin > Thiết bị > Chặn, hoặc `POST /admin/v1/devices/bulk`), ghép đôi lại | Khóa sinh trên thiết bị, không có khóa chung để xoay |
| Token API Cloudflare | Deploy ngừng | My Profile > API Tokens > Roll; cập nhật `CLOUDFLARE_API_TOKEN` (`.env`, GitHub Secrets) | Quyền tối thiểu: DEPLOY-CLOUDFLARE mục 3 |
| Khóa R2/S3 (`R2_ACCESS_KEY_ID`..., `S3_SECRET_KEY`; Docker local fs: `SESSION_SECRET` ký URL tải lên) | URL ký mới lỗi tới khi đổi xong | Tạo khóa mới, đặt secret/`.env`, deploy, rồi thu hồi khóa cũ | |
| Mật khẩu Postgres/Redis (Docker) | Dịch vụ không kết nối | Đổi trong DB (`ALTER USER`) **và** `.env`, rồi `$DC up -d` | Đổi `.env` một mình không đổi mật khẩu trong volume đã tạo |

Sau xoay vòng: kiểm tra mục 3, đăng nhập thử, gửi thử webhook SePay (sandbox/staging), và ghi audit.

### 4.6 SePay ngừng hoạt động (nhà cung cấp lỗi)

**Triệu chứng:** khách chuyển tiền mà không có webhook; trang SePay lỗi; `reconcileSepay` báo `errors` trong log.
1. Xác nhận lỗi nằm ở SePay (trang trạng thái/hỗ trợ SePay), không phải của AMS (mục 4.3 bước 1).
2. **Không** cộng tay khi chưa đối chiếu sao kê ngân hàng thật. Thông báo nội bộ: nạp tiền tạm chậm; chiến dịch `awaiting_funds` giữ nguyên (không mất).
3. Khi SePay hoạt động lại: SePay gửi lại webhook (tối đa 7 lần) và cron `*/10` đối soát bù bằng API giao dịch (cần `SEPAY_API_TOKEN`). Khử trùng đảm bảo không cộng hai lần.
4. Nếu gián đoạn kéo dài: Tài chính đối chiếu sao kê ngân hàng với yêu cầu nạp (`topups` đang chờ), xác nhận từng khoản bằng `POST /admin/v1/topups/:id/confirm` (cần `finance`/`approve`, có audit), hoặc xử lý qua hàng đợi thủ công (mục 4.3). Mỗi khoản ghi lý do và người duyệt thứ hai.
5. Sau đó chạy đối soát ví và đối chiếu số dư ngân hàng với tổng `topups` ngày đó.
Lưu ý: VNPay/MoMo chưa có (PLAN mục 1), nên chưa có đường nạp tiền dự phòng.

## 5. Việc định kỳ

| Tần suất | Việc | Người |
|---|---|---|
| Hằng ngày | Xem thông báo `reconcile_mismatch`, backlog hàng đợi, `payment_webhooks` có `manual:`/`rejected:`; sao lưu Postgres (Docker) | Vận hành |
| Hằng tuần | Kiểm bản sao lưu gần nhất bằng `scripts/backup-postgres.sh verify <tệp>`; xem dung lượng DB (4.2) | Vận hành |
| Hằng quý | Diễn tập khôi phục đầy đủ (DR mục 4); rà soát tài khoản quản trị, `campaign_grants` hết hạn; pen-test nhẹ theo PENTEST-PLAN | Kỹ sư + CTO |
| Khi lộ/nhân sự nghỉ | Xoay vòng khóa (4.5), thu hồi tài khoản (`users`) | Super admin |

## 6. ClickHouse và Redpanda (profile `events`)

Chỉ dùng thử trên Docker (`make up-events`; cần nhiều RAM). **Mã không dùng Redpanda**: hàng đợi luôn là Redis (ghi chú trong `docker-compose.yml`). ClickHouse tùy chọn qua `CLICKHOUSE_URL`; để trống thì sự kiện ghi vào Postgres `ev_*`. ClickHouse trên Cloudflare/production chưa có (PLAN mục 1, giai đoạn 2). Sao lưu ClickHouse: DR mục 2.4.

## 7. Liên hệ và leo thang

Điền khi bàn giao (không có trong repo): trực chính, CTO, liên hệ SePay (hỗ trợ my.sepay.vn), liên hệ Cloudflare (gói hỗ trợ), nhà cung cấp tên miền `anio.vn`.
Mức độ: **P1** (không nạp/không phát được toàn hệ thống, nghi mất tiền/dữ liệu) báo CTO ngay và dừng nhận tiền nếu liên quan ví; **P2** (một chức năng/một khách hỏng) xử lý trong ngày; **P3** còn lại trong tuần.

## 8. Giới hạn đã biết của hệ thống (ảnh hưởng vận hành)

- `/health` không kiểm DB/Redis/hàng đợi (mục 3).
- Chưa có chính sách giữ dữ liệu tự động cho `ev_*` (4.2); chưa có script phát lại DLQ Cloudflare (4.1); chưa có cơ chế xoay `FIELD_ENC_KEY` (4.5).
- Chưa có cảnh báo tự động (Sentry/Grafana alert) nối sẵn: `make up-obs` chỉ dựng Grafana/OTel khung (`SENTRY_DSN` để trống). Người trực phải xem tay các chỉ số ở mục 3 cho tới khi cấu hình cảnh báo.
- D1 `ams-finance-*` và `ams-audit-*` được tạo nhưng migration hiện chỉ áp lên `ams-core-*` (scripts/deploy-cloudflare.mjs); toàn bộ dữ liệu nằm trong `ams-core`.

## 9. Mẫu nhật ký sự cố

```
Thời điểm phát hiện (UTC+7):        Người phát hiện:
Mức độ (P1/P2/P3):                  Môi trường:
Triệu chứng:
Nguyên nhân gốc:
Hành động đã làm (giờ, người, lệnh):
Dữ liệu/tiền bị ảnh hưởng (số khách, số tiền):
Thời điểm khắc phục:                Xác nhận bởi (người thứ hai):
Việc phòng ngừa (ghi vào backlog):
```
