# Yêu cầu từ w2-notconnected

## a3-gateway (services/edge-gateway/src/manifest.ts, `parseOverlayJson`)
`parseOverlay` nay mặc định `reviewerFields: 'strip'` (an toàn): bỏ `kid_safe: true` và ngữ cảnh `lock`. Dữ liệu đã lưu do người duyệt đặt qua `PUT /admin/v1/tv-experience/creatives/:id` chỉ được phát nguyên vẹn nếu gateway đọc bằng `parseOverlay(JSON.parse(raw), { reviewerFields: 'keep' })` (dữ liệu trong DB là đáng tin; khách không ghi được kid_safe/lock vì các route khách dùng chế độ strip). Cho tới khi đổi, manifest không bao giờ chứa kid_safe (fail-safe: TV không đưa quảng cáo lên màn khóa).
Gợi ý thêm: phát `settings.tv_experience` (tần suất, lock_ads_enabled) trong manifest nếu muốn máy chủ điều khiển; TV hiện tự áp 30/giờ, 60 s, 5 phút.

## w1 (services/api/src/routes/media.ts)
- `checkFormatOverlay` nên gọi `parseOverlay(overlay, { reviewerFields: 'reject' })` cho tài khoản ngoài để khách nhận 422 rõ ràng thay vì bị cắt âm thầm (hiện mặc định 'strip' nên vẫn an toàn).
- Yêu cầu cũ của a4: ảnh fullscreen 16:9 1280x720..7680x4320 và <= 15 MB; dùng `backgroundSizeProblem` từ `@ams/shared` (mới thêm).

## f3-web (apps/web-admin/src/nav.ts, api/schemas.ts)
- `EXTERNAL_PAGES` chưa có `history`: khách xem lịch sử qua tab trong trang `finance` (tôi nhúng `<History />` ở nhánh khách của `Finance.tsx`). Nếu muốn trang riêng, thêm `history` và cho phép module.

## f1 (packages/db)
- Nếu muốn ràng buộc cứng ở DB: `CREATE UNIQUE INDEX uq_invoices_period ON invoices(customer_id, period) WHERE status <> 'void'` (hiện chống trùng bằng INSERT ... WHERE NOT EXISTS, có `allow_additional`), và cột `payouts.decision_note`/`invoices.number`. Chưa cần để chạy.

## w4-reconcile (chuyển tiếp thông điệp điều phối, KHÔNG thuộc w2)
Điều phối viên gửi nhầm cho w2 yêu cầu R1-05 (activation.ts:116 gửi mail trong transaction → tách ra outbox) và R1-06 (xác nhận thủ công rồi webhook thật = cộng đôi). Hai việc này nằm ở `services/payments/**`, ngoài phạm vi sở hữu của w2 nên w2 không đụng; xin giao cho w4-reconcile.

## g1-openapi
build.ts đã liệt kê các route mới (g1 làm sẵn). Lưu ý: `tsc -p packages/openapi` bị OOM/Killed (137) trong sandbox, kể cả với --max-old-space-size=6144; w2 không xác nhận được typecheck gói này, các gói còn lại sạch.
