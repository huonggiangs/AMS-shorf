# Triển khai AMS lên Cloudflare (hướng dẫn từng bước)

Dành cho người **không chuyên lập trình**. Làm tuần tự; mỗi bước nói rõ bạn sẽ thấy gì nếu thành công.
Hãy làm **staging trước**, kiểm tra xong mới làm production.

> **Trạng thái kiểm chứng (đọc trước):** các tệp cấu hình và script trong tài liệu này được viết và kiểm cú pháp,
> **chưa từng được chạy thật trên Cloudflare** (môi trường tạo ra chúng không có tài khoản Cloudflare). Lần deploy staging
> đầu tiên là lần kiểm chứng thật; nếu gặp lỗi, ghi lại thông báo và báo cho kỹ sư.

## 0. Bạn sẽ có gì sau khi xong

| Môi trường | Web admin + cổng khách hàng | API | Thiết bị (gateway) |
|---|---|---|---|
| Production | `https://ams.anio.vn` | `https://ams.anio.vn/api/...` | `https://gw-ams.anio.vn` |
| Staging | `https://ams-stg.anio.vn` | `https://ams-stg.anio.vn/api/...` | `https://gw-ams-stg.anio.vn` |

- Web admin và cổng khách hàng là **cùng một ứng dụng**; đường dẫn `/api/*` trên cùng tên miền chuyển tới Worker API (tiền tố `/api` được cắt trước khi vào Hono; xem mục 10).
- Gateway dùng tên miền **một cấp** (`gw-ams.anio.vn`) để dùng chứng chỉ Universal SSL miễn phí. Không dùng `gw.ams.anio.vn` hay `api.ams.anio.vn` vì chứng chỉ miễn phí không phủ hai cấp.
- **URL webhook dán vào my.sepay.vn (Webhooks):**
  - Production: `https://ams.anio.vn/api/webhooks/payments/sepay`
  - Staging: `https://ams-stg.anio.vn/api/webhooks/payments/sepay`
- Docker local giữ nguyên `*.ams.localhost`, không bị ảnh hưởng.

## 1. Điều kiện bắt buộc: zone `anio.vn` phải nằm trong Cloudflare

Worker chỉ gắn được vào tên miền mà **zone nằm trong tài khoản Cloudflare của bạn** (nameserver của `anio.vn` trỏ về Cloudflare).
Kiểm tra: dash.cloudflare.com > Websites > thấy `anio.vn` với trạng thái **Active**.

Nếu **chưa** (DNS đang ở nhà cung cấp khác như iNET, Mắt Bão, PA Vietnam...), có 2 cách:

**Cách 1 (khuyến nghị, miễn phí): chuyển nameserver về Cloudflare.**
1. Cloudflare > Add a site > nhập `anio.vn` > chọn gói Free.
2. Cloudflare quét và nhập sẵn các bản ghi DNS cũ. **Đối chiếu từng dòng** với DNS hiện tại (đặc biệt MX/email, `anio.vn`, `www`, `sieuthiso`...); thiếu dòng nào thì thêm, nếu không website/email hiện có sẽ ngừng.
3. Vào trang quản lý tên miền (nơi đăng ký `anio.vn`), đổi nameserver thành 2 địa chỉ Cloudflare đưa ra. Chờ từ vài phút đến 24 giờ đến khi trạng thái **Active**.

**Cách 2: giữ DNS ở nơi cũ, chỉ trỏ riêng subdomain bằng CNAME.**
Cloudflare gọi là *partial (CNAME) setup*; **chỉ có ở gói Business/Enterprise** (có phí). Khi đó thêm bản ghi CNAME `ams`, `ams-stg`, `gw-ams`, `gw-ams-stg` theo hướng dẫn trên dashboard Cloudflare (không trỏ tùy tiện sang `*.workers.dev`: Worker không nhận đúng tên miền theo cách đó). Nếu không muốn trả phí, dùng Cách 1.

> Lưu ý: nếu `anio.vn` đang chạy website khác (anio.vn, sieuthiso.net ...), Cách 1 chuyển **toàn bộ** DNS của `anio.vn` sang Cloudflare: hãy chắc chắn đã chép đủ bản ghi trước khi đổi nameserver.

## 2. Chuẩn bị máy

- Cài Node.js 22 (nodejs.org) và pnpm (`npm i -g pnpm`), chạy `pnpm install` ở thư mục dự án.
- Có tài khoản Cloudflare (lấy **Account ID** ở dash.cloudflare.com > Workers & Pages > cột phải).
- Chạy `node scripts/setup.mjs env` để có tệp `.env` (hoặc `make setup`).

## 3. Tạo API token (quyền tối thiểu)

dash.cloudflare.com > My Profile > API Tokens > Create Token > **Create Custom Token**. Tên: `ams-deploy`. Quyền:

| Phạm vi | Quyền | Mức |
|---|---|---|
| Account | Workers Scripts | Edit |
| Account | D1 | Edit |
| Account | Workers KV Storage | Edit |
| Account | Workers R2 Storage | Edit |
| Account | Queues | Edit |
| Account | Workers Tail (tùy chọn, xem log) | Read |
| Zone (chỉ zone `anio.vn`) | Workers Routes | Edit |
| Zone (chỉ zone `anio.vn`) | DNS | Edit |
| Zone (chỉ zone `anio.vn`) | Zone WAF | Edit |
| Zone (chỉ zone `anio.vn`) | Zone | Read |

Tên quyền trên dashboard có thể khác chút theo thời điểm; chọn quyền tương ứng. Phần **Account Resources**: chọn đúng tài khoản của bạn; **Zone Resources**: Include > Specific zone > `anio.vn`.
Sao chép token (chỉ hiện **một lần**) và dán vào `.env`:

```
CLOUDFLARE_API_TOKEN=...dán token...
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_ZONE_ID=...     (trang Overview của anio.vn, cột phải; chỉ cần cho Terraform)
```

Không gửi token qua chat/email, không commit `.env`. Lộ token: vào lại trang API Tokens > Roll/Delete ngay.

## 4. Tạo tài nguyên (D1, KV, Queues, R2) cho staging

**Cách A (đơn giản, khuyến nghị):** script tạo bằng wrangler:

```
node scripts/deploy-cloudflare.mjs --env staging --bootstrap --dry-run   # xem trước (không tạo)
node scripts/deploy-cloudflare.mjs --env staging --bootstrap
```
Script tạo D1 `ams-core-staging`, `ams-finance-staging`, `ams-audit-staging`, KV `ams-kv-staging`, các Queue và bucket R2, rồi ghi ID vào `infra/cloudflare/ids.staging.json` (tệp này không được commit). Nếu tài nguyên đã tồn tại từ trước, script báo không đọc được ID: lấy ID bằng `npx wrangler d1 list` / `npx wrangler kv namespace list` và điền vào `ids.staging.json` theo mẫu:
```json
{ "d1_core_id": "...", "d1_finance_id": "...", "d1_audit_id": "...", "kv_id": "..." }
```

**Cách B (cho kỹ sư, có quản lý bằng mã): Terraform** (cài terraform >= 1.6):
```
cd infra/cloudflare/terraform
cp terraform.tfvars.example terraform.tfvars    # điền account_id, zone_id; zone_name mặc định anio.vn
export CLOUDFLARE_API_TOKEN=...                 # Windows PowerShell: $env:CLOUDFLARE_API_TOKEN="..."
terraform init
terraform workspace new staging                 # production: workspace riêng, environment = "production"
terraform apply
terraform output -json > ../ids.staging.json
```
Terraform tạo D1/KV/Queues/R2 và **rate-limit WAF** cho `/api/auth/*` (đăng nhập, MFA) và `/api/webhooks/*` (mặc định 10 / 60 yêu cầu mỗi IP mỗi 10 giây; chỉnh bằng biến). **Gói Cloudflare Free chỉ cho 1 luật rate-limit mỗi zone**: nếu `apply` báo vượt hạn mức, thêm `-var enable_webhook_rate_limit=false` (chỉ giữ luật đăng nhập). DNS cho `ams.anio.vn`/`gw-ams.anio.vn` do `wrangler` tự tạo khi deploy (custom domain); biến `create_placeholder_dns` mặc định tắt, đừng bật cùng lúc để tránh xung đột.

## 5. Đặt bí mật cho Worker (không ghi vào tệp)

Mỗi lệnh sẽ hỏi bạn dán giá trị. Dùng **giá trị riêng cho staging**, khác production. Thay `staging` bằng `production` khi làm production.

```
npx wrangler secret put SESSION_SECRET        -c infra/cloudflare/api/wrangler.toml --env staging
npx wrangler secret put FIELD_ENC_KEY         -c infra/cloudflare/api/wrangler.toml --env staging
npx wrangler secret put SEPAY_WEBHOOK_SECRET  -c infra/cloudflare/api/wrangler.toml --env staging
```
- `SESSION_SECRET`: chuỗi ngẫu nhiên >= 32 ký tự. `FIELD_ENC_KEY`: đúng 32 byte mã hóa base64. Sinh nhanh: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. **Sao lưu `FIELD_ENC_KEY` ở nơi an toàn: mất khóa là mất dữ liệu đã mã hóa (MST, số tài khoản).**
- `SEPAY_WEBHOOK_SECRET`: chuỗi bạn tự đặt, dán **cùng giá trị** vào my.sepay.vn > Webhooks > Bảo mật.
- Presigned URL của R2 cần khóa S3 của R2 (R2 > Manage API tokens > tạo token chỉ cho bucket media): đặt thêm `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID` (tên biến chính thức do `createCloudflareRuntime` quy định; xem `packages/runtime`).
- Gửi email: Cloudflare Worker không có Mailpit; cấu hình dịch vụ gửi thư (SMTP/API) theo biến mà runtime Cloudflare yêu cầu. Chưa cấu hình thì email mời/kích hoạt sẽ không gửi được.
- Lần đầu Worker chưa tồn tại: `wrangler secret put` sẽ hỏi tạo Worker nháp, trả lời **Yes**.

## 6. Deploy staging

```
node scripts/deploy-cloudflare.mjs --env staging --dry-run   # build + kiểm cấu hình, KHÔNG gửi gì lên Cloudflare
node scripts/deploy-cloudflare.mjs --env staging
```
Script làm theo thứ tự: kiểm biến -> dựng cấu hình từ ID -> build web -> **sao lưu D1 core** (thư mục `backups/`) -> migration D1 (từ `packages/db/migrations`, tự bỏ tệp `.postgres.sql`, dùng tệp `.sqlite.sql`) -> kiểm bí mật -> deploy gateway, api, web -> smoke test `/health`.
Thành công: thấy `OK https://ams-stg.anio.vn/api/health -> 200`. Lần đầu, chứng chỉ và DNS có thể mất vài phút: chạy lại smoke bằng cách mở các URL ở mục 7.

## 7. Danh sách kiểm tra sau deploy

Staging, theo thứ tự. Đánh dấu từng dòng.

- [ ] `https://ams-stg.anio.vn/` hiện trang đăng nhập (không cảnh báo chứng chỉ).
- [ ] `https://ams-stg.anio.vn/api/health` trả 200 (JSON ok). `https://gw-ams-stg.anio.vn/health` trả 200.
- [ ] Đăng nhập Super admin; bật 2FA; xem danh sách thiết bị/khách hàng (đúng dữ liệu, không còn dữ liệu minh họa).
- [ ] Tải thử một ảnh lên mục Media (kiểm R2 + presigned URL), ảnh xem lại được.
- [ ] Bộ giả lập thiết bị gửi heartbeat tới `https://gw-ams-stg.anio.vn` (`pnpm --filter @ams/sim ...`): thiết bị hiện online trên web.
- [ ] Đăng nhập sai quá nhiều lần: bị chặn (HTTP 429, rate limit hoạt động).
- [ ] **SePay sandbox:** my.sepay.vn (môi trường thử) > Webhooks: URL `https://ams-stg.anio.vn/api/webhooks/payments/sepay`, sự kiện "Có tiền vào", kiểu bảo mật HMAC-SHA256 với đúng `SEPAY_WEBHOOK_SECRET`. Bấm **Gửi thử**: nhận `{"success":true}`. Chuyển một giao dịch thử có nội dung `AMS <mã khách hàng>`: ví cộng đúng **một lần**; Gửi lại cùng giao dịch: ví **không** cộng lần hai.
- [ ] Trang Cài đặt > SePay: số tài khoản thật (số `0123456789` chỉ là mẫu), `SEPAY_MODE=sandbox` cho staging. `/dev/sepay/simulate` phải **không** tồn tại (trả 404) trên Cloudflare.
- [ ] Kiểm tra Audit log có các hành động vừa làm.
- [ ] Cloudflare > Workers > từng Worker > Logs: không có lỗi lặp lại.

Production: lặp lại với `--env production` (script hỏi gõ chữ `production` để xác nhận; trong CI dùng Environment có người duyệt), `SEPAY_MODE=production`, và chỉ **sau khi** staging đạt toàn bộ danh sách trên. Cắt DNS/webhook thật theo đặc tả mục 11.6.

## 8. Quay lui khi có sự cố

1. **Mã Worker lỗi:** `node scripts/deploy-cloudflare.mjs --env production --rollback` đưa gateway, api, web về phiên bản triển khai liền trước (tương đương `wrangler rollback`). Chỉ quay lui **mã**, không đụng dữ liệu.
2. **Migration D1 gây lỗi dữ liệu:** D1 có **Time Travel** (khôi phục về thời điểm bất kỳ trong 30 ngày):
   `npx wrangler d1 time-travel restore ams-core-production --timestamp=2026-01-31T10:00:00Z --env production -c infra/cloudflare/api/wrangler.generated.toml`
   (thời điểm = ngay trước khi deploy). Ngoài ra script đã lưu bản sao `backups/<môi trường>-<giờ>/core.sql` trước migration.
   Migration phải **tương thích ngược** (thêm cột/bảng, không xóa) để quay lui mã không hỏng dữ liệu.
3. **Webhook SePay lỗi:** SePay tự gửi lại tối đa 7 lần; sau khi sửa, gửi lại thủ công trong nhật ký SePay, hoặc chạy job đối soát bù (cron `*/10`).
4. **Tạm dừng khẩn cấp web:** Cloudflare > Workers > `ams-web-admin-production` > Settings > Domains & Routes > gỡ tên miền (thiết bị vẫn chạy qua gateway).

## 9. Triển khai tự động (GitHub Actions)

Tệp `.github/workflows/deploy-cloudflare.yml`: chạy tay (Actions > Deploy Cloudflare > Run workflow, mặc định *dry run*) hoặc khi đẩy tag: `v1.2.3-rc.1` -> staging, `v1.2.3` -> production.
Đặt trong GitHub Settings > Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CF_IDS_STAGING`, `CF_IDS_PRODUCTION` (nội dung JSON ID tài nguyên). Nên tạo Environment `production` có *Required reviewers*. Đặc tả 14/1b yêu cầu "tự deploy từ main"; workflow này cố ý chỉ chạy tay/tag cho an toàn, bật thêm trigger `push: main` cho staging khi đã tin cậy.

## 10. Rủi ro và việc cần xác nhận khi chạy thật lần đầu

1. **Route `ams.anio.vn/api/*` và custom domain `ams.anio.vn` cùng tên miền:** thiết kế dựa trên việc route theo đường dẫn được ưu tiên hơn custom domain. Nếu `/api/...` trả về trang web thay vì JSON, báo kỹ sư: phương án dự phòng là cho Worker web chuyển `/api/*` sang Worker API bằng service binding.
2. **Tiền tố `/api`:** Worker API nhận URL có tiền tố `/api` (khác Docker, nơi nginx cắt tiền tố). `services/api` cần xử lý (cắt `/api` ở đầu `fetch`); đã ghi trong `ops/agents/f2-infra.requests.md`.
3. Tên quyền token và tên tài nguyên Terraform theo provider cloudflare v5: chưa chạy `terraform validate/plan`; script `--bootstrap` đọc ID từ đầu ra của wrangler nên có thể cần chỉnh nếu định dạng đổi.
4. Giai đoạn 1 chỉ có Cloudflare Queues làm hàng đợi, ClickHouse/Redpanda chưa dùng (giai đoạn 2).
5. Gói Free của Cloudflare giới hạn số request Worker/ngày và rate-limit rule; chạy thật với số lượng thiết bị lớn cần gói trả phí (xem `docs/COST-MODEL.md`).
