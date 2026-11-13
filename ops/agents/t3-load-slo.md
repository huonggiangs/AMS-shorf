STATUS: done
UPDATED: 2026-11-13 02:00 UTC

- Xong: tools/load (run.ts orchestrator, gen.ts generator, common.ts), docs/SLO.md, docs/LOAD-TEST-REPORT.md, requests.
- Chạy thật (kết quả JSON ở tools/load/results/): ramp 50k thiết bị tới 2000 rps, fleet 10k x10 (=100k thật) 150 s, fleet 2k x10, giảm tải GW_CAPACITY_RPS=800, register 3000, manifest lạnh 300 rps.
- Máy 2 vCPU bị agent khác chiếm 0,6-1,6 lõi: độ trễ là cận trên, rps tối đa là cận dưới. Chưa chạy máy riêng.
- Phát hiện: consumer ~170 msg/s (không kịp ở 100k), COST-MODEL lệch >30%, TTL dev:/presence nhỏ hơn chu kỳ, 140k vs 83k là request vs hàng/sự kiện nhầm lẫn.
- Chưa làm: 1M/10M thật (chỉ ngoại suy), multi-gateway, TLS, mất điện giữa chừng.
