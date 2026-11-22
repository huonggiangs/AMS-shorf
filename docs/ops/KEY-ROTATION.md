# Xoay khóa không ngừng hệ thống (FIELD_ENC_KEY, SESSION_SECRET)

Áp dụng: R1-21, P1-10. Mã: `packages/shared/src/aes.ts` (vòng khóa), `services/api/src/lib/reencrypt.ts`, CLI `pnpm --filter @ams/api reencrypt-fields`, route `POST /admin/v1/ops/reencrypt-fields` (super_admin).

## Định dạng và biến môi trường
- Token mới: `v2:<kid>:<iv>:<ct>` (kid = id khóa ghi). Token cũ `v1:<iv>:<ct>` vẫn giải mã được (thử lần lượt các khóa).
- `FIELD_ENC_KEY`: khóa hiện tại/legacy (id `k0`).
- `FIELD_ENC_KEYS`: `id:base64,id:base64`; khóa đầu tiên là khóa GHI.
- `FIELD_ENC_KEY_ID`: ép khóa ghi (để nạp khóa mới trước khi chuyển ghi).
- `FIELD_INDEX_KEY`: khóa HMAC cho chỉ mục mù (`tax_code_hash`, `phone_hash`). KHÔNG ĐƯỢC ĐỔI. Nếu chưa đặt, mặc định là `FIELD_ENC_KEY` (legacy). Trước khi gỡ `FIELD_ENC_KEY` phải đặt `FIELD_INDEX_KEY` = giá trị cũ.
- Các dịch vụ dùng chung vòng khóa: api, payments, edge-gateway (Docker: cùng `.env`; Cloudflare: secret của từng Worker api/gateway).

## Quy trình (không downtime)
0. Sao lưu DB. Sinh khóa mới: `openssl rand -base64 32`.
1. Đặt `FIELD_INDEX_KEY=<khóa cũ>` (một lần, vĩnh viễn). Triển khai mã mới trước (đọc được v2) cho MỌI dịch vụ (api, payments, gateway) khi vẫn chỉ có khóa cũ: bước này ngăn dịch vụ cũ gặp token v2 khi cuốn chiếu.
2. Nạp khóa mới nhưng giữ khóa ghi cũ: `FIELD_ENC_KEYS=k2:<mới>`, `FIELD_ENC_KEY=<cũ>`, `FIELD_ENC_KEY_ID=k0`. Triển khai tất cả dịch vụ.
3. Chuyển khóa ghi: bỏ `FIELD_ENC_KEY_ID`. Triển khai. Dữ liệu mới ghi bằng `k2`.
4. Mã hóa lại dữ liệu cũ: Postgres `pnpm --filter @ams/api reencrypt-fields --dry-run` rồi chạy thật (thoát 0 = xong, 2 = còn bản ghi lỗi giải mã). Cloudflare D1: gọi `POST /admin/v1/ops/reencrypt-fields` `{ "limit": 200 }` lặp đến khi `pending = 0` (nên dùng `dry_run:true` trước). Idempotent, cập nhật có điều kiện nên chạy cùng lưu lượng thật được.
5. Kiểm tra: `failed = 0`, `pending = 0`; đăng nhập TOTP, mở một khách (MST), một webhook mới.
6. Gỡ khóa cũ: xóa `FIELD_ENC_KEY` (giữ `FIELD_INDEX_KEY`). Lưu khóa cũ trong kho bí mật thêm 30 ngày (khôi phục từ bản sao lưu trước bước 4 cần nó).

Lưu ý: KV `mfa:enroll:*` (600 giây) và mã OTP đang bay có thể mất hiệu lực khi đổi khóa ở bước gỡ; người dùng chỉ cần thử lại.
Không ghi nhật ký giá trị khóa. Khóa test (`TEST_FIELD_ENC_KEY`) bị chặn ở staging/production bởi `seed-guard`.

## SESSION_SECRET
Phiên đăng nhập là token ngẫu nhiên lưu băm trong DB, KHÔNG dùng SESSION_SECRET. Chỉ Docker với `OBJECT_STORE=fs` dùng nó (hoặc `OBJECT_STORE_SIGNING_SECRET`) để ký URL tải lên/xuống (TTL ngắn). Xoay: đặt `SESSION_SECRET=<mới>` và `SESSION_SECRET_PREV=<cũ>` (danh sách phẩy), triển khai; sau TTL URL dài nhất (vài giờ) xóa `SESSION_SECRET_PREV`. Trên Cloudflare không dùng.

## Việc người vận hành (mã không làm được)
- Thực hiện lịch xoay định kỳ (đề xuất 12 tháng và khi nghi lộ) và lưu khóa trong kho bí mật có kiểm soát truy cập.
- Cloudflare: bí mật Workers đặt qua `wrangler secret put` / GitHub secrets `AMS_SECRET_*`.
