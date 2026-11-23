# Báo cáo lượt xem quảng cáo (REPORTING)

Tài liệu này mô tả đường đi của số liệu lượt xem từ màn hình đến trang `/history` (quản trị) và trang **Báo cáo lượt xem** (khách hàng), thế nào là một lượt xem hợp lệ, và cách tìm lỗi khi số liệu bằng 0.

## 1. Luồng dữ liệu

```
App màn hình (Signage Player 9:16 / Mindo TV)
   │  POST /v1/events  (ký Ed25519, lô <= 50 sự kiện)
   ▼
Gateway (services/edge-gateway/src/events.ts, events-compat.ts)
   │  chuẩn hóa tên trường/kiểu -> kiểm tra -> trả 202 {accepted, valid, flagged, rejected[]}
   │  ghi device_event_stats (đếm theo thiết bị/giờ/lý do) cho "Chẩn đoán đồng bộ"
   ▼  hàng đợi ams-ingest-<env> (consumer là CHÍNH Worker gateway: handler queue())
Ingest consumer (services/ingest-consumer)
   │  khử trùng event_id, trừ chi tiêu (chỉ impression), ghi bảng sự kiện
   ▼
ev_ad_impression (TV)   ev_proof_of_play (thang máy/LED: device_id, campaign_id)
   ▼  đọc TRỰC TIẾP, không qua job tổng hợp
API: /admin/v1/reports/views, /portal/v1/reports/views, /admin/v1/history/diagnostics
   ▼
Web: Lịch sử xem > tab "Báo cáo lượt xem" + chip "Chẩn đoán đồng bộ"; khách: trang chủ "Báo cáo lượt xem"
```

Hai loại thiết bị gửi hai loại sự kiện khác nhau:

| App | Sự kiện | Trường (đúng như app gửi) |
|---|---|---|
| Signage Player (thang máy/LED) | `proof_of_play` | `type, event_id (UUIDv7), ts (ISO UTC .SSS Z), creative_id, duration_ms` |
| Mindo (TV) | `impression` | `type, event_id, ts, campaign_id, creative_id, slot_id?, vcr_pct, played_ms` |

Gateway **chấp nhận thêm** các dạng cũ (và đếm lại bằng `alias:<tên>` để biết app nào còn gửi kiểu cũ): UUID mọi phiên bản; `ts` có múi giờ, epoch giây/mili giây; tên camelCase (`creativeId`, `eventId`, `campaignId`, `timestamp`); thời lượng ở `played_ms`/`duration_s`/`duration`; `type` là `pop|play|playback|view`; thân `{items|batch|data|records:[...]}` hoặc mảng trần. Giá trị rác (event_id không phải UUID, thiếu creative, thời lượng không phải số) vẫn bị từ chối với lý do `malformed`.

## 2. Thế nào là một lượt xem hợp lệ

- **Thang máy/LED (proof_of_play):** thiết bị đã được cấp quyền (trust >= 1, không bị chặn) **và** phát >= 0,9 x thời lượng creative (creative không khai thời lượng: tính). Phát ngắn hơn vẫn được lưu nhưng không tính (`short_play`). Thiết bị chưa cấp quyền: lưu với `pending_trust`, **tự tính lại** khi được cấp quyền.
- **TV (impression):** như trước: thiết bị đã cấp quyền, xem >= 100%, có giá chốt, không vượt 120 lượt/giờ/thiết bị. Thiết bị TV không đếm proof_of_play (tránh đếm trùng).
- Creative không còn trong manifest hiện tại nhưng có thật trong CSDL và đúng loại/độ phân giải với thiết bị: proof_of_play vẫn được nhận (`alias:late_not_in_manifest`). Creative lạ: `not_in_manifest`.
- Ngày tính theo giờ Việt Nam (Asia/Ho_Chi_Minh, UTC+7). Proof_of_play không bao giờ sinh doanh thu hay thưởng.

## 3. Ai xem ở đâu

- **Quản trị:** `Lịch sử xem` > tab *Báo cáo lượt xem*: lọc khách hàng, chiến dịch, mã thiết bị, khoảng ngày; theo ngày, chiến dịch, creative, địa điểm, thiết bị; tải CSV, PDF, HTML. Cột "Quảng cáo đã xem" ở trang Thiết bị đếm lượt hợp lệ 30 ngày.
- **Khách hàng:** đăng nhập là vào trang *Báo cáo lượt xem*: hôm nay / 7 / 30 ngày, biểu đồ theo ngày, theo chiến dịch, creative, địa điểm và tải cùng báo cáo. Máy chủ lọc theo khách **trong SQL** (đối tác chỉ thấy chiến dịch được giao); `campaign_id` của khách khác trả 404; khách không thấy tên/mã thiết bị, doanh thu, thưởng.
- Báo cáo PDF dùng font Be Vietnam Pro và logo watermark giống hợp đồng (logo cấu hình ở Soạn hợp đồng).

## 4. Chẩn đoán đồng bộ (admin)

Nút **Chẩn đoán đồng bộ** ở `/history` (API `GET /admin/v1/history/diagnostics`) cho từng thiết bị: nhịp tim cuối, sự kiện cuối, nhận/hợp lệ/từ chối trong 24 giờ, lý do từ chối, số đã ghi vào CSDL, và kết luận tiếng Việt:

| Mã | Ý nghĩa | Cách xử lý |
|---|---|---|
| `offline` | Không có nhịp tim trong 25 phút | Kiểm tra nguồn/mạng/app |
| `pending_trust` | Chưa cấp quyền | Thiết bị > Cấp quyền, số tự tính lại |
| `no_events` | Online nhưng chưa gửi lượt phát | App chưa phát quảng cáo của chiến dịch; xem manifest, lịch phát, chiến dịch đã duyệt/đang chạy |
| `all_rejected` | Gateway từ chối hết | Xem lý do (`not_in_manifest`, `ts_out_of_range` = lệch giờ máy...) |
| `not_counted` | Nhận nhưng chưa tính | Phát chưa đủ 90% thời lượng |
| `ingest_lag` | Nhận nhưng chưa ghi | Hàng đợi chậm/consumer không chạy: kiểm tra queue `ams-ingest-<env>` và DLQ |

Nhịp tim ghi tối đa mỗi 10 phút nên "online" có độ trễ. Số nhận có thể cao hơn số ghi nếu app gửi lại lô khi mất phản hồi.

## 5. Triển khai

Thứ tự: migration `0028_report_views` (cột `ev_proof_of_play.device_id/campaign_id`, bảng `device_event_stats`) -> gateway -> api -> web-admin. Gateway mới ghi cột mới nên **phải chạy migration trước**. Dòng proof_of_play cũ (chưa có `device_id`) vẫn được tính nhờ suy ra qua `screens`/`creatives`.
