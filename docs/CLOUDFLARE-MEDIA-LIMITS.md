# Media trên Cloudflare: giới hạn và đường kiểm tra thay thế

**Đọc trước khi cho khách trả tiền tải tệp lên bản triển khai Cloudflare.**

## Điều này KHÔNG phải là gì
Đường kiểm tra dưới đây **không phải phần mềm diệt virus**. Nó không phát hiện mã độc nhúng trong dữ liệu hợp lệ về cấu trúc (ví dụ khai thác lỗi giải mã của một trình phát, metadata/EXIF độc, dữ liệu sau khung hình), không chạy chữ ký, không giải mã/chuyển mã. 'clean' ở đây nghĩa là "tệp thuộc danh sách cho phép hẹp và cấu trúc container nhất quán", **không** nghĩa là "đã quét sạch". Rủi ro còn lại: tệp độc có cấu trúc đúng sẽ được đánh dấu clean. Giảm thiểu: duyệt nội dung bằng mắt (bắt buộc, `media:approve`), TV phát bằng trình phát hệ thống sandbox, và tắt `CF_VALIDATOR_MARK_CLEAN` nếu muốn mọi tệp đều qua tay người.

## Vì sao cần đường riêng
Worker không chạy được `ffmpeg` (xem `docs/DEPLOY-CLOUDFLARE.md`). Trước đây creative tải lên trên Cloudflare mãi ở `scan_state='pending'`, cổng duyệt/manifest (đúng) chặn chúng, nên không ai phát được quảng cáo mới.

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
| Codec hình | TV/LED: H.264 (`avc1`/`avc3`) + AAC. **Thang máy: H.264 hoặc H.265 (`hvc1`/`hev1`) + AAC; VP9 (`vp09`) được nhận KÈM CẢNH BÁO** (bitrate khuyến nghị <= 16 Mbps). AV1, VP8, MPEG-4 Part 2... bị từ chối (và VP9/H.265 cho TV/LED), tệp bị xóa khỏi kho; thông báo dẫn người dùng tới nút "Tự động chuyển sang chuẩn phát được" ở hộp tải lên | 422 `unsupported_codec` |
| Độ phân giải video | TV/LED: cạnh dài <= 1920, cạnh ngắn <= 1080 (Full HD). Thang máy: dọc 9:16 từ 720×1280 đến 2160×3840 (4K) | 422 `video_resolution_too_high` / `creative_size_mismatch` |
| Dung lượng video | **thang máy <= 200 MB (mọi cỡ HD–4K)**, TV <= 100 MB, LED <= 50 MB; khách còn hạn mức tài khoản (mặc định 30 MB/tệp) | 422 `file_too_large` |
| Thời lượng | TV 5-60 s, thang máy 10-30 s, LED 5-15 s | 422 `duration_out_of_range` |
| Ảnh | PNG/JPG <= 500 MB (TV) | |
| Định dạng | MP4 (khuyến nghị), MOV, WebM, PNG, JPG; magic bytes + MIME + kích thước thật. MP4/MOV đọc `moov`, WebM đọc EBML (`webm-probe.ts`) để biết codec/kích thước/thời lượng thật | |

Khuyến nghị xuất video: H.264 High, 1920x1080, 24-30 fps, 6-10 Mbps, AAC 128 kbps, `-movflags +faststart`, 15-60 s (ffmpeg: `ffmpeg -i in.mp4 -vf scale=1920:-2 -c:v libx264 -crf 23 -c:a aac -b:a 128k -movflags +faststart out.mp4`).

**Hai đường tải lên (tự chọn theo cấu hình, từ 20/11/2026).**

1. **Mặc định, không cần khóa S3 và không cần CORS: qua Worker.** Nếu thiếu một trong `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` thì `R2ObjectStore.signedPut = false`; `POST /media/upload-url` trả `via:"proxy"` và `url:"/api/{admin|portal}/v1/media/:id/content"` (cùng origin). Trình duyệt `PUT` tệp (phiên đăng nhập + `X-CSRF-Token`, `Content-Type` = loại khai báo, `Content-Length` = `size_bytes` đã khai) tới đó; Worker ghi **thẳng luồng** vào R2 binding (`putStream`, không đọc cả tệp vào bộ nhớ), kiểm quyền `media:write`, phạm vi khách hàng, chỉ người tạo tệp, tệp còn `uploading` (<= 1 giờ), 60 lần/giờ/người, ghi audit `media.upload_proxy`. Rồi client gọi `/confirm` như cũ. **Giới hạn một PUT: 95 MB** (body Worker tối đa 100 MB). Tệp > 90 MB đi đường tải từng phần (mục dưới). Nếu store không hỗ trợ multipart thì `upload-url` vẫn trả 422 `file_too_large` "Tệp vượt 95 MB...". Mã lỗi: `length_mismatch`, `content_type_mismatch`, `length_required`, `not_uploader`, `invalid_state`, `upload_expired`, `file_too_large`.
2. **Tối ưu cho tệp lớn: URL ký trực tiếp lên R2** (khi đủ khóa S3). Mô tả bên dưới.

**Tải lên đi thẳng lên R2** bằng URL ký trước (một PUT, tối đa 5 GiB theo R2): Worker không nhận thân tệp nên không vướng giới hạn 100 MB của request. Đường này vẫn giữ nguyên (không đổi). Điều kiện hạ tầng: bucket R2 phải bật **CORS** cho origin `https://ams.anio.vn` (method `PUT`, header `Content-Type`); thiếu CORS thì trình duyệt báo lỗi mạng và UI hiện hướng dẫn. URL ký hết hạn sau 15 phút.

**Đọc header MP4** (`lib/mp4-probe.ts`, chạy trong Worker, không native): duyệt các box cấp cao bằng đọc đoạn nhỏ (`ObjectStore.getRange`, R2 range) bỏ qua `mdat`, đọc `moov` (<= 16 MB, ở đầu hoặc cuối tệp): `mvhd` (thời lượng), `tkhd` (rộng/cao), `stsd` (fourcc codec hình/tiếng). Dùng ở confirm (thay giá trị client khai báo) và cho tệp > 48 MB ở validator để người duyệt thấy thời lượng/kích thước thật.

**Băm/chép tệp ở confirm**: chỉ tệp <= 32 MB (`SHA_MAX_BYTES`, bộ nhớ Worker). Tệp lớn hơn **không băm SHA-256** (`sha256 = NULL`, không có giá trị đối chiếu cho thiết bị), giữ khóa tải lên; `/confirm` không bao giờ đọc tệp lớn vào bộ nhớ (chỉ đọc đoạn nhỏ để dò MP4).

## Duyệt một bước và tự khắc phục
- Mọi trạng thái chưa duyệt được hiện lý do + việc cần làm ở thẻ Media (`blocker.code/action` trong `GET /media`): `confirm` (Xác nhận lại), `recheck` (Kiểm tra lại), `manual_review` (Xem và duyệt), `reupload`, `none`.
- `POST /admin/v1/media/:id/approve` nhận thêm `manual_review_note` (>= 3 ký tự): với tệp `needs_manual_review` thì xác nhận an toàn + duyệt nội dung trong MỘT giao dịch, ghi hai audit (`media.scan_review.approve`, `media.approve`), `creative_validation.engine='manual'`; vẫn gắn `content_version`. Không có ghi chú: vẫn bị chặn như cũ. Quét thật (`pending`, `unscanned`) không bao giờ bị bỏ qua bằng cách này.
- `POST /admin|portal/v1/media/:id/recheck` (quyền `media:write`): đặt `pending` + ghi lại việc `media.uploaded` vào outbox; không bao giờ ghi `clean` (chỉ validator Cloudflare / media-worker VPS quyết định). Chỉ cho `pending`, `needs_manual_review`, `unscanned`, `skipped`.
- UI "Duyệt creative" có ô "Đồng thời duyệt nội dung" (mặc định bật) và nút Kiểm tra lại.

## Tự duyệt khi người có quyền duyệt tải lên (`media:approve`)
Nguyên nhân gốc báo cáo "Super admin tải video vẫn phải chờ duyệt": mọi creative tạo ra với `review_state='pending'`; chỉ `POST /media/:id/approve` mới đổi, và trên Cloudflare tệp còn bị `needs_manual_review`.
- Điều kiện (`services/api/src/lib/auto-approve.ts`): người tải lên `kind='internal'`, đang `active`, và hàm phân quyền hiện có `can(perms, role, 'media', 'approve')` đúng (không hard-code vai trò; gỡ quyền thì không tự duyệt); tệp qua kiểm tra spec ở `/confirm` (H.264/AAC, kích thước, thời lượng; sai spec vẫn 422 và bị xóa); `scan_state` là `clean` hoặc `needs_manual_review`; lý do của validator không chứa lỗi spec (`unsupported_codec`, `video_resolution_too_high`, `duration_out_of_range`, `duration_mismatch`, `dimensions_*`...).
- KHÔNG tự duyệt: khách/đối tác (kể cả qua `/portal`), `infected`, `failed`, `pending` (chưa quét), `unscanned/skipped`.
- Hành vi: `review_state='approved'`, `state='ready'`, `scan_state='clean'`; với `needs_manual_review` ghi `creative_validation.engine='auto-privileged'`; ghi audit `media.auto_approve` (lý do "tải lên bởi người có quyền duyệt"), `recordApproval` (gắn phiên bản nội dung) và `bumpManifest`.
- Hook: (1) cuối `POST /media/:id/confirm` (sau khi outbox/validator đã chạy); (2) cuối validator Cloudflare `finish()` (queue chạy sau confirm); (3) `sweepAutoApprove()` ở cron Worker mỗi phút và vòng outbox của API Node, để bắt tệp VPS khi media-worker quét xong sau confirm. Tệp nội bộ cũ còn `pending_review` đã `clean`/`needs_manual_review` sẽ được duyệt ở lần quét đầu tiên (có audit từng tệp).
- Công tắc: `settings.auto_approve_privileged_uploads = '0'` tắt tính năng (mặc định bật).

## Ảnh đại diện (thumbnail) tạo ở trình duyệt
Worker không có ffmpeg, nên web-admin tự tạo: `<video>`+canvas lấy khung ~1 s (hoặc 10% thời lượng nếu video < 10 s), rộng 320 px, JPEG chất lượng 0,7 (giảm dần đến khi <= 150 KB; ảnh thì co chính ảnh). Sau `PUT` tệp chính và `/confirm`, gửi `PUT /media/:id/thumbnail` (raw body JPEG/WebP, quyền `media:write`, theo phạm vi khách hàng như các route media khác, <= 150 KB, kiểm tra magic bytes). Lưu ở kho tệp key `media/{customer}/{id}/thumb.jpg`, bảng `creative_thumbnails` (migration 0016). `GET /media/:id/thumbnail` stream từ kho (xác thực bằng cookie phiên, `Cache-Control: private`); `thumb_url` trả `/api/{admin|portal}/v1/media/{id}/thumbnail?v=<thời điểm tạo>`. Lỗi tạo/gửi ảnh không làm hỏng việc tải lên. Tệp tải trước đây chưa có ảnh: khi mở trang Media, web-admin tự tạo tuần tự tối đa 3 tệp mỗi lần (im lặng khi lỗi), và thẻ có nút "Tạo ảnh đại diện" để làm thủ công.
- **CORS R2 cho GET**: tạo ảnh từ tệp đã tải lên dùng `<video crossOrigin="anonymous">` đọc URL ký GET trên R2; thiếu CORS `GET` thì canvas bị chặn (tainted) và tệp cũ chỉ không có ảnh (tệp mới tạo ảnh từ tệp trên máy, không cần CORS). `scripts/deploy-cloudflare.mjs` (`ensureMediaCors`) đã đặt origin `https://ams.anio.vn` với `GET, PUT, HEAD`, header `*`, nên chạy lại `scripts\DEPLOY-AMS-ANIO-VN.bat` là đủ; nếu đặt tay: R2 > bucket media > Settings > CORS policy, thêm `GET` và `HEAD`.

## Còn thiếu so với đường VPS (media-worker)
| | Cloudflare (đường này) | VPS: `services/media-worker` + ClamAV |
|---|---|---|
| Quét chữ ký mã độc | **bỏ hẳn (cả hai đường)**: tệp ảnh/video chuẩn không chứa mã thực thi; kiểm tra cấu trúc + chuyển mã làm sạch tệp | bỏ hẳn |
| Giải mã/ffprobe thật | không: chỉ đọc header container | có: ffprobe, phát hiện tệp hỏng |
| Chuyển mã về hồ sơ TV-safe, rendition, manifest | không | có (ffmpeg) |
| Tệp lớn (>48 MB, video 500 MB cho TV) | vào duyệt tay (không đọc được) | xử lý (đọc theo giới hạn `MEDIA_MAX_BYTES`) |
| WebM / MOV | duyệt tay | hỗ trợ |
| Tệp liên kết (YouTube/Drive/Dropbox) | không tải về | chưa (xem `ops/agents/m1-media-worker.requests.md`) |
| Phán quyết | 'clean' = allow-list + cấu trúc | 'clean' = qua kiểm tra cấu trúc + chuyển mã |

Khuyến nghị: khách trả tiền, đặc biệt tệp lớn và video, nên dùng đường VPS (`COMMERCIAL-READINESS` 2.6, P1-8). Đường Cloudflare phù hợp pilot với ảnh PNG/JPG và MP4 nhỏ do nhân viên kiểm soát.

## Test
`services/api/test/cf-media.test.ts`: bộ dựng png/jpg/mp4 tối thiểu; 12 loại tệp bất thường -> manual review; cổng quét (`needs_manual_review` không duyệt được kể cả `allow_unscanned`); luồng queue -> validator -> approve; duyệt tay có audit, 409 khi duyệt lại; tự choi -> không bao giờ phát; không đè kết quả có sẵn; `CF_VALIDATOR_MARK_CLEAN=0`; sweep.

## Video thang máy tới 200 MB, tải từng phần và nhập từ Google Drive (20/11/2026)
**Nguyên nhân thật của lỗi "Tải lên kho lưu trữ thất bại (413)"**: `app.ts` có `bodyLimit` toàn cục 2 MB cho mọi route, kể cả `PUT /media/:id/content`; Worker trả 413 `payload_too_large` trước khi route chạy. Nay `PUT .../content` và `PUT .../parts/:n` được miễn bodyLimit toàn cục (route tự kiểm `Content-Length` chính xác và đếm byte).

**Quy tắc dung lượng video** (`sizeLimitBytes(target, quota, width, video)`): thang máy 200 MB cho mọi cỡ HD–4K (trước đây <= Full HD chỉ 30 MB); TV/LED giữ 100 MB (LED 50 MB); ảnh không đổi. Áp ở `upload-url`, `confirm`, `media-worker`, giao diện và OpenAPI.

**Tải từng phần qua Worker (R2 binding, không cần khóa S3)**: dùng khi proxy và tệp > 90 MB (`upload-url` trả `via:"multipart"` + `multipart{part_size,total_parts,parts_url,complete_url,abort_url}`).
- `POST /media/:id/multipart` (khởi tạo, hoặc tiếp tục phiên cũ: trả lại `parts` đã có), `PUT /media/:id/parts/:n` (đúng `Content-Length`, phần `part_size` = 32 MiB, phần cuối ngắn hơn), `POST /media/:id/multipart/complete` `{parts:[{n,etag}]}`, `POST /media/:id/multipart/abort`.
- Mã lỗi: `length_required`, `length_mismatch`, `part_failed` (502, thử lại được), `parts_missing`, `parts_invalid`, `etag_mismatch`, `size_mismatch` (422), `complete_failed` (502), `not_uploader`, `upload_expired`, `multipart_unsupported`.
- Phiên tối đa 3 giờ; cron dọn phiên quá hạn (hủy multipart trên R2, creative thành `invalid`, audit `media.multipart_expired`). Trạng thái phiên ở bảng mới `creative_transfers` (migration 0018). Mọi ghi đều có audit (`media.multipart_part|complete|abort`).
- Web-admin: mỗi phần thử lại 3 lần (lui dần 1s/2s/4s), có thanh tiến độ %, nút Hủy tải lên, tải lại tiếp tục từ phần đã có. Mã lỗi hiện cho người dùng: `UP-PART-<n>-<status>` (`NET` khi mất mạng).
- Giao diện cả `ObjectStore` có thêm `multipartCreate/UploadPart/Complete/Abort` (memory, fs, S3, R2). R2 trước đây thiếu `delete(key)` nên các lời gọi `delete?.` là không làm gì; nay đã có.

**Nhập từ liên kết (Google Drive, Dropbox `?dl=1`, URL trực tiếp)**: `POST /media/import` tạo creative ở trạng thái `importing` + dòng `creative_transfers` (kind=import) và đẩy tin vào queue `media.import`; consumer (chính API Worker) tải về và ghi thẳng luồng vào R2 multipart, tối đa 200 MB.
- Drive: `https://drive.usercontent.google.com/download?id=<ID>&export=download&confirm=t`; xử lý trang xác nhận quét virus (form + cookie). Nếu nhận HTML: lỗi "Tệp Drive không chia sẻ công khai hoặc vượt hạn mức tải".
- An toàn: danh sách miền cho phép (drive.google.com, docs.google.com, drive.usercontent.google.com, *.googleusercontent.com, dropbox), chặn SSRF, chuyển hướng thủ công và kiểm lại danh sách ở mỗi bước; kiểm Content-Type/magic bytes; URL trực tiếp chỉ bật trên Cloudflare (và test). YouTube: 422 `youtube_unsupported` "Chưa hỗ trợ tải từ YouTube, hãy dùng tệp hoặc Drive".
- Tiếp tục bằng Range khi bị cắt, tối đa 3 lần thử; cron quét lại tác vụ kẹt. Xong thì dùng chung `finalizeUpload` (head, dò MP4, kiểm quy cách, outbox, tự duyệt nếu đủ điều kiện). Lỗi cụ thể + nút "Thử lại" (`POST /media/:id/import/retry`, audit `media.import_retry`).
- **Giới hạn đã biết**: nhập 200 MB từ Drive trong Worker tốn nhiều CPU và subrequest; gói **Workers Free** (CPU 10 ms/lần gọi, 50 subrequest) rất có thể không đủ; cần gói **Workers Paid**. Mỗi lần chạy có ngân sách thời gian, hết thì tự xếp hàng lại và tiếp tục bằng Range. Chưa kiểm thử trên production.

## Chuyển mã trên trình duyệt, Drive chẩn đoán, dọn tệp kẹt (20/11/2026)

**Vì sao**: Cloudflare không có ffmpeg nên máy chủ không chuyển mã được; người dùng cơ bản cũng không tự xuất lại H.264. Giải pháp: hộp "Tải nội dung mới" (`apps/web-admin/src/components/UploadDialog.tsx`) tự chuyển ngay trên máy người dùng.

**Chuyển mã (web-admin, nạp lười)**: `lib/transcode-plan.ts` (thuần: đánh giá tệp, chọn thông số), `transcode-core.ts` + `transcode.worker.ts` (mediabunny 1.66.2, MPL-2.0, dùng nguyên bản không sửa: đọc MP4/MOV/WebM/MKV, WebCodecs giải mã AV1/VP9/HEVC/H.264, mã hóa H.264 + AAC, ghi MP4 `fastStart: 'in-memory'` = moov ở đầu tệp), `transcode.ts` (giao diện, huỷ, tiến độ). Chạy trong Web Worker. Không có WebCodecs (Safari cũ, Firefox cũ) thì báo "Hãy dùng Chrome hoặc Edge mới nhất trên máy tính".
- Tự chọn thông số theo loại màn: thang máy 9:16 mặc định 1080×1920 (tùy chọn HD/2K/4K trong "Chi tiết"), bitrate 4,5/7/11/15 Mbps theo bậc, TV 1920×1080 6 Mbps; ≤ 30 khung/giây, khung chính mỗi 2 giây, AAC 128 kbps; hạ bitrate nếu cần để kết quả ≤ 92% trần dung lượng (200 MB thang máy, 100 MB TV). Video ngang vào màn dọc (hoặc ngược lại): `fit = contain` (vừa khung, viền đen, không cắt, không méo).
- Bắt buộc chuyển: AV1/VP8/codec lạ, H.265/VP9 cho TV, quá dung lượng, quá độ phân giải, sai tỉ lệ, quá nhỏ. Nên chuyển (mặc định bật, bỏ tích được): VP9 thang máy, tệp không phải MP4, bitrate > 16 Mbps. Video dài hơn trần thời lượng (30 giây thang máy, 60 giây TV): người dùng phải tích "Cắt lấy N giây đầu" (không tự cắt ngầm).
- Máy chủ KHÔNG tin trình duyệt: mọi tệp vẫn qua `finalizeUpload` (codec, kích thước, thời lượng, dung lượng).
- Một thanh tiến độ chung: chuyển 0-60% (nếu có), tải lên 60-97%, xác nhận 97-100%. Có Hủy; cảnh báo `beforeunload`.

**Quy tắc codec thang máy** (`videoSpecProblem`, `videoSpecWarnings`): H.264, H.265 nhận; VP9 nhận kèm cảnh báo (`warnings` trong phản hồi `confirm`/`GET /media`, hiện ở thẻ tệp); AV1/VP8/khác chặn. Quyết định này là suy luận từ tài liệu Signage Player (chỉ ghi "H.264 hoặc H.265", từng ghi "AV1/VP9 không phát được trên đa số box"); VP9 chưa được thử trên thiết bị thật. Muốn chặn lại VP9: bỏ `'vp09'` khỏi `VIDEO_RULES.elevatorCodecs`.

**WebM/MOV**: trước đây `finalizeUpload` chỉ kiểm codec MP4; nay MP4, MOV (`probeMp4`) và WebM (`probeWebm`, EBML) đều kiểm codec/kích thước/thời lượng. Nhập liên kết nhận ra WebM (`1A45DFA3`) và MOV (`ftyp qt`). Đây là nguyên nhân thật của lỗi `not_media` với tệp Drive `.webm`: bộ nhận dạng cũ chỉ biết MP4/PNG/JPG nên coi tệp WebM hợp lệ là "không phải video" rồi báo nhầm "không chia sẻ công khai".

**Nhập từ Google Drive** (`lib/media-import.ts`, `lib/drive-resolver.ts`): thử lần lượt `drive.usercontent.google.com/download?id=…&export=download&confirm=t`; nếu nhận HTML thì phân tích (form `download-form` hoặc form tải bất kỳ, mọi `<input name>` kể cả `uuid`, `at`; liên kết `href` có `confirm=`; `downloadUrl` nhúng trong script); rồi `drive.google.com/uc?export=download&id=…` (+ cookie `download_warning_*` thành `confirm=`). Cookie giữ giữa các lần gọi và qua chuyển hướng; User-Agent trình duyệt phổ thông; tối đa 7 lần gọi. Mã lỗi: `drive_login_required` (302 tới accounts.google.com / tiêu đề đăng nhập), `drive_quota` ("Too many users", "quota"), `drive_blocked` (401/403/429), `drive_page_unrecognized` (trang xác nhận không đọc được), `drive_html_unknown`, `source_not_found`, `not_media`, `file_too_large`; khi có nhiều nguyên nhân, ưu tiên quota > đăng nhập > bị chặn > trang không đọc được. Tệp tải được nhưng sai quy cách báo đúng lý do kèm "Tệp này cần chuyển sang H.264. Hãy tải tệp về máy rồi kéo vào ô tải lên, hệ thống sẽ tự chuyển." và nút "Chọn tệp từ máy" ở thẻ.
- **Chẩn đoán an toàn** (bảng `creative_diag`, migration 0019, và audit `media.import_failed.diff.diag`): mã HTTP, content-type, `<title>`, 200 ký tự đầu đã làm sạch (bỏ script/thẻ, che chuỗi giống token), URL bước cuối và các bước (chỉ tên miền + đường dẫn + TÊN tham số, không giá trị), không cookie. Chỉ trả về cho tài khoản nội bộ (`diag` trong `GET /admin/v1/media`); cổng khách `/portal` không có trường này.

**Dọn tệp kẹt `uploading`**: tệp quá 1 giờ chưa xác nhận (và không có phiên multipart đang mở) tự chuyển `rejected`/`invalid` với lý do "Tải lên không hoàn tất, hãy tải lại.", xóa mảnh trong kho, audit `media.upload_stale`. Chạy bởi cron (Worker mỗi phút, API Node mỗi phút) và đọc lười khi liệt kê (`GET /media`, tối đa 1 lần/60 giây). Phiên multipart đang mở vẫn do `sweepMultipart` (3 giờ). Trang Media: bộ lọc "Đang xử lý" và "Cần chỉnh sửa" có nút "Xóa tất cả tệp bị kẹt/lỗi" (qua `POST /media/bulk-delete`, có hộp xác nhận, gõ XOA khi > 5 tệp; "Đang xử lý" chỉ chọn tệp quá 30 phút hoặc nhập liên kết đã thất bại).
