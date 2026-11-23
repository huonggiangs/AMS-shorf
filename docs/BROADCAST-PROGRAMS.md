# Chương trình phát sóng nội bộ

Đường phát **nội dung của chính vận hành** (giới thiệu tòa nhà, thông báo, video thương hiệu) đến thiết bị đã duyệt, **không qua hợp đồng, chiến dịch hay thanh toán**.

## Luồng
1. Tải video/ảnh vào **Nội dung & Media** (upload, hoặc link Drive/Dropbox/trực tiếp, kèm mô tả). Người có quyền duyệt tự duyệt tệp của mình; tệp khác cần duyệt.
2. Vào **Quảng cáo → Chương trình phát sóng → Tạo chương trình**: chọn loại màn (thang máy/TV/LED), khu vực (để trống = tất cả), ngày hiệu lực, khung giờ (lưới 30 phút), ưu tiên, chữ header/footer (thang máy/LED) và danh sách tệp theo thứ tự.
3. **Xuất bản**. Gateway thêm chương trình vào manifest của nhóm thiết bị khớp (loại màn + khu vực). Thiết bị nhận ở lần đồng bộ kế tiếp (tối đa vài phút). **Dừng phát** đưa chương trình về bản nháp.

## Quy tắc
- Chỉ nhận tệp **đã duyệt**, **sẵn sàng**, **chưa gắn chiến dịch** và khớp loại màn (thang máy: dọc 9:16 từ 720×1280 đến 2160×3840).
- Trong manifest: `slot_id` = `campaign_id` = `bp_<id>`; `reward_points` = 0; không có giá chốt nên **proof_of_play không tính tiền** (consumer bỏ qua chi tiêu vì không có chiến dịch).
- Cùng một tệp ở nhiều chương trình chỉ xuất hiện một lần trong `creatives`; các slot cùng tham chiếu.
- Quyền dùng module `schedule` (view/write/delete). Mọi thao tác có audit: `broadcast.create|update|publish|unpublish|delete`.
- Nhắm theo **khu vực**, chưa nhắm từng thiết bị (manifest dựng theo nhóm `khu vực.khung giờ.loại màn`). Nhắm từng thiết bị cần manifest theo thiết bị.

## API (`/admin/v1/broadcast`)
`GET /`, `GET /:id`, `POST /`, `PUT /:id`, `POST /:id/publish`, `POST /:id/unpublish`, `DELETE /:id`. Bảng: migration `0020_broadcast_programs.sql`.

## Thông báo khẩn (chữ chạy gửi ngay)

Trang **Thông báo khẩn** (menu Quảng cáo, quyền `schedule`): nhập nội dung ≤ 200 ký tự, thời gian hiển thị 3–120 giây (giới hạn của lệnh `message`), chọn đích (tất cả / thang máy / TV / LED P5) và khu vực. API: `POST /admin/v1/broadcast/notice` (`schedule:write`) đặt lệnh `message` vào hàng đợi của từng thiết bị **đã duyệt (trust ≥ 1) và không bị chặn** khớp bộ lọc: thang máy/LED nhận `{text, duration_s}`, TV nhận `{text, seconds}`. Tối đa 500 thiết bị mỗi lần, 10 lần gửi / 10 phút / người; lệnh hết hạn sau 10 phút. Trả `{matched, queued, skipped}` (`skipped` = hàng đợi thiết bị đầy). Lịch sử: `GET /admin/v1/broadcast/notice` (30 lần gần nhất, lấy từ `audit_log` action `broadcast.notice`, không thêm bảng). Thiết bị nhận ở lần heartbeat kế tiếp; app phải hiển thị lệnh `message` (Signage Player: xem việc bên app).

## Chép ra USB

`GET /admin/v1/broadcast/:id/usb-package` (`schedule:view`) trả `{folder:'ANIO', playlist, files:[{name,url,sha256,size_bytes}], total_bytes}`; chỉ khi mọi tệp đã duyệt/sẵn sàng (422 `media_not_ready`/`no_items`). `playlist` là nội dung `playlist.json` mà Signage Player đọc (`PlaylistIo.parse` và `UsbScanner`):

```json
{ "version": "bp<id>-v<n>", "name": "...", "header": "...", "footer": "...",
  "items": [ { "id": "<creative_id>", "type": "video|image", "url": "001-xxx.mp4", "file": "001-xxx.mp4", "duration": 15, "checksum": "<sha256>" } ] }
```

`file` dành cho nguồn USB (`UsbScanner.spec` đọc `items[].file` + `duration`), `url`/`id`/`checksum` dành cho `PlaylistIo.parse`. Ảnh mặc định 10 giây. Tên tệp `NNN-<id>.<đuôi>` giữ đúng thứ tự phát. URL tệp ký có hạn 1 giờ. Trên web, nút **Chép ra USB** dùng File System Access API (`showDirectoryPicker`, Chrome/Edge): tạo thư mục `ANIO`, tải từng tệp, kiểm sha256 rồi ghi `playlist.json`; trình duyệt khác tải `playlist.json` + `danh-sach-tep.txt` để chép tay. Lưu ý: `UsbScanner` hiện chưa đọc `header`/`footer` trong playlist (cần app bổ sung nếu muốn chữ đầu/cuối khi phát từ USB).

## Bàn làm việc, Phân phối thông minh, Hàng đợi & Nhật ký

Nhóm menu **Phát sóng nội bộ** (tham khảo QuangBáo Cloud). API đều ở `/admin/v1/broadcast-insights` (file `services/api/src/routes/broadcast-insights.ts`), chỉ đọc dữ liệu có sẵn, **không thêm bảng/migration**; chỉ ghi audit `broadcast.recommend`.

- **Bàn làm việc** (`GET /summary`, `schedule:view`): số chương trình đang phát / đã xuất bản / nháp / hết hạn, tệp kho chờ duyệt, thiết bị đã duyệt trực tuyến/ngoại tuyến theo khu vực (trực tuyến = có tín hiệu trong 20 phút), thiết bị chờ cấp quyền, 5 thông báo khẩn gần nhất và số lệnh chờ/lỗi. Lối tắt: tạo chương trình, gửi thông báo khẩn, tải media.
- **Phân phối thông minh** (`POST /recommend`, `GET /recommend` = lịch sử, `schedule:view`): nhập loại địa điểm, giờ, đối tượng, mật độ, thời tiết, ghi chú. Chấm điểm 0–100 các chương trình nháp/đã xuất bản bằng **luật** (không cần khóa AI, `engine: "rules"`): khung giờ bao trùm giờ chọn (+15 / −20), loại màn hợp địa điểm (+20/+10/−5), đối tượng trẻ em/thanh thiếu niên cần mọi tệp `kid_safe` (+15 / −40), mật độ, từ khóa ghi chú trùng tên chương trình (+10 mỗi từ), ưu tiên, bản nháp (−15), chương trình trống hoặc tệp chưa duyệt (−30), không có thiết bị khớp hoặc đều ngoại tuyến (−25/−10). Kết quả kèm lý do tiếng Việt, cảnh báo, nhóm thiết bị đích (khu vực, trực tuyến/tổng) và gợi ý tệp kho chưa dùng. Mỗi lần đề xuất ghi audit `broadcast.recommend` (lịch sử quyết định). Nút **Áp dụng** mở `/broadcast?program=<id>` (mở trang Chương trình phát sóng; trang đó có thể đọc tham số để mở sẵn chương trình). Chưa gọi mô hình AI ngoài; có thể bổ sung diễn giải bằng khóa riêng sau.
- **Hàng đợi & Nhật ký** (3 tab):
  - *Hàng đợi lệnh* `GET /queue` (`devices:view`; lọc `status`, `type`, `device_id`, `kind`, tìm kiếm, phân trang; kèm đếm theo trạng thái; lệnh quá hạn hiện `expired`). Hủy dùng `POST /admin/v1/devices/:id/commands/:cid/cancel`, thử lại tạo lệnh mới bằng `POST /admin/v1/devices/:id/commands` (cần `devices:write`).
  - *Nhật ký phát sóng* `GET /logs` (`schedule:view`): `audit_log` có action `broadcast.*`, tìm kiếm + lọc hành động + phân trang.
  - *Sự kiện thiết bị* `GET /events/logs` (bảng `device_logs`) và `GET /events/heartbeat` (bảng `ev_heartbeat`), `devices:view`. Nhật ký thiết bị giữ 7 ngày, heartbeat theo chính sách lưu giữ.


## Mẫu bố cục đa vùng + xem trước (migration 0021)

- **Mẫu bố cục** (`/admin/v1/layout-templates`, quyền `schedule`): danh sách vùng theo % khung 9:16 hoặc 16:9; loại vùng `video`, `image`, `marquee` (chữ chạy), `clock`, `weather`, `qr`; tối đa 8 vùng, không vượt khung, mã vùng không trùng. 6 mẫu hệ thống (id `sys_*`: Chia đôi Dọc, Bán lẻ 3 vùng, Sảnh Tòa nhà Ngang, Sân bay Quốc tế, Menu Quầy Gọi món F&B, Kiosk Y tế & Bệnh viện) được nạp bởi migration; chỉ xem/dùng, không sửa/xóa (`422 system_template`).
- **Chương trình**: `layout` (`null` = màn đơn) được **chép** từ mẫu nên sửa/xóa mẫu không đổi chương trình đang phát; `item_zones` gán tệp vào vùng (`{creative_id: zone_id}`; tệp chưa gán vào vùng video/ảnh đầu tiên). Bảng phụ `broadcast_program_layouts`, `broadcast_item_zones` (không dùng ALTER TABLE như 0017/0018).
- **Manifest**: slot `bp_*` có thêm `layout` (xem DEVICE-PROTOCOL.md) kèm `creative_ids` theo vùng; `creative_ids` của slot không đổi nên thiết bị cũ vẫn phát tuần tự.
- **Web**: trang *Mẫu bố cục* (thẻ mẫu, trình soạn kéo-thả/đổi kích thước, nút *Sử dụng mẫu này* tạo chương trình nháp); *Xem trước* trong Chương trình phát sóng (trình phát mô phỏng với video/ảnh thật, chữ chạy, đồng hồ, header/footer, Tạm dừng/Phát lại, 9:16/16:9) và nút *Xem trước* ở từng tệp trong Kho tư liệu.
- **Văn bản định dạng (vùng `text`/`marquee`)**: trình soạn ở bước 02 có thanh công cụ (đậm/nghiêng/gạch chân/gạch ngang, độ đậm Mảnh→Rất đậm, phông, cỡ chữ, khoảng cách chữ, màu chữ, màu nền chữ, căn trái/giữa/phải/đều, giãn dòng, xóa định dạng; Enter xuống dòng, Ctrl+B/I/U; dán chỉ nhận văn bản thuần). Lưu `rich` (HTML con đã làm sạch) **và** `text` (thuần, dự phòng cho TV cũ). Máy chủ (`services/api/src/lib/layout.ts` → `@ams/shared` `sanitizeRich`) làm sạch lại và ghi đè `text` khi lưu mẫu/chương trình; chữ chạy bị ép một dòng ≤ 200 ký tự; vùng loại khác không giữ `rich`. Khung xem trước (bước 02, *Xem trước*, danh sách) vẽ `rich` bằng phần tử React, không dùng `innerHTML`. Cách TV vẽ: TV-APP-INTEGRATION.md mục 3d. Bản sao `apps/web-admin/src/lib/richtext.ts` phải giống hệt `packages/shared/src/richtext.ts` (test đối chiếu).
- **Hạn chế**: Signage Player hiện chưa vẽ nhiều vùng (vẫn phát tuần tự một vùng); thời tiết và mã QR trong bản xem trước là hình minh họa.


## Trình tạo 4 bước, chọn thiết bị và đẩy ngay (migration 0022)

- **Web** (`Chương trình phát sóng` → *Tạo chương trình*): modal toàn màn hình 4 bước: *01 Thông tin chung* (tên, loại màn, hướng, mẫu bố cục) → *02 Thiết kế phân vùng* (danh sách lớp, khung kéo-thả/đổi kích thước, thêm vùng video/ảnh/chữ chạy/văn bản/đồng hồ/thời tiết/QR, mẫu nhanh, thuộc tính, gắn tư liệu vào từng vùng, *Xem trước*) → *03 Chọn thiết bị* (từng thiết bị hoặc theo khu vực) → *04 Lập lịch & Phát hành* (ngày, giờ, ưu tiên, tóm tắt, xem thử ngay). *Lưu nháp* không gửi gì xuống thiết bị; *Phát hành* lưu, xuất bản rồi đẩy lệnh.
- **Chọn thiết bị**: bảng phụ `broadcast_program_devices(program_id, device_id)` (không dùng ALTER). `device_ids` (≤ 500) trong POST/PUT; mỗi thiết bị phải tồn tại, đã duyệt (trust ≥ 1), không bị khóa, đúng loại màn (`duplicate_devices`, `device_not_found`, `device_not_approved`, `device_kind_mismatch`). Không chọn thiết bị nào = lọc theo `regions` như trước. `GET /devices-pick?target=&regions=&q=` trả danh sách thiết bị hợp lệ (tối đa 500, `truncated`).
- **Manifest theo thiết bị**: chương trình có thiết bị riêng chỉ xuất hiện trong manifest nhóm `region.daypart.modelClass.d-<deviceId>` của đúng các thiết bị đó (nhóm này chỉ phục vụ qua `/v1/manifest` có xác thực, route công khai `/v1/manifest/g/...` từ chối); thiết bị khác không thấy.
- **Đẩy ngay**: xuất bản, sửa chương trình đang phát (hợp thiết bị cũ + mới) và dừng phát/xóa đều xếp lệnh `refresh_manifest` (idempotency theo chương trình + phiên bản) và trả `push: {matched, pushed, skipped}`. `GET /:id/delivery` trả từng thiết bị kèm trạng thái lệnh (`pending|delivered|acked|failed|expired`) và trực tuyến/ngoại tuyến; giao diện tự làm mới 4 giây.
- **Hạn chế**: thời lượng từng tệp chưa lưu trong chương trình; nút ẩn lớp chỉ áp dụng cho trình soạn/xem trước; Signage Player chưa vẽ đa vùng.


## QR, thời tiết và xem trước video

- **Vùng QR** (bước 02 trình hướng dẫn / Mẫu bố cục): 3 chế độ — nhập URL/văn bản (QR tạo ngay trong trình duyệt, thư viện `qrcode-generator`), VietQR (chọn ngân hàng + số tài khoản + số tiền + nội dung → URL ảnh công khai `img.vietqr.io`, không dùng khóa API), hoặc tải ảnh QR (≤ 200 KB, lưu dạng data URL trong bố cục).
- **Vùng thời tiết**: chế độ cố định (chọn thành phố hoặc nhập toạ độ) hoặc GPS (`navigator.geolocation`); dữ liệu từ Open-Meteo, làm mới 10 phút.
- **Xem trước video**: `GET /storage/object/*` hỗ trợ `Range` (206/416, `Accept-Ranges`). Khi R2 không có khóa S3, Worker tự ký URL xem (HMAC bằng `OBJECT_STORE_SIGNING_SECRET` hoặc `SESSION_SECRET`) thay vì URL presign giả (trước đây gây 403/khung đen). `preview_url` có cho mọi media đã có `storage_key`; trình xem hiện lỗi cụ thể, nút "Tải lại", bật tiếng và thanh tua.
