# Yêu cầu của a3-gateway cho agent khác

## f1-foundation (packages/db)
1. `creatives`: thêm cột `sha256 TEXT` (hex) và `format TEXT` (`fullscreen|menu_banner|l_banner|pause_ad|qr_corner|reward`, mặc định `fullscreen`). Manifest hiện đọc `cr.sha256` nếu có (tự rơi về kv `creative:sha256:<id>` rồi băm tệp trong object store) và dùng `creatives.kind` nếu trùng tên định dạng. Không có sha256 thì creative bị loại khỏi manifest (không xác minh được thì không phát).
2. (tuỳ chọn) `devices`: cột `px_w/px_h` hoặc bảng `screens.device_id` luôn được điền cho thang máy/LED: model_class lấy độ phân giải từ `screens` ghép qua `device_id`.

## a1-api-core (services/api)
1. Ghép đôi: khi người dùng nhập mã 6 số trên app điện thoại, gọi `redeemPairingCode(rt, code, endUserId)` từ `@ams/edge-gateway` (nguyên tử, một lần, nâng `trust_level` >= 1, xoá kv `dev:<id>`). `endUserId` phải là `end_users.id` có thật.
2. Khoá/mở thiết bị (bulk block, đổi trust): sau khi UPDATE `devices`, `await rt.kv.del('dev:' + id)` (cache thiết bị của gateway; bộ nhớ từng instance hết hạn trong 30 giây).
3. Sau khi duyệt/tạm dừng/dừng/hết hạn chiến dịch, hoặc duyệt/trả lại creative: xoá cache manifest để có hiệu lực ngay: `rt.kv.del('manifest:<region>.all.<model_class>')` cho các nhóm liên quan (hoặc đợi tối đa ~75 giây). Đề xuất: `ManifestService.invalidate()` chỉ xoá bộ nhớ của một instance, nên API nên xoá khoá kv.
4. Lệnh thiết bị (khoá, làm mới, giám sát): `enqueueCommand(rt, deviceId, {type, args})` từ `@ams/edge-gateway`. Công tắc điều khiển toàn cục: `rt.kv.set('ctl:gateway', JSON.stringify({shed?, shed_events?, interval_override_s?, interval_multiplier?, monitored?: string[], min_app_version?}))` (gateway đọc qua bộ nhớ đệm 10 giây).
5. Trạng thái online trên admin: presence nằm ở kv `presence:<device_id>` (JSON `{ts, state, region}`, TTL 6 phút) trên Docker; trên Cloudflare ở Durable Object `PresenceShard`. `devices.last_seen_at/status/app_version` được gateway cập nhật gộp lô (mỗi >10 phút/thiết bị, xả mỗi 10 giây hoặc mỗi phút).

## a2-payments (hoặc mountFinance)
1. Ingest-consumer cần một `SpendFn` do bên tài chính cung cấp (không import @ams/payments): kiểu `SpendFn = (req: {campaignId, customerId, amountMicroVnd, impressions, idempotencyKey, firstTs, lastTs}) => Promise<void>` ở `@ams/ingest-consumer`. **Hàm phải idempotent theo `idempotencyKey`** (giao lại message vẫn gọi lại cùng khoá), tự quyết định làm tròn micro-VND -> VND (cộng dồn phần dư), chặn chi vượt phần giữ, dừng chiến dịch khi hết ngân sách. Gắn bằng `setSpendFn(fn)` từ `@ams/ingest-consumer/spend` trước khi khởi động (Node: `boot.ts`; Cloudflare: `worker.ts` của edge-gateway). Khi chưa gắn: consumer vẫn ghi sự kiện, **không trừ tiền**, và tăng `stats.spendSkippedNoFn` (cảnh báo log).

## f2-infra
1. Biến môi trường mới (đều có mặc định): `MEDIA_PUBLIC_URL` (URL gốc công khai của media, mặc định `S3_PUBLIC_ENDPOINT/S3_BUCKET`), `MANIFEST_TTL_S`=900, `MANIFEST_BUILD_TTL_S`=60, `MANIFEST_PUBLIC`=1, `HB_PLAYING_S`=300, `HB_IDLE_S`=600, `HB_ERROR_S`=120, `HB_MONITORED_S`=15, `HB_MIN_GAP_S`=5, `GW_CAPACITY_RPS`=5000, `GW_SHED_AT`=1, `REGISTER_LIMIT_PER_HOUR`=20, `EVENTS_LIMIT_PER_MIN`=30, `TELEMETRY_SAMPLE_EVERY`=1, `TELEMETRY_FLUSH_SIZE`=200, `TELEMETRY_FLUSH_MS`=10000, `IMPRESSION_MIN_VCR`=100, `IMPRESSION_MAX_PER_DEVICE_HOUR`=120, `IMPRESSION_PRICE_MICRO_VND`=20000000 (TẠM), `REWARD_POINT_VND`=1 (TẠM), `PRESENCE_SHARDS`=16 (Cloudflare), `INGEST_INLINE`=0, `GATEWAY_DEV_ENDPOINTS`=0 (không bao giờ bật ở production).
2. Cổng ingest-consumer: `PORT` (8789), `GET /health` đã có.
3. Gateway đứng sau Caddy/Cloudflare: gateway lấy IP khách từ `CF-Connecting-IP` rồi `X-Forwarded-For`; Caddy phải ghi đè `X-Forwarded-For` (không tin giá trị do khách gửi), nếu không giới hạn tốc độ theo IP bị qua mặt.
4. `make loadtest`: `pnpm --filter @ams/sim run loadtest -- --devices N --gateway URL`. Với gateway thật cần `GATEWAY_DEV_ENDPOINTS=1` (ghép đôi giả) và nới `REGISTER_LIMIT_PER_HOUR`, `HB_MIN_GAP_S=0`, `EVENTS_LIMIT_PER_MIN` khi chạy từ một IP; gateway `RUNTIME=test` đã đặt sẵn các giá trị này và nạp 3 chiến dịch mẫu.
5. Cloudflare: Queue `ams-ingest-*` mang cả `ingest.events` và `events.*` (CfEventStore), gateway Worker là consumer; message của một lô <=50 impression < 128 KB.
