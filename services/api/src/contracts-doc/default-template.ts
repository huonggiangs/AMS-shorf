// Mau hop dong dich vu quang cao mac dinh. BAN NHAP do ky thuat soan: chua co gia tri phap ly, luat su phai ra soat va duyet
// (POST /admin/v1/contract-docs/templates/:id/approve) truoc khi chot ban dung de ky. Cho trong luat su can dien viet dang `[...]`.
import type { ContractArticle } from '@ams/shared';

export const DEFAULT_TEMPLATE_CODE = 'ads-service';
export const DEFAULT_TEMPLATE_NAME = 'Hợp đồng dịch vụ quảng cáo (mẫu mặc định, bản nháp)';
export const DEFAULT_TEMPLATE_NOTE = 'Bản nháp nạp sẵn: chưa được luật sư duyệt.';

export const DEFAULT_TEMPLATE_ARTICLES: ContractArticle[] = [
  {
    key: 'parties',
    numbered: false,
    title: 'Các bên ký kết',
    body: `Căn cứ Bộ luật Dân sự năm 2015, Luật Thương mại năm 2005, Luật Quảng cáo năm 2012 và nhu cầu, khả năng của hai bên. \`[Luật sư rà soát danh mục căn cứ pháp lý.]\`

Hôm nay, {{contract.sign_date}}, tại {{contract.place}}, chúng tôi gồm:

**BÊN A (Bên cung cấp dịch vụ): {{seller.name}}**

- Mã số thuế: {{seller.tax_code}}
- Địa chỉ: {{seller.address}}
- Đại diện: {{seller.rep}}, chức vụ: {{seller.rep_title}}
- Email: {{seller.email}}

**BÊN B (Bên thuê quảng cáo): {{customer.legal_name}}**

- Mã số thuế: {{customer.tax_code}}
- Địa chỉ: {{customer.address}}
- Đại diện: {{customer.rep_name}}, chức vụ: {{customer.rep_title}}

Hai bên thống nhất ký kết hợp đồng số {{contract.no}} với các điều khoản sau:`,
  },
  {
    key: 'services',
    title: 'Nội dung dịch vụ và thời hạn',
    body: `Bên A cung cấp cho Bên B dịch vụ phát nội dung quảng cáo trên mạng lưới màn hình của Bên A (Smart TV, màn hình thang máy, bảng LED) theo kế hoạch phát và bảng giá tại Điều 2.

Thời hạn hợp đồng: từ ngày {{contract.start_date}} đến ngày {{contract.end_date}}, trừ khi chấm dứt sớm theo Điều 8.

Bên A cung cấp báo cáo phát (bằng chứng phát, proof-of-play) theo tuần và báo cáo tổng kết khi kết thúc. Số liệu do hệ thống của Bên A ghi nhận là căn cứ tính tiền; Bên B có 05 ngày làm việc kể từ ngày nhận báo cáo để phản hồi bằng văn bản. Bên A không cam kết số lượt xem hay hiệu quả bán hàng của quảng cáo.`,
  },
  {
    key: 'price',
    title: 'Giá dịch vụ',
    body: `Giá dịch vụ được tính theo từng lượt phát với đơn giá tại bảng dưới đây. Đơn giá có thể được nâng lên bằng giá sàn của bảng giá niêm yết tại thời điểm duyệt chiến dịch.

{{price_table}}

Giá trị hợp đồng trước thuế: {{contract.value_vnd}} đồng (bằng chữ: {{contract.value_words}}). Thuế GTGT {{contract.vat_rate}}%: {{contract.vat_vnd}} đồng. Tổng thanh toán: {{contract.total_vnd}} đồng (bằng chữ: {{contract.total_words}}).`,
  },
  {
    key: 'payment',
    title: 'Thanh toán',
    body: `Bên B thanh toán tạm ứng {{contract.advance_pct}}% tổng thanh toán (tương ứng {{contract.advance_vnd}} đồng) trong vòng {{payment.days}} ngày kể từ ngày ký. Phần còn lại thanh toán theo điều kiện: {{contract.payment_terms}}.

Thanh toán bằng chuyển khoản vào tài khoản của Bên A: {{payment.account}}. Nội dung chuyển khoản ghi số hợp đồng {{contract.no}}.

Bên A xuất hóa đơn điện tử theo quy định của pháp luật về hóa đơn, chứng từ. Chậm thanh toán chịu lãi theo mức \`[mức lãi chậm trả, luật sư điền]\`; Bên A có quyền tạm dừng phát cho đến khi Bên B thanh toán đủ khoản quá hạn.`,
  },
  {
    key: 'content_rules',
    title: 'Quy định về nội dung quảng cáo và bảo vệ trẻ em',
    body: `Bên B chịu trách nhiệm về tính hợp pháp, tính trung thực, bản quyền và quyền sử dụng hình ảnh, âm thanh trong nội dung quảng cáo, và bảo đảm tuân thủ Luật Quảng cáo.

Mọi nội dung phải được Bên A duyệt trước khi phát. Bên A có quyền từ chối hoặc gỡ ngay nội dung vi phạm pháp luật, thuần phong mỹ tục, quy định của chủ tòa nhà hoặc nội dung thuộc ngành hạn chế do Bên A công bố.

Các màn hình tại nơi có trẻ em (khu vui chơi, thang máy chung cư, màn hình khóa hoặc màn hình dành cho trẻ em) áp dụng chính sách an toàn cho trẻ em:

- Quảng cáo ở màn hình khóa và màn hình trẻ em mặc định không được phát; chỉ phát khi Bên A bật cài đặt riêng sau khi xác nhận chính sách trẻ em.
- Nội dung phát tại các màn hình này phải được đánh dấu phù hợp cho trẻ em (kid-safe) và được Bên A duyệt riêng.
- Nghiêm cấm nội dung bạo lực, khiêu dâm, rượu bia, thuốc lá, cờ bạc, thực phẩm chức năng gây hiểu lầm, hoặc nhằm lôi kéo trẻ em tự ý mua hàng, theo Luật Trẻ em năm 2016 và danh mục ngành hạn chế của Bên A.
- Bên A có quyền tạm dừng phát ngay khi nhận được khiếu nại có căn cứ và không phải bồi thường cho việc tạm dừng đó.

\`[Luật sư xác nhận danh mục ngành cấm và hạn chế cuối cùng.]\``,
  },
  {
    key: 'liability',
    title: 'Trách nhiệm và bồi thường',
    body: `Bên A phát đúng lịch đã thỏa thuận; thông báo kịp thời khi có sự cố thiết bị; nếu không phát đủ cam kết do lỗi của Bên A thì phát bù trong vòng {{terms.makeup_days}} ngày hoặc hoàn lại phần tiền tương ứng.

Bên B không tự ý can thiệp thiết bị, phần mềm của Bên A; cung cấp nội dung đúng hạn; thanh toán đủ, đúng hạn.

Tổng mức bồi thường của một bên cho bên kia (nếu có) không vượt quá {{terms.liability_cap_pct}}% giá trị hợp đồng, trừ trường hợp cố ý vi phạm hoặc vi phạm nghĩa vụ bảo mật, nội dung bất hợp pháp. Bên B tự chịu trách nhiệm và bồi hoàn cho Bên A mọi khiếu nại của bên thứ ba phát sinh từ nội dung quảng cáo của Bên B. \`[Luật sư rà soát điều khoản trần bồi thường, phạt vi phạm theo Điều 300-301 Luật Thương mại.]\``,
  },
  {
    key: 'confidentiality',
    title: 'Bảo mật thông tin',
    body: `Mỗi bên giữ bí mật thông tin kinh doanh, giá, số liệu báo cáo và tài liệu kỹ thuật của bên kia biết được khi thực hiện hợp đồng, không tiết lộ cho bên thứ ba trừ khi có yêu cầu của cơ quan nhà nước có thẩm quyền hoặc được bên kia đồng ý bằng văn bản.

Nghĩa vụ bảo mật còn hiệu lực {{terms.confidential_years}} năm sau khi hợp đồng chấm dứt.`,
  },
  {
    key: 'data_protection',
    title: 'Bảo vệ dữ liệu cá nhân',
    body: `Hai bên tuân thủ Nghị định 13/2023/NĐ-CP về bảo vệ dữ liệu cá nhân và văn bản thay thế, sửa đổi, bổ sung (nếu có). \`[Luật sư xác nhận văn bản pháp luật về dữ liệu cá nhân đang có hiệu lực.]\`

Bên A chỉ xử lý dữ liệu cá nhân của người đại diện, người liên hệ của Bên B (họ tên, chức vụ, điện thoại, email) cho mục đích ký kết, thực hiện, thanh toán và đối soát hợp đồng; lưu giữ theo thời hạn pháp luật về kế toán và thuế; áp dụng biện pháp bảo mật kỹ thuật phù hợp.

Hệ thống phát quảng cáo của Bên A không thu thập dữ liệu nhận dạng cá nhân của người xem. Bên B không được đưa vào nội dung quảng cáo cơ chế thu thập dữ liệu cá nhân (mã QR dẫn tới biểu mẫu thu thập, cookie, theo dõi) nếu chưa có thỏa thuận riêng bằng văn bản và căn cứ pháp lý phù hợp.

Bên B bảo đảm đã có căn cứ hợp pháp khi cung cấp dữ liệu cá nhân của người của mình cho Bên A.`,
  },
  {
    key: 'termination',
    title: 'Tạm dừng và chấm dứt hợp đồng',
    body: `Hợp đồng chấm dứt khi hết thời hạn; khi hai bên thỏa thuận bằng văn bản; hoặc khi một bên đơn phương chấm dứt bằng thông báo trước {{terms.termination_notice_days}} ngày nếu bên kia vi phạm nghiêm trọng mà không khắc phục trong thời hạn đó.

Bên A được tạm dừng hoặc chấm dứt ngay, không phải bồi thường, nếu nội dung của Bên B vi phạm pháp luật hoặc Điều 4, hoặc Bên B chậm thanh toán quá thời hạn gia hạn đã thông báo.

Khi chấm dứt, hai bên đối soát số lượt phát thực tế; Bên A hoàn lại phần tiền đã nhận nhưng chưa thực hiện (sau khi trừ chi phí hợp lý đã phát sinh), hoặc Bên B thanh toán phần đã thực hiện chưa được thanh toán.`,
  },
  {
    key: 'dispute',
    title: 'Giải quyết tranh chấp và luật áp dụng',
    body: `Hợp đồng được điều chỉnh bởi pháp luật Việt Nam. Tranh chấp được ưu tiên giải quyết thông qua thương lượng trong 30 ngày kể từ ngày một bên có thông báo; nếu không thành thì đưa ra: {{terms.dispute_venue}}. \`[Luật sư xác nhận cơ quan giải quyết tranh chấp.]\``,
  },
  {
    key: 'final',
    title: 'Hiệu lực và chữ ký',
    body: `Hợp đồng có hiệu lực kể từ ngày ký và được lập thành 02 (hai) bản có giá trị như nhau, mỗi bên giữ 01 bản. Mọi sửa đổi, bổ sung phải bằng văn bản có chữ ký của hai bên. Bản điện tử này có mã băm nội dung (SHA-256) ghi ở chân trang cuối để đối chiếu nguyên vẹn.`,
  },
];
