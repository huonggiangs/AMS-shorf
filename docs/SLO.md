# AMS: SLO của đường thiết bị (gateway) theo quy mô 10k / 100k / 1M / 10M

Nguồn: đặc tả mục 3 và 11 (SLO gốc), `docs/DEVICE-PROTOCOL.md` (chu kỳ do máy chủ điều khiển), `docs/COST-MODEL.md`, và số đo thật trong `docs/LOAD-TEST-REPORT.md`. Nhãn: **[đặc tả]** lấy nguyên từ đặc tả; **[đo]** đo ở báo cáo tải; **[suy ra]** tính từ mã/giao thức; **[giả định]** chưa có nguồn, phải đo lại.

## 1. Tải sinh ra từ giao thức (không phải từ bảng đặc tả)

Gateway thật (`services/edge-gateway/src/load.ts`, `gateway.ts`): heartbeat **300 giây** khi đang phát, 600 giây khi rảnh, 120 giây khi lỗi, 15 giây khi giám sát; jitter ±20% quanh chu kỳ cơ sở; chu kỳ tự giãn tới x4 khi tải vượt 70% `GW_CAPACITY_RPS`, và trả 503 + `Retry-After` khi vượt `GW_SHED_AT`. `GW_CAPACITY_RPS` mặc định là **700** (trước đây 5.000, xem mục 6). Manifest poll 900 giây (304 nếu etag không đổi). Lô sự kiện 600 giây, khoảng 1,33 impression/lô (8 impression/giờ/TV). COST-MODEL giả định heartbeat 120 giây: lớn hơn 2,5 lần so với mặc định của gateway.

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
| Consumer (số tiến trình tại 790 msg/s sau khi gộp lô [đo, x4-perf-fix]; trước đây 170 msg/s) | 1 | 1 | 3 | 22 |
| Heartbeat p99 SLO | 300 ms | 300 ms | 300 ms | 300 ms |
| Uptime | 99,9% | 99,9% | 99,95% | 99,95% |
| Độ dư N+1 | không cần | 2 gateway | >= 12 gateway, 2 Redis | kiến trúc shard, không còn một Postgres/Redis |

Ghi chú: uptime 99,9% cho hai bậc nhỏ là đề xuất [giả định] (chưa có HA ở đó). Lô sự kiện/giây = `N/600`: 17, 167, 1.667, 16.667 msg/s; consumer sau khi gộp lô (x4-perf-fix) đo được khoảng 790 msg/s mỗi tiến trình (trước đó 170 đến 195 msg/s, sát trần ở 100k), nên 100k chỉ dùng khoảng 21% một tiến trình; Postgres còn 0,32 giao dịch/message (trước đó 6,85).

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

## 6. Cập nhật x4-perf-fix (2026-11-13): số đo trước và sau

Máy và công cụ như `docs/LOAD-TEST-REPORT.md` mục 2 (2 vCPU chia sẻ, Postgres 16 và Redis 7 thật). Lưu ý trung thực: lần đo sau chạy khi máy **yên** (`otherProcessesCores` 0,02 đến 0,2), còn lần đo trước chạy khi tiến trình khác chiếm 0,85 đến 1,35 lõi; vì vậy độ trễ gateway tốt hơn một phần do nhiễu giảm chứ không chỉ do mã. Riêng consumer, hai lần đo cùng điều kiện yên (`--consumer-concurrency 1` so với 64), nên so sánh được.

| Chỉ tiêu | Trước | Sau | Nguồn |
|---|---|---|---|
| Consumer, 4.000 message (5.333 impression) vào hàng đợi Redis thật | 195 msg/s (260 impression/s), 6,85 giao dịch PG/message | **793 msg/s (1.058 impression/s), 0,32 giao dịch PG/message** (4,1 lần) | `results/consumer-bench-c1.json`, `consumer-bench-c64.json` |
| Tính đúng đắn sau đo consumer | | 5.333 hàng = 5.333 `event_id` khác nhau = `impression_hourly`; chi tiêu 106.680 VND = 5.333 x 20 + 20 (preflight); 0 dead-letter | cùng tệp |
| Đội 10.000 thiết bị x10 (= 100k thật), 612 req/s, 150 giây, sau 30 giây đầu | heartbeat p99 65 ms, events p99 103 ms | heartbeat p99 14 ms, manifest 304 p99 20 ms, events p99 15 ms; 0 lỗi trên 92.630 | `results/x4-after-fleet.json` |
| Tồn đọng sự kiện sau chạy 100k-tương đương | 1.106 (đang xả) | **0** (46.344 trên 46.344 trong `ev_ad_impression`, khử trùng 3 lần gửi lại = 1 hàng) | cùng tệp |
| CPU Postgres mỗi request | 0,28 ms, 0,62 giao dịch | 0,10 ms, 0,33 giao dịch | cùng tệp |
| Ramp 250 / 500 / 1000 rps, heartbeat p99 | 120 / 396 / 3.649 ms (máy bị nhiễu) | 18 / 26 / 107 ms (máy yên) | cùng tệp |
| Bão khởi động (10.000 thiết bị trong 6 giây), heartbeat p99 gồm cả đoạn này | 4,5 s | 5,4 s | cùng tệp: **chưa cải thiện**, đây là giới hạn gateway không phải consumer |

Giới hạn còn lại của consumer: `DbEventStore` (packages/runtime, ngoài phạm vi sửa) vẫn ghi từng dòng trong một giao dịch (2 câu lệnh/dòng), Postgres là nút cổ chai tiếp theo (0,5 lõi ở 790 msg/s). Gộp lô dùng 64 vòng nhận song song (`INGEST_CONCURRENCY`), nên khi tiến trình chết có thể mất tối đa 64 message đã lấy khỏi Redis (hàng đợi Redis không AOF vốn đã không bền; trước đây tối đa 1).

TTL (đã sửa): `dev:<id>` và `presence:<id>` nay dẫn xuất từ chu kỳ heartbeat tối đa: `2 x (max chu kỳ cơ sở 600 x giãn x4 x jitter 1,2 = 2.880 s) + 60 = 5.820 s` (trước: 300 s và 360 s, nhỏ hơn chu kỳ 240 đến 360 s và 600 s). Tính từ cấu hình `HB_*_S` thực; có test khóa vào `computeInterval`. Việc kéo dài `dev:` an toàn vì API xóa khóa khi chặn, đổi tin cậy, ghép đôi.

`GW_CAPACITY_RPS` mặc định **700** (trước 5.000): bằng 70% điểm gãy đo được (khoảng 1.000 req/s khi máy bị nhiễu; ở bậc đo yên 1.000 req/s vẫn p99 107 ms nhưng chưa đo cao hơn). Giãn chu kỳ bắt đầu ở khoảng 490 req/s, 503 từ 700. Đây là giá trị cho một instance trên máy 2 vCPU chia sẻ; production phải đặt theo đo trên phần cứng thật (khoảng 1.300 đến 1.600 req/s/lõi x 60% x số lõi).
