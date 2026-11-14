# AMS: khôi phục sau thảm họa (DR)

Liên quan: `docs/ops/RUNBOOK.md` (sự cố thường ngày), `docs/DEPLOY-CLOUDFLARE.md` mục 8 (quay lui), `docs/COMMERCIAL-RECOMMENDATIONS.md` #14, đặc tả mục 3 và 13 (RPO ≤ 5 phút, RTO ≤ 30 phút ở giai đoạn 3).

> **Trạng thái kiểm chứng (đọc trước).** Đây là kế hoạch và mục tiêu, **chưa phải năng lực đã được chứng minh**. Đã chạy thật trong lần soạn tài liệu (2026-11-12, PostgreSQL 16 nhúng, không Docker): `scripts/backup-postgres.sh` ở chế độ `--direct` gồm `backup`, `verify`, `restore` (vào DB mới và ghi đè tại chỗ sau khi cố ý làm hỏng dữ liệu) và kiểm chứng giữ nguyên trigger bất biến cùng bất biến ví. Chế độ Docker của script chỉ được thử với một lớp giả lập `docker`, không phải Docker thật. **Chưa chạy thật:** D1 Time Travel/export, R2, ClickHouse `BACKUP`, WAL/PITR Postgres, mọi thứ trên Cloudflare. Con số RPO/RTO ở mục 1 là **mục tiêu thiết kế** cho tới khi diễn tập (mục 4) ghi lại số đo thật.
>
> **Bổ sung (p3-ops, 2026-11-14).** Có thêm bộ công cụ `tools/ops` (sao lưu **mã hóa** Postgres/D1, khôi phục, **diễn tập tự động** vào DB tạm và so số dòng + checksum sổ cái, chuyển D1 sang Postgres) và sidecar sao lưu cho VPS (`infra/vps/backup`). Đã diễn tập thật trên **container phát triển** (Postgres 16 nhúng, dữ liệu sinh từ SQLite, tới 300 nghìn dòng): số đo ở mục 7, **không phải số production**. Vẫn chưa chạy: D1 Time Travel/export thật, Docker thật, rclone tới B2/S3 thật, WAL/PITR.

## 1. Mục tiêu RPO/RTO theo môi trường

RPO: tối đa bao lâu dữ liệu được phép mất. RTO: tối đa bao lâu để chạy lại.

| Môi trường | Dữ liệu | RPO mục tiêu | RTO mục tiêu | Cơ chế dự kiến | Đã có chưa |
|---|---|---|---|---|---|
| Docker local (PC) | Phát triển/demo, dữ liệu mẫu | 24 giờ | 2 giờ | `scripts/backup-postgres.sh` chạy tay hoặc lịch của hệ điều hành; `make up && make seed` dựng lại từ đầu | Script: có và đã thử. Lịch tự động: chưa. **Không dùng để giữ tiền thật** |
| Cloudflare staging | Dữ liệu thử, SePay sandbox | 24 giờ | 4 giờ | D1 Time Travel + `d1 export` trước mỗi deploy | Export trước migration: có trong `deploy-cloudflare.mjs` (chưa chạy thật) |
| Cloudflare production, giai đoạn 1 (đến ~3 triệu thiết bị) | Giao dịch (ví, hợp đồng, người dùng), media, sự kiện | **Giao dịch ≤ 5 phút** (Time Travel, độ mịn phút); media ≤ 24 giờ; sự kiện: xem ghi chú | **≤ 60 phút** (khôi phục D1 + deploy lại Worker + kiểm tra); mục tiêu 30 phút sau khi diễn tập đạt | D1 Time Travel (30 ngày theo DEPLOY-CLOUDFLARE mục 8; xác nhận theo gói tài khoản), `d1 export` định kỳ ra R2/ngoài Cloudflare, sao chép R2, Git cho mã | Time Travel/export: chưa chạy thật. **Bản sao ngoài Cloudflare và sao chép R2: chưa có** |
| Hạ tầng riêng (giai đoạn 2-3) | Như trên, quy mô lớn | **≤ 5 phút** (đặc tả) | **≤ 30 phút** (đặc tả) | Postgres PITR (lưu trữ WAL), replica, ClickHouse backup, S3 sao chép vùng | Chưa có (chỉ khung `infra/k8s/`) |

Ghi chú:
- **Hai kiểu mất dữ liệu khác nhau:** (a) hỏng/xóa nhầm: khôi phục về thời điểm ngay trước sự cố (Time Travel/PITR); (b) mất cả nhà cung cấp/tài khoản: cần bản sao **ngoài** nơi chạy chính. Time Travel không cứu được (b).
- **Sự kiện (impression, proof-of-play) là chứng cứ tính tiền.** Mất sự kiện = mất doanh thu và không đối soát được. Thiết bị giữ hàng đợi ngoại tuyến nên một phần sự kiện gửi lại được; sự kiện đã nhận mà chưa sao lưu thì mất theo RPO của kho sự kiện. Ở Cloudflare giai đoạn 1, `ev_*` nằm trong D1 `ams-core` (cùng RPO giao dịch) hoặc Analytics Engine (`ams_events_<env>`, **không khôi phục được**). Quyết định kho chứng cứ cuối cùng cần chốt trước go-live.
- Bất biến cần giữ sau mọi khôi phục: `wallet_entries`, `wallet_ledger`, `audit_log` chỉ INSERT (trigger); số dư `ad_wallets` khớp tổng sổ cái; webhook SePay và `event_id` khử trùng nên phát lại an toàn.
- D1 `ams-finance-*` và `ams-audit-*` đang trống (migration chỉ áp lên `ams-core-*`): mọi dữ liệu ở `ams-core`. Khi f1 tách migration theo miền, bổ sung hai DB này vào bước sao lưu/khôi phục dưới đây.

## 2. Sao lưu và khôi phục theo kho dữ liệu

### 2.1 PostgreSQL (Docker local; hạ tầng riêng)

**Sao lưu logic (có sẵn, đã chạy thật ở chế độ direct):**
```
scripts/backup-postgres.sh backup                 # Docker: pg_dump -Fc trong container postgres -> ./backups/postgres-<db>-<UTC>.dump + .sha256
scripts/backup-postgres.sh backup --keep 14       # giữ 14 bản mới nhất (mặc định 14)
scripts/backup-postgres.sh backup --direct        # dùng pg_dump trên máy, kết nối bằng DATABASE_URL hoặc PG*
scripts/backup-postgres.sh list
.\scripts\backup-postgres.ps1 backup              # Windows (CHƯA chạy thử; cùng cách dùng, tham số -Out -Keep -Direct)
```
`backups/` nằm trong `.gitignore`. Bản sao lưu **không chứa** `FIELD_ENC_KEY`, `.env` hay secret Cloudflare (xem 2.6). Lên lịch: cron (`0 */6 * * * cd /đường/dẫn/ams && scripts/backup-postgres.sh backup`) hoặc Task Scheduler gọi `.ps1`. Sao chép tệp ra **máy/đĩa khác** (bản sao cùng đĩa không phải sao lưu).

**Kiểm chứng một bản sao lưu (không đụng DB chạy thật):**
```
scripts/backup-postgres.sh verify backups/postgres-ams-<UTC>.dump [--compare-source]
```
Làm: kiểm SHA-256, `pg_restore --list`, khôi phục thử vào DB tạm `<db>_verify_<pid>`, đếm bảng và dòng các bảng chính, kiểm ví khớp sổ cái, kiểm còn 3 trigger bất biến, rồi xóa DB tạm. Thoát khác 0 nếu thất bại. Đã thử trên dữ liệu seed: 49 bảng, 4 migration, ví lệch 0, trigger 3/3, và phát hiện tệp bị sửa (SHA-256 không khớp).

**Khôi phục:**
```
scripts/backup-postgres.sh restore backups/<tệp>.dump --target-db ams_restored   # vào DB mới, an toàn nhất
scripts/backup-postgres.sh restore backups/<tệp>.dump                            # GHI ĐÈ DB hiện tại; phải gõ lại tên DB (hoặc --yes)
```
Khôi phục tại chỗ dùng `pg_restore --clean --if-exists`: xóa bảng cũ rồi tạo lại (DROP TABLE không bị trigger bất biến chặn; đã kiểm chứng). Trước khi ghi đè: dừng `api`, `edge-gateway`, `ingest-consumer` và chạy `backup` để có đường lui.

**Sao lưu mã hóa + diễn tập (`tools/ops`, khuyến nghị cho production):**
```
export BACKUP_ENC_KEY=<khóa >=16 ký tự, cất RIÊNG với bản sao lưu, >= 2 người giữ>
scripts/ops.sh backup-pg --out /var/backups/ams --keep 14 --copy-to /mnt/khac-may      # pg_dump -Fc -> AES-256-CBC (PBKDF2-SHA256, định dạng openssl "Salted__") + .sha256
scripts/ops.sh restore /var/backups/ams/<tệp>.dump.enc --kind postgres --target-url postgres://... --create-db
scripts/ops.sh drill-pg --source-url postgres://...     # khôi phục vào DB tạm, so số dòng từng bảng + checksum wallet_entries + tổng ví + trigger bất biến, rồi xóa DB tạm
scripts\OPS-BACKUP-PG.bat | OPS-RESTORE.bat | OPS-DRILL.bat | OPS-BACKUP-D1.bat | OPS-D1-TO-PG.bat   # Windows (ops.ps1 chưa chạy thử: không có PowerShell)
```
Giải mã tay bằng openssl: `openssl enc -d -aes-256-cbc -pbkdf2 -md sha256 -iter 200000 -pass env:BACKUP_ENC_KEY -in X.dump.enc -out X.dump`. CBC không tự xác thực: toàn vẹn dựa vào `.sha256` trên bản mã hóa và `pg_restore --list` khi khôi phục. Mỗi bản sao lưu báo về API (`POST /ops/backup-report`, cần `OPS_REPORT_TOKEN`) để trang **Cảnh báo** biết "bản sao lưu cũ/lỗi" (quy tắc `backup:stale`, `backup:failed`). Trên VPS, sidecar `backup` (compose `infra/vps/`) làm tự động theo `BACKUP_CRON` và sao chép ra ngoài bằng rclone (`BACKUP_RCLONE`).

**Nhược điểm của sao lưu logic:** RPO bằng khoảng cách giữa hai lần chạy. Muốn RPO ≤ 5 phút trên Postgres cần lưu trữ WAL liên tục (PITR: `archive_mode`, `archive_command` hoặc pgBackRest/WAL-G) và `pg_basebackup`. **Compose hiện không bật WAL archiving**; đây là việc cho giai đoạn hạ tầng riêng.

### 2.2 Cloudflare D1 (`ams-core-<env>`)

Thay `<env>` bằng `staging`/`production`; cấu hình sinh ra: `infra/cloudflare/api/wrangler.generated.toml`.
| Việc | Lệnh | Ghi chú |
|---|---|---|
| Xem điểm khôi phục | `npx wrangler d1 time-travel info ams-core-<env> --env <env> -c <cfg>` (thêm `--timestamp=<ISO-8601>` để tra bookmark của một thời điểm) | Time Travel khôi phục về bất kỳ phút nào trong thời hạn giữ (30 ngày theo DEPLOY-CLOUDFLARE; xác nhận theo gói) |
| **Khôi phục tại chỗ** | `npx wrangler d1 time-travel restore ams-core-<env> --timestamp=<ISO-8601 ngay trước sự cố> --env <env> -c <cfg>` | Ghi đè DB; lệnh in bookmark trước khi khôi phục: **ghi lại** để hoàn tác nếu chọn sai thời điểm (xác nhận khi chạy thật) |
| Xuất bản sao | `npx wrangler d1 export ams-core-<env> --remote --output backups/<env>-<UTC>/core.sql --env <env> -c <cfg>` | `deploy-cloudflare.mjs` tự làm trước migration. Nên chạy định kỳ (GitHub Actions `schedule`, chưa có) và **lưu ngoài Cloudflare** |
| Nạp lại từ tệp | tạo DB mới `npx wrangler d1 create ams-core-<env>-restore`, rồi `npx wrangler d1 execute ams-core-<env>-restore --remote --file backups/<...>/core.sql` | Dùng cho mất toàn bộ DB hoặc tài khoản; sau đó trỏ `database_id` mới vào `ids.<env>.json` và deploy lại |
Bản sao mã hóa tự động: `scripts/ops.sh backup-d1 production --out <thư mục> --keep 14` (gọi `wrangler d1 export --remote` rồi mã hóa như 2.1; **chưa chạy với D1 thật**). Khôi phục: `scripts/ops.sh restore <tệp>.sql.enc --kind d1 ...` (chạy `wrangler d1 execute`, chưa chạy thật) hoặc `--kind sqlite` để kiểm thử cục bộ. Chuyển D1 sang Postgres: `docs/ops/MIGRATE-CF-TO-VPS.md`.
Lưu ý: migration phải tương thích ngược để quay lui mã không hỏng dữ liệu (DEPLOY-CLOUDFLARE mục 8.2). Bản export chứa dữ liệu cá nhân và số liệu tài chính: lưu mã hóa, hạn chế truy cập.

### 2.3 Cloudflare R2 và volume media Docker (media, báo cáo, bản sao audit)

Bucket: `ams-media-<env>` (media quảng cáo), `ams-reports-<env>`, `ams-audit-<env>` (bản sao audit; object lock là việc **Sẽ làm**, THREAT-MODEL mục 3). Repo **chưa có** cơ chế sao lưu R2. Đề xuất, chưa kiểm chứng:
- Định kỳ sao chép sang một bucket/nhà cung cấp khác (rclone với endpoint S3 của R2, hoặc `wrangler r2 object get`); R2 bền vững nhưng không thay thế bản sao khi xóa nhầm hoặc mất tài khoản.
- Media có thể phục hồi một phần từ khách (họ giữ bản gốc) và từ bảng `creatives`; báo cáo sinh lại được; **bản sao audit** là chứng cứ pháp lý (giữ ≥ 12 tháng), ưu tiên bản sao thứ hai.
- Docker local (`OBJECT_STORE=fs`, không còn MinIO): toàn bộ tệp nằm trong volume `ams_mediadata` (thư mục `/data/objects`: `media/` bản gốc, `renditions/` bản chuyển mã, `.meta/` content-type). Sao lưu bằng tar (Docker Hub là registry duy nhất cần): `docker run --rm -v ams_mediadata:/data:ro -v "$PWD/backups:/out" alpine tar czf /out/mediadata-$(date +%F).tgz -C /data .`. Khôi phục vào volume rỗng: `docker run --rm -v ams_mediadata:/data -v "$PWD/backups:/out" alpine tar xzf /out/mediadata-<ngày>.tgz -C /data` rồi `chown -R 1000:1000 /data` (user `node`) (chưa chạy thật).

### 2.4 ClickHouse (profile `events`, chỉ Docker thử nghiệm)

Hiện không có ClickHouse trên Cloudflare (giai đoạn 2). Trên Docker, bảng `heartbeat` có `TTL 14 ngày`; `ad_impression`, `proof_of_play`, bảng gộp thì không. Sao lưu bằng lệnh `BACKUP` của chính ClickHouse (cần khai báo ổ/đường dẫn sao lưu trong cấu hình ClickHouse; **chưa kiểm chứng**):
```
$DC exec clickhouse clickhouse-client --query "BACKUP DATABASE ams TO File('/var/lib/clickhouse/backup/ams-<UTC>.zip')"
$DC exec clickhouse clickhouse-client --query "RESTORE DATABASE ams FROM File('/var/lib/clickhouse/backup/ams-<UTC>.zip')"
```
Phương án thay thế đơn giản cho môi trường thử: dừng ClickHouse rồi sao lưu volume `chdata`. DDL dựng lại từ `packages/db/clickhouse/*.sql` (qua `infra/clickhouse/init/00-apply-ddl.sh`) nhưng **dữ liệu thì không dựng lại được từ DDL**. Dashboard chỉ đọc bảng gộp, nên sau khi khôi phục cần kiểm tra bảng gộp (`impression_hourly`) so với `ev_ad_impression`/bản gốc.

### 2.5 Redis và KV (không phải kho chính)

- Docker: Redis bật AOF (`--appendonly yes`, volume `redisdata`). Chứa rate-limit, `manifest epoch`, công tắc `ctl:gateway`, khóa lịch chạy, và **hàng đợi sự kiện chưa xử lý** (`ams:q:ingest.events`). Mất Redis: mất rate-limit/cache (tự dựng lại) và sự kiện đang chờ. Giảm rủi ro: giữ `ingest-consumer` chạy để hàng đợi luôn gần 0.
- Cloudflare KV: tương đương; chỉ chứa dữ liệu dựng lại được. Sau khôi phục D1 nên tăng `manifest epoch` (duyệt/tạm dừng một chiến dịch hoặc để `manifest.bump` chạy) để gateway dựng lại manifest.

### 2.6 Bí mật và cấu hình (quan trọng nhất cho khôi phục)

Dữ liệu sao lưu vô dụng nếu mất khóa. Lưu **riêng, ngoại tuyến hoặc trong trình quản lý bí mật có kiểm soát truy cập**, tối thiểu hai người giữ:
| Mục | Hậu quả nếu mất |
|---|---|
| `FIELD_ENC_KEY` (mỗi môi trường) | **Mất vĩnh viễn** MST, số tài khoản ngân hàng, TOTP, bí mật SePay đã lưu mã hóa (không có bản mã hóa lại; xem RUNBOOK 4.5) |
| `SESSION_SECRET`, `SEPAY_WEBHOOK_SECRET`, `SEPAY_API_KEY/TOKEN`, khóa R2 | Đặt lại được (có tác động: RUNBOOK 4.5), không mất dữ liệu |
| Bản sao bí mật do `deploy-cloudflare.mjs --generate-secrets` ghi vào `backups/` | Thư mục `backups/` có thể chứa `SESSION_SECRET`/`FIELD_ENC_KEY` rõ: **hạn chế quyền truy cập, không đẩy lên Git/chia sẻ chung với bản sao lưu dữ liệu**; chuyển vào nơi lưu bí mật rồi xóa bản trong `backups/` |
| `.env` (Docker), `infra/cloudflare/ids.<env>.json` (ID D1/KV; **bị .gitignore**) | Dựng lại được bằng `d1 list`/`kv namespace list` nhưng tốn thời gian; sao lưu cùng bí mật |
| Mã nguồn, `wrangler.toml`, Terraform, migration | Có trong Git (đẩy lên kho từ xa) |
| Tài khoản Cloudflare, domain `anio.vn`, my.sepay.vn | Cần hai người quản trị, bật 2FA, có quy trình lấy lại tài khoản |

## 3. Quy trình khôi phục (kịch bản)

Nguyên tắc: **dừng ghi trước, khôi phục, kiểm chứng, rồi mới mở lại**. Người ra quyết định: CTO. Ghi nhật ký từng bước (RUNBOOK mục 9).

### Kịch bản A: dữ liệu bị xóa/hỏng, hệ thống vẫn chạy (Cloudflare production)
1. **Chặn ghi:** tắt nhận tiền tự động (Cài đặt > SePay); bật `ctl:gateway` `{"shed":true,"shed_events":true}` (RUNBOOK 4.4); cân nhắc gỡ tên miền web (RUNBOOK mục 2). Ghi lại giờ UTC `T_dừng`.
2. Xác định thời điểm tốt cuối cùng `T_tốt` (nhật ký audit, giờ sự cố). Lấy bookmark hiện tại bằng `time-travel info` (để hoàn tác).
3. Xuất bản sao hiện trạng (`d1 export`) để điều tra sau.
4. `time-travel restore ... --timestamp=<T_tốt>`.
5. **Kiểm chứng nghiệp vụ** (mục 5). Nếu sai: khôi phục lại về bookmark ở bước 2 hoặc chọn thời điểm khác.
6. Bù khoảng mất (T_tốt → T_dừng):
   - Nạp tiền: SePay gửi lại webhook và cron `*/10` đối soát bù với `lookbackHours` mặc định **48 giờ** (cần `SEPAY_API_TOKEN`); khoảng mất dài hơn 48 giờ cần đối chiếu tay sao kê ngân hàng với `topups`. Khử trùng bảo đảm không cộng hai lần.
   - Sự kiện thiết bị: thiết bị gửi lại hàng đợi ngoại tuyến; `event_id` khử trùng.
   - Thao tác của người dùng trong khoảng mất (duyệt chiến dịch, hợp đồng...): đối chiếu từ nhật ký Worker/email và nhập lại.
7. Mở lại theo thứ tự: gateway (xóa `ctl:gateway`), bật nhận tiền, mở web. Theo dõi 30 phút.
8. Viết báo cáo sự cố (nguyên nhân, dữ liệu mất, tiền bị ảnh hưởng, việc phòng ngừa).

### Kịch bản B: mất cả DB/tài khoản/nhà cung cấp (khôi phục từ bản sao ngoài)
1. Xác nhận phạm vi với Cloudflare; lấy lại quyền tài khoản (2.6).
2. Dựng môi trường mới theo `docs/DEPLOY-CLOUDFLARE.md` mục 2-6 (tài nguyên: `deploy-cloudflare.mjs --bootstrap` hoặc Terraform) vào tài khoản/zone mới; đặt lại secret, **dùng đúng `FIELD_ENC_KEY` cũ**.
3. Nạp bản export D1 mới nhất vào DB mới (2.2, "Nạp lại từ tệp"), cập nhật `database_id`, deploy.
4. Phục hồi media/audit từ bản sao R2 (2.3).
5. Đổi DNS/webhook: URL ở my.sepay.vn, DNS `ams.anio.vn`, `gw-ams.anio.vn` (thiết bị dùng tên miền này; nếu đổi tên miền thì TV phải cập nhật, nên **giữ tên miền**).
6. Kiểm chứng nghiệp vụ (mục 5), bù khoảng mất như Kịch bản A bước 6. RTO của kịch bản này dài hơn RTO ở mục 1 (mục tiêu 1 ngày, chưa đo).

### Kịch bản C: Docker local
1. `$DC stop api edge-gateway ingest-consumer`.
2. `scripts/backup-postgres.sh verify <tệp mới nhất>` rồi `scripts/backup-postgres.sh restore <tệp>`.
3. `pnpm --filter @ams/api migrate` (idempotent; áp migration mới hơn bản sao lưu nếu có).
4. `$DC up -d`, kiểm tra RUNBOOK mục 3, kiểm chứng nghiệp vụ (mục 5).
5. Volume media/Redis: giải nén bản tar vào volume (mục 2.3); nếu không có, media phải tải lên lại.
Làm lại từ đầu bằng dữ liệu mẫu (chỉ local): `make reset` rồi `make up && make seed` (xóa sạch); ngoài local dùng `make bootstrap`.

## 4. Diễn tập khôi phục (thủ tục thử, bắt buộc mỗi quý)

Mục đích: chứng minh RPO/RTO bằng số đo, không bằng niềm tin. Làm trên **staging** (hoặc bản sao), không bao giờ diễn tập trực tiếp trên production.

| # | Bước | Cách làm | Đạt khi | Ghi lại |
|---|---|---|---|---|
| 1 | Chuẩn bị | Chọn thời điểm; ghi số liệu gốc: số dòng các bảng chính, tổng số dư ví, 5 giao dịch gần nhất | Có bảng số liệu | Giờ bắt đầu `t0` |
| 2 | Tạo dữ liệu đánh dấu | Tạo 1 khách hàng thử và 1 nạp tiền SePay sandbox; ghi `T_mốc` | Thấy trong web | `T_mốc` |
| 3 | Sao lưu | Docker: `backup`. D1: `d1 export` + ghi bookmark Time Travel | Tệp có, SHA-256 | Dung lượng, thời gian |
| 4 | Làm hỏng | Xóa/sửa dữ liệu có chủ đích (ví dụ cập nhật `customers.short_name`, xóa `device_commands`; **không** thể sửa bảng bất biến) | Hỏng nhìn thấy được | Giờ `t_hỏng` |
| 5 | Khôi phục | Docker: `restore --yes`. D1: `time-travel restore --timestamp=<T_mốc>` | Lệnh thành công | Thời gian chạy lệnh |
| 6 | Kiểm chứng kỹ thuật | `migrate` chạy sạch; `/health` 200; đăng nhập; trigger bất biến còn (`UPDATE audit_log` bị từ chối) | Tất cả đạt | |
| 7 | Kiểm chứng nghiệp vụ | Mục 5 | Tất cả đạt | |
| 8 | Đo | **RPO thực** = `t_hỏng` trừ thời điểm dữ liệu mới nhất còn lại; **RTO thực** = giờ hệ thống dùng được trừ `t_hỏng` | So với mục tiêu mục 1 | Số đo |
| 9 | Kết luận | Điền bảng "Kết quả diễn tập" bên dưới; việc chưa đạt vào backlog có người chịu trách nhiệm | | |

Phần kiểm chứng nghiệp vụ nên làm sau mỗi lần diễn tập: dùng `scripts/backup-postgres.sh verify` (Docker) hoặc các truy vấn mục 5 trên D1.

## 5. Kiểm chứng sau khôi phục (checklist nghiệp vụ)

- [ ] Số dòng các bảng chính xấp xỉ số liệu gốc/hợp lý theo thời điểm: `customers`, `campaigns`, `ad_wallets`, `wallet_entries`, `topups`, `payment_webhooks`, `audit_log`, `devices`.
- [ ] **Ví khớp sổ cái:** không lệch (truy vấn trong `scripts/backup-postgres.sh`; hoặc đợi/kích job `reconcileLedger` và không có thông báo `reconcile_mismatch`).
- [ ] `payment_webhooks` có `credited` khớp `topups` đã `credited`; không có `topups` `credited` thiếu dòng `wallet_entries` (đó là "orphan" mà đối soát phát hiện).
- [ ] Bảng bất biến còn trigger: `UPDATE audit_log SET action = action` phải báo lỗi (`bang audit_log chi cho phep INSERT`).
- [ ] Đăng nhập Super admin + 2FA được (kiểm `FIELD_ENC_KEY` đúng: trang Cài đặt > SePay hiện được số tài khoản giải mã).
- [ ] `outbox` không có `dead`; hàng đợi sự kiện chảy (RUNBOOK 4.1).
- [ ] Thiết bị mô phỏng gửi heartbeat và nhận manifest (`tools/sim`); chiến dịch đang chạy vẫn đúng trạng thái.
- [ ] Gửi thử webhook SePay (sandbox hoặc "Gửi thử"): nhận `{"success":true}`, gửi lặp không cộng hai lần.
- [ ] Media đã tải xem được (R2 hoặc volume `mediadata` còn đủ tệp).

## 6. Rủi ro tồn đọng (cần chốt trước go-live)

1. Đã có công cụ sao lưu mã hóa D1 và sidecar VPS nhưng **chưa chạy với D1/R2/rclone thật**; chưa có lịch tự động ở Cloudflare (Actions `schedule`); sao chép R2 vẫn chưa có.
2. Chưa có WAL/PITR cho Postgres; RPO Docker/hạ tầng riêng bằng chu kỳ sao lưu.
3. Chưa có cách khôi phục Analytics Engine; chứng cứ impression cần kho cuối cùng bền vững.
4. `FIELD_ENC_KEY` không có phiên bản/xoay vòng (RUNBOOK 4.5): lộ khóa là sự cố nghiêm trọng khó xử lý.
5. Đã có số đo trên container phát triển (mục 7) nhưng **chưa có số đo production/staging thật**. Hoàn thành ít nhất một lần diễn tập trên staging Cloudflare hoặc VPS thật trước go-live.
7. Mất `BACKUP_ENC_KEY` = mọi bản sao lưu mã hóa vô dụng; khóa phải cất riêng, có bản dự phòng do người thứ hai giữ.
8. Quay lui VPS về Cloudflare không có công cụ ngược (Postgres sang D1): xem `MIGRATE-CF-TO-VPS.md` mục 6.
6. Bản sao audit có object lock: chưa làm.

## 7. Kết quả diễn tập

| Ngày | Môi trường | Người làm | Kịch bản | RPO đo được | RTO đo được | Đạt/không | Việc phát sinh |
|---|---|---|---|---|---|---|---|
| 2026-11-12 | Postgres 16 nhúng (không Docker), dữ liệu seed | Tác nhân soạn tài liệu (o1-runbook) | `backup` + `verify` + `restore` vào DB mới và tại chỗ sau khi làm hỏng `customers.short_name`, `devices.blocked` | Không đo (chạy tay) | Vài giây cho DB ~13 MB (chưa đại diện) | Đạt ở mức script; ví lệch 0, trigger 3/3, SHA-256 phát hiện tệp hỏng | Chưa thử Docker thật, PowerShell, Cloudflare |
| 2026-11-14 | **Container phát triển, KHÔNG phải production** (Postgres 16 nhúng, 1 máy, đĩa cục bộ, không mạng) | Tác nhân p3-ops | `drill dev` quy mô nhỏ: 20.460 dòng, bản xuất 3,4 MB. Postgres: sao lưu mã hóa, khôi phục vào DB tạm, so khớp | RPO 425 ms (khoảng từ lúc chụp bản sao lưu tới lúc giả lập sự cố; phần ghi trong khoảng này bị mất, đúng kỳ vọng) | RTO 1,6 s (khôi phục 1,5 s). Kịch bản d1-sql (nạp SQL xuất D1 vào SQLite): 2,8 s | Đạt: số dòng, checksum sổ cái, tổng ví, trigger bất biến khớp | Chuyển D1 sang Postgres: 2,7 s |
| 2026-11-14 | **Container phát triển, KHÔNG phải production** (như trên) | Tác nhân p3-ops | `drill dev` quy mô lớn: **300.480 dòng, 75 bảng, bản xuất 49,2 MB**, sổ cái 107 dòng. Postgres: dump 2.591 KB mã hóa, khôi phục vào DB tạm | RPO 576 ms (cùng định nghĩa; đánh dấu ghi "trước" sao lưu có mặt, "sau" vắng mặt đúng kỳ vọng) | **RTO 3,3 s** (khôi phục 3,2 s + kiểm 98 ms); d1-sql: 2,8 s (kiểm 9 ms). Tổng thời gian chạy 31 s | Đạt: checksum `wallet_entries` khớp, trigger bất biến còn nguyên | Chuyển D1 sang Postgres 300k dòng: **13,9 s**, COMMIT sau khi mọi so khớp đạt |

> **Cách đọc các số trên.** Đo trên máy phát triển, đĩa cục bộ, **không có độ trễ mạng, không có tải đồng thời, không mã hóa đĩa của nhà cung cấp, không rclone/B2.** RPO ở đây là độ trễ kỹ thuật của một lần sao lưu, **không phải** RPO vận hành (RPO vận hành = chu kỳ sao lưu, mặc định 6 giờ trên VPS, trừ khi có PITR). RTO ở đây chỉ gồm giải mã + `pg_restore` + kiểm, **không** gồm: phát hiện sự cố, tải bản sao từ nơi lưu ngoài, dựng hạ tầng, trỏ lại DNS, thao tác của con người. Ước lượng RTO production phải đo lại bằng `scripts/ops.sh drill-pg` trên VPS thật với dữ liệu thật. Dữ liệu 300k dòng nhỏ hơn nhiều so với production (hàng chục triệu dòng `ev_*`).
