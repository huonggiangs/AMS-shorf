# Kiểm chứng D1 / Workers trên runtime thật (workerd) — P5

Trạng thái: đã chạy trên **trình mô phỏng cục bộ của Cloudflare** (workerd + Miniflare 4.20260730, wrangler 4.161.0). **Chưa** chạy trên tài khoản Cloudflare thật (sandbox không tới được api.cloudflare.com). Mọi số đo bên dưới là số của **local simulator, không phải production**.

## 1. Cách chạy

```
pnpm test:cf          # = pnpm --filter @ams/cf-runtime-tests test:cf  (khoảng 3-4 phút, không cần token/secret)
```

Bộ test ở `tests/cf-runtime/`:

1. `src/global-setup.ts`: chạy `scripts/deploy-cloudflare.mjs --env production --fake-ids --dry-run` (sinh `wrangler.generated.toml` + bundle bằng `wrangler deploy --dry-run --outdir`), rồi `wrangler d1 migrations apply DB_CORE --local` (công cụ thật) áp toan bo migration (0001-0022) vào D1 SQLite cục bộ.
2. `src/world.ts`: dựng Miniflare với **bundle thật** của Worker `ams-edge-gateway-production` (kèm consumer hàng đợi `ams-ingest-production` + Durable Object `PresenceShard` SQLite) và `ams-api-production`. Binding, consumer hàng đợi, DO, biến môi trường lấy từ wrangler.toml production qua `unstable_getMiniflareWorkerOptions` (không viết tay). Phía Node dùng `createCloudflareRuntime` trên **cùng** D1/KV/R2 để gieo dữ liệu và đối chiếu.
3. Test: `events` (thiết bị Ed25519 -> gateway -> D1 + queue -> consumer -> chi tiêu ví), `viewer`, `api`, `config`, `zz-measure`.

Thiết lập giống production: `ENVIRONMENT=production` (giá dự phòng bị tắt => phải có `campaign_prices`), `nodejs_compat`, compatibility_date 2025-09-01. Các biến chỉ nới cho test: `DEVICE_MEM_TTL_S=0`, `MANIFEST_MEM_TTL_S=0`, giới hạn register/events rất cao.

## 2. Những gì đã được chứng minh trên workerd

| Hạng mục | Kết quả |
|---|---|
| Toàn bộ migration 0001-0022 áp bằng `wrangler d1 migrations apply --local` | pass |
| Đăng ký thiết bị Ed25519 thật, heartbeat, manifest, chống replay nonce (Durable Object SQLite) | pass |
| Impression hợp lệ -> D1 -> Queue -> consumer -> `spend_events`/ví; sổ cái == cache ví == chi tiêu chiến dịch (`reconcileLedger`) | pass |
| Trần giờ/thiết bị (120): 130 event mới => đúng 120 hợp lệ + 10 `rate_cap`; giao lại không trừ trần lần hai (`kv_counters` upsert + `RETURNING` trong `D1.batch`) | pass |
| 12 lô **giống hệt** gửi song song (`Promise.all`) | đúng 25 dòng, không trừ kép, `spent*1e6 + remainder == 25 * giá` |
| 3 thiết bị x 4 lô khác nhau, mỗi lô gửi 2 lần đồng thời, 2 chiến dịch | 96 event, không mất/trùng, tiền khớp |
| PoP trùng `event_id` (trong lô, giữa các lô) | 1 dòng (`ev_pop_seen`) |
| Viewer: ghép đôi, thưởng lượt xem cộng đúng 1 lần dù 8 lô song song, ví/ledger phân trang | pass |
| Rút tiền: 6 yêu cầu song song (khác `idempotency_key`) | đúng 1 payout `pending`, 1 dòng audit; gửi lại cùng khóa trả lệnh cũ (`idempotent_replay`) |
| Admin: đăng nhập scrypt (tham số mặc định) + TOTP; TOTP dùng lại bị chặn; danh sách 130 thiết bị; thao tác hàng loạt 150 id | pass (sau khi sửa lỗi mục 3) |
| Upload creative: presign SigV4 trên workerd (WebCrypto) -> R2 cục bộ -> `confirm` -> outbox -> `JOBS_QUEUE` -> validator allow-list -> `scan_state=clean` + sha256 | pass |
| `scheduled()` của api (3 cron) và gateway chạy hết; `kv_counters` hết hạn bị dọn | pass |
| Cấu hình wrangler production (binding, consumer + DLQ, DO, route, cron, flags) | pass; `wrangler deploy --dry-run --outdir` bundle 3,6 MiB (gzip ~1,0 MiB) cho cả hai Worker |

## 3. Lỗi mà runtime thật làm lộ ra (đã sửa)

**D1 giới hạn 100 tham số ràng buộc mỗi câu lệnh** (đã xác nhận: 100 OK, 101 => `too many SQL variables`; SQLite/PGlite dùng trong test cũ không giới hạn nên không bao giờ lộ). Các chỗ vượt giới hạn, đã chia cụm bằng helper mới `chunkForIn` (`packages/runtime/src/sql.ts`):

- `services/api/src/routes/devices.ts`: danh sách thiết bị (`page_size` tới 200) và `POST /bulk` (tới 500 id) trả **HTTP 500** trên D1 khi >100 id. Test `api.test.ts` tái hiện 500 trước khi sửa. Bulk giờ chạy các cụm trong **một `db.batch`** (nguyên tử).
- `services/api/src/routes/campaigns.ts` (`presentCampaigns`: 2 truy vấn `IN`) và `compliance/dsr.ts` (xuất dữ liệu người dùng): cùng lỗi.
- `services/ingest-consumer/src/consumer.ts` `existingIds`: cụm 200 id => lô queue có >100 event_id làm cả lô hỏng. Lô hỏng được tách từng tin nhắn nên tiền không sai, nhưng tốn thêm vòng lặp/ghi lại. Sửa còn 100.

Các điểm khác ghi nhận, **không phải lỗi** nhưng cần biết khi vận hành:

- Gateway lưu bản ghi thiết bị trong bộ nhớ isolate 30 giây (`DEVICE_MEM_TTL_S`): ngay sau khi ghép đôi, event trong tối đa 30 giây vẫn bị gắn `untrusted_device` (không tính tiền, không thưởng). Đúng thiết kế, tránh rủi ro tính tiền nhầm.
- Thân yêu cầu giới hạn 16 KiB (~50 event/lô); vượt => 413.
- Production tắt giá dự phòng: chiến dịch không có `campaign_prices` => `no_price`, không tính tiền (đã kiểm chứng).
- Sổ cái ví có khóa duy nhất `(ref_type, ref_id, kind)`: gieo nạp tiền cho nhiều khách với cùng `ref_id` bị im lặng bỏ qua (`ON CONFLICT DO NOTHING`) — chỉ ảnh hưởng dữ liệu gieo.
- `normalizeParams` đổi `bigint` -> `Number`; D1 trả số nguyên dưới dạng JS number: chính xác tới 2^53 (~9,0e15 micro-VND = 9,0e9 VND mỗi cột cộng dồn). Với ngân sách hiện tại an toàn; nếu một cột micro-VND có thể vượt mức này (tổng nhiều năm/nhiều chiến dịch) cần lưu theo VND nguyên + phần dư (như `spend_remainder_micro` đang làm).
- Cả hai Worker bind `DB_FINANCE`/`DB_AUDIT` nhưng mã chỉ dùng `DB_CORE` (`createCloudflareRuntime` nhận `DB: DB_CORE`); chưa có truy vấn xuyên DB.
- Ghi chú công cụ: Miniflare 4.20260730 không khởi động được bundle qua `scriptPath` (lỗi nội bộ `..`), dùng `script` nội dung thì chạy.

## 4. Số đo (LOCAL SIMULATOR — không phải production)

`rows_read`/`rows_written` lấy từ `meta` của kết quả D1 (cùng định dạng production; đã gồm chỉ mục). 1 thiết bị, chiến dịch 1 creative:

| Thao tác | rows_written | rows_read | câu lệnh |
|---|---:|---:|---:|
| register | 15 | 2 | 5 |
| heartbeat (cache nóng) | 3 | 1 | 1 |
| manifest (cache) | 3 | 1 | 1 |
| `/v1/events` 1 impression (gateway) | 16 | 6 | 8 |
| `/v1/events` 10 impression | 77 | 26 | 25 |
| `/v1/events` 40 impression | 287 | 96 | 85 |
| consumer, 1 impression (chi tiêu + ghi sự kiện) | 24 | 17 | 17 |
| consumer, 10 impression | 111 | 54 | 52 |
| consumer, 40 impression | 411 | 174 | 172 |
| consumer giao lại (khử trùng) | 0 | 0 | 0 |

Tổng cho lô 40 impression: (287 + 411) / 40 = **17,5 dòng ghi mỗi impression** (gateway ~7,2 + consumer ~10,3). Lô 1 event tốn 40 dòng: nên gom lô.

Độ trễ HTTP qua workerd (client và Worker cùng máy, không có mạng, không có replica D1 thật nên **thấp hơn production nhiều**): heartbeat p50 10 ms / p95 25 ms; manifest p50 6 / p95 8 ms; events 1 impression p50 52 / p95 116 ms; events 40 impression p50 29 / p95 135 ms. Đăng nhập admin (scrypt tham số mặc định, bao gồm khởi động lạnh) 1,8-2,8 giây thời gian tường: cần gói Workers Paid (giới hạn CPU mặc định 30 giây/yêu cầu; gói Free 10 ms sẽ không đủ).

### Ghi chú chi phí (D1, gói Workers Paid — số tham khảo, đối chiếu lại bảng giá hiện hành của Cloudflare trước khi quyết định)

Giá tham khảo: gồm sẵn 50 triệu dòng ghi + 25 tỷ dòng đọc mỗi tháng, vượt mức: 1,00 USD / triệu dòng ghi, 0,001 USD / triệu dòng đọc.
Với ~17,5 dòng ghi/impression (lô 40):

| Impression/tháng | Dòng ghi/tháng | Vượt gói (tạm tính) |
|---:|---:|---:|
| 1 triệu | 17,5 triệu | 0 USD (trong 50 triệu) |
| 5 triệu | 87,5 triệu | ~37,5 USD |
| 20 triệu | 350 triệu | ~300 USD |

Dòng đọc (~4-5 mỗi impression) không đáng kể. Chưa tính heartbeat (3 dòng/lần) và Workers/Queues/DO. Cách giảm khi cần: bỏ khóa khử trùng `capev:<thiết bị>:<event_id>` riêng từng event (khoảng 2 dòng/event, bảng + chỉ mục), tăng kích thước lô, gộp `spend_events`.

## 5. Còn cần Cloudflare thật (chưa kiểm chứng)

- Độ trễ thật (cạnh -> D1 primary, replica đọc), rows-written theo hóa đơn, giới hạn thời gian/hàng/CPU thực sự được thực thi, kích thước bundle khi upload.
- Hàng đợi thật: giao lại, `max_retries`, DLQ, thứ tự và nhân bản tin; hành vi batch consumer ở tải cao.
- Durable Object production (giới hạn ~1.000 req/s/shard), cron triggers thật, Analytics Engine, custom domain `gw-ams.anio.vn` (DNS/Universal SSL) và route `ams.anio.vn/api/*`.
- PUT thật tới endpoint S3 của R2 bằng URL presign (test dùng binding R2 cục bộ thay thế bước PUT).
- Xác nhận D1 `batch` + `RETURNING` ở tải đồng thời lớn trên nhiều colo (ở local chỉ có một tiến trình).
