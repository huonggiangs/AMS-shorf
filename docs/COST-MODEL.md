# AMS: mô hình chi phí hạ tầng / tháng (100k, 1M, 10M, 50M thiết bị online)

Mã tính: `docs/cost-model/cost.py` (tham số hóa; chạy `python3 docs/cost-model/cost.py --sens`). Kết quả chạy lưu ở `docs/cost-model/output.txt` (hiệu chỉnh 2026-11-13, xem mục 0). Số ở mục 0 và mục 1 là **hiện hành**; các bảng ở mục 4, 5, 6 và bảng nhạy cảm là số **CŨ** của lần chạy 2026-11-12 (heartbeat 120 giây, gateway 8.000 req/s/luồng), giữ để đối chiếu và được đánh dấu "[CŨ]"; số hiện hành của chúng nằm ở `output.txt` (`python3 docs/cost-model/cost.py --sens`). USD, chưa gồm VAT, chưa gồm chiết khấu Enterprise.

Quy ước nhãn: **[nguồn]** = lấy từ trang giá/tài liệu đã truy cập; **[ƯT]** = ước tính của tác giả, không có nguồn, phải đo ở giai đoạn 1 trước khi tin.

## 0. Hiệu chỉnh 2026-11-13 theo số đo thật (đọc trước)

Đặc tả dừng khi số đo lệch quá 30% so với giả định; `docs/LOAD-TEST-REPORT.md` mục 6 đã vượt ngưỡng đó. Ba hiệu chỉnh, mỗi cái nêu nguồn:

1. **Chu kỳ heartbeat 120 giây thành 300 giây.** Gateway thật mặc định 300 giây khi đang phát (600 giây khi rảnh, `docs/SLO.md` mục 1; đo: trung bình 300,2 giây). Đây là sửa lại giả định cho khớp mã, không phải tối ưu mới. Mọi số Cloudflare giảm khoảng một nửa, và chính bảng nhạy cảm cũ "heartbeat 300 giây" đã có sẵn số này (A 82.877, D 23.165 ở 10M).
2. **Thông lượng gateway: 8.000 req/s/luồng [ƯT, Go + TLS] thành 1.450 req/s/luồng [đo]** (Node, gồm consumer cùng tiến trình, không TLS, khoảng giữa của 1.300 đến 1.600 req/s/lõi, máy 2 vCPU chia sẻ). Lệch khoảng 5,5 lần. Kèm theo: Redis **7,5 lệnh/request** [đo, trước đây chỉ tính 1 lệnh/heartbeat], nên số primary Redis tăng. Số này chưa gồm TLS và chưa đo trên phần cứng riêng: Zen4 có thể nhanh hơn, TLS làm chậm hơn; đo lại trước khi tin các cột 10M, 50M.
3. **Consumer ghi sự kiện: 170 msg/s thành khoảng 790 msg/s/tiến trình [đo]** sau khi gộp lô (`ops/agents/x4-perf-fix.md`, `tools/load --consumer-bench`). Mô hình bổ sung dòng số tiến trình consumer = (N/600)/790; CPU của consumer đã nằm trong con số 1.450 req/s/lõi (đo trước khi gộp lô) nên số máy là cận trên.

Phần Cloudflare (A đến D) chỉ bị ảnh hưởng bởi hiệu chỉnh 1; hiệu chỉnh 2 và 3 chỉ ảnh hưởng hạ tầng riêng.

Chênh lệch so với bản cũ (USD/tháng, online 8 giờ/ngày; VN gồm nhân sự và khấu hao):

| Quy mô | Cloudflare A cũ -> mới | Cloudflare D cũ -> mới | VN riêng cũ -> mới | Số máy VN cũ -> mới (gateway, Redis) |
|---|---|---|---|---|
| 100k | 1.665 -> 914 (-45%) | 550 -> 317 (-42%) | 6.944 -> 6.936 (0%) | 5 -> 5 (1 -> 1, 2 -> 2) |
| 1M | 15.917 -> 8.390 (-47%) | 4.762 -> 2.419 (-49%) | 12.846 -> 12.768 (-1%) | 6 -> 6 (1 -> 1, 2 -> 2) |
| 10M | 158.151 -> 82.877 (-48%) | 46.599 -> 23.165 (-50%) | 24.363 -> 27.987 (+15%) | 19 -> 28 (2 -> 4, 4 -> 12) |
| 50M | 794.772 -> 418.402 (-47%) | 237.013 -> 119.842 (-49%) | 54.874 -> 79.351 (+45%) | 52 -> 110 (7 -> 20, 12 -> 58) |

Tóm tắt Cloudflare mới (USD/tháng): A: 914 / 8.390 / 82.877 / 418.402; B: 568 / 4.934 / 48.317 / 245.602; C: 396 / 3.206 / 31.037 / 159.202; D: 317 / 2.419 / 23.165 / 119.842 (100k / 1M / 10M / 50M).

**Hệ quả quan trọng, nói thẳng:** (a) Cloudflare rẻ đi gần một nửa trong khi hạ tầng riêng đắt lên ở 10M và 50M, nên điểm giao nhau dịch mạnh về phía Cloudflare: A từ ~0,45M lên ~0,87M thiết bị; D từ ~3,3M lên ~13,8M. Kết luận cũ "giữ Cloudflare đến khoảng 3 triệu rồi chuyển" nay thành "đến khoảng 5 đến 14 triệu tùy phương án, và nhạy cảm với bậc nhân sự"; (b) ở 100k và 1M phần lớn chi phí riêng là nhân sự, nên gần như không đổi; (c) các con số riêng ở 10M, 50M vẫn dựa vào nhiều [ƯT] (broker, ClickHouse, Redis 80k lệnh/s) và vào số đo của MỘT máy 2 vCPU chia sẻ, không phải đo trên 10M thiết bị. Bảng nhạy cảm đầy đủ ở `output.txt`.

Chi phí mỗi thiết bị/tháng mới: Cloudflare A $0,0083 đến $0,0091; D $0,0023 đến $0,0032; VN riêng $0,0694 / $0,0128 / $0,0028 / $0,0016 ở 100k / 1M / 10M / 50M.

## 1. Khối lượng tải

Heartbeat **300 giây** (mặc định gateway, hiệu chỉnh mục 0; đặc tả mục 3 ghi 120 giây), gộp sự kiện 10 phút, poll manifest 15 phút, telemetry gộp vào heartbeat (không thêm request).

| Thiết bị online | Heartbeat/s | Lô sự kiện/s | Manifest/s | Tổng đỉnh req/s | Request/tháng (online 8 giờ/ngày) [ƯT giờ online] |
|---|---|---|---|---|---|
| 100k | 333 | 167 | 111 | 611 | 0,5 tỷ |
| 1M | 3.333 | 1.667 | 1.111 | 6.111 | 5,3 tỷ |
| 10M | 33.333 | 16.667 | 11.111 | 61.111 | 52,8 tỷ |
| 50M | 166.667 | 83.333 | 55.556 | 305.556 | 264,0 tỷ |
(Bản cũ, heartbeat 120 giây: 1.111 / 11.111 / 111.111 / 555.556 req/s và 1,0 / 9,6 / 96 / 480 tỷ request/tháng.)

- Đỉnh giả định toàn bộ N online (18:00 đến 21:30). Chi phí tháng cần thêm số giờ online/ngày của mỗi thiết bị: đặc tả không nêu; dùng **8 giờ [ƯT]**, nhạy cảm tuyến tính (mục 6).
- Đặc tả ghi 140.000 req/s cho impression; với gộp 10 phút phép tính ra 83.333. Mô hình dùng 600 giây theo mô tả; gộp 300 giây (gần 140k/s) được tính ở mục 6.
- Khối lượng sự kiện: 8 impression/giờ/TV (đặc tả); hàng đầu vào 100 byte/impression, 40 byte/heartbeat chưa nén [ƯT].

## 2. Đơn giá Cloudflare (truy cập 2026-11-12)

| Dịch vụ | Đơn giá dùng trong mô hình | Nguồn |
|---|---|---|
| Workers Paid | $5/tháng; 10 triệu request đầu miễn phí, sau đó $0,30/triệu; 30 triệu ms CPU miễn phí, sau đó $0,02/triệu ms; không tính theo thời gian chờ, không tính băng thông | developers.cloudflare.com/workers/platform/pricing/ |
| Queues | 1 triệu thao tác/tháng miễn phí, sau đó $0,40/triệu; mỗi message tối thiểu 3 thao tác (ghi, đọc, xóa), mỗi 64 KB tính một thao tác; tối đa 128 KB/message, 5.000 msg/s/hàng đợi, 25 GB backlog/hàng đợi | .../queues/platform/pricing/ và .../limits/ |
| Durable Objects | Request: 1 triệu miễn phí, $0,15/triệu; thời gian: 400.000 GB-s miễn phí, $12,50/triệu GB-s; SQLite: ghi dòng 50 triệu miễn phí, $1,00/triệu; lưu $0,20/GB-tháng; giới hạn mềm 1.000 req/s/đối tượng | .../durable-objects/platform/pricing/ và .../limits/ |
| KV | Đọc: 10 triệu miễn phí, $0,50/triệu; ghi và xóa: $5,00/triệu; lưu $0,50/GB | .../kv/platform/pricing/ |
| D1 | Ghi 50 triệu dòng miễn phí, $1,00/triệu; đọc 25 tỷ dòng miễn phí, $0,001/triệu; lưu $0,75/GB; tối đa 10 GB/DB, xử lý tuần tự (khoảng 1.000 query/s khi 1 ms/query) | .../d1/platform/pricing/ và .../limits/ |
| R2 | Lưu $0,015/GB-tháng; Class A $4,50/triệu; Class B $0,36/triệu; egress miễn phí; miễn phí 10 GB, 1 triệu A, 10 triệu B | developers.cloudflare.com/r2/pricing/ |
| Pipelines | Ingest miễn phí; giao Parquet vào R2 $0,06/GB (dữ liệu chưa nén); 50 GB miễn phí. Trang không nêu rõ beta hay GA | .../pipelines/platform/pricing/ |
| Analytics Engine | $0,25/triệu data point sau 10 triệu miễn phí; trang ghi "billing is not active yet" tại ngày truy cập, nên giá có thể bật bất kỳ lúc nào | .../analytics/analytics-engine/pricing/ |
| Argo / Load Balancing / Enterprise | **Không tính**: chưa truy cập trang giá; Enterprise thương lượng. Coi là chưa biết | n/a |

DO duration tính 128 MB cố định/đối tượng, luôn thức trong giờ online [ƯT, bảo thủ]. Số DO hoạt động: khoảng 10.000 thiết bị/DO (16, 128, 1.024, 8.192 DO) [ƯT]; shard 4096 trong bảng `devices` có thể gộp vào cùng một DO.

## 3. Ba cách ghép đường nóng trên Cloudflare

| Phương án | Heartbeat | Sự kiện (impression) | Manifest |
|---|---|---|---|
| A (đúng đặc tả) | Worker, DO presence và **mỗi heartbeat một message Queue** | Queue | Worker + KV |
| B | Worker, DO presence (không Queue) | Queue | Worker + KV |
| C | như B | Gửi thẳng vào Pipelines (ingest miễn phí), khử trùng ở bước xử lý sau | như B |
| D | như C | như C | **CDN cache/R2 công khai, không qua Worker** |

Hạn chế của C và D (phải chấp nhận để đạt giá): mất Queue làm bộ đệm tin cậy trước ledger; tiền chỉ nên tính từ lô đã qua bước khử trùng, nên độ trễ đối soát tăng lên. Pipelines cần xác nhận trạng thái GA và SLA trước khi dùng cho dữ liệu tính tiền.

## 4. Chi phí Cloudflare theo từng dòng (USD/tháng) [CŨ: heartbeat 120 giây; số hiện hành ở mục 0 và output.txt]

Phương án A (đúng đặc tả):

| Dòng | 100k | 1M | 10M | 50M |
|---|---|---|---|---|
| Workers: phí cơ bản | 5 | 5 | 5 | 5 |
| Workers: request | 285 | 2.877 | 28.797 | 143.997 |
| Workers: CPU (2/5/1 ms cho heartbeat/lô/manifest [ƯT]) | 45 | 451 | 4.511 | 22.559 |
| Queues | 1.036 | 10.368 | 103.680 | 518.400 |
| Durable Objects: request | 108 | 1.080 | 10.800 | 54.000 |
| Durable Objects: thời gian | 17 | 172 | 1.411 | 11.320 |
| Durable Objects: ghi SQLite (snapshot 1/phút/DO [ƯT]) | 0 | 0 | 0 | 68 |
| KV: đọc | 79 | 835 | 8.395 | 41.995 |
| D1, quản trị, cố định [ƯT] | 60 | 60 | 60 | 60 |
| Pipelines: giao Parquet | 0 | 26 | 285 | 1.437 |
| R2: lưu (sự kiện 12 tháng + media 2 TB [ƯT]) | 31 | 37 | 103 | 396 |
| R2: Class B (1 creative/thiết bị/ngày [ƯT]) | 0 | 7 | 104 | 536 |
| Băng thông (egress R2 miễn phí) | 0 | 0 | 0 | 0 |
| **Tổng A** | **1.665** | **15.917** | **158.151** | **794.772** |

Phương án D (Queue bỏ, manifest qua CDN):

| Dòng | 100k | 1M | 10M | 50M |
|---|---|---|---|---|
| Workers: request | 256 | 2.589 | 25.917 | 129.597 |
| Workers: CPU | 43 | 431 | 4.319 | 21.599 |
| Queues | 0 | 0 | 0 | 0 |
| Durable Objects (request + thời gian + ghi) | 125 | 1.252 | 12.211 | 65.388 |
| KV: đọc | 31 | 355 | 3.595 | 17.995 |
| Pipelines + R2 + cố định + phí cơ bản | 96 | 135 | 557 | 2.434 |
| **Tổng D** | **550** | **4.762** | **46.599** | **237.013** |

Tóm tắt bốn phương án (USD/tháng):

| | 100k | 1M | 10M | 50M |
|---|---|---|---|---|
| A: đúng đặc tả | 1.665 | 15.917 | 158.151 | 794.772 |
| B: bỏ Queue cho heartbeat | 801 | 7.277 | 71.751 | 362.772 |
| C: B + sự kiện vào Pipelines | 629 | 5.550 | 54.471 | 276.373 |
| D: C + manifest qua CDN | 550 | 4.762 | 46.599 | 237.013 |

Hai điều cần nhớ: (1) Queues chiếm 65% phương án A ở mọi quy mô lớn, và thiết kế đặc tả (mỗi heartbeat một message) cần ít nhất 100 hàng đợi ở 50M vì trần 5.000 msg/s/hàng đợi; (2) Workers request + CPU luôn còn lại, khoảng 151k USD ở 50M (D), không có cách nào né nếu heartbeat đi qua Worker.

Ngoài mô hình, ghi presence bằng KV (một lần ghi/heartbeat) sẽ tốn $36k, $360k và $1,8 triệu/tháng ở 1M, 10M, 50M: **cấm**. Analytics Engine ghi mỗi heartbeat sẽ tốn thêm khoảng $1,8k, $18k, $90k nếu Cloudflare bật tính phí: chỉ dùng cho số liệu đã gộp.

## 5. Hạ tầng riêng (đường nóng; Cloudflare giữ CDN, WAF, DNS, media) [CŨ: heartbeat 120 giây; số hiện hành ở mục 0 và output.txt]

Kích thước theo tải đỉnh (không theo tháng), nhân đôi dự phòng. Tất cả tham số hiệu năng là **[ƯT]**: 8.000 req/s/luồng cho gateway Go có TLS (đã thay bằng số đo 1.450 req/s/luồng Node ở mục 0), 100 MB/s/broker Redpanda, 300.000 dòng/s/node ClickHouse, 80.000 op/s/primary Redis; tính nén 5 lần, nhân bản 2 lần. Công cụ đo thật là `tools/load` (`make load`).

Giá tham chiếu máy chủ:

| Lựa chọn | Giá | Nguồn |
|---|---|---|
| Hetzner AX102 (Ryzen 9 7950X3D 16 nhân, 128 GB, 2x1,92 TB NVMe, 1 Gbit/s không giới hạn, Phần Lan/Đức) | EUR 104/tháng chưa VAT, phí lắp EUR 269; quy đổi 1,10 USD/EUR [ƯT] | whtop.com/plans/hetzner.com/144081 (niêm yết 2026-02-13; Hetzner có thể đã điều chỉnh giá, xem docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/) |
| VN bare-metal (Vinahost): Xeon 18 nhân, 32 GB, 2x240 GB SSD | $344,25/tháng chưa VAT 10%; thêm RAM +8 GB giá $10, SSD 1,92 TB $65; băng thông 100 Mbps chung, nâng 900 Mbps +$585 | vinahost.vn/en/best-dedicated-server-vietnam (truy cập 2026-11-12) |
| Mô hình VN dùng | $344,25 + 64 GB RAM + SSD 1,92 TB = ~$490/máy [ƯT cấu hình]; hiệu năng/luồng bằng 0,6 Zen4 [ƯT]; băng thông $650/Gbps (suy ra từ $585/0,9 Gbps) | tính từ nguồn trên |
| Nhân sự vận hành | 0,5 / 2 / 3 / 5 FTE ở 100k / 1M / 10M / 50M, $3.500/FTE/tháng [ƯT] | không có nguồn |
| Chuyển đổi | $60.000 khấu hao 24 tháng [ƯT] (8 đến 12 tuần kỹ sư, dual-write) | không có nguồn |
| Cloudflare CDN/WAF/media giữ lại | ~$200/tháng + R2 media [ƯT]; **chưa xác minh** gói Cloudflare nào đủ cho tải này | không có nguồn |

Kết quả (USD/tháng):

| | 100k | 1M | 10M | 50M |
|---|---|---|---|---|
| Số máy (gateway / Redpanda / ClickHouse / Redis / Postgres) | 5 | 6 | 19 (2/3/6/4/4) | 52 (7/3/26/12/4) |
| Băng thông đỉnh trung bình 3 KB/request [ƯT] | 0,0 Gbps | 0,3 | 2,7 | 13,3 |
| ClickHouse lưu (nén, nhân đôi, 12 tháng impression) | 0,1 TB | 1,0 | 9,8 | 48,8 |
| **Tổng VN (gồm nhân sự + khấu hao)** | 6.944 | 12.846 | 24.363 | 54.874 |
| Trong đó chưa gồm nhân sự và khấu hao | 2.694 | 3.346 | 11.363 | 34.874 |
| Tham chiếu EU Hetzner (chưa đạt dữ liệu trong nước, RTT lớn) | 5.052 | 10.424 | 15.050 | 25.114 |

Ở 50M, ClickHouse 26 node chủ yếu vì lưu 12 tháng impression thô trên đĩa; chuyển dữ liệu nguội sang S3 giảm mạnh số node (đề xuất P1 trong COMMERCIAL-RECOMMENDATIONS.md). Đặc tả gợi ý Redpanda 12 đến 24 broker, ClickHouse 12 đến 24 node, Redis 24 đến 48 node; mô hình này ra ít hơn ở Redpanda và Redis (băng thông bản tin chỉ khoảng 100 MB/s) và tương đương ở ClickHouse. Hai bên chênh lệch lớn nên cần đo thật.

## 6. So sánh và điểm giao nhau [CŨ: heartbeat 120 giây; số hiện hành ở mục 0 và output.txt]

Chi phí trên mỗi thiết bị online/tháng và trên 1.000 impression (8 giờ/ngày, 8 impression/giờ):

| | 100k | 1M | 10M | 50M |
|---|---|---|---|---|
| Cloudflare A | $0,0167 | $0,0159 | $0,0158 | $0,0159 |
| Cloudflare D | $0,0055 | $0,0048 | $0,0047 | $0,0047 |
| VN riêng | $0,0694 | $0,0128 | $0,0024 | $0,0011 |
| Cloudflare A / 1.000 impression | $0,009 | $0,008 | $0,008 | $0,008 |
| Cloudflare D / 1.000 impression | $0,003 | $0,002 | $0,002 | $0,002 |
| VN riêng / 1.000 impression | $0,036 | $0,007 | $0,001 | $0,001 |

Cloudflare tuyến tính theo N (không có hiệu ứng quy mô), hạ tầng riêng có chi phí cố định nên giảm dần.

**Điểm giao nhau** (VN riêng gồm nhân sự và khấu hao rẻ hơn Cloudflare, quét N từ 50k; chạy trong `cost.py`):

| Phương án Cloudflare | Giao nhau |
|---|---|
| A (đúng đặc tả) | ~0,45 triệu thiết bị |
| B | ~2,3 triệu |
| C | ~3,0 triệu |
| D (tối ưu nhất) | ~3,3 triệu |

Kết luận: nếu giữ thiết kế đặc tả, chuyển sớm (khoảng 0,5 triệu). Nếu tối ưu Cloudflare theo D, giữ Cloudflare đến khoảng 3 triệu và chỉ chuyển khi vượt đó, **khớp với "giai đoạn 1 hợp lý đến 1 đến 3 triệu" của đặc tả**. Giao nhau nhạy cảm với bậc nhân sự (nhảy theo FTE) nên đọc là khoảng 1 đến 4 triệu, không phải một con số chính xác. Chi phí kỹ thuật chuyển đổi và rủi ro vận hành không được lượng hóa đầy đủ; còn quan trọng hơn chênh lệch tiền.

### Nhạy cảm (tổng USD/tháng: Cloudflare A / D / VN riêng)

| Kịch bản | 10M | 50M |
|---|---|---|
| Cơ sở (hb 120 giây, gộp 600 giây, manifest 900 giây, 8 giờ) | 158.151 / 46.599 / 24.363 | 794.772 / 237.013 / 54.874 |
| Heartbeat 30 giây | 534.521 / 163.770 / 30.167 | 2.676.625 / 822.865 / 95.847 |
| Heartbeat 60 giây | 283.608 / 85.656 / 24.631 | 1.422.057 / 432.297 / 67.191 |
| Heartbeat 300 giây | 82.877 / 23.165 / 19.126 | 418.402 / 119.842 / 43.582 |
| Heartbeat 600 giây | 57.785 / 15.354 / 18.866 | 292.945 / 80.786 / 40.814 |
| Gộp lô 300 giây (gần 140k req/s ở 50M) | 181.191 / 52.359 / 22.123 | 909.972 / 265.813 / 54.163 |
| Gộp lô 1.800 giây | 142.791 / 42.759 / 21.690 | 717.972 / 217.813 / 51.018 |
| Online 4 giờ/ngày | 79.166 / 23.391 / 20.396 | 397.668 / 118.789 / 46.014 |
| Online 12 giờ/ngày | 237.135 / 69.808 / 22.842 | 1.191.877 / 355.237 / 58.734 |
| Online 24 giờ/ngày | 474.088 / 139.433 / 26.756 | 2.383.189 / 709.910 / 77.815 |
| Thích ứng: heartbeat 300 giây, lô 1.800 giây, manifest 3.600 giây | 61.613 / 19.325 / 18.823 | 312.082 / 100.642 / 41.576 |
| CPU/request gấp đôi | 162.663 / 50.919 / 24.363 | 817.332 / 258.613 / 54.874 |
| CPU/request một nửa | 155.895 / 44.439 / 24.363 | 783.492 / 226.213 / 54.874 |

Các giả định nhạy cảm nhất, theo thứ tự:
1. **Chu kỳ heartbeat**: chi phí Cloudflare tỷ lệ nghịch với chu kỳ. Từ 120 giây lên 300 giây giảm khoảng 48% (A) hoặc 50% (D); từ 120 xuống 30 giây tăng 3,4 lần.
2. **Số giờ online/ngày** (đặc tả chỉ nêu đỉnh): tỷ lệ thuận. Thiết bị bật 24/7 thì chi phí gấp 3 so với 8 giờ.
3. **Thiết kế đường ghi** (Queue hay không): chênh 3,4 lần giữa A và D ở 50M.
4. **Gộp lô sự kiện**: ít tác động hơn dự đoán vì lô sự kiện chỉ chiếm khoảng 15% số request (6 trên 40 request/giờ/thiết bị).
5. CPU/request, chỉ ±3 đến 5%.

## 7. Cảnh báo trung thực về 50 triệu thiết bị

1. **Cloudflare thuần không hợp lý ở 50M.** Thiết kế đúng đặc tả ra khoảng **$795k/tháng**, bản tối ưu nhất khoảng **$237k/tháng** (với giả định online 8 giờ/ngày; $710k nếu 24/7). Hạ tầng riêng khoảng $55k/tháng gồm nhân sự (khoảng 4 đến 14 lần rẻ hơn), nhưng đòi hỏi đội 5 FTE và kỹ năng vận hành Kafka/ClickHouse 24/7. Hợp đồng Enterprise có thể giảm giá Cloudflare, chưa có số liệu nên không tính.
2. **Nhiều giới hạn kỹ thuật chặn trước khi chi phí chặn**: 5.000 msg/s/hàng đợi; 1.000 req/s mềm mỗi DO; D1 10 GB và tuần tự. Cần 100 hàng đợi hoặc bỏ Queue; không nên dùng D1 cho đường nóng.
3. **Tính khả thi thị trường**: 50 triệu thiết bị online cùng lúc vượt xa số hộ gia đình Việt Nam (ước tính khoảng 28 đến 30 triệu hộ [ƯT, chưa tra nguồn trong phiên này]). Nếu mục tiêu là thiết bị tại Việt Nam, 5 đến 10 triệu mới là mức thực tế; 50M chỉ nên coi là trần kiến trúc.
4. Chi phí hạ tầng trên mỗi thiết bị rất nhỏ ($0,005 đến $0,016/tháng) so với doanh thu quảng cáo tiềm năng; rủi ro thật nằm ở độ tin cậy, gian lận impression và vận hành, không nằm ở hóa đơn hạ tầng khi đã vượt qua 1M.
5. **Phát video qua CDN**: giả định phục vụ media từ R2 (egress miễn phí). Nếu phải trả băng thông, 1 creative 6 MB/thiết bị/ngày ở 50M là khoảng 9 PB/tháng [ƯT]; vì thế **giữ media trên R2 + CDN Cloudflare ngay cả ở giai đoạn 2**, và xác nhận điều khoản dịch vụ về phát video với Cloudflare (chưa kiểm tra).

## 8. Giới hạn của mô hình

- Chưa tính: phí cổng thanh toán, SMS/OTP, email, FCM, transcode, đối tác RTB, Sentry/Grafana Cloud, backup, DR đa vùng, VAT, nhà thầu pen-test.
- Không tính D1 cho `core/finance/audit` ngoài mức cố định $60 [ƯT]; lượng ghi ledger rất nhỏ so với đường nóng.
- Hiệu năng gateway/broker/ClickHouse là ước tính; `tools/loadtest` phải đo p50/p95/p99 và chi phí thực mỗi triệu thiết bị ở 100k và 1M trước khi tin các cột 10M và 50M. Điều kiện dừng của đặc tả (đo thật lệch quá 30%) áp dụng.
