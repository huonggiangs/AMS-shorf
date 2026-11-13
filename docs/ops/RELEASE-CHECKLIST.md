# AMS: danh sách kiểm tra phát hành (release)

Dùng cho mỗi bản phát hành lên staging rồi production. Đánh dấu từng dòng, ghi người và giờ. Quy trình triển khai chi tiết: `docs/DEPLOY-CLOUDFLARE.md`; sự cố: `docs/ops/RUNBOOK.md`; khôi phục: `docs/ops/DISASTER-RECOVERY.md`.

> Các bước Cloudflare/GitHub Actions chưa từng chạy thật trong môi trường soạn tài liệu (không có tài khoản). Lần phát hành đầu tiên lên staging cũng là lần kiểm chứng quy trình này; ghi lại mọi sai lệch và sửa tài liệu.

**Quy tắc cứng:** staging đạt toàn bộ trước khi làm production; không phát hành production vào giờ cao điểm hoặc ngay trước cuối tuần/ngày lễ; luôn có người thứ hai biết; có sẵn đường lui trước khi bắt đầu.

Thông tin phát hành: Phiên bản/tag: ______ Người phát hành: ______ Người duyệt (CTO): ______ Giờ bắt đầu (UTC+7): ______

## 1. Trước khi gắn tag (mã)

- [ ] Phạm vi bản phát hành đã chốt; danh sách thay đổi (commit/PR) đã được rà soát. Không có việc dở, không có mã tạm.
- [ ] `pnpm install --frozen-lockfile` sạch (lockfile ở gốc, `pnpm-lock.yaml` đã commit).
- [ ] `pnpm -r typecheck` sạch (cổng chính, PLAN §7).
- [ ] `pnpm -r test` xanh (gồm test đua tiền, webhook SePay trùng 5 lần chỉ cộng 1, IDOR; PLAN §7).
- [ ] CI trên nhánh phát hành xanh (`.github/workflows/ci.yml`: typecheck + test, `docker compose config`, build image từng dịch vụ).
- [ ] `docker compose -f infra/docker/docker-compose.yml config -q` hợp lệ (cả có và không có `.env`).
- [ ] Nếu đụng auth, ví, tải tệp, gateway, RBAC: các hạng mục P0 liên quan trong `docs/ops/PENTEST-PLAN.md` đã được chạy lại hoặc test tự động tương ứng đã xanh.
- [ ] Quét phụ thuộc: `pnpm audit --prod` (hoặc `osv-scanner`), không có CVE cao/nghiêm trọng chưa xử lý. (CI chưa tự quét CVE: kiểm tay.)
- [ ] Không có bí mật trong thay đổi (`gitleaks detect`, hoặc xem diff); `.env`, `ids.*.json`, `*.tfstate` không bị commit.
- [ ] Chế độ an toàn: không bật endpoint dev ngoài Docker local: `GATEWAY_DEV_ENDPOINTS` mặc định 0, chỉ `1` khi `AMS_ENV=local` (service `env-guard` của compose từ chối nếu khác), không đặt/không bằng `1` trên Cloudflare; không còn giá trị `change-me*`/`CHANGE_ME*` trong `.env`; `CLAMAV_REQUIRED=1`; `/dev/sepay/simulate` chỉ khi `RUNTIME=docker` và `SEPAY_MODE != production`.
- [ ] Tài liệu cập nhật nếu đổi hành vi (API, cấu hình, biến môi trường); `.env.example` đủ biến mới.

## 2. Cơ sở dữ liệu và migration

- [ ] Có migration mới? Nếu có (`packages/db/migrations/NNNN_*.sql`, kèm `.postgres.sql`/`.sqlite.sql` nếu khác dialect):
  - [ ] Chạy sạch trên cả Postgres (pglite) và SQLite (`node:sqlite`) trong test (`@ams/db`).
  - [ ] **Tương thích ngược**: chỉ thêm cột/bảng/chỉ mục; không xóa/đổi tên/đổi kiểu cột mà mã cũ còn dùng (để quay lui mã không hỏng dữ liệu; DEPLOY-CLOUDFLARE mục 8.2). Xóa cột phải đi hai bản phát hành (ngừng dùng, rồi mới xóa).
  - [ ] Không làm hỏng bất biến: không đụng trigger chặn UPDATE/DELETE của `audit_log`, `wallet_entries`, `wallet_ledger`.
  - [ ] Thời gian chạy trên dữ liệu cỡ production đã ước tính (bảng lớn `ev_*`: thêm chỉ mục có thể chậm, khóa bảng).
  - [ ] Đã thử trên bản sao dữ liệu thật hoặc bản khôi phục: `scripts/backup-postgres.sh restore <tệp> --target-db ams_trial` rồi `DATABASE_URL=... pnpm --filter @ams/api migrate`.
- [ ] Đã quyết định đường lui dữ liệu (mục 6) và ghi `T_trước` (giờ UTC ngay trước deploy, dùng cho D1 Time Travel).

## 3. Cấu hình và bí mật

- [ ] Secret mỗi môi trường đủ và **khác nhau giữa staging và production**: `SESSION_SECRET`, `FIELD_ENC_KEY`, `SEPAY_WEBHOOK_SECRET` (bắt buộc); `R2_*` (presigned URL); cấu hình gửi thư (nếu cần thư mời/kích hoạt). Script deploy kiểm thiếu secret bắt buộc và từ chối deploy.
- [ ] `FIELD_ENC_KEY` đã được lưu bản sao an toàn (DR mục 2.6). **Không** đổi `FIELD_ENC_KEY` trong lúc phát hành (không có cơ chế mã hóa lại).
- [ ] Biến theo môi trường đúng trong `infra/cloudflare/*/wrangler.toml`: staging `SEPAY_MODE = "sandbox"`, production `SEPAY_MODE = "production"`; tên miền đúng (`ams.anio.vn`, `gw-ams.anio.vn`; staging `ams-stg`, `gw-ams-stg`).
- [ ] Nếu đổi hạ tầng (Terraform, rate-limit WAF): đã `terraform plan` và xem kết quả; gói Free chỉ cho 1 luật rate-limit mỗi zone (DEPLOY-CLOUDFLARE mục 4).
- [ ] Token Cloudflare còn hạn và đúng quyền tối thiểu (DEPLOY-CLOUDFLARE mục 3).
- [ ] Cấu hình SePay: URL webhook và khóa khớp môi trường (staging sandbox, production thật).

## 4. Staging

Phát hành: gắn tag `vX.Y.Z-rc.N` (workflow `Deploy Cloudflare` tự chạy cho staging) hoặc chạy tay: `node scripts/deploy-cloudflare.mjs --env staging --dry-run`, rồi bỏ `--dry-run`. Script chạy: preflight, resources, build, **sao lưu D1 core**, migrate, secrets, deploy, domains, smoke.

- [ ] `--dry-run` sạch; lần chạy thật hiện `OK .../api/health -> 200` cho API và gateway.
- [ ] Kiểm tra sau deploy: toàn bộ danh sách DEPLOY-CLOUDFLARE mục 7 (đăng nhập + 2FA, tải ảnh lên R2, thiết bị giả lập online, rate limit 429, **SePay sandbox cộng ví đúng một lần**, `/dev/sepay/simulate` trả 404, audit log).
- [ ] `pnpm e2e:smoke` (nếu trỏ được vào staging) hoặc chạy kịch bản duyệt chiến dịch → nạp tiền → tự kích hoạt bằng tay.
- [ ] Quan sát 30 phút: Worker logs không có lỗi lặp lại; backlog Queue về 0; không có thông báo `reconcile_mismatch`.
- [ ] Nếu có migration: số dòng bảng liên quan hợp lý; thử quay lui mã (`--rollback`) trên staging và xác nhận hệ thống vẫn chạy với schema mới (kiểm tra tương thích ngược).
- [ ] Người duyệt (CTO) xác nhận staging đạt: ______

## 5. Production

Điều kiện: staging đạt (mục 4), người duyệt đồng ý, ngoài giờ cao điểm, có người trực.

- [ ] Thông báo trước cho các bên liên quan (nếu có tác động); chuẩn bị nội dung thông báo sự cố.
- [ ] **Sao lưu thủ công trước khi làm** (ngoài bản export tự động của script): `npx wrangler d1 export ams-core-production --remote --output backups/prod-<UTC>/core.sql --env production -c infra/cloudflare/api/wrangler.generated.toml`; ghi bookmark Time Travel hiện tại (DR mục 2.2); lưu bản sao ngoài Cloudflare.
- [ ] Gắn tag `vX.Y.Z` (không có dấu `-`); workflow dùng Environment `production` với **Required reviewers**. Hoặc chạy tay: `node scripts/deploy-cloudflare.mjs --env production --dry-run` rồi thật (script hỏi gõ chữ `production`).
- [ ] Preflight đạt; secret bắt buộc đủ; migration áp xong không lỗi.
- [ ] Smoke: `https://ams.anio.vn/api/health` 200, `https://gw-ams.anio.vn/health` 200, `https://ams.anio.vn/` hiện trang đăng nhập.
- [ ] Kiểm tra chức năng nhanh bằng tài khoản thử/Super admin: đăng nhập + 2FA; xem dashboard thiết bị; **không** tạo dữ liệu thử lẫn dữ liệu khách thật (dùng khách/nhãn thử nếu cần, xóa sau).
- [ ] SePay: bấm "Gửi thử" ở my.sepay.vn nhận `{"success":true}` (không chuyển tiền thật chỉ để thử). Nếu bản phát hành đụng tài chính: chuyển khoản giá trị nhỏ thật, kiểm ví cộng một lần, rồi đối soát.
- [ ] Thiết bị: thiết bị/bộ giả lập mới đăng ký và heartbeat được; thiết bị thật đang online không rớt hàng loạt (so với trước phát hành).
- [ ] Theo dõi 60 phút đầu: log Worker (`wrangler tail`), tỉ lệ 4xx/5xx, backlog Queue (`ams-ingest-production`, DLQ rỗng), `outbox` không có `dead`, độ trễ API (SLO: p95 < 400 ms quản trị, heartbeat p99 < 300 ms; đặc tả mục 13).
- [ ] Sau 24 giờ: kiểm lại các mục trên và đối soát hằng ngày 02:15 UTC sạch (không `reconcile_mismatch`).
- [ ] Ghi vào nhật ký phát hành: tag, commit, giờ, người, kết quả, vấn đề.

## 6. Điều kiện và cách quay lui

Quay lui ngay (không chờ họp) khi: ví lệch/cộng sai tiền, lỗi 5xx kéo dài > 5 phút ở API hoặc gateway, đăng nhập hỏng, thiết bị rớt hàng loạt, webhook SePay bị từ chối hàng loạt, hoặc backlog tăng không kiểm soát.

| Mức | Khi nào | Cách làm |
|---|---|---|
| 1. Quay lui mã | Lỗi do mã mới, schema tương thích ngược | `node scripts/deploy-cloudflare.mjs --env production --rollback` (gateway, api, web về bản liền trước; không đụng dữ liệu) |
| 2. Dừng một phần | Chưa kịp sửa | Dừng nhận tiền tự động (Cài đặt > SePay); `ctl:gateway` giảm tải (RUNBOOK 4.4); gỡ tên miền web (RUNBOOK mục 2) |
| 3. Khôi phục dữ liệu | Migration/mã làm hỏng dữ liệu | D1 Time Travel về `T_trước` (DR mục 2.2, Kịch bản A) rồi quay lui mã; kiểm chứng nghiệp vụ (DR mục 5) |
Sau quay lui: viết báo cáo sự cố (RUNBOOK mục 9), ghi nguyên nhân, sửa rồi phát hành lại từ staging.

## 7. Docker local (khi phát hành bản demo/PC)

- [ ] `make config` hợp lệ; `make build`; `make up`; `make seed` (local: demo) hoặc `make bootstrap` (staging/production: chỉ Super admin, đặt `AMS_ENV` và `BOOTSTRAP_ADMIN_EMAIL`); `make doctor` sạch.
- [ ] `make test` xanh; đăng nhập web admin, nhận thư mời ở Mailpit (http://localhost:8025).
- [ ] Trước khi cập nhật bản đang có dữ liệu: `scripts/backup-postgres.sh backup` rồi `verify`.
- [ ] Sau cập nhật: `pnpm --filter @ams/api migrate` (hoặc `make seed`) chạy sạch; kiểm tra RUNBOOK mục 3.

## 8. Hoàn tất

- [ ] Gắn nhãn phát hành trong kho (ghi chú phát hành: thay đổi chính, migration, thay đổi cấu hình, vấn đề đã biết).
- [ ] Đóng các việc đã xong; mở việc cho vấn đề phát sinh.
- [ ] Cập nhật tài liệu vận hành nếu quy trình thực tế khác tài liệu.
- [ ] Hoàn tất lúc: ______ Người xác nhận: ______
