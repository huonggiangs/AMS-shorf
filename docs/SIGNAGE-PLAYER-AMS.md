# Signage Player (màn hình thang máy / LED 9:16) với AMS

Ứng dụng Android `vn.anio.signage` dùng gateway `https://gw-ams.anio.vn` và trang quản trị `https://ams.anio.vn`. Tài liệu này gồm: (1) tình trạng 13 yêu cầu bổ sung, (2) hướng dẫn vận hành cấp quyền cho màn thang máy mới, (3) trường và đường dẫn cho đội app. Giao thức chi tiết ở `docs/DEVICE-PROTOCOL.md`.

## 1. Tình trạng 13 yêu cầu (`YEU-CAU-BO-SUNG-AMS`)

| # | Yêu cầu | Tình trạng | Mã nguồn | Kiểm thử |
|---|---|---|---|---|
| 1 | Thang máy/LED được duyệt không cần mã 6 số | Xong | `services/api/src/routes/devices.ts` (`POST /:id/approve`, `/revoke-approval`), `services/edge-gateway/src/gateway.ts` (register) | `services/api/test/signage-player.test.ts`, `services/edge-gateway/test/signage.test.ts` |
| 2 | Lệnh `reset_pin` | Xong | `services/api/src/routes/device-commands.ts`; giao lại cùng `id`: `services/edge-gateway/src/gateway.ts` | `signage-player.test.ts` (api), `signage.test.ts` (gateway) |
| 3 | `proof_of_play` hợp lệ | Xong | `services/edge-gateway/src/events.ts`, `services/api/src/routes/history.ts` | cả hai file trên |
| 4 | Manifest theo độ phân giải | Xong | `services/edge-gateway/src/{protocol,devices,manifest}.ts` | `signage.test.ts` (gateway) |
| 5 | Header/footer (manifest + slot) | Xong | `manifest.ts`, `services/api/src/routes/{screens,schedule}.ts`, bảng `schedule_slot_text` | cả hai file; `apps/web-admin/src/test/signage-player.test.tsx` (giao diện cấp quyền/nhật ký) |
| 6 | Hotline/Zalo | Xong (heartbeat và manifest) | `gateway.ts`, `manifest.ts`, `packages/shared/src/signage.ts` | `signage.test.ts` |
| 7 | `duration_s` ảnh và `fit` | Xong, `fit` theo loại màn (không theo từng creative) | `manifest.ts` | `signage.test.ts` |
| 8 | Quy tắc xoay vòng | Xong (chốt trong giao thức, `rotation` trong manifest; app thực hiện) | `manifest.ts`, `DEVICE-PROTOCOL.md` 7.5 | `signage.test.ts` |
| 9 | `set_volume`, `set_orientation`, `message` | Xong | `device-commands.ts` | `signage-player.test.ts` (api) |
| 10 | Cập nhật app từ xa | Xong (cấu hình theo loại màn; cần quyền `devices:approve`) | `screens.ts` (`/signage-config`), `gateway.ts` | cả hai file |
| 11 | `POST /v1/logs` | Xong | `services/edge-gateway/src/{gateway,logs}.ts`, migration `0017_signage_player.sql`, `devices.ts` (`GET /:id/logs`) | cả hai file; giao diện: `signage-player.test.tsx` |
| 12 | Cột trạng thái trên admin | Xong | `services/api/src/routes/devices.ts`, `apps/web-admin/src/pages/Devices.tsx` | `signage-player.test.tsx` |
| 13 | Phát đồng bộ nhiều màn | **Chưa làm** (theo yêu cầu: bản này chưa cần). Đề xuất `sync_group` và mốc bắt đầu chung trong manifest | | |

Giới hạn đã biết: chưa kiểm trên ams.anio.vn thật và thiết bị thật; Cloudflare chỉ qua `tsc` và kiểm thử trên SQLite/PGlite.

## 2. Cấp quyền cho màn thang máy mới (5 bước, cho người không rành kỹ thuật)

1. **Bật màn hình và mở ứng dụng Signage Player.** Màn tự đăng ký và hiện mã thiết bị (dãy chữ số/chữ). Màn phải có mạng. Không cần nhập mã 6 số.
2. **Vào ams.anio.vn > Thiết bị.** Ô "Chờ cấp quyền" cho biết số màn đang chờ. Bấm vào ô hoặc lọc Trạng thái = "Chờ cấp quyền", tìm dòng có mã trùng với mã trên màn.
3. **Mở dòng đó rồi bấm "Cấp quyền".** Chọn **địa điểm lắp đặt** (chung cư/tòa nhà, đã tạo ở trang Màn hình thang máy & LED; nếu chưa có thì thêm vị trí trước), có thể đặt tên hiển thị, bấm "Cấp quyền". Cần tài khoản có quyền duyệt thiết bị (mặc định chỉ quản trị cấp cao; có thể cấp cho vai trò vận hành thiết bị ở trang Phân quyền).
4. **Chờ khoảng 1 đến 10 phút.** Màn tự nhận lịch đúng độ phân giải ở lần kết nối kế tiếp. Dòng thiết bị chuyển thành "Đã cấp quyền", hiện nguồn phát, phiên bản app, bộ nhớ đệm.
5. **Kiểm tra:** thấy quảng cáo chạy trên màn; ở ngăn chi tiết có "Nhật ký thiết bị" không báo lỗi. Cần đổi chữ đầu/cuối, hotline: Màn hình thang máy & LED > "Chữ, hotline và cập nhật app". Cấp nhầm hoặc tháo màn: mở thiết bị > "Thu hồi quyền". Quên mật khẩu cài đặt trên màn: gửi lệnh "Cấp lại mật khẩu" (mật khẩu về 1234, hiệu lực 15 phút).

## 3. Dành cho đội app

- Gateway: `https://gw-ams.anio.vn`. Ký Ed25519 như mục 3 của `DEVICE-PROTOCOL.md`.
- `POST /v1/register`: thêm `px_w`, `px_h`, `orientation`, `region`; cùng khóa luôn nhận lại cùng `device_id`.
- `POST /v1/heartbeat`: gửi thêm (tùy chọn) `source` (`ams|usb|lan`), `app_version`, `cache_mb`, `px_w/px_h/orientation/region`. Nhận thêm `hotline`, `app_update_url`, `app_update_sha256`, `min_app_version`.
- `GET /v1/manifest`: thêm `header`, `footer`, `hotline`, `rotation`, `schedule[].header/footer`, `creatives[].fit`, `duration_s` ảnh luôn có.
- Lệnh: `reset_pin`, `set_volume {percent}`, `set_orientation {orientation}`, `message {text, duration_s?}`; `id` không đổi khi giao lại; lệnh lạ vẫn ack.
- `POST /v1/events` `proof_of_play`: hợp lệ khi thiết bị đã được cấp quyền; chưa cấp quyền thì `pending_trust` (không mất, tính lại khi cấp quyền).
- `POST /v1/logs`: <= 8 KB, <= 100 dòng, 60 lần/giờ, lưu 7 ngày.
- OpenAPI: `docs/openapi/ams-device-gateway.yaml` (sinh bằng `pnpm --filter @ams/openapi generate`).
