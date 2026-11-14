# R6 Sửa lỗi bảo mật / tuân thủ (agent p2-security)

Ngày: 2026-11-14. Nối tiếp R1 (rà soát bảo mật), R4 (N5), COMMERCIAL-READINESS P0-4, P0-7, P0-12, P1-10. Phạm vi sửa: `services/api`, `services/payments`, `packages/shared`, `apps/web-admin`, migration `0008_security_compliance.sql`. Không sửa `services/edge-gateway`, `packages/runtime` (thuộc agent khác): phần cần họ nằm ở mục 5.

## 1. Trạng thái từng mục R1

| Mục | Trạng thái | Ghi chú / bằng chứng |
|---|---|---|
| R1-01 2FA nội bộ | ĐÃ SỬA (x1) | `users.ts` invite `mfa_required=1`; `security-x1.test.ts`. |
| R1-02 đổi tài khoản nhận tiền | ĐÃ SỬA (trước p2) | `payments/src/sepay-change.ts` + `routes.ts`: đề xuất/duyệt hai người, step-up TOTP, thông báo tài chính. |
| R1-03 quét/transcode | ĐÃ SỬA phần API + gateway (x1, w1) | gateway chỉ phát `scan_state='clean'`; API `assertScanOk` ở approve media/chiến dịch; `enqueueMediaUploaded` khi confirm. CÒN MỞ: bucket công khai/`CLAMAV_REQUIRED` (hạ tầng, ngoài mã API). |
| R1-04 trần impression | ĐÃ SỬA (x1) | `kv.incr` từng sự kiện. Trên Cloudflare phụ thuộc R1-12. |
| R1-05 mail làm hỏng kích hoạt | ĐÃ SỬA (trước p2, xác minh lại) | thư chào đi qua outbox `mail.send` (ngoài giao dịch); `sweepActivations` chạy lại kích hoạt; `activation.ts` idempotent. |
| R1-06 cộng kép xác nhận tay | ĐÃ SỬA (w4, xác minh lại) | `ledger.ts creditTopup`: giữ `manual:possible_double_credit` khi trùng topup đã xác nhận tay; webhook trả `manual:possible_double_credit`. |
| R1-07 escalation | ĐÃ SỬA (x1) | `guardEscalation` kiểm cả quyền mặc định của vai trò. |
| R1-08 customers:approve | ĐÃ SỬA (x1) | |
| R1-09 body gateway | ĐÃ SỬA (x1) | |
| R1-10 presign không giới hạn/tái dùng | ĐÃ SỬA MỘT PHẦN (p2) | `media.ts`: sau confirm, tệp <= 128 MB được chép sang khóa mới `media/<kh>/<id>/v1-<tên>` rồi xóa khóa tải lên (URL ký còn hạn không đổi được nội dung đã băm/duyệt); tệp bị từ chối khi confirm bị xóa khỏi kho; `sha256Of` không còn ném lỗi (x1). CÒN MỞ: presign S3/R2 chưa ràng `content-length-range` (`packages/runtime/s3.ts`, `r2.ts`, agent runtime) và băm streaming cho tệp > 128 MB (media-worker); với tệp lớn thiết bị vẫn đối chiếu sha256 khi tải. |
| R1-11 release trước transition | ĐÃ SỬA (w1, xác minh lại) | `campaigns.ts`: đổi trạng thái TRƯỚC, hoàn tiền qua outbox `campaign.release` trong cùng giao dịch; `w1-wiring.test.ts`. |
| R1-12 KV incr không nguyên tử | CÒN MỞ (agent p5) | `packages/runtime/src/cloudflare/kv.ts`; p5 đang làm (migration 0011 bộ đếm). |
| R1-13 dev backdoor/secret | ĐÃ SỬA (x1) | |
| R1-14 duyệt gắn phiên bản nội dung | ĐÃ SỬA (p2) | Bảng `creative_security` (0008): `content_version` tăng khi đổi overlay/định dạng (mọi người sửa); `approved_version/approved_hash` ghi khi duyệt (media approve, duyệt chiến dịch, người duyệt tự sửa trong tv-experience). `POST /media/:id/approve` nhận `content_version`: lệch => 409 `content_changed`; kiểm lại trong giao dịch. Duyệt chiến dịch: nội dung creative đổi giữa lúc đọc và lúc duyệt => 409. Khách sửa tệp đã duyệt => về chờ duyệt (đã có). Audit lưu version + hash. Test `p2-security.test.ts`. |
| R1-15 D1 không nguyên tử | ĐÃ SỬA PHẦN LỚN (w4) | `reconcile-atomic.ts` (batch nguyên tử + sweeper). CÒN MỞ nhỏ: `undoActivation` marker không UNIQUE, `enqueueCommand` đếm mở không nguyên tử (gateway, p5). |
| R1-16 webhook lưu mọi request, số tài khoản rõ | ĐÃ SỬA (p2) | `webhook.ts`: giới hạn trước khi ghi DB (10/phút/IP, 60/phút toàn hệ thống, vượt thì chỉ tăng bộ đếm KV `wh:rej:dropped:*`), cắt 2 KB, che số dài; `pruneRejectedWebhooks` (14 ngày) trong job hằng ngày. Payload nhận hợp lệ lưu `accountNumber` che 4 số cuối + `accountNumber_enc` (AES-GCM, AAD `payment_webhooks.accountNumber`, khóa `FIELD_ENC_KEY`). Test `payments/test/p2-security.test.ts` (pg + sqlite). |
| R1-17 dữ liệu tài chính cho vai trò khác | ĐÃ SỬA MỘT PHẦN (p2) | dashboard overview: doanh thu/chi phí thưởng/`revenue_split` chỉ khi có `finance:view`. CÒN MỞ: `customers` (tax_code, credit_limit, debt cho `customers:view`) và `partners` (floor CPM) vì cần quyết định chính sách che từng trường. |
| R1-18 HMAC 2 định dạng | CÒN MỞ | chờ xác nhận định dạng SePay thật. |
| R1-19 đăng nhập lộ tồn tại/khóa hộ | ĐÃ SỬA (p2) | `auth/routes.ts`: luôn băm mật khẩu trước, tài khoản đang khóa trả 401 `invalid_credentials` y hệt (không 429/Retry-After riêng, không cộng dồn thất bại); bộ đếm email gắn với IP (không thể cạn bộ đếm của nạn nhân từ IP khác). Test `p2-security.test.ts`, `auth.test.ts` cập nhật. |
| R1-20 IP tin cậy | ĐÃ SỬA MỘT PHẦN (p2) | payments `actor.ts` tôn trọng `TRUST_PROXY=0`. API đã có. CÒN MỞ: gateway `util.ts` (p5). Triển khai: chỉ đặt cổng sau Caddy/Cloudflare hoặc `TRUST_PROXY=0`. |
| R1-21 mật mã | ĐÃ SỬA MỘT PHẦN (p2) | scrypt mặc định 2^16, r=8, p=2 (OWASP, vẫn < 128 MB bộ nhớ của Workers); hash cũ xác minh được và tự nâng cấp khi đăng nhập đúng (`passwordNeedsRehash`). CÒN MỞ: AES-GCM không có key id/AAD cố định và dùng chung `FIELD_ENC_KEY` cho blind index (cần migration mã hóa lại + quy trình xoay khóa, P1-10). |
| R1-22 SSRF import | CÒN MỞ (tiềm ẩn) | chưa có mã tải `source_url`; phải chặn khi viết downloader. |
| R1-23 đối tác tạo chiến dịch mồ côi | CÒN MỞ | cần quyết định nghiệp vụ. |
| R1-24 cookie | ĐÃ SỬA MỘT PHẦN (p2) | `Secure` bắt buộc khi `AMS_ENV` staging/production hoặc URL https (`COOKIE_SECURE=0` chỉ cho dev); cookie MFA `SameSite=Strict`. CÒN MỞ: tiền tố `__Host-` (đổi tên cookie ảnh hưởng web-admin/e2e). |
| R1-25 hoàn tiền một vai trò | CÒN MỞ | |
| R1-26 device_ops tự verify trust 2 | ĐÃ SỬA (p2, chính sách) | `POST /devices/bulk verify` cần `devices:approve` (mặc định chỉ super_admin). block/unblock giữ `devices:write`. |
| R1-27, R1-28 | MỘT PHẦN (x1) | |
| R1-29 kiểm tra accountNumber khi thiếu | CÒN MỞ | |

## 2. Chính sách kid_safe / trẻ em (P0-7): mặc định an toàn

Quyết định mã hóa: nhánh (a) của P0-7. Quảng cáo ở màn khóa / màn hình trẻ em **tắt mặc định** (`settings.tv_experience.lock_ads_enabled=false`, thiếu/hỏng => tắt).

| Chỗ cưỡng chế | Trạng thái |
|---|---|
| Đặt ngữ cảnh `lock` (`PUT /tv-experience/creatives/:id`) | ĐÃ LÀM: 422 `lock_ads_disabled` khi tắt. |
| Duyệt creative (`POST /media/:id/approve`) và duyệt chiến dịch | ĐÃ LÀM: creative có ngữ cảnh `lock` bị 422 `lock_ads_disabled` khi tắt. |
| Bật cài đặt | ĐÃ LÀM: cần `tv_experience:approve` (mặc định chỉ super_admin) VÀ `confirm_children_policy=true` (422 `children_policy_confirmation_required`), audit ghi `children_policy_confirmed`; đổi cài đặt bump manifest. UI hỏi xác nhận. |
| Tiền lọc N5 | ĐÃ LÀM: bỏ `LIKE '%kid_safe%'`; cột có cấu trúc `creative_security.kid_safe/lock_context` (đồng bộ mỗi lần overlay đổi; backfill trong 0008); summary đếm bằng SQL; bộ lọc `kid_safe` dùng cột. |
| Lúc xây manifest (edge-gateway) | CẦN P5/CHỦ GATEWAY: gateway hiện chỉ bỏ `lock` nếu `kid_safe!==true`; chưa đọc `lock_ads_enabled`. Bản vá đề xuất ở `ops/agents/p2-security.requests.md` (đọc `settings.tv_experience`, bỏ `lock` và bỏ creative chỉ-lock khi tắt). Cho tới khi vá, quảng cáo màn khóa chỉ lên TV nếu creative đã được duyệt `kid_safe` + `lock` (không thể xảy ra khi chính sách tắt vì API chặn đặt/duyệt, trừ dữ liệu cũ). |

Không làm (thuộc p4): bảng `device_audience`, `campaign_compliance.kid_safe`, lọc theo thiết bị family/child.

## 3. Cổng tuân thủ nội dung khi gửi duyệt chiến dịch

- `POST /campaigns/:id/submit` (khách và admin) BẮT BUỘC `content_rights_confirmed: true` (422 `rights_confirmation_required`), tùy chọn `restricted_industry`. Tự đánh dấu ngành hạn chế nếu `customers.industry` thuộc `banned_industries`.
- Ghi bảng `campaign_gate` + audit `campaign.submit` (xác nhận, phiên bản cam kết `rights-v1-2026-11`, cờ ngành hạn chế, lý do, người, IP).
- Hàng chờ duyệt (`GET /approvals`) trả `restricted_industry`, `restricted_reason`, `customer_industry`, `content_rights_confirmed(_at/_by)`; UI web-admin hiển thị cột "Tuân thủ", ô tích khi gửi duyệt.
- Duyệt chiến dịch ngành hạn chế bị 422 `restricted_industry_blocked` trừ khi `settings.allow_restricted_industries='1'`.
- Chiến dịch gửi duyệt trước khi có cổng (không có dòng `campaign_gate`) hiển thị "chưa xác nhận quyền" nhưng không bị chặn duyệt.

## 4. Quét phụ thuộc (`pnpm audit`)

Chạy được (registry truy cập được). Trước: 130 lỗ hổng (6 critical, 20 high, 93 moderate, 11 low). Sau khi nâng:
- `services/api`: hono 4.9.9 -> 4.13.18, @hono/node-server 1.19.5 -> 1.19.19.
- `apps/web-admin`: react-router-dom 6.28.0 -> 6.30.6, vite 6.0.3 -> 6.4.6, vitest 2.1.8 -> 3.2.6.
- Root: vitest 3.2.4 -> 3.2.6; `pnpm.overrides`: hono 4.13.18, @hono/node-server 1.19.19 (cho `edge-gateway` mà không sửa package.json của họ), fast-xml-parser 5.12.1 (qua @aws-sdk), nodemailer 7.0.13.
- Sau: 36 (3 critical, 6 high, 26 moderate, 1 low). Còn lại và lý do:
  - `tests/chaos` vitest <3.2.6 (critical, chỉ dev; dùng vitest UI server) và `tinypool` (critical, dev; cần vitest 4): chỉ ảnh hưởng máy dev/CI khi bật UI, không vào image chạy.
  - `nodemailer` (high, `packages/runtime`): bản vá nằm ở 8.x-10.x (đổi major, cần kiểm thử gửi thư); đã ghim 7.0.13. Rủi ro: SMTP command injection/địa chỉ do kẻ tấn công điều khiển; mail ở đây chỉ gửi tới email khách đã lưu, không nhận địa chỉ từ request công khai. Việc của agent runtime/ops (P0-11).
  - `zod` 3.x (high, ReDoS khi kiểm chuỗi ràng buộc rất lớn, `packages/openapi` build-time và web-admin): cần zod 4 (đổi major); API dùng 3.25.76 với giới hạn `max()` trên mọi chuỗi nhập.
  - `@hono/node-server` moderate cần 2.x (major) cho `serveStatic`, mã này không dùng `serveStatic`.
- Cần chạy lại bước cài (`pnpm install`) trên máy deploy.

## 5. Yêu cầu cho agent khác

Xem `ops/agents/p2-security.requests.md`.
