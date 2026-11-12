STATUS: done
UPDATED: 2026-11-12T14:21:12Z

# P0 domain (DOMAIN-REVISION-PROPOSAL mục 1-4)

## Đã làm
1. State machine chiến dịch: packages/shared/src/campaign-state.ts (bảng chuyển trạng thái, assertTransition, transitionCampaign = UPDATE có điều kiện WHERE state IN (...)). Mọi thay đổi campaigns.state trong services/api và services/payments đi qua module này; sai/đua nhau trả 409 invalid_state. Test quét mã nguồn cấm UPDATE state ngoài module.
2. Outbox (migration 0004): runtime/outbox.ts (enqueue/process/lease/backoff/dead/prune), api/outbox.ts (campaign.approved -> reserve -> manifest.bump idempotent). Chạy từ node (worker riêng), cloudflare (cron mỗi phút + drain inline) và test. reconcileApprovals vá khoảng hở D1.
3. device_commands thay danh sách KV: edge-gateway/commands.ts, POST /v1/commands/ack, giao lại sau 120s, hết hạn bởi sweeper, audit_log khi enqueue. Cập nhật docs/DEVICE-PROTOCOL.md (mục 6, 6.1) và tools/sim.
4. Chi tiêu + dedupe sự kiện thành một đơn vị idempotent: bảng spend_events (claim token), settleRemainder, sweeper; ingest-consumer ghi spend trước khi append sự kiện.

## Kiểm tra (đã chạy thật)
- pnpm typecheck: sạch. pnpm test: config 8, shared 45, web-admin 36, db 4, runtime 34, payments 70, ingest-consumer 13, edge-gateway 49, sim 10, api 161: tất cả pass.
- pnpm e2e:smoke (Postgres 16 + Redis thật): 35 PASS, 0 FAIL, 0 SKIP (thêm S30-S34).

## Rủi ro còn lại
- D1 không có giao dịch tương tác: các bước ledger nhiều câu lệnh (reserve/release/spend) không nguyên tử; crash giữa chừng có thể làm ví reserve đôi hoặc thiếu ledger entry. Settle chi tiêu trên D1 chỉ có thể mất vài VND (không bao giờ tính đôi).
- Approve -> insert outbox không nguyên tử trên D1 (đã có reconcileApprovals).
- reject/end/delete hoàn tiền trước khi chuyển trạng thái, chưa đưa vào outbox.
- Đường Cloudflare worker/cron mới chỉ typecheck, chưa chạy thật. wrangler.toml thêm cron "* * * * *".
- spend_events tăng 1 dòng/impression (dọn sau 7 ngày); thêm 2 thao tác kv/sự kiện.
- Heartbeat dựa cờ kv cmdflag:<device> (sweep sửa khi lệch). Chưa có kick qua Queue.
- Không chạy git commit/push.
