# Yêu cầu của t3-load-slo cho agent khác (đều dựa trên số đo trong docs/LOAD-TEST-REPORT.md)

## ingest-consumer / a3-gateway (services/ingest-consumer)
1. Một consumer chỉ xử lý khoảng 170 msg/s (230 impression/s); tải 100k thiết bị (167 msg/s) đã chạm trần và tồn đọng. Cần gom nhiều message theo chiến dịch trong cửa sổ ngắn trước khi gọi `spend` và `append` (hiện mỗi message: `spend_dedupe` + batch `spend_events` + `settleRemainder` trong transaction + `existingIds` + `append`), và/hoặc chạy nhiều consumer song song (kiểm tra tranh chấp hàng `campaigns` khi chi tiêu song song).
2. Consumer bị lỗi spend sẽ giao lại vô hạn không có giới hạn: nên có dead-letter/giới hạn thử lại (thấy khi ví thiếu: 2.064 lỗi trên 2.065 message).

## a3-gateway (services/edge-gateway)
1. `DeviceDirectory`: TTL khóa `dev:<id>` 300 s nhỏ hơn chu kỳ heartbeat 240 đến 360 s, bộ nhớ chỉ 50.000 mục/30 s: ở 1M thiết bị khoảng một nửa heartbeat sẽ chạy truy vấn Postgres. Đề xuất TTL kv >= 900 s.
2. `PRESENCE_TTL_S` = 360 s nhỏ hơn chu kỳ rảnh 600 s (và x4 khi giãn): thiết bị rảnh bị coi offline giữa các heartbeat. Đề xuất TTL >= 2,5 x chu kỳ tối đa (spec: online nếu last_seen < 2,5 x chu kỳ).
3. `GW_CAPACITY_RPS` mặc định 5000 cao hơn khoảng 5 lần so với dung lượng đo (khoảng 1.000 req/s một gateway trên 2 vCPU chia sẻ): đặt theo dung lượng đo trên phần cứng thật.
4. Lô sự kiện bị 503 khi giảm tải: app phải giữ và gửi lại (ghi trong DEVICE-PROTOCOL).

## f4-docs (docs/COST-MODEL.md, docs/ARCHITECTURE.md)
1. COST-MODEL giả định heartbeat 120 s, gateway mặc định 300 s; gateway Go 8.000 req/s/luồng, đo Node (kể cả consumer) khoảng 1.300 đến 1.600 req/s/lõi; điều kiện dừng 30% của đặc tả đã bị vượt: tính lại bảng hạ tầng riêng.
2. Đặc tả mục 3: 140k và 83k req/s mâu thuẫn, phân tích ở docs/SLO.md mục 5; cần chủ dự án xác nhận.

## f2-infra (Makefile, scripts/)
1. Thêm target `make load` = `nice -n -15 pnpm --filter @ams/load load -- --devices 50000 --ramp 250,500,1000 --fleet-devices 10000 --fleet-scale 0.1 --fleet-seconds 150` (cần redis-server và embedded-postgres, không cần Docker).

## f1-foundation
1. `packages/db`: không cần thay đổi. `pnpm install --filter @ams/load` đã thêm tools/load vào pnpm-lock.yaml.
