# Brief giao Agent: đưa "AMS · Quản trị" lên sản phẩm thương mại

## Mục tiêu
Chuyển prototype `AMS Admin.dc.html` (+ `app.js`, `app.css`) thành web quản trị production cho mạng lưới quảng cáo trên Smart TV Việt Nam. Giữ nguyên giao diện (ANIO Design System: tím #5F60B9, Inter, nút pill, thẻ bo 20px) và hành vi đã có.

## Kiến trúc đề xuất
- Frontend: Vite + React + TypeScript, React Router, TanStack Query/Table, i18n (vi/en), thiết kế token từ `app.css`.
- Backend: Cloudflare Workers + D1 (hoặc NestJS + PostgreSQL), REST/OpenAPI, hàng đợi cho ingestion, R2/S3 + CDN cho media.
- Xác thực: OIDC/email + TOTP 2FA, session cookie HttpOnly, RBAC theo 4 vai trò (Super admin, Quản lý nội dung, Tài chính, Vận hành thiết bị). Quyền kiểm tra ở server, không chỉ ẩn menu.

## Phạm vi theo trang (thay dữ liệu mẫu bằng API thật)
1. Tổng quan: số liệu tổng hợp, biểu đồ xu hướng theo 7/30/90 ngày (bảng tổng hợp theo ngày).
2. Thiết bị: danh sách phân trang server-side, lọc/sắp xếp, telemetry (heartbeat 5–15 giây), xác minh/chặn, thao tác hàng loạt.
3. Trải nghiệm TV: cấu hình ví thưởng, nhiệm vụ, ngưỡng rút, cài đặt TV.
4. Quảng cáo / Phê duyệt: vòng đời Nháp → Chờ duyệt → Đã duyệt → Đã lên lịch → Đang phát → Tạm dừng; ngân sách đã duyệt là trần chi tiêu; chỉ Super admin duyệt.
5. Media: upload trực tiếp lên storage (presigned URL), kiểm tra định dạng, độ phân giải, thời lượng, virus; link Google Drive qua OAuth.
6. Mẫu hiển thị TV: 6 định dạng (toàn màn hình, banner menu hình ảnh, L-banner, pause ad, QR góc, thưởng điểm) với thông số kỹ thuật, lưu ảnh mẫu `ADS.png` làm ảnh xem trước mặc định trong repo (`/assets/formats/`).
7. Lịch phát: timeline kéo thả lưu DB, kiểm tra xung đột khung giờ, waterfall P1 hợp đồng → P2 RTB (≤250 ms) → P3 auto-fill → Reserve Pool.
8. Doanh thu: doanh thu = impressions hợp lệ × eCPM / 1.000; quỹ thưởng ≤20% doanh thu gộp; ngưỡng rút 50.000 ₫; tích hợp Viettel S-Invoice / MISA meInvoice; chi trả MoMo/ZaloPay/Napas 24/7.
9. Kiểm soát hoa hồng: chỉ tính lượt xem từ TV có chứng thực phần cứng Ed25519; giữ khoản chờ rà soát.
10. Đối tác & Tích hợp API: Chicilon, Unique OOH, WeWin, Goldsun/Focus Media, Brandcom, Trimai. Giao thức trong prototype CHƯA được xác minh; cần tài liệu, sandbox, xác thực, callback từ từng đối tác trước khi viết connector.
11. Người dùng & Phân quyền, Nhật ký hoạt động (audit log bất biến, ghi mọi thao tác ghi dữ liệu, lưu ≥12 tháng), Hồ sơ.

## Tính năng đã có cần giữ
Ctrl+K command palette, trung tâm thông báo (realtime SSE/WebSocket), bảng lọc/sắp xếp/phân trang/chọn nhiều dòng/hành động hàng loạt, ngăn chi tiết (drawer), xuất CSV/PDF (CSV UTF-8 BOM), chế độ tối, Việt/Anh, responsive mobile.

## Yêu cầu thương mại
- Bảo mật: OWASP ASVS L2, CSP, CSRF, rate limit, mã hóa dữ liệu nhạy cảm, secrets trong vault, backup hằng ngày, kiểm thử xâm nhập trước go-live.
- Pháp lý VN: Nghị định 13/2023 về bảo vệ dữ liệu cá nhân (đồng ý, xóa dữ liệu, lưu trữ), quy định hóa đơn điện tử, thuế TNCN cho chi trả user.
- Hiệu năng: LCP < 2,5 s, bảng 100k dòng phân trang server-side, chạy 2 vùng CDN.
- Quan sát: Sentry, log có cấu trúc, dashboard SLO (API p95 < 400 ms, uptime 99,9%).
- Chất lượng: unit + e2e (Playwright) cho luồng duyệt chiến dịch, chi trả, phân quyền; a11y WCAG 2.1 AA (tương phản ≥4,5:1, điều hướng bàn phím).
- CI/CD: môi trường dev/staging/prod, migration có rollback, feature flag.

## Tiêu chí nghiệm thu
Mọi nút trong prototype có API thật; RBAC được kiểm thử ở server; không còn dữ liệu minh họa; đối soát doanh thu khớp impression log; audit log đầy đủ.
