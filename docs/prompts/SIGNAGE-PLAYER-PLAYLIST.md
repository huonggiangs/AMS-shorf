# Prompt: cập nhật Signage Player (9:16) hỗ trợ playlist nhiều item + lượt xem theo item

Bối cảnh: Signage Player là app Android 9:16 cho màn thang máy/siêu thị, thư mục `E:\Project\ANIO design\APP Brainrot\9-16\signage-player` (không phải git repo; hãy `git init` + commit cơ sở trước khi sửa để có diff). Nó nhận chương trình từ hệ thống AMS (repo https://github.com/huonggiangs/AMS-shorf, nhánh main). Phiên bản hiện tại 1.1.4.

Hãy ĐỌC trước trong AMS-shorf: `docs/PLAYLIST.md` (hợp đồng đầy đủ), `docs/DEVICE-PROTOCOL.md` (mục 7.1, 8.2b), `docs/TV-APP-INTEGRATION.md` (3e, 3f), `docs/REPORTING.md`. Bản tham chiếu đã làm xong cho app Mindo TV: repo https://github.com/huonggiangs/chanvideotv, nhánh `feat/ams-playlist` (Playlist.kt, AdsEngine.kt, ProgramView.kt, test PlaylistTest.kt) — port logic sang Signage Player.

## Việc cần làm
1. Parse manifest: mỗi zone media có `playlist: [{id, type: video|image|text, media_id?, url?, text_content?, rich?, style?, duration?, name, play_s}]` và `loop` (mặc định true). Zone cũ (`creative_ids` + `durations`) vẫn phát bình thường (tự đổi sang playlist cục bộ, id ổn định). Hỗ trợ zone `type:"playlist"`.
2. Phát tuần tự; hết danh sách thì quay đầu nếu loop, không loop thì giữ item cuối. Ảnh/text hiển thị `play_s` giây (mặc định 8). Video phát hết file, chỉ cắt khi có `duration`.
3. Nạp trước (preload/double-buffer) video kế tiếp để chuyển không chớp đen.
4. Item lỗi → bỏ qua + ghi log. Mọi item lỗi → màn chờ 8 giây rồi thử lại cả danh sách (không vòng lặp vô hạn).
5. Lượt xem theo item (chỉ app thật, không ở chế độ xem thử): khi item hiển thị ổn định (khung hình đầu / ≥1 giây) ghi 1 bản ghi:
   `{"type":"item_impression","log_id":"<UUID v7>","event_id":"<=log_id>","ts":"<=played_at>","program_id":"bp_<id>|<id>","zone_id":"...","item_id":"<UUID>","media_id":"<bỏ nếu text/link>","item_type":"video|image|text","played_at":"<ISO UTC>"}`
   Gửi trong lô `POST /v1/events` đã ký Ed25519 như hiện tại. Hàng đợi lưu bền trong máy (sống sót khi khởi động lại), gửi mỗi 5 phút hoặc đủ 50 bản ghi, chỉ xóa sau khi server trả 2xx; lỗi mạng/5xx/429 giữ nguyên `log_id` và thử lại lùi mũ; bản ghi quá 47 giờ thì bỏ. Giữ nguyên proof_of_play hiện có.
6. SỬA LỖI quan trọng đã phát hiện: 1.1.4 bỏ cả lô khi gặp 4xx (kể cả 401 lệch giờ) → không được mất dữ liệu. Chỉ bỏ từng bản ghi bị server từ chối vĩnh viễn (malformed, ts_out_of_range, unknown_program, unknown_media), còn lỗi 401/lệch giờ thì giữ hàng đợi, đồng bộ lại giờ rồi gửi lại.
7. Heartbeat báo thêm `caps: ["zone_playlist","item_impression"]`. Giữ lệnh `set_volume` và `refresh_manifest` đang có.
8. Viết test (JVM/unit) cho: tuần tự/loop/bỏ qua lỗi/mọi item lỗi, hàng đợi batch 50/5 phút/retry giữ log_id/khởi động lại, không mất lô khi 401. Tăng version (1.1.5), cập nhật tài liệu của app.
9. Build APK debug, `adb install -r` thử trên màn thang máy thật (V2419A) rồi kiểm tra trên web AMS: `/history` → "Chẩn đoán đồng bộ" và tab "Theo mục phát" (`/admin/v1/reports/views/items`) phải thấy lượt xem của máy đó.

## Quy tắc
- Không sửa phía server AMS trong phiên này; nếu hợp đồng thiếu/sai, ghi lại và báo.
- Không nhập mật khẩu/token thật vào code hoặc commit. Tiền/tính phí chỉ đi qua proof_of_play/impression như cũ; item_impression chỉ để báo cáo.
- Báo cáo cuối bằng tiếng Việt: đã đổi gì, test, cách cài, điểm chưa kiểm trên máy thật.
