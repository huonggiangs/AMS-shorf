# Giao thức thiết bị AMS (app TV, player thang máy, LED) <-> edge-gateway

Tài liệu này là **hợp đồng** cho agent a4 khi ánh xạ sang app TV Brain-rot. Các ví dụ phản hồi JSON dưới đây lấy từ một lần chạy thật của gateway trong test (`tools/sim`; trường tùy chọn ghi rõ là tùy chọn), mọi chuỗi ký trong mục 3.4 có test khóa chặt (`tools/sim/test/vector.test.ts`). Mã nguồn: `services/edge-gateway/src` (`protocol.ts` là nguồn sự thật về kiểu/giới hạn). Bản tham chiếu client chạy được: `tools/sim/src/device.ts` (`VirtualDevice`).

Phạm vi đã kiểm chứng: HTTP JSON, ký Ed25519, chạy in-process (Hono `app.request`) trên SQLite và PGlite. **Chưa kiểm chứng:** Cloudflare thật (Workers, Durable Object), mạng thật, thiết bị thật. Điểm khác nhau Docker/Cloudflare ghi rõ ở mục 12.

## 1. Địa chỉ và quy ước

| Môi trường | Gateway |
|---|---|
| Local (Node) | `http://localhost:8788` (hoặc `https://gw.ams.localhost` qua Caddy) |
| Staging | `https://gw-ams-stg.anio.vn` |
| Production | `https://gw-ams.anio.vn` |

- Chỉ HTTPS ở staging/production. Thân JSON UTF-8, `Content-Type: application/json`. Thời gian ISO-8601 UTC (`2026-11-12T07:06:53.744Z`) trừ khi ghi "epoch giây".
- Đường dẫn gateway nằm ở gốc host: `/v1/...` và `/health` (không có tiền tố `/api`).
- Lỗi luôn là `{"error":{"code":"snake_case","message":"tiếng Việt","details":?}}` với HTTP đúng nghĩa. App phải rẽ nhánh theo `error.code`, không theo `message`.
- `GET /health` (không ký): `{"ok":true,"service":"edge-gateway","runtime":"...","time":"<ISO>"}`. Dùng để đồng bộ đồng hồ thô và kiểm kết nối.

## 2. Vòng đời thiết bị

```
khởi động lần đầu: sinh cặp khóa Ed25519 (khóa riêng không bao giờ rời thiết bị)
  -> POST /v1/register          (một lần; lưu device_id)
  -> POST /v1/pair              (nhận mã 6 số, hiển thị trên TV; người dùng nhập trên app điện thoại)
       lặp lại POST /v1/pair mỗi 5-10 giây cho đến khi {"paired":true}   (tối đa 5 phút/mã; hết hạn thì gọi lại để lấy mã mới)
  -> vòng lặp chính:
       POST /v1/heartbeat       -> nhận next_interval, manifest_etag, lệnh
       nếu manifest_etag != etag đang giữ: GET /v1/manifest?etag=<đang giữ>
       tải trước creative mới (CDN), kiểm sha256, rồi mới chuyển sang lịch mới
       phát quảng cáo theo lịch; gom sự kiện; POST /v1/events theo lô
       ngủ next_interval giây, lặp lại
```

Thiết bị **chưa ghép đôi** (trust_level 0) vẫn heartbeat, nhận manifest và gửi sự kiện, nhưng sự kiện bị đánh `valid=0` (không tính tiền, không thưởng). Player thang máy/LED do vận hành cấp quyền (trust_level >= 1) qua admin, không dùng mã 6 số.

Sau mất điện/khởi động lại hàng loạt, app **phải** chờ ngẫu nhiên 0 đến 60 giây trước heartbeat đầu tiên (tránh bão kết nối; server chỉ giảm tải được từng phần).

## 3. Chữ ký

Mọi yêu cầu tới `/v1/*` (trừ `/health` và `GET /v1/manifest/g/...`) mang 4 tiêu đề:

| Tiêu đề | Giá trị |
|---|---|
| `X-Device-Id` | `device_id` do `register` cấp (**không gửi** ở chính yêu cầu `register`) |
| `X-Timestamp` | epoch **giây**, số nguyên 9-12 chữ số |
| `X-Nonce` | 16-64 ký tự `[A-Za-z0-9_-]`, ngẫu nhiên mật mã học (khuyến nghị 16 byte ngẫu nhiên mã hóa base64url = 22 ký tự) |
| `X-Signature` | chữ ký Ed25519 (64 byte) mã hóa **base64url không đệm** (86 ký tự) |

### 3.1 Chuỗi cần ký (canonical string)

Năm trường nối bằng ký tự xuống dòng `\n` (0x0A), **không** có `\n` ở cuối:

```
<METHOD>\n<PATH_VA_QUERY>\n<X-Timestamp>\n<X-Nonce>\n<sha256hex(body)>
```

- `METHOD`: viết hoa (`GET`, `POST`).
- `PATH_VA_QUERY`: đúng chuỗi gửi trên đường truyền, gồm cả query (`/v1/manifest?etag=0123456789abcdef`), không gồm host. Nếu ký một chuỗi khác chuỗi gửi, chữ ký sai.
- `sha256hex(body)`: SHA-256 của **đúng các byte thân yêu cầu** (chữ thường, 64 ký tự hex). Thân rỗng (mọi `GET`): `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`. App phải ký đúng chuỗi byte sẽ gửi (đừng tuần tự hóa lại JSON sau khi ký).
- Khóa công khai: 32 byte thô, base64url không đệm (43 ký tự), gửi ở `register`.

### 3.2 Quy tắc

- Lệch đồng hồ cho phép: **±300 giây** so với giờ server. Vượt thì `401 stale_timestamp` kèm `details.server_time` (epoch giây): app tính độ lệch = `server_time - giờ_máy`, lưu lại và cộng vào mọi `X-Timestamp` sau đó. (TV hay sai giờ; `server_time` cũng có trong phản hồi `register`/`heartbeat`.)
- **Mỗi lần gửi, kể cả thử lại, phải tạo nonce mới và ký lại.** Server nhớ nonce 10 phút; cùng nonce -> `409 replay`. Nhớ nonce được ghi **sau khi** chữ ký đúng.
- Khóa riêng nằm trong kho khóa phần cứng/OS nếu có (Android Keystore) và không xuất ra. Ed25519 chưa có ở mọi nền tảng: Android cũ, Tizen, webOS có thể phải dùng thư viện (libsodium, Tink, tweetnacl). Chỉ cần ra đúng chữ ký thô 64 byte theo RFC 8032 (Ed25519 "pure", không băm trước, không context).
- Chữ ký Ed25519 là tất định: cùng khóa và cùng chuỗi cho cùng chữ ký, nên có thể dùng vector dưới đây để tự kiểm.

### 3.3 Mã giả

```
nonce = base64url(random(16))
ts    = floor(now_ms / 1000) + clock_offset_s
body  = json_bytes            // gửi đúng các byte này
msg   = method + "\n" + path_and_query + "\n" + ts + "\n" + nonce + "\n" + hex(sha256(body))
sig   = base64url_nopad(ed25519_sign(private_key, utf8(msg)))
headers: X-Device-Id, X-Timestamp: ts, X-Nonce: nonce, X-Signature: sig
```

### 3.4 Vector kiểm thử (khóa này chỉ để thử, đừng dùng ở thiết bị thật)

Khóa riêng = 32 byte `01 02 03 ... 20` (PKCS8 base64url `MC4CAQAwBQYDK2VwBCIEIAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8g`).
Khóa công khai: `ebVWLo_mVPlAeLES6KmLp5AfhTrmlb7X4OORC60ElmQ`.

Ví dụ A: `POST /v1/heartbeat`

```
body      = {"state":1,"app_ver":"2.4.1"}
sha256hex = 9c988fe6254f7a3302fb33f879385e791d10bda67dc85368fe881620f4382373
X-Timestamp = 1790000000
X-Nonce     = dGVzdC1ub25jZS0wMDAxMjM0NQ
chuoi ky  = "POST\n/v1/heartbeat\n1790000000\ndGVzdC1ub25jZS0wMDAxMjM0NQ\n9c988fe6254f7a3302fb33f879385e791d10bda67dc85368fe881620f4382373"
X-Signature = CXnm2wux9_DA7w9k-ffoDVttGjqKMHjnqqfFVyE27vpclPh3_0WZ3ygHkxv8XPjybGuxllXWqns0Faj8MlvoCQ
```

Ví dụ B: `GET /v1/manifest?etag=0123456789abcdef` (thân rỗng)

```
X-Timestamp = 1790000000
X-Nonce     = dGVzdC1ub25jZS0wMDAyMzQ1Ng
chuoi ky  = "GET\n/v1/manifest?etag=0123456789abcdef\n1790000000\ndGVzdC1ub25jZS0wMDAyMzQ1Ng\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
X-Signature = mXpRgShahnYz44uqDrSX6u8DA7shknkoBs5gFUwr4locDX74EgL8DU3XwagpYkjBeych2IcTcg-K9lMe_W4gCg
```

(Ví dụ A/B không phải yêu cầu thật gửi lên gateway vì timestamp 1790000000 bị coi là quá cũ.)

## 4. `POST /v1/register`

Một lần cho mỗi thiết bị. Chữ ký dùng **khóa riêng của chính thiết bị** (chứng minh sở hữu khóa), không có `X-Device-Id`. Nonce chống phát lại theo khóa công khai.

Yêu cầu:

```json
{"pubkey":"oagqx7q2K3tyxEm1XzjPtfGXtzZrT-pRHd5a56LeXTI","kind":"tv","model":"SimTV-1","os":"sim","app_version":"0.0.1-sim","region":"HN"}
```

| Trường | Bắt buộc | Ghi chú |
|---|---|---|
| `pubkey` | có | base64url 43 ký tự |
| `kind` | không (mặc định `tv`) | `tv`, `elevator`, `led_p5`, `phone`, `virtual` |
| `model`, `os`, `app_version` | không | chuỗi ngắn (<=80/40/20 ký tự) |
| `region` | không | mã vùng (`HN`, `HCM`, `DN`...). Quyết định nhóm manifest. Chưa gửi thì nhóm `ALL` |

Phản hồi `201` (mới) hoặc `200` (đã đăng ký cùng `pubkey`, trả lại cùng `device_id`):

```json
{"device_id":"01M7799CD1QCNFX17Y8FS4RB7G","trust_level":0,"attestation_nonce":"OO_8ga1Xa3gOhjIUXtCyRA","server_time":"2026-11-12T07:06:53.729Z","protocol":1,"heartbeat_interval":600,"created":true}
```

- `attestation_nonce`: nonce để nối với chứng thực thiết bị thật (Play Integrity/Widevine L1). **Server chưa kiểm chứng chứng thực** (chưa có endpoint nộp token); trust_level tăng lên 1 khi ghép đôi, bậc 2 dành cho chứng thực (chưa làm).
- Giới hạn: 20 lần/giờ/IP (`429 rate_limited` + `Retry-After`). Trùng khóa cho thiết bị đã bị khóa: `403 device_blocked`.
- App lưu `device_id` bền vững. Mất `device_id` nhưng còn khóa: gọi lại `register` với cùng khóa để lấy lại.

## 5. `POST /v1/pair`

Chữ ký thiết bị. Thân `{}`. Lặp lại để thăm dò.

Chưa ghép đôi: trả mã (cùng mã cho đến khi hết hạn hoặc được dùng):

```json
{"paired":false,"code":"094735","expires_at":"2026-11-12T07:11:53.739Z","expires_in":300,"ttl_s":300}
```

Đã ghép đôi (người dùng đã nhập mã trên app điện thoại; API cổng khách hàng gọi `redeemPairingCode` của gateway):

```json
{"paired":true,"trust_level":1}
```

- Mã 6 chữ số, hết hạn sau **5 phút**, dùng một lần. Xin mã mới tối đa 6 lần/giờ/thiết bị (`429`). Mã hết hạn thì gọi `pair` lại để nhận mã mới.
- Hiển thị mã lớn trên TV, kèm đồng hồ đếm ngược theo `expires_in`.

## 6. `POST /v1/heartbeat`

Chữ ký thiết bị. Thân JSON nhỏ (mục tiêu <512 byte, **tối đa cứng 2.048 byte**, `413 payload_too_large`). Hiện là JSON; CBOR/protobuf là hướng tối ưu sau (chưa làm).

```json
{"state":1,"app_ver":"0.0.1-sim","soc_temp":46,"rssi":-59,"dl_mbps":20,"cache_used_mb":300,"cache_slots":8,"manifest_etag":"197981c9f9718c12","cmd_ack":["01M779..."]}
```

| Trường | Kiểu | Ghi chú |
|---|---|---|
| `state` | int 0-3 | 0 chờ, 1 đang phát, 2 lỗi, 3 chế độ giám sát (do lệnh). Quyết định chu kỳ |
| `app_ver` | string | cập nhật `devices.app_version` |
| `soc_temp` (độ C), `rssi` (dBm, <=0), `dl_mbps`, `cache_used_mb`, `cache_slots` | số | telemetry; có thể bị lấy mẫu phía server (không ảnh hưởng phản hồi) |
| `manifest_etag` | string | etag đang giữ (thông tin) |
| `cmd_ack` | string[] <=20 | id lệnh đã thực thi; server xóa lệnh khỏi hàng đợi |

Phản hồi `200`:

```json
{"ok":true,"server_time":"2026-11-12T07:06:53.744Z","next_interval":244,"interval_base":300,"manifest_etag":"197981c9f9718c12","manifest_group":"HN.all.tv","manifest_url":"/v1/manifest/g/HN.all.tv","commands":[]}
```

- `next_interval` (giây): **app phải ngủ đúng giá trị này** rồi heartbeat lại (không tự đặt chu kỳ). Server tính: `interval_base` theo `state` (đang phát 300, chờ 600, lỗi 120, giám sát 15; có thể đổi bằng biến cấu hình), nhân thêm khi tải cao (từ 70% công suất; 100% -> x2,2; tối đa x4) hoặc công tắc điều khiển, rồi **jitter đều ±20%** quanh `interval_base`. Luôn có `ceil(0,8 x base) <= next_interval <= floor(1,2 x base)`.
- Online suy diễn: coi thiết bị online nếu `last_seen < 2,5 x chu kỳ` (phía hiển thị).
- `manifest_etag`: nếu khác etag đang giữ, gọi `GET /v1/manifest`. `manifest_group`/`manifest_url`: dạng công khai để CDN cache (mục 7.3).
- `commands`: mảng `{id, type, args?}`. Giao lại ở mỗi heartbeat cho đến khi nhận `cmd_ack` chứa id (ít nhất một lần: lệnh phải **idempotent**). `type` quy ước ban đầu: `refresh_manifest` (làm mới ngay), `reboot`, `set_monitor` (đặt `state` 3). App gặp `type` lạ thì bỏ qua và vẫn ack.
- `min_app_version` (tùy chọn, chỉ có khi vận hành đặt công tắc, ví dụ `"2.4.0"`): bản tối thiểu server chấp nhận; thấp hơn thì app nên tự cập nhật.
- Heartbeat gần nhau hơn 5 giây: `429 rate_limited` + `Retry-After`.
- **Giảm tải:** khi quá tải server trả `503 overloaded` kèm `Retry-After` (giây, đã jitter ±20%) trước khi tốn CPU xác thực. App ngủ đúng `Retry-After` rồi thử lại, không tự rút ngắn.

## 7. Manifest

### 7.1 `GET /v1/manifest?etag=<etag đang giữ>` (có ký, thân rỗng)

- Chọn nhóm theo thiết bị: `region x model_class` (daypart `all`: một manifest chứa mọi khung giờ). `model_class`: `tv` cho TV; `elevator_<w>x<h>` / `led_p5_<w>x<h>` khi thiết bị gắn với một `screens` có độ phân giải (admin gắn); ngược lại `elevator`, `led_p5`.
- `?daypart=<tên>` (tùy chọn): chỉ các slot của khung giờ đó (nhóm riêng, etag riêng). Bỏ qua nếu không cần.
- Nếu `etag` (hoặc `If-None-Match`) trùng bản hiện hành: `304` thân rỗng. Phản hồi luôn có `ETag: "<etag>"`; `Cache-Control: private, no-cache` (không cache dùng chung).
- `?etag=<cũ>&delta=1`: nếu server còn bản `<cũ>` (giữ 1 giờ) trả **delta** (tiêu đề `X-Manifest-Kind: delta`), ngược lại trả bản đầy đủ (`X-Manifest-Kind: full`).

Phản hồi đầy đủ `200`:

```json
{"version":1,"group":"HN.all.tv","tz":"Asia/Ho_Chi_Minh","etag":"197981c9f9718c12","generated_at":"2026-11-12T07:06:53.744Z","ttl_s":900,
 "creatives":[{"id":"01M7799CBSK3S99KH0R0ZMB62T","campaign_id":"01M7799CBSK3S99KH0R0ZMB62R","url":"https://media.sim.test/test/01M7799CBSK3S99KH0R0ZMB62Q/01M7799CBSK3S99KH0R0ZMB62T.mp4","sha256":"3615be55c6e5d03fc8c9488ec283d5c9695fbe1808ed9811bdc4561f5b1ec23a","duration_s":15,"px_w":1920,"px_h":1080,"format":"fullscreen","media_type":"video","size_bytes":35}],
 "schedule":[{"slot_id":"01M7799CBSK3S99KH0R0ZMB62S","campaign_id":"01M7799CBSK3S99KH0R0ZMB62R","creative_ids":["01M7799CBSK3S99KH0R0ZMB62T"],"daypart":"all_day","start_min":0,"end_min":1440,"priority":2,"reward_points":10}]}
```

**Creative** `{id, campaign_id, url, sha256, duration_s, px_w, px_h, format, media_type, size_bytes}`

| Trường | Ý nghĩa |
|---|---|
| `url` | URL công khai (CDN/R2), ổn định, không chữ ký ngắn hạn; tải bằng HTTP GET thường, hỗ trợ `Range` |
| `sha256` | hex chữ thường của tệp; **bắt buộc kiểm sau khi tải**, sai thì xóa tệp và không phát |
| `duration_s` | thời lượng (giây); `null` với ảnh tĩnh chưa khai báo (dùng thời lượng slot/mặc định của app) |
| `px_w`, `px_h` | độ phân giải tệp |
| `format` | `fullscreen`, `menu_banner`, `l_banner`, `pause_ad`, `qr_corner`, `reward`. **Hiện server chỉ phát ra `fullscreen`** trừ khi dữ liệu creative ghi định dạng khác (cột riêng chưa có: xem yêu cầu cho f1) |
| `media_type` | `video` hoặc `image` |

**Slot** (`schedule[]`): `{slot_id, campaign_id, creative_ids, daypart, start_min, end_min, priority, reward_points}`

- `start_min`/`end_min`: phút từ 00:00 theo múi giờ `tz` (hiện **luôn** `Asia/Ho_Chi_Minh`, UTC+7); `0..1440`, `start_min < end_min`. Slot áp dụng khi giờ địa phương nằm trong `[start_min, end_min)`.
- `priority`: số **nhỏ hơn = ưu tiên cao hơn** (quy ước tạm của gateway, hạt giống dữ liệu dùng 2-3). Cần a1/a2 chốt lại nếu khác.
- `creative_ids`: các bản creative của chiến dịch cho nhóm này. TV (tự co giãn): chọn bản có `px_w` lớn nhất không vượt độ phân giải màn hình, nếu không có thì bản nhỏ nhất. Thang máy/LED: manifest chỉ chứa bản **đúng** độ phân giải màn hình, dùng nguyên.
- `reward_points`: điểm thưởng nếu người xem xem đủ (chỉ TV có tài khoản; `format = reward` hiển thị lời nhắc).
- Quy tắc xoay vòng/tần suất **chưa nằm trong giao thức này** (đặc tả gốc chưa ghi). Đề xuất mặc định cho app: trong các slot đang hiệu lực, chọn theo `priority` tăng dần, cùng mức thì xoay vòng đều; chuyển sang bản đầy đủ khi `etag` đổi chỉ sau khi tải xong mọi creative mới.

Chỉ đưa vào manifest: chiến dịch `active` trong `[start_at, end_at]`, slot khớp loại màn hình và vùng (slot để trống vùng = mọi vùng), creative `review_state=approved`, `state=ready`, không nhiễm mã độc, và **tệp đã xác minh được sha256** ở kho đối tượng. Nhóm chưa có chiến dịch: `creatives` và `schedule` rỗng (hợp lệ).

### 7.2 Delta

```json
{"version":1,"group":"HN.all.tv","etag":"<mới>","base_etag":"<cũ>","generated_at":"...","ttl_s":900,
 "creatives_added":[ /* Creative đầy đủ */ ],"creatives_removed":["<creative_id>"],"schedule":[ /* lịch ĐẦY ĐỦ */ ]}
```

Áp dụng: `creatives = (creatives_cũ - creatives_removed) + creatives_added`; `schedule` thay thế hoàn toàn. Sau khi áp dụng, **giữ `etag` mới**; nếu có nghi ngờ lệch (thiếu creative được lịch tham chiếu), bỏ bản cục bộ và gọi lại không kèm `etag` để lấy bản đầy đủ. Giá trị `etag` chính là chữ ký của nội dung (16 ký tự đầu của SHA-256 trên `{version, group, tz, creatives, schedule}` đã sắp xếp theo `id`), nên không có checksum riêng.

### 7.3 Đường công khai cho CDN: `GET /v1/manifest/g/{group}`

Không ký, nội dung giống bản có ký, `Cache-Control: public, max-age=60, s-maxage=900, stale-while-revalidate=60`, `ETag`, `304` khi `?etag=` hoặc `If-None-Match` trùng. `{group}` là `manifest_group` từ heartbeat (`HN.all.tv`; dấu chấm giữ nguyên). Chỉ phục vụ nhóm đã từng được thiết bị thật hỏi (nhóm lạ: `404 not_found`). Tắt bằng `MANIFEST_PUBLIC=0`. Nội dung không bí mật (URL media công khai + sha256). Dùng đường này khi có nhiều thiết bị cùng nhóm sau CDN; đường có ký dành cho thiết bị cần xác thực hoặc nhóm riêng.

### 7.4 TTL và cache

- `ttl_s` (900): sau khoảng này nên kiểm lại (`GET ... ?etag=`) kể cả khi heartbeat chưa báo đổi (an toàn khi mất heartbeat). Bình thường chỉ cần theo `manifest_etag` trong heartbeat (cách nhau 5-10 phút).
- Server dựng lại nhóm tối đa mỗi 60 giây (`MANIFEST_BUILD_TTL_S`) nên thay đổi lịch có hiệu lực tối đa ~1-2 phút sau khi API xóa cache nhóm, hoặc tối đa 60 giây + bộ nhớ đệm 15 giây nếu không xóa.
- Disk cache: giữ creative theo `sha256`, **không xóa creative đang phát hoặc còn nằm trong bản manifest hiện hành**; dọn LRU khi đầy. Chuyển lịch mới nguyên tử: chỉ đổi khi tải/kiểm xong.
- Tuyệt đối đừng phát creative không có trong manifest hiện hành (sự kiện của nó bị từ chối, mục 8.4). Creative của bản manifest ngay trước đó vẫn được chấp nhận (để phát nốt lúc đổi lịch).

## 8. `POST /v1/events`

Chữ ký thiết bị. Lô **tối đa 50 sự kiện** (`422 validation_failed` nếu 0 hoặc >50), thân tối đa 16 KB. Tối đa 30 lô/phút/thiết bị.

```json
{"events":[{"type":"impression","event_id":"01a1ce94-a9e4-7c60-9c56-c7b87bc4c491","ts":"2026-11-12T07:06:51.748Z","campaign_id":"01M7799CBSK3S99KH0R0ZMB62R","creative_id":"01M7799CBSK3S99KH0R0ZMB62T","slot_id":"01M7799CBSK3S99KH0R0ZMB62S","vcr_pct":100,"played_ms":15000}]}
```

Phản hồi `202`:

```json
{"accepted":2,"valid":2,"flagged":0,"rejected":[]}
```

### 8.1 Sự kiện `impression`

| Trường | Ghi chú |
|---|---|
| `type` | `"impression"` |
| `event_id` | **UUIDv7** do thiết bị sinh lúc kết thúc lượt phát (36 ký tự, nibble phiên bản `7`), lưu bền **trước khi gửi**. Khóa idempotent |
| `ts` | ISO-8601 UTC lúc kết thúc lượt phát |
| `campaign_id`, `creative_id` | lấy từ manifest (bắt buộc khớp manifest) |
| `slot_id` | tùy chọn (dùng để tính điểm thưởng đúng slot) |
| `vcr_pct` | 0-100: tỷ lệ thời lượng creative đã phát liên tục (video completion rate). Pause/mất nét/che màn hình thì không tính |
| `played_ms` | tổng thời gian đã hiển thị thực, mili giây |

### 8.2 Sự kiện `proof_of_play` (thang máy, LED)

`{"type":"proof_of_play","event_id":"<uuidv7>","ts":"<ISO>","creative_id":"...","duration_ms":15000}`. Ghi vào `ev_proof_of_play`, khử trùng theo `event_id`; không tính hoa hồng.

### 8.3 Idempotent và gửi lại

- Gateway **không** báo trùng ở phản hồi: sự kiện trùng `event_id` (kể cả gửi lại cả lô sau timeout, hoặc hai lô chồng lấn) được hấp thụ im lặng ở hàng đợi/ingest và **không bao giờ đếm hai lần** (cả sự kiện, `impression_hourly` lẫn chi tiêu chiến dịch).
- Do đó an toàn gửi lại nguyên lô khi không chắc đã tới: giữ nguyên `event_id`, tạo nonce mới, ký lại.
- Lô nên được xả mỗi 5-10 phút hoặc khi đủ 20 sự kiện, tối đa 50. Giữ sự kiện chưa gửi trên đĩa; **sự kiện cũ hơn 48 giờ bị từ chối** (`ts_out_of_range`), `ts` ở tương lai quá 5 phút cũng vậy.

### 8.4 Cách server xử lý từng sự kiện

Từ chối hẳn (nằm trong `rejected`, **không lưu**; không thử lại vô ích):

| `reason` | Nguyên nhân |
|---|---|
| `malformed` | sai kiểu/thiếu trường/`event_id` không phải UUIDv7 |
| `ts_out_of_range` | quá cũ (>48 giờ) hoặc tương lai >5 phút |
| `not_in_manifest` | `creative_id` không thuộc manifest hiện hành hoặc trước đó của nhóm thiết bị |
| `campaign_mismatch` | `campaign_id` không khớp creative |

Lưu nhưng đánh dấu không hợp lệ (`accepted` đếm, `flagged` đếm, `valid=0`, không tính tiền, không thưởng):

| `reject_reason` | Điều kiện |
|---|---|
| `untrusted_device` | `trust_level = 0` (chưa ghép đôi/chưa được cấp quyền) |
| `vcr_low` | `vcr_pct <` ngưỡng (mặc định 100; `IMPRESSION_MIN_VCR`) |
| `short_play` | `played_ms < 0,9 x duration_s x 1000` (khi manifest có thời lượng) |
| `rate_cap` | vượt trần 120 impression hợp lệ/thiết bị/giờ (`IMPRESSION_MAX_PER_DEVICE_HOUR`) |

Sự kiện hợp lệ: ghi doanh thu `revenue_micro_vnd` (đơn giá **tạm** 20 ₫/impression, `IMPRESSION_PRICE_MICRO_VND`; chủ dự án phải thay bằng bảng giá thật) và `reward_vnd = reward_points của slot` chỉ khi thiết bị là TV có `trust_level >= 1` (quy đổi 1 điểm = 1 ₫, tạm, `REWARD_POINT_VND`). Các con số tiền này là tham số cấu hình chứ không phải quyết định thương mại.

Bậc tin cậy: `0` chưa ghép/chưa xác minh (không hoa hồng, không tính tiền quảng cáo); `1` đã ghép tài khoản hoặc do vận hành cấp; `2` đã chứng thực thiết bị thật (**chưa hiện thực**).

## 9. Bảng mã lỗi

| HTTP | `error.code` | Nghĩa | Hành động của app |
|---|---|---|---|
| 400 | `bad_request` | thân không phải JSON | sửa lỗi, không thử lại |
| 401 | `invalid_signature` | thiếu/sai tiêu đề, chữ ký sai, sai định dạng nonce | kiểm khóa/chuỗi ký; không thử lại nguyên xi |
| 401 | `stale_timestamp` | lệch đồng hồ >300 giây (`details.server_time`) | đồng bộ độ lệch rồi thử lại 1 lần |
| 401 | `unknown_device` | `X-Device-Id` lạ hoặc thiếu | gọi `register` lại với cùng khóa |
| 403 | `device_blocked` | thiết bị bị khóa | dừng gọi, chỉ thử lại sau 1 giờ |
| 404 | `not_found` | đường dẫn/nhóm không tồn tại | kiểm đường dẫn |
| 409 | `replay` | nonce đã dùng | tạo nonce mới và ký lại (lỗi của app nếu gặp ở lần gửi đầu) |
| 413 | `payload_too_large` | thân quá giới hạn | rút gọn |
| 422 | `validation_failed` | sai kiểu/giá trị (`details`: danh sách `{path,message}`) hoặc lô sự kiện sai kích thước | sửa dữ liệu, không thử lại nguyên xi |
| 429 | `rate_limited` | quá tốc độ (đăng ký theo IP, xin mã, heartbeat dày, lô sự kiện) | ngủ `Retry-After` giây |
| 500 | `internal` | lỗi server | backoff mũ |
| 503 | `overloaded` | giảm tải | ngủ `Retry-After` giây (đã có jitter) |

## 10. Thử lại và backoff

1. `Retry-After` (giây) có mặt: ngủ đúng giá trị đó (đã jitter phía server), **không** tự rút ngắn. Áp dụng cho 429 và 503.
2. Không có `Retry-After` (lỗi mạng, hết thời gian, 500, 502, 504): **backoff mũ với full jitter**: `ngu = uniform(0, min(60 s, 1 s x 2^lan_thu))`, lần thử 0, 1, 2, 3... Tối đa 4 lần cho yêu cầu tức thời (heartbeat), sau đó bỏ lượt này và đợi `next_interval` cuối cùng đã biết (hoặc 600 giây nếu chưa có).
3. Lô sự kiện: giữ trên đĩa, thử lại không giới hạn số lần nhưng trong 48 giờ, mỗi lần backoff mũ tối đa 15 phút; gửi tuần tự (không song song hàng chục lô).
4. Các mã 4xx khác (400, 401 sai chữ ký, 422, 413): **không** thử lại nguyên xi.
5. Không bao giờ thử lại `register` quá 5 lần/giờ (giới hạn IP chung cho cả khu nhà/quán dùng chung IP).
6. Không dùng chu kỳ cố định: luôn jitter; không đồng bộ theo giờ tròn.

## 11. Giới hạn tốc độ và kích thước (tham số mặc định, đổi bằng biến môi trường)

| Mục | Giá trị |
|---|---|
| Đăng ký | 20 lần/giờ/IP |
| Xin mã ghép đôi | 6 lần/giờ/thiết bị |
| Heartbeat tối thiểu giữa hai lần | 5 giây |
| Lô sự kiện | 30 lô/phút/thiết bị; <=50 sự kiện/lô; <=16 KB |
| Thân heartbeat | <=2 KB (mục tiêu <512 B) |
| Trần impression hợp lệ | 120/thiết bị/giờ |
| Nonce nhớ | 10 phút |
| Lệch đồng hồ | ±300 giây |

## 12. Khác biệt theo môi trường và giới hạn đã biết

- **Docker/Node:** presence và nonce nằm ở Redis (kv); `incr` của Redis nguyên tử nên chống phát lại chặt. **Cloudflare:** presence và nonce nằm ở Durable Object `PresenceShard` (SQLite, nguyên tử, chia 16 shard); KV không nguyên tử nên **không** dùng để chống phát lại ở production. Code Cloudflare chỉ mới qua `tsc`, chưa chạy thật.
- Telemetry heartbeat gộp lô ở gateway (không qua Queue từng heartbeat); mất heartbeat khi tiến trình khởi động lại là chấp nhận được. Impression đi qua Queue (`ingest.events`) vì liên quan tiền.
- Đã có và đã kiểm chứng: ký/nonce/skew, đăng ký/ghép đôi, heartbeat (jitter, giảm tải, lệnh), manifest (nhóm, 304, delta, CDN), sự kiện (idempotent, kiểm hợp lệ).
- **Chưa làm:** xác minh chứng thực thiết bị (Play Integrity/Widevine), push FCM, WebSocket cho nhóm giám sát, CBOR/protobuf, `GET /v1/wallet` và `POST /v1/withdraw` (app điện thoại, thuộc API), lấy mẫu telemetry theo thiết bị (chỉ có lấy mẫu toàn cục `TELEMETRY_SAMPLE_EVERY`), kiểm tra cụm thiết bị cùng IP/ASN, định dạng quảng cáo khác `fullscreen` (cần cột riêng), quy tắc xoay vòng/tần suất.

## 13. Checklist ánh xạ cho app TV Brain-rot (a4)

1. Sinh/lưu khóa Ed25519 (Keystore nếu được); hàm `sign(method, pathQuery, body)` đúng mục 3; kiểm bằng vector 3.4.
2. Lưu `device_id`, độ lệch đồng hồ, `etag` manifest, hàng đợi sự kiện trên đĩa (bền qua khởi động lại).
3. Màn hình ghép đôi: hiển thị `code`, đếm ngược `expires_in`, thăm dò `/v1/pair` 5-10 giây.
4. Vòng heartbeat dùng `next_interval`/`Retry-After`; jitter 0-60 giây sau khởi động.
5. Bộ tải creative: tải trước, kiểm `sha256`, chuyển lịch nguyên tử, dọn cache an toàn.
6. Bộ phát: lọc slot theo giờ `Asia/Ho_Chi_Minh` và `priority`; đo `vcr_pct`/`played_ms` thật; sinh UUIDv7; xả lô 5-10 phút.
7. Xử lý đủ bảng lỗi mục 9 và quy tắc thử lại mục 10; không đếm sự kiện lại sau khi gửi lỗi.
