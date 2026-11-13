STATUS: done
UPDATED: 2026-11-13T01:10:00Z

# w2-notconnected: nối API thật cho các màn hình NotConnected (R3 FAIL)

## Đã làm
- packages/shared/src/overlay.ts: parseOverlay giữ qr.hint, duration_s (5..60), safe_area {top,right,bottom,left} 0..15, contexts, kid_safe. Tùy chọn `reviewerFields`: 'strip' (mặc định, bỏ kid_safe=true và ngữ cảnh lock), 'reject' (422), 'keep' (người duyệt/đọc lại DB). Thêm `backgroundSizeProblem`. Test: packages/shared/test/overlay.test.ts. integrations/brainrot-tv không đổi, 28 test + tsc xanh.
- services/api/src/routes/tv-experience.ts (`/admin/v1/tv-experience`): GET tổng quan + cài đặt, PUT /settings, GET /creatives, GET/PUT /creatives/:id. kid_safe và ngữ cảnh lock cần tv_experience:approve; chặn ngành cấm, creative chưa duyệt, ảnh sai 16:9/ > 15 MB; duration_s đồng bộ creatives.duration_s; bumpManifest; audit.
- routes/history.ts: `/admin/v1/history`, `/proof-of-play`, `/:eventId` và bản `/portal/v1/history`. Lọc, phân trang, sắp xếp; khách lọc trong SQL (campaignScope/mediaScope), không thấy doanh thu/thiết bị/màn hình; id khách khác -> 404.
- routes/invoices.ts: `/admin/v1/invoices` (list/create/PUT nháp/issue/pay/void), `/portal/v1/invoices` (chỉ của mình, issued/paid), `/admin/v1/payouts` (list/pay/reject). Không đụng wallet_entries; phát hành tạo 1 receivable; mọi chuyển trạng thái là UPDATE có điều kiện; chi trả trừ wallet_ledger cùng giao dịch, thiếu số dư -> 409.
- routes/revenue.ts: `GET /admin/v1/revenue/hourly?date=` (giờ VN, freshness_at, stale).
- app.ts: thêm import + 6 dòng mount (history, tv-experience, invoices, payouts; portal history/invoices).
- Web: History.tsx, TvExperience.tsx (tab quảng cáo màn khóa / cài đặt TV / ví thưởng & rút tiền; bỏ tab "Nhiệm vụ" vì chưa có mô hình dữ liệu), FinanceInvoices.tsx (mới), Finance.tsx (hết NotConnected).
- Test: services/api/test/not-connected.test.ts (19, chạy cả postgres và sqlite với W2_SQLITE=1), apps/web-admin/src/test/w2-pages.test.tsx (4).

## Chưa làm / rủi ro
- Gateway chưa đọc kid_safe (xem requests). Chi trả thưởng: hai lệnh khác nhau cùng người trên Postgres đọc cùng số dư có thể vượt (kiểm trong một câu INSERT, không khóa hàng).
- Đọc lịch sử chỉ từ bảng ev_* (không đọc ClickHouse khi CLICKHOUSE_URL).
- Hóa đơn điện tử thật chưa nối (einvoice_ref chỉ là chuỗi nhập tay).
