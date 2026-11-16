# Pháp lý, hóa đơn, tuân thủ: việc người (luật sư, kế toán) phải làm

Ba bản trong thư mục này (`TERMS-OF-SERVICE.draft.md`, `PRIVACY-POLICY.draft.md`, `SLA.draft.md`) là BẢN NHÁP do kỹ thuật soạn. Chúng chưa có giá trị pháp lý. Hệ thống không bao giờ tự phát hành chúng.

## 1. Văn bản pháp lý (luật sư)

- Khi API chạy lần đầu, ba bản nháp được nạp vào bảng `legal_documents` ở trạng thái `draft` (sinh từ các file `.draft.md` bằng `pnpm --filter @ams/api gen:legal`, kết quả nằm ở `services/api/src/legal/documents.gen.ts`).
- Luật sư rà soát và sửa nội dung, dòng "BẢN NHÁP" và mọi chỗ trống dạng `[...]` phải được thay hết. Sửa trực tiếp trong trang Web Admin > Quản trị > Văn bản pháp lý (chỉ sửa được bản nháp) hoặc tạo phiên bản mới.
- Phát hành: chỉ vai trò có `admin:approve` (super_admin). Hộp thoại bắt buộc tick "luật sư đã duyệt"; nếu còn dấu hiệu bản nháp, hệ thống từ chối (`draft_not_final`) trừ khi người duyệt chủ động chọn bỏ qua. Phát hành ghi audit `legal.document.publish` kèm dấu vân tay SHA-256.
- Sau khi có bản phát hành, mọi tài khoản bên ngoài (khách, đối tác) bị chặn ở màn hình chấp nhận điều khoản cho đến khi đồng ý (lần đầu đăng nhập và mỗi phiên bản mới). Cổng chặn ở máy chủ (403 `terms_acceptance_required`), không chỉ ở giao diện. Chưa phát hành văn bản nào thì chưa chặn ai.
- Bằng chứng chấp nhận: bảng `legal_acceptances` (tài khoản, văn bản, phiên bản, SHA-256, thời điểm, IP, user-agent) và audit `legal.accept`. Xem ở tab "Lịch sử chấp nhận".
- Cần quyết định ngoài code: pháp nhân bên bán, luật điều chỉnh và nơi giải quyết tranh chấp, mức bồi thường SLA, thời hạn lưu giữ, danh sách ngành hạn chế cuối cùng (hằng `RESTRICTED_CATEGORIES` trong `packages/shared/src/compliance.ts`).

## 2. Hóa đơn điện tử (kế toán)

- Mặc định `manual`: kế toán phát hành trên cổng nhà cung cấp rồi nhập số hóa đơn vào Web Admin > Doanh thu > Công nợ & Hóa đơn điện tử.
- MISA meInvoice và Viettel S-Invoice mới chỉ có khung (`services/api/src/billing/einvoice-providers.ts`): cài đặt, sandbox, chữ ký giữ chỗ (HMAC), thử lại (1 phút, 5 phút, 15 phút, 1 giờ, 4 giờ, 12 giờ; tối đa 6 lần), khóa idempotency `ams:<invoiceId>:<loại>`. Kế toán và nhà cung cấp phải: cấp tài khoản sandbox, cung cấp tài liệu API hiện hành, ánh xạ trường thật (người mua, thuế suất, dòng hàng), thay chữ ký giữ chỗ bằng cơ chế xác thực thật, kiểm thử sandbox rồi mới bật chế độ thật.
- Thông tin xác thực KHÔNG nhập trên giao diện. Đặt bằng biến môi trường máy chủ: `EINVOICE_MISA_*` hoặc `EINVOICE_VIETTEL_*` với `BASE_URL`, `SANDBOX_URL`, `CLIENT_ID`, `SECRET`, `SELLER_TAX_CODE`. Trang cài đặt báo biến nào còn thiếu.
- Hoàn tiền (xem `docs/SEPAY.md` mục 5) tạo hóa đơn điều chỉnh qua job hằng ngày hoặc nút "Điều chỉnh"; hủy hóa đơn nội bộ tạo chứng từ hủy. Kế toán xác nhận việc điều chỉnh/hủy có đúng quy định hiện hành (Nghị định 123/2020, Thông tư 78/2021) hay không.

## 3. Công nợ và nhắc nợ (kế toán, kinh doanh)

- Cài đặt ở tab "Nhắc nợ": mốc ngày gửi email (âm = trước hạn), số ngày quá hạn thì tự tạm dừng chiến dịch, bật/tắt hạn mức công nợ, cảnh báo số dư thấp, cho phép gửi email.
- Hạn mức công nợ lấy từ `customers.credit_limit_vnd`. Hạn mức 0 nghĩa là không đặt hạn mức (vẫn bị chặn duyệt chiến dịch khi có khoản quá hạn). Cần chính sách nội bộ: ai được cấp hạn mức, mức nào, ai duyệt.
- Nội dung email nhắc nợ là mẫu kỹ thuật; bộ phận kinh doanh/pháp chế cần duyệt lời lẽ.

## 4. Dữ liệu cá nhân (Nghị định 13/2023) (pháp chế)

- Yêu cầu chủ thể dữ liệu: Web Admin > Quản trị > Dữ liệu cá nhân & Lưu giữ. Xuất dữ liệu trả JSON ngay trong phản hồi, không lưu bản sao. Ẩn danh thay thông tin nhận diện bằng giá trị che nhưng giữ nguyên sổ cái tài chính và hóa đơn (nghĩa vụ lưu trữ kế toán). Mặc định hạn xử lý 72 giờ; pháp chế xác nhận.
- Chính sách lưu giữ cho bảng sự kiện thô `ev_*` chạy hằng ngày (mặc định 30 ngày nhịp thiết bị, 400 ngày lượt hiển thị và bằng chứng phát; tối thiểu 7 ngày). Pháp chế quyết định thời hạn cuối cùng.
- Sổ đăng ký hoạt động xử lý (`processing_records`) được khởi tạo từ hiện trạng kỹ thuật; pháp chế bổ sung căn cứ pháp lý, chuyển dữ liệu ra nước ngoài, hồ sơ đánh giá tác động và thông báo cho cơ quan chức năng nếu cần.

## 5. KYC nhà quảng cáo (kinh doanh, pháp chế)

- Khách tải giấy chứng nhận đăng ký doanh nghiệp và giấy phép ngành nghề trong "Hồ sơ của tôi"; nhân viên duyệt ở "Hồ sơ pháp lý khách hàng". Người duyệt phải khác người nộp. Tệp lưu ở kho đối tượng, tải bằng đường dẫn ký sẵn.
- Cờ ngành hạn chế do người duyệt đặt; chiến dịch thuộc ngành hạn chế cần duyệt lần hai bởi người khác (`campaigns:approve`). Nhóm ngành hạn chế cuối cùng do luật sư chốt.
- Cài đặt `kyc_required_for_approval` (bảng `settings`) quyết định có bắt buộc KYC đã duyệt trước khi duyệt chiến dịch hay không.

## 5b. Hợp đồng soạn từ mẫu và PDF (luật sư)

Mẫu hợp đồng dịch vụ quảng cáo (`contract_doc_templates`, mã `ads-service`) cũng là BẢN NHÁP và cũng cần luật sư duyệt trước khi chốt bản ký. Cách làm, các chỗ `[...]` cần điền và cổng chặn (`template_not_approved`) nằm ở `docs/CONTRACTS.md`. Bản nháp xuất PDF luôn có dấu "BẢN NHÁP"; PDF có logo mờ ở mọi trang (cấu hình trong Web Admin > Soạn hợp đồng > Logo watermark).

## 6. Chưa làm (cần quyết định hoặc cần nhà cung cấp)

Chữ ký điện tử cho hợp đồng, lọc thiết bị `kid_safe` theo đối tượng, quy trình gỡ nội dung theo khiếu nại, tự đăng ký công khai, ánh xạ trường thật của MISA/Viettel.
