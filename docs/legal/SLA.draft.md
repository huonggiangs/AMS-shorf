# Cam kết mức độ dịch vụ (SLA) AMS — BẢN NHÁP

> **BẢN NHÁP.** Con số dưới đây là đề xuất thận trọng dựa trên những gì đã đo và đã được kiểm chứng trong repo (`docs/SLO.md`, `docs/LOAD-TEST-REPORT.md`, `docs/ops/DISASTER-RECOVERY.md`), không phải mục tiêu đặc tả 99,95%. Không có cam kết nào được kiểm chứng trên Cloudflare thật hoặc trên thiết bị thật. Luật sư và CTO phải duyệt trước khi đưa vào hợp đồng. `[ ]` là quyết định còn bỏ trống.

## 1. Phạm vi
Áp dụng cho cổng khách hàng, API và dịch vụ tải lịch/nhận sự kiện từ thiết bị. Không áp dụng cho: mạng và nguồn điện tại điểm đặt TV, hành vi của người dùng cuối (tắt TV, gỡ ứng dụng), bảo trì có báo trước, sự kiện bất khả kháng, sự cố của ngân hàng/SePay/Cloudflare ngoài khả năng kiểm soát.

## 2. Cam kết đề xuất theo giai đoạn
| Hạng mục | Pilot (≤ 100 TV) | Thương mại giai đoạn 1 | Cách đo |
|---|---|---|---|
| Sẵn sàng cổng khách + API | 99,0%/tháng (≈ 7 giờ lỗi) | 99,5%/tháng (≈ 3,6 giờ) | Giám sát ngoài từ 2 điểm, 1 phút/lần `[chưa có]` |
| Thiết bị giữ lịch khi mất kết nối | Có (thiết bị phát lịch đã tải) | Có | Thiết kế giao thức |
| Độ trễ ghi nhận lượt hiển thị vào báo cáo | ≤ 24 giờ | ≤ 60 phút (mục tiêu `docs/SLO.md`) | `freshness_at` của API doanh thu |
| Ghi có ví sau khi tiền vào tài khoản | ≤ 15 phút giờ hành chính | ≤ 5 phút (webhook), đối soát bù mỗi 10 phút | `payment_webhooks.received_at` → `credited_at` |
| Duyệt nội dung | ≤ 1 ngày làm việc | ≤ 4 giờ làm việc | Thời gian `pending_review` → quyết định |
| Phản hồi hỗ trợ | Giờ hành chính, ≤ 4 giờ | `[theo mức nghiêm trọng, bảng dưới]` | Hệ thống ticket `[chưa có]` |
| RPO/RTO | RPO 24 giờ / RTO 4 giờ (**mục tiêu, chưa diễn tập**) | RPO ≤ 5 phút giao dịch / RTO ≤ 60 phút (**mục tiêu, chưa diễn tập**) | Diễn tập quý (DR mục 4) |

Mức nghiêm trọng hỗ trợ `[đề xuất]`: S1 (không nạp được tiền / quảng cáo sai nội dung đang phát) phản hồi 1 giờ, xử lý trong ngày; S2 (báo cáo sai, một phần màn không phát) 4 giờ; S3 (câu hỏi, yêu cầu) 1 ngày làm việc.

## 3. Bồi hoàn
Tín dụng dịch vụ hoặc hoàn một phần ngân sách chưa phát khi AMS không đạt cam kết sẵn sàng: `[bậc và mức, tối đa N% phí tháng]`. Không bồi hoàn lượt phát do lỗi phía thiết bị/mạng người dùng cuối. Tranh chấp lượt hiển thị dùng số liệu `ev_*` và proof-of-play làm căn cứ.

## 4. Báo cáo sự cố
Thông báo S1 cho khách trong `[60]` phút kể từ khi phát hiện; báo cáo sau sự cố trong `[5]` ngày làm việc. Trang trạng thái công khai: `[chưa có]`.
