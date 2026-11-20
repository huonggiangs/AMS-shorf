# Kết nối TV Brain-rot với AMS: từ TV đến web quản trị

Tác giả: agent `w-dev`. Áp dụng cho ứng dụng TV `vn.brainrot.parental` (Brain-rot) và AMS (repo này). Giao thức chi tiết: `DEVICE-PROTOCOL.md`; mã tham chiếu phía TV: `TV-APP-INTEGRATION.md`.

## 1. Đường đi của dữ liệu

```
TV (Brain-rot) --HTTPS, ký Ed25519--> gw-ams.anio.vn  (edge-gateway, Cloudflare Worker)
                                           |  cùng CSDL D1/Postgres + KV
                                           v
                       ams.anio.vn  (web-admin  ->  /api/admin/v1/*  api)
```

- TV **chỉ** nói chuyện với `gw-ams.anio.vn` (đăng ký, xin mã ghép, heartbeat, manifest, sự kiện, ACK lệnh). TV không bao giờ gọi `ams.anio.vn`.
- Người vận hành **chỉ** dùng `ams.anio.vn`. Web ghi vào cùng CSDL mà gateway đọc: ghép mã, lệnh, duyệt creative đều đi qua đó. Không có kênh trực tiếp web -> TV.
- **Không realtime.** TV hỏi gateway theo chu kỳ heartbeat. Mọi thứ web gửi (lệnh, lịch quảng cáo mới, thay đổi metadata) tới TV ở lần heartbeat/manifest kế tiếp. Điều khiển tức thời trong cùng mạng vẫn dùng kênh LAN của Brain-rot (điện thoại phụ huynh -> TV); AMS không thay thế kênh đó.

## 2. Các trạng thái của một TV

| Trạng thái (web) | `trust_level` | Ý nghĩa | Điều kiện chuyển |
|---|---|---|---|
| Chờ ghép mã (`pending`) | 0 | TV đã đăng ký (`POST /v1/register`), có thể đã hiện mã 6 số, **chưa** có chủ | Tự động khi phụ huynh bật "Kết nối quảng cáo AMS" trên điện thoại và TV gọi `/v1/register` |
| Đã ghép (`paired`) | 1 | Quản trị đã nhập mã 6 số; có chủ sở hữu; nhận lệnh; lượt xem được tính `valid` | Web: nút **Ghép mã** (`POST /admin/v1/devices/pair`) |
| Đã xác minh (`verified`) | 2 | Đủ điều kiện tính hoa hồng | Web: nút **Xác minh** riêng (cần quyền duyệt thiết bị). Ghép mã **không** thay cho xác minh |
| Bị chặn (`blocked`) | 0 | Gateway từ chối (403); không ghép, không gửi lệnh | Web: Chặn / Bỏ chặn |

Lượt xem từ TV trust 0 vẫn được nhận nhưng bị đánh dấu `flagged` (`untrusted_device`), không tính tiền. Từ trust 1 trở lên lượt xem hợp lệ (đủ VCR, đủ thời lượng, không vượt trần giờ) là `valid`.

## 3. Việc người vận hành làm trên web (ams.anio.vn)

### 3.1 Ghép mã
1. Trên TV: mở Brain-rot, điện thoại phụ huynh bật **Kết nối quảng cáo AMS**, giữ màn receiver mở. TV hiện mã 6 số (hiệu lực 5 phút, tự làm mới).
2. Web: **Thiết bị -> Ghép mã**, nhập 6 số, (tùy chọn) tên chủ sở hữu/khách hàng, bấm **Ghép TV**. Cần quyền `devices:write`.
3. TV chuyển sang `paired` (trust 1) ở lần gọi `/v1/pair` kế tiếp; trên web hiện ngay. Thiết bị chưa ghép nằm trong bộ lọc **Chờ ghép mã** và ô thống kê cùng tên.
4. Đổi/gán chủ sở hữu: mở chi tiết thiết bị -> ô **Chủ sở hữu / khách hàng** -> **Gán** (tạo bản ghi chủ mới, không sửa bản cũ).

Bảo vệ: giới hạn 30 lần nhập/10 phút/người; sai quá 10 lần/10 phút/người (hoặc 200 lần toàn hệ thống) bị khóa tạm (`pair_locked`, 429); mã dùng một lần; mọi lần ghép và lần sai đều ghi nhật ký (`device.pair`, `device.pair_failed`, không ghi mã đã nhập).

| Thông báo trên web | Mã lỗi | Việc cần làm |
|---|---|---|
| Mã không đúng | `pair_code_not_found` (404) | Đọc lại 6 số trên TV |
| Mã đã hết hạn | `pair_code_expired` (422) | Lấy mã mới trên TV (mở lại màn ghép) |
| Mã này đã được dùng | `pair_code_used` (409) | TV có thể đã ghép: xem danh sách; nếu chưa, lấy mã mới |
| Thiết bị đang bị chặn | `device_blocked` (409) | Bỏ chặn trước |
| Nhập sai quá nhiều lần | `pair_locked` / `too_many_requests` (429) | Chờ vài phút |
| Không có quyền | `forbidden` (403) | Cần vai trò có `devices:write` (ví dụ `device_ops`) |

### 3.2 Gửi lệnh tới TV
Chi tiết thiết bị -> **Lệnh gửi TV**. Chỉ thiết bị trust >= 1 và không bị chặn nhận lệnh.

| Lệnh (`type`) | Tham số | Ghi chú |
|---|---|---|
| `refresh_manifest` | - | Theo `DEVICE-PROTOCOL.md` mục 6 (app TV đã xử lý) |
| `reboot` | - | Khởi động lại ứng dụng; app TV đã xử lý |
| `set_monitor` | `on` | Chế độ giám sát (heartbeat dày) |
| `lock`, `unlock` | `reason?` (<=120 ký tự) | Tên lệnh theo Brain-rot (LAN). **Cần xác nhận app TV nhận được qua heartbeat** |
| `message` | `text` (<=200), `seconds` 5-120 | Như trên |
| `pause`, `resume` | - | Tùy ứng dụng đang phát có MediaSession |
| `display-settings` | `settings` (1-10 khóa/giá trị) | Ý nghĩa do app TV định nghĩa; chỉ gọi qua API |

Quy tắc: TTL 60 giây - 7 ngày (mặc định 1 giờ); `idempotency_key` (8-64 ký tự, hoặc header `Idempotency-Key`): gửi lại cùng khóa trả lại lệnh cũ (HTTP 200, `replayed: true`), khác loại/tham số thì 409; tối đa 20 lệnh/10 phút/thiết bị và 60 lệnh/10 phút/người; tối đa 50 lệnh mở/thiết bị. Lệnh được ràng buộc theo thiết bị trên đường dẫn: dùng id lệnh của máy A qua đường dẫn máy B cho 404. Tài khoản khách hàng/đối tác không có API này (`/admin/v1/*` chỉ cho tài khoản nội bộ). Mọi tạo/hủy đều có nhật ký (`device.command.enqueue`, `device.command.cancel`).

**Vòng đời và dòng thời gian**: `Đang chờ` (tạo) -> `Đã giao` (TV nhận ở heartbeat) -> `TV đã xác nhận` (ACK ok) hoặc `TV báo thất bại` (ACK failed); hoặc `Hết hạn`, hoặc `Đã hủy` (quản trị). Chỉ có "đã xác nhận" khi TV gửi ACK thật qua `POST /v1/commands/ack` (hoặc `cmd_ack` của heartbeat). Hủy lệnh `Đã giao` không thu hồi được nếu TV đã thực thi; web nói rõ điều này.

**Độ trễ, nói thẳng**: lệnh tới TV ở heartbeat kế tiếp. Mặc định đang phát ~300 giây, rảnh ~600 giây (jitter +-20%, kéo dài tới x4 khi gateway quá tải). Nếu TV chưa nhận sau 120 giây (`CMD_REDELIVER_S`) thì giao lại, tối đa 10 lần. Để rút ngắn cho TV đã ghép, đặt biến môi trường gateway `HB_PAIRED_S` (ví dụ `60`, tối thiểu 30): chu kỳ cơ sở của thiết bị trust >= 1 không vượt giá trị này; mặc định TẮT. Đổi lại số request/heartbeat tăng tương ứng; cần tính lại công suất (`GW_CAPACITY_RPS`). Kể cả khi rút ngắn vẫn là polling, không phải đẩy tức thời. Trang web hiển thị cảnh báo này và giá trị thực.

### 3.3 Duyệt creative cho TV (kid_safe, ngữ cảnh)
Trang **Duyệt creative** -> mục **Hiển thị trên TV**:
- Chọn **ngữ cảnh** (`lock`, `fullscreen`, `pause`, `corner`) và tích **kid_safe**.
- Với kid_safe hoặc thêm `lock`, **bắt buộc** tích xác nhận "đã xem toàn bộ nội dung" và nhập ghi chú duyệt (>=3 ký tự). Cần quyền `tv_experience:approve` (mặc định chỉ `super_admin`). Máy chủ chặn: creative chưa duyệt nội dung, không toàn màn hình, ngành cấm (rượu bia, thuốc lá, cá cược, vay nóng, người lớn, thực phẩm chức năng, thuốc), ảnh không 16:9 hoặc > 15 MB.
- Xác nhận được lưu ở `creative_kid_review` (migration `0015_device_ops`) **gắn với `content_version`** của creative. Khách đổi tệp/định dạng/overlay thì `content_version` tăng và xác nhận hết hiệu lực; người duyệt phải xác nhận lại.
- **Manifest chỉ mang `kid_safe: true` và ngữ cảnh `lock` khi đồng thời**: (1) nội dung đã duyệt đúng phiên bản hiện tại; (2) xác nhận kid_safe đúng phiên bản hiện tại; (3) quản trị đã bật `lock_ads_enabled` (Trải nghiệm trên TV, cần xác nhận pháp lý/phụ huynh); (4) kid_safe được xác nhận. Thiếu một điều kiện: bỏ `lock`; nếu `lock` là ngữ cảnh duy nhất thì creative không vào manifest.
- Lưu ý thiết kế: hiện chưa có khái niệm "nhóm thiết bị kid_safe" ở gateway; chính sách là toàn cục (`lock_ads_enabled`) cộng với kiểm tra phía TV (phụ huynh bật trên điện thoại). Muốn bật theo từng nhóm TV cần thêm mô hình nhóm riêng.

## 4. Quảng cáo tới TV và lượt xem
Chiến dịch active + lịch -> manifest của nhóm `<vùng>.<khung giờ>.tv` -> TV tải creative (kiểm sha256) -> gửi sự kiện `impression` ký bằng khóa thiết bị (`POST /v1/events`, UUIDv7, VCR 100%, đủ >=90% thời lượng) -> `valid` nếu thiết bị trust >= 1. Thanh toán/hoa hồng theo `finance`; không đổi trong tài liệu này.

## 5. Xử lý sự cố

| Hiện tượng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| TV không xuất hiện ở danh sách | Phụ huynh chưa bật "Kết nối quảng cáo AMS"; mạng chặn `gw-ams.anio.vn`; giờ TV lệch > 5 phút (`stale_timestamp`) | Bật công tắc; kiểm tra mạng/giờ TV; xem log gateway |
| TV hiện "Chờ ghép mã" mãi | Chưa nhập mã trên web; mã hết hạn | Ghép mã (mục 3.1); mở lại màn ghép trên TV để lấy mã mới |
| Ghép xong nhưng lượt xem `flagged` | Gateway còn cache trust cũ (tối đa 30 giây/instance) | Chờ ~30 giây rồi kiểm tra lại |
| Lệnh ở "Đang chờ" lâu | Chưa tới heartbeat; TV tắt/mất mạng | Chờ theo mục 3.2; xem "Heartbeat gần nhất"; cân nhắc `HB_PAIRED_S` |
| Lệnh "Đã giao" nhưng không có ACK | App TV chưa hỗ trợ loại lệnh đó hoặc chưa gọi ACK | Kiểm tra bản app; lệnh sẽ giao lại tối đa 10 lần rồi `TV báo thất bại` (`max_deliveries`) |
| Không thấy quảng cáo trên màn khóa | Thiếu bất kỳ điều kiện ở mục 3.3 (thường: chưa xác nhận lại sau khi khách đổi nội dung, hoặc `lock_ads_enabled` tắt) | Mở "Hiển thị trên TV": cột kid_safe cho biết "Cần xác nhận lại" |
| Gửi lệnh bị 409 `device_not_paired` | TV chưa ghép | Ghép mã |
| 429 khi gửi lệnh/ghép | Vượt hạn mức | Chờ vài phút |

## 6. Kiểm thử
- `services/api/test/w-dev-device-ops.test.ts`: TV giả đăng ký -> hiện "chờ ghép" -> mã sai/đúng -> trust 1 -> lệnh (idempotency, ACL, hủy, TTL, hạn mức) -> heartbeat giao lệnh -> ACK -> duyệt kid_safe có xác nhận -> manifest (có/không `lock`, hết hiệu lực khi đổi nội dung) -> impression `valid`.
- `apps/web-admin/src/test/w-dev-devices.test.tsx`: hộp ghép mã, thông báo lỗi tiếng Việt, bảng lệnh, xác nhận duyệt kid_safe.
- `tests/contract/test/protocol.test.ts`, `tv-client.test.ts`: hợp đồng gateway/manifest với xác nhận kid_safe.

## 7. Chưa làm / giới hạn đã biết
- Chưa chạy trên TV thật hay APK thật; mọi kiểm thử dùng TV giả ký Ed25519 trên runtime thử.
- Tên lệnh `lock/unlock/message/pause/resume/display-settings` theo mã LAN của Brain-rot; chưa xác nhận app TV 1.0.102 xử lý chúng khi đến từ heartbeat. Chỉ `refresh_manifest`, `reboot`, `set_monitor` nằm trong giao thức đã ghi.
- Hủy lệnh dùng trạng thái `failed` + `result = cancelled_by_admin` (không đổi ràng buộc CHECK của bảng); web hiển thị là "Đã hủy".
- Chủ sở hữu hiện là tên tự do (bản ghi `end_users`), chưa liên kết bảng `customers`.
- Chưa có WebSocket/Durable Object: điều khiển tức thời qua Internet vẫn chưa có.
