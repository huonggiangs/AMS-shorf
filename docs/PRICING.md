# Định giá quảng cáo (p1-pricing)

Mã: `packages/shared/src/pricing.ts` (hàm thuần), `packages/db/migrations/0007_pricing.sql`, `services/api/src/{lib/pricing.ts,routes/pricing.ts}` (+ `campaigns.ts`, `contracts.ts`), `services/edge-gateway/src/{manifest.ts,events.ts}`.
Test: `packages/shared/test/pricing.test.ts`, `services/api/test/p1-pricing.test.ts`, `tests/contract/test/pricing-e2e.test.ts`.
Thay thế hằng số tạm `20 ₫/lượt` (COMMERCIAL-READINESS P0-2). Tiền luôn là **số nguyên micro-VND** (1 ₫ = 1.000.000), không dùng số thực ở bất kỳ bước nào.

## 1. Mô hình

**Bảng giá niêm yết (`rate_cards`)** gồm khóa `(customer_id, screen_type, region_id, daypart)`, mỗi trường nhận `*` (mọi giá trị):

| Trường | Giá trị |
|---|---|
| `customer_id` | `*` hoặc id khách (giá riêng của khách) |
| `screen_type` | `*`, `tv`, `elevator`, `led_p5` |
| `region_id` | `*` hoặc mã khu vực (`HN`, `HCM`, `DN`...) |
| `daypart` | `*`, `peak` (17:00 đến trước 22:00 giờ Việt Nam), `off_peak` (các giờ còn lại) |
| `model` | `per_impression`: `price_micro_vnd` là giá một lượt; `cpm`: giá một nghìn lượt |
| `floor_micro_vnd` | giá sàn MỖI LƯỢT (giá bán, giá hợp đồng không bao giờ thấp hơn) |
| `effective_from` / `effective_to` | phiên bản theo ngày hiệu lực, `[from, to)` |

- **CPM quy ra lượt** bằng làm tròn LÊN (`ceil(giá_cpm / 1000)` micro-VND): sai lệch tối đa 1 micro-VND (0,000001 ₫) mỗi lượt, luôn là số nguyên, luôn xác định. Ví dụ CPM 25.000 ₫ = 25 ₫/lượt; CPM 33.333,333 ₫ = 33.333.333 micro/lượt.
- **Khung giờ tính theo thời điểm của sự kiện** (`ts` của impression, giờ Việt Nam UTC+7), không theo giờ máy chủ. Biên: `16:59:59.999` là `off_peak`, `17:00:00.000` là `peak`, `21:59:59.999` là `peak`, `22:00:00.000` là `off_peak`. Cửa sổ cao điểm cố định trong mã (`PEAK_START_MIN`, `PEAK_END_MIN`) để giá đã chốt không đổi ngầm.
- **Chọn dòng giá cụ thể nhất** còn hiệu lực: khách riêng (8) > loại màn (4) > khu vực (2) > khung giờ (1). Hòa: `effective_from` muộn hơn, rồi `id` nhỏ hơn.
- **Đổi giá = tạo phiên bản mới**, không sửa dòng cũ: dòng đang chạy được đóng (`effective_to`) tại `effective_from` của phiên bản mới. Lịch sử luôn đọc được. Không cho đặt hiệu lực trong quá khứ; không cho hai phiên bản cùng khóa trùng hoặc muộn hơn thời điểm đó.

## 2. Thứ tự chốt giá và giá sàn

Với mỗi (loại màn, khu vực, khung giờ):
1. **Dòng hợp đồng** (`contract_lines` + `contract_line_prices.impression_price_micro_vnd`) của hợp đồng gắn vào chiến dịch, nếu hợp đồng `active`, đúng khách, trong thời hạn, và dòng khớp loại màn/khu vực/khung giờ (`NULL`, `*`, `all_day` = mọi giá trị). Thắng bảng giá.
2. **Bảng giá** (dòng cụ thể nhất; dòng `*,*,*,*` là giá mặc định).
3. Local/test CHƯA có bảng giá: giá tạm (`IMPRESSION_PRICE_MICRO_VND` nếu đặt rõ ràng, nếu không 20 ₫). **Production/staging: không có giá tạm, trả lỗi.**

Giá sàn lấy từ dòng bảng giá khớp. Giá hợp đồng thấp hơn sàn bị nâng lên sàn (đánh dấu `floored`). Hợp đồng không có dòng bảng giá khớp thì không có sàn, nên vẫn cần có bảng giá. Đặt giá thỏa thuận (`POST /admin/v1/contracts/:id/lines`) cần quyền `finance:approve`.

## 3. Chốt giá cho chiến dịch (snapshot)

- **Gửi duyệt** (`POST /campaigns/:id/submit`): tính thử; chưa có bảng giá thì **422 `no_rate_card`** ("Chưa có bảng giá cho loại màn hình/khung giờ ..."), không đổi trạng thái.
- **Duyệt** (`POST /campaigns/:id/approve`): trong cùng giao dịch với việc đổi trạng thái, ghi `campaign_prices` (một dòng cho mỗi loại màn × khu vực × khung giờ; khu vực riêng chỉ khi giá khác giá `*`). Thiếu giá thì 422 và không duyệt. Duyệt lại sau khi bị trả lại thì thay toàn bộ dòng. Audit `campaign.approve` ghi bản chốt.
- **Sau khi duyệt, đường trừ tiền chỉ đọc `campaign_prices`.** Đổi/kết thúc dòng bảng giá, sửa giá sàn hay giá hợp đồng sau đó KHÔNG đổi giá chiến dịch đang chạy.
- Chiến dịch đã duyệt từ trước 0007 (DB cũ/dev) được migration gán giá tạm cũ (`source='legacy'`). Production bắt đầu rỗng nên không có dòng này.

## 4. Gateway, chi tiêu, đối soát

- Khi xây manifest, gateway nạp `campaign_prices` của các chiến dịch đang phát cho nhóm (loại màn, khu vực của nhóm) vào bản ghi manifest **phía máy chủ** (`GroupRecord.prices`, giữ thêm bản của chiến dịch vừa rời manifest để impression đến trễ vẫn đúng giá). Giá KHÔNG nằm trong JSON gửi xuống TV (không đổi etag/giao thức).
- Mỗi impression hợp lệ: `đơn giá = max(giá chốt, sàn chốt)` theo (khu vực thiết bị, khung giờ của `ts`). Giá đi vào `ev_ad_impression.revenue_micro_vnd`, rồi vào `spend_events.amount_micro_vnd` (mỗi lượt một dòng: số tiền chính là đơn giá của lượt đó) và `spend_dedupe.amount_micro_vnd` (tổng lô, cùng `impressions`: đơn giá trung bình = tổng / số lượt).
- Không có giá chốt cho chiến dịch trong bản manifest: local/test dùng giá dự phòng; **production dùng 0 nên impression bị gắn `no_price`, không tính tiền** (không bao giờ tính một giá tự đoán).
- Idempotent giữ nguyên: khóa khử trùng theo `event_id`, trần giờ và PoP dedupe của p5 không đổi; `ts` bất biến nên lô giao lại luôn ra đúng số tiền cũ. `reconcile-revenue` tiếp tục khớp vì cả hai vế (`spend_events` và `impression_hourly`) lấy từ cùng `revenue_micro_vnd`.

## 5. Khách thấy giá trước khi gửi

- `GET /portal/v1/pricing/quote?screen_type=tv&budget_vnd=5000000`: báo giá trước khi tạo chiến dịch (đơn giá mỗi khung giờ, số lượt ước tính bằng BigInt).
- `GET /portal/v1/campaigns/:id/quote`: báo giá của chiến dịch (`status: quoted`, theo bảng giá hiện hành) hoặc **giá đã chốt** (`locked: true`) sau khi duyệt. Khách KHÔNG thấy giá sàn, giá niêm yết, nguồn; nhân viên (`/admin/v1/campaigns/:id/quote`, `/admin/v1/pricing/quote`) thấy đủ.
- Thiếu bảng giá: `status: unavailable` kèm thông báo.

## 6. Quản trị bảng giá

`/admin/v1/rate-cards` (xem: `finance:view`; tạo/sửa/kết thúc: `finance:approve`, nhóm quyền "quản lý tài chính"; mô-đun RBAC hiện chỉ có 4 hành động view/write/approve/delete nên `approve` đóng vai `manage`). Mọi thay đổi ghi `audit_log` (`rate_card.create`, `rate_card.revise`, `rate_card.end`) kèm giá cũ/mới.

| Thao tác | Ý nghĩa |
|---|---|
| `GET /` (lọc `current=1`, `screen_type`, `region_id`, `daypart`, `customer_id`) | danh sách, `status`: `current`/`scheduled`/`expired`/`inactive` |
| `POST /` | dòng mới (giá nhập `price_vnd` dạng chuỗi thập phân tối đa 6 chữ số, hoặc `price_micro_vnd` số nguyên) |
| `PUT /:id` | "sửa" = phiên bản mới từ dòng này (cần `effective_from` muộn hơn nếu đặt) |
| `DELETE /:id` | kết thúc dòng (không xóa vật lý) |

Kiểm tra: giá lớn hơn 0, giá sàn không âm, giá niêm yết quy ra mỗi lượt phải ≥ giá sàn.

## 7. Thiết lập bảng giá đầu tiên (production)

Production **bắt đầu rỗng** (bootstrap không tạo dòng giá); chiến dịch không gửi duyệt/duyệt được cho tới khi có bảng giá. Demo seed có bảng giá mẫu (TV 25/40 ₫, thang máy 60/90 ₫, LED CPM 120.000/180.000 ₫, Hà Nội/TP.HCM giờ cao điểm 48 ₫) **chỉ để demo**, không dùng làm giá bán.

1. Chủ dự án chốt bảng giá thử (xem rào chắn giá dưới đây), ghi rõ là giá pilot.
2. Đăng nhập tài khoản `finance` (hoặc super admin), tạo dòng mặc định để phủ mọi trường hợp:
   `POST /admin/v1/rate-cards {"price_vnd":"<đ/lượt>","floor_vnd":"<sàn>","note":"Giá pilot"}`.
3. Thêm dòng cụ thể theo loại màn/khung giờ/khu vực khi cần (ví dụ `screen_type:"tv", daypart:"peak"`). Nhớ đặt giá sàn ở dòng cụ thể (dòng cụ thể không thừa kế sàn của dòng mặc định).
4. Kiểm tra bằng `GET /admin/v1/pricing/quote?screen_type=tv&customer_id=<id>` rồi tạo thử một chiến dịch nháp và xem `/campaigns/:id/quote`.
5. Giá riêng cho khách: tạo dòng với `customer_id` hoặc thêm dòng hợp đồng có giá thỏa thuận.

## 8. Rào chắn giá (COMMERCIAL-READINESS mục 4, [ƯT], chủ dự án quyết)

1. Không bán dưới giá vốn đã đo: đặt `floor` ≥ giá vốn mỗi lượt theo `docs/COST-MODEL.md` (chạy lại với số TV thật). Hệ thống đã ép sàn ở mọi đường (bảng giá, hợp đồng, chốt giá, gateway).
2. Bảng giá niêm yết + giá sàn trong hệ thống: có (tài liệu này). Chưa có luồng "hai người duyệt" để hạ giá dưới sàn: hiện KHÔNG có cách hạ dưới sàn; muốn hạ phải đổi sàn bằng một phiên bản mới (có audit, chỉ `finance:approve`).
3. Nạp trả trước tối thiểu 5.000.000 ₫, không công nợ trong pilot: ngoài phạm vi p1 (thuộc luồng ví/credit).
4. Giá thử với 3–5 khách trước khi niêm yết: dùng dòng `customer_id` hoặc dòng hợp đồng, ghi "pilot" ở `note`; không cam kết giữ giá sang giai đoạn 2 (đổi bằng phiên bản mới, chiến dịch đang chạy giữ giá đã chốt đến hết).
5. Không cam kết lượt xem/doanh số: báo giá hiển thị số lượt ước tính theo ngân sách và đơn giá, không phải cam kết; hợp đồng ghi số liệu AMS là căn cứ tính tiền.
6. Phí cổng thanh toán: chốt ai chịu trước khi niêm yết, gộp vào giá.
7. Tổng số dư ví trong pilot giữ ≤ mức chấp nhận mất.

## 9. Giới hạn hiện tại (nói thẳng)

- Chiến dịch chỉ sửa được ở trạng thái nháp/bị trả lại và duyệt lại sẽ chốt lại giá (theo bảng giá lúc duyệt lại); không có cách đổi giá một chiến dịch đang chạy ngoài việc trả lại rồi duyệt lại.
- Hợp đồng chỉ áp khi chiến dịch gắn `contract_id` (tự chọn hợp đồng `active` mới nhất của khách có dòng giá thỏa thuận lúc tạo chiến dịch, hoặc nhân viên chỉ định). Không có màn web riêng để soạn dòng hợp đồng: dùng API `POST /admin/v1/contracts/:id/lines`.
- Không có gói/chiết khấu theo khối lượng, không có giá động theo mùa ngoài phiên bản theo ngày.
- Cửa sổ cao điểm 17:00–22:00 cố định trong mã; đổi cần sửa mã và chỉ có hiệu lực với chiến dịch duyệt sau đó.
- Chưa kiểm trên D1/Cloudflare thật (test chạy PGlite và `node:sqlite`).
