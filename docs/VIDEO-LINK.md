# Video dán link (stream)

Thay vì tải video lên hệ thống, bạn có thể **dán link https** của video. TV phát trực tiếp từ link đó: máy chủ AMS **không tải, không chuyển mã, không lưu** video nên không tốn tài nguyên hệ thống, và **chất lượng giữ nguyên** (không giảm độ phân giải, bitrate hay fps; TV 2K đến 8K đều nhận, độ nét phụ thuộc đường truyền và TV).

## Cách dùng
1. Vào **Nội dung & Media > Tải nội dung mới > Dán link video** (khách hàng: cổng khách hàng; nhân viên: chọn khách sở hữu).
2. Dán link, nhập **thời lượng (giây)** (bắt buộc; TV 5-60, thang máy 10-30, LED 5-15), chọn loại màn hình (thang máy/LED khai báo đúng độ phân giải).
3. Hệ thống chỉ kiểm tra đầu link (HEAD + 64 KB đầu) rồi đưa video vào hàng chờ duyệt.
4. Người duyệt mở **xem trước**, xem **toàn bộ** video, tick "Tôi đã xem toàn bộ nội dung", ghi chú và duyệt. Sau đó gắn vào chiến dịch như bình thường.

## Link nào dùng được
| Loại | Ví dụ | Ghi chú |
|---|---|---|
| Tệp trực tiếp | `https://cdn.ten-mien.vn/spot.mp4`, `.webm` | Mọi host/CDN https, bucket công khai R2/S3 |
| HLS | `.m3u8` (Cloudflare Stream: `.../manifest/video.m3u8`) | Phải là bản VOD (có `#EXT-X-ENDLIST`), không phải live |
| DASH | `.mpd` | Xem trước trong trình duyệt không hỗ trợ, người duyệt mở bằng trình phát DASH |

**Không dùng được**: trang YouTube, Vimeo, Facebook, TikTok, Google Drive (TV không phát được trang xem video; ngoài phạm vi). Link phải mở được công khai, không cần đăng nhập. Chỉ https, cổng 443, không `user:pass@`, không địa chỉ IP, không tên miền nội bộ; tối đa 3 lần chuyển hướng.

## Chi phí và chất lượng
Băng thông do **nơi lưu trữ (host/CDN) và TV** chịu, không phải AMS. Chọn host có CDN và tốc độ ổn định; faststart (moov ở đầu tệp MP4) giúp TV bắt đầu phát nhanh. Codec H.264/HEVC/AV1/VP9 được khuyến nghị; codec khác chỉ bị **cảnh báo**, không bị từ chối. Độ phân giải, bitrate, fps chỉ là thông tin tham khảo.

## An toàn và kiểm soát
- Nội dung xa không quét mã độc và không đóng băng được, nên luôn chờ **kiểm tra thủ công** (`remote_stream_unscanned`); người duyệt phải xem toàn bộ.
- Khi duyệt, hệ thống kiểm tra lại link: nếu nội dung đã đổi từ lúc xem, duyệt bị từ chối (409) để xem lại.
- Duyệt gắn với **URL + ETag + độ dài + Last-Modified** (HLS/DASH hoặc host không trả validator: thêm hash 64 KB đầu). Job kiểm tra lại tối đa mỗi giờ/creative; nếu khác, hoặc link lỗi 4xx (hoặc 5xx/mất kết nối 2 lần liên tiếp), creative **bị loại khỏi manifest**, quay về chờ duyệt thủ công và phải xem/duyệt lại.
- Chống SSRF: kiểm tra mỗi bước chuyển hướng, chặn IP nội bộ/loopback/link-local/metadata, kể cả tên miền giải ra IP nội bộ (trên Node; Cloudflare Worker không kết nối được địa chỉ riêng).

## API
- `POST /admin/v1/media/link`, `POST /portal/v1/media/link`: `{url, duration_sec, target_type?, width?, height?, customer_id? (admin), format?, overlay?, kind?}`. Giới hạn 12 lần/phút/người dùng. Phản hồi gồm `delivery:"stream"` và `stream{...}`.
- `POST /.../media/:id/recheck`: kiểm tra lại link, nhận nội dung mới để người duyệt xem lại.
- `POST /admin/v1/media/:id/approve` (và `/scan-review`): thêm `confirm_full_view: true` cho creative stream.
- Manifest/giao thức cho app TV: `DEVICE-PROTOCOL.md` mục 7.0.
