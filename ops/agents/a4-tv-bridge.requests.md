# Yêu cầu thay đổi từ a4-tv-bridge

Bối cảnh: `docs/TV-APP-INTEGRATION.md`. Máy chủ đã có `creatives.overlay` (TEXT JSON), `creatives.format`, `PUT /v1/media/:id/overlay`, manifest phát `overlay`. Phát hiện khi đối chiếu `packages/shared/src/overlay.ts`: `parseOverlay` **bỏ trường lạ**, nên các trường TV cần dưới đây hiện bị mất khi lưu.

## 1. a1-api-core (cũng nhờ f1 sở hữu `packages/shared`)
1. Thêm vào `CreativeOverlay` / `parseOverlay` các trường tùy chọn: `qr.hint` (≤40), `kid_safe` (boolean, mặc định false), `contexts` (mảng con của `lock|fullscreen|pause|corner`, mặc định `['fullscreen']`), `duration_s` (5..60), `safe_area` {top,right,bottom,left} 0..15. Lược đồ tham chiếu: `integrations/brainrot-tv/schema/overlay.ts`.
2. `kid_safe=true` và `contexts` chứa `lock` chỉ được đặt bởi người duyệt có quyền riêng (ví dụ `media:review`), không phải khách tự nhập; mọi sửa overlay sau khi duyệt phải reset `review_state` (hiện đã reset, giữ nguyên).
3. Kiểm ảnh nền: creative `fullscreen` dạng ảnh phải 16:9, từ 1280×720 đến 7680×4320 (HD→8K); từ chối 422 nếu sai. Giới hạn dung lượng ảnh ≤ 15 MB cho TV (bộ giải mã).
4. Khi `overlay.duration_s` có, đồng bộ `creatives.duration_s` để manifest có thời lượng (client có dự phòng nhưng vẫn nên khớp).
5. Quy trình duyệt "phù hợp trẻ em" + danh sách ngành cấm (rượu bia, thuốc lá, cá cược, vay nóng, người lớn, thuốc/TPCN).
6. Tên miền CDN công khai (`MEDIA_PUBLIC_URL`) để đưa vào allow-list của TV (hiện giữ chỗ `anio.vn`).

## 2. f3-web
Form creative: các ô sponsor_tag, brand_label, headline, hotline (số/nhãn/phụ), QR (liên kết/nhãn/tiêu đề/gợi ý), scte_id, badges, `contexts`, `duration_s`; bộ đếm ký tự theo giới hạn của `parseOverlay`; xem trước 16:9 theo ADS.png (cột 69 % + bảng khóa 31 %); cảnh báo "chưa duyệt kid_safe thì không lên màn khóa". Ô `kid_safe` chỉ hiện cho người duyệt.

## 3. a3-gateway
1. Truyền nguyên `overlay` (đã có) **và** không bỏ các trường mở rộng ở mục 1 khi `parseOverlay` được cập nhật (chỉ cần dùng chung `@ams/shared`).
2. Chấp nhận trường tùy chọn `ctx` (`lock|fullscreen`) trong sự kiện impression; bỏ qua nếu không biết (TV đã gửi sẵn).
3. Xác nhận quy tắc đang dùng: `IMPRESSION_MIN_VCR`=100, `played_ms ≥ 0.9·duration`, 120 sự kiện/giờ; TV chỉ gửi lượt trọn vẹn. Nếu muốn tính lượt xem một phần thì cần thống nhất lại.
4. Cho TV lấy mã ghép đôi: hiện TV gọi `POST /v1/pair` thăm dò; xác nhận giới hạn "6 lần/giờ/thiết bị" và có endpoint đọc trạng thái nhẹ nếu muốn giảm thăm dò.
5. Ưu tiên/tần suất: client tự áp 30 lượt/giờ, cách ≥60 s, cùng creative ≥5 phút; cho biết nếu máy chủ muốn gửi các tham số này trong manifest.

## 4. f2-infra
Cung cấp tên miền media cố định (HTTPS, Range, không redirect) và, nếu muốn, ghim chứng chỉ; cần để TV tải creative.
