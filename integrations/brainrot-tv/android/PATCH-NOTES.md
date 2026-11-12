# PATCH-NOTES: gắn client AMS vào Brain-rot 1.0.39

Mã tham chiếu, **chưa áp vào `D:\JOB\TV Block`** (phiên này chỉ đọc thư mục đó). Giải thích thiết kế: `docs/TV-APP-INTEGRATION.md`.

Gốc áp dụng: `D:\JOB\TV Block\publish\brainrot-app` (đường dẫn trong patch tính từ thư mục này, `-p1`).

## 1. Tệp mới (chép nguyên)

| Từ `integrations/brainrot-tv/android/` | Đến `brainrot-app/android/` |
|---|---|
| `app/src/main/java/vn/brainrot/parental/tv/Ams*.java` (7 tệp) | `app/src/main/java/vn/brainrot/parental/tv/` (cùng gói `vn.brainrot.parental.tv`, bắt buộc: `TvOverlayController` là lớp package-private) |
| `app/src/main/res/xml/ams_backup_rules.xml`, `ams_data_extraction_rules.xml` | `app/src/main/res/xml/` |

7 tệp Java: `AmsClient` (đăng ký/ghép đôi/heartbeat/manifest/events, ký Ed25519, jitter, backoff, Retry-After), `AmsKeys` (khóa Ed25519), `AmsOverlaySpec` (kiểm `creative.overlay`), `AmsOverlayRenderer` (vẽ view), `AmsAdScheduler` (chọn creative + cache), `AmsImpressionTracker` (đo + hàng đợi sự kiện bền), `AmsCoordinator` (luồng nền + cầu nối).

## 2. Sửa tệp có sẵn: một patch duy nhất

`ams-integration.patch` (213 dòng, 5 tệp, 14 hunk). Các tệp Java/XML/gradle của Brain-rot dùng **CRLF** (trừ `TvReceiverActivity.java` dùng LF), nên patch LF thuần phải áp bằng:

```bash
cd "D:/JOB/TV Block/publish/brainrot-app"
git apply --check --ignore-whitespace -p1 /path/to/ams-integration.patch   # thử trước, không ghi gì
git apply --ignore-whitespace -p1 /path/to/ams-integration.patch
```

`patch(1)` không dùng được với tệp CRLF (báo "different line endings"). Sau khi áp, các dòng thêm mới là LF trong tệp CRLF: chạy `unix2dos` hoặc để editor/Git chuẩn hóa. Đã kiểm `git apply --check --ignore-whitespace` trên **bản thật** của 5 tệp (đọc từ D:, không ghi): xanh. Chưa kiểm khi đã áp.

### 2.1 `TvOverlayController.java` (4 hunk)

- Thêm trường `private static FrameLayout lockAdSlot;`.
- `showLockNow`: thay `root.addView(content, ...)` bằng một hàng ngang `[adSlot (GONE, weight 69)] [content (weight 31)]`. Khi `adSlot` ẩn, `content` chiếm 100% như cũ (không đổi hành vi hiện có). Gọi `AmsCoordinator.onLockAttached(adW, H)` sau khi `WindowManager` nhận view; nếu `add()` thất bại thì `lockAdSlot = null`.
- `removeCurrent()`: hai đường thoát thành công gọi `releaseLockAd()` (→ `AmsCoordinator.onLockDetached()`), nên mọi cách gỡ lớp khóa (unlock, thay bằng message/policy, mất cửa sổ) đều kết thúc lượt quảng cáo đang chạy.
- Hàm mới `static boolean setLockAdView(View ad)` (chỉ main thread): đưa view vào cột trái hoặc xóa (trả bề rộng cho bảng khóa).
- Không đụng tới `showMessageNow`, `showPolicyNoticeNow`, cờ `locked`/`policyActive`/`messageActive`: lệnh `unlock` từ điện thoại vẫn gỡ lớp khóa như cũ, quảng cáo không giữ được nó.

### 2.2 `TvBridgeService.java` (3 hunk)

- `onStartCommand`: `AmsCoordinator.start(this)` bọc `try/catch Throwable` (lỗi AMS không được làm sập cầu nối phụ huynh). Idle hoàn toàn cho tới khi phụ huynh bật quảng cáo.
- `onDestroy`: `AmsCoordinator.stop()`.
- `command()`: lệnh mới `ads-config` `{enabled?: boolean, region?: "HN"|"HCM"|"DN"|...}` (được bảo vệ bằng Bearer token ghép đôi sẵn có; **đây là điểm duy nhất bật quảng cáo**, mặc định tắt).
- `state()`: thêm khối `ams` `{adsEnabled, registered, trustLevel, manifestEtag, keyProtection, queuedEvents, partialPlaysDropped, cacheFiles, cacheBytes, pairing{paired, code, expiresInS}}` để điện thoại hiển thị mã ghép AMS và chẩn đoán.

### 2.3 `TvReceiverActivity.java` (5 hunk)

- Một dòng "Liên kết tài khoản AMS · mã 123456 · còn 4:59" dưới tiêu đề, chỉ hiện khi phụ huynh đã bật quảng cáo và TV chưa liên kết (`trust_level < 1`). `onResume/onPause` gọi `AmsCoordinator.setPairingVisible(true/false)`: chỉ khi màn này hiện thì mới thăm dò `POST /v1/pair` (mã mới giới hạn 6 lần/giờ/thiết bị).
- Mã ghép AMS (6 số, 5 phút) khác mã ghép Brain-rot (6 ký tự, 60 giây, QR `brainrot://pair`): hai dòng riêng, không dùng chung QR.

### 2.4 `AndroidManifest.xml` (1 hunk)

- **Không thêm quyền mới**: `INTERNET`, `ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE`, `SYSTEM_ALERT_WINDOW`, `FOREGROUND_SERVICE(+CONNECTED_DEVICE)` đã có.
- Thêm `android:dataExtractionRules` và `android:fullBackupContent` trỏ tới hai tệp XML mới: loại `brainrot_ams.xml` (device_id, etag) và thư mục `ams/` khỏi sao lưu đám mây/chuyển máy (`allowBackup="true"` hiện tại sẽ nhân bản `device_id` sang TV khác nếu không loại). Hạt giống khóa nằm ở `getNoBackupFilesDir()` nên đã tự loại.
- Không đụng `<service>`: dịch vụ vẫn `foregroundServiceType="connectedDevice"`. Xem rủi ro ở TV-APP-INTEGRATION mục 8.

### 2.5 `app/build.gradle` (1 hunk)

- Khai báo tường minh `org.bouncycastle:bcprov-jdk18on:1.79` (hiện chỉ có qua `bcpkix-jdk18on:1.79` bắc cầu; APK 1.0.39 đã chứa `org/bouncycastle/crypto/signers/Ed25519Signer`). ZXing 3.3.3 (vẽ QR) đã có sẵn. Không thêm thư viện nào khác.
- Nếu bật R8 (`minifyEnabled true`): giữ `-keep class org.bouncycastle.crypto.** { *; }` hoặc để R8 tự giữ vì `AmsKeys` tham chiếu trực tiếp (chưa thử).

## 3. Việc cần làm tay (không nằm trong patch)

1. **Phía điện thoại (`src/` Capacitor/JS, chưa đọc ở phiên này):** màn hình bật/tắt "Quảng cáo trên TV" có chữ giải thích và nút xác nhận của phụ huynh; gửi `POST /v1/command {"command":"ads-config","payload":{"enabled":true,"region":"HN"}}` tới TV qua `TvCompanionPlugin`; hiển thị `state.ams.pairing.code` để phụ huynh nhập vào ứng dụng AMS. Chọn thành phố đã có trong app → ánh xạ sang mã vùng (`HN`, `HCM`, `DN`...).
2. **Khởi động lại TV:** không có `BOOT_COMPLETED` receiver, nên `TvBridgeService` (và AMS) chỉ chạy lại khi mở màn hình receiver. Nếu muốn quảng cáo/heartbeat sống qua khởi động lại: thêm `RECEIVE_BOOT_COMPLETED` + một `BroadcastReceiver` gọi `startForegroundService`. Việc này đổi hành vi app giám sát (ngoài phạm vi AMS), chưa làm.
3. **Allow-list CDN:** `AmsAdScheduler.Config.mediaHostSuffixes` mặc định `["anio.vn"]` (giữ chỗ). Đặt đúng tên miền công khai của kho media (`MEDIA_PUBLIC_URL`) trước khi chạy thật, nếu không mọi creative bị bỏ qua (an toàn nhưng không có quảng cáo).
4. **Gateway:** `AmsCoordinator` dùng `https://gw-ams.anio.vn` (hoặc khóa prefs `gateway` trong `brainrot_ams`). Khóa `gateway` chỉ đặt được qua mã, không qua lệnh từ điện thoại (cố ý).
5. **Hook chưa nối (thiết kế có sẵn trong mã, chưa có điểm cắm):** `pause_ad`/`qr_corner` (`AmsOverlayRenderer.Layout.CORNER_CARD`, `AmsAdScheduler.peek("pause"|"corner")`) cần lắng nghe `PlaybackState.STATE_PAUSED` của `MediaController` trong `TvMediaListenerService`/`TvBridgeService.updateActiveSessions` và một cửa sổ overlay không nhận focus. Cần đồng ý riêng (quảng cáo đè lên ứng dụng khác), xem mục 8.

## 4. Kiểm chứng đã làm

| Kiểm | Kết quả |
|---|---|
| `integrations/brainrot-tv/android/check/run.sh` (javac 21 + stub `android.*`/`org.json`/ZXing, BouncyCastle 1.77 thật) | biên dịch sạch; 51 kiểm, gồm vector chữ ký của `DEVICE-PROTOCOL.md` 3.4, kiểm overlay, đếm impression, lập lịch, delta, và chạy thật với edge-gateway cục bộ (register, pair, heartbeat, manifest 200/304, lệch đồng hồ, events 202 hợp lệ, gửi lại idempotent) |
| `git apply --check --ignore-whitespace -p1` trên 5 tệp thật ở D: | xanh (không ghi) |
| parse cú pháp 3 tệp Java sau patch (javac 11 `-XDshould-stop.at=PARSE`, lọc lỗi ký hiệu) | không có lỗi cú pháp |
| Biên dịch bằng Android SDK/Gradle, chạy trên TV | **chưa**: môi trường không có SDK; không cài APK |

Stub chỉ để biên dịch/chạy logic thuần, không mô phỏng Android (view không được vẽ, `Handler` không chạy). `check/stubs/vn/brainrot/parental/tv/TvOverlayController.java` là stub một hàm của lớp thật đã vá.
