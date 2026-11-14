# AMS: chuyển từ Cloudflare (Workers + D1) sang VPS (Docker + Postgres)

Liên quan: `infra/vps/docker-compose.prod.yml`, `infra/vps/.env.example`, `tools/ops/` (`d1-to-pg`), `scripts/ops.sh`, `docs/ops/DISASTER-RECOVERY.md`, `docs/ops/ONCALL.md`, `docs/DEPLOY-CLOUDFLARE.md` (mục 8 quay lui), `docs/ops/EMAIL-SETUP.md`.

> **Trạng thái kiểm chứng (đọc trước).** Công cụ chuyển dữ liệu đã được chạy thật trên Postgres 16 nhúng với bộ dữ liệu sinh từ SQLite (20.460 và 300.480 dòng, số sổ cái, tổng ví và số dòng từng bảng khớp; giao dịch tự ROLLBACK nếu lệch). **Chưa chạy** với D1 thật (`wrangler d1 export --remote`), chưa dựng bằng Docker thật trên VPS, chưa chuyển DNS thật. Làm đúng thứ tự: **diễn tập (mục 3) trước, cắt chuyển (mục 4) sau**.

Mục tiêu: giữ nguyên URL (`https://ams.anio.vn`, `https://gw-ams.anio.vn`, URL webhook SePay) để TV và SePay không phải đổi gì. Thời gian ngừng ghi dự kiến: 15-45 phút (tùy kích thước DB và tốc độ mạng); **đo ở bước diễn tập, đừng tin con số này**.

## 1. Việc cần có trước

| Mục | Chi tiết |
|---|---|
| VPS | Ubuntu 22.04/24.04, tối thiểu 4 vCPU / 8 GB RAM / 100 GB SSD (compose mẫu hợp 4 GB nhưng ClamAV + ffmpeg cần dư). Cổng 80/443 mở; 22 chỉ cho IP quản trị. Docker Engine + Compose plugin |
| Tên miền | Quyền sửa DNS `anio.vn` ở Cloudflare |
| Khóa | **`FIELD_ENC_KEY` phải là đúng khóa đang chạy trên Cloudflare** (mã hóa theo trường; khóa khác = dữ liệu đã mã hóa không đọc được). Lấy từ kho bí mật đã ghi trong DR mục 2.6, không sinh mới. `SEPAY_WEBHOOK_SECRET`, `SEPAY_API_KEY/TOKEN`, `SESSION_SECRET` dùng lại giá trị hiện tại (đổi `SESSION_SECRET` sẽ đăng xuất mọi người, chấp nhận được) |
| Mã nguồn | Cùng commit đang chạy production (`git rev-parse HEAD` ghi vào nhật ký). Migration của nguồn phải nằm trong tập migration của repo, nếu không công cụ từ chối (mục 3) |
| Thư | `docs/ops/EMAIL-SETUP.md` đã xong, thư thử đến được |
| Sao lưu ngoài | Bucket B2/S3 và khóa `RCLONE_CONFIG_OFFSITE_*` sẵn sàng; `BACKUP_ENC_KEY` do ít nhất 2 người giữ |
| Người | 2 người (một thao tác, một kiểm), người trực theo ONCALL.md thông báo cửa sổ bảo trì cho khách trước ít nhất 48 giờ |

## 2. Dựng VPS (làm trước, không ảnh hưởng production)

```
sudo mkdir -p /opt/ams && sudo chown $USER /opt/ams && cd /opt/ams
git clone <kho-mã> . && git checkout <commit-production>
cp infra/vps/.env.example infra/vps/.env && chmod 600 infra/vps/.env
# điền mọi CHANGE_ME_*; FIELD_ENC_KEY = khóa Cloudflare hiện tại; SEED=0
docker compose --env-file infra/vps/.env -f infra/vps/docker-compose.prod.yml config -q   # phải im lặng
docker compose --env-file infra/vps/.env -f infra/vps/docker-compose.prod.yml build
```
`env-guard` từ chối khởi động nếu còn `CHANGE_ME`. Chưa chạy `up` cả hệ thống ở bước này; Caddy xin chứng chỉ chỉ thành công khi DNS đã trỏ về VPS (mục 4.7), vì vậy diễn tập dùng `postgres` riêng:
```
docker compose --env-file infra/vps/.env -f infra/vps/docker-compose.prod.yml up -d postgres redis
```

## 3. Diễn tập (bắt buộc, lặp tới khi sạch)

Diễn tập dùng dữ liệu thật nhưng **không** đụng production (xuất D1 chỉ đọc).

1. Máy có Node 22 + pnpm (có thể là chính VPS hoặc máy của bạn có SSH tunnel tới `127.0.0.1:5432`): `pnpm install`.
2. Tạo DB tạm, chạy thử không ghi:
```
export DATABASE_URL_REHEARSAL=postgres://ams:<mật-khẩu>@127.0.0.1:5432/ams_rehearsal
scripts/ops.sh d1-to-pg production --target-url "$DATABASE_URL_REHEARSAL" --create-db --dry-run
```
`--dry-run`: nạp trong giao dịch, so khớp, rồi ROLLBACK. Kỳ vọng: `THANH CONG`, mọi bảng `n/n`, số dòng sổ cái, tổng ví, **không có cảnh báo lệch kiểu** (cảnh báo kiểu dữ liệu in ra dưới dạng `canh bao: ...`, đọc từng dòng).
3. Chạy thật vào DB tạm (bỏ `--dry-run`), ghi lại: thời gian xuất D1, thời gian nạp, kích thước. Con số này quyết định độ dài cửa sổ bảo trì (mục 4).
4. Dựng thử ứng dụng trỏ vào DB tạm (sửa tạm `POSTGRES_DB=ams_rehearsal` hoặc dùng `docker compose run`), đăng nhập quản trị, mở Tài chính, đối chiếu số dư ví vài khách với D1.
5. Chạy `drill`: `scripts/ops.sh drill-pg --source-url "$DATABASE_URL_REHEARSAL"` (khôi phục vào DB tạm khác và so khớp) để biết RTO khôi phục thật trên VPS này, ghi vào DR mục 7.
6. Xóa DB tạm: `psql ... -c 'DROP DATABASE ams_rehearsal'`.

Nếu công cụ báo "nguồn đã áp migration repo không có": cập nhật mã nguồn VPS lên commit mới hơn rồi làm lại. Nếu báo "DB đích không trống": dùng DB mới (`--create-db`); bảng bất biến không cho TRUNCATE nên **không** "dọn rồi nạp lại" trên cùng DB, hãy tạo DB mới.

## 4. Cắt chuyển (ngày thật)

Mỗi bước ghi giờ vào nhật ký sự cố (RUNBOOK mục 9). Người thứ hai xác nhận bước 3 và 5.

**4.1 Thông báo và đóng băng ghi (T0).**
- Hiện thông báo bảo trì (trang trạng thái hiện `public_note` qua Cảnh báo > cài đặt, nếu đã dùng).
- Chặn gateway nhận dữ liệu: đặt KV `ctl:gateway` = `{"shed":true,"shed_events":true}` (TV giữ sự kiện ngoại tuyến và gửi lại sau; RUNBOOK 4.4):
```
npx wrangler kv key put ctl:gateway '{"shed":true,"shed_events":true}' --namespace-id <kv_id> --remote
```
- Tắt nạp tiền tự động: ở my.sepay.vn tạm **tắt webhook** (hoặc ghi nhận giao dịch trong cửa sổ để đối soát bù sau, mục 4.9). Không để tiền vào ví giữa lúc xuất và nạp.
- Chặn quản trị ghi: chuyển `ams.anio.vn` sang trang bảo trì (Cloudflare Rules > Redirect/Custom response 503 cho đường `/api/*` trừ IP của bạn) hoặc tạm vô hiệu route Worker api.
- Chờ 2 phút cho hàng đợi ingest cạn: Dashboard > Queues `ams-ingest-production` backlog = 0 và DLQ = 0 (RUNBOOK 4.1).

**4.2 Sao lưu cuối ở Cloudflare (đường lui).**
```
scripts/ops.sh backup-d1 production --out /opt/ams-final-cf --keep 30
npx wrangler d1 time-travel info ams-core-production --env production -c infra/cloudflare/api/wrangler.generated.toml   # ghi bookmark
```
Giữ bản này tối thiểu 30 ngày. **Không xóa D1 hay Worker** trong ít nhất 14 ngày sau cắt chuyển.

**4.3 Xuất cuối và nạp vào Postgres VPS (DB trống).**
```
cd /opt/ams && docker compose --env-file infra/vps/.env -f infra/vps/docker-compose.prod.yml up -d postgres redis
scripts/ops.sh d1-to-pg production --target-url "postgres://ams:<mật-khẩu>@127.0.0.1:5432/ams" --out /opt/ams-final-cf/convert-report.json
```
Công cụ tự áp schema bằng migration của repo, nạp một giao dịch, và chỉ COMMIT nếu số dòng từng bảng, checksum `wallet_entries`, tổng ví và số ví lệch đều khớp nguồn. **Nếu `THAT BAI`: dừng, không sửa tay dữ liệu; xem mục 6 (rollback).**

**4.4 Kiểm tra dữ liệu độc lập (người thứ hai).**
```
docker compose ... exec postgres psql -U ams -d ams -c "select count(*) from wallet_entries"
docker compose ... exec postgres psql -U ams -d ams -c "select count(*) from ad_wallets w where balance_vnd <> coalesce((select sum(amount_vnd) from wallet_entries e where e.wallet_id=w.id),0)"
```
(đối chiếu với D1 bằng cùng truy vấn qua `wrangler d1 execute`; tên cột theo schema hiện hành, kiểm `packages/db/migrations`.) Lệch phải bằng 0.

**4.5 Chuyển media (R2 sang volume).**
```
rclone sync R2:ams-media-production /var/lib/docker/volumes/ams_mediadata/_data/media --transfers 16 --checksum
rclone sync R2:ams-reports-production .../reports
```
(thư mục đích là `/data/objects/...` trong container; đặt quyền `chown -R 1000:1000`). Kiểm số tệp và dung lượng khớp (`rclone check`). Media lớn: sao chép **trước** ngày cắt chuyển và chỉ đồng bộ phần chênh lệch ở bước này.

**4.6 Khởi động toàn bộ.**
```
docker compose --env-file infra/vps/.env -f infra/vps/docker-compose.prod.yml up -d
docker compose ... ps          # mọi dịch vụ healthy; migrate = Exited (0)
```
Ứng dụng tăng **epoch manifest** để TV tải lại cấu hình (xem RUNBOOK/ARCHITECTURE về manifest; thao tác trong web admin hoặc API đã dùng khi phát hành), vì cache manifest ở KV Cloudflare không chuyển sang.

**4.7 Chuyển DNS (Cloudflare).** Trong DNS của `anio.vn`:
- `ams.anio.vn` và `gw-ams.anio.vn`: đổi bản ghi sang `A <IP VPS>` (và `AAAA` nếu có), **DNS only (mây xám)** để Caddy tự xin chứng chỉ Let's Encrypt và để địa chỉ IP khách thật vào gateway. Nếu hiện là route Worker, gỡ route/Custom Domain của Worker cho hai tên này (qua dashboard; **không** sửa logic `scripts/deploy-cloudflare.*`).
- TTL đặt 60 giây từ **một ngày trước** cắt chuyển để chuyển nhanh.
- Kiểm: `dig +short ams.anio.vn` trả IP VPS; `docker compose ... logs caddy | grep -i "certificate obtained"`.

**4.8 Kiểm sau chuyển (smoke).**
```
curl -s https://ams.anio.vn/api/health
curl -s https://ams.anio.vn/api/status        # công khai, không lộ nội bộ
curl -s https://gw-ams.anio.vn/health
```
Đăng nhập quản trị; Cảnh báo > "Chạy kiểm tra ngay" (không có S1); Cảnh báo > Gửi thử (email đến); Tài chính: số dư vài ví khớp D1; một TV thử: heartbeat về, manifest tải được, sự kiện nhận. `pnpm e2e:smoke` trỏ vào URL production nếu cấu hình sẵn.

**4.9 Mở lại tiền và dữ liệu.**
- Bật lại webhook SePay (URL **không đổi**; đã trỏ về VPS nhờ DNS). Bấm "Gửi thử" ở my.sepay.vn, kiểm `payment_webhooks`. Giao dịch phát sinh trong cửa sổ: dùng "Gửi lại" trong nhật ký SePay (SePay thử lại tối đa 7 lần; webhook khử trùng nên phát lại an toàn).
- Xóa `ctl:gateway` ở KV cũ không còn tác dụng (gateway giờ ở VPS). Gateway VPS không có shed; TV gửi lại sự kiện ngoại tuyến.
- Chạy sao lưu đầu tiên: `docker compose ... exec backup /usr/local/bin/ams-backup postgres`; kiểm trang Cảnh báo hiện bản sao lưu thành công (`/ops/backup-report` cần `OPS_REPORT_TOKEN`).
- Theo dõi 2 giờ đầu: Cảnh báo, `docker compose ... logs -f --tail 100 api edge-gateway`.

**4.10 Sau cắt chuyển (7-14 ngày).** Giữ Worker/D1 ở trạng thái đọc (không có DNS trỏ vào); theo dõi; sau 14 ngày không sự cố mới tắt Worker cron và xóa tài nguyên Cloudflare không còn dùng. Cập nhật RUNBOOK mục 2 (đã chạy VPS), DR mục 1 và `docs/COMMERCIAL-READINESS.md`.

## 5. Khác biệt vận hành sau khi chuyển

| Mục | Cloudflare | VPS |
|---|---|---|
| Hàng đợi | Cloudflare Queues | Redis (`ams:q:ingest.events`, ... `:dead`) |
| Cron | Worker cron (`*/10`, `15 2 * * *`) | Bộ lập lịch trong tiến trình api (kiểm tra vận hành mỗi 5 phút, khóa Redis để chỉ một bản chạy) |
| Sao lưu | D1 Time Travel + export | Sidecar `backup` mã hóa + rclone; **chưa có PITR**: RPO = chu kỳ sao lưu (mặc định 6 giờ) |
| HA | Cloudflare | **Một VPS = một điểm lỗi.** Chấp nhận có ý thức, hoặc thêm VPS dự phòng + khôi phục từ bản sao ngoài (DR kịch bản B) |
| Chứng chỉ | Cloudflare | Caddy + Let's Encrypt (cần cổng 80/443 mở) |
| DDoS/WAF | Cloudflare | Không có theo mặc định: nếu cần, giữ Cloudflare **proxy (mây cam)** phía trước và đặt SSL "Full (strict)"; khi đó đặt lại cách đọc IP khách (CF-Connecting-IP) trong Caddyfile trước khi bật |

## 6. Quay lui (rollback)

**Trước khi chuyển DNS (bước 4.7):** production Cloudflare chưa bị đụng ngoài việc đóng băng. Gỡ `ctl:gateway` (`npx wrangler kv key delete ctl:gateway --namespace-id <kv_id> --remote`), bật lại webhook SePay, gỡ trang bảo trì. Dữ liệu D1 nguyên vẹn; ghi nguyên nhân thất bại và làm lại diễn tập.

**Sau khi chuyển DNS, trong vòng 14 ngày:**
1. Đặt DNS về cấu hình Cloudflare cũ (khôi phục route/Custom Domain Worker); TTL 60 giây nên có hiệu lực trong vài phút.
2. **Dữ liệu ghi trên VPS sau cắt chuyển (nạp tiền, sự kiện, thay đổi quản trị) sẽ không có ở D1.** Trước khi quay lui: dừng ghi trên VPS (`docker compose ... stop api edge-gateway`), xuất phần phát sinh (`pg_dump` các bảng `wallet_*`, `payment_*`, `ev_*` từ thời điểm cắt) và áp lại vào D1 bằng tay có kiểm đối soát (không có công cụ Postgres sang D1; **rủi ro đã biết**). Nếu quay lui trong vài giờ đầu và lượng ghi nhỏ, chấp nhận nạp tay các giao dịch nạp tiền từ `payment_webhooks` và dựa vào SePay "Gửi lại".
3. Gỡ `ctl:gateway`, bật webhook SePay về URL cũ, chạy "Chạy kiểm tra" và `reconcileLedger`.

Điều kiện quay lui nên chốt trước: ví dụ sự cố S1 kéo dài quá 60 phút sau chuyển mà chưa có hướng sửa trong VPS, hoặc đối soát ví lệch không giải thích được.

## 7. Danh sách kiểm (in ra, tích từng bước)

- [ ] Diễn tập `--dry-run` sạch, đã ghi thời gian (mục 3)
- [ ] `FIELD_ENC_KEY` trên VPS khớp Cloudflare (thử đọc một trường mã hóa ở môi trường diễn tập)
- [ ] Thư thử, sao lưu thử, rclone ngoài máy chủ đã chạy
- [ ] TTL DNS 60 giây từ hôm trước; thông báo khách 48 giờ
- [ ] Đóng băng (4.1), sao lưu cuối (4.2), nạp (4.3), kiểm độc lập (4.4)
- [ ] Media (4.5), `up -d` (4.6), DNS (4.7), smoke (4.8), SePay (4.9)
- [ ] Sao lưu đầu tiên thành công và hiện trên trang Cảnh báo
- [ ] Giữ Cloudflare 14 ngày; ghi nhật ký
