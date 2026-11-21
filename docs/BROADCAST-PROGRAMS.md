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
