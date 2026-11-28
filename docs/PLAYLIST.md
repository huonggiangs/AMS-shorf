# Vùng danh sách phát (playlist) v1

Một vùng của bố cục chứa **nhiều mục video / ảnh / văn bản phát tuần tự** (chiến dịch đa đối tác trên màn thang máy/siêu thị). Máy chủ, web-admin và app dùng chung hợp đồng này. Mã dùng chung: `packages/shared/src/playlist.ts` (`playlistSchema`, `zonePlaylist`, `playlistTotalS`, `legacyMirror`, `itemImpressionSchema`).

## 1. Lược đồ

Zone (`broadcast_program_layouts.zones`, kiểu `video` | `image` | `playlist`) thêm:

| Trường | Ý nghĩa |
|---|---|
| `playlist: PlaylistItem[]` | tối đa 50 mục, `id` không trùng |
| `loop: boolean` | mặc định `true` |
| `creative_ids`, `durations` | **bản sao** cho app cũ, máy chủ tự suy ra từ `playlist` (client không cần gửi; `durations: null` được chấp nhận) |

`PlaylistItem`:

```json
{ "id": "UUID", "type": "video|image|text", "name": "Tên hiển thị",
  "media_id": "creative_id (video/ảnh trong kho)", "url": "https://... (video/ảnh ngoài, chỉ khi không có media_id)",
  "text_content": "văn bản thuần (mục text)", "rich": "HTML đã làm sạch (tùy chọn)",
  "style": { "color":"#RRGGBB","background":"#RRGGBB","font_size":8..200,"align":"left|center|right|justify","valign":"top|middle|bottom","font_family":"Roboto|Arial|...","bold":true,"italic":true,"underline":true },
  "duration": 1..3600 }
```

Quy tắc API (422 nếu vi phạm): video/ảnh có **đúng một** trong `media_id`/`url`; `url` phải https (không đăng nhập, không khoảng trắng; **không được quét/duyệt**, nên ưu tiên dán link vào kho rồi dùng `media_id`); mục text không có `media_id`/`url` và phải có chữ; `type` khớp loại tệp thật (`playlist_type_mismatch`); `media_id` phải tồn tại, chưa gắn chiến dịch, không bị trả lại, đúng cỡ màn (như danh sách tệp chương trình); **duyệt (approved) kiểm lúc xuất bản** (như cũ, để lưu nháp trước). Văn bản: `rich` đi qua bộ làm sạch richtext (chỉ `p b i u s br span`), `text_content` được đặt lại = văn bản thuần của `rich`; ký tự điều khiển bị bỏ. `style` chấp nhận thêm khóa của web-admin `rich`, `bg_color`, `text_color` (`style.rich` được nâng lên `rich` của mục). Khóa lạ bị bỏ, không báo lỗi.

Tệp trong playlist tự vào danh sách tệp chương trình (`creative_ids`) và `item_zones[media_id] = zone_id`; bỏ khỏi playlist thì rời chương trình. Chương trình chỉ có mục văn bản vẫn xuất bản được (slot có `creative_ids: []`; app cũ không hiển thị được, app playlist nên báo `caps:["playlist"]`).

## 2. Tương thích vùng cũ

`zonePlaylist(zone, lookup?)`: vùng chưa có `playlist` mà có `creative_ids` (hoặc `creative_id`) + `durations` được đọc thành mục `{id: uuid v5("<zone_id>:<creative_id>"), type theo tệp, media_id, name, duration nếu có trong durations}`, id ổn định giữa các lần đọc. API và manifest đều chuẩn hóa như vậy; `GET /admin/v1/broadcast/:id` luôn trả `playlist`, `loop`, `creative_ids`, `durations`, `playlist_total_s` cho vùng media.

## 3. Thời lượng

Mặc định **ảnh/văn bản 8 giây** (đổi từ 5; `IMAGE_DEFAULT_S`, `TEXT_DEFAULT_S`). Video = thời lượng thật của tệp (`creatives.duration_s`), chỉ bị cắt khi người dùng đặt `duration`. `playlistTotalS(items, knownVideoDurations)` = tổng giây một lượt (video chưa biết thời lượng tính 0).

## 4. Manifest và luật phát (cho tác giả app)

`schedule[].layout.zones[]` (vùng media) có `playlist`, `loop`, `creative_ids`, `durations`. Mục manifest = mục trên + giải sẵn:

```json
{ "id":"...", "type":"video", "name":"TVC A", "media_id":"cr1", "url":"https://media.../x.mp4", "sha256":"hex",
  "size_bytes":123, "duration_ms":15000, "px_w":1080, "px_h":1920, "play_s":null }
{ "id":"...", "type":"image", "media_id":"cr2", "url":"...", "sha256":"...", "duration":20, "play_s":20 }
{ "id":"...", "type":"text", "name":"Khuyến mãi", "text_content":"...", "rich":"<p>..</p>", "style":{...}, "play_s":8 }
{ "id":"...", "type":"image", "url":"https://cdn.../a.jpg", "delivery":"external", "play_s":8 }
```

`play_s`: số giây hiển thị đã giải (ảnh/text = `duration ?? 8`; video = `duration` nếu có, ngược lại `null` = phát hết tệp). `delivery:"stream"` + `kind` cho link đã duyệt (phát trực tiếp, không sha256). Mục có tệp chưa vào manifest (chưa duyệt, khác cỡ màn...) bị loại sẵn.

Luật phát:

1. Tuần tự theo thứ tự mảng. Hết danh sách: nếu `loop` thì phát lại từ đầu, không thì dừng ở mục cuối (hoặc nhường vùng cho lịch kế).
2. Video: **tải trước / double-buffer mục kế** để chuyển không đứt.
3. Ảnh/văn bản: hiển thị `play_s` giây; văn bản dựng từ `rich` (hoặc `text_content`) với `style`.
4. Lỗi media (tải/giải mã/hash sai/stream lỗi): **bỏ qua mục, ghi log** (`POST /v1/logs`), sang mục kế.
5. **Tất cả mục lỗi**: hiện màn chờ mặc định **8 giây** rồi thử lại cả danh sách (không vòng lặp chặt).
6. Ghi `item_impression` **một lần cho mỗi lần mục đã hiển thị ổn định** (>= 1 giây hoặc khung hình đầu tiên đã vẽ), **không bao giờ khi xem trước/preview**.
7. Vẫn ghi `proof_of_play`/`impression` theo quy tắc hiện có (xem mục 6).

## 5. `item_impression` và gửi lô

```json
{ "type":"item_impression", "log_id":"UUID (khóa khử trùng, app tự sinh)", "program_id":"bp_<id> hoặc <id>",
  "zone_id":"main", "item_id":"UUID mục", "media_id":"creative_id (bỏ nếu text/link ngoài)", "item_type":"video|image|text",
  "played_at":"2026-11-28T03:00:00.000Z" }
```

`device_id` lấy từ chữ ký, không gửi. Trường `type` là loại sự kiện nên loại mục là `item_type` (máy chủ cũng nhận camelCase và sự kiện không có `type` nhưng có `log_id`+`item_id`). Gửi trong `POST /v1/events` cùng lô với sự kiện khác (<= 50 sự kiện/lô, thân <= 32 KB).

Batching: **app xếp hàng cục bộ (bền qua khởi động lại), gửi mỗi 5 phút hoặc khi đủ 50 log**, thử lại khi mất mạng/5xx với backoff (như DEVICE-PROTOCOL mục 10). Idempotent: gửi lại cùng `log_id` an toàn (`item_impressions.duplicates`). 202 = bỏ khỏi hàng đợi mọi log (kể cả `rejected`: lý do là vĩnh viễn: `malformed`, `ts_out_of_range` (quá 48 giờ/tương lai >5 phút), `unknown_program`, `unknown_media`). Phản hồi: `{accepted, valid, flagged, rejected[], item_impressions:{accepted, stored, duplicates, rejected}}`.

Máy chủ tự suy ra `customer_id` (đối tác) và `campaign_id` từ `media_id` -> `creatives` (không tin app). Chương trình phát nội bộ không có chiến dịch; "đối tác" = chủ tệp media (`creatives.customer_id`). Mục text/link ngoài không có đối tác (báo cáo nhóm "Chưa rõ đối tác"). Bảng `ev_item_impression` (migration `0029_item_impressions`), PK `log_id`, chỉ mục `(media_id,played_at)`, `(program_id,played_at)`, `(device_id,played_at)`, `(customer_id,played_at)`.

## 6. Quyết định: quan hệ với tiền và proof_of_play

`item_impression` **chỉ để báo cáo**, không bao giờ tính tiền hay trừ chi tiêu và không đi qua ingest-consumer. Tiền tiếp tục chỉ đi qua `impression` (TV) / `proof_of_play` (thang máy/LED) như cũ, nên không thể tính trùng. Chương trình nội bộ (`bp_*`) vốn không có giá chốt nên không tính tiền. Vì vậy cũng **không có** luật "tính thay thế khi thiếu proof_of_play". Tin cậy: thiết bị chưa cấp quyền được lưu `source='pending_trust'`; báo cáo tính theo quyền hiện tại (trust >= 1 và không bị chặn), nên tự tính lại khi được cấp quyền. Không có trần giờ riêng cho item (đã có giới hạn lô/phút/thiết bị). Bảng chưa có job dọn: cần lưu trữ/tổng hợp định kỳ khi quy mô lớn (~1.400 dòng/ngày/màn).

## 7. Báo cáo

`GET /admin/v1/reports/views/items` và `/portal/v1/reports/views/items` (`/export.csv`, `/report.html`, `/report.pdf`): `group_by=media|partner|program|zone|device|day`, lọc `from,to,program_id,media_id,zone_id,item_type` (+ `customer_id`,`device_id` cho admin). Trả `totals`, `by_type`, `by_day`, `rows[{key,label,impressions,share,...}]`. Khách chỉ thấy dữ liệu của mình (lọc trong SQL, id người khác -> 404, không có nhóm thiết bị). Chi tiết: `REPORTING.md` mục 6.

## 8. Triển khai

Migration `0029_item_impressions` trước, rồi gateway, api, web-admin. Gateway cũ bỏ qua `zones[].playlist`; API cũ không nhận `playlist`.
