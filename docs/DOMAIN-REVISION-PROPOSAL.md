# Đề xuất sửa miền nghiệp vụ (chờ duyệt) — phản biện kiến trúc

Trạng thái: CHỜ DUYỆT. Chưa sửa code. Căn cứ: đọc repo (commit 3a68888). Nội dung chat Grok không đọc được (chỉ lấy được tiêu đề), nên phản biện dựa trên tóm tắt của bạn.

## A. Phần phản biện đúng / sai
| Ý phê bình | Đánh giá | Bằng chứng |
|---|---|---|
| Thiếu tách transactional / projected / event history | ĐÚNG MỘT PHẦN | Đã tách: tiền = ledger append-only `wallet_entries` + cache `ad_wallets` có reconcile; audit_log append-only (trigger 0002); impression → ClickHouse/`impression_hourly`. Thiếu: không có outbox, không có đường rebuild projection, không có metadata độ tươi. |
| Command path gần như chưa thiết kế | ĐÚNG | `enqueueCommand` chỉ là list trong KV (cắt 20 phần tử, TTL 7 ngày): không bảng, không trạng thái, không ack bền, không idempotency, không audit. |
| Device lifecycle chưa thiết kế | ĐÚNG | `devices.status` chỉ 'checking'/'active'; không revoke, xoay khoá, re-pair, retire; attestation chưa dùng. |
| "Chỉ là infrastructure skeleton" | SAI một phần | Có RBAC/IDOR server-side, ví + SePay HMAC + idempotency, giao thức thiết bị Ed25519, 275 test, e2e 30 bước trên Postgres/Redis thật. |
| Cần event sourcing/CQRS đầy đủ | KHÔNG CẦN | Quá mức ở quy mô hiện tại; outbox + projection là đủ. |
| Partition / tiered storage | CHƯA CẦN (P2) | Làm khi có số liệu tải thật. |

## B. Danh sách cần sửa (xin duyệt)
**P0 — trước khi chạy thật**
1. State machine chiến dịch: bảng chuyển trạng thái hợp lệ + guard trong một hàm duy nhất; hiện không có `canTransition` nào (grep rỗng). Test: mọi chuyển trạng thái sai → 409.
2. Outbox cho chuỗi approve → reserve tiền → tăng epoch manifest (hiện 3 bước rời nhau, lỗi giữa chừng gây lệch). Bảng `outbox` + worker xử lý idempotent.
3. `device_commands`: id, device_id, type, args, status (pending/delivered/acked/failed/expired), expires_at, idempotency_key, audit; heartbeat trả lệnh pending, thiết bị ack. Thay KV list.
4. Thứ tự spend-before-event-write: ghi sự kiện/dedupe và trừ tiền cùng một đơn vị idempotent (`spend_dedupe` đã có, cần khóa thứ tự + test crash giữa hai bước).

**P1**
5. Vòng đời thiết bị: pending→active→suspended→revoked→retired; thu hồi khoá, xoay khoá, re-pair; revoke có hiệu lực ngay ở gateway (kiểm tra khi verify chữ ký).
6. Projector + rebuild cho `impression_hourly`: lệnh tính lại theo khoảng thời gian từ bảng sự kiện; thêm `freshness_at` vào API dashboard.
7. Sửa lệch paused/scheduled của a2 và đóng workflow kid_safe (hiện parseOverlay bỏ field kid_safe → mọi creative = false).

**P2**
8. Partition bảng sự kiện, tiered storage, cold archive — khi có tải thật (>1M thiết bị).

## C. Ước lượng
P0: 4 agent-task (~1 phiên). P1: ~1 phiên. P2: hoãn.
Chờ bạn duyệt từng mục (P0 làm trước, đề xuất duyệt cả 1–4).
