# AMS: cấu hình email giao dịch (SPF, DKIM, DMARC, nhà cung cấp)

Liên quan: `docs/ops/ONCALL.md` (cảnh báo gửi qua email), `docs/COMMERCIAL-READINESS.md` P0-11, `infra/vps/.env.example`.
Mã nguồn: `packages/runtime/src/mail-http.ts` (adapter HTTP), `packages/runtime/src/smtp.ts` (SMTP, chỉ Node/Docker), `packages/runtime/src/cloudflare/mail.ts`.

> **Trạng thái kiểm chứng.** Các adapter HTTP (Resend, Postmark, Brevo, Mailgun, generic) được kiểm thử bằng `fetch` giả (`packages/runtime/test/mail-http.test.ts`): đúng tiêu đề xác thực, đúng dạng thân thư, thử lại khi 429/5xx, không lộ khóa/địa chỉ trong lỗi. **Chưa gửi thư thật tới nhà cung cấp nào** (không có khóa API trong môi trường phát triển). Việc cần làm tay: mục 6.

Thư hệ thống dùng email: mời người dùng, kích hoạt tài khoản, xác nhận nạp tiền, cảnh báo vận hành. Không có email thật thì không mời/kích hoạt được người dùng.

## 1. Chọn đường gửi

| Môi trường | Đường gửi | Ghi chú |
|---|---|---|
| Cloudflare Workers | **HTTP API** (`MAIL_HTTP_URL` + `MAIL_HTTP_KEY`) | Workers không mở được cổng SMTP; chỉ dùng HTTP |
| Docker / VPS | HTTP API **hoặc** SMTP (`MAIL_TRANSPORT=smtp`) | SMTP cổng 587 + STARTTLS (`SMTP_REQUIRE_TLS=1`) |

Nhà cung cấp hỗ trợ sẵn qua HTTP (tự nhận theo URL, hoặc đặt `MAIL_PROVIDER`):

| Nhà cung cấp | `MAIL_HTTP_URL` | `MAIL_PROVIDER` | Khóa |
|---|---|---|---|
| Resend (mặc định) | `https://api.resend.com/emails` | `resend` | API key (`re_...`) |
| Postmark | `https://api.postmarkapp.com/email` | `postmark` | Server token |
| Brevo | `https://api.brevo.com/v3/smtp/email` | `brevo` | API key v3 (tiêu đề `api-key`) |
| Mailgun | `https://api.mailgun.net/v3/<miền-gửi>/messages` (EU: `api.eu.mailgun.net`) | `mailgun` | Private API key (Basic `api:<key>`) |
| Dịch vụ khác | URL nhận JSON | `generic` | `MAIL_HTTP_AUTH_HEADER` đổi tên tiêu đề nếu cần |

Chọn nhà cung cấp có máy chủ gần Việt Nam hoặc có uy tín gửi tới Gmail/Zalo Mail; cần gói trả phí khi vượt hạn mức miễn phí. Tên miền gửi nên là `anio.vn` (hoặc miền con `mail.anio.vn` để tách danh tiếng khỏi thư nhân viên).

## 2. Biến cấu hình

```
MAIL_TRANSPORT=http                 # hoặc smtp (chỉ Docker/VPS)
MAIL_HTTP_URL=https://api.resend.com/emails
MAIL_HTTP_KEY=<khóa API, bí mật>
MAIL_PROVIDER=resend                # bỏ trống thì tự nhận theo URL
MAIL_FROM=AMS <no-reply@anio.vn>
MAIL_REPLY_TO=support@anio.vn
# SMTP (nếu MAIL_TRANSPORT=smtp)
SMTP_HOST=  SMTP_PORT=587  SMTP_USER=  SMTP_PASS=  SMTP_REQUIRE_TLS=1
```
- Docker/VPS: đặt trong `infra/vps/.env` (không commit; mẫu `infra/vps/.env.example`).
- Cloudflare: `MAIL_HTTP_KEY` là **secret** (`wrangler secret put MAIL_HTTP_KEY --env production -c infra/cloudflare/api/wrangler.generated.toml`); các biến còn lại là biến thường. **Không** sửa logic miền của `scripts/deploy-cloudflare.*`; đặt secret bằng lệnh tay.
- Địa chỉ `MAIL_FROM` phải thuộc miền đã xác minh ở nhà cung cấp, nếu không thư bị từ chối hoặc vào spam.

## 3. DNS cho `anio.vn`: SPF, DKIM, DMARC

Giá trị chính xác do nhà cung cấp cấp trong trang "Domains" sau khi thêm miền; dưới đây là hình dạng bản ghi. **Không** sao chép giá trị mẫu; dùng giá trị trong bảng điều khiển của nhà cung cấp.

| Loại | Tên | Nội dung (dạng) | Mục đích |
|---|---|---|---|
| TXT | `anio.vn` (hoặc `mail.anio.vn`) | `v=spf1 include:<spf của nhà cung cấp> ~all` | SPF: máy chủ nào được gửi thay miền. **Chỉ một** bản ghi SPF mỗi tên; gộp `include:` nếu đã có |
| TXT hoặc CNAME | `<selector>._domainkey.anio.vn` | khóa công khai DKIM hoặc CNAME do nhà cung cấp cấp | DKIM: ký thư |
| TXT | `_dmarc.anio.vn` | `v=DMARC1; p=none; rua=mailto:dmarc@anio.vn; fo=1` | DMARC: giám sát trước |
| MX (tùy chọn) | `mail.anio.vn` | theo nhà cung cấp (Mailgun/Postmark dùng cho bounce/return-path) | Return-Path/bounce |

Lộ trình DMARC: bắt đầu `p=none` 2-4 tuần, đọc báo cáo `rua`; khi SPF và DKIM đều "pass" ổn định thì `p=quarantine; pct=25`, tăng dần tới `p=reject`. Bản ghi ở Cloudflare DNS đặt **DNS only** (mây xám) cho TXT/CNAME của thư.

Kiểm tra sau khi đặt (đợi tối đa vài giờ):
```
dig +short TXT anio.vn | grep spf1
dig +short TXT <selector>._domainkey.anio.vn
dig +short TXT _dmarc.anio.vn
```
Gửi một thư thử tới hộp Gmail, "Show original": cần `SPF: PASS`, `DKIM: PASS`, `DMARC: PASS`. Công cụ ngoài: mail-tester.com (điểm >= 9/10).

## 4. Cấu hình theo nhà cung cấp (tóm tắt)

- **Resend:** Domains > Add `anio.vn` > chép 3 bản ghi DNS > Verify. API Keys > quyền "Sending access" giới hạn theo miền.
- **Postmark:** Sender Signatures/Domains > xác minh DKIM + Return-Path (CNAME `pm-bounces`). Dùng "Server token". Luồng `outbound` (mã đã đặt `MessageStream: outbound`).
- **Brevo:** Senders, Domains & Dedicated IPs > Domains > xác thực (DKIM + mã Brevo TXT) > SMTP & API > tạo API key v3. Adapter dùng `POST /v3/smtp/email` với `sender/to/subject/htmlContent/textContent/replyTo`.
- **Mailgun:** Sending > Domains > thêm `mg.anio.vn` (miền con khuyến nghị) > SPF + DKIM + MX tùy chọn. URL phải chứa đúng tên miền gửi. Adapter gửi `application/x-www-form-urlencoded` với xác thực Basic.
- **SMTP (Docker/VPS):** dùng thông tin SMTP của nhà cung cấp trên, cổng 587 STARTTLS; đặt `SMTP_REQUIRE_TLS=1` để từ chối gửi khi không có TLS.

## 5. Bounce, khiếu nại, tần suất

- Đặt webhook bounce/complaint ở nhà cung cấp về hộp thư `postmaster@anio.vn` cho tới khi có xử lý tự động (**chưa làm**: hệ thống chưa tự ngừng gửi tới địa chỉ bị bounce).
- Không gửi quảng cáo qua kênh này; chỉ thư giao dịch. Thư cảnh báo vận hành có dedupe và cooldown (ONCALL mục 2) nên không gây spam.
- Giữ tỉ lệ bounce < 2%, khiếu nại < 0,1%; vượt thì nhà cung cấp có thể khóa tài khoản.

## 6. Kiểm chứng sau khi cấu hình (làm tay, ghi kết quả vào nhật ký)

1. Web admin > Cảnh báo > điền "Email nhận cảnh báo" > **Gửi thử**. Thư phải đến trong 1 phút; trang hiện trạng thái trong lịch sử thông báo (`ops_notifications`).
2. Mời một người dùng mới (Quản trị > Người dùng): thư mời đến, liên kết mở được.
3. Header thư: SPF/DKIM/DMARC đều PASS (mục 3).
4. Tắt thử khóa API (đặt sai): trang Cảnh báo phải ghi nhận lỗi gửi, **không** lộ khóa trong log.
5. Ghi ngày, nhà cung cấp, người làm vào `docs/ops/ONCALL.md` mục nhật ký diễn tập.

## 7. Xử lý sự cố email

| Triệu chứng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| 401/403 từ nhà cung cấp | Khóa sai/hết hạn, sai miền gửi | Xoay khóa, kiểm `MAIL_FROM` thuộc miền đã xác minh |
| 422/400 | Địa chỉ From chưa xác minh, định dạng sai | Xác minh miền; dùng `Tên <email>` hợp lệ |
| 429/5xx | Vượt hạn mức hoặc nhà cung cấp lỗi | Adapter tự thử lại (tối đa 2 lần thử lại); nếu kéo dài: đổi nhà cung cấp bằng biến môi trường |
| Thư vào spam | Thiếu SPF/DKIM/DMARC, miền mới | Mục 3; làm nóng dần lưu lượng |
| Cloudflare không gửi được SMTP | Workers không có TCP/SMTP | Dùng adapter HTTP |
