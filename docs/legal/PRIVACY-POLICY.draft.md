# Chính sách bảo vệ dữ liệu cá nhân AMS — BẢN NHÁP

> **BẢN NHÁP, CHƯA PHẢI VĂN BẢN PHÁP LÝ.** Soạn bởi agent r5-commercial ngày 2026-11-14 từ những gì mã nguồn thực sự lưu. Luật sư/DPO của công ty phải: (1) xác nhận văn bản áp dụng (Nghị định 13/2023/NĐ-CP và Luật Bảo vệ dữ liệu cá nhân ban hành sau đó, ngày hiệu lực cần xác nhận); (2) quyết định có phải lập Hồ sơ đánh giá tác động xử lý dữ liệu và hồ sơ chuyển dữ liệu ra nước ngoài (Cloudflare) hay không; (3) viết lại phần đồng ý của phụ huynh/trẻ em. Chưa tra cứu nguồn pháp luật trong phiên này.

## 1. Ai xử lý dữ liệu
`[Pháp nhân, địa chỉ, email DPO]` ("AMS") là bên kiểm soát/xử lý dữ liệu tùy từng nhóm dưới đây `[luật sư phân loại]`.

## 2. Dữ liệu AMS thực sự thu thập (đối chiếu với `packages/db/migrations/0001_init.sql`)
| Nhóm | Dữ liệu | Bảng | Cách bảo vệ trong thiết kế |
|---|---|---|---|
| Khách hàng quảng cáo (tổ chức) | Tên pháp nhân, MST, địa chỉ, người đại diện, chức danh, điện thoại, email | `customers`, `customer_contacts`, `admins` | MST mã hóa theo trường (AES-GCM) + chỉ mục băm; mật khẩu băm scrypt; TOTP mã hóa |
| Tài khoản người dùng cổng | Email, tên, IP và user-agent phiên, nhật ký thao tác | `admins`, `sessions`, `audit_log` | Phiên băm SHA-256; audit chỉ INSERT, không ghi PII vào diff |
| Người xem (TV/ứng dụng) | Mã thiết bị, khóa công khai, model/OS, vùng, hoạt động hiển thị quảng cáo; (tùy chọn) số điện thoại băm, email mã hóa, tên hiển thị | `devices`, `end_users`, `ev_*` | `phone_hash`, `email_enc`; không log PII |
| Thanh toán | Số tài khoản/nội dung chuyển khoản nhận qua webhook SePay | `payment_webhooks`, `topups` | Payload thô lưu cả số tài khoản (chưa mã hóa — việc cần làm, xem R1-16) |
| Trẻ em | Ứng dụng giám sát phụ huynh chạy trên TV có trẻ em; AMS **không** chủ định thu thập danh tính trẻ em nhưng quảng cáo hiển thị trong ngữ cảnh đó | — | `kid_safe`, danh sách ngành cấm; **cần luật sư đánh giá** |

## 3. Mục đích và cơ sở xử lý
Vận hành dịch vụ quảng cáo, tính tiền và đối soát, chống gian lận, bảo mật, tuân thủ pháp luật (hóa đơn, thuế), hỗ trợ khách hàng. `[Cơ sở pháp lý và hình thức đồng ý cho từng mục đích — luật sư.]` Không dùng dữ liệu để tạo hồ sơ nhắm mục tiêu cá nhân; báo cáo cho nhãn hàng chỉ ở mức tổng hợp.

## 4. Chia sẻ và chuyển dữ liệu
Nhà cung cấp hạ tầng (Cloudflare — dữ liệu có thể ở ngoài Việt Nam `[xác nhận vùng]`), ngân hàng/SePay (giao dịch nạp tiền), nhà cung cấp hóa đơn điện tử `[Viettel/MISA]`, dịch vụ gửi email `[chưa chọn]`. `[Hồ sơ chuyển dữ liệu ra nước ngoài nếu có.]`

## 5. Thời gian lưu
Audit log ≥ 12 tháng; sổ cái ví và chứng từ tài chính theo quy định kế toán `[số năm — kế toán]`; heartbeat thô 14 ngày (khuyến nghị; chưa có job tự xóa, xem `docs/ops/RUNBOOK.md` 4.2); dữ liệu thiết bị/người xem `[chưa quyết định]`.

## 6. Quyền của chủ thể dữ liệu
Truy cập, chỉnh sửa, rút đồng ý, xóa, hạn chế xử lý, khiếu nại: gửi `[email]`, phản hồi trong `[N]` ngày. **Lưu ý kỹ thuật:** hiện chưa có chức năng xóa/ẩn danh dữ liệu người xem theo yêu cầu trong hệ thống; sổ cái và audit là bất biến theo thiết kế, nên cần quy trình ẩn danh có kiểm soát (việc P1).

## 7. Bảo mật và sự cố
Xem `docs/THREAT-MODEL.md`. Thông báo vi phạm dữ liệu cho cơ quan có thẩm quyền theo thời hạn luật định `[luật sư xác nhận, ghi vào runbook]`.

## 8. Liên hệ
`[Email DPO, địa chỉ]`
