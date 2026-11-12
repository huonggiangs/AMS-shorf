# AMS: đề xuất tối ưu cho bản thương mại

Cơ sở: `DAC-TA-GIAO-VIEC-AGENT.md`, `PLAN.md`, `COST-MODEL.md`, `THREAT-MODEL.md`. Công sức tính theo kỹ sư-tuần, **[ƯT]** (ước tính của tác giả, chưa đo). Các điều khoản pháp lý dưới đây ghi từ kiến thức chung, **chưa tra cứu nguồn trong phiên này và có thể đã đổi; luật sư/kế toán của công ty phải xác nhận trước khi áp dụng**.

Ưu tiên: **P0** = làm trước khi nhận tiền thật hoặc trước 100k thiết bị; **P1** = làm trước 1M thiết bị hoặc doanh thu ổn định; **P2** = khi có quy mô hoặc khách yêu cầu.

## 1. Giảm chi phí hạ tầng

| # | Đề xuất | Ưu | Lý do (số từ COST-MODEL) | Công sức [ƯT] | Rủi ro |
|---|---|---|---|---|---|
| 1 | Heartbeat không qua Queue; presence chỉ vào Durable Object, gộp lô ghi sự kiện | P0 | Phương án A so với B giảm 54% chi phí Cloudflare ở mọi quy mô lớn (50M: $795k xuống $363k) | 1 tuần | Mất heartbeat khi DO khởi động lại (chấp nhận được) |
| 2 | Impression vào Pipelines/Parquet, khử trùng bước sau, ledger chỉ tính từ lô đã khử trùng | P1 | B xuống C: thêm 24% (50M: $363k xuống $276k) | 2 tuần | Pipelines chưa rõ GA/SLA; độ trễ đối soát |
| 3 | Manifest phục vụ từ CDN/R2 công khai theo nhóm thiết bị, không qua Worker | P0 | Giảm 10% request Worker (4 trên 40 request/giờ); còn giảm tải KV | 1 tuần | Cache bẩn khi đổi lịch: cần `etag` + purge |
| 4 | Heartbeat thích ứng: server trả `next_interval` theo trạng thái (đang phát: 300 giây; chờ: 600 giây; thiết bị giám sát: 15 giây) | P0 | 120 xuống 300 giây giảm khoảng 50%; là tham số nhạy cảm nhất | 2 tuần | Presence trễ hơn; ngưỡng online phải theo `2,5 × chu kỳ` mới |
| 5 | Delta manifest: chỉ gửi phần đổi, etag theo nhóm | P1 | Giảm băng thông và CPU thiết bị; manifest poll 900 xuống 3.600 giây có push | 2 tuần | Lỗi đồng bộ làm thiết bị phát sai lịch; cần checksum toàn phần |
| 6 | Protobuf/CBOR, body nhỏ hơn 512 byte, nén header; HTTP/3 giữ kết nối | P1 | Trực tiếp giảm băng thông hạ tầng riêng (đặc tả đã ghi protobuf/CBOR) | 2 tuần | Gỡ lỗi khó hơn JSON |
| 7 | Lấy mẫu telemetry (SoC, Wi-Fi, cache): 1 trên 5 thiết bị chi tiết, còn lại chỉ presence; bản đầy đủ khi lỗi | P1 | Giảm khối lượng lưu, không giảm số request | 1 tuần | Mất khả năng chẩn đoán cá thể |
| 8 | Dữ liệu nguội ClickHouse sang S3 (tiering), bảng gộp cho dashboard | P1 | Lưu 12 tháng impression thô là phần lớn 26 node ở 50M | 3 tuần | Truy vấn lịch sử chậm hơn |
| 9 | Giữ media trên R2 + CDN ngay cả khi tự lưu đường nóng | P0 | Egress R2 miễn phí; tự trả băng thông 9 PB/tháng ở 50M [ƯT] sẽ đắt hơn cả hạ tầng | 0 | Điều khoản Cloudflare về phát video: phải hỏi |
| 10 | Chuyển sang hạ tầng riêng theo cờ tính năng khi vượt khoảng 1 đến 3 triệu thiết bị | P1 | Giao nhau 0,45M (đặc tả) đến 3,3M (tối ưu) | 8 đến 12 tuần (đặc tả) | Rủi ro vận hành lớn hơn chênh lệch tiền; xem mục "Rủi ro lớn nhất" |

## 2. Độ tin cậy và đối soát

| # | Đề xuất | Ưu | Lý do | Công sức [ƯT] | Rủi ro |
|---|---|---|---|---|---|
| 11 | Idempotency toàn tuyến: `event_id`, `provider_txn_id`, khóa Idempotency-Key cho mọi API ghi tiền; test webhook trùng 5 lần, 2 chiến dịch tranh 1 số dư (đã là cổng chất lượng) | P0 | Sai một lần là mất tiền hoặc tranh chấp | 1 tuần | Thấp |
| 12 | Đối soát hằng ngày ba chiều: sao kê ngân hàng/API SePay, `topups`, `wallet_entries`; đối soát impression event store với sổ cái; báo cáo lệch | P0 | Tiêu chí nghiệm thu "khớp 100%" | 2 tuần | Lệch múi giờ/cut-off |
| 13 | Kiểm tổng ví hằng ngày: `ad_wallets` = tổng `wallet_entries`; cảnh báo tự động | P0 | Bảng cache là điểm sai lệch | 2 ngày | Thấp |
| 14 | Sao lưu hằng ngày, thử khôi phục hằng quý; D1 Time Travel/Postgres PITR; audit log bản sao object lock | P0 | Đặc tả yêu cầu backup, RPO ≤5 phút, RTO ≤30 phút ở giai đoạn 3 | 2 tuần | Chưa kiểm chứng RPO/RTO |
| 15 | Kế hoạch DR: runbook, diễn tập mất vùng/mất hàng đợi (chaos test) | P1 | | 3 tuần | |
| 16 | Hàng đợi chết (DLQ) và xem lại thủ công cho webhook thất bại; retry thông minh | P0 | SePay retry tối đa 7 lần; quá ngưỡng phải đối soát bù | 1 tuần | |
| 17 | Dự phòng nhà cung cấp thanh toán thứ hai (VNPay/MoMo) | P2 | Đặc tả chưa làm | 4 tuần | Tăng bề mặt đối soát |

## 3. Bảo mật và chống gian lận impression

| # | Đề xuất | Ưu | Lý do | Công sức [ƯT] | Rủi ro |
|---|---|---|---|---|---|
| 18 | Chứng thực thiết bị thật (Play Integrity/Widevine L1 trên Android TV; hạn chế TV tự cài) và `trust_level` theo bậc | P0 | Hoa hồng người xem là mục tiêu gian lận lớn nhất | 3 đến 4 tuần | Android TV cũ không hỗ trợ; Tizen/webOS khác |
| 19 | Luật phát hợp lệ ở server: trần impression/thiết bị/giờ (theo lịch được giao), VCR 100% có nhịp tim phát (thời lượng thực), kiểm vô lý (thiết bị phát 24 giờ), phát hiện cụm thiết bị cùng IP/ASN | P0 | Ngăn doanh thu và thưởng ảo | 3 tuần | Chặn nhầm người dùng thật; cần xem lại thủ công |
| 20 | Hoa hồng trả theo kỳ đã đối soát với độ trễ giữ (hold 7 đến 14 ngày), rút tiền OTP, hạn mức rút | P0 | Cho thời gian bắt gian lận trước khi tiền ra | 2 tuần | Phàn nàn từ người xem |
| 21 | Ảnh chụp đối chứng định kỳ cho LED, proof-of-play có ký thời gian (đặc tả) | P1 | Cơ sở tranh chấp với nhãn hàng | 3 tuần | Chi phí lưu ảnh |
| 22 | Pen-test bên ngoài trước go-live; bug bounty nhỏ sau đó | P0 | Đặc tả yêu cầu | 2 tuần + chi phí ngoài | |
| 23 | Quản lý khóa: xoay vòng khóa HMAC SePay, `FIELD_ENC_KEY` có phiên bản, secret manager | P0 | Mã hóa theo trường không có xoay khóa là nợ kỹ thuật | 1 tuần | Rò khóa |
| 24 | Phát hiện lạm dụng tài khoản ngoài (tải tệp độc, nạp rồi hoàn, rửa tiền) | P1 | Xem THREAT-MODEL | 2 tuần | |

## 4. Pháp lý Việt Nam (luật sư xác nhận)

| # | Chủ đề | Ưu | Việc phải làm | Công sức | Rủi ro |
|---|---|---|---|---|---|
| 25 | Bảo vệ dữ liệu cá nhân: Nghị định 13/2023/NĐ-CP (hiệu lực 01/07/2023), và luật bảo vệ dữ liệu cá nhân đã được ban hành sau đó **[cần xác nhận ngày hiệu lực]** | P0 | Chính sách quyền riêng tư và đồng ý rõ ràng trong app TV/điện thoại; hồ sơ đánh giá tác động xử lý dữ liệu; hồ sơ đánh giá chuyển dữ liệu ra nước ngoài nếu có; quyền xóa/rút đồng ý; lưu số điện thoại băm (`phone_hash`) và email mã hóa như thiết kế | 3 tuần + luật sư | Phạt hành chính; lộ dữ liệu |
| 26 | Lưu trữ dữ liệu trong nước (đặc tả hỏi ở mục 15) | P0 | Quyết định vùng đặt dữ liệu giai đoạn 2; nếu bắt buộc lưu trong nước thì Cloudflare giai đoạn 1 phải được luật sư xem xét | | Có thể buộc chuyển sang hạ tầng trong nước sớm |
| 27 | Hóa đơn điện tử: Nghị định 123/2020/NĐ-CP và văn bản sửa đổi; nhà cung cấp Viettel S-Invoice/MISA meInvoice (đặc tả) | P0 | Chốt thời điểm xuất hóa đơn (khi nạp hay khi dùng); tích hợp API; `invoices.einvoice_ref` | 4 tuần | Nếu xuất khi nạp mà hoàn tiền: phải có hóa đơn điều chỉnh |
| 28 | Thuế TNCN thưởng người xem: khấu trừ theo quy định (mức khấu trừ cho cá nhân không có hợp đồng lao động thường áp dụng khi vượt ngưỡng, **cần kế toán xác nhận mức và ngưỡng hiện hành**); chứng từ khấu trừ; kê khai | P0 nếu trả tiền thật | Chọn: chỉ thưởng điểm quy đổi quà, hay trả tiền; thu CCCD/MST của người nhận khi vượt ngưỡng | 4 tuần | Trách nhiệm thuế tích tụ; thu thông tin nhạy cảm |
| 29 | Quy định quảng cáo (Luật Quảng cáo và nghị định hướng dẫn): nội dung cấm, thuốc/thực phẩm chức năng/ngân hàng/tài chính cần giấy tờ, quảng cáo trẻ em, giờ phát, **biển quảng cáo ngoài trời (LED P5) cần giấy phép**; thang máy: thỏa thuận ban quản lý | P0 | Danh sách ngành hạn chế và checklist duyệt nội dung; ban quản lý tòa nhà ký thỏa thuận | 3 tuần + luật sư | LED không phép bị xử phạt hoặc buộc tháo |
| 30 | Bản quyền: YouTube/Drive/Dropbox chỉ lưu tham chiếu, tải và chuyển mã **khi khách xác nhận có quyền**; điều khoản dịch vụ YouTube cấm tải nội dung ngoài tính năng cho phép; nhạc nền (bản quyền biểu diễn) | P0 | Hộp xác nhận quyền sử dụng ghi audit; quy trình gỡ nội dung; tắt "nhập từ YouTube" cho đến khi có xác nhận pháp lý, chỉ nhận tệp tải lên | 1 tuần | Khiếu nại bản quyền, chặn tài khoản |
| 31 | Hợp đồng mẫu 11 điều khoản và điều khoản sử dụng/dữ liệu | P0 | Luật sư của công ty phải rà soát (đặc tả đã nêu) | | |
| 32 | Chữ ký số/hợp đồng điện tử, lưu hợp đồng đã ký | P1 | Luật giao dịch điện tử | 2 tuần | |

## 5. Mô hình kinh doanh

| # | Đề xuất | Ưu | Lý do | Rủi ro |
|---|---|---|---|---|
| 33 | Giá theo loại màn × khung giờ × khu vực (CPM hoặc theo tuần), có bảng giá niêm yết và giá sàn RTB | P0 | Đã có `contract_lines`, `rtb_floors` | Định giá sai so với thị trường: cần thử với 3 đến 5 khách |
| 34 | Gói: Khởi đầu (nạp tối thiểu 5.000.000 ₫, chạy tự động), Tăng tốc, Hợp đồng lớn (trả sau/hạn mức) | P1 | Đặc tả có nạp tối thiểu và hạn mức công nợ | Quá nhiều gói làm rối vận hành |
| 35 | Hạn mức công nợ: mặc định không cho nợ; khách lớn có hạn mức theo hợp đồng, chặn tự chạy khi vượt, tự dừng khi nợ quá hạn; hai người duyệt điều chỉnh tay | P0 | Chặn rủi ro tín dụng ngay từ đầu | Mất khách lớn nếu quá cứng |
| 36 | Phí cổng: chuyển khoản qua SePay có phí cố định/gói theo hợp đồng SePay [chưa kiểm]; VNPay/MoMo tính theo % → thu của khách hoặc gộp vào giá; chọn rõ ai chịu | P1 | Đặc tả hỏi "phí cổng do bên nào chịu" | Biên lợi nhuận mỏng với khoản nạp nhỏ |
| 37 | Chính sách hoàn tiền: chỉ phần chưa dùng, qua duyệt Tài chính, có chứng từ; phí xử lý | P0 | | |
| 38 | White-label agency: tên miền riêng, logo, tài khoản con, báo cáo mang nhãn agency; hạn mức/chiết khấu theo agency | P2 | Agency là kênh phân phối quy mô | Xung đột kênh với khách trực tiếp |

## 6. Vận hành

| # | Đề xuất | Ưu | Chi tiết |
|---|---|---|---|
| 39 | SLO và đo: API quản trị p95 <400 ms; heartbeat p99 <300 ms; manifest cache p99 <100 ms; phát đến dashboard <60 giây; uptime 99,95% (đặc tả mục 13) | P0 | Dashboard SLO, tính ngân sách lỗi hằng tháng; 99,95% = khoảng 22 phút lỗi/tháng, cần đa vùng mới đạt |
| 40 | Giám sát: log cấu trúc, trace OpenTelemetry, Sentry, cảnh báo độ trễ hàng đợi, tỷ lệ 4xx/5xx webhook, lệch đối soát | P0 | Cảnh báo tiền (lệch ví, webhook thất bại) là mức cao nhất |
| 41 | On-call: 2 người luân phiên, runbook cho 10 sự cố đầu (webhook SePay ngừng, hàng đợi đầy, DO quá tải, thiết bị đồng loạt offline, bão đồng bộ) | P1 | Người vận hành ít thì rủi ro điểm đơn lẻ |
| 42 | Bão đồng bộ sau sự cố: jitter ±20%, `Retry-After`, backoff theo hàm mũ trong app TV, công tắc ngắt ở server | P0 | Mất kết nối cả khu vực sẽ làm hàng triệu thiết bị kết nối lại cùng lúc |
| 43 | Bản phát hành app TV theo giai đoạn (1%, 10%, 100%), khả năng thu hồi từ xa | P0 | App lỗi trên TV ngoài hiện trường là sự cố không sửa được từ xa |

## 7. Sản phẩm: đo lường cho nhãn hàng

| # | Đề xuất | Ưu | Lý do |
|---|---|---|---|
| 44 | Báo cáo proof-of-play tách theo loại màn, có thể xuất PDF/CSV ký thời gian, kèm ảnh đối chứng LED | P1 | Nhãn hàng OOH cần bằng chứng phát |
| 45 | Đo lường: impression hợp lệ, VCR, reach ước lượng theo khu vực (không dùng dữ liệu cá nhân), tần suất; chuyển đổi QR theo vị trí (đặc tả) | P1 | Khác biệt cạnh tranh so với đối thủ OOH truyền thống |
| 46 | Xác nhận phía thứ ba (kiểm toán) khi nhãn hàng lớn yêu cầu | P2 | |
| 47 | Báo cáo realtime cho khách (pacing, ngân sách còn lại) trong cổng khách hàng, chỉ dữ liệu của khách | P0 | Giảm tải hỗ trợ; đã có trong đặc tả |

## 8. Lộ trình thương mại hóa theo mốc doanh thu

Mốc doanh thu là gợi ý [ƯT]; điều chỉnh theo giá thực tế sau khi chạy thử với khách đầu tiên.

| Mốc | Điều kiện vào | Việc làm | Hạ tầng |
|---|---|---|---|
| M0: nghiệm thu bản local | Giai đoạn 0 xong | Luật sư rà hợp đồng; chọn ngân hàng/SePay; pen-test nội bộ | Docker, 0 USD hạ tầng |
| M1: khách trả tiền đầu tiên | 3 đến 5 khách thử, doanh thu bắt đầu | P0 ở mục 1 đến 6; xuất hóa đơn; đối soát thủ công kèm tự động | Cloudflare, khoảng $0,5k đến $2k/tháng (100k) |
| M2: doanh thu đủ trả đội vận hành | Doanh thu ổn định vài tháng, 100k đến 500k thiết bị | P1: telemetry, đối soát đầy đủ, DR, on-call | Cloudflare, tối ưu D: $0,5k đến $2,5k/tháng cho 100k đến 500k |
| M3: quy mô 1 đến 3 triệu | Hợp đồng nhãn hàng lớn, nhiều khu vực | Đo thật chi phí/triệu thiết bị; quyết định chuyển hạ tầng riêng | $5k đến $15k/tháng (D) |
| M4: 3 đến 10 triệu | Doanh thu bù chi phí đội 3 FTE | Gateway Go, Redpanda, ClickHouse, dual-write | VN riêng: khoảng $12k đến $24k/tháng gồm nhân sự |
| M5: 10 triệu trở lên | | Nhiều vùng, DR đầy đủ, tách Postgres theo tenant | $24k trở lên [ƯT] |

Cổng quyết định giữa các mốc dùng điều kiện dừng của đặc tả: chi phí vượt ngân sách, đo thật lệch quá 30% so với giả định, tài liệu SePay mâu thuẫn.

## 9. Những gì CẦN chủ dự án quyết (khớp mục 15 đặc tả)

| Nhóm (mục 15) | Quyết định cần có | Tác động | Mặc định đề xuất |
|---|---|---|---|
| Tên và môi trường | Tên đầy đủ của AMS; tên miền thật (`ams.vn` là giả định); cấu hình PC chạy Docker; tài khoản Cloudflare (Workers Paid hay Enterprise), người quản lý | Hợp đồng, email, giao diện, quyền triển khai | Workers Paid cho giai đoạn 1 |
| Hạ tầng và thiết bị | Ngân sách hạ tầng/tháng ở 1M/10M/50M; chu kỳ heartbeat chấp nhận được; dòng TV ưu tiên; vùng đặt máy chủ giai đoạn 2 và yêu cầu dữ liệu trong nước | Là tham số nhạy cảm nhất (COST-MODEL mục 6); quyết định có thể chuyển dữ liệu ra EU hay phải ở VN | Heartbeat thích ứng 120 đến 300 giây; ngân sách gợi ý theo bảng chi phí D |
| Mục tiêu quy mô | Cam kết 50 triệu hay chỉ 5 đến 10 triệu thiết bị | Thay đổi toàn bộ kế hoạch hạ tầng (xem mục dưới) | Thiết kế trần 50M, cam kết thương mại 5 đến 10M |
| Màn hình thang máy và LED | Hãng/model bộ điều khiển LED; danh sách mô-đun P5; chủ sở hữu nội dung thang máy; quy định âm thanh | Connector LED, hợp đồng với ban quản lý, giấy phép biển quảng cáo | Chưa có mặc định: không viết connector khi chưa biết model |
| Tài chính | Cổng thanh toán và ngân hàng thu hộ; chính sách xuất hóa đơn; có cho nợ không; hạn mức nạp tối thiểu/tối đa; ai chịu phí cổng | Luồng tiền, thuế, rủi ro tín dụng | Không cho nợ ban đầu; nạp tối thiểu 5.000.000 ₫; hóa đơn khi nạp (kế toán xác nhận); phí cổng gộp vào giá |
| SePay | Tài khoản ngân hàng/VA gắn SePay; cấu trúc mã thanh toán; mức tối thiểu tự kích hoạt; gói kích hoạt cho khách mới; phí và thời gian đối soát theo hợp đồng SePay | Bộ kích hoạt tự động | Tiền tố `AMS`; số tài khoản mẫu `0123456789` chỉ là mẫu |
| Tài khoản ngoài | Khách có được tự gửi duyệt ngân sách không; hạn tài khoản mặc định; quota tải; ai duyệt video theo khu vực | Rủi ro gian lận và nội dung | Không tự duyệt ngân sách (đề xuất đặc tả) |
| Đối tác và tài sản | Logo và tài liệu API Chicilon, Unique OOH, WeWin, Goldsun, Brandcom, Trimai; ảnh mẫu `ADS.png`; hợp đồng mẫu do luật sư xác nhận | Không có tài liệu thì không gửi request RTB thật | Chỉ nội dung trực tiếp và auto-fill |
| Bổ sung từ tài liệu này | Thưởng người xem trả bằng tiền hay quà; có bật nhập từ YouTube khi chưa có xác nhận pháp lý; có dùng phương án D (Pipelines, bỏ Queue) | Thuế TNCN, bản quyền, chi phí | Quà/điểm trước; tắt nhập YouTube; D sau khi xác minh Pipelines |

## 10. Rủi ro lớn nhất

Xếp theo mức nghiêm trọng:

1. **Gian lận impression và hoa hồng** (thiết bị giả, TV mod, emulator). Nó đánh vào cả doanh thu quảng cáo (nhãn hàng không tin báo cáo) lẫn chi phí thưởng. Giảm bằng chứng thực thiết bị, luật phát hợp lệ ở server, giữ tiền chờ đối soát (đề xuất 18 đến 20).
2. **Sai sót tiền**: cộng ví hai lần, chi vượt phần giữ, lệch đối soát. Cổng chất lượng đã có test đua; còn cần đối soát ba chiều hằng ngày và kiểm tổng ví (đề xuất 11 đến 13).
3. **Mục tiêu 50 triệu không khớp thị trường và chi phí**: khoảng $795k/tháng nếu giữ thiết kế đặc tả trên Cloudflare, và số thiết bị vượt số hộ gia đình Việt Nam [ƯT]. Chủ dự án cần chốt cam kết thật (5 đến 10 triệu).
4. **Pháp lý chưa rõ**: dữ liệu cá nhân và lưu trữ trong nước, thuế TNCN thưởng, giấy phép LED, bản quyền YouTube. Có thể buộc đổi kiến trúc (vùng dữ liệu) hoặc tắt tính năng; cần luật sư trước khi nhận tiền.
5. **Chuyển hạ tầng và đội vận hành mỏng**: điểm giao nhau chỉ khoảng 1 đến 4 triệu; chuyển sang Redpanda/ClickHouse đòi 3 đến 5 FTE vận hành. Chi phí con người, không phải tiền máy chủ, là rủi ro.
6. **Thiết bị ngoài hiện trường**: app TV lỗi hoặc bão kết nối lại; không thể sửa từ xa nếu thiếu phát hành theo giai đoạn (đề xuất 42, 43).
7. **Phụ thuộc đối tác chưa có tài liệu** (RTB) và phụ thuộc SePay/Cloudflare (giá thay đổi, Analytics Engine sắp tính phí, Pipelines chưa rõ GA).
