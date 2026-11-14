# AMS: trực sự cố (on-call)

Liên quan: `docs/ops/RUNBOOK.md` (chi tiết kỹ thuật từng sự cố), `docs/ops/DISASTER-RECOVERY.md` (mất dữ liệu), `docs/ops/EMAIL-SETUP.md` (kênh email cảnh báo), trang **Cảnh báo** trong web admin (`/alerts`, chỉ Super admin), trang trạng thái công khai `https://ams.anio.vn/status` (JSON: `https://ams.anio.vn/api/status`).

> **Trạng thái:** hệ thống cảnh báo và trang trạng thái đã có mã và kiểm thử tự động (xem `ops/agents/p3-ops.md`). Lịch trực, danh bạ và mọi ô `<ĐIỀN>` dưới đây là **mẫu để điền**, chưa có người cụ thể. 10 runbook ngắn ở mục 5 mới được viết từ mã và RUNBOOK; **chưa được diễn tập bởi người trực** (bắt buộc trước go-live, mục 7).

## 1. Cảnh báo đến bằng đường nào

Job kiểm tra chạy mỗi 5 phút (Docker) hoặc 10 phút (Cloudflare cron `*/10`). Khi một điều kiện vi phạm, hệ thống mở **sự cố** (bảng `ops_incidents`) và gửi:
1. **Email** tới danh sách `OPS_ALERT_EMAILS` (hoặc đặt trong web admin > Cảnh báo > Kênh nhận cảnh báo), qua dịch vụ gửi thư của hệ thống.
2. **Webhook** (tùy chọn) tới Telegram/Slack/Discord hoặc cầu nối Zalo (`OPS_ALERT_WEBHOOK_URL`; Telegram kèm `OPS_ALERT_WEBHOOK_CHAT_ID`). Khuyến nghị dùng cả hai: email có thể chậm, webhook đẩy thông báo lên điện thoại ngay.

Chống làm phiền: mỗi quy tắc chỉ có **một** sự cố mở; nhắc lại khi hết thời gian chờ (S1 30 phút, S2 4 giờ, S3 24 giờ) hoặc khi mức nặng hơn; người trực bấm **Nhận xử lý** (ack) thì ngừng nhắc; khi điều kiện hết, hệ thống tự đóng và gửi thư "đã khắc phục".

| Quy tắc (`rule_key`) | Điều kiện | Mức |
|---|---|---|
| `webhook:5xx` | Webhook SePay trả 5xx (trong 30 phút) | S1 |
| `webhook:rejected` | ≥ 3 webhook bị từ chối (sai chữ ký/tắt) trong 1 giờ | S2 |
| `webhook:stuck` | Webhook hợp lệ chưa xử lý quá 10 phút | S2 |
| `ledger:drift` | Số dư/giữ/chi của ví lệch tổng `wallet_entries`, hoặc nạp "đã ghi" thiếu dòng sổ cái | S1 |
| `ledger:revenue_discrepancy` | Có chênh lệch doanh thu/impression đang mở | S2 |
| `queue:outbox_dead`, `queue:outbox_backlog` | Outbox có việc `dead` / tồn quá 10 phút | S2 |
| `queue:ingest_dead` | Hàng đợi sự kiện thiết bị có tin chết (Redis; chỉ Docker) | S2 |
| `gateway:5xx` / `api:5xx` | ≥ 5 (gateway) / ≥ 10 (API) phản hồi 5xx trong ~15 phút; gateway ≥ 10× ngưỡng = S1 | S2/S1 |
| `backup:stale:<loại>` / `backup:failed:<loại>` | Chưa có bản sao lưu thành công trong 26 giờ / lần gần nhất thất bại | S2 |
| `devices:offline_ratio` | ≥ 30% TV đang hoạt động mất heartbeat > 15 phút (≥ 60% = S1; chỉ khi có ≥ 20 TV) | S2/S1 |
| `jobs:<tên>` | Job nền lỗi trong 30 phút qua | S3 |

Ngưỡng đổi bằng biến môi trường `OPS_*` (xem `services/api/src/ops/checks.ts`, hàm `thresholds`). **Giới hạn đã biết:** cảnh báo chạy *bên trong* hệ thống: nếu cả API và máy chủ chết thì không có cảnh báo nào được gửi. Vì vậy **bắt buộc có giám sát ngoài** (mục 6).

## 2. Mức độ nghiêm trọng

| Mức | Định nghĩa | Phản hồi (xác nhận) | Mục tiêu khắc phục | Ai |
|---|---|---|---|---|
| **S1** | Mất tiền/nguy cơ mất tiền hoặc dữ liệu (ví lệch, webhook 5xx, nghi lộ khóa); hệ thống chính ngừng (API, nhiều TV mất kết nối) | **15 phút**, 24/7 | Giảm thiểu 1 giờ (dừng nhận tiền nếu cần); khắc phục 4 giờ | Trực chính + báo CTO ngay |
| **S2** | Một chức năng hỏng hoặc suy giảm, chưa mất tiền (hàng đợi tồn, sao lưu lỗi, email không gửi) | **1 giờ**, giờ làm việc mở rộng 7:00-22:00 | Trong ngày | Trực chính |
| **S3** | Ảnh hưởng nhỏ, có cách vòng | Ngày làm việc kế tiếp | Trong tuần | Bất kỳ ai trong 2 người |

Nghi ngờ mức nào thì chọn mức cao hơn. Mọi sự cố S1 phải có báo cáo sau sự cố (mục 8) trong 3 ngày làm việc.

## 3. Lịch trực 2 người (mẫu)

Luân phiên **theo tuần**, đổi ca vào thứ Hai 9:00 (giờ Việt Nam). Người trực chính nhận cảnh báo đầu tiên; người trực phụ thế chỗ nếu sau **15 phút** (S1) chính không xác nhận.

| Tuần bắt đầu | Trực chính | Trực phụ |
|---|---|---|
| <ĐIỀN: dd/mm/yyyy> | <ĐIỀN: người A> | <ĐIỀN: người B> |
| <ĐIỀN: +7 ngày> | <ĐIỀN: người B> | <ĐIỀN: người A> |

Quy tắc: không đi xa/không sóng khi đang trực chính (báo trước 24 giờ để đổi ca); điện thoại bật thông báo Telegram/Zalo và email; có sẵn laptop, quyền truy cập (mục 4); bàn giao cuối ca bằng 5 dòng: sự cố mở, việc đang theo dõi, thay đổi vừa deploy, việc cần lưu ý, nhật ký (mẫu ở RUNBOOK mục 9).

Danh sách việc kiểm tra đầu ca (5 phút): trang **Cảnh báo** không còn S1/S2 mở; sao lưu gần nhất < 26 giờ; `https://ams.anio.vn/status` bình thường; kênh nhận cảnh báo còn sống (nút **Gửi thử**).

## 4. Danh bạ và quyền truy cập (điền khi bàn giao; KHÔNG ghi mật khẩu/khóa ở đây)

| Vai trò | Họ tên | Điện thoại | Email | Ghi chú |
|---|---|---|---|---|
| Trực chính (tuần này) | <ĐIỀN> | <ĐIỀN> | <ĐIỀN> | |
| Trực phụ | <ĐIỀN> | <ĐIỀN> | <ĐIỀN> | |
| CTO (quyết định dừng nhận tiền, khôi phục dữ liệu) | <ĐIỀN> | <ĐIỀN> | <ĐIỀN> | Leo thang S1 sau 30 phút chưa giảm thiểu |
| Chủ dự án / người ký hợp đồng | <ĐIỀN> | <ĐIỀN> | <ĐIỀN> | Thông báo khách khi S1 > 1 giờ |
| Kế toán/tài chính (đối chiếu tiền) | <ĐIỀN> | <ĐIỀN> | <ĐIỀN> | Sự cố ví/SePay |
| SePay (hỗ trợ) | <ĐIỀN> | <ĐIỀN> | <ĐIỀN: kênh my.sepay.vn> | Webhook, đối soát |
| Cloudflare (gói hỗ trợ) | <ĐIỀN> | | <ĐIỀN> | Zone `anio.vn`, Workers |
| Nhà cung cấp VPS | <ĐIỀN> | | <ĐIỀN: ticket> | Nếu chạy trên VPS |
| Nhà đăng ký tên miền `anio.vn` | <ĐIỀN> | | <ĐIỀN> | |
| Dịch vụ gửi thư (Resend/...) | | | <ĐIỀN> | |
| Luật sư/DPO (rò rỉ dữ liệu cá nhân) | <ĐIỀN> | <ĐIỀN> | <ĐIỀN> | NĐ 13/2023: báo cơ quan chức năng trong 72 giờ khi lộ dữ liệu cá nhân (xác nhận với luật sư) |

Quyền cần có sẵn (kiểm tra mỗi quý): tài khoản Super admin AMS + 2FA; Cloudflare (Workers, D1, DNS); SSH VPS (nếu có); trình quản lý bí mật chứa `FIELD_ENC_KEY`, `BACKUP_ENC_KEY`; my.sepay.vn; dịch vụ thư; kho sao lưu ngoài. **Ít nhất hai người giữ `FIELD_ENC_KEY` và `BACKUP_ENC_KEY`.**

## 5. Mười runbook đầu (dạng ngắn)

Khung chung mỗi sự cố: **(1)** xác nhận (ack) trong web admin hoặc báo vào kênh trực; **(2)** ghi giờ UTC bắt đầu và mở nhật ký (RUNBOOK mục 9); **(3)** làm các bước dưới; **(4)** xác nhận sự cố tự đóng trên trang Cảnh báo; **(5)** S1: báo cáo sau sự cố.

### R1. API không phản hồi hoặc lỗi 5xx tăng (`api:5xx`, giám sát ngoài báo `/api/health` hỏng)
1. `curl -s https://ams.anio.vn/api/health`. Cloudflare: Dashboard > Workers > `ams-api-production` > Logs / `npx wrangler tail ams-api-production`; VPS/Docker: `$DC ps`, `$DC logs --tail=200 api`.
2. Vừa deploy? Quay lui mã: `node scripts/deploy-cloudflare.mjs --env production --rollback` (Cloudflare) hoặc `docker compose ... up -d` với image `AMS_TAG` cũ (VPS). Migration không có "down": xem DEPLOY-CLOUDFLARE mục 8.2.
3. Không phải deploy: DB đầy/chậm (R6), Redis chết (`$DC restart redis`), cạn bộ nhớ (`docker stats`).
4. Leo thang: CTO nếu quá 30 phút. Đóng khi `/health` 200 liên tục 10 phút và không còn `api:5xx`.

### R2. Nhiều TV mất kết nối (`devices:offline_ratio`, `gateway:5xx`)
1. `curl -s https://gw-ams.anio.vn/health`; xem log gateway (Cloudflare: `ams-edge-gateway-production`; VPS: `$DC logs edge-gateway`).
2. Gateway lỗi: như R1. Gateway khỏe nhưng TV vẫn mất: kiểm tra DNS/chứng chỉ của `gw-ams.anio.vn` (R10), mạng ISP, lỗi app TV vừa phát hành (thu hồi bản app theo phát hành theo giai đoạn).
3. Bão kết nối (khởi động lại đồng loạt): công tắc `ctl:gateway` (RUNBOOK 4.4).
4. TV vẫn phát lịch đã tải khi mất kết nối nhưng **không tính tiền** lượt xem tới khi gửi lại hàng đợi ngoại tuyến: không phải lỗi mất dữ liệu nếu xử lý trong vài giờ. Đóng khi tỉ lệ offline < 30% trong 15 phút.

### R3. Webhook SePay lỗi hoặc nạp tiền không lên ví (`webhook:5xx`, `webhook:rejected`, `webhook:stuck`)
1. RUNBOOK 4.3: bảng `result` của `payment_webhooks` cho biết lý do (sai chữ ký, tắt, không khớp mã).
2. 5xx: xem log API; sửa nguyên nhân (thường DB/Redis, R1/R6). SePay tự gửi lại; cron đối soát bù (cần `SEPAY_API_TOKEN`).
3. Sai chữ ký sau khi xoay khóa: đồng bộ secret hai phía (RUNBOOK 4.5).
4. Cần dừng nhận tiền tự động: web admin > Cài đặt > SePay > tắt (webhook vẫn được lưu nguyên văn).
5. Không cộng tay bằng SQL: dùng hàng đợi thủ công/điều chỉnh có hai người duyệt. Báo kế toán đối chiếu sao kê. Đóng khi không còn `webhook:*` và `manual-queue` rỗng.

### R4. Ví lệch sổ cái (`ledger:drift`): **luôn S1, nghi lỗi tiền**
1. **Dừng nhận tiền tự động** (như R3.4) và báo CTO + kế toán ngay.
2. Xem chi tiết: thông báo `reconcile_mismatch` và `audit_log` `finance.reconcile.mismatch` (có `customer_id`, trường lệch, giá trị bộ nhớ đệm và sổ cái). Sổ cái `wallet_entries` là sự thật; `ad_wallets` là bộ nhớ đệm.
3. **Không sửa `wallet_entries`/`audit_log`** (trigger chặn). Chạy sửa lệch có kiểm soát bằng `POST /admin/v1/reconcile/repair` (có `dryRun`: xem trước các hành động rồi mới áp dụng; cần quyền `finance:approve` và mã TOTP khi áp dụng thật; CTO phê duyệt), hoặc điều chỉnh có hai người duyệt.
4. Tìm nguyên nhân gốc (đứt giữa chừng trên D1? lỗi mã?) trước khi bật lại nhận tiền. Đóng khi `ledger:drift` tự đóng và đối soát sạch.

### R5. Hàng đợi/outbox tồn hoặc có tin chết (`queue:outbox_dead`, `queue:outbox_backlog`, `queue:ingest_dead`)
1. RUNBOOK 4.1: `LLEN` hàng đợi và hàng chết, SQL trên `outbox`.
2. Consumer chết: `$DC up -d ingest-consumer`. Hàng chết: lưu bản sao rồi phát lại. Outbox `dead`: đọc `last_error`, sửa rồi đặt lại `pending`.
3. Lượt xem chưa tính tiền nằm trong hàng đợi, không mất (Redis AOF). Đóng khi backlog gần 0 và `dead` = 0.

### R6. Cơ sở dữ liệu đầy hoặc chậm (API 5xx, ghi lỗi)
1. RUNBOOK 4.2: dung lượng DB/đĩa, bảng lớn nhất.
2. **Sao lưu trước khi xóa gì** (`scripts/ops.sh backup-pg`). Dọn `ev_heartbeat` cũ; **không bao giờ** động tới `audit_log`, `wallet_entries`, `wallet_ledger`.
3. Đĩa VPS đầy: mở rộng đĩa; `docker system prune` (KHÔNG `volume prune`). D1 gần 10 GB: dọn heartbeat; lập kế hoạch chuyển kho sự kiện.
4. Đóng khi trống ≥ 20% và API ổn định 30 phút.

### R7. Sao lưu lỗi hoặc quá cũ (`backup:stale:*`, `backup:failed:*`)
1. VPS: `docker compose ... logs backup`, `ls -la` volume `backups`; chạy tay: `docker compose ... exec backup ams-backup postgres`. Cloudflare: chạy `scripts\OPS-BACKUP-D1.bat production` (hoặc `scripts/ops.sh backup-d1 production`).
2. Nguyên nhân thường gặp: hết đĩa, sai `BACKUP_ENC_KEY`/mật khẩu DB, kho ngoài (rclone) hỏng/hết hạn khóa, thiếu `OPS_REPORT_TOKEN` (bản sao lưu có nhưng API không biết).
3. Sau khi sửa, chạy sao lưu tay một lần và kiểm tra bản mới bằng `scripts/ops.sh drill-pg --source-url ...` (khôi phục vào DB tạm). Đóng khi `backup:*` tự đóng. **Không có sao lưu hợp lệ trong 24 giờ là rủi ro mất dữ liệu: ưu tiên ngay cả khi mức S2.**

### R8. Email không gửi được (thư mời, kích hoạt, cảnh báo)
1. Web admin > Cảnh báo > **Gửi thử**: xem kênh `email` báo lỗi gì (`ops_notifications.error`, ví dụ `HTTP 401` = sai khóa, `HTTP 422` = địa chỉ gửi chưa xác minh).
2. EMAIL-SETUP.md: kiểm tra `MAIL_HTTP_KEY`, `MAIL_FROM` thuộc tên miền đã xác minh, SPF/DKIM còn đúng, hạn mức gói.
3. Giữa lúc sự cố: kênh webhook vẫn báo được; mời người dùng bằng cách gửi lại liên kết sau khi sửa. Đóng khi **Gửi thử** thành công.

### R9. Nghi lộ khóa hoặc tài khoản bị chiếm: **luôn S1**
1. Ngừng thiệt hại: dừng nhận tiền tự động; khóa tài khoản nghi bị chiếm (web admin > Người dùng); đăng xuất mọi phiên bằng cách đổi `SESSION_SECRET`.
2. Xoay khóa theo RUNBOOK 4.5 (thứ tự: token Cloudflare, `SEPAY_*`, `SESSION_SECRET`, mật khẩu DB/Redis; `FIELD_ENC_KEY` chỉ khi chắc chắn lộ và cần kỹ sư, RUNBOOK nêu rõ chưa có công cụ xoay).
3. Xem `audit_log` theo `actor_id`/IP khoảng thời gian nghi vấn, đối chiếu ví/điều chỉnh/hoàn tiền bất thường.
4. Có dấu hiệu lộ dữ liệu cá nhân: báo CTO, luật sư/DPO (mục 4) trong ngày. Báo cáo sau sự cố bắt buộc.

### R10. Chứng chỉ, DNS hoặc tên miền lỗi (trình duyệt cảnh báo chứng chỉ, TV không kết nối được `gw-ams.anio.vn`)
1. `curl -vI https://ams.anio.vn` và `https://gw-ams.anio.vn`: xem ngày hết hạn, lỗi TLS; `dig +short ams.anio.vn`.
2. Cloudflare: kiểm tra zone còn Active, bản ghi không bị xóa nhầm, chứng chỉ Universal SSL. VPS: `docker compose ... logs caddy` (Let's Encrypt cần cổng 80/443 mở, DNS trỏ đúng IP, không đặt "Proxied" khi Caddy tự xin chứng chỉ).
3. Tên miền hết hạn: gia hạn ngay ở nhà đăng ký. **Đổi tên miền thì mọi TV phải cập nhật**: không đổi tên miền gateway.
4. Đóng khi cả hai tên miền trả 200 qua HTTPS hợp lệ.

## 6. Giám sát ngoài (bắt buộc, cấu hình ngoài hệ thống)

Cảnh báo nội bộ không báo được khi cả hệ thống chết. Đăng ký dịch vụ giám sát ngoài (UptimeRobot, Better Stack, hoặc Cloudflare Health Checks), kiểm tra mỗi 1-5 phút từ **hai điểm khác nhau**, báo qua email + điện thoại tới **cả hai người trực**:
- `https://ams.anio.vn/api/health` (mong đợi 200, `"ok":true`)
- `https://ams.anio.vn/api/status` (mong đợi 200 và từ khóa `"status":"operational"`; 503 = DB chết)
- `https://gw-ams.anio.vn/health` (200)
- Hạn chứng chỉ TLS và hạn tên miền (cảnh báo trước 21 ngày)

Điền vào đây khi đã cấu hình: nhà cung cấp `<ĐIỀN>`, ngày cấu hình `<ĐIỀN>`, người nhận `<ĐIỀN>`.

## 7. Diễn tập và rà soát

- **Trước go-live:** mỗi người trực chạy thử một sự cố giả (ví dụ: tắt `ingest-consumer` 15 phút ở staging; nhập webhook SePay sai chữ ký 3 lần) và ghi lại: có nhận cảnh báo không, sau bao lâu, runbook có đủ không. Điền vào bảng dưới.
- **Mỗi quý:** diễn tập khôi phục (DR mục 4, công cụ `scripts/ops.sh drill-pg`), rà soát lịch trực, danh bạ, quyền truy cập, ngưỡng cảnh báo.
- **Sau mỗi S1:** cập nhật runbook liên quan.

| Ngày | Người | Kịch bản (R1-R10) | Nhận cảnh báo sau | Runbook đủ? | Việc phát sinh |
|---|---|---|---|---|---|
| | | | | | |

## 8. Báo cáo sau sự cố (S1, trong 3 ngày làm việc; không quy lỗi cá nhân)

```
Tiêu đề / mã sự cố:                 Mức:        Môi trường:
Thời gian (UTC+7): phát hiện / giảm thiểu / khắc phục:
Phát hiện bằng: (cảnh báo nào / khách báo / giám sát ngoài)
Tác động: số khách, số TV, số tiền, dữ liệu mất (nếu có):
Dòng thời gian (giờ, người, hành động):
Nguyên nhân gốc:
Điều gì làm tốt / chưa tốt:
Việc phòng ngừa (người chịu trách nhiệm, hạn):
Cập nhật runbook/cảnh báo/ngưỡng:
```
