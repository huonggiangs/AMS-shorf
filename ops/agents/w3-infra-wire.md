STATUS: done
UPDATED: 2026-11-13
Compose: +media-worker, +clamav (core, limit, healthcheck, clamdata), +env-guard (chặn change-me/CHANGE_ME và dev endpoints ngoài AMS_ENV=local), GATEWAY_DEV_ENDPOINTS mặc định 0, AMS_ENV vào app-env, migrate-seed nhận SEED_MODE/AMS_ALLOW_DEMO_SEED/BOOTSTRAP_*, MinIO bucket media riêng tư + chỉ tiền tố MINIO_PUBLIC_PREFIXES (mặc định renditions).
Makefile/ams.ps1: seed qua seed-mode (mã 3 dừng), bootstrap mới. .env.example cập nhật. CI matrix thêm media-worker. DEPLOY-CLOUDFLARE mục 9, docs/ops sửa nhỏ.
Kiểm chứng: docker compose config -q (có/không .env, mọi profile) OK; ma trận CI khớp compose; env-guard chạy thử bằng sh 3 tình huống; make -n; setup.mjs seed-mode; pnpm install --frozen-lockfile OK (lock đã đủ).
Chưa: docker build/up thật, ams.ps1 chưa chạy (không có pwsh).
