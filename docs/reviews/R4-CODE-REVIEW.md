# R4 Rà soát mã nguồn (correctness, security, performance)

Ngày: 2026-11-14. Người rà: r4-codereview. Phạm vi: `services/*`, `packages/*`, `apps/web-admin`, `scripts` (không đụng `scripts/deploy-cloudflare.*`, `infra/cloudflare`). Nối tiếp R1/R2/R3; các mục R1 đã có người sửa không lặp lại. Dòng mã tính theo HEAD ngày rà.

## 1. Đã sửa

| # | Mức | Nội dung | Vị trí |
|---|---|---|---|
| F1 | Thấp-Trung (bug 500, có test) | `runList` tra `spec.sorts[k]` / `spec.filters[k]` bằng khóa do client gửi: `sort=constructor`, `__proto__`, `toString`, hoặc `?constructor=x` lấy trúng thuộc tính của `Object.prototype` => SQL lỗi => HTTP 500 trên MỌI danh sách phân trang. Dùng `Object.hasOwn`. | `services/api/src/lib/http.ts` (parseFilters, runList) |
| F2 | Trung (hiệu năng) | Thiếu chỉ mục cho đường nóng; thêm migration mới `0006_hot_path_indexes.sql` (một file dùng chung PG + SQLite/D1, đúng quy ước 0003-0005; `IF NOT EXISTS`). Không đụng 0001-0005. Xem bảng 1.1. | `packages/db/migrations/0006_hot_path_indexes.sql` (+ `migrations.gen.ts`) |
| F3 | Trung (hiệu năng) | `GET /admin/v1/revenue` lọc `substr(hour,1,7) >= ?` (không dùng được chỉ mục, quét cả `impression_hourly` mỗi lần mở trang) => `hour >= ?` (kết quả y hệt vì `hour` bắt đầu bằng `YYYY-MM`). | `services/api/src/routes/revenue.ts:16` |
| F4 | Thấp (hiệu năng) | `nextPaymentCode` / `nextContractNo` kéo CẢ bảng khách hàng / hợp đồng về Node để tìm số lớn nhất (mỗi lần tạo). Nay lấy 20 dòng lớn nhất theo `LENGTH, giá trị DESC` (K999 < K1000 vẫn đúng). Vòng thử lại khi trùng khóa UNIQUE đã có sẵn nên không đổi ngữ nghĩa. | `services/api/src/routes/customers.ts:128`, `contracts.ts:169` |
| F5 | Thấp (hiệu năng) | `GET /admin/v1/tv-experience` đọc toàn bộ `creatives` để đếm trong JS. Nay đếm bằng SQL và chỉ kéo các dòng có `overlay LIKE '%kid_safe%'`. | `services/api/src/routes/tv-experience.ts:170` |
| F6 | Trung (bundle) | web-admin: cảnh báo "Profile.tsx vừa import tĩnh vừa động". Tách `ChangePasswordForm` + `pwHint` sang `components/ChangePasswordForm.tsx` (Profile vẫn re-export cho test cũ); `Invite`/`Activate` (kéo `qrcode-generator`) tải lười. Chunk chính 341,8 kB (gzip 106,2) => 310,7 kB (gzip 95,4); `Invite` thành chunk riêng 26,8 kB. | `apps/web-admin/src/{App.tsx,components/ChangePasswordForm.tsx,pages/Profile.tsx,pages/Login.tsx}` |

### 1.1 Chỉ mục mới (0006)

| Chỉ mục | Truy vấn hưởng lợi |
|---|---|
| `screens(device_id)` | gateway nạp thiết bị (`devices LEFT JOIN screens ON screens.device_id`) mỗi lần cache miss: trước đó quét `screens` |
| `ev_ad_impression(ts, event_id)`, `ev_proof_of_play(ts, creative_id)` | trang Lịch sử (admin + cổng khách) mặc định `ORDER BY ts DESC, tiebreak LIMIT n`: trước đó sắp xếp cả bảng sự kiện |
| `impression_hourly(campaign_id, hour)`, `(partner_id, hour)` | PK bắt đầu bằng `hour` nên `WHERE campaign_id IN (...)` (danh sách chiến dịch) và subquery theo `partner_id` (danh sách đối tác, 3 subquery tương quan mỗi dòng) phải quét hết |
| `receivables(invoice_id)`, `(contract_id)` | danh sách hóa đơn: 3 subquery tương quan theo `invoice_id` mỗi dòng |
| `payment_webhooks(topup_id)`, `(received_at)` | hàng đợi thủ công (`UPDATE ... WHERE topup_id = ? AND result LIKE 'manual:%'`), danh sách webhook mới nhất |
| `topups(status, requested_at)` | danh sách nạp tiền toàn hệ thống lọc theo trạng thái + thông báo "chờ xác nhận" (poll mỗi 60 giây mỗi quản trị viên) |

Kiểm: `pnpm --filter @ams/db gen` đã chạy, test `packages/db` (migrations.gen đồng bộ, hai dialect cùng danh sách) xanh; toàn bộ suite api chạy trên PGlite và `node:sqlite` đều áp 0006 thành công.
**Cloudflare staging: cần chạy lại bước migrate D1 để áp 0006** (nó idempotent, không ảnh hưởng 0001-0005).

## 2. Chưa sửa (khuyến nghị)

| # | Mức | Vấn đề | Vị trí | Ghi chú / hướng sửa |
|---|---|---|---|---|
| N1 | Trung | Đếm trần mỗi giờ (`cap:<dev>:<giờ>`) tăng theo TỪNG sự kiện kể cả khi thiết bị gửi lại lô vì mất phản hồi: lô gửi lại bị trừ trần hai lần, sự kiện hợp lệ cuối giờ có thể bị gắn `rate_cap`. Ngoài ra KV `incr` trên Cloudflare không nguyên tử (R1-12) nên trần chưa được chứng minh trên Workers. | `services/edge-gateway/src/events.ts:93` | Khử trùng theo `event_id` (kv `claim`) trước khi tăng; chuyển bộ đếm sang DO. Cần quyết định nghiệp vụ nên chưa sửa. |
| N2 | Thấp-Trung | `topCampaigns` quét TOÀN BỘ `impression_hourly` (`GROUP BY campaign_id ORDER BY SUM(valid)`), không có cận thời gian; bảng tăng vô hạn. | `services/api/src/routes/dashboard.ts:72` | Giới hạn theo `range` của trang (đổi ngữ nghĩa "mọi thời điểm" nên chưa sửa) hoặc bảng tổng theo ngày. |
| N3 | Thấp | Dashboard `SELECT COUNT(*), SUM(CASE ...) FROM devices WHERE kind='tv'` quét cả bảng thiết bị mỗi lần tải (1M+ dòng). | `dashboard.ts:21` | Cache KV 60 giây hoặc bộ đếm tăng dần; chỉ mục không giúp được vì cần đếm hết. |
| N4 | Thấp | Gateway tính tuần tự tối đa 50 lần `kv.incr` (một vòng mạng mỗi sự kiện) trên đường nóng. | `events.ts:93` | Gom thành một lần `incr` theo `delta` rồi chia (cần API KV mới). |
| N5 | Thấp | `tv-experience` vẫn lọc `kid_safe` bằng `LIKE '%kid_safe%'` (tiền lọc, đúng nhưng không dùng chỉ mục). Đủ cho vài nghìn creative. | `tv-experience.ts` | Tách cột `kid_safe` khi bảng lớn. |
| N6 | Thấp (mã chết) | `nextContractNo(rt, ...)` có tham số `rt` chỉ để `void rt;`. | `contracts.ts:169-176` | Bỏ tham số khi có dịp chạm lại file. |
| N7 | Thấp | Bundle chính còn 311 kB: React/ReactDOM, router, react-query và `zod` (dùng ở `api/client.ts`, `schemas.ts` trong đường đăng nhập). Có thể tách `vendor` bằng `manualChunks` để cache tốt hơn khi deploy lại. | `apps/web-admin/vite.config.ts` | Không giảm được byte tải lần đầu nhiều nếu không bỏ zod khỏi client. |
| N8 | Thấp | `ev_proof_of_play` không có khóa UNIQUE theo sự kiện; khử trùng chỉ dựa vào KV (`ingest:pop:`, TTL 7 ngày) nên KV mất/hết hạn có thể ghi đôi. Không ảnh hưởng tiền (PoP không tính tiền). | `services/ingest-consumer/src/consumer.ts` ingestPops | Thêm cột `event_id` UNIQUE bằng migration mới khi cần báo cáo PoP chính xác. |
| — | — | Các mục R1 còn mở (R1-02, 05, 06, 10, 11, 12, 14, 15, 16, 19...) không thuộc đợt này, giữ nguyên trạng thái theo R2. | | |

## 3. Đã đọc kỹ, không thấy vấn đề

- Authz: mọi route `/admin/v1` có `requirePerm`/`requireAnyPerm` hoặc `r.use('*', requirePerm...)` (history, portal invoices); `/storage/*` dùng URL ký HMAC (`verifySigned`, khóa bị `assertSafeKey` + `guardParent` chặn thoát gốc, trần byte `readCapped`).
- Phân trang: `runList` giới hạn `page_size` 200; các truy vấn không `LIMIT` còn lại là tra theo khóa / tổng hợp.
- Tiền: `creditTopup`/`applyBalance`/`spend` dùng UPDATE có điều kiện + `topup_credit_claims` UNIQUE; không phát hiện đường cộng/trừ ví không nguyên tử mới ngoài R1-15 (D1).
- Không có `dangerouslySetInnerHTML`/`eval` trong web-admin hay dịch vụ.

## 4. Kết quả kiểm chứng

| Lệnh | Kết quả |
|---|---|
| `pnpm -r typecheck` | PASS (toàn workspace) |
| `services/api`: `npx vitest run` | 229/229 PASS (227 cũ + 2 test mới `test/r4-code-review.test.ts`; test F1 được xác nhận FAIL 500 khi gỡ bản sửa) |
| `services/payments`: `npx vitest run` | 141/141 PASS |
| `packages/db`: `npx vitest run` | 4/4 PASS |
| `apps/web-admin`: `pnpm test` / `pnpm build` | 59/59 PASS; build sạch, hết cảnh báo import tĩnh+động, chunk chính 310,7 kB |
