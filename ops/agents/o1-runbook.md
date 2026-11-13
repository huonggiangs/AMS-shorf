STATUS: done
UPDATED: 2026-11-12
Đã làm: docs/ops/{RUNBOOK,DISASTER-RECOVERY,PENTEST-PLAN,RELEASE-CHECKLIST}.md; scripts/backup-postgres.{sh,ps1} (backup|verify|restore|list, chế độ docker mặc định, --direct).
Kiểm chứng thật: backup-postgres.sh --direct trên Postgres 16 nhúng (seed 49 bảng): backup + giữ --keep, verify (SHA-256, khôi phục thử, ví lệch 0, trigger 3/3), phát hiện tệp hỏng, restore vào DB mới và ghi đè tại chỗ sau khi làm hỏng dữ liệu, migrate idempotent sau restore. Chế độ docker chỉ thử với lớp giả lập `docker` (không phải Docker thật). SQL/LMOVE trong runbook chạy thật trên Postgres/redis-server.
Chưa chạy thật: backup-postgres.ps1 (không có pwsh), Docker, wrangler/D1 Time Travel/R2/ClickHouse BACKUP, GitHub Actions.
Khoảng trống phát hiện: ev_* không có retention (Postgres/D1); FIELD_ENC_KEY không có xoay vòng/phiên bản; /health không kiểm DB; DLQ Cloudflare chưa có script phát lại; gateway chưa có luật WAF; D1 finance/audit trống.
