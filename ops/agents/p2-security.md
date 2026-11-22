STATUS: done
UPDATED: 2026-11-22T00:00Z

# p2-security

Checklist
- [x] R1-16 payments: giới hạn ghi webhook bị từ chối, cắt 2 KB, prune 14 ngày, che + mã hóa accountNumber trong payload lưu (test pg+sqlite)
- [x] R1-14 bảng creative_security (0008), content_version, approved_version/hash, 409 content_changed ở media approve và duyệt chiến dịch
- [x] R1-10 (một phần) khóa mới sau confirm, xóa tệp bị từ chối
- [x] R1-19 đăng nhập: 401 đồng nhất khi khóa, bộ đếm email gắn IP
- [x] R1-21 scrypt 2^16/p=2 + tự nâng cấp hash khi đăng nhập
- [x] R1-24 Secure theo AMS_ENV, cookie MFA SameSite=Strict
- [x] R1-20 (payments actor), R1-26 (verify cần devices:approve), R1-17 (dashboard)
- [x] R1-05/06/11/15: xác minh đã sửa trước đó (w1/w4/x3)
- [x] kid_safe: cột có cấu trúc (N5), lock_ads_enabled mặc định tắt, chặn ở đặt ngữ cảnh/duyệt, xác nhận khi bật
- [ ] kid_safe lúc xây manifest: cần chủ gateway (xem p2-security.requests.md)
- [x] cổng tuân thủ nội dung: campaign_gate, submit bắt buộc xác nhận quyền, hàng chờ hiển thị
- [x] pnpm audit: 130 -> 36, phần còn lại ghi trong docs/reviews/R6-SECURITY-FIXES.md
- [x] test: api 263, payments 147, shared 51, db 4, web-admin 59 (+build), edge-gateway 61 (hono bump); openapi drift cần chạy lại generate sau khi mọi agent xong (do route p5 + dòng nguồn)

## p2-rest (2026-11-22)
- [x] Xoay khóa FIELD_ENC_KEY (key id v2, vòng khóa, FIELD_INDEX_KEY), job/CLI/route reencrypt, SESSION_SECRET_PREV (docs/ops/KEY-ROTATION.md)
- [x] `__Host-` cookie theo env; tiêu đề bảo mật API + web-admin (_headers, nginx snippet); rate limit mfa/enroll, manifest công khai, viewer; TRUST_PROXY gateway; CORS viewer; log redaction; quét bí mật; audit 27 -> 9
- [ ] Mở: chuỗi băm audit, R1-18/22/23/25/29, R1-17 còn lại, zod4/react-router7 (xem docs/reviews/R7-SECURITY-CLOSEOUT.md)
