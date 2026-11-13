# AMS: báo cáo kiểm thử tải gateway (Postgres 16 thật + Redis 7 thật)

Mọi số trong tài liệu này lấy từ các lần chạy thật, JSON gốc ở `tools/load/results/` (`run-nice.json`, `run-contended.json`, `run-fleet-a.json`, `run-fleet-b.json`, `run-fleet-c.json`, `run-fleet-a-v1.json`). Không có số nào được bịa; chỗ ngoại suy ghi rõ [ngoại suy] kèm phép tính. SLO nằm ở `docs/SLO.md`.

## 1. Kết luận ngắn (đọc trước)

- **Tiêu chí "kiểm thử tải đạt SLO" chưa đạt ở bậc 1M/10M và chỉ đạt có điều kiện ở bậc 100k-tương đương.** Đã chứng minh: đội 10.000 thiết bị ảo nén thời gian x10 (tải tương đương 100k thiết bị thật, 612 req/s) chạy 150 giây, 0 lỗi, sau 30 giây đầu heartbeat p99 = 65 ms, manifest 304 p99 = 30 ms, events p99 = 103 ms (đạt SLO đặc tả: heartbeat < 300 ms, manifest < 100 ms), trong điều kiện máy bị agent khác chiếm khoảng 0,9 lõi.
- **Cảnh báo lớn nhất không nằm ở gateway mà ở consumer ghi sự kiện:** một tiến trình consumer chỉ xử lý khoảng 170 msg/s (khoảng 230 impression/s) trên máy này; ở tải 612 req/s (167 msg/s sự kiện) consumer không theo kịp trong lúc chạy, tồn đọng 1.106 sự kiện sau 90 giây xả. SLO "phát đến dashboard < 60 giây" **không đạt ở bậc 100k** với cấu hình hiện tại (mục 4.3).
- Dung lượng đo được của một gateway Node + consumer chung tiến trình + Postgres + Redis trên 2 vCPU bị chia sẻ: **khoảng 500 req/s giữ p99 < 400 ms, khoảng 1.000 req/s là điểm gãy** (p50 428 ms). Đây là cận dưới vì máy không yên tĩnh (mục 2.2).
- Chi phí CPU/request đo được khoảng 1,1 ms lõi (gateway 0,62 đến 0,77, Postgres 0,28, Redis 0,08) và 7 đến 9 lệnh Redis/request. So với giả định COST-MODEL (gateway 8.000 req/s/luồng), đo được thấp hơn khoảng 5 lần (khoảng 1.300 đến 1.600 req/s/lõi, kể cả consumer cùng tiến trình): độ lệch > 30%, đặc tả yêu cầu dừng và xem lại bảng chi phí hạ tầng riêng (mục 6).

## 2. Phương pháp

### 2.1 Bộ công cụ `tools/load` (package `@ams/load`)

- `src/run.ts` (orchestrator): khởi động **embedded-postgres 16.15 thật** (fsync=on, synchronous_commit=on, shared_buffers 128 MB, max_connections 100) và **redis-server 7.0.15 thật** (không AOF, không snapshot), chạy migration của `@ams/api`, nạp chiến dịch mẫu (3 chiến dịch, 6 creative, ví quảng cáo đủ tiền để đường chi tiêu thật `@ams/payments` luôn chạy), chèn thiết bị (đã ghép đôi, trust 1) trực tiếp vào Postgres, rồi chạy **gateway (`@ams/edge-gateway/node` = `startNode`) và ingest-consumer (`@ams/ingest-consumer/node`) cùng tiến trình** với `createDockerRuntime` (pg Pool + ioredis). S3 là bản giả của e2e (gateway đọc `renditions/...` khi dựng manifest). Đo CPU/RAM từ `/proc` cho tiến trình gateway, cây tiến trình Postgres, Redis; số lệnh Redis từ `INFO`; số transaction từ `pg_stat_database`.
- `src/gen.ts` (generator, tiến trình con riêng): gọi **HTTP thật qua loopback**, ký Ed25519 thật theo DEVICE-PROTOCOL mục 3 (nonce mới mỗi request), keep-alive. Ba chế độ: `ramp` (mở vòng theo rps cố định, đến Poisson, **ký sẵn** để generator tốn ít CPU khi đo, độ trễ tính từ thời điểm DỰ KIẾN gửi nên không bị coordinated omission), `fleet` (mỗi thiết bị tuân theo `next_interval`/`Retry-After` do máy chủ trả, poll manifest 900 s, lô sự kiện 600 s, có jitter, **nén thời gian** theo hệ số), `register` (đăng ký thật qua `/v1/register`).
- Độ bền: sau khi chạy, chờ hàng đợi xả rồi so `ev_ad_impression`, `impression_hourly`, `spend_events`, `ev_heartbeat` với số sự kiện/heartbeat gateway đã trả 202/200; gửi lại cùng `event_id` 3 lần để kiểm khử trùng.
- Chạy lại: `pnpm --filter @ams/load load -- --devices 50000 --ramp 250,500,1000,2000 --step-seconds 20 --cold-rps 300 --register 3000 --fleet-devices 10000 --fleet-scale 0.1 --fleet-seconds 150 --out tools/load/results/x.json`. Thêm `--fleet-capacity C` để đặt `GW_CAPACITY_RPS=C` (đo giảm tải), `nice -n -15` phía trước để tránh bị agent khác chiếm CPU.
- Mặc định của gateway được giữ nguyên (HB_MIN_GAP_S=5, EVENTS_LIMIT_PER_MIN=30, TTL cache), chỉ nới `REGISTER_LIMIT_PER_HOUR` (một IP loopback), `TELEMETRY_FLUSH_MS=2000`, và `GW_CAPACITY_RPS` rất lớn ở pha ramp để đo dung lượng thuần.

### 2.2 Môi trường và nhiễu (quan trọng)

Máy: 2 vCPU Xeon 2,1 GHz, 7,8 GB RAM, Node v22.23.4. **Gateway, consumer, generator, Postgres, Redis và các agent khác cùng tranh 2 lõi.** Trong các lần chạy, tiến trình khác (vitest, tsc, wrangler của agent song song) chiếm 0,6 đến 1,6 lõi (cột `otherProcessesCores`, load average 4 đến 26). Chạy không ưu tiên (`run-contended`) điểm gãy chỉ khoảng 420 req/s; chạy `nice -n -15` (`run-nice`) khoảng 1.000 req/s. Chờ "máy yên tĩnh" 20 đến 60 giây không bao giờ thành công, ngoại trừ một lần (`run-fleet-a`, `quietAchieved: true` ở đầu pha). Vì vậy: **độ trễ tuyệt đối ở đây là cận trên (xấu hơn máy riêng), tốc độ tối đa là cận dưới**, còn CPU-ms/request là số ổn định nhất nhưng cũng bị thổi phồng nhẹ do chuyển ngữ cảnh. Chưa có lần chạy nào trên máy riêng.

## 3. Kết quả: ramp (mở vòng, 50.000 thiết bị ký sẵn, 20 giây mỗi bậc, tỷ lệ 12 heartbeat : 4 manifest 304 : 6 lô sự kiện theo giao thức, `run-nice.json`)

Mỗi request chọn thiết bị theo vòng hoán vị trên 50.000 thiết bị, nên đa số là lần chạm "lạnh" bộ đệm thiết bị trong bộ nhớ (xấu nhất).

| rps đặt | rps đạt | heartbeat p50 / p95 / p99 (ms) | manifest 304 p50 / p95 / p99 | events p50 / p95 / p99 | lỗi | gateway CPU (lõi) | ms CPU/req gw / pg / redis | lệnh Redis/req | tx PG/req | tiến trình khác (lõi) |
|---|---|---|---|---|---|---|---|---|---|---|
| 250 | 245 | 4,6 / 67 / 120 | 4,2 / 55 / 96 | 4,9 / 66 / 121 | 0 | 0,30 | 1,22 / 0,81 / 0,15 | 9,0 | 1,62 | 1,35 |
| 500 | 505 | 9,2 / 177 / 396 | 7,1 / 164 / 374 | 9,1 / 188 / 417 | 0 | 0,42 | 0,84 / 0,50 / 0,12 | 8,6 | 1,06 | 1,13 |
| 1000 | 997 | 580 / 2.349 / 3.649 | 428 / 2.336 / 3.736 | 505 / 2.357 / 3.220 | 0 | 0,61 | 0,62 / 0,29 / 0,07 | 8,2 | 0,62 | 0,85 |
| 2000 | 867 (không giữ được) | 9.465 / 26.427 / 26.831 | 9.527 / 26.269 / 26.799 | 9.311 / 26.346 / 26.819 | 0 | 0,47 | 0,55 / 0,24 / 0,07 | 7,9 | 0,37 | 1,11 |

Cùng bậc ở lần chạy không ưu tiên (`run-contended.json`, tiến trình khác 1,3 đến 1,4 lõi): 250 rps p99 = 189 ms; 500 rps chỉ đạt 422 rps, p99 = 8,4 s; 1000 rps chỉ đạt 580. Xem mục 2.2: gateway không phải nút cổ chai duy nhất; ở bậc 1.000 hệ thống đã dùng hết 2 lõi (0,61 + 0,29 + 0,07 + generator 0,17 + khác 0,85 = 2,0). Dòng 2.000 rps dừng vì không đạt tải đặt (điều kiện dừng của bộ chạy); không có lỗi HTTP, chỉ có hàng chờ. Warmup 500 rps ở bậc đầu có p99 = 545 ms vì bộ đệm lạnh.

Độ trễ trong bảng đo từ thời điểm dự kiến gửi, nên khi quá tải hàng chờ ở generator/kernel được tính (đúng với trải nghiệm thật). Generator tốn 0,10 đến 0,17 lõi, độ trễ vòng lặp sự kiện p99 của nó 15 đến 56 ms, nên 15 đến 56 ms nhiễu từ phía generator là có thể xảy ra ở các bậc trên, không ảnh hưởng kết luận ở mức giây.

### 3.1 Manifest đầy đủ (không etag, 200 + 2.975 byte), 300 rps, 20 giây

p50 2,3 ms, p95 27,9 ms, p99 325 ms, 6.000 trên 6.000 thành công; CPU gateway 0,90 ms/request, Postgres 0,57, 4,8 lệnh Redis. Không phải nút cổ chai ở quy mô này (cache `ManifestService` 15 giây trong bộ nhớ).

### 3.2 Đăng ký thiết bị (`/v1/register`), 3.000 thiết bị, 64 song song

594 req/s, p50 102 ms, p99 224 ms, 3.000 trên 3.000 tạo thành công (3.000 hàng trong `devices`). Mỗi đăng ký tốn 0,83 ms gateway + 0,57 ms Postgres, 2,5 transaction và 5 lệnh Redis (có kiểm tra chữ ký Ed25519, INSERT devices + device_attestations). Đây là con số cho cơn bão kích hoạt hàng loạt: đăng ký 1M thiết bị = khoảng 28 phút một gateway.

## 4. Kết quả: đội thiết bị ảo theo giao thức (chu kỳ do máy chủ điều khiển, nén thời gian)

Hệ số nén `s` nghĩa là thời gian chờ nhân với `s`. Đội N thiết bị ảo nén `1/s` lần có tải request bằng đội `N/s` thiết bị thật (số khóa Redis/bộ nhớ thì vẫn chỉ của N thiết bị, nên **không** kiểm chứng sức chứa bộ nhớ/khóa của đội lớn).

### 4.1 `run-fleet-a`: 10.000 thiết bị x10 (tương đương 100.000 thiết bị thật), 150 giây

| | số lượng | p50 | p95 | p99 |
|---|---|---|---|---|
| heartbeat (sau 30 s) | 41.318 | 4,1 ms | 21,8 ms | **65 ms** |
| manifest 304 (sau 30 s) | 10.042 | 2,1 | 9,4 | **30** |
| events (sau 30 s) | 20.012 | 4,7 | 26,2 | **103** |
| tất cả (sau 30 s) | 71.372 | 3,8 | 22,0 | 69 |

- Tốc độ cả pha: 612 req/s (lý thuyết `100.000 x 0,006111 = 611`, khớp). 0 lỗi (0 trên 92.767). Chu kỳ do máy chủ trả: cơ sở 300 s, giá trị `next_interval` trong 240 đến 360 s, trung bình 300,2 s (đúng jitter ±20%, không lệch).
- **Bão khởi động** (10.000 thiết bị bật trong 6 giây = 3.300 req/s vào máy chịu được khoảng 1.000): p99 gồm cả đoạn này 4,5 s cho heartbeat, 2,8 s cho manifest đầy đủ, không lỗi, vì `GW_CAPACITY_RPS` đặt rất lớn nên không giảm tải. Nghĩa là bậc "100k thiết bị cùng bật trong 60 giây" (3.333 req/s) **không đạt p99 < 300 ms trên máy này**; cần giảm tải có chủ đích hoặc nhiều gateway.
- Tài nguyên: gateway 0,47 lõi (0,77 ms/req), Postgres 0,17 lõi (0,28 ms/req), Redis 0,05 lõi (0,08 ms/req), 7,1 lệnh Redis và 0,62 transaction Postgres mỗi request; RSS tiến trình gateway+consumer 332 MB, Postgres 170 MB, Redis 51 MB; 159.336 khóa Redis dùng 37,8 MB (237 byte/khóa). `otherProcessesCores` = 0,92.
- 100% khử trùng: gửi lại cùng `event_id` 3 lần (nonce mới) cho 202 cả 3 lần, đúng 1 hàng trong `ev_ad_impression`.

### 4.2 `run-fleet-c`: 2.000 thiết bị x10 (tương đương 20.000 thiết bị thật), 150 giây

124 req/s, 0 lỗi, p99 sau 30 s: heartbeat 8 ms, manifest 304 5 ms, events 8 ms. Hàng đợi xả hết (backlog 0). CPU gateway 1,32 ms/req (cao vì tải nhẹ, chi phí cố định của timer/consumer trên ít request).

### 4.3 Độ bền và độ trễ ghi sự kiện (mục quan trọng)

| Lần chạy | sự kiện gateway trả 202 | có trong `ev_ad_impression` | tồn đọng sau xả | ghi chú |
|---|---|---|---|---|
| `run-fleet-c` (20k tương đương) | 8.173 | 8.173 | 0 | đủ, không trùng |
| `run-fleet-a` (100k tương đương) | 33.872 | 32.766 sau 90 s chờ | **1.106** (đang xả) | consumer không theo kịp; không có lỗi (`errors: 0`), chỉ chậm |
| `run-nice` (ramp tới 2.000 rps) | 87.284 | 20.379 sau 90 s chờ | 66.905 | quá tải nặng, consumer chỉ xử lý 20 đến 21 nghìn trong ~6 phút |

Mọi sự kiện đã xử lý đều nhất quán: `ev_ad_impression` = `COUNT(DISTINCT event_id)` = `impression_hourly` = `spend_events` (trong sai số của các câu lệnh đếm tách rời ở lần đầu, đã sửa thành một câu SQL ở các lần sau): **không mất, không trùng**, chi tiêu thật đã chạy (`spendCalls` 27.550 ở `fleet-a`). Heartbeat: `ev_heartbeat` >= số heartbeat 200 trong mọi lần chạy (vd 55.406 = 55.406 ở `fleet-a`); dòng thừa là heartbeat đang bay lúc generator kết thúc.

Tốc độ xả đo được khi gateway rảnh (chuỗi `drainSeries` trong `run-fleet-a.json`): khoảng 228 impression/s (11.245 tăng lên 29.460 trong 80 s), tức khoảng 170 msg/s. Tốc độ vào ở 100k-tương đương là `100.000/600 = 167` msg/s (khoảng 222 impression/s): **bằng trần đo được của một consumer**, trong khi consumer còn tranh CPU với gateway. Nguyên nhân khả dĩ (chưa phân tích sâu): mỗi message làm một lượt chi tiêu `spendPerEvent` với `db.batch`, `settleRemainder` trong transaction và `existingIds`/`append`, tuần tự một message mỗi lần. Gợi ý: gom nhiều message theo chiến dịch trong cửa sổ ngắn trước khi chi tiêu/ghi.

### 4.4 `run-fleet-b`: giảm tải do máy chủ điều khiển (`GW_CAPACITY_RPS=800`, 10.000 thiết bị x20 = 200k tương đương, 150 giây)

Tải chào 2.000+ req/s so với trần khai báo 800: gateway bắt đầu giãn chu kỳ (`interval_base` đo được tăng từ 300 lên tới 927 s, `next_interval` tối đa 1.112 s, trung bình 380 s) và trả 503 + `Retry-After`: 53.332 trên 106.909 request (50%) bị 503, 0 lỗi 5xx khác, 0 lỗi 429. p50 heartbeat 1,6 ms (503 rất rẻ), p99 toàn bộ 2,85 s (các request được nhận vẫn xếp hàng). Kết luận: cơ chế `next_interval`/`Retry-After`/503 hoạt động đúng thiết kế, **nhưng 50% request thừa vẫn quay lại** vì thiết bị ảo thử lại theo `Retry-After`, và lô sự kiện bị 503 (6.055) không được thiết bị ảo gửi lại (app thật phải giữ lô). Ở thiết kế này, trần mặc định `GW_CAPACITY_RPS=5000` quá cao so với dung lượng đo được (khoảng 1.000 req/s một gateway trên máy chia sẻ này): gateway sẽ không tự bảo vệ trước khi bị quá tải thật.

## 5. Ngoại suy 1M và 10M (tính, không đo)

Giả định: tải mỗi request không đổi theo quy mô (chi phí CPU không phụ thuộc N), 60% CPU là mức vận hành, mọi thiết bị đang phát (chu kỳ 300 s), đỉnh = 1,5 x steady. Đây là cận dưới nhu cầu vì không tính hiệu ứng phi tuyến.

Số liệu nền (đo): gateway+consumer 0,7 ms, Postgres 0,3 ms, Redis 0,08 ms lõi mỗi request; 7,5 lệnh Redis/request; 237 đến 290 byte/khóa Redis; nonce sống 600 s (`NONCE_TTL_S`), mỗi request chiếm một khóa nonce.

| | 100k | 1M | 10M |
|---|---|---|---|
| steady = N x 0,006111 | 611 | 6.111 | 61.111 |
| đỉnh x1,5 | 917 | 9.167 | 91.667 |
| lõi gateway = đỉnh x 0,0007 / 0,6 | 1,07 | 10,7 | 107 |
| lõi Postgres = đỉnh x 0,0003 / 0,6 | 0,46 | 4,6 | 45,8 |
| lệnh Redis/s = đỉnh x 7,5 | 6,9k | 68,8k | 687,5k |
| khóa Redis = steady x 600 + 2N | 0,57M | 5,7M | 56,7M |
| RAM Redis (x 240 đến 290 B) | 0,14 đến 0,16 GB | 1,4 đến 1,6 GB | 14 đến 16 GB |
| consumer = (N/600) / 170 msg/s | 0,98 | 9,8 | 98 |
| băng thông vào (khoảng 0,9 KB/request x steady) [giả định kích thước] | 0,6 MB/s | 5,5 MB/s | 55 MB/s |

Kết luận nhận xét: (1) 1M cần khoảng 11 tiến trình Node gateway, một Postgres chịu 5.700 transaction/s có fsync (không thực tế nếu mỗi sự kiện còn là một lần ghi), và 10 consumer. (2) 10M không thể chạy trên kiến trúc hiện tại (107 lõi gateway, 46 lõi Postgres, 14 primary Redis, 16 GB bộ nhớ khóa nonce): cần đúng như COST-MODEL đề xuất, bỏ Postgres khỏi đường nóng (ClickHouse/Redpanda), đẩy nonce sang Durable Objects/Cloudflare, và tách presence khỏi Redis theo cụm. (3) **Rủi ro suy ra từ mã, chưa đo ở quy mô đó** (đội 50.000 thiết bị của ramp chu kỳ lại sau khoảng 180 s, nên không phát hiện): `DeviceDirectory` giữ tối đa 50.000 thiết bị trong bộ nhớ, TTL bộ nhớ 30 s và TTL khóa `dev:<id>` 300 s, trong khi chu kỳ heartbeat là 240 đến 360 s: khoảng một nửa heartbeat (những lần `next_interval` > 300 s) sẽ trượt cả hai cache và chạy `SELECT ... JOIN screens` trên Postgres ngay trong đường nóng. Ở 1M đó là khoảng 1.000 truy vấn/s thêm vào. Presence cũng có TTL 360 s (`PRESENCE_TTL_S`) nhỏ hơn chu kỳ rảnh 600 s (và 1.200 s khi giãn x4): thiết bị rảnh bị coi là offline giữa hai heartbeat.

## 6. So với COST-MODEL

- COST-MODEL dùng heartbeat 120 s (tải 11.111 req/s ở 1M); gateway mặc định 300 s (6.111 req/s): chi phí Cloudflare theo COST-MODEL cao hơn khoảng 1,9 lần so với thiết kế gateway thực (tải 1,8 lần; theo bảng nhạy cảm "heartbeat 300 giây" của chính COST-MODEL: 82.877 so với 158.151 USD/tháng ở 10M, phương án A).
- COST-MODEL giả định gateway Go 8.000 req/s/luồng có TLS [ƯT]. Đo thật (Node, đã gồm consumer cùng tiến trình, không TLS): khoảng 1.300 đến 1.600 req/s/lõi. Chênh khoảng 5 lần; Redis đo 7 đến 9 lệnh/request (COST-MODEL không chỉ ra), tương đương 10k req/s/primary ở 80k lệnh/s. Điều kiện dừng của đặc tả (đo lệch > 30%) áp dụng: bảng "hạ tầng riêng" phải được tính lại (số máy gateway tăng, và số Redis tăng).
- COST-MODEL nhắc `tools/loadtest` để đo trước khi tin: công cụ đo thật hiện là `tools/load` (Postgres/Redis thật, HTTP thật); `tools/sim` chỉ đo trong bộ nhớ.

## 7. Mức đã chứng minh so với yêu cầu

| Bậc | Trạng thái | Bằng chứng |
|---|---|---|
| 10k | Đạt, thừa dư | fleet-c: 20k tương đương, p99 <= 8 ms, 0 lỗi, không tồn đọng |
| 100k | Đạt p99 heartbeat/manifest/events khi tải đều; **không đạt** độ trễ ghi sự kiện (consumer) và bão khởi động | fleet-a (mục 4.1, 4.3) |
| 1M | **Chưa chứng minh**; ngoại suy cần khoảng 11 gateway + shard Postgres/Redis | mục 5 |
| 10M | **Không khả thi trên kiến trúc này**, ngoại suy | mục 5 |

## 8. Hạn chế và việc còn lại

- Một máy 2 vCPU dùng chung (mục 2.2); chưa có lần chạy trên máy riêng, chưa có TLS, chưa có mạng thật, generator và gateway cùng máy.
- Chưa đo: gateway nhiều instance, bộ nhớ đệm thiết bị ở 1M thiết bị thật (mục 5, rủi ro 3), mất điện giữa chừng (độ bền khi gateway/Redis chết: Redis chạy không AOF), Cloudflare thật, Postgres trên đĩa thật (embedded-postgres, `persistent: false`).
- Bậc 50.000 thiết bị trong ramp được chứng minh chỉ ở mức "đủ thiết bị để không có đồng bộ"; không có lần nào mở 50.000 kết nối đồng thời.
- Điểm "bão khởi động" mới đo ở 10.000 thiết bị trong 6 giây, chưa đo 100k trong 60 giây thật.
- Đề xuất xem `ops/agents/t3-load-slo.requests.md`.
