# Nhóm thiết bị, địa điểm và âm lượng từ xa (d-tree)

Menu **Thiết bị** (nhóm riêng trong thanh bên) gồm 3 trang, cùng dùng quyền module `devices` (`view` để xem, `write` để sửa; `super_admin` thấy tất cả; không thêm quyền mới):

| Trang | Đường dẫn | Nội dung |
|---|---|---|
| Danh sách thiết bị | `/devices` | trang cũ (ghép mã, cấp quyền, lệnh); ngăn chi tiết có thêm mục Nhóm / Địa điểm / MAC / Serial |
| Nhóm thiết bị | `/device-groups` | cây phân nhóm + thiết bị theo nhóm + âm lượng từ xa |
| Địa điểm | `/locations` | nơi đặt thiết bị |

Ảnh chụp 1440px: `docs/screenshots/d-tree/`.

## Mô hình dữ liệu (migration `0026_device_groups_locations.sql`)

- `device_groups(id, parent_id, name, sort, created_at, deleted_at)`: cây lồng nhau, tối đa 6 cấp, tên không trùng trong cùng nhóm cha, xóa mềm.
- `locations(id, name, address, province, district, lat, lng, venue_type, contact_name, contact_phone, notes, status, created_at, updated_at, deleted_at)`. `venue_type`: `supermarket, airport, elevator, fnb, hospital, hotel, other`.
- `device_profiles` thêm cột `group_id`, `location_id`, `mac`, `serial`, `volume`, `volume_at`. Mỗi thiết bị thuộc **một** nhóm và tối đa **một** địa điểm. Dùng `device_profiles` (1-1 với `devices`) thay vì thêm cột vào bảng `devices` nóng; dòng được tạo bằng upsert khi cần.
- Không có `tenant_id`: bảng `devices` là tài nguyên nội bộ của nhà vận hành, mọi route ở `/admin/v1` (tài khoản khách bị chặn ở `requireInternal`). Không seed thiết bị hay nhóm giả.
- SQL dùng được trên Postgres, SQLite và D1 (không giao dịch tương tác; chia lô ≤100 tham số).

## API (`/admin/v1`, xem `docs/openapi/ams-admin-api.yaml`)

| Route | Việc |
|---|---|
| `GET /device-groups` | cây + số thiết bị trực tiếp, số cộng dồn lên cha, số trực tuyến, số chưa xếp nhóm |
| `POST /device-groups`, `PATCH /:id`, `DELETE /:id` | thêm, đổi tên/chuyển, xóa. Xóa **dọn nhóm con và thiết bị lên nhóm cha** (về "Chưa xếp nhóm" nếu là nhóm gốc), không mất thiết bị. Chuyển vào chính nó/nhóm con: `422 group_cycle` |
| `GET /device-groups/devices?group_id=<id>\|none&include_children=0&filter=status:online\|offline,location_id:<id>&q=` | thiết bị theo nhóm (kèm nhóm con); tìm theo tên, id, MAC, serial, địa điểm, model |
| `PUT /device-groups/assign` `{device_ids[≤500], group_id\|null}` | chuyển nhóm hàng loạt |
| `PATCH /device-groups/devices/:deviceId` | nhóm, địa điểm, MAC (chuẩn hóa `AA:BB:..`, trùng: `409 mac_taken`), serial, tên |
| `POST /device-groups/:id/volume` `{percent, include_children}` | đặt âm lượng hàng loạt: mỗi thiết bị một lệnh `set_volume`; thiết bị chưa ghép/cấp quyền hoặc bị chặn được **liệt kê trong `skipped`** |
| `GET/POST /locations`, `GET/PATCH/DELETE /locations/:id`, `PUT /locations/assign` | địa điểm. Xóa địa điểm còn thiết bị: `409 location_has_devices` trừ khi gửi `?move_to=<id>` hoặc `?move_to=none` |

Mọi thay đổi ghi `audit_log`: `device_group.create/update/delete/assign/set_volume`, `location.create/update/delete/assign`, `device.placement`. ID trong đường dẫn luôn được kiểm tra tồn tại (404), lệnh theo thiết bị bị ràng buộc `device_id`.

## Âm lượng từ xa

Dùng cơ chế lệnh sẵn có (`device_commands`): lệnh `set_volume {percent}` (tên tham số giữ `percent` như giao thức hiện hành; mở rộng cho cả TV). Thiết bị nhận ở **heartbeat kế tiếp**, ack, và báo âm lượng thật bằng trường tùy chọn `volume` trong heartbeat. Giao diện:

- Thanh trượt 0-100: hiện giá trị bạn kéo ngay (lạc quan), chờ 500 ms sau lần kéo cuối rồi gửi **một** lệnh. Trạng thái lấy từ máy chủ: *Đang chờ thiết bị nhận lệnh* → *Đã gửi, chờ xác nhận* → *Thiết bị đã xác nhận* / *Thiết bị báo lỗi* / *Lệnh hết hạn*. Bên cạnh luôn có "Thiết bị báo: N%".
- Trang tự hỏi lại mỗi 15 giây khi còn lệnh chờ.
- Khóa khi thiết bị chưa ghép mã / chưa cấp quyền / bị chặn hoặc người dùng chỉ có quyền xem.
- "Đồng bộ lại ngay" = lệnh `refresh_manifest`. "Xem màn hình" bị khóa với chú thích "Cần bản app mới" vì lệnh `screenshot` chưa có trong app (đặc tả ở `DEVICE-PROTOCOL.md` 6.2).
- App TV phải làm gì: `TV-APP-INTEGRATION.md` mục 3c. Heartbeat: `DEVICE-PROTOCOL.md` mục 6.

## Đăng ký thiết bị

Mô hình AMS **không cho đăng ký trước**: thiết bị tự đăng ký bằng khóa công khai (`/v1/register`) rồi TV ghép mã 6 số, thang máy/LED được cấp quyền. Vì vậy không có hộp thoại "Đăng ký màn hình mới". Sau khi thiết bị xuất hiện, đặt nhóm, địa điểm, MAC, serial và tên vị trí ở ngăn chi tiết (trang Danh sách thiết bị) hoặc nút "Nhóm / địa điểm" ở trang Nhóm thiết bị.

## Khác biệt so với trang tham khảo

Cột "Chương trình đang phát" chưa có (AMS chưa lưu chương trình đang phát theo thiết bị); thay bằng cột Kết nối: *Đã đồng bộ* khi đã có heartbeat, *Chờ kết nối* nếu chưa.
