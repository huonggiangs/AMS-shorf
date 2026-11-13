# AMS: SLO của đường thiết bị (gateway) theo quy mô 10k / 100k / 1M / 10M

Nguồn: đặc tả mục 3 và 11 (SLO gốc), `docs/DEVICE-PROTOCOL.md` (chu kỳ do máy chủ điều khiển), `docs/COST-MODEL.md`, và số đo thật trong `docs/LOAD-TEST-REPORT.md`. Nhãn: **[đặc tả]** lấy nguyên từ đặc tả; **[đo]** đo ở báo cáo tải; **[suy ra]** tính từ mã/giao thức; **[giả định]** chưa có nguồn, phải đo lại.

## 1. Tải sinh ra từ giao thức (không phải từ bảng đặc tả)

Gateway thật (`services/edge-gateway/src/load.ts`, `gateway.ts`): heartbeat **300 giây** khi đang phát, 600 giây khi rảnh, 120 giây khi lỗi, 15 giây khi giám sát; jitter ±20% quanh chu kỳ cơ sở; chu kỳ tự giãn tới x4 khi tải vượt 70% `GW_CAPACITY_RPS`, và trả 503 + `Retry-After` khi vượt `GW_SHED_AT`. Manifest poll 900 giây (304 nếu etag không đổi). Lô sự kiện 600 giây, khoảng 1,33 impression/lô (8 impression/giờ/TV). COST-MODEL giả định heartbeat 120 giây: lớn hơn 2,5 lần so với mặc định của gateway.

Yêu cầu/giây ở trạng thái ổn định với N thiết bị online đang phát: `N x (1/300 + 1/900 + 1/600) = N x 0,006111` (heartbeat 0,003333, sự kiện 0,001667, manifest 0,001111).

| Quy mô N | Steady req/s (chu kỳ 300 s) | Đỉnh thiết kế (x1,5 [giả định]) | Bão khởi động (N thiết bị bật trong 60 s, mỗi thiết bị 1 heartbeat + 1 manifest đầy đủ) | Cùng quy mô theo COST-MODEL (120 s) |
|---|---|---|---|---|
| 10k | 61 | 92 | 333 | 111 |
| 100k | 611 | 917 | 3.333 | 1.111 |
| 1M | 6.111 | 9.167 | 33.333 | 11.111 |
| 10M | 61.111 | 91.667 | 333.333 | 111.111 |

Hệ số 1,5 (jitter, lệch theo giờ) là **[giả định]**. Bão khởi động tính bằng `2N/60`; app phải chờ ngẫu nhiên 0 đến 60 giây (DEVICE-PROTOCOL mục 2), nên đây là trần của giao thức, gấp 5,5 lần steady.

## 2. SLO (áp dụng cho mọi quy mô, đo tại gateway, không gồm mạng)

| Chỉ tiêu | Mục tiêu | Nguồn | Điều kiện đo |
|---|---|---|---|
| Heartbeat p99 | < 300 ms | [đặc tả] | steady, tải <= đỉnh thiết kế |
| Manifest từ cache/304 p99 | < 100 ms | [đặc tả] | steady |
| Events (POST /v1/events, trả 202) p99 | < 500 ms | [giả định], cùng bậc với heartbeat | steady |
| Tỷ lệ 304 của manifest poll | >= 95% khi không có thay đổi chiến dịch; lần đầu/khởi động là 200 đầy đủ | [suy ra]: etag nhóm ổn định | steady |
| Tỷ lệ lỗi 5xx | < 0,1% | [giả định] | steady |
| 4xx ngoài ý muốn (401/409/422) từ thiết bị hợp lệ | 0 | [suy ra] | steady |
| Giảm tải có chủ đích (503 + Retry-After) | < 1% steady; <= 30% trong bão khởi động; thiết bị phải giãn chu kỳ | [giả định] | |
| Độ bền sự kiện | 100% sự kiện đã nhận 202 phải có trong `ev_ad_impression` sau khi hàng đợi xả; trùng `event_id` = 0 hàng thừa | [suy ra] mã gateway + consumer | sau xả hàng đợi |
| Độ trễ nhận sự kiện đến ghi sổ/bảng | p99 < 60 s | [đặc tả] "phát đến dashboard < 60 giây" | steady |
| Mất telemetry heartbeat khi gateway chết | <= 1 cửa sổ xả (`TELEMETRY_FLUSH_MS`, mặc định 10 s, hoặc 200 dòng) | [suy ra] `hbRows` giữ trong bộ nhớ | |
| Uptime | 99,95% | [đặc tả] | |

Tiền chỉ tính từ sự kiện đã qua consumer (spend idempotent theo `event_id`); sự kiện nằm trong hàng đợi chưa là tiền, nên mất hàng đợi (Redis không có AOF) là mất doanh thu chưa ghi nhận, không phải trừ tiền sai.

## 3. Yêu cầu theo quy mô

Chi phí CPU/request lấy từ số đo (mục 5 báo cáo): gateway + consumer chung tiến trình 0,62 đến 0,77 ms, Postgres 0,28 ms, Redis 0,08 ms, tổng khoảng **1,1 ms lõi/request** (bao gồm nhiễu do nhiều tiến trình cùng tranh 2 vCPU, sai số khoảng ±30%). Redis 7 đến 9 lệnh/request. Số lõi cần = `đỉnh x ms / 1000 / 0,6` (đích dùng 60% CPU).

| | 10k | 100k | 1M | 10M |
|---|---|---|---|---|
| Đỉnh thiết kế (req/s) | 92 | 917 | 9.167 | 91.667 |
| Lõi gateway (0,7 ms) | 0,1 | 1,1 | 10,7 | 107 |
| Lõi Postgres (0,3 ms) | 0,05 | 0,5 | 4,6 | 46 |
| Lệnh Redis/s (7,5/req) | 690 | 6,9k | 69k | 688k |
| Số primary Redis (80k lệnh/s [COST-MODEL ƯT]) | 1 | 1 | 1 đến 2 | 9 đến 14 |
| Khóa Redis (`rps x 600 + 2N`) | 57k | 0,57M | 5,7M | 57M |
| RAM Redis (240 đến 290 B/khóa [đo]) | 14 đến 16 MB | 0,14 đến 0,16 GB | 1,4 đến 1,6 GB | 14 đến 16 GB |
| Consumer (số tiến trình tại 170 msg/s [đo, nhiễu]) | 1 | 1 đến 2 | 10 | 98 |
| Heartbeat p99 SLO | 300 ms | 300 ms | 300 ms | 300 ms |
| Uptime | 99,9% | 99,9% | 99,95% | 99,95% |
| Độ dư N+1 | không cần | 2 gateway | >= 12 gateway, 2 Redis | kiến trúc shard, không còn một Postgres/Redis |

Ghi chú: uptime 99,9% cho hai bậc nhỏ là đề xuất [giả định] (chưa có HA ở đó). Lô sự kiện/giây = `N/600`: 17, 167, 1.667, 16.667 msg/s; consumer đo được khoảng 170 msg/s mỗi tiến trình nên bậc 100k đã sát trần.

## 4. Điều kiện để một lần chạy tải được tính là "đạt SLO"

1. Chạy `pnpm --filter @ams/load load` (mục 2 báo cáo) trên máy không bị tiến trình khác tranh CPU (cột `otherProcessesCores` < 0,25 trong kết quả).
2. Mọi chỉ tiêu mục 2 đạt ở tải đỉnh thiết kế của bậc cần chứng minh, quan sát p99 sau 30 giây đầu (bỏ bão khởi động) và báo riêng p99 bão khởi động.
3. Mốc đã chứng minh bằng số đo thật hiện tại: xem LOAD-TEST-REPORT mục 7. Bậc 1M và 10M chỉ được ngoại suy, **chưa được chứng minh**.

## 5. Mâu thuẫn trong đặc tả mục 3 (140.000 so với 83.000 req/s)

Đặc tả ghi "impression ~140.000 req/s (nếu mọi thiết bị flush 10 phút)" và "telemetry ~83.000 req/s, 1 lần/10 phút, gộp vào heartbeat" ở cùng 50 triệu thiết bị. Phép tính:

- Gộp 10 phút: `50.000.000 / 600 = 83.333` request/s. Con số 83.000 của hàng telemetry thực ra chính là tốc độ lô impression; telemetry gộp vào heartbeat nên không thêm request nào.
- 140.000 không ra từ "8 impression/giờ, lô 10 phút". Có hai cách ra số này: (a) `50M x 10 impression/giờ / 3600 = 138.889` (10 impression/giờ, không phải 8, và đó là **sự kiện/giây**, không phải request); (b) `83.333 + 55.556 = 138.889`, tức là cộng nhầm lô impression với manifest poll (hai hàng khác nhau). Cả hai đều xấp xỉ 140k nên không thể biết ý gốc từ tài liệu.
- Với 8 impression/giờ, tốc độ **hàng** (sự kiện) là `50M x 8/3600 = 111.111` hàng/s dù gộp lô thế nào; gộp lô chỉ đổi số request (83.333) chứ không đổi số hàng. Hai đại lượng (request/s so với hàng/s) bị trộn lẫn: đó là gốc của mâu thuẫn.
- Tổng request thật tại 50M (telemetry đã gộp): `416.667 + 83.333 + 55.556 = 555.556` req/s (con số COST-MODEL dùng). Nếu tin 140k: 612.000 (+10%). Nếu dùng chu kỳ mặc định của gateway (300 s): `166.667 + 83.333 + 55.556 = 305.556`.

Kết luận dùng trong SLO này: request/s impression = `N/600`; hàng/s = `N x 8/3600`; không dùng 140k. Cần chủ dự án xác nhận ý định gốc (đề xuất sửa đặc tả).
