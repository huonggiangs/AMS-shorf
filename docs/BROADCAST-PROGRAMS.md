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
