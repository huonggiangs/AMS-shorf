# Kết nối SePay

Cập nhật: 2026-11-13. Phạm vi: nhận webhook báo tiền vào, cấu hình trong web admin (Tích hợp API > "Kết nối SePay").

## 1. Xác thực webhook (đã đối chiếu tài liệu SePay)

Nguồn: https://developer.sepay.vn/en/sepay-webhooks/xac-thuc và .../tich-hop-webhook (docs.sepay.vn bị chặn từ môi trường này; trang developer.sepay.vn đọc được ngày 2026-11-13).

SePay hỗ trợ 4 kiểu: không xác thực, API Key, OAuth 2.0, HMAC-SHA256.

| Kiểu | Header SePay gửi | Phía AMS |
|---|---|---|
| API Key | `Authorization: Apikey <key>` | so sánh hằng thời gian với khóa đã lưu (mã hóa) hoặc `SEPAY_API_KEY` |
| HMAC-SHA256 | `X-SePay-Signature: sha256=<hex>`, `X-SePay-Timestamp: <unix giây>`; ký `{timestamp}.{raw_body}` | `SEPAY_WEBHOOK_SECRET` hoặc khóa đã lưu; lệch giờ quá 5 phút bị từ chối |
| OAuth 2.0 (`Bearer`) | | KHÔNG hỗ trợ (bị 401) |
| Không xác thực | | KHÔNG chấp nhận |

AMS chấp nhận cả API Key lẫn HMAC cùng lúc (chọn kiểu nào bên SePay cũng chạy). Nếu `Authorization: Apikey` sai nhưng kèm chữ ký HMAC hợp lệ thì dùng HMAC; sai cả hai thì 401 và lưu nguyên văn vào `payment_webhooks` (result `rejected:*`).

Quy tắc khác (theo tài liệu SePay):
- Trả HTTP 200/201 với thân đúng `{"success": true}` trong 30 giây; khác đi là SePay coi là lỗi và gửi lại.
- `id` giao dịch giữ nguyên qua các lần gửi lại và phát lại thủ công: dùng làm khóa khử trùng (`payment_webhooks.event_id` UNIQUE, `topups.provider_txn_id` UNIQUE). Gửi lại trả 200, không cộng tiền lần hai.
- `code` có thể `null` (khác chuỗi rỗng); `subAccount`, `description`, `referenceCode` có thể rỗng.

Chưa xác minh được: danh sách IP của SePay (trang "IP addresses" chưa đọc), lịch gửi lại chính xác (trang "Error handling" chưa đọc). Chưa kiểm thử với SePay thật.

Lưu ý quan trọng: "API Key" của webhook là chuỗi bạn tự đặt khi tạo webhook trên my.sepay.vn rồi dán cùng chuỗi đó vào AMS. Nó KHÁC với token truy vấn dữ liệu SePay (API Access, dùng `Bearer`) mà job đối soát bù đọc từ `SEPAY_API_TOKEN`. Khóa tên "AMS" mà bạn tạo cần được dán vào cả hai nơi chỉ khi bạn dùng chung chuỗi; AMS không tự suy ra.

## 2. Cấu hình trong web admin

Trang Tích hợp API > thẻ "Kết nối SePay":
- API Key (ô mật khẩu, Hiện/Ẩn chỉ cho thứ vừa gõ). Sau khi lưu chỉ hiện `đã lưu ••••1234`; máy chủ không bao giờ trả khóa thật. Khóa đặt bằng biến môi trường được ưu tiên và khóa trên giao diện (không sửa được ở đây).
- Khóa bí mật HMAC (tùy chọn), kiểu xác thực, ngân hàng, số tài khoản, tên chủ tài khoản.
- Chế độ mock/sandbox/production CHỈ ĐỌC trên giao diện: đặt bằng `SEPAY_MODE` ở máy chủ, để tránh mở nhầm mô phỏng trên hệ thống chạy tiền thật. Không đặt = production.
- Nút sao chép URL webhook; nút "Kiểm tra kết nối" gọi `POST /admin/v1/settings/sepay/test` (kiểm tra nội bộ, không gọi sang SePay, không cộng tiền).
- Quyền: xem = `finance:view`; kiểm tra = `finance:write`; sửa/duyệt = `finance:approve` (Super admin, Kế toán).

Bốn bước: (1) my.sepay.vn > Webhooks > Thêm webhook, dán URL, sự kiện "Có tiền vào". (2) Chọn chứng thực API Key, đặt một chuỗi khóa và dán đúng chuỗi đó vào AMS (hoặc HMAC + Secret). (3) Nhập tài khoản nhận tiền, Lưu. (4) Kiểm tra kết nối rồi bấm Gửi thử bên SePay.

## 3. Bảo mật thay đổi cấu hình (R1-02)

- Mọi `PUT /admin/v1/settings/sepay` cần `totp` (mã 6 số hiện tại của chính người thao tác, mã đã dùng không dùng lại). Tài khoản chưa bật TOTP bị từ chối (`mfa_not_enrolled`).
- Đổi ngân hàng/số tài khoản/chủ tài khoản/bật-tắt không áp dụng ngay: tạo đề xuất (HTTP 202, `pending_change_id`), người KHÁC có `finance:approve` + TOTP của họ duyệt qua `POST /admin/v1/settings/sepay/changes/:id/approve`; hết hạn sau 24 giờ; có `/reject` và `GET .../changes` (số tài khoản che `***xyz`).
- Đổi API Key/khóa HMAC áp dụng ngay (sau TOTP) và báo mọi người có vai trò finance/super_admin qua thông báo + email.
- Audit: `finance.sepay.update`, `.change_requested`, `.change_approved`, `.change_rejected`; chỉ ghi gợi ý che (`••••1234`, `***xyz`), không bao giờ ghi giá trị khóa hay số tài khoản đầy đủ.
- Chưa làm: độ trễ hiển thị tài khoản mới cho khách (đề xuất R1: 24 giờ); `loadSepayConfig` vẫn bỏ qua kiểm tra `account_mismatch` khi giải mã lỗi (ngoài phạm vi s1).

## 4. Ràng buộc còn lại

- Production khởi động được khi khóa chỉ nằm trong DB; thiếu cả env lẫn DB thì webhook bị từ chối (401, fail-closed) và `has_secret=false`.
- Khóa lưu trong DB mã hóa bằng `FIELD_ENC_KEY`; đổi khóa này làm khóa đã lưu không đọc được (webhook bị từ chối).
