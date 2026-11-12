# AMS: mô hình mối đe dọa (STRIDE, rút gọn)

Phạm vi: thiết bị giả, webhook giả, IDOR, tải tệp độc, gian lận hoa hồng, tài khoản ngoài. Nguồn thiết kế: đặc tả mục 7, 8, 9, 13 và `PLAN.md` §4. Cột "Trạng thái": **Có** = đã có trong thiết kế/hợp đồng PLAN và là cổng kiểm thử; **Sẽ** = chưa làm trong phiên này (ngoài phạm vi hoặc đề xuất); không khẳng định đã chạy test nếu chưa thấy kết quả. Kết quả test thật nằm ở `ops/reviews/r1.md` và `tests/security/**`.

Ký hiệu STRIDE: S giả mạo, T chỉnh sửa, R chối bỏ, I lộ thông tin, D từ chối dịch vụ, E nâng quyền.

## 1. Thiết bị giả (đường nóng `/v1`)

| STRIDE | Mối đe dọa | Biện pháp | Trạng thái |
|---|---|---|---|
| S | Emulator/script đăng ký hàng loạt giả làm TV | Ed25519 trên body + timestamp + nonce; `register` giới hạn theo IP/ASN; thiết bị mới `trust_level = 0` (không tính hoa hồng); WAF + bot management | Có (chữ ký, trust_level); WAF cấu hình ở Cloudflare: Sẽ |
| S | Thiết bị thật bị sao chép khóa | Khóa sinh trên thiết bị; attestation nonce (`device_attestations`); thu hồi `blocked`; phát hiện hai thiết bị cùng `device_id` | Có (bảng, chặn); Sẽ (Play Integrity/Widevine) |
| T | Sửa lô sự kiện trên đường truyền | Chữ ký Ed25519 toàn lô; TLS | Có |
| T | Phát lại lô cũ | Nonce; idempotent theo `event_id` (UNIQUE/ReplacingMergeTree) | Có |
| R | Thiết bị chối đã gửi impression | Lô có chữ ký, lưu thô kèm lý do từ chối | Có |
| I | Lộ lịch phát/creative cho kẻ lạ | Manifest chỉ gồm nhóm thiết bị; creative qua URL ký có hạn; không chứa số liệu tài chính | Có (nguyên tắc); URL ký: Có (`getSigned`) |
| D | Bão heartbeat/đăng ký gây quá tải | Giới hạn tốc độ theo `device_id`, `Retry-After`, jitter ±20%, `next_interval` do server điều khiển, body <512 byte | Có |
| E | Thiết bị gọi endpoint quản trị | Tách `/v1` khỏi `/admin/v1`, thiết bị không có phiên người dùng | Có |

## 2. Webhook giả (SePay)

| STRIDE | Mối đe dọa | Biện pháp | Trạng thái |
|---|---|---|---|
| S | Kẻ ngoài gửi webhook "tiền vào" giả để được cộng ví | HMAC-SHA256 `X-SePay-Signature` so sánh hằng thời gian; hoặc `Authorization: Apikey`; từ chối nếu thiếu; khóa trong biến môi trường/secret manager; có thể thêm danh sách IP SePay (đặc tả liệt kê, phải kiểm tra lại trước khi dùng) | Có (HMAC, Apikey); whitelist IP: Sẽ |
| T | Sửa số tiền trên đường | HMAC trên toàn thân; đối chiếu số tiền với `topups` | Có |
| T | Phát lại webhook cũ để cộng nhiều lần | Timestamp lệch >5 phút bị từ chối; `provider_txn_id`/`event_id` UNIQUE; test "5 lần chỉ cộng 1" là cổng chất lượng | Có |
| R | Tranh chấp "đã nạp" | Lưu nguyên văn mọi webhook kể cả bị từ chối (`payment_webhooks`); `wallet_entries` bất biến; audit | Có |
| I | Lộ khóa HMAC/payload | Khóa không đặt ở trình duyệt; không log PII; payload chứa số tài khoản: mã hóa theo trường khi lưu | Có (nguyên tắc); mã hóa payload: cần xác nhận trong mã |
| D | Làm ngập endpoint webhook | Rate limit; xử lý nhanh (SePay chờ 30 giây); hàng đợi cho phần nặng | Một phần; Sẽ |
| E | Giả webhook để kích hoạt tài khoản khách mới | Cùng xác thực; kích hoạt chỉ khi `transferType = in`, mã khách khớp, đạt số tiền tối thiểu; có `activation_log` hoàn tác được | Có |
| E | Endpoint mô phỏng `/dev/sepay/simulate` lọt ra production | Chỉ bật khi `RUNTIME=docker` và `SEPAY_MODE != production` | Có (cần test ở môi trường Cloudflare) |

## 3. IDOR và truy cập chéo khách hàng

| STRIDE | Mối đe dọa | Biện pháp | Trạng thái |
|---|---|---|---|
| I | Khách A đọc chiến dịch, media, ví, hợp đồng, báo cáo của khách B bằng cách đổi `id` | Lọc theo `customer_id`/`campaign_grants` **trong câu SQL** (không chỉ ở giao diện); portal chỉ trả dữ liệu của chính khách; ULID không đoán được nhưng không coi là bảo mật | Có; test IDOR là cổng chất lượng |
| I | API cho tài khoản ngoài lộ số liệu tài chính nội bộ (doanh thu, giá sàn RTB, công nợ nội bộ) | Cấm mô-đun `finance` (ngoài ví của mình), `partners`; phản hồi cho tài khoản ngoài không chứa các trường này | Có |
| T | Khách A ghi/sửa/xóa dữ liệu của khách B (media, chiến dịch) | Cùng điều kiện lọc cho mọi câu ghi (`WHERE id = ? AND customer_id = ?`); kiểm `rowsAffected` | Có |
| E | Tài khoản ngoài tự duyệt ngân sách/nội dung hoặc xóa | Cấm `approve`, `delete`; RBAC kiểm ở máy chủ theo `admin_permissions` + vai trò, mỗi route khai báo `module`/`action` | Có |
| E | Sửa quyền của chính mình, mời người dùng | Chỉ super admin; `permissions/:adminId` yêu cầu quyền `admin`; ghi audit | Có |
| E | Quản trị nội bộ vượt vai (nhân viên tài chính duyệt nội dung) | Ma trận 6 vai trò × 12 mô-đun × 4 hành động ở `packages/config/rbac.ts`, một nguồn | Có |
| R | Hành động không truy vết | `audit_log` chỉ INSERT, kèm IP, bản sao object lock (≥12 tháng) | Có; bản sao object lock: Sẽ |
| S | Chiếm phiên | Cookie HttpOnly + SameSite=Lax; CSRF header; 2FA TOTP bắt buộc cho tài khoản ngoài (và `mfa_required` mặc định true); khóa/thu hồi ngay | Có |

## 4. Tải tệp độc

| STRIDE | Mối đe dọa | Biện pháp | Trạng thái |
|---|---|---|---|
| T | Tệp chứa mã độc, polyglot, container video khai thác lỗi bộ giải mã trên TV/player | Presigned URL theo quota (`upload_quotas`); quét mã độc; kiểm tra định dạng, kích thước, độ phân giải đúng loại màn; **chuyển mã lại** (không phát nguyên tệp) trong môi trường cô lập; từ chối sai kích thước | Có (quy trình); quét mã độc và transcoder thật: Sẽ (ngoài phạm vi phiên này) |
| T | Tên/loại tệp giả (đuôi png, nội dung exe) | Phát hiện loại theo nội dung, `head()` kiểm `contentType`/kích thước, từ chối khác danh sách cho phép | Một phần; Sẽ |
| S/I | Nhập từ URL (`/media/import`) làm SSRF vào mạng nội bộ/metadata cloud; hoặc trỏ tới nguồn không có quyền | Danh sách tên miền cho phép (YouTube, Google Drive, Dropbox, liên kết trực tiếp), chặn IP nội bộ/loopback/link-local, giới hạn kích thước/thời gian, chỉ tải trong worker cô lập; khách xác nhận quyền sử dụng (ghi audit) | Một phần (kiểm tên miền theo đặc tả); chặn IP nội bộ và xác nhận quyền: Sẽ |
| D | Tải lên rất lớn, nhiều tệp để cạn dung lượng/CPU transcode | Giới hạn `max_files_per_day`, `max_mb_per_file`, `max_total_gb`; giới hạn CPU transcode | Có (quota); Sẽ (CPU) |
| E | Nội dung quảng cáo vi phạm pháp luật được phát | Hàng chờ duyệt bắt buộc (`pending`), quản lý nội dung duyệt, tự chạy chỉ sau duyệt; thu hồi duyệt thì dừng | Có |
| I | Lộ tệp của khách khác qua URL ký | URL ký có hạn, khóa theo đối tượng; khóa lưu trữ không đoán được; kiểm quyền trước khi ký | Có |

## 5. Gian lận hoa hồng và thưởng người xem

| STRIDE | Mối đe dọa | Biện pháp | Trạng thái |
|---|---|---|---|
| S/T | Thiết bị giả lập hoặc TV mod tạo impression ảo, VCR 100% giả | `trust_level` (giả lập, thiếu chứng thực Ed25519 bị loại khỏi hoa hồng ở trang Kiểm soát hoa hồng); chữ ký lô; trần impression theo thiết bị/giờ; kiểm vô lý (24 giờ liên tục, nhiều thiết bị cùng IP/ASN) | Có (trust_level, chữ ký); trần và phát hiện cụm: Sẽ |
| T | Gửi trùng sự kiện để cộng điểm nhiều lần | Idempotent theo `event_id`; `wallet_ledger` bất biến | Có |
| T | Kẻ xấu sửa thời gian thiết bị để phát vượt lịch | Kiểm `ts` so với giờ máy chủ và lịch được giao; từ chối lệch lớn | Sẽ |
| R | Người xem tranh chấp số điểm/tiền | `wallet_ledger` chỉ INSERT, lô sự kiện lưu, đối soát hằng ngày | Có |
| I | Lộ số điện thoại/email người xem | `phone_hash`, `email_enc`; không log PII; NĐ 13/2023 (xem COMMERCIAL-RECOMMENDATIONS #25) | Có (thiết kế) |
| D/E | Rút tiền hàng loạt trước khi gian lận bị phát hiện, rửa tiền qua nhiều tài khoản | Rút tiền OTP, hạn mức, giữ chờ đối soát (đề xuất 20), phát hiện nhiều tài khoản cùng thiết bị/ngân hàng | Sẽ |
| E | Quản trị nội bộ sửa số dư tay | Điều chỉnh thủ công cần hai người duyệt; ghi audit; `wallet_entries` kind=`adjust` | Có (đặc tả 8.2); thực thi hai người: cần xác nhận trong mã |

## 6. Tài khoản ngoài (khách hàng, đối tác, agency)

| STRIDE | Mối đe dọa | Biện pháp | Trạng thái |
|---|---|---|---|
| S | Chiếm tài khoản khách bằng mật khẩu bị lộ | 2FA TOTP bắt buộc; email mời hết hạn 72 giờ; khóa đăng nhập sai nhiều lần; cổng khách tách tên miền khỏi `admin` | Có (2FA, mời 72 giờ); khóa đăng nhập sai: Sẽ |
| T | Khách nạp rồi yêu cầu hoàn (rửa tiền, gian lận chargeback) | Hoàn chỉ qua yêu cầu và duyệt của Tài chính, chỉ phần chưa dùng, về đúng tài khoản nạp, có chứng từ; giới hạn nạp theo ngày | Có (đặc tả 8.2) |
| E | Đối tác gửi chiến dịch giả mạo thương hiệu | Hàng chờ duyệt, danh sách ngành hạn chế, `campaign_grants` giới hạn trong chiến dịch được giao | Có |
| E | Tài khoản hết hạn vẫn dùng được | `expires_at` trong `campaign_grants` và tài khoản; thu hồi tức thì kiểm mỗi request | Có |
| I | Mời người dùng ngoài lộ phạm vi | Mời bởi super admin với phạm vi khách rõ; ghi audit; token mời dùng một lần | Có |
| D | Khách tạo hàng loạt chiến dịch/nạp tiền nhỏ để làm bẩn hệ thống | Rate limit theo tài khoản; nạp tối thiểu 5.000.000 ₫ | Có (nạp tối thiểu); rate limit portal: Sẽ |
| R | Khách chối đã duyệt/gửi | Audit kèm IP; nội dung duyệt gắn phiên bản | Có |

## 7. Rủi ro chéo và việc còn lại

1. Hệ thống đa môi trường: một lỗi cấu hình (ví dụ `RUNTIME`/`SEPAY_MODE`) mở endpoint dev ở production. Cần kiểm tra cấu hình bắt buộc khi khởi động và test ở staging Cloudflare.
2. Khóa bí mật: xoay vòng khóa HMAC SePay, `FIELD_ENC_KEY` theo phiên bản; không có khóa thật trong repo (số tài khoản mẫu `0123456789`).
3. Chuỗi cung ứng: SBOM, khóa phiên bản phụ thuộc (pnpm lockfile), quét CVE trong CI.
4. Chưa làm trong phiên này: quét mã độc/transcoder thật, attestation phần cứng, app TV, pen-test bên ngoài, danh sách IP SePay cần xác minh lại ở tài liệu của SePay trước khi dùng.
5. Kết quả kiểm thử thật xem `ops/reviews/r1.md` (reviewer bảo mật); tài liệu này mô tả thiết kế và không thay cho kết quả kiểm thử.
