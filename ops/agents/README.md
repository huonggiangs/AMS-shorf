# Giao thức agent phụ

1. Đọc `docs/PLAN.md` (bắt buộc), sau đó đọc phần liên quan của `docs/DAC-TA-GIAO-VIEC-AGENT.md`.
2. Thư mục làm việc: `/home/claude/ams-shorf`. Chỉ ghi trong thư mục được giao (PLAN §6). Không chạy lệnh git.
3. Cài gói: luôn bọc bằng khóa để các agent không giẫm nhau: `flock /tmp/pnpm.lock pnpm install ...`. Registry npm truy cập được; Docker Hub và hầu hết site khác thì không.
4. Nhật ký: `ops/agents/<mã>.md` với dòng đầu `STATUS: running|done|blocked` + dòng `UPDATED: <giờ UTC>`. Cập nhật đầu, giữa, cuối.
5. Báo cáo cuối: tối đa ~25 dòng: đã làm / lệnh kiểm chứng + kết quả thật / chưa làm / rủi ro / yêu cầu cho agent khác.
6. Tiếng Việt cho văn bản người đọc; tiếng Anh cho mã.
7. Không đoán bí mật, không đặt khóa thật vào repo. Số tài khoản ngân hàng mẫu là `0123456789`.
