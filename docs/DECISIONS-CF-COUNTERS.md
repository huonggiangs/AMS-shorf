# Quyết định: bộ đếm nguyên tử trên Cloudflare (R1-12, N1, N4, N8)

Trạng thái: đã cài đặt và kiểm bằng test với D1 giả lập (node:sqlite). **Chưa chạy trên Cloudflare thật** (không có tài khoản trong môi trường làm việc); mọi chỗ ghi "D1 xử lý tuần tự" dưới đây là hành vi theo tài liệu D1, cần xác nhận bằng một lần tải thử trên staging.

## Vấn đề
`CfKv.incr` cũ là `KV.get` rồi `KV.put`: hai request song song (hai isolate, hai colo) cùng đọc `n` và cùng ghi `n+1`, mất một lượt tăng; KV còn nhất quán cuối cùng nên đọc có thể cũ ~60 giây. Hệ quả (R1-12): giới hạn đăng nhập/MFA mềm, mã TOTP dùng lại được giữa các colo, trần impression/giờ/thiết bị không chứng minh được (R1-04, N1), khóa chiếm `ingest:pop:*` và `media:lock:*` không loại trừ lẫn nhau. Thêm N4 (tối đa 50 vòng `incr` tuần tự mỗi lô sự kiện) và N8 (PoP chỉ khử trùng bằng KV).

## Hai phương án
| | Durable Object (DO) đếm | D1 `INSERT .. ON CONFLICT DO UPDATE .. RETURNING` |
|---|---|---|
| Nguyên tử | có (một luồng/DO) | có (một câu lệnh; D1 chạy tuần tự các câu lệnh trên một DB) |
| Binding mới | cần `[[durable_objects.bindings]]` + `[[migrations]]` tag cho **mỗi** Worker dùng (api, gateway, ...) và class phải nằm trong chính Worker đó hoặc `script_name` chéo | không: đã có `DB_CORE` ở cả hai Worker |
| Gói | DO cần Workers Paid để dùng (bản SQLite-backed có trên Free nhưng giới hạn thấp) | D1 dùng được cả Free/Paid |
| Lô nhiều khóa | mỗi khóa một DO = một RPC, hoặc phải shard và tự gom | `D1.batch([...])` = một vòng mạng, một giao dịch ngầm, trả `RETURNING` từng câu |
| Hạn mức thông lượng | ~1.000 req/s mềm mỗi DO; hot key (một thiết bị) vẫn trên một DO | D1 ~1.000 truy vấn/s mỗi DB (COST-MODEL), dùng chung với `ev_*` |
| Chi phí ghi | rows written của DO SQLite | rows written của D1 |
| Khoá hết hạn | tự quản lý (alarm/gc) | cột `exp` + cron `purgeExpiredCounters` |

## Chọn: D1
Lý do: (1) **đơn giản hơn**: không thêm class/binding/migration tag vào wrangler (không đổi `infra/cloudflare/*/wrangler.toml`; `deploy-cloudflare.mjs --dry-run` không đổi); chạy được ở cả API Worker (không có DO nào) lẫn gateway; (2) chạy trên Workers Free và Paid; (3) gom lô thật: 50 sự kiện = một `D1.batch` thay vì 50 RPC; (4) cùng cơ sở dữ liệu nên PoP/impression và bộ đếm dùng chung công cụ sao lưu, migration `0011` là một tệp di động. Đánh đổi chấp nhận: D1 là nút thắt chung (~1.000 query/s). Mỗi lô sự kiện tốn 2 câu `batch` (một vòng cho khóa chiếm + một cho tổng trần), tức khoảng 51 dòng ghi cho lô 50 sự kiện; ở tải lớn (hàng triệu impression/ngày) đây là chi phí rows-written đáng kể, và khi đó chuyển bộ đếm tran-gio sang DO theo thiết bị (cùng giao diện `Kv.incrMany`) là bước tiếp theo, không cần đổi mã nghiệp vụ.

## Thiết kế
- Bảng `kv_counters(k PK, n, exp)`. Tăng: `INSERT (k, by, now+ttl) ON CONFLICT DO UPDATE SET n = CASE WHEN exp <= now THEN excluded.n ELSE n + excluded.n END, exp = CASE WHEN exp <= now THEN excluded.exp ELSE exp END RETURNING n`. Cửa sổ cố định như Redis (`ttl` chỉ đặt khi tạo/khi hết hạn).
- Giao diện `Kv` giữ nguyên `incr`; thêm **tuỳ chọn** `incrBy`, `incrMany` (+ helper `kvIncrMany/kvIncrBy/kvClaimMany` ở `packages/runtime/src/counters.ts` có đường lui sang `incr`). Postgres/Redis: `incr` đã nguyên tử; Redis thêm `INCRBY` Lua và pipeline; Memory đồng bộ trong một tick. Docker/Postgres không đổi hành vi.
- `CfKv.incr/incrBy/incrMany` đi qua D1 cho mọi khóa, **trừ `manifest:epoch`**: gateway đọc nó bằng `get` và chỉ cần giá trị đổi sau mỗi lần bump (mất một lượt tăng đồng thời vô hại), nên giữ trên KV. `del` xóa cả dòng D1 (khóa mềm `media:lock:*`). Bảng thiếu (chưa chạy migration) thì tự `CREATE TABLE IF NOT EXISTS` một lần rồi thử lại; lỗi D1 khác được ném ra (đóng thay vì mở cho rate limit).
- Sửa chỗ gọi `get`+`set` giả nguyên tử: `totp:used:*` (API `checkTotp`, payments `step-up`) nay chiếm bằng `incr(k) === 1`.
- Dọn: `purgeExpiredCounters()` chạy ở cron mỗi phút của gateway và cron API.

## Trần giờ/thiết bị, idempotent theo `event_id` (N1, N4)
`processEvents` (gateway) làm ba bước thay cho 50 lần `incr`: (1) thu thập `event_id` đủ điều kiện đến bước đếm trần; (2) `incrMany` chiếm `capev:<thiết bị>:<event_id>` (TTL 3.700 s): chỉ sự kiện **mới** (giá trị 1) được tính; (3) một `incrBy(cap:<thiết bị>:<giờ>, số_mới)`: sự kiện mới thứ i có thứ tự `n - mới + i + 1`, vượt `maxPerDeviceHour` thì `rate_cap`. Lô gửi lại (mất phản hồi) không trừ trần lần hai. Sự kiện đã chiếm trước đó (gửi lại) không đếm thêm; nó bị `rate_cap` chỉ khi bộ đếm giờ đã vượt trần. Ghi chú đánh đổi: nếu bản ghi đầu chưa tới ingest (tiến trình chết giữa chừng), lần gửi lại có thể bị `rate_cap` oan; nó chỉ làm **giảm** doanh thu, không bao giờ tăng (ingest khử trùng theo `event_id`, bản ghi đầu thắng). Giá/doanh thu không bị đụng (hàm tính giá không đổi).

## Proof-of-play UNIQUE (N8)
`ev_proof_of_play` không có `event_id` và `ALTER TABLE ADD COLUMN` không có `IF NOT EXISTS` trên SQLite, nên migration `0011` thêm bảng `ev_pop_seen(event_id PK, claim, ts)`. `DbEventStore.append('proof_of_play')` khi hàng có `event_id`: trong **một** `db.batch` (giao dịch trên Postgres/SQLite/D1) `INSERT ev_pop_seen ... ON CONFLICT DO NOTHING` rồi `INSERT ev_proof_of_play ... SELECT ... WHERE EXISTS (seen với đúng claim)`. KV hết hạn/mất hay lô giao lại đều không ghi đôi. Hàng không có `event_id` (client cũ) giữ đường cũ. `ClickHouseEventStore` bỏ trường `event_id` trước khi gửi.

## Test
`packages/runtime/test/cf-counters.test.ts` (200 lời tăng đồng thời không mất lượt nào; so sánh với đường KV cũ mất lượt; `incrMany` một vòng; 50 khóa chiếm một vòng; cửa sổ hết hạn; tự tạo bảng), `packages/runtime/test/pop-dedupe.test.ts` (Postgres/pglite và SQLite), `services/edge-gateway/test/cap-idempotent.test.ts` (lô gửi lại không trừ trần; 50 sự kiện = 2 vòng `incrMany`), cộng `security-x1` (20 lô song song).
