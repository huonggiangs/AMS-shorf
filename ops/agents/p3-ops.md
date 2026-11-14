STATUS: done
UPDATED: 2026-11-14T13:00Z (hoan tat; cac muc "chua lam duoc" ben duoi can nguoi that / ha tang that)

# p3-ops: tin cậy và vận hành (cảnh báo, trang trạng thái, sao lưu/khôi phục, trực sự cố, chuyển CF -> VPS)

- [x] migration 0009_ops.sql (commit 596df8a)
- [x] ops checks + notifier + route admin + /status (`services/api/src/ops`, `routes/ops.ts`; 9 test trên Postgres và SQLite)
- [x] web-admin: /status công khai, trang Cảnh báo (61/61 test web)
- [x] script sao lưu/khôi phục D1 + Postgres, .bat/.ps1 (`tools/ops`, `scripts/ops.sh`; `.ps1` CHƯA chạy vì không có PowerShell)
- [x] script D1 -> Postgres, kiểm trên sqlite + embedded-postgres (300k dòng, COMMIT sau khi khớp)
- [x] VPS kit: `infra/vps/` (compose đã `config -q`; chưa chạy `up` vì không có daemon Docker)
- [x] docs: ONCALL, MIGRATE-CF-TO-VPS, EMAIL-SETUP, cập nhật DR (mục 7 có số đo, ghi rõ là container dev), RUNBOOK, COMMERCIAL-READINESS
- [x] mail-http: thêm Brevo + Mailgun, có test (8)

## Chưa làm được (cần người/hạ tầng thật)
- Gửi email thật; đặt SPF/DKIM/DMARC; kênh Telegram/Zalo thật; uptime ngoài; Sentry
- Chạy với D1 thật (`wrangler d1 export/execute`), R2, rclone, Docker `up`, VPS, DNS
- Điền liên hệ/lịch trực thật trong ONCALL.md (đang là `<ĐIỀN>`)
- Không có công cụ Postgres -> D1 (quay lui sau cắt chuyển là thủ công)
