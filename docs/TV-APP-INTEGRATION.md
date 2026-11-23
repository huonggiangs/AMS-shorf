# Tích hợp AMS vào ứng dụng TV Brain-rot (1.0.39)

Tác giả: agent `a4-tv-bridge`. Mã tham chiếu: `integrations/brainrot-tv/` (Java, lược đồ zod, test). Cách gắn vào ứng dụng: `integrations/brainrot-tv/android/PATCH-NOTES.md`. **Chưa có gì được áp vào `D:\JOB\TV Block`, chưa build bằng Android SDK, chưa chạy trên TV thật** (xem mục 9).

Nguồn đã đọc: mã Java thật của Brain-rot ở `D:\JOB\TV Block\publish\brainrot-app` (TvBridgeService, TvOverlayController, TvReceiverActivity, TvAccessibilityService, TvMediaListenerService, AndroidManifest, build.gradle), APK 1.0.39 (đối chiếu bằng zipfile), mẫu `assets/formats/ADS.png`. Kết nối tới D: đã mất ở cuối phiên; những gì ghi dưới đây về mã Brain-rot là từ lần đọc trước (ghi trong `ops/agents/a4-tv-bridge.md`), không đối chiếu lại được lần cuối.

## 1. Khảo sát mã Brain-rot

| Điểm | Thực tế trong mã |
|---|---|
| Dịch vụ nền | `TvBridgeService` (foreground, `foregroundServiceType=connectedDevice`, `START_STICKY`), mở API LAN cổng 39147 với Bearer token. Chỉ được khởi động khi mở `TvReceiverActivity` (không có `BOOT_COMPLETED`). |
| Lớp phủ | `TvOverlayController` (tĩnh, một view `current` duy nhất) vẽ bằng `WindowManager` (`TYPE_APPLICATION_OVERLAY`). Lớp khóa `showLockNow` là nơi duy nhất có chỗ cho quảng cáo chia màn hình. |
| Ép buộc | `TvAccessibilityService` + `TvMediaListenerService`; lệnh `lock`/`unlock` từ điện thoại qua API LAN. |
| Định danh thiết bị | Prefs `brainrot_tv_receiver` (token, mã ghép). Không có Ed25519 sẵn. |
| Ghép đôi sẵn có | Mã 6 ký tự, 60 giây, QR `brainrot://pair`, ở `TvReceiverActivity`. |
| Quyền đã có | INTERNET, ACCESS_NETWORK_STATE, ACCESS_WIFI_STATE, SYSTEM_ALERT_WINDOW, FOREGROUND_SERVICE(+CONNECTED_DEVICE), Usage Access, Notification Listener, Accessibility. **Không cần thêm quyền nào.** |
| Thư viện | BouncyCastle `bcpkix-jdk18on:1.79` (kéo theo `bcprov`, có `Ed25519Signer`), ZXing 3.3.3 (QR), ML Kit, protobuf. |
| Thiếu | `BOOT_COMPLETED`; ngăn xếp tải tệp có băm; đường truyền sự kiện ra ngoài LAN; lớp phủ cho ngữ cảnh "pause". |

## 2. AMS ↔ ứng dụng

**(a) Đăng ký và ghép đôi.** TV tự sinh cặp khóa Ed25519 (`AmsKeys`), gọi `POST /v1/register` (trust_level 0). Màn hình receiver hiện một dòng riêng "Liên kết tài khoản AMS · mã 123456 · còn 4:59" (khác mã Brain-rot) và thăm dò `POST /v1/pair` chỉ khi màn đó đang hiện; chủ tài khoản nhập mã trong AMS, TV lên trust_level 1. Khóa:
- Hạt giống 32 byte nằm ở `getNoBackupFilesDir()/ams_ed25519.seed`. Khi có AndroidKeyStore thì được bọc AES-GCM (khóa AES nằm trong Keystore, `protection()` = `keystore-wrapped`), không thì lưu thường (`software`).
- Ký bằng BouncyCastle `Ed25519Signer` (hoạt động mọi API level ứng dụng hỗ trợ). Ed25519 gốc của Android (`KeyPairGenerator "Ed25519"`) chỉ từ API 33 và chưa chắc có trong Keystore trên TV rẻ tiền (theo tài liệu Android, **chưa thử trên TV thật**), nên không dựa vào nó. Fallback Tink không cần vì BC đã có sẵn trong APK.
- `allowBackup="true"` của Brain-rot sẽ nhân bản `device_id` sang TV khác: patch thêm hai tệp quy tắc loại `brainrot_ams.xml` và `ams/`.

**(b) Heartbeat, manifest, sự kiện** (theo `docs/DEVICE-PROTOCOL.md`). Chữ ký `METHOD\nPATH_AND_QUERY\nTS\nNONCE\nsha256hex(body)` ghi base64url không đệm; nonce mới mỗi lần thử; lệch đồng hồ học từ 401 `stale_timestamp`; `Retry-After` được tôn trọng; backoff jitter đầy đủ `uniform(0, min(60 s, 1 s·2^n))`; khởi động lệch 0–60 s. Heartbeat gửi state/app_ver/soc_temp/rssi/cache/manifest_etag/cmd_ack, nhận `next_interval`, `manifest_etag`, `commands` (xử lý `refresh_manifest`, `set_monitor`; `reboot` và loại lạ chỉ ack). Manifest dùng etag (304), delta; manifest mới chỉ được nhận sau khi tải trước xong (hoặc quá 5 phút), và được lưu ở `files/ams/manifest.json`. Không có gì chạy khi phụ huynh chưa bật `ads_enabled` (lệnh `ads-config` từ điện thoại); quảng cáo cần trust_level ≥ 1.

**(c) `creative.overlay`.** Nguồn sự thật của máy chủ: `packages/shared/src/overlay.ts` (`parseOverlay`), lưu ở cột `creatives.overlay` (JSON TEXT), gateway phát nguyên trong `manifest.creatives[].overlay`.

Các trường máy chủ **hiện có** (tất cả tùy chọn): `sponsor_tag` ≤60, `brand_label` ≤60, `headline` ≤140, `scte_id` (`[A-Za-z0-9_.:-]{1,64}`), `badges` ≤6×30, `hotline{number(3..24, chữ số + ( ) . - khoảng trắng), label ≤60, sub ≤100}`, `qr{url https ≤512, label ≤60, title ≤80}`. Máy chủ **bỏ trường lạ** khi lưu và khi phát.

Phần mở rộng phía TV (lược đồ `integrations/brainrot-tv/schema/overlay.ts`, tất cả tùy chọn, **máy chủ chưa có**, xem yêu cầu trong `ops/agents/a4-tv-bridge.requests.md`): `qr.hint`, `kid_safe` (mặc định `false`), `contexts` ⊂ {lock, fullscreen, pause, corner} (mặc định `["fullscreen"]`), `duration_s` 5..60 (mặc định 15; nếu thiếu thì dùng `creative.duration_s`), `safe_area` 0..15 % (mặc định 5), `background` (mặc định lấy từ chính creative: `url`, `sha256`, `px_w`, `px_h`). Ảnh nền phải 16:9 và từ 1280×720 đến 7680×4320.

Hệ quả hiện tại, nói thẳng: vì máy chủ chưa lưu `kid_safe`/`contexts`, **mọi creative đều là `kid_safe=false`, nên client không bao giờ đưa quảng cáo lên màn khóa**; chỉ có thể dùng ngữ cảnh `fullscreen`. Đây là mặc định an toàn có chủ ý. Muốn có màn khóa phải có quy trình duyệt `kid_safe` ở máy chủ (mục 8).

Quy tắc hiển thị:
- **Lock-split** (ADS.png): cột quảng cáo 69 % bên trái, bảng khóa của Brain-rot giữ 31 % bên phải; hoàn toàn là patch `TvOverlayController.showLockNow`. Khi không có quảng cáo, bảng khóa chiếm 100 % như cũ. Lệnh `unlock` của phụ huynh vẫn gỡ lớp khóa tức thì và kết thúc lượt quảng cáo.
- **Fullscreen**: toàn màn hình, chỉ khi không có khóa/chính sách đang hiện.
- Chỉ lên màn hình khi TV đang bật, mạng không tính cước (bỏ qua metered), và còn trong giới hạn tần suất: 30 lượt/giờ, cách nhau ≥60 s, cùng creative ≥5 phút.

Ánh xạ 6 định dạng của đặc tả: `fullscreen` ↔ lock-split hoặc toàn màn (có làm); `pause_ad` và `qr_corner` ↔ thẻ góc `CORNER_CARD` (renderer có, **chưa nối** MediaSession); `menu_banner`, `l_banner`, `reward`: **không hỗ trợ** (Brain-rot không có menu riêng, Android không thu nhỏ video của ứng dụng khác thành chữ L, TV không có tài khoản người xem). `ADS.png` là một creative `fullscreen` hiển thị trong ngữ cảnh khóa. Phần bên phải của mẫu (nhập PIN, đồng hồ nghỉ mắt) **là bảng khóa gốc của Brain-rot**, AMS không vẽ lại.

Vùng vẽ theo ADS.png (tỷ lệ theo chiều cao/1080): hàng trên (chip tài trợ, huy hiệu, chip thương hiệu), dòng "SCTE-35 ID #…", thẻ tiêu đề chữ serif, thẻ hotline (biểu tượng điện thoại + số), khối QR (ECC M) với nhãn/tiêu đề. Ví dụ từ chính chữ trong ảnh: `integrations/brainrot-tv/schema/overlay.example.vf9.json`. Đây chỉ là dữ liệu thử cho bộ vẽ, **không phải duyệt quảng cáo VinFast**.

**(d) Đo lường** (`AmsImpressionTracker`): mỗi lượt có `event_id` UUIDv7; chỉ ghi nhận lượt phát **trọn vẹn**: vcr 100 % (thời gian view hiển thị, không bị che, màn bật) và `played_ms ≥ 0.9·duration`; lượt bị cắt dở bị bỏ (`partialPlaysDropped`), vì máy chủ đánh dấu lượt 60 % là `valid=0` (đã kiểm với gateway thật). Hàng đợi sự kiện bền trên đĩa (fsync, tối đa 4000, bỏ khi quá 47 giờ vì máy chủ nhận ≤48 giờ), gửi theo lô ≤50 sự kiện và ≤15 000 byte (giới hạn 16 KB), mỗi 5–10 phút hoặc khi ≥20 sự kiện; lô bị 4xx thì chia đôi để loại sự kiện hỏng; idempotent theo `event_id`. Máy chủ giới hạn 120 sự kiện/giờ/thiết bị và yêu cầu trust_level ≥ 1; TV chưa ghép đôi vẫn gửi nhưng bị đánh dấu `flagged` (không tính tiền). Trường phụ `ctx` (lock/fullscreen) có trong sự kiện; máy chủ có thể bỏ qua. "Proof-of-play" hiện là chữ ký thiết bị trên từng yêu cầu cộng event_id; chưa có chứng cứ độc lập (ảnh chụp màn) và đây là giới hạn đã biết.

**(e) Bộ nhớ đệm media** (`AmsAdScheduler`): tải trước khi manifest được nhận; lưu theo nội dung (`files/ams/cache/<sha256>`), xác minh sha256 và kích thước, tải có thể tiếp tục (Range), ghi tạm rồi đổi tên nguyên tử; chỉ tải từ máy chủ có hậu tố trong allow-list (`anio.vn` là giữ chỗ, phải đổi thành `MEDIA_PUBLIC_URL` thật) và chỉ HTTPS, không theo redirect; trần 200 MB; dọn tệp không còn được manifest hiện tại/trước đó tham chiếu. Ảnh giải mã bằng `inSampleSize` + RGB_565 để không tràn bộ nhớ trên TV yếu.

## 3. Giao diện với AMS phía máy chủ

Cột `creatives.overlay`/`format` và các route `PUT /:id/overlay`, manifest có `overlay` đã được a1/a3 làm. Lược đồ TV khớp phần giao nhau; phần còn thiếu nằm ở mục 3 của tệp yêu cầu.

### 3c. Âm lượng từ xa (set_volume): việc app TV phải làm

Trang **Thiết bị > Nhóm thiết bị** có thanh trượt âm lượng cho từng thiết bị và nút "Đặt âm lượng cả nhóm". Luồng đầy đủ:

```
kéo thanh trượt (debounce 0,5 s) -> POST /admin/v1/devices/{id}/commands {"type":"set_volume","args":{"percent":55}}
 -> dòng device_commands (pending) -> heartbeat kế tiếp trả commands[] (delivered)
 -> app đặt âm lượng -> POST /v1/commands/ack {"acks":[{"id","status":"ok","result":"{\"applied_percent\":55,\"mode\":\"system\"}"}]}
 -> web: acked + "Đang áp dụng: 55%"; heartbeat sau đó báo "volume" thật.
```

**Nguyên nhân web "chưa điều khiển được" thường gặp** (kiểm theo thứ tự):

1. Web/gateway production chưa triển khai bản có `set_volume` (xem lệnh cuối mục này).
2. **App trên TV bỏ qua `commands[]` của heartbeat.** Mindo TV (`chanvideotv`, nhánh trước `feat/set-volume`) chỉ gửi `{"app_version"}` và bỏ qua toàn bộ phản hồi, nên không bao giờ nhận lệnh. Brain-rot Java (`vn/brainrot/parental/tv/Ams*.java`) và Signage Player cũ ack "ok" mọi lệnh nhưng không đổi âm lượng (web cũ hiện "đã xác nhận" sai).
3. Thiết bị chưa `trust_level >= 1` (TV chưa ghép mã 6 số; thang máy/LED chưa bấm Cấp quyền): web khóa thanh trượt, API trả 409.
4. Độ trễ: lệnh chỉ tới ở heartbeat kế tiếp (mặc định đang phát ~5 phút, rảnh ~10 phút). Web hiện "Nhịp heartbeat kế tiếp dự kiến HH:MM". Rút ngắn: đặt biến gateway `HB_PAIRED_S=60`; app dùng `next_interval` của máy chủ (không tự đặt chu kỳ) hoặc long-poll `GET /v1/commands/wait?timeout=25`.

**Yêu cầu với app:**

1. **Khai năng lực**: gửi `"caps":["set_volume"]` ở `register` và/hoặc mọi heartbeat (mảng tên tính năng, mỗi tên `^[a-z][a-z0-9_.-]{0,29}$`, tối đa 24). Web hiện huy hiệu "App hỗ trợ âm lượng" dựa trên đây; app không gửi `caps` thì web hiện "Chưa rõ app có hỗ trợ" (vẫn cho gửi lệnh nhưng giải thích).
2. **Nhận lệnh** `{"id","type":"set_volume","args":{"percent":0..100}}` trong `commands[]` của heartbeat. `percent` ngoài 0..100 hoặc không phải số nguyên: ack `failed`, `result:"bad_args"`.
3. **Đặt âm lượng**:
   ```kotlin
   val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
   val max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
   am.setStreamVolume(AudioManager.STREAM_MUSIC, Math.round(percent / 100f * max), 0) // cờ 0: không hiện thanh âm lượng
   val applied = Math.round(am.getStreamVolume(AudioManager.STREAM_MUSIC) * 100f / max) // ĐỌC LẠI
   ```
   Mã đầy đủ đã viết: `apps/tv-android/app/.../AndroidDeviceVolume.kt` và `AmsGatewaySource.runCommands` (repo chanvideotv, nhánh `feat/set-volume`); Signage Player: `signage-player/set-volume.patch`.
4. **Ack đúng sự thật** qua `POST /v1/commands/ack`: thành công `{"id","status":"ok","result":"{\"applied_percent\":N,\"mode\":\"system\"}"}` (N là mức ĐỌC LẠI, khác `percent` nếu TV box cố định âm lượng); thất bại `{"id","status":"failed","result":"<lý do ngắn>"}` (`bad_args`, `unsupported:<type>`, `volume_fixed`...). `result` là chuỗi, tối đa 500 ký tự. **Không ack "ok" cho lệnh app không làm được**: web sẽ coi như đã chạy. Nếu ack "ok" mà không kèm `applied_percent`, web hiện cảnh báo "không báo mức đã áp dụng, app có thể chưa hỗ trợ".
5. **Idempotent**: giao ít nhất một lần, `id` không đổi khi giao lại. App nhớ id đã xử lý (kèm kết quả), lần giao lại chỉ ack lại kết quả cũ, không đặt lại âm lượng.
6. **Báo âm lượng thật** trong mọi heartbeat: `"volume": round(100 * getStreamVolume / getStreamMaxVolume)`. Người dùng bấm phím âm lượng trên remote làm số này đổi; admin luôn thấy số thật, không phải số đã yêu cầu.
7. **`refresh_manifest`** (nút "Đồng bộ lại ngay") theo mục 6 của giao thức; **`screenshot`** chưa làm (`DEVICE-PROTOCOL.md` mục 6.2).

**Trạng thái trên web** (mỗi thiết bị): đang chờ thiết bị nhận lệnh; đã gửi, chờ xác nhận; đã xác nhận + "Đang áp dụng N%"; báo lỗi; hết hạn/chờ quá 15 phút: "Thiết bị chưa nhận lệnh: app trên TV chưa hỗ trợ hoặc đang ngoại tuyến" kèm nút **Thử lại** (gửi lại đúng mức cũ). Hạn lệnh 1 giờ.

**Cách kiểm tra bằng adb** (TV bật gỡ lỗi USB/mạng, `adb connect <ip-tv>:5555`):

```
adb shell media volume --get --stream 3          # đọc âm lượng nhạc hiện tại (stream 3 = STREAM_MUSIC)
# trên web: kéo thanh trượt của TV đó tới 40%, chờ tới nhịp heartbeat (xem "Nhịp heartbeat kế tiếp dự kiến")
adb shell media volume --get --stream 3          # phải đổi tương ứng ~40% của mức tối đa (vd max 15 -> 6)
adb logcat | grep -i "set_volume\|ams"                  # xem lệnh đã nhận (tên tag tùy app)
adb shell media volume --show --stream 3 --set 5 # (tùy chọn) đổi tay rồi chờ heartbeat: web phải hiện "Thiết bị báo" khớp
```

Nghiệm thu: (a) web hiện "Đang áp dụng: 40%" sau ack; (b) `adb ... --get` khớp; (c) rút mạng TV, kéo thanh trượt: sau 15 phút web hiện câu "Thiết bị chưa nhận lệnh..." và nút Thử lại; (d) nút Thử lại gửi lại đúng mức cũ; (e) cài app CŨ: web hiện huy hiệu "Chưa rõ app có hỗ trợ" và, nếu app ack "ok" không kèm kết quả, cảnh báo thay vì "đã xác nhận".

Thiết bị phải ở `trust_level >= 1` mới nhận được lệnh. Triển khai bản máy chủ mới: migration `0027_device_caps` (cột `device_profiles.caps`) chạy trước, rồi gateway, rồi api, rồi web-admin.

### 3b. Creative dán link (`delivery: "stream"`)

Manifest có thể chứa creative `delivery: "stream"` (`url`, `kind` mp4/webm/hls/dash, `duration_ms`, `etag`; không `sha256`, không `size_bytes`). App phải: phát trực tiếp bằng ExoPlayer/Media3 (không tải vào bộ nhớ đệm bắt buộc, không kiểm sha256), **bỏ qua và chuyển creative kế tiếp khi stream lỗi**, ghi log lỗi theo `creative_id` (chưa có loại sự kiện lỗi riêng trong giao thức; không gửi `impression` cho lượt lỗi), và gửi `impression` với `played_ms` thực (rebuffer làm `played_ms` ngắn đi; dưới 0.9 x `duration_ms` thì không hợp lệ). Không giảm bitrate/fps/độ phân giải khi phát. Chi tiết: `DEVICE-PROTOCOL.md` mục 7.0, `VIDEO-LINK.md`. Trang YouTube/Vimeo không phải stream trực tiếp: nằm ngoài phạm vi (AMS từ chối khi dán).

### 3e. Thời lượng tư liệu trong vùng (`zones[].durations`)

Mỗi vùng `video`/`image` của `layout` có thể có `durations: {creative_id: giây}` (1..3600). App TV: ảnh hiển thị `durations[id]` giây rồi sang tệp kế (thiếu trường hoặc thiếu khóa → dùng mặc định cũ, khuyến nghị 5 giây); video phát hết tệp, còn nếu có `durations[id]` thì cắt ở số giây đó (đặt hẹn giờ chuyển tệp). Tệp dán link (`delivery: stream`) áp dụng giống video/ảnh theo `kind`. Vùng chỉ có một ảnh thì giữ nguyên, không xoay vòng.

### 3d. Văn bản định dạng trong bố cục đa vùng (`zones[].rich`)

Vùng `text`/`marquee` của `layout` có thể kèm `rich` (định dạng đậm/nghiêng/màu/cỡ/căn lề…) bên cạnh `text` thuần; đặc tả trường ở DEVICE-PROTOCOL.md. App TV **không cần WebView**: `rich` chỉ gồm `p`, `b`, `i`, `u`, `s`, `br`, `span` nên tự tách chuỗi rồi dựng `SpannableStringBuilder`:

| `rich` | Android |
| --- | --- |
| mỗi `<p>` | một đoạn, nối bằng `\n`; `text-align` → `AlignmentSpan.Standard` (`ALIGN_NORMAL`/`CENTER`/`OPPOSITE`) hoặc `setJustificationMode(INTER_WORD)` (API 26+) cho `justify`; `line-height` → `setLineSpacing(0f, hệ_số)` |
| `<br>` | `\n` trong đoạn |
| `<b>` / `<i>` | `StyleSpan(BOLD)` / `StyleSpan(ITALIC)` |
| `<u>` / `<s>` | `UnderlineSpan` / `StrikethroughSpan` |
| `color` / `background-color` | `ForegroundColorSpan` / `BackgroundColorSpan` |
| `font-size:NNpx` | `AbsoluteSizeSpan(NN × hệ số khung, true)`; hệ số = hệ số đang áp cho `font_size` của vùng (đơn vị khung thiết kế) |
| `font-weight` 300 / 500 / 900 | API 28+: `TypefaceSpan(Typeface.create(base, weight, italic))`; cũ hơn: `sans-serif-light` / `sans-serif-medium` / `sans-serif-black` |
| `font-family` | Roboto, Arial, Verdana, Tahoma, `sans-serif` → `sans-serif`; Georgia, Times New Roman, `serif` → `serif`; Courier New, `monospace` → `monospace` |
| `letter-spacing:Npx` | `ScaleXSpan` xấp xỉ hoặc `TextView.setLetterSpacing(N / textSize)` cho cả khối |

`font_size`, `text_color`, `bg_color` của vùng là kiểu nền, kiểu trong `rich` ghi đè. `marquee` luôn một `<p>`: dựng một `TextView` một dòng (`ellipsize=marquee`) với cùng Spannable. Không parse được hoặc không có `rich` thì dùng `text`. Máy chủ đã làm sạch `rich` (danh sách thẻ/thuộc tính cố định), nhưng TV vẫn **bỏ qua** thẻ/thuộc tính lạ thay vì hiển thị hoặc thực thi chúng.

## 8. Rủi ro và tuân thủ

(Mục số 8 được giữ để khớp tham chiếu trong PATCH-NOTES.)

**8.1 Đối tượng trẻ em.** Brain-rot là ứng dụng giám sát trẻ em; màn khóa là màn trẻ nhìn thấy. Quảng cáo ở đó là rủi ro lớn nhất của cả tích hợp. Biện pháp trong thiết kế: tắt mặc định; chỉ bật khi phụ huynh chủ động từ điện thoại (`ads-config`); chỉ creative có `kid_safe=true` do người duyệt xác nhận mới lên màn khóa; không bao giờ che nút PIN/phụ huynh hoặc thông tin an toàn (cột quảng cáo chỉ chiếm 69 %, lệnh `unlock` vẫn có tác dụng); nhãn "TÀI TRỢ • QUẢNG CÁO" luôn hiển thị. Nên **cấm hẳn** các ngành không phù hợp với trẻ em ở bước duyệt (rượu bia, thuốc lá, cờ bạc/cá cược, tài chính vay nóng, nội dung người lớn, thực phẩm chức năng, thuốc).

**8.2 Pháp lý Việt Nam (chỉ nêu tên văn bản, cần luật sư xác nhận; không trích điều khoản).** Luật Quảng cáo 2012 (sửa đổi 2018); Luật Trẻ em 2016; Nghị định 13/2023/NĐ-CP về bảo vệ dữ liệu cá nhân (dữ liệu trẻ em; sự đồng ý của cha mẹ); Nghị định 181/2013/NĐ-CP hướng dẫn Luật Quảng cáo; Luật An ninh mạng 2018. Điều chưa rõ và cần xác nhận: quảng cáo gắn với thương hiệu thật hiển thị cho trẻ trong ứng dụng giám sát có bị coi là nhắm vào trẻ em không; trách nhiệm của AMS (đơn vị phát) so với nhà quảng cáo; việc ghi nhận lượt xem theo thiết bị có là dữ liệu cá nhân hay không. Đồng ý của phụ huynh: công tắc "Quảng cáo trên TV" phải có chữ giải thích rõ và nút xác nhận (việc của app điện thoại, chưa làm).

**8.3 Nội dung thương hiệu.** Chữ trong ảnh phải đúng: "4K", "DOLBY VISION & ATMOS", "Miễn cước" là khẳng định thương mại; người duyệt phải đối chiếu hồ sơ nhà quảng cáo. `scte_id` chỉ là nhãn hiển thị, **không** chèn SCTE-35 thật vào luồng nào. Voucher và hotline phải còn hiệu lực trong thời gian chiến dịch. QR dẫn qua máy chủ chuyển hướng của AMS, chỉ HTTPS.

**8.4 SYSTEM_ALERT_WINDOW và Accessibility.** Brain-rot đã dùng cả hai cho chức năng giám sát. Chính sách Google Play về Accessibility API và lớp phủ không cho phép dùng chúng để phục vụ quảng cáo; ứng dụng này là APK debug phân phối ngoài Play (`vn.brainrot.parental`), nhưng nếu sau này lên Play thì tích hợp quảng cáo có nguy cơ bị coi là adware/hành vi gây khó chịu. Biện pháp: quảng cáo chỉ vẽ trong lớp phủ khóa sẵn có, không dùng Accessibility để chèn/đóng quảng cáo ở ứng dụng khác, không nằm đè lên ứng dụng của bên thứ ba (hook `pause`/`corner` cố ý chưa nối và cần quyết định riêng), có tần suất trần, không khóa thiết bị vì quảng cáo, không chạy khi phụ huynh chưa bật.

**8.5 Pin và nhiệt.** TV cắm điện nên pin ít quan trọng, nhưng bộ giải mã ảnh 4K, vòng lặp 1 giây và heartbeat nền làm tăng tải trên SoC yếu. Giảm thiểu: giải mã ảnh nền với `inSampleSize` + RGB_565 theo kích thước màn, 1 luồng nền, heartbeat theo `next_interval` của máy chủ, gửi `soc_temp` để máy chủ có thể hạ tần suất. **Chưa đo thực tế.**

**8.6 TV không có Ed25519 gốc.** Không phụ thuộc vào nó: dùng BouncyCastle thuần Java (chậm hơn nhưng mỗi yêu cầu chỉ ký một lần). Trên TV không có AndroidKeyStore dùng được, hạt giống lưu `software` trong `noBackupFilesDir` (kẻ có quyền root đọc được; rủi ro được ghi nhận, máy chủ phát hiện bằng trust_level và giới hạn tần suất). Chưa thử ở TV Android < 6 hoặc Keystore lỗi.

**8.7 Chưa có xác minh thực tế** (liệt kê rõ):
- Chưa build bằng Android SDK/Gradle; mã Java chỉ được biên dịch với `stub` (`check/run.sh`), và patch chỉ qua `git apply --check` + phân tích cú pháp.
- Chưa thấy bộ vẽ trên màn hình: bố cục, PhoneGlyph, tỷ lệ 69/31, cỡ chữ, vùng an toàn của TV (overscan).
- Chưa thử trên TV thật: lớp phủ trên đầu vào HDMI, phát hiện tắt màn khi chờ/tắt panel, nhiệt/pin, Keystore trên TV rẻ, hành vi API 34/35 với foreground service `connectedDevice`.
- Chưa kiểm Ed25519 trong AndroidKeyStore (API 33+) ngoài tài liệu.
- Chưa có app điện thoại gửi `ads-config`; chưa có `BOOT_COMPLETED`.
- 12 kiểm chạy thật với edge-gateway cục bộ đã chạy trước khi nới lược đồ theo `parseOverlay`; sau đó chỉ chạy lại 39 kiểm ngoại tuyến + 28 test vitest.
- Chưa có tư vấn pháp lý; mục 8.2 chỉ là danh sách cần xác nhận.

## 9. Cách kiểm lại

```
cd integrations/brainrot-tv && pnpm install --ignore-workspace && npx vitest run && npx tsc -p tsconfig.json
cd android/check && ./run.sh                       # 39 kiểm ngoại tuyến
cd android/check && ./run.sh http://127.0.0.1:PORT # thêm kiểm với gateway thật (RUNTIME=test)
```
