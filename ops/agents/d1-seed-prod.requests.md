# Yêu cầu của d1-seed-prod cho agent khác

## a1-api-core
1. Thực thi "đổi mật khẩu bắt buộc": nếu có hàng `settings` khóa `force_password_change:<admin_id>` thì sau MFA mọi route (trừ `/auth/me`, `/auth/logout`, endpoint đổi mật khẩu mới) trả 403 `password_change_required`; thêm `POST /auth/password/change {current,new}` kiểm chính sách (>= 12 ký tự, hoa/thường/số), cập nhật hash, xóa hàng cờ, hủy các phiên khác, ghi audit. (Hoặc nếu muốn cột `admins.must_change_password`, cần migration 0005 do f1/p0 sở hữu; seed hiện dùng khóa settings để không đụng migration.)

## f2-infra (scripts/ams.ps1, Makefile, compose, .env.example, Dockerfile)
1. `.env.example`: thêm `AMS_ENV=local`, `SEED_MODE=` (trống), `AMS_ALLOW_DEMO_SEED=0`, `BOOTSTRAP_ADMIN_EMAIL=`, `BOOTSTRAP_ADMIN_PASSWORD_FILE=` (và ghi chú: không đặt mật khẩu bootstrap trong `.env` production). Compose `migrate-seed` truyền `AMS_ENV, SEED_MODE, AMS_ALLOW_DEMO_SEED, BOOTSTRAP_ADMIN_*, SEPAY_MODE` (hiện chỉ truyền SEED_ADMIN_*). Dockerfile `migrate` target: lệnh `seed` không tham số đã tự chọn chế độ (local -> demo, khác -> bootstrap) nên không phải đổi, chỉ cần truyền env.
2. `scripts/ams.ps1` và Makefile: `seed` = `$mode = node scripts/setup.mjs seed-mode` (mã thoát 3 thì dừng) rồi `docker compose ... run --rm -e SEED=1 -e SEED_MODE=$mode migrate-seed`; chỉ gọi `creds` khi mode=demo/local. Thêm lệnh `bootstrap` = `-e SEED_MODE=bootstrap`. Với AMS_ENV khác local, `seed` mặc định là bootstrap.
3. `.gitignore` (nếu f2 sở hữu): `.env.*` đã che `.env.local-credentials`; không cần thêm.
4. CI/production deploy: gọi `node scripts/setup.mjs check-env` (đã thêm kiểm AMS_ENV và SEPAY production).
