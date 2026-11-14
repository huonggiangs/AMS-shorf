# Điều khoản dịch vụ AMS (Advertising Management System) — BẢN NHÁP

> **BẢN NHÁP, CHƯA PHẢI VĂN BẢN PHÁP LÝ.** Soạn bởi agent r5-commercial ngày 2026-11-14 làm khung để luật sư của công ty rà soát và viết lại. Chưa tra cứu nguồn pháp luật trong phiên này; mọi viện dẫn luật phải được luật sư xác nhận. Các chỗ `[...]` là quyết định kinh doanh còn bỏ trống. Không đăng lên website hay cho khách ký khi chưa có chữ ký duyệt của luật sư.

## 1. Các bên và phạm vi
1.1. Bên cung cấp: `[Tên pháp nhân, MST, địa chỉ]` ("AMS"). Khách hàng: tổ chức/cá nhân đăng ký tài khoản quảng cáo ("Khách hàng").
1.2. Dịch vụ: nền tảng đặt, duyệt, lên lịch và đo lường quảng cáo hiển thị trên các màn hình/TV đã cài ứng dụng của AMS (hiện gồm ứng dụng `[tên chính thức, hiện là Brain-rot]`), kèm cổng khách hàng, ví quảng cáo trả trước và báo cáo phát.
1.3. Dịch vụ giai đoạn thử nghiệm (pilot) có thể thay đổi; AMS ghi rõ giai đoạn trong hợp đồng/đơn đặt hàng.

## 2. Tài khoản và bảo mật
2.1. Tài khoản của Khách hàng bắt buộc xác thực hai yếu tố (TOTP). Khách hàng chịu trách nhiệm về người dùng của mình và phải báo ngay khi nghi lộ thông tin.
2.2. AMS có quyền khóa tài khoản khi nghi ngờ gian lận, vi phạm điều khoản hoặc theo yêu cầu của cơ quan có thẩm quyền.

## 3. Nội dung quảng cáo và kiểm duyệt
3.1. Khách hàng cam kết nội dung hợp pháp, trung thực, có đầy đủ quyền sử dụng (hình ảnh, nhạc, thương hiệu, người xuất hiện) và giấy phép/điều kiện cần thiết cho ngành hàng (ví dụ thuốc, thực phẩm chức năng, ngân hàng-tài chính, rượu bia) `[luật sư liệt kê theo Luật Quảng cáo và văn bản hướng dẫn]`.
3.2. Mọi nội dung phải được AMS duyệt trước khi phát. AMS được từ chối, yêu cầu sửa, tạm dừng hoặc gỡ nội dung bất kỳ lúc nào, kể cả sau khi đã duyệt, không phát sinh nghĩa vụ bồi thường ngoài hoàn lại phần ngân sách chưa dùng.
3.3. Ngành hàng cấm/hạn chế trên màn hình có trẻ em (kid_safe): `[danh sách chốt cùng luật sư; mặc định hiện có trong hệ thống: rượu bia, thuốc lá, cá cược, cờ bạc, vay nóng, nội dung người lớn, thực phẩm chức năng, thuốc]`.
3.4. Khách hàng bảo đảm quyền đối với tệp tải lên hoặc liên kết; AMS có quy trình tiếp nhận và gỡ nội dung bị khiếu nại bản quyền `[quy trình + email tiếp nhận]`.
3.5. Khách hàng bồi thường cho AMS thiệt hại phát sinh từ khiếu nại của bên thứ ba liên quan đến nội dung của Khách hàng `[mức trần]`.

## 4. Ví quảng cáo, thanh toán, hóa đơn
4.1. Mô hình trả trước: Khách hàng nạp tiền vào ví quảng cáo bằng chuyển khoản theo mã nạp tiền do hệ thống cấp. Số nạp tối thiểu `[5.000.000 ₫ — mặc định đề xuất]`. Hệ thống tự ghi có khi nhận được giao dịch khớp mã; giao dịch không khớp được xử lý thủ công trong `[N]` ngày làm việc.
4.2. Ngân sách của chiến dịch được giữ (reserve) từ ví khi duyệt và bị trừ theo lượt hiển thị hợp lệ. Lượt hợp lệ do AMS xác định theo quy tắc trong Phụ lục đo lường; số liệu của AMS là căn cứ tính tiền, trừ khi chứng minh được lỗi hệ thống.
4.3. Không cho nợ. `[Ngoại lệ hạn mức công nợ theo hợp đồng riêng, hai người duyệt.]`
4.4. Hoàn tiền: chỉ phần chưa dùng, về đúng tài khoản đã nạp, sau khi bộ phận tài chính duyệt, `[phí xử lý X]`, trong `[N]` ngày làm việc.
4.5. Hóa đơn điện tử: AMS xuất hóa đơn `[khi nạp tiền / khi sử dụng — kế toán xác nhận theo Nghị định 123/2020/NĐ-CP và văn bản sửa đổi]`. Khách hàng cung cấp đúng MST và thông tin xuất hóa đơn. Giá chưa gồm VAT trừ khi ghi khác.
4.6. Chậm thanh toán (nếu có công nợ): `[lãi, tạm dừng dịch vụ]`.

## 5. Đo lường và báo cáo
5.1. AMS cung cấp báo cáo lượt phát (proof-of-play) và lượt hiển thị. Độ trễ dữ liệu `[tối đa 60 phút — chưa cam kết]`. Số liệu từ thiết bị chưa được chứng thực hoặc bị phát hiện gian lận bị loại.
5.2. AMS không cam kết lượt xem tối thiểu, doanh số hay chuyển đổi, trừ khi hợp đồng ghi rõ.

## 6. Mức độ dịch vụ
Xem `SLA.draft.md`. Dịch vụ phát quảng cáo có thể gián đoạn do mạng, thiết bị của người dùng cuối, bảo trì hoặc nhà cung cấp hạ tầng; thiết bị giữ lịch đã tải về để phát khi mất kết nối.

## 7. Dữ liệu cá nhân
Xem `PRIVACY-POLICY.draft.md`. Các bên tuân thủ pháp luật về bảo vệ dữ liệu cá nhân hiện hành `[luật sư xác nhận văn bản và ngày hiệu lực áp dụng]`. Khách hàng không được dùng dữ liệu báo cáo để nhận diện cá nhân người xem.

## 8. Sở hữu trí tuệ, bảo mật thông tin
Mỗi bên giữ quyền với tài sản của mình. Khách hàng cấp cho AMS quyền không độc quyền để lưu trữ, chuyển mã, phát và sao lưu nội dung phục vụ hợp đồng. `[Điều khoản bảo mật thông tin hai chiều.]`

## 9. Giới hạn trách nhiệm
Trách nhiệm tối đa của AMS trong mọi trường hợp không vượt quá `[số tiền Khách hàng đã thanh toán trong 3 tháng gần nhất]`; loại trừ thiệt hại gián tiếp, mất doanh thu. `[Luật sư kiểm tra tính hợp lệ của giới hạn theo luật Việt Nam.]`

## 10. Chấm dứt, luật áp dụng
Mỗi bên chấm dứt với thông báo `[30]` ngày; chấm dứt ngay khi vi phạm nghiêm trọng. Luật Việt Nam; tranh chấp giải quyết tại `[Tòa án/Trung tâm trọng tài]`.

## Việc còn thiếu trước khi dùng
- Phụ lục đo lường (định nghĩa lượt hợp lệ: trần 120 lượt/thiết bị/giờ, thiết bị `trust_level >= 1`, VCR) — lấy từ `docs/SLO.md` và `services/edge-gateway/src/events.ts`.
- Bảng giá và chính sách giá sàn (chưa tồn tại; xem `docs/COMMERCIAL-READINESS.md` mục P0).
- Hợp đồng mẫu 11 điều khoản trong hệ thống (`contract_templates`) cần luật sư đối chiếu với tài liệu này.
