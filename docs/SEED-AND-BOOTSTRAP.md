# Seed và bootstrap: tách dữ liệu demo khỏi cài đặt production

Mục tiêu nghiệm thu "không còn dữ liệu demo ở production". Hai chế độ, mã ở `packages/db/src/seed*.ts`, CLI `services/api/src/cli/seed.ts`.

## 1. Hai chế độ

| | `bootstrap` (production/staging) | `demo` (local) |
|---|---|---|
| Tạo | tenant, cài đặt mặc định (`sepay` TẮT, `seller`, `bootstrap`), quy tắc kích hoạt (không tự kích hoạt), mẫu hợp đồng, **một** Super admin, một dòng audit | toàn bộ dữ liệu prototype: khách hàng, hợp đồng, chiến dịch, thiết bị, ví/tiền mẫu, người dùng mẫu... |
| Không tạo | khách hàng, chiến dịch, thiết bị, hợp đồng, ví/tiền, creative, địa điểm, đối tác, nhật ký mẫu | (đầy đủ) |
| Vai trò/quyền | nằm trong mã (`packages/config/rbac.ts`), không cần nạp bảng | như trên |
| Chạy ở production | được | **bị từ chối** (mã thoát 3) trừ khi `AMS_ALLOW_DEMO_SEED=1` |

Cả hai đều idempotent: đã có `tenants` thì bỏ qua.

## 2. Biến môi trường

- `AMS_ENV`: `local` | `test` | `staging` | `production` (alias dev/prod/stg). Không đặt: `local`, trừ `RUNTIME=cloudflare|k8s` thì coi là `production` (an toàn trước). `NODE_ENV` **không** được dùng (compose local đặt `NODE_ENV=production`).
- `SEED_MODE`: `bootstrap` | `demo`. Mặc định: local/test -> demo, còn lại -> bootstrap. Tham số dòng lệnh thắng: `pnpm --filter @ams/api seed bootstrap`.
- `AMS_ALLOW_DEMO_SEED=1`: cho phép seed demo ở staging/production (vd. staging dùng demo khách). Khi dùng, mật khẩu vẫn không bị in/log.
- Bootstrap: `BOOTSTRAP_ADMIN_EMAIL` (bắt buộc ngoài local, không được là email mẫu `.local/.example`), mật khẩu ban đầu qua `BOOTSTRAP_ADMIN_PASSWORD` | `BOOTSTRAP_ADMIN_PASSWORD_FILE` (docker secret) | nhập ẩn khi được hỏi (TTY, nhập hai lần). Chính sách: >= 12 ký tự, có hoa/thường/số, không phải giá trị mẫu. `BOOTSTRAP_TENANT_NAME`, `BOOTSTRAP_TENANT_TAX_CODE` tùy chọn.
- Local: bootstrap/seed còn đọc `SEED_ADMIN_EMAIL/PASSWORD/TOTP_SECRET` (tương thích `.env` do `scripts/setup.mjs` sinh).
- `FIELD_ENC_KEY` luôn bắt buộc (32 byte base64); ở staging/production **không** được là khóa test hay còn `CHANGE_ME`.

## 3. Super admin đầu tiên

Tạo với `totp_secret_enc = NULL`, `mfa_required = 1`, và khóa `settings.force_password_change:<admin_id>`.
- Đăng nhập lần đầu trả `mfa_enroll_required` -> phải đăng ký TOTP (đã hoạt động ở `/auth/mfa/enroll`, có test).
- Đổi mật khẩu bắt buộc: seed chỉ ghi cờ; việc chặn phiên cho đến khi đổi mật khẩu và xóa cờ thuộc `a1-api-core` (xem `ops/agents/d1-seed-prod.requests.md`). Cho đến khi a1 làm, cờ **chưa được thực thi** ở API.
- Mật khẩu **không bao giờ** vào log. Local và không cung cấp mật khẩu: tự sinh, ghi một lần vào `.env.local-credentials` (0600, đã bị `.gitignore` qua `.env.*`; đổi đường dẫn bằng `AMS_LOCAL_CREDS_FILE`) và chỉ in đường dẫn. Production không tự sinh: thiếu mật khẩu thì từ chối.

## 4. SePay

`SEPAY_MODE` mặc định `mock` (local). Bị từ chối (cả bootstrap và demo): `AMS_ENV=production` với `mock`; `SEPAY_MODE=production` với `SEPAY_WEBHOOK_SECRET` yếu/mẫu (< 32 ký tự, bắt đầu `test|mock|change-me|secret|example|dummy|placeholder|password|sepay`, chứa `CHANGE_ME`) hoặc `SEPAY_API_KEY` mẫu. Bootstrap lưu `sepay.enabled=0`, `auto_activate=0`, chưa có số tài khoản/ngân hàng: nhập ở Cài đặt > SePay. Bí mật webhook chỉ từ biến môi trường, không ghi vào CSDL.

## 5. Lệnh

```
# local
pnpm --filter @ams/api seed            # = demo (AMS_ENV mặc định local)
pnpm --filter @ams/api seed bootstrap  # Super admin tối thiểu, không demo
node scripts/setup.mjs seed-mode       # in "demo" | "bootstrap"; mã 3 nếu yêu cầu demo bị từ chối

# production / staging (Docker hoặc CI)
AMS_ENV=production BOOTSTRAP_ADMIN_EMAIL=owner@congty.vn BOOTSTRAP_ADMIN_PASSWORD_FILE=/run/secrets/admin_pw \
  pnpm --filter @ams/api seed bootstrap
```

`scripts/setup.mjs`: `check-env` thêm kiểm `AMS_ENV`, SEPAY production/mock; `creds` và `totp` chỉ chạy ở local; `seed-mode` ở trên. Quy ước `ams.ps1`/Makefile: `seed` gọi `seed-mode` rồi chạy `SEED_MODE=<kết quả>`; `bootstrap` = `SEED_MODE=bootstrap`. Việc nối vào `ams.ps1`, Makefile, compose, `.env.example` thuộc f2-infra (đã ghi yêu cầu); đến khi đó chạy tay lệnh `pnpm` ở trên.

## 6. Kiểm chứng

`services/api/test/seed-modes.test.ts` (cả postgres/pglite và sqlite): bootstrap không có dòng nào ở bảng demo, 1 Super admin, TOTP chưa đăng ký, đăng nhập trả `mfa_enroll_required`, mật khẩu không vào log; demo chạy được ở local; demo bị từ chối ở production/staging mà CSDL không bị ghi; `AMS_ALLOW_DEMO_SEED=1` cho phép; từ chối SEPAY mock ở production, bí mật mock ở SEPAY production, khóa test, mật khẩu thiếu/yếu, email mẫu; `setup.mjs seed-mode`. Test cũ `packages/runtime/test/seed.test.ts` vẫn xanh (seed = demo ở local/test).

## 7. Còn lại

- Thực thi cờ đổi mật khẩu bắt buộc trong API (a1).
- Chưa chạy thật trên container Docker và Postgres thật (chỉ pglite/node:sqlite); `ams.ps1`/Makefile/compose chưa nối.
- Dữ liệu demo còn tồn tại trong repo (`seed-data.gen.ts`) vì cần cho local/test; production không nạp nó nhưng gói bundle vẫn chứa. Nếu cần loại khỏi bundle production, tách import động (đề xuất, chưa làm).
