// Mau hop dong dich vu quang cao dung chung cho bootstrap va seed demo.
export const CONTRACT_BODY_DEFAULT = `# HỢP ĐỒNG DỊCH VỤ QUẢNG CÁO

Số: {{contract.no}}

Hôm nay, ngày {{contract.start_date}}, chúng tôi gồm:

**BÊN A (Bên cung cấp dịch vụ): {{seller.name}}**
Mã số thuế: {{seller.tax_code}} · Địa chỉ: {{seller.address}}
Đại diện: {{seller.rep}} · Email: {{seller.email}}

**BÊN B (Bên thuê quảng cáo): {{customer.legal_name}}**
Mã số thuế: {{customer.tax_code}} · Địa chỉ: {{customer.address}}
Đại diện: {{customer.rep_name}} · Chức vụ: {{customer.rep_title}} · Điện thoại: {{customer.phone}}

Hai bên thống nhất ký kết hợp đồng với các điều khoản sau:

**Điều 1. Nội dung dịch vụ.** Bên A cung cấp cho Bên B dịch vụ phát quảng cáo trên mạng lưới màn hình của Bên A gồm: Smart TV, màn hình thang máy (dọc 18,5"–23,8") và bảng LED P5 tại chung cư, bãi đỗ xe, theo kế hoạch phát tại Phụ lục 01.

**Điều 2. Thời hạn.** Hợp đồng có hiệu lực từ ngày {{contract.start_date}} đến ngày {{contract.end_date}}, trừ khi chấm dứt sớm theo Điều 9.

**Điều 3. Giá trị và thanh toán.** Tổng giá trị hợp đồng: {{contract.value_vnd}} (bằng chữ: {{contract.value_words}}), chưa bao gồm thuế GTGT {{contract.vat_rate}}%. Bên B thanh toán trước {{contract.advance_pct}}% trong vòng 07 ngày kể từ ngày ký; phần còn lại theo điều khoản: {{contract.payment_terms}}.

**Điều 4. Nội dung quảng cáo.** Bên B chịu trách nhiệm về tính hợp pháp, bản quyền và tính xác thực của nội dung. Bên A có quyền từ chối hoặc gỡ nội dung vi phạm pháp luật, thuần phong mỹ tục hoặc quy định của chủ tòa nhà.

**Điều 5. Nghiệm thu và báo cáo.** Bên A cung cấp báo cáo phát (proof-of-play) theo tuần và báo cáo tổng kết khi kết thúc. Bên B có 05 ngày làm việc để phản hồi, quá hạn xem như chấp thuận.

**Điều 6. Quyền và nghĩa vụ của Bên A.** Phát đúng lịch; thông báo kịp thời khi có sự cố thiết bị; phát bù hoặc hoàn tiền tương ứng nếu không phát đủ cam kết do lỗi của Bên A; bảo mật thông tin của Bên B.

**Điều 7. Quyền và nghĩa vụ của Bên B.** Cung cấp nội dung đúng hạn; thanh toán đầy đủ, đúng hạn; không tự ý can thiệp thiết bị; chịu trách nhiệm trước pháp luật về nội dung quảng cáo.

**Điều 8. Bảo mật và dữ liệu cá nhân.** Hai bên giữ bí mật thông tin của nhau; xử lý dữ liệu cá nhân (nếu có) tuân thủ Nghị định 13/2023/NĐ-CP.

**Điều 9. Chấm dứt.** Mỗi bên có quyền chấm dứt khi bên kia vi phạm nghiêm trọng và không khắc phục sau 15 ngày kể từ khi nhận thông báo bằng văn bản.

**Điều 10. Bất khả kháng.** Không bên nào chịu trách nhiệm đối với chậm trễ do bất khả kháng; bên bị ảnh hưởng thông báo trong 05 ngày làm việc.

**Điều 11. Giải quyết tranh chấp.** Ưu tiên thương lượng; nếu không đạt được, đưa ra Tòa án có thẩm quyền tại nơi đặt trụ sở Bên A. Hợp đồng lập thành 02 bản.

**Phụ lục 01.** Kế hoạch phát: loại màn hình, khu vực, khung giờ, tần suất, thời lượng, tệp creative và độ phân giải.

ĐẠI DIỆN BÊN A: {{seller.rep}}    ĐẠI DIỆN BÊN B: {{customer.rep_name}}
`;
