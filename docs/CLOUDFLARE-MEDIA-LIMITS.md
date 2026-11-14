# Media trên Cloudflare: giới hạn và đường kiểm tra thay thế

**Đọc trước khi cho khách trả tiền tải tệp lên bản triển khai Cloudflare.**

## Điều này KHÔNG phải là gì
Đường kiểm tra dưới đây **không phải phần mềm diệt virus**. Nó không phát hiện mã độc nhúng trong dữ liệu hợp lệ về cấu trúc (ví dụ khai thác lỗi giải mã của một trình phát, metadata/EXIF độc, dữ liệu sau khung hình), không chạy chữ ký, không giải mã/chuyển mã. 'clean' ở đây nghĩa là "tệp thuộc danh sách cho phép hẹp và cấu trúc container nhất quán", **không** nghĩa là "đã quét sạch". Rủi ro còn lại: tệp độc có cấu trúc đúng sẽ được đánh dấu clean. Giảm thiểu: duyệt nội dung bằng mắt (bắt buộc, `media:approve`), TV phát bằng trình phát hệ thống sandbox, và tắt `CF_VALIDATOR_MARK_CLEAN` nếu muốn mọi tệp đều qua tay người.

## Vì sao cần đường riêng
Worker không chạy được `ffmpeg` hay `clamd` (xem `docs/DEPLOY-CLOUDFLARE.md`). Trước đây creative tải lên trên Cloudflare mãi ở `scan_state='pending'`, cổng duyệt/manifest (đúng) chặn chúng, nên không ai phát được quảng cáo mới.

## Luồng (API Worker, `services/api/src/lib/cf-creative-validate.ts`)
1. `POST /media/:id/confirm` (đã có): kiểm kích thước/độ phân giải/thời lượng khai báo, tính sha256 nếu ≤128 MB, ghi outbox `media.uploaded` cùng giao dịch.
2. Outbox đẩy vào `JOBS_QUEUE`; consumer (chính API Worker, `queue()` -> `handleBatch`) chạy `createCfCreativeValidator(rt).subscribe()`. Cron mỗi phút gọi `sweep(5)` bắt các creative `pending` bị mất tin nhắn.
3. Validator đọc tệp từ R2 và kiểm: magic bytes (png/jpeg/webp/mp4), MIME khai báo khớp, kích thước thật khớp `size_bytes`, kích thước ảnh/video đọc từ chính tệp khớp khai báo và trong trần (≤8192 px mỗi chiều, ≤36 Mpx), cấu trúc: PNG chuỗi chunk tới IEND và không có byte thừa; JPEG có SOF và kết thúc FFD9; WebP RIFF size khớp; MP4 có `ftyp` brand cho phép (`isom, iso2, iso4-6, mp41, mp42, avc1, M4V, dash, cmfc`), chuỗi box khớp đúng cuối tệp, có `moov`, `mdat`, `mvhd`, track video với `tkhd`; thời lượng `mvhd` khớp khai báo (±1,5 s) và khoảng của loại màn (thang máy 10-30 s, LED 5-15 s). Tính sha256.
4. Kết quả, ghi bằng `UPDATE ... WHERE scan_state='pending'` (không đè kết quả khác): tất cả đạt -> `clean`; bất cứ điều gì khác -> `needs_manual_review` (WebM, MOV/QuickTime, tệp > 48 MB không đọc vào bộ nhớ Worker 128 MB, tệp có dữ liệu thừa, sai khai báo, v.v.). Lý do và engine ghi ở bảng `creative_validation` (`engine = 'cf-validator-v1'`).
5. Cổng quét **không đổi**: chỉ `clean` được duyệt/phát; `needs_manual_review` bị chặn kể cả khi bật `allow_unscanned_creatives` (mã `creative_needs_manual_review`); manifest gateway vẫn lọc `scan_state = 'clean'`.

## Duyệt tay (admin, quyền `media:approve`)
- `GET /admin/v1/media/scan-review/queue`: hàng chờ kèm lý do, engine, sha256.
- `POST /admin/v1/media/:id/scan-review` `{decision:'approve'|'reject', note}` (ghi chú ≥3 ký tự): approve -> `scan_state='clean'` (vẫn phải duyệt nội dung bằng `/approve`); reject -> `scan_state='failed'`, `review_state='rejected'`. Có điều kiện `WHERE scan_state='needs_manual_review'` nên hai admin bấm cùng lúc chỉ một người thắng (người kia 409). Mỗi quyết định ghi audit (`media.scan_review.approve|reject`, kèm lý do tự động trước đó) và `creative_validation.engine='manual'`. Người duyệt tay chịu trách nhiệm xem tệp (tải về/xem trước), hệ thống không thay họ quét.

## Cấu hình
`CF_VALIDATOR_MARK_CLEAN=0`: không bao giờ tự ghi `clean`, mọi tệp vào hàng chờ duyệt tay. Mặc định bật. Biến `allow_unscanned_creatives` giữ nguyên nghĩa (không khuyến nghị cho khách trả tiền).

## Còn thiếu so với đường VPS (media-worker + ClamAV)
| | Cloudflare (đường này) | VPS: `services/media-worker` + ClamAV |
|---|---|---|
| Quét chữ ký mã độc | **không** | có (clamd, `CLAMAV_REQUIRED=1` thì bắt buộc) |
| Giải mã/ffprobe thật | không: chỉ đọc header container | có: ffprobe, phát hiện tệp hỏng |
| Chuyển mã về hồ sơ TV-safe, rendition, manifest | không | có (ffmpeg) |
| Tệp lớn (>48 MB, video 500 MB cho TV) | vào duyệt tay (không đọc được) | xử lý (đọc theo giới hạn `MEDIA_MAX_BYTES`) |
| WebM / MOV | duyệt tay | hỗ trợ |
| Tệp liên kết (YouTube/Drive/Dropbox) | không tải về | chưa (xem `ops/agents/m1-media-worker.requests.md`) |
| Phán quyết | 'clean' = allow-list + cấu trúc | 'clean' = clamd sạch |

Khuyến nghị: khách trả tiền, đặc biệt tệp lớn và video, nên dùng đường VPS (`COMMERCIAL-READINESS` 2.6, P1-8). Đường Cloudflare phù hợp pilot với ảnh PNG/JPG và MP4 nhỏ do nhân viên kiểm soát.

## Test
`services/api/test/cf-media.test.ts`: bộ dựng png/jpg/mp4 tối thiểu; 12 loại tệp bất thường -> manual review; cổng quét (`needs_manual_review` không duyệt được kể cả `allow_unscanned`); luồng queue -> validator -> approve; duyệt tay có audit, 409 khi duyệt lại; tự choi -> không bao giờ phát; không đè kết quả có sẵn; `CF_VALIDATOR_MARK_CLEAN=0`; sweep.
