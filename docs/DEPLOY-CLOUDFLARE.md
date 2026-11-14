# Triển khai AMS lên Cloudflare (hướng dẫn từng bước)

Dành cho người **không chuyên lập trình**. Làm tuần tự; mỗi bước nói rõ bạn sẽ thấy gì nếu thành công.
Hãy làm **staging trước**, kiểm tra xong mới làm production.

> **Trạng thái kiểm chứng (đọc trước)** - cập nhật 2026-11-12:
> - ĐÃ chạy thật: `wrangler deploy --dry-run` (wrangler 4.161.0) cho cả 3 Worker, cả staging và production, với ID giả: cấu hình hợp lệ, không cảnh báo; script `deploy-cloudflare.mjs` (preflight/dry-run) chạy đúng với máy chủ Cloudflare **giả** (mock) cho các tình huống: đủ quyền, thiếu zone, thiếu quyền Routes.
> - CHƯA chạy thật: mọi lệnh ghi lên Cloudflare (tạo tài nguyên, migration D1, đặt bí mật, deploy, gắn tên miền), vì môi trường tạo ra tài liệu này không có tài khoản/token Cloudflare. Các lời gọi API (liệt kê D1/KV/Queues/R2, gắn custom domain, tạo route) viết theo tài liệu API công khai nhưng chưa thử với Cloudflare thật.
> - CHƯA validate: Terraform (`terraform validate/plan`): không tải được terraform/provider trong môi trường này. CI có job chạy `terraform validate`.
> - Lần deploy staging đầu tiên là lần kiểm chứng thật; gặp lỗi, ghi lại thông báo và báo cho kỹ sư.

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

## Checklist: chủ sở hữu phải cung cấp trước khi kỹ sư/CI deploy

Đánh dấu từng dòng. Không có mục nào trong danh sách này có thể thay bằng việc của kỹ sư.

**A. Tài khoản và tên miền**
- [ ] Tài khoản Cloudflare có quyền Super Administrator (hoặc Administrator), bật 2FA. Ghi lại **Account ID** (32 ký tự hex).
- [ ] **Zone `anio.vn` nằm trong đúng tài khoản đó, trạng thái Active** (nameserver tại nơi đăng ký `anio.vn` đã trỏ về Cloudflare). Đây là điều kiện cứng: không có zone thì không gắn được `ams.anio.vn`, `gw-ams.anio.vn`, `ams-stg.anio.vn`, `gw-ams-stg.anio.vn`. Nếu chưa: làm mục 1, **chép đủ DNS cũ trước khi đổi nameserver** (MX/email, `www`, website anio.vn hiện có).
- [ ] Bốn tên miền con trên **chưa có** bản ghi DNS nào khác (A/AAAA/CNAME). Nếu có, xóa hoặc báo kỹ sư: custom domain của Workers sẽ báo xung đột. Chỉ dùng tên **một cấp** dưới `anio.vn` (đã đúng như trên) để dùng chứng chỉ Universal SSL miễn phí.
- [ ] R2 đã được bật trong tài khoản (dash > R2 > bật; Cloudflare yêu cầu thẻ thanh toán dù còn trong hạn mức miễn phí). Queues và Durable Objects: kiểm tra gói Workers hiện tại cho phép (nếu bước tạo Queue báo cần gói trả phí thì nâng lên Workers Paid). Phí dự kiến xem `docs/COST-MODEL.md`.

**B. API token (tạo ở mục 3; chỉ hiện một lần)**
- [ ] Token có đúng các quyền ở bảng mục 3, **Account Resources = đúng tài khoản**, **Zone Resources = Specific zone `anio.vn`** (không chọn All zones).
- [ ] Đưa token cho kỹ sư qua kênh an toàn (trình quản lý mật khẩu, GitHub Secret), **không** qua chat/email. Token đặt hết hạn (ví dụ 90 ngày) và có thể thu hồi bất cứ lúc nào.
- [ ] Chạy thử kiểm tra: `node scripts/deploy-cloudflare.mjs --env staging --preflight` phải ra `không có lỗi` (xem mục 3b).

**C. Giá trị bí mật (mỗi môi trường một bộ riêng, staging khác production)**
- [ ] `SEPAY_WEBHOOK_SECRET`: chuỗi bạn đặt, **cùng giá trị** dán vào my.sepay.vn > Webhooks. Không tự sinh được.
- [ ] `SESSION_SECRET`, `FIELD_ENC_KEY`: script có thể tự sinh (`--generate-secrets`); **bạn phải sao lưu `FIELD_ENC_KEY`** ở nơi an toàn (mất = mất dữ liệu mã hóa MST/số tài khoản).
- [ ] (Cho upload ảnh/video) khóa S3 của R2: R2 > Manage API tokens > tạo token chỉ cho bucket `ams-media-*`: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.
- [ ] (Cho email mời/kích hoạt) dịch vụ gửi thư qua HTTP: `MAIL_HTTP_URL`, `MAIL_HTTP_KEY`, `MAIL_FROM`. Chưa có thì email không gửi được (vẫn deploy được).

**D. Bên thứ ba và quy trình**
- [ ] Tài khoản SePay: số tài khoản ngân hàng thật cho production (số `0123456789` chỉ là mẫu); môi trường sandbox cho staging.
- [ ] (Nếu dùng GitHub Actions) Secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `AMS_SECRET_*` đặt theo Environment; Environment `production` bật *Required reviewers*.
- [ ] Người chịu trách nhiệm duyệt cắt production (đặc tả mục 11.6) và người nhận cảnh báo khi smoke test lỗi.

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

| Phạm vi | Quyền (tên trên dashboard) | Mức | Dùng để |
|---|---|---|---|
| Account | Workers Scripts | Edit | deploy 3 Worker, đặt bí mật, Durable Object, custom domain |
| Account | D1 | Edit | tạo D1, chạy migration, export sao lưu |
| Account | Workers KV Storage | Edit | tạo KV |
| Account | Workers R2 Storage | Edit | tạo bucket R2 |
| Account | Queues | Edit | tạo Queue |
| Account | Account Settings | Read | preflight đọc thông tin tài khoản (khuyến nghị) |
| Account | Workers Tail | Read | xem log (tùy chọn) |
| Zone (chỉ `anio.vn`) | Workers Routes | Edit | route `ams.anio.vn/api/*` |
| Zone (chỉ `anio.vn`) | DNS | Edit | DNS của custom domain |
| Zone (chỉ `anio.vn`) | Zone | Read | tìm zone, preflight |
| Zone (chỉ `anio.vn`) | Zone WAF | Edit | **chỉ cho Terraform** (rate limit); bỏ nếu không dùng Terraform |

Tên quyền trên dashboard có thể khác chút theo thời điểm. **Account Resources**: Include > đúng tài khoản của bạn. **Zone Resources**: Include > Specific zone > `anio.vn`.
Sao chép token (chỉ hiện **một lần**) và dán vào `.env`:

```
CLOUDFLARE_API_TOKEN=...dán token...
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_ZONE_NAME=anio.vn
CLOUDFLARE_ZONE_ID=...     (trang Overview của anio.vn; chỉ cần cho Terraform, script deploy tự tra)
```

Không gửi token qua chat/email, không commit `.env`. Lộ token: vào lại trang API Tokens > Roll/Delete ngay.

### 3b. Preflight: kiểm token và zone trước khi làm gì

```
node scripts/deploy-cloudflare.mjs --env staging --preflight
```
Chỉ **đọc**, không tạo/sửa gì. Kiểm: Node/wrangler; token còn hiệu lực và hạn dùng; truy cập được tài khoản; **zone `anio.vn` có trong tài khoản và Active**; đọc được từng nhóm tài nguyên (Scripts, D1, KV, R2, Queues, Routes, DNS); bốn tên miền con chưa bị chiếm bởi bản ghi DNS khác. Ra `[LỖI]` thì sửa rồi chạy lại. Lưu ý: quyền **ghi** không kiểm được bằng thao tác đọc (trừ khi token loại "người dùng" cho phép đọc chính sách của chính nó), nên đối chiếu bảng trên bằng mắt; thiếu quyền ghi sẽ báo ở bước tạo tài nguyên, **trước** bước deploy.

## 4. Tạo tài nguyên (D1, KV, Queues, R2) cho staging

**Cách A (đơn giản, khuyến nghị):** script tự tạo **nếu chưa có** (chạy lại nhiều lần an toàn):

```
node scripts/deploy-cloudflare.mjs --env staging --dry-run                    # xem trước: liệt kê cái sẽ tạo (chỉ đọc)
node scripts/deploy-cloudflare.mjs --env staging --steps preflight,resources  # tạo thật D1/KV/Queues/R2
```
Script tạo D1 `ams-core-staging`, `ams-finance-staging`, `ams-audit-staging`, KV `ams-kv-staging`, Queue `ams-ingest-*`, `ams-ingest-dlq-*`, `ams-jobs-*`, `ams-jobs-dlq-*` và bucket R2 `ams-media-*`, `ams-reports-*`, `ams-audit-*`. Tài nguyên đã có thì dùng lại; ID được tra qua API và ghi vào `infra/cloudflare/ids.staging.json` (chỉ chứa ID, không commit). Mẫu tệp nếu muốn điền tay (ví dụ khi tạo bằng Terraform):
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
Terraform tạo D1/KV/Queues/R2. **Rate-limit WAF** (`/api/auth/*` đăng nhập/MFA; tùy chọn `/api/webhooks/*`): zone chỉ có **một** ruleset rate-limit nên luật phủ cả staging lẫn production và chỉ được tạo ở workspace **production** bằng `-var manage_zone_rate_limit=true` (staging để mặc định `false`). Gói Cloudflare Free chỉ cho 1 luật mỗi zone, vì vậy `enable_webhook_rate_limit` mặc định `false`; bật khi có gói Pro trở lên. Đừng trộn: nếu đã tạo tài nguyên bằng Terraform thì lần sau script chỉ tra lại ID, không tạo trùng. DNS cho `ams.anio.vn`/`gw-ams.anio.vn` do `wrangler` tự tạo khi deploy (custom domain); biến `create_placeholder_dns` mặc định tắt, đừng bật cùng lúc để tránh xung đột.

## 5. Đặt bí mật cho Worker (không ghi vào tệp, không in ra màn hình)

Script đặt bí mật bằng `wrangler secret bulk` (đọc từ stdin), **chỉ đặt cái còn thiếu** (thêm `--overwrite-secrets` để ghi đè) và **không bao giờ in giá trị**. Giá trị lấy từ (ưu tiên từ trên xuống):
1. biến môi trường `AMS_SECRET_<TÊN>` (ví dụ `AMS_SECRET_SEPAY_WEBHOOK_SECRET`; trong CI là GitHub Secret cùng tên);
2. tệp `.env` do bạn chỉ định `--secrets-file đường/dẫn/secrets.staging.env` (nên để **ngoài** thư mục dự án);
3. `--generate-secrets`: tự sinh **chỉ** `SESSION_SECRET` và `FIELD_ENC_KEY` nếu còn thiếu; bản sao lưu ghi vào `backups/secrets-<môi trường>-<giờ>.env` (quyền 600, đã trong `.gitignore`): **cất vào nơi an toàn rồi xóa khỏi máy**.

| Tên | Bắt buộc | Ghi chú |
|---|---|---|
| `SESSION_SECRET` | có | chuỗi ngẫu nhiên >= 32 ký tự |
| `FIELD_ENC_KEY` | có | đúng 32 byte mã hóa base64; **sao lưu**: mất khóa là mất dữ liệu đã mã hóa (MST, số tài khoản) |
| `SEPAY_WEBHOOK_SECRET` | có | bạn tự đặt, dán **cùng giá trị** vào my.sepay.vn > Webhooks > Bảo mật; không tự sinh |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | cho upload/presigned URL | khóa S3 của R2, tạo token chỉ cho bucket media. Tên bucket (`R2_BUCKET_NAME`) đã nằm trong `wrangler.toml` |
| `MAIL_HTTP_URL`, `MAIL_HTTP_KEY`, `MAIL_FROM` | cho email | dịch vụ gửi thư qua HTTP (runtime Cloudflare không dùng SMTP) |

Dùng **giá trị riêng cho staging**, khác production. Ví dụ (PowerShell dùng `$env:TÊN="..."`):
```
export AMS_SECRET_SEPAY_WEBHOOK_SECRET='...'            # giá trị bạn đặt, trùng với SePay
node scripts/deploy-cloudflare.mjs --env staging --steps secrets --generate-secrets
```
Nếu Worker chưa tồn tại (lần đầu), script hoãn bước này đến **ngay sau** lần deploy đầu rồi đặt bí mật; trong khoảng đó API chưa chạy được (chưa có lưu lượng nên không sao). Thiếu bí mật bắt buộc khi Worker đã chạy thì script **dừng trước khi deploy**. Muốn tự đặt tay từng cái: `npx wrangler secret put SESSION_SECRET -c infra/cloudflare/api/wrangler.generated.toml --env staging`.

## 6. Deploy staging

```
node scripts/deploy-cloudflare.mjs --env staging --dry-run   # xem trước TOÀN BỘ quy trình; chỉ gọi API đọc, KHÔNG tạo/sửa/deploy gì
node scripts/deploy-cloudflare.mjs --env staging --pause     # deploy thật, dừng hỏi Enter trước mỗi bước có ghi
```
Các bước, theo thứ tự (chọn bằng `--steps a,b`; bỏ qua bằng `--skip-migrate|--skip-build|--skip-secrets|--skip-domains`):

| # | Bước | Làm gì | Ghi lên Cloudflare? |
|---|---|---|---|
| 1 | `preflight` | token, zone `anio.vn`, quyền, DNS (mục 3b); dừng nếu có lỗi | không |
| 2 | `resources` | tạo D1/KV/Queues/R2 nếu thiếu, ghi `ids.<env>.json` | có |
| 3 | `build` | build web (`VITE_API_BASE=/api`) | không |
| 4 | `migrate` | **sao lưu D1 core** vào `backups/`, rồi migration D1 từ `packages/db/migrations` (bỏ `.postgres.sql`, dùng `.sqlite.sql`); wrangler tự hỏi xác nhận ở terminal | có |
| 5 | `secrets` | đặt bí mật còn thiếu (mục 5) | có |
| 6 | `deploy` | deploy gateway, api, web (theo thứ tự đó) | có |
| 7 | `domains` | đảm bảo custom domain `ams-stg.anio.vn`, `gw-ams-stg.anio.vn` và route `ams-stg.anio.vn/api/*` đã gắn đúng Worker (wrangler tạo khi deploy; script kiểm và gắn bù nếu thiếu); báo xung đột | có (chỉ khi thiếu) |
| 8 | `smoke` | `/`, `/api/health`, gateway `/health` | không |

Thành công: thấy `OK https://ams-stg.anio.vn/api/health -> 200`. Lần đầu, chứng chỉ và DNS có thể mất vài phút: nếu smoke báo lỗi, đợi rồi mở các URL ở mục 7. Mã thoát khác 0 nếu có bất kỳ cảnh báo nghiêm trọng (thiếu bí mật, tên miền xung đột, smoke lỗi).
Production: `--env production` (script bắt gõ chữ `production`; trong CI dùng `--yes` + Environment có người duyệt).

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

Tệp `.github/workflows/deploy-cloudflare.yml`: chạy tay (Actions > Deploy Cloudflare > Run workflow, mặc định *dry run*) hoặc khi đẩy tag: `v1.2.3-rc.1` -> staging, `v1.2.3` -> production. Thứ tự job: `pnpm install --frozen-lockfile`, typecheck, test, rồi `node scripts/deploy-cloudflare.mjs --env <môi trường> --preflight` (dừng nếu token/zone/quyền sai, mục 3b), rồi deploy thật (`--yes`, thêm `--dry-run` khi chạy tay ở chế độ dry run).

Quy ước bí mật (giống mục 5): **mọi** bí mật là GitHub Secret tên `AMS_SECRET_<TÊN>`, đặt theo Environment (staging/production dùng giá trị khác nhau):
- bắt buộc: `AMS_SECRET_SESSION_SECRET`, `AMS_SECRET_FIELD_ENC_KEY`, `AMS_SECRET_SEPAY_WEBHOOK_SECRET`;
- tùy chọn: `AMS_SECRET_R2_ACCOUNT_ID`, `AMS_SECRET_R2_ACCESS_KEY_ID`, `AMS_SECRET_R2_SECRET_ACCESS_KEY`, `AMS_SECRET_MAIL_HTTP_URL`, `AMS_SECRET_MAIL_HTTP_KEY`, `AMS_SECRET_MAIL_FROM`;
- ngoài ra chỉ cần `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.

**Không còn** secret `CF_IDS_*` hay ID tài nguyên (D1, KV, Queues) đặt tay: script tự tra/tạo qua API Cloudflare rồi ghi `wrangler.generated.toml` (không commit). CI không sinh khóa (`--generate-secrets` chỉ dùng khi chạy tay trên máy bạn); thiếu bí mật bắt buộc thì script dừng **trước** khi deploy. Nên tạo Environment `production` có *Required reviewers*. Đặc tả 14/1b yêu cầu "tự deploy từ main"; workflow này cố ý chỉ chạy tay/tag cho an toàn, bật thêm trigger `push: main` cho staging khi đã tin cậy.

Ghi chú media: Cloudflare không chạy `media-worker`/ClamAV (chỉ có trong Docker Compose, profile `core`). Trên Cloudflare, việc quét/chuyển mã media cần một đường riêng (xem `ops/agents/m1-media-worker.requests.md`); cho đến khi có, creative upload giữ `scan_state` chưa `clean` và không nên duyệt phát.

## 10. Rủi ro và việc cần xác nhận khi chạy thật lần đầu

1. **Route `ams.anio.vn/api/*` và custom domain `ams.anio.vn` cùng tên miền:** thiết kế dựa trên việc route theo đường dẫn được ưu tiên hơn custom domain. Nếu `/api/...` trả về trang web thay vì JSON, báo kỹ sư: phương án dự phòng là cho Worker web chuyển `/api/*` sang Worker API bằng service binding.
2. **Tiền tố `/api`:** Worker API nhận URL có tiền tố `/api` (khác Docker, nơi nginx cắt tiền tố). `services/api` cần xử lý (cắt `/api` ở đầu `fetch`); đã ghi trong `ops/agents/f2-infra.requests.md`.
3. Tên quyền token và tên tài nguyên Terraform theo provider cloudflare v5: chưa chạy `terraform validate/plan` (CI có job validate). Script tạo tài nguyên bằng wrangler và tra ID bằng API; nếu định dạng đầu ra của wrangler đổi thì bước `resources` báo lỗi rõ và có thể điền `ids.<env>.json` tay.
4. Giai đoạn 1 chỉ có Cloudflare Queues làm hàng đợi, ClickHouse/Redpanda chưa dùng (giai đoạn 2).
5. Gói Free của Cloudflare giới hạn số request Worker/ngày và rate-limit rule; chạy thật với số lượng thiết bị lớn cần gói trả phí (xem `docs/COST-MODEL.md`).

## 9. Chạy lên tên miền chính thức ams.anio.vn (Windows, một chạm)

1. `scripts\DEPLOY-AMS-ANIO-VN.bat` (= môi trường **production**: `https://ams.anio.vn`, `https://ams.anio.vn/api`, `https://gw-ams.anio.vn`). Dán API Token (ô ẩn); preflight chạy trước; gõ đúng chữ `production` để deploy thật. Tài nguyên production (D1/KV/Queues/R2 `*-production`) tách riêng staging.
2. `scripts\BOOTSTRAP-ADMIN-ANIO-VN.bat` tạo Super admin đầu tiên (email, mật khẩu, token đều nhập qua ô ẩn).
3. Gói Workers Free chỉ cho 5 cron/tài khoản: script mặc định dùng `--no-crons`. Sau khi nâng **Workers Paid**, đặt biến môi trường `AMS_ENABLE_CRONS=1` rồi deploy lại để bật lịch nền (outbox, đối soát, gộp presence).
4. Staging (`ams-stg.anio.vn`) giữ nguyên để thử nghiệm; muốn bỏ hẳn, xóa Worker/Domain `*-staging` trong Cloudflare sau khi production ổn.
