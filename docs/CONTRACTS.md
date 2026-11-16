# Soạn hợp đồng và xuất PDF

Mã: `packages/shared/src/contract-doc.ts` (hàm thuần: thay biến, dựng điều khoản, dấu vân tay), `services/api/src/contracts-doc/` (`routes.ts`, `service.ts`, `pdf.ts`, `default-template.ts`, `fonts.gen.ts`), migration `packages/db/migrations/0012_contract_docs.sql`, giao diện `apps/web-admin/src/pages/ContractDocEditor.tsx` (menu "Quảng cáo > Soạn hợp đồng & PDF", mở nhanh bằng `/contract-docs?contract=<mã hợp đồng>`).
Test: `packages/shared/test/contract-doc.test.ts`, `services/api/test/u2-contract-docs.test.ts`, `apps/web-admin/src/test/ContractDocEditor.test.tsx`.

Đây là công cụ dựng văn bản. Nội dung mẫu là BẢN NHÁP do kỹ thuật soạn, chưa có giá trị pháp lý cho tới khi luật sư duyệt (mục 3).

## 1. Dữ liệu

| Bảng | Ý nghĩa |
|---|---|
| `contract_doc_templates` | Mẫu có phiên bản (`code` + `version`), `articles` (JSON danh sách điều khoản), `status`: `draft` (chưa duyệt) → `approved` (luật sư đã duyệt, bất biến) → `retired`. Lưu `lawyer_ref`, người duyệt, thời điểm duyệt. Khác với bảng cũ `contract_templates` (mẫu HTML cho `POST /contracts/:id/render`, vẫn giữ nguyên). |
| `contract_docs` | Bản soạn theo từng hợp đồng: `version` (1, 2, ...), `status`: `draft` → `final` → `superseded`. `variables` và `article_overrides` là phần người dùng sửa; khi chốt lưu thêm `snapshot` (mô hình văn bản đầy đủ), `rendered_text`, `content_hash` (SHA-256). Mỗi hợp đồng chỉ có một bản nháp cùng lúc (chỉ mục duy nhất từng phần). |

Mẫu mặc định (`ads-service` v1, trạng thái `draft`) được nạp khi mở danh sách mẫu hoặc tạo bản soạn đầu tiên. Cấu trúc điều khoản: các bên ký kết (mở đầu, không đánh số), 1 dịch vụ và thời hạn, 2 giá dịch vụ (bảng giá lấy từ dòng hợp đồng), 3 thanh toán, 4 quy tắc nội dung và bảo vệ trẻ em (kid-safe), 5 trách nhiệm và bồi thường, 6 bảo mật, 7 bảo vệ dữ liệu cá nhân (Nghị định 13/2023/NĐ-CP), 8 tạm dừng và chấm dứt, 9 giải quyết tranh chấp, 10 hiệu lực và chữ ký.

### Biến `{{...}}`

Danh mục biến: `GET /admin/v1/contract-docs/variables` (cũng là hằng `CONTRACT_VARIABLES`). Biến "tự động" lấy từ hồ sơ khách hàng, cài đặt `seller`, hợp đồng và dòng giá (người soạn có thể ghi đè). Biến "nhập tay" có giá trị gợi ý (ví dụ `payment.account` bắt buộc nhập). Chỗ trống hiển thị `……………` trong bản nháp; bản chốt từ chối khi còn chỗ trống (`missing_variables`). Tên biến lạ bị từ chối (`unknown_variable`), giá trị biến chèn vào chỉ là chữ, không được thay lại lần hai. Dòng `{{price_table}}` đứng riêng chèn bảng giá.

Bảng giá: mỗi dòng `contract_lines` (loại màn hình, khu vực, khung giờ, tần suất, thời lượng, số lượng) kèm đơn giá mỗi lượt thỏa thuận từ `contract_line_prices` (xem `docs/PRICING.md`), dưới là giá trị trước thuế, VAT, tổng thanh toán tính từ `contracts.value_vnd` và `vat_rate`.

## 2. API (`/admin/v1/contract-docs`, tài khoản nội bộ)

| Method + đường dẫn | Quyền | Ghi chú |
|---|---|---|
| `GET /variables`, `GET /templates`, `GET /templates/:id` | `customers:view` | Mẫu trả kèm `draft_problems` (còn chỗ trống `[...]` hoặc dòng "BẢN NHÁP"). |
| `POST /templates`, `PUT /templates/:id` | `admin:write` | Tạo phiên bản mới (luôn `draft`); chỉ sửa được mẫu `draft`. Kiểm tra biến lạ, khóa trùng. |
| `POST /templates/:id/approve` | `admin:approve` | Bắt buộc `confirm_lawyer_approved: true`; còn dấu hiệu nháp thì 422 `draft_not_final` trừ khi `allow_draft_markers`. Mẫu cũ cùng `code` thành `retired`. Audit `contract_template.approve` (kèm `lawyer_ref`). |
| `GET /by-contract/:contractId` | `customers:view` | Danh sách phiên bản của hợp đồng. |
| `POST /by-contract/:contractId` | `customers:write` | Tạo bản nháp từ mẫu (mặc định: mẫu đã duyệt mới nhất, nếu chưa có thì mẫu nháp). 409 `draft_exists` nếu đã có bản nháp. |
| `GET /:id`, `GET /:id/preview` | `customers:view` | Văn bản dựng lại từ mẫu + hồ sơ hiện tại (bản nháp) hoặc từ `snapshot` (bản đã chốt), kèm `missing`, `computed_hash`. |
| `PUT /:id` | `customers:write` | Sửa `variables` và `article_overrides` (`{ khóa_điều_khoản: { title?, body? } }`) của bản nháp. Audit `contract_doc.update`. |
| `DELETE /:id` | `customers:write` | Chỉ xóa bản nháp. |
| `POST /:id/finalize` | `admin:approve` | Chốt: yêu cầu mẫu đã duyệt (422 `template_not_approved`), hết chỗ trống, và nếu gửi `content_hash` thì phải khớp nội dung hiện tại (409 `content_changed`). Lưu snapshot + hash, các bản chốt cũ thành `superseded`. Audit `contract_doc.finalize` ghi `content_hash`, phiên bản, mẫu, `lawyer_ref`. |
| `GET /:id/pdf` | `customers:view` | `application/pdf`, tải xuống. Header `X-Content-Hash`, `X-Contract-Doc-Status`. Audit `contract_doc.export_pdf`. |
| `GET/PUT/DELETE /logo`, `GET /logo/image` | xem `customers:view`; đổi/xóa `admin:write` | Logo watermark (PNG hoặc JPEG, base64 trong JSON, tối đa 600 KB, 64 đến 4000 px). |

Bảo mật: mọi đường dẫn nằm sau `authenticate` + `requireInternal` + CSRF; tài khoản khách bị 403. Bản soạn luôn được nạp theo `id` rồi đối chiếu hợp đồng tồn tại; id lạ hoặc sai hợp đồng trả 404. Bản chốt bất biến trước đổi hồ sơ sau đó (đọc từ snapshot); cập nhật dùng `WHERE status = 'draft'` nên hai người chạy đua không ghi đè bản đã chốt. Logo được kiểm tra magic bytes và phân tích bằng pdf-lib (tệp không phải ảnh bị từ chối, không có SVG), lưu ở kho đối tượng với khóa `branding/contract-logo-<sha>` và đường dẫn tải chỉ có cho người đã đăng nhập.

## 3. Việc luật sư và người duyệt phải làm

1. Rà soát mẫu `ads-service` v1: điền các chỗ `[...]` (căn cứ pháp lý, lãi chậm trả, trần bồi thường và phạt vi phạm, danh mục ngành cấm và hạn chế, văn bản pháp luật dữ liệu cá nhân đang có hiệu lực, cơ quan giải quyết tranh chấp). Sửa trực tiếp mẫu nháp bằng `PUT /templates/:id` hoặc tạo phiên bản mới.
2. Người có `admin:approve` bấm "Xác nhận luật sư đã duyệt" (Web Admin > Soạn hợp đồng > Mẫu hợp đồng) và ghi tham chiếu ý kiến luật sư.
3. Chỉ sau đó mới chốt được bản ký. Bản nháp vẫn xuất PDF để xem nhưng luôn có dòng đỏ "BẢN NHÁP" trên mọi trang và dấu "BẢN NHÁP" chéo mờ.
4. Chữ ký: PDF chỉ có khung ký của hai bên (ký tay, đóng dấu). Chưa có chữ ký điện tử hay lưu bản đã ký; cột `contracts.signed_file_key` chưa được nối. Nếu dùng chữ ký số, cần chọn nhà cung cấp.

## 4. PDF

A4, khổ dọc, font Be Vietnam Pro (Regular, Bold) nhúng vào tệp (tập con Latin và tiếng Việt, đóng gói base64 trong `fonts.gen.ts`, giấy phép SIL OFL 1.1, văn bản ở `services/api/src/contracts-doc/fonts/OFL.txt`). Dùng `pdf-lib` + `@pdf-lib/fontkit`, thuần JavaScript nên chạy được trên Node, Postgres/SQLite lẫn Cloudflare Workers (không phụ thuộc thư viện gốc).

- Đầu trang 1: tên và thông tin bên A, quốc hiệu, tiêu đề, số hợp đồng. Các trang sau có đầu trang chạy (tên bên A, số hợp đồng).
- Các điều khoản, bảng giá (lặp tiêu đề cột khi sang trang), khung ký hai bên, mã băm SHA-256 đầy đủ ở cuối.
- Chân mỗi trang: số hợp đồng, phiên bản, "BẢN NHÁP" hoặc "bản chốt", 16 ký tự đầu của mã băm, "Trang x/y".
- Watermark: logo công ty xoay 40 độ, ở giữa mỗi trang, độ mờ 9% (`/ca 0.09`), được vẽ đầu tiên nên nằm dưới chữ. Chưa tải logo thì dùng logo chữ "ANIO" tạo sẵn. Logo hỏng thì rơi về logo chữ, không làm hỏng việc xuất PDF.
- Bản nháp: thêm dòng đỏ ở đầu mỗi trang và dấu "BẢN NHÁP" chéo độ mờ 12%.
- Metadata PDF có `sha256:<hash>`, trạng thái và loại watermark; ngày tạo lấy theo thời điểm chốt nên xuất nhiều lần cho cùng nội dung ra cùng byte.
- Lưu ý: bản chốt dựng PDF từ snapshot nhưng dùng logo watermark hiện hành. Đổi logo sau khi chốt chỉ đổi hình mờ, không đổi nội dung hay mã băm.

Mã băm: `SHA-256(JSON[số hợp đồng, phiên bản, mã mẫu, phiên bản mẫu, văn bản thuần, bảng giá])`. Văn bản thuần gồm toàn bộ điều khoản đã thay biến và các dòng giá, nên đổi bất kỳ ký tự nào cũng đổi mã băm.

## 5. Kiểm thử

`pnpm --filter @ams/api exec vitest run test/u2-contract-docs.test.ts` kiểm tra RBAC, IDOR, chốt, audit, bất biến, PDF (đầu `%PDF-`, A4, số trang, font Be Vietnam Pro nhúng, watermark `/ca 0.09` trên mọi trang, ANIO trích được ở từng trang, dấu BẢN NHÁP, "Trang x/y", mã băm đầy đủ trên bản chốt, logo ảnh thay chữ). Đặt `AMS_TEST_PDF_OUT=/đường/dẫn` để test lưu PDF ra ổ đĩa, sau đó xem trang 1 bằng `pdftoppm -r 110 -png -f 1 -l 1 draft.pdf out`. Các kiểm tra dùng `pdftotext` tự bỏ qua nếu máy không có poppler.
