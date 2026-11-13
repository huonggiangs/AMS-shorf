# Yêu cầu của s1-sepay
1. f3-web (Finance.tsx, SepayConfig dialog): PUT /admin/v1/settings/sepay nay yêu cầu `totp` và đổi ngân hàng/số tài khoản trả 202 (đề xuất). Hộp thoại cũ sẽ nhận 403 `step_up_required`; nên bỏ dialog cũ, trỏ sang thẻ "Kết nối SePay" ở Tích hợp API.
2. a1-api-core / R1-01: bắt buộc TOTP cho mọi tài khoản nội bộ (step-up cần `admins.totp_secret_enc`).
3. mountFinance/assertFinanceConfig (routes.ts ngoài khối settings): cho phép production khởi động khi khóa chỉ có trong DB.
