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

## Giới hạn tải lên (video quảng cáo cho TV) — w-web
Nguyên nhân gốc báo cáo "đã upload nhưng không duyệt được" (tệp thật `JOURNEY TO VIETNAM ... .mp4`: 202 MB, 232,5 s, **AV1 4K 3840x2160**, HE-AAC):
1. Tệp video thật vượt mọi cổng tự động trên Cloudflare (> 48 MB không đọc vào bộ nhớ Worker; không có ffmpeg để chuyển mã) nên vào `needs_manual_review`; thẻ ở "Nội dung & Media" vẫn hiện nút **Duyệt** và bấm vào chỉ báo lỗi chung (422 `creative_needs_manual_review`), trong khi hàng chờ "Duyệt creative" là trang khác và duyệt xong còn phải duyệt nội dung lần nữa ở trang Media.
2. Với tệp 32-128 MB, `confirm` đọc cả tệp vào bộ nhớ Worker (128 MB) để băm sha256 rồi chép sang khóa mới: có thể hết bộ nhớ, tệp kẹt ở `uploading`.
3. Không có kiểm tra codec: AV1/H.265 4K TV box không phát được, và Cloudflare không chuyển mã được.

Quy tắc đã mã hóa (`services/api/src/lib/creative.ts`: `VIDEO_RULES`, `DURATION_RANGE`; kiểm tra sớm ở `POST /media/upload-url`, đọc header MP4 ở `POST /media/:id/confirm`, validator `cf-creative-validate.ts`):

| | Quy tắc | Lỗi (mã) |
|---|---|---|
| Codec hình | H.264 (`avc1`/`avc3`) + AAC. AV1, H.265, VP9... bị từ chối, tệp bị xóa khỏi kho | 422 `unsupported_codec` |
| Độ phân giải video | cạnh dài <= 1920, cạnh ngắn <= 1080 (Full HD) | 422 `video_resolution_too_high` |
| Dung lượng video | <= 100 MB (mọi loại màn); thang máy <= 30 MB, LED <= 50 MB; khách còn hạn mức tài khoản (mặc định 30 MB/tệp) | 422 `file_too_large` |
| Thời lượng | TV 5-60 s, thang máy 10-30 s, LED 5-15 s | 422 `duration_out_of_range` |
| Ảnh | PNG/JPG <= 500 MB (TV) | |
| Định dạng | MP4 (khuyến nghị), MOV, WebM, PNG, JPG; magic bytes + MIME + kích thước thật | |

Khuyến nghị xuất video: H.264 High, 1920x1080, 24-30 fps, 6-10 Mbps, AAC 128 kbps, `-movflags +faststart`, 15-60 s (ffmpeg: `ffmpeg -i in.mp4 -vf scale=1920:-2 -c:v libx264 -crf 23 -c:a aac -b:a 128k -movflags +faststart out.mp4`).

**Tải lên đi thẳng lên R2** bằng URL ký trước (một PUT, tối đa 5 GiB theo R2): Worker không nhận thân tệp nên không vướng giới hạn 100 MB của request. Không cần multipart vì giới hạn nghiệp vụ (100 MB) thấp hơn nhiều. Điều kiện hạ tầng: bucket R2 phải bật **CORS** cho origin `https://ams.anio.vn` (method `PUT`, header `Content-Type`); thiếu CORS thì trình duyệt báo lỗi mạng và UI hiện hướng dẫn. URL ký hết hạn sau 15 phút.

**Đọc header MP4** (`lib/mp4-probe.ts`, chạy trong Worker, không native): duyệt các box cấp cao bằng đọc đoạn nhỏ (`ObjectStore.getRange`, R2 range) bỏ qua `mdat`, đọc `moov` (<= 16 MB, ở đầu hoặc cuối tệp): `mvhd` (thời lượng), `tkhd` (rộng/cao), `stsd` (fourcc codec hình/tiếng). Dùng ở confirm (thay giá trị client khai báo) và cho tệp > 48 MB ở validator để người duyệt thấy thời lượng/kích thước thật.

**Băm/chép tệp ở confirm**: chỉ tệp <= 32 MB (bộ nhớ Worker). Tệp lớn hơn để `sha256 = NULL`, giữ khóa tải lên; thiết bị đối chiếu khi tải.

## Duyệt một bước và tự khắc phục
- Mọi trạng thái chưa duyệt được hiện lý do + việc cần làm ở thẻ Media (`blocker.code/action` trong `GET /media`): `confirm` (Xác nhận lại), `recheck` (Kiểm tra lại), `manual_review` (Xem và duyệt), `reupload`, `none`.
- `POST /admin/v1/media/:id/approve` nhận thêm `manual_review_note` (>= 3 ký tự): với tệp `needs_manual_review` thì xác nhận an toàn + duyệt nội dung trong MỘT giao dịch, ghi hai audit (`media.scan_review.approve`, `media.approve`), `creative_validation.engine='manual'`; vẫn gắn `content_version`. Không có ghi chú: vẫn bị chặn như cũ. Quét thật (`pending`, `unscanned`) không bao giờ bị bỏ qua bằng cách này.
- `POST /admin|portal/v1/media/:id/recheck` (quyền `media:write`): đặt `pending` + ghi lại việc `media.uploaded` vào outbox; không bao giờ ghi `clean` (chỉ validator Cloudflare / media-worker VPS quyết định). Chỉ cho `pending`, `needs_manual_review`, `unscanned`, `skipped`.
- UI "Duyệt creative" có ô "Đồng thời duyệt nội dung" (mặc định bật) và nút Kiểm tra lại.

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
