STATUS: done
UPDATED: 2026-11-13

- Backend: config.ts (api_key/webhook_secret/auth_mode ghi mã hóa, secretStatus che), webhook.ts (Apikey + HMAC song song, hằng thời gian), routes.ts khối settings (PUT + TOTP step-up, đề xuất/duyệt/từ chối đổi tài khoản, test mở rộng), sepay-change.ts (mới).
- UI: apps/web-admin/src/components/SepayConnect.tsx, gắn vào pages/Integrations.tsx.
- Test: services/payments/test/sepay-connect.test.ts, test/stepup.ts; apps/web-admin/src/test/sepay-connect.test.tsx; sửa finance.test.ts cho hai người + TOTP.
- docs/SEPAY.md.
