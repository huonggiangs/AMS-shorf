# API phía người xem (WP-18): ghép đôi, ví thưởng, rút thưởng, tương tác QR, ủy quyền thuế

Dành cho app điện thoại "Mindo" (`apps/mobile/src/features/ads/provider`). Cổng: **edge gateway** (`gw-ams.anio.vn`), cùng chữ ký Ed25519 thiết bị như `docs/DEVICE-PROTOCOL.md` mục 3. Mã nguồn: `services/edge-gateway/src/viewer.ts`; lược đồ: `docs/openapi/ams-device-gateway.yaml`; migration: `packages/db/migrations/0014_viewer_rewards.sql`.

**Trạng thái: đã port lên `main` (nhánh w18), sẵn sàng deploy, CHƯA deploy, CHƯA chạy migration lên DB thật.** Mọi kiểm thử chạy local (SQLite `node:sqlite`, PostgreSQL PGlite). Production hiện chưa có các route này nên app Mindo báo "không tải được ví thưởng" cho tới khi deploy gateway + áp migration 0014.

**Host:** các route nằm ở **edge gateway** (`https://gw-ams.anio.vn`, staging `gw-ams-stg.anio.vn`), KHÔNG ở `ams.anio.vn` (web admin + `/api/*`). App phải trỏ `base URL` về host gateway.

## 1. Quyết định đã chốt và cách cài đặt

| Quyết định | Cài đặt |
|---|---|
| Mốc nhận thưởng 100.000 đ cộng dồn | `PAYOUT_THRESHOLD_VND` (mặc định 100000); `POST /v1/withdraw` chặn `amount_vnd` dưới mốc (`below_threshold`) và trên số dư khả dụng |
| Nhà tài trợ chi thưởng theo chiến dịch; phủ/lượt xem trả thấp, hiệu quả/nhấp-quét QR trả cao (20-50 đ) | cột `campaigns.reward_model` (`cover`\|`performance`) và `campaigns.interaction_reward_vnd`; đặt qua `PUT /admin/v1/campaigns/{id}/reward-config` (quyền `campaigns:approve`, trần 50 đ, có audit) |
| Lượt xem thuần chỉ tính nếu chiến dịch loại phủ | gateway `/v1/events` chỉ sinh `reward_vnd` khi `reward_model='cover'` (và slot có `reward_points`); `performance` => 0. **Mặc định cột là `performance`** (an toàn: không thưởng lượt xem cho tới khi nhà tài trợ cấu hình) |
| Thanh toán tự động hoặc ủy quyền ứng dụng nộp thuế | `POST /v1/tax-authorization` với `mode` = `auto_pay` (thanh toán tự động, chấp nhận chi trả thuế) \| `delegate` (ủy quyền ứng dụng nộp thuế) \| `none` (thu hồi); trùng từ vựng `tax_authorization` của app Mindo, cũng nhận trong thân `POST /v1/withdraw`; bảng `viewer_tax_authorizations` chỉ thêm dòng; `payouts.tax_mode` ghi snapshot. **Chưa khấu trừ/nộp thuế thật** |
| Rà soát thuế/KYC trước khi chi thật | `VIEWER_WITHDRAW_ENABLED` mặc định **tắt** (`feature_disabled`); lệnh rút luôn ở `pending`, chỉ nhân viên tài chính chi (`/admin/v1/payouts/{id}/pay`, cookie + 2FA) |

## 2. Endpoint

Mọi endpoint ký như `/v1/*`; yêu cầu thiết bị `kind=phone` (trừ `/v1/interactions`: `phone` hoặc `tv`). Lỗi theo `{error:{code,message,details}}` (bảng mã mục 9 của DEVICE-PROTOCOL).

| Endpoint | Việc |
|---|---|
| `POST /v1/viewer/pair` `{code}` | Điện thoại nhập mã 6 số hiển thị trên TV (`/v1/pair`). Mã hết hạn 5 phút, dùng một lần. Chống dò: sai >5 lần/15 phút/thiết bị => 429 (Retry-After 900); 30 lần/giờ/IP; mọi lỗi mã gộp thành `invalid_code` 404. Lần ghép đầu tạo `end_users` cho điện thoại, nâng `trust_level` điện thoại và TV lên 1. TV đã ghép người khác => 409 `already_paired`; tối đa `VIEWER_MAX_TVS` (10) TV/người |
| `GET /v1/wallet` | `balance_vnd` (khả dụng = sổ cái trừ lệnh rút đang chờ), `ledger_balance_vnd`, `pending_payout_vnd`, `total_paid_vnd`, `views`, `interactions` (số dòng đã có thưởng), `payouts[]`, `devices[]` (TV đã ghép), `unit_price_vnd` (20, chỉ hiển thị), `payout_threshold_vnd`, `tax_mode`, `phone_verified`, `withdraw_enabled` |
| `GET /v1/wallet/ledger?limit&cursor` | Sao kê, mới nhất trước, con trỏ `next_cursor` |
| `POST /v1/viewer/phone` `{phone, otp?}` | Không `otp`: gửi OTP tới số (202). Có `otp`: xác minh (200), lưu `phone_hash` (HMAC) + `phone_enc` (AES-GCM). Cần đã ghép TV |
| `GET /v1/tax-authorization`, `POST /v1/tax-authorization` `{mode, consent_version, tax_code?}` | Xem/đổi chế độ thuế. MST `tax_code` tùy chọn (mã hóa khi lưu). `consent_version` phải bằng `TAX_CONSENT_VERSION` |
| `POST /v1/withdraw` `{amount_vnd, bank{...}, otp?, tax_authorization?, idempotency_key}` | Xem mục 3 |
| `POST /v1/interactions` `{events:[{event_id,ts,kind\|interaction,campaign_id,creative_id,slot_id?}]}` | Xem mục 4. Nhận cả tên trường cũ `interaction` của app Mindo |

## 3. Rút thưởng (`POST /v1/withdraw`)

Thứ tự kiểm tra: bật tính năng -> đã ghép -> **idempotent** (cùng khóa+nội dung: 200 trả lệnh cũ, không cần OTP; khác nội dung: 409 `idempotency_conflict`) -> đã xác minh điện thoại -> đã chọn chế độ thuế -> đủ mốc -> đủ số dư khả dụng -> OTP.
- Lần gọi đầu không `otp`: **403 `otp_required`** (đã gửi OTP tới số đã xác minh; `details.expires_in`, `phone_masked`). Gọi lại cùng thân kèm `otp`. OTP băm HMAC, gắn với đúng (số tiền, ngân hàng, số tài khoản), dùng một lần, 5 lần thử, 3 lần gửi/giờ.
- Tạo `payouts` ở `pending` bằng **một câu lệnh có điều kiện** (đủ số dư khả dụng, không có lệnh rút đang chờ khác, chưa có khóa idempotent) sau khi khóa hàng người dùng: hai yêu cầu đồng thời chỉ một thành công. Tương thích D1 (không dựa vào rollback).
- **Không ghi `wallet_ledger`, không chuyển tiền.** Sổ cái bị trừ chỉ khi nhân viên tài chính bấm "chi" (luồng sẵn có, kiểm lại số dư).
- Tài khoản nhận lưu mã hóa AES-GCM (`payouts.account_enc`, AAD `payout:<id>`); danh sách/chi tiết admin chỉ hiện ngân hàng + 4 số cuối + `tax_mode`; số đầy đủ qua `GET /admin/v1/payouts/{id}/destination` (`finance:approve`, `no-store`, ghi audit mỗi lần).

## 4. Tương tác (`POST /v1/interactions`) và ghi thưởng

Xác thực: chữ ký thiết bị + thiết bị đã ghép (`trust_level>=1`, có `user_id`). Mỗi sự kiện: `event_id` UUIDv7 (khóa chính `viewer_interactions` => khử trùng; gửi lại trả `duplicate`, không cộng lại), `ts` trong [-24 giờ, +5 phút], creative phải thuộc manifest của nhóm thiết bị và khớp `campaign_id`. Giới hạn: 20 lô/phút/thiết bị; mặc định 30 tương tác thưởng/người/ngày, 3/chiến dịch/người/ngày, trần thưởng/người/ngày `VIEWER_DAILY_REWARD_CAP_VND` (10.000 đ, mọi nguồn); ngày tính theo giờ Việt Nam. Thưởng = `min(interaction_reward_vnd, INTERACTION_MAX_REWARD_VND)`; ghi `wallet_ledger` (`kind='reward'`, `ref_type='interaction'`, `ref_id=event_id`).

Thưởng lượt xem: trong `/v1/events`, impression hợp lệ của chiến dịch `cover` trên TV đã ghép ghi `wallet_ledger` (`ref_type='impression'`, `ref_id=event_id`) trước khi đẩy hàng đợi; chỉ mục duy nhất `uq_wallet_ledger_reward_ref` bảo đảm mỗi `event_id` chỉ cộng một lần dù gửi lại; vượt trần ngày thì `reward_vnd` của dòng sự kiện cũng về 0.

## 5. Migration `0014_viewer_rewards.sql` (thêm, không đổi dữ liệu cũ; Postgres + SQLite/D1)

`campaigns` (+`reward_model`, +`interaction_reward_vnd`); `end_users` (+`phone_enc`, +`phone_verified_at`); `payouts` (+`idempotency_key`, `bank_code`, `bank_name`, `account_enc`, `account_last4`, `tax_mode`, `requested_via`; chỉ mục duy nhất `(user_id, idempotency_key)`); `wallet_ledger` (chỉ mục duy nhất từng phần cho dòng thưởng); bảng mới `viewer_interactions`, `viewer_tax_authorizations`. `ALTER TABLE ... ADD COLUMN` không idempotent: bảng `_migrations` bảo vệ khỏi chạy hai lần.

## 6. Cấu hình (biến môi trường, xem `.env.example`)

`VIEWER_WITHDRAW_ENABLED` (mặc định 0), `PAYOUT_THRESHOLD_VND`, `PAYOUT_REQUIRE_TAX_CONSENT`, `TAX_CONSENT_VERSION`, `VIEWER_UNIT_PRICE_VND`, `INTERACTION_MAX_REWARD_VND`, `VIEWER_DAILY_REWARD_CAP_VND`, `INTERACTIONS_PER_USER_DAY`, `INTERACTIONS_PER_CAMPAIGN_USER_DAY`, `VIEWER_MAX_TVS`, `VIEWER_PAIR_FAIL_LIMIT`, `VIEWER_OTP_*`, `VIEWER_CORS_ORIGINS` (tắt mặc định; app WebView cần bật, xem mục 8), `VIEWER_OTP_DEV_ECHO` (chỉ local/test). Cần `FIELD_ENC_KEY` (mã hóa tài khoản/MST/số điện thoại); thiếu => `not_configured`.

## 7. Thuế: phạm vi và việc chưa làm

Chỉ có **cờ và đồng ý** (ý chí người nhận, phiên bản điều khoản, MST mã hóa, lịch sử bất biến, snapshot trên lệnh chi). `remittance_active=false` ở mọi phản hồi. Chưa có: tính/khấu trừ TNCN (cư trú/không cư trú, ngưỡng miễn), chứng từ khấu trừ, kê khai/nộp, mẫu ủy quyền pháp lý, KYC (đối chiếu tên chủ tài khoản với CCCD). Cần luật sư/kế toán chốt trước khi bật `VIEWER_WITHDRAW_ENABLED`.

## 8. Việc chủ dự án phải duyệt trước khi deploy

1. Chạy migration 0014 lên D1/Postgres (thêm cột `NOT NULL DEFAULT`, an toàn với dữ liệu cũ; sao lưu trước, staging trước).
2. Kênh gửi OTP thật (SMS Brandname/Zalo ZNS/eSMS...): cài `OtpSender` qua `createGateway(rt, { viewer: { otpSender } })` trong `worker.ts`/`node.ts`. Hiện KHÔNG có: không `otpSender` và không phải local/test thì `POST /v1/viewer/phone` và `POST /v1/withdraw` (bước OTP) trả 503 `not_configured` (`details.reason = otp_channel_not_configured`); mã OTP không bao giờ được ghi log, và `VIEWER_OTP_DEV_ECHO` chỉ hiệu lực khi `AMS_ENV` là local/test. Chi phí OTP và giới hạn gửi.
3. `FIELD_ENC_KEY` production: Worker **gateway** cần CÙNG giá trị với Worker api (api giải mã tài khoản nhận để tài chính chi). Đặt bằng `AMS_SECRET_FIELD_ENC_KEY` (deploy script nay đặt cả cho gateway, không tự sinh); thiếu => các route phone/withdraw/tax-code trả `not_configured`, ví/ghép đôi/tương tác vẫn chạy. Quyết định xoay khóa.
4. Chính sách thuế/KYC, điều khoản và `TAX_CONSENT_VERSION`; chỉ khi đó mới đặt `VIEWER_WITHDRAW_ENABLED=1`.
5. Giá trị mặc định: trần thưởng/ngày 10.000 đ, 30 tương tác/ngày, 3/chiến dịch/ngày, 10 TV/người, mặc định chiến dịch `performance`.
6. CORS: bật `VIEWER_CORS_ORIGINS` cho nguồn WebView của app (hoặc app dùng HTTP native không qua CORS). Gateway hiện không có CORS.
7. Ai chịu chi phí thưởng: thưởng chưa trừ vào ngân sách/`spent_vnd` của chiến dịch (xem mục 9).

## 8b. Tóm tắt hợp đồng cho app (đã kiểm thử)

Chữ ký Ed25519 như `DEVICE-PROTOCOL.md` mục 3; thiết bị `kind=phone` (trừ `/v1/interactions`: phone hoặc tv). Lỗi: `{error:{code,message,details?}}`.

- `POST /v1/viewer/pair` `{code:"123456"}` -> 200 `{paired:true, device_id, trust_level:1, already?}`; mã sai/hết hạn/đã dùng -> 404 `invalid_code`; TV đã ghép người khác -> 409 `already_paired`; sai quá nhiều -> 429 `rate_limited` (+`Retry-After`).
- `GET /v1/wallet` -> 200 `{paired, balance_vnd, ledger_balance_vnd, pending_payout_vnd, total_paid_vnd, views, interactions, payouts[{id,amount_vnd,status,requested_at,paid_at}], devices[{device_id,name,paired_at}], tax_mode, tax_authorization, phone_verified, today_reward_vnd, unit_price_vnd, payout_threshold_vnd, interaction_reward_range_vnd:[20,50], daily_reward_cap_vnd, withdraw_enabled}`. Điện thoại chưa ghép TV: `paired:false`, mọi số = 0 (không lỗi).
- `GET /v1/wallet/ledger?limit=20&cursor=` -> `{items[{id,kind,amount_vnd,status,created_at,ref_type}], next_cursor?}`.
- `POST /v1/viewer/phone` `{phone:"0912345678"|"+84912345678"}` -> 202 `{otp_sent:true, expires_in, phone_masked}`; kèm `otp` -> 200 `{verified:true, phone_masked}`; sai OTP 403 `otp_invalid`; không có kênh OTP 503 `not_configured`.
- `GET /v1/tax-authorization` / `POST` `{mode:"none|auto_pay|delegate", consent_version, tax_code?}` -> `{mode, tax_authorization, consent_version, updated_at, current_consent_version, modes[], remittance_active:false}`.
- `POST /v1/withdraw` `{amount_vnd, bank:{bank_code?,bank_name,account_number,account_name}, otp?, tax_authorization?, idempotency_key}` -> 201 `{payout_id,id,status:"pending",amount_vnd,requested_at,review:"awaiting_finance_approval"}`; gửi lại cùng khóa -> 200 (+`idempotent_replay:true`). Lỗi: 403 `feature_disabled|otp_required|phone_not_verified|tax_consent_required`, 422 `below_threshold` (100.000 đ), 409 `insufficient_balance|idempotency_conflict|conflict` (đang có lệnh chờ).
- `POST /v1/interactions` `{events:[{event_id(UUIDv7),ts,kind:"tap|qr_scan"(hoặc interaction),campaign_id,creative_id,slot_id?}]}` (tối đa 10) -> 200 `{accepted,valid,credited_vnd,rejected[{event_id,reason}],results[{event_id,status:"credited|recorded|duplicate|rejected",credited_vnd,reason?}]}`.

## 9. Hạn chế đã biết (trung thực)

- **Tương tác là dữ liệu do máy khách báo.** Chữ ký chứng minh đúng thiết bị, không chứng minh người thật đã quét QR. Gian lận (điện thoại giả, đăng ký hàng loạt) bị giới hạn bằng trần/ngày, trần theo chiến dịch, giới hạn đăng ký theo IP (20/giờ), nhưng cần bằng chứng mạnh hơn trước khi mở rộng: chuyển hướng QR qua liên kết ngắn của AMS đếm phía máy chủ, attestation thiết bị (Play Integrity), đối chiếu tương tác với lượt xem trên TV cùng người dùng.
- **Chưa trừ chi phí thưởng vào ngân sách chiến dịch** (`spent_vnd`/`reserved_vnd`) và chưa kiểm ngân sách còn đủ khi thưởng; quỹ thưởng nhà tài trợ chưa là một ví riêng.
- Chống dò mã 6 số: giới hạn theo thiết bị và IP; kẻ tấn công có nhiều IP/thiết bị vẫn có xác suất nhỏ trúng mã đang hiển thị trong 5 phút. Cân nhắc mã 8 số hoặc xác nhận trên TV. Không có khóa toàn cục (tránh tự gây từ chối dịch vụ).
- Trên Cloudflare (D1 không có giao dịch tương tác): bộ đếm `kv.incr` nguyên tử qua D1 (`kv_counters`); lệnh rút và lệnh chi dùng MỘT `db.batch` có điều kiện (đủ số dư, không có lệnh chờ khác, khóa idempotent duy nhất), thưởng chống trùng bằng chỉ mục duy nhất `uq_wallet_ledger_reward_ref`. Các trần theo ngày (tương tác/thưởng) đọc từ DB rồi ghi nên hai lô đồng thời của cùng một người có thể vượt trần một chút trên D1 (Postgres: tuần tự hóa bằng khóa hàng); chấp nhận được vì trần là chống lạm dụng, không phải ranh giới tiền. `PresenceShard` DO vẫn chống phát lại chữ ký.
- Số đếm `views` trong ví là số dòng thưởng, không phải mọi lượt xem.
- Không có đăng nhập người dùng riêng: danh tính người xem = khóa thiết bị điện thoại + số điện thoại đã xác minh. Mất điện thoại = mất khóa (chưa có khôi phục tài khoản).
- Bản Kotlin `docs/openapi/kotlin/AmsDeviceApi.kt` (dành cho app TV) chưa bổ sung các endpoint này (app TV không gọi chúng, ngoại trừ `/v1/interactions` tùy chọn).
