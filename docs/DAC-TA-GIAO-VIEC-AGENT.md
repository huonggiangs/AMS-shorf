# Đặc tả dự án AMS: giao việc cho Agent code app và web

Phiên bản hợp nhất. Thay thế các bản trước (`BRIEF-AGENT-THUONG-MAI.md` và các mục bổ sung rời rạc).

**Prototype tham chiếu (giao diện và hành vi cần giữ):** `AMS Admin.dc.html` + `app.js` + `app.css`. Mở bằng trình duyệt, dữ liệu là dữ liệu minh họa.
**Nguồn thiết kế:** ADS.fig (bảng màu xanh #005BBF, biểu đồ, bố cục trang), font hệ thống San Francisco.
**Ưu tiên triển khai (3 môi trường, cùng một mã nguồn):** (1) **chạy local bằng Docker trên PC** để phát triển và nghiệm thu chức năng; (2) **Cloudflare** cho bản chạy thật đầu tiên; (3) **hạ tầng riêng** khi quy mô vượt khả năng/chi phí của Cloudflare. Không viết lại khi chuyển môi trường, chỉ đổi adapter và cấu hình (mục 4.2 và 11).

**Tên sản phẩm:** AMS (viết tắt do chủ dự án đặt; cần xác nhận tên đầy đủ, ví dụ Ad Management System, để ghi vào hợp đồng, email và giao diện). Mã thanh toán chuyển khoản dùng tiền tố `AMS` (ví dụ `AMS K004`); tên miền trong tài liệu (`ams.vn`) là giả định.

---

## 1. Tổng quan sản phẩm

AMS là nền tảng quảng cáo trên màn hình tại Việt Nam, gồm:

| Thành phần | Mô tả |
|---|---|
| **Mạng màn hình** | Smart TV (người dùng cài app, có ví thưởng), màn hình thang máy dọc 18,5"–23,8" tại chung cư, bảng LED P5 ngoài trời tại chung cư và bãi đỗ xe |
| **Web quản trị** | Điều hành thiết bị, chiến dịch, lịch phát, tài chính, khách hàng, hợp đồng, phân quyền |
| **Cổng khách hàng / đối tác** | Nhãn hàng và agency tự tải video, nạp tiền, xem trạng thái |
| **App TV và app điện thoại** | Phát quảng cáo, đo lượt xem, ví thưởng, ghép đôi, rút tiền |
| **Backend** | API, nhận sự kiện quy mô lớn, lịch phát, đối soát, thanh toán, tích hợp đối tác |

Mục tiêu quy mô: **50 triệu thiết bị online cùng lúc** (lộ trình ở mục 12).

### 1.1 Người dùng và vai trò

| Vai trò | Phạm vi |
|---|---|
| **Super admin** | Toàn quyền: duyệt nội dung và ngân sách, cấp tài khoản, tài chính, cấu hình |
| **Quản lý nội dung** | Tải media, tạo chiến dịch, duyệt media của khách hàng/đối tác; không duyệt ngân sách |
| **Tài chính** | Doanh thu, đối soát, hóa đơn, chi trả, ví khách hàng, hợp đồng, công nợ |
| **Vận hành thiết bị** | Thiết bị, telemetry, xác minh/chặn TV, màn hình thang máy và LED |
| **Khách hàng (nhãn hàng)** | Chỉ dữ liệu của chính khách hàng: tải video, gửi duyệt, ví, báo cáo phát |
| **Đối tác (nhà cung cấp, agency)** | Chỉ chiến dịch được giao: tải video, xem trạng thái duyệt |

Quyền phải kiểm tra **ở máy chủ** cho mọi truy vấn (lọc theo `customer_id` / `campaign_grants`), không chỉ ẩn nút trên giao diện. Tài khoản ngoài bắt buộc bật 2FA.

---

## 2. Cấu trúc menu và các trang (khớp prototype)

Sidebar có 5 nhóm; mỗi nhóm có tab con phía trên nội dung.

| Nhóm | Trang |
|---|---|
| **Tổng quan** | Tổng quan mạng lưới · Thiết bị · Trải nghiệm trên TV |
| **Quảng cáo** | Quảng cáo (chiến dịch) · Khách hàng & Hợp đồng · Phê duyệt · Nội dung & Media · Màn hình thang máy & LED · Mẫu hiển thị TV · Lịch phát |
| **Doanh thu** | Thanh toán & thuế (tab Tổng quan, tab Ví quảng cáo + SePay) · Kiểm soát hoa hồng · Lịch sử xem |
| **Đối tác** | Đối tác & giá sàn RTB · Tích hợp API |
| **Quản trị** | Người dùng & Phân quyền · Nhật ký hoạt động · Hồ sơ của tôi |

Tài khoản khách hàng/đối tác chỉ thấy: Quảng cáo, Nội dung & Media, Thanh toán & thuế (ví của mình).

### 2.1 Tính năng giao diện bắt buộc giữ

Command palette Ctrl+K (trang, lệnh, thiết bị, chiến dịch, người dùng) · trung tâm thông báo · mọi bảng có tìm kiếm, lọc, sắp xếp, phân trang, chọn nhiều dòng và thao tác hàng loạt (phân trang **phía máy chủ** khi làm thật) · ngăn chi tiết (drawer) cho thiết bị, chiến dịch, khách hàng · xuất CSV (UTF-8 BOM) và PDF · chế độ tối · Việt/Anh · responsive từ điện thoại đến màn hình 4K (menu thu thành thanh icon ≤1200px, ngăn trượt ≤900px) · timeline lịch phát kéo thả (bước 30 phút) · biểu đồ có tooltip (xu hướng, cột, donut, bản đồ nhiệt, pacing) · WCAG 2.1 AA.

### 2.2 Mô tả từng nhóm chức năng

**Tổng quan.** KPI (TV hoạt động, lượt phát, doanh thu ad networks, chi phí thưởng người xem), biểu đồ doanh thu và lượt xem 7/30/90 ngày, cơ cấu doanh thu theo API (donut), bản đồ nhiệt slot fill 24h × 7 ngày, cảnh báo thiết bị (offline, cache, nhiệt độ), bảng top chiến dịch có pacing.

**Thiết bị.** Danh sách TV/điện thoại, trạng thái ghép đôi, khu vực, cột **Quảng cáo đã xem** (số lượt và các quảng cáo gần nhất), telemetry (heartbeat, SoC, Wi-Fi, cache), xác minh/chặn hàng loạt, ngăn chi tiết có biểu đồ lượt xem và danh sách quảng cáo đã xem.

**Chiến dịch.** Danh sách theo trạng thái (Bản nháp, Chờ duyệt, Chờ nạp tiền, Đã lên lịch, Đang phát, Tạm dừng), cột nguồn RTB có logo nhà cung cấp, ngân sách, pacing, thưởng người xem; đường cong pacing so với SLA; top vị trí chuyển đổi QR.

**Khách hàng & Hợp đồng.** Hồ sơ khách hàng (tên pháp lý, MST, địa chỉ, đại diện, đầu mối, ngành, người phụ trách, điều khoản thanh toán, hạn mức công nợ), danh sách hợp đồng kinh tế (giá trị, thời hạn, tiến độ thu), tab **Hợp đồng mẫu** (hợp đồng dịch vụ quảng cáo 11 điều khoản điền sẵn từ hồ sơ, số tiền bằng chữ tự sinh, xuất PDF). Mẫu chỉ để tham khảo, **luật sư của công ty phải rà soát**.

**Phê duyệt.** Hàng chờ nội dung và ngân sách; khi duyệt chạy logic ví ở mục 8.3.

**Nội dung & Media.** Thư viện tệp, trạng thái kiểm duyệt, tải lên từ máy, **YouTube, Google Drive, Dropbox hoặc liên kết trực tiếp** (kiểm tra tên miền; chỉ lưu tham chiếu, hệ thống tải về và chuyển mã trước khi phát; chỉ dùng nội dung có quyền sử dụng).

**Màn hình thang máy & LED.** Cấu hình, xem trước và quy tắc nội dung theo từng loại màn (mục 6).

**Mẫu hiển thị TV.** 6 định dạng trên Smart TV (toàn màn hình, banner menu hình ảnh, L-banner, quảng cáo khi tạm dừng, QR góc, thưởng điểm), bộ chọn độ phân giải HD / Full HD / 4K / 8K / Tự động; khung TV mô phỏng độ nét theo lựa chọn và hiện nhãn độ phân giải; bảng kích thước pixel theo từng độ phân giải. Một tệp creative tự co giãn 16:9 từ HD đến 8K. Ảnh mẫu `ADS.png` do chủ dự án cung cấp, đặt vào `/assets/formats/`.

**Lịch phát.** Thẻ đối tác API (bật/tắt, eCPM, tỷ lệ lấp), thanh khung giờ P1/P2/Prime/P3, timeline kéo thả, doanh thu theo giờ, giám sát thiết bị trực tiếp, luồng ingestion.

**Doanh thu.** Doanh thu 6 tháng, phân bổ kỳ, hóa đơn và chi trả, **ví quảng cáo, nạp tiền, SePay** (mục 8), kiểm soát hoa hồng (loại thiết bị giả lập/thiếu chứng thực Ed25519), lịch sử xem.

**Đối tác.** Giá sàn RTB theo danh mục, thẻ tích hợp (Chicilon, Unique OOH, WeWin, Goldsun/Focus Media, Brandcom, Trimai, SePay) có tải logo; giao thức chưa xác minh thì chỉ chạy nội dung trực tiếp và auto-fill, chưa gửi request thật.

**Quản trị.** Card **Tạo người dùng** (họ tên, email, số điện thoại, vai trò, phạm vi khách hàng, hạn tài khoản) cùng card **Phân quyền chi tiết** (ma trận 12 mô-đun × Xem / Tạo-Sửa / Duyệt / Xóa-Xuất, điền sẵn theo vai trò và chỉnh được; tài khoản ngoài bị khóa ở 3 mô-đun Quảng cáo, Media, Tài chính và không có quyền Duyệt, Xóa/Xuất); nút Sửa quyền ở từng thành viên. Lưu thành `admin_permissions(admin_id, module, actions)`, máy chủ kiểm tra theo bảng này và theo vai trò. Mời người dùng nội bộ và ngoài, phạm vi theo khách hàng, nhật ký hoạt động bất biến (≥12 tháng), hồ sơ cá nhân, chuyển vai trò để xem thử.

---

## 3. Bài toán 50 triệu thiết bị: con số quyết định kiến trúc

Giả định đỉnh 18:00–21:30 với 50.000.000 thiết bị online.

| Luồng | Giả định | Tải |
|---|---|---|
| Heartbeat | 1 lần / 120 giây | ~417.000 req/s |
| Impression | ~8 lượt/giờ/TV, gửi gộp 10 phút/lần | ~140.000 req/s (nếu mọi thiết bị flush 10 phút) |
| Lấy lịch phát (manifest) | Poll 15 phút + push khi đổi | ~55.000 req/s |
| Telemetry chi tiết | 1 lần / 10 phút, gộp vào heartbeat | ~83.000 req/s |
| Tải media | Tải trước vào cache qua CDN | Băng thông CDN, không qua API |

**Quyết định bắt buộc (cần chủ dự án chấp thuận):**

1. **Không giữ WebSocket cho cả 50 triệu thiết bị.** Mặc định HTTPS heartbeat + push (FCM cho Android TV). WebSocket và chu kỳ 5–15 giây chỉ cho nhóm đang được giám sát trực tiếp (1–2%).
2. **Thiết bị gửi theo lô** (5–10 phút hoặc đủ 20 sự kiện), có chữ ký.
3. **Jitter** ±20% chu kỳ để tránh bão đồng bộ.
4. **Backpressure:** server trả `Retry-After` và `next_interval`; chu kỳ heartbeat do server điều khiển.
5. **Presence suy diễn:** online nếu `last_seen < 2,5 × chu kỳ`.

Chi phí Cloudflare ở quy mô này rất lớn. Giai đoạn 1 hợp lý đến khoảng 1–3 triệu thiết bị. Agent phải đưa **bảng chi phí ước tính ở các mốc 100k / 1M / 10M / 50M** vào tài liệu bàn giao.

---

## 4. Kiến trúc

```
Thiết bị (TV / thang máy / LED / điện thoại)
   │ HTTPS/HTTP3, chữ ký Ed25519
   ▼
Edge Gateway (Cloudflare Worker)             ← giai đoạn 2: Go gateway + L4 LB
   ├─ /v1/heartbeat ─► Queue ─► Consumer ─► Presence store + ClickHouse (gộp)
   ├─ /v1/events    ─► Queue ─► Validator ─► ClickHouse + Ledger hoa hồng
   ├─ /v1/manifest  ─► KV (cache theo nhóm thiết bị) ─► R2/CDN
   └─ /v1/register, /v1/pair ─► Auth ─► D1/Postgres

Web quản trị + Cổng khách hàng ─► API (Workers/Hono) ─► D1/Postgres + ClickHouse + Durable Objects
Đối tác (RTB, webhook) ◄─► Adapter service (timeout ≤250 ms, fallback cache)
SePay ─► POST /webhooks/payments/sepay ─► Payment service ─► Ví + Bộ kích hoạt tự động
```

Nguyên tắc: **tách đường ghi nóng (heartbeat, event) khỏi đường quản trị**. Đường nóng chỉ ghi append-only qua hàng đợi.

### 4.2 Một mã nguồn, ba môi trường (adapter)

Mã nghiệp vụ chỉ gọi các giao diện trừu tượng trong `packages/runtime`; mỗi môi trường cắm một bản cài đặt khác nhau.

| Giao diện | Local Docker (PC) | Cloudflare | Hạ tầng riêng |
|---|---|---|---|
| HTTP framework | Hono chạy trên Node (hoặc `wrangler dev`) | Workers (Hono) | Hono trên Node/Go gateway |
| DB giao dịch | PostgreSQL 16 | D1 | PostgreSQL 16 + Citus |
| Hàng đợi | Redpanda (Kafka API) hoặc NATS JetStream | Queues | Redpanda/Kafka |
| KV / cache | Redis | KV | Redis Cluster |
| Trạng thái thời gian thực / presence | Redis + một tiến trình WebSocket | Durable Objects | Redis/Scylla + gateway WebSocket |
| Kho đối tượng | MinIO (S3) | R2 | S3 tương thích |
| Phân tích sự kiện | ClickHouse | Pipelines → R2 Parquet + Analytics Engine | ClickHouse cluster |
| Email | Mailpit (bắt thư thử) | Email Routing / dịch vụ gửi thư | Dịch vụ gửi thư |
| Cron, job | Tiến trình scheduler | Cron Triggers | CronJob K8s |

Quy tắc: SQL viết theo tập con chạy được ở cả Postgres và D1 (SQLite); migration một nguồn (Drizzle/Atlas) sinh cho cả hai; khác biệt (kiểu dữ liệu, khóa hàng `FOR UPDATE`) nằm trong adapter và có test chung chạy trên cả hai.

### 4.1 Lớp dữ liệu theo giai đoạn

| Dữ liệu | Giai đoạn 1 (Cloudflare) | Giai đoạn 2 (hạ tầng riêng) |
|---|---|---|
| Giao dịch (user, chiến dịch, hợp đồng, ví, RBAC) | D1 chia theo miền (`core`, `finance`, `audit`) | PostgreSQL 16 + pgBouncer, replica đọc, Citus khi cần |
| Presence / trạng thái hiện tại | Durable Objects chia `hash(device_id) % 4096` + KV | Redis Cluster hoặc ScyllaDB |
| Sự kiện (heartbeat, impression, telemetry, proof-of-play) | Queues → Pipelines → R2 (Parquet) + Analytics Engine | Redpanda/Kafka → ClickHouse |
| Media, báo cáo xuất, hợp đồng đã ký | R2 | S3 tương thích + CDN |
| Cache manifest | KV + Cache API | Redis + CDN |
| Tìm kiếm | D1 FTS5 | OpenSearch hoặc ClickHouse + trigram |
| Audit log bất biến | D1 append-only + bản sao R2 (object lock) | Postgres partition theo tháng + S3 object lock |

---

## 5. Cơ sở dữ liệu

### 5.1 Giao dịch (Postgres/D1)

Khóa chính ULID/UUIDv7. **Tiền là `bigint` (đồng), không dùng float.**

```sql
-- người dùng và quyền
tenants(id, name, tax_code, created_at)
admins(id, tenant_id, email, name, role, account_kind, customer_id null, org_name, status,
       totp_secret_enc, mfa_required default true, invited_by, last_login_at, created_at)
       -- role: super_admin|content_manager|finance|device_ops|customer|partner ; account_kind: internal|customer|partner
campaign_grants(id, admin_id, campaign_id, can_upload, expires_at)
upload_quotas(customer_id, max_files_per_day, max_mb_per_file, max_total_gb)
audit_log(id, ts, actor_id, action, object_type, object_id, ip, diff jsonb)   -- chỉ INSERT

-- thiết bị
end_users(id, phone_hash, email_enc, display_name, created_at)
devices(id, user_id, kind, model, os, app_version, region_id, pubkey_ed25519, trust_level,
        paired_at, blocked, shard smallint)                 -- shard = hash(id) % 4096
device_attestations(device_id, nonce, result, checked_at)

-- địa điểm và màn hình
venues(id, name, kind, region_id, address, lat, lng, owner_contact, contract_ref)   -- kind: apartment|parking|...
screens(id, venue_id, type, diag_inch, width_mm, height_mm, px_w, px_h, orientation,
        pixel_pitch_mm numeric(3,1), brightness_nit, controller_kind, controller_ref,
        device_id, state, installed_at)                     -- type: tv|elevator|led_p5
screen_groups(id, venue_id, name)

-- khách hàng và hợp đồng
customers(id, tenant_id, legal_name, short_name, tax_code unique, address, industry, rep_name, rep_title,
          phone, email, contact_name, account_owner_id, payment_terms, credit_limit_vnd bigint,
          payment_code unique, state, since, created_at)
          -- state: pending_payment|active|paused|terminated
customer_contacts(id, customer_id, name, title, phone, email, is_primary)
contracts(id, no unique, customer_id, title, value_vnd bigint, vat_rate, start_date, end_date, advance_pct,
          payment_terms, state, signed_at, signed_file_key, template_id, created_by)
          -- state: draft|pending_sign|active|paused|expired|terminated
contract_lines(id, contract_id, screen_type, region_id, daypart, frequency, duration_s, unit_price_vnd, qty)
contract_templates(id, name, version, body_md, variables jsonb, active)
receivables(id, customer_id, contract_id, invoice_id, amount_vnd, due_date, paid_vnd, state)

-- quảng cáo
advertisers(id, name, tax_code)
campaigns(id, customer_id, contract_id, name, state, budget_cap_vnd, approved_budget_vnd, reserved_vnd, spent_vnd,
          funding_state, activate_on_approve default true, start_at, end_at, created_by, approved_by, approved_at)
creatives(id, campaign_id, target_type, px_w, px_h, orientation, kind, source, source_url, storage_key,
          duration_s, codec, uploaded_by, uploader_kind, scan_state, review_state, state)
          -- source: upload|youtube|gdrive|dropbox|url ; unique(campaign_id, target_type, px_w, px_h)
schedule_slots(id, campaign_id, partner_id, screen_group_id, target_type, daypart, start_min, end_min,
               priority, reward_points, regions int[])
partners(id, name, protocol, endpoint, auth_ref, enabled, floor_cpm_vnd, logo_key)
rtb_floors(id, category, floor_cpm_vnd, updated_by, updated_at)

-- tiền
ad_wallets(customer_id pk, low_balance_alert_pct default 10, updated_at)              -- cache số dư
wallet_entries(id, customer_id, kind, amount_vnd, balance_after, ref_type, ref_id, created_at)
               -- kind: topup|reserve|release|spend|refund|adjust ; bất biến, chỉ INSERT
topups(id, customer_id, amount_vnd, method, provider, provider_txn_id unique, matched_by, raw_content,
       status, requested_by, confirmed_by, requested_at, credited_at)
payment_webhooks(id, provider, event_id unique, payload jsonb, signature_ok, result,
                 matched_customer_id, topup_id, processed_at, retry_count)
activation_rules(id, customer_id null, min_amount_vnd, auto_activate, plan_id)
activation_log(id, customer_id, trigger_topup_id, actions jsonb, created_at)
payouts(id, user_id, amount_vnd, channel, status, external_ref, requested_at, paid_at)       -- thưởng người xem
wallet_ledger(id, user_id, kind, amount_vnd, ref_type, ref_id, status, created_at)           -- ví thưởng người xem (bất biến)
invoices(id, customer_id, period, amount_vnd, vat_rate, status, einvoice_ref)
```

### 5.2 Sự kiện (ClickHouse; giai đoạn 1 là Parquet trên R2)

```sql
CREATE TABLE heartbeat (
  ts DateTime, device_id UInt64, shard UInt16, region UInt16, app_ver LowCardinality(String),
  soc_temp Int16, rssi Int16, dl_mbps Float32, cache_used_mb UInt32, cache_slots UInt16, state UInt8
) ENGINE = ReplicatedMergeTree PARTITION BY toYYYYMMDD(ts) ORDER BY (shard, device_id, ts)
TTL ts + INTERVAL 14 DAY;

CREATE TABLE ad_impression (
  ts DateTime, event_id UUID, device_id UInt64, screen_id UInt64, campaign_id UInt64, creative_id UInt64,
  slot_id UInt64, partner_id UInt16, vcr_pct UInt8, valid UInt8, reject_reason LowCardinality(String),
  revenue_micro_vnd Int64, reward_vnd Int32
) ENGINE = ReplacingMergeTree(ts) PARTITION BY toYYYYMM(ts)
ORDER BY (campaign_id, toStartOfHour(ts), device_id, event_id);          -- khử trùng theo event_id

CREATE TABLE proof_of_play (ts DateTime, screen_id UInt64, creative_id UInt64, duration_ms UInt32, source LowCardinality(String));
-- bảng gộp (Materialized View) cho dashboard
impression_hourly(hour, campaign_id, partner_id, region, impressions, valid, revenue_micro_vnd, reward_vnd)
heatmap_slot_fill(day, hour, region, fill_pct)
device_state_daily(day, region, online_peak, offline_count)

```

Dashboard luôn đọc bảng gộp, không quét bảng thô. Presence: `KEY dev:{id}` TTL 6 phút + bitmap `online:{shard}` đếm bằng `BITCOUNT`, ghi vào ClickHouse mỗi 30 giây để vẽ biểu đồ.

---

## 6. Ba loại màn hình

| | Smart TV | Thang máy (dọc) | LED P5 ngoài trời |
|---|---|---|---|
| Vị trí | Hộ gia đình, quán, văn phòng | Thang máy chung cư | Cổng, sảnh xe chung cư; bãi đỗ xe |
| Kích thước | 16:9 mọi kích cỡ | 18,5" / 21,5" / 23,8" đặt dọc 9:16 | Mô-đun: 1,28×0,64 m; 2,56×1,28 m; 3,84×1,92 m; 0,96×1,92 m (dọc) |
| Độ phân giải gốc | HD → 8K, tự co giãn | 18,5": 768×1366; 21,5" và 23,8": 1080×1920 | Chiều mm / 5, ví dụ 2,56×1,28 m = 512×256 px |
| Tệp | MP4 H.264/H.265, PNG/JPG | MP4 H.264 hoặc ảnh, ≤30 MB, 10–30 giây | MP4 H.264 hoặc PNG/JPG đúng kích thước, 5–15 giây, không âm thanh |
| Thiết bị phát | App TV | Player Android/Linux mini PC | Card nhận LED (Novastar/Colorlight) qua bộ gửi, có API hoặc đồng bộ thư mục |
| Thưởng người xem | Có (VCR 100%) | Không | Không |
| Đo lường | Impression + VCR | Proof-of-play | Proof-of-play + ảnh chụp đối chứng định kỳ |
| Lưu ý nội dung | Vùng an toàn lề 5% | Lề 6%, chữ ≥36 px | Tương phản cao, chữ ≥16 px (≈8 cm), ≤7 từ, tránh chi tiết nhỏ; độ sáng 5.000–6.500 nit, IP65, tự giảm sáng ban đêm |

**Quy tắc:** mỗi chiến dịch cần **bộ creative riêng cho từng độ phân giải/loại màn**; hệ thống từ chối tệp sai kích thước hoặc tỷ lệ (LED không tự co giãn). Transcoder tạo bản rút gọn cho thang máy (≤1080×1920, ≤8 Mbps) và đóng gói theo định dạng bộ điều khiển LED. Lịch riêng: thang máy ưu tiên 07:00–09:30 và 17:00–21:00; LED bãi đỗ xe theo giờ xe ra vào. Báo cáo cho nhãn hàng tách theo loại màn.

---

## 7. Giao thức thiết bị

| Endpoint | Mục đích | Ghi chú |
|---|---|---|
| `POST /v1/register` | Cấp `device_id`, nhận khóa công khai Ed25519, nonce attestation | Một lần, giới hạn theo IP/ASN |
| `POST /v1/pair` | Ghép đôi với tài khoản bằng mã 6 số | Hết hạn 5 phút |
| `POST /v1/heartbeat` | Trạng thái + telemetry; trả `next_interval`, `manifest_etag`, lệnh chờ | Body <512 byte, protobuf/CBOR |
| `GET /v1/manifest?etag=` | Lịch phát cho nhóm thiết bị (cache theo `region × daypart × model_class`) | 304 nếu không đổi |
| `POST /v1/events` | Lô impression đã ký, tối đa 50 sự kiện | Idempotent theo `event_id` (UUIDv7 do thiết bị sinh) |
| `GET /v1/wallet`, `POST /v1/withdraw` | Ví thưởng và rút tiền (OTP) | App điện thoại |

Bảo mật: chữ ký Ed25519 mọi lô, nonce chống phát lại, thiết bị giả lập `trust_level=0` (không tính hoa hồng), giới hạn tốc độ theo `device_id`, WAF + bot management.

---

## 8. Tài chính: ví trả trước, tự nạp tiền, tự chạy, SePay

### 8.1 Luồng chính

1. **Nạp tiền** (khách hàng/đối tác tự làm): quét mã QR chuyển khoản, hoặc VNPay, MoMo, Napas. Tối thiểu 5.000.000 ₫.
2. **Gửi quảng cáo:** tạo chiến dịch (loại màn, lịch, ngân sách), tải video. Gửi được cả khi ví chưa đủ.
3. **Duyệt:** người có quyền duyệt nội dung và ngân sách.
4. **Tự chạy:** khi duyệt, kiểm tra `khả dụng = số dư − tiền đang giữ`:
   - đủ: giữ (reserve) đúng ngân sách đã duyệt; ngày bắt đầu đã đến thì `active`, chưa đến thì `scheduled` và tự chạy đúng ngày;
   - chưa đủ: `awaiting_funds` ("Chờ nạp tiền"), báo số tiền còn thiếu; khi nạp đủ, tự chạy theo thứ tự đã duyệt.
5. **Trừ tiền** dần theo impression đã đối soát; hết ngân sách chiến dịch thì tự dừng, không bao giờ chi vượt phần đã giữ.
6. **Kết thúc/hủy:** hoàn phần giữ chưa dùng về số dư khả dụng; hoàn về ngân hàng theo yêu cầu, tài chính duyệt, ghi audit.

### 8.2 Quy tắc bắt buộc

- **Idempotency:** mỗi giao dịch/webhook xử lý đúng một lần (`provider_txn_id`, `event_id` UNIQUE).
- **Nguyên tử:** giữ tiền, cộng ví, đổi trạng thái chiến dịch trong một transaction; khóa hàng ví khi cập nhật.
- **Sổ cái bất biến:** `wallet_entries` chỉ INSERT; `ad_wallets` chỉ là cache có kiểm tra khớp tổng mỗi ngày.
- **Đối soát hằng ngày** sao kê/API giao dịch với `topups`; lệch thì vào hàng đợi xử lý thủ công.
- **Hóa đơn VAT** xuất theo chính sách kế toán đã chốt; hoàn tiền có chứng từ.
- **Rủi ro:** giới hạn nạp theo ngày, tài khoản khóa không nạp được, điều chỉnh thủ công cần hai người duyệt.
- **Tự chạy chỉ sau duyệt nội dung;** thu hồi duyệt thì dừng và hoàn phần giữ chưa dùng.
- **Thông báo:** nạp thành công, ví dưới 10% hoặc không đủ chạy 3 ngày, chiến dịch chờ nạp, tự chạy, hết ngân sách.

### 8.3 Tích hợp SePay (nhận tiền và tự kích hoạt)

Tham chiếu: https://docs.sepay.vn/tich-hop-webhooks.html. Thư mục `D:\hotel\HW\anio-power\Anionote_09108CH` của chủ dự án không đọc được khi thiết kế: **Agent phải đọc tài liệu trong thư mục đó và đối chiếu, nếu khác thì theo tài liệu nội bộ.**

**Đơn giản cho người dùng:**
- *Quản trị viên:* chọn ngân hàng từ danh sách có sẵn (Vietcombank, VietinBank, BIDV, Agribank, MBBank, Techcombank, ACB, VPBank, TPBank, Sacombank, HDBank, OCB, MSB, SHB, VIB, SeABank), nhập số tài khoản và tên chủ tài khoản; sao chép URL webhook dán vào my.sepay.vn > Webhooks; bấm Gửi thử.
- *Khách hàng:* bấm Nạp tiền, quét QR. Hộp thoại điền sẵn số tiền và nội dung `AMS <mã khách hàng>` (có nút sao chép). Khi ngân hàng báo có, ví tự cộng.

**Cú pháp và QR:** nội dung chuyển khoản `AMS K004`. QR tạo qua `https://qr.sepay.vn/img?acc=<số TK>&bank=<ngân hàng>&amount=<số tiền>&des=<nội dung>` (docs.sepay.vn/tao-qr-code-vietqr-dong.html). Cấu hình cùng tiền tố trong SePay (Cấu hình chung > Cấu trúc mã thanh toán) và trong hệ thống. Số tài khoản `0123456789` trong prototype là **số mẫu**.

**Webhook:** `POST /webhooks/payments/sepay`. Payload: `id`, `gateway`, `transactionDate`, `accountNumber`, `subAccount`, `code`, `content`, `transferType` (`in`/`out`), `description`, `transferAmount`, `accumulated`, `referenceCode`.
- Cấu hình ở SePay gồm 4 bước (thông tin cơ bản, tài khoản và bộ lọc, bảo mật, cảnh báo); sự kiện "Có tiền vào"; lọc theo tiền tố mã thanh toán hoặc tài khoản ảo (VA).
- Xác thực **HMAC-SHA256** (khuyến nghị): header `X-SePay-Signature: sha256=<hex>`, `X-SePay-Timestamp`; so sánh hằng thời gian; từ chối timestamp lệch >5 phút. Hỗ trợ thêm API Key (`Authorization: Apikey ...`) và OAuth 2.0 (SePay xét HTTP **201**).
- Phản hồi thành công: HTTP 200/201 **và** `{"success": true}` trong vài giây (SePay chờ tối đa 30 giây; OAuth 2.0 chỉ 8 giây).
- Retry của SePay: chỉ khi không kết nối/quá thời gian, hoặc khi bật "Tự động gửi lại khi server trả lỗi" và trả ngoài 200–299; tối đa 7 lần, cách 1, 1, 2, 3, 5, 8, 13 phút. Quá khoảng đó: gửi lại thủ công trong nhật ký hoặc **đối soát bù bằng API giao dịch** (job định kỳ).
- Chống trùng theo `id`. Khóa bí mật trong secret manager, không đặt ở trình duyệt; lưu nguyên văn mọi webhook kể cả bị từ chối.
- IP gửi webhook (whitelist nếu cần; kiểm tra lại trong tài liệu trước khi triển khai): IPv4 172.236.138.20, 172.233.83.68, 171.244.35.2, 151.158.108.68, 151.158.109.79, 103.255.238.139, 45.57.137.67; IPv6 2400:8905::2000:8cff:fe98:45cd, 2600:3c15::2000:8aff:fedd:874b.

**Xử lý khi nhận giao dịch:** khử trùng → xác thực → chỉ nhận `in` → đối chiếu mã khách hàng → cộng ví → chạy bộ kích hoạt tự động:
- quảng cáo `awaiting_funds` được giữ ngân sách và tự chạy;
- khách hàng `pending_payment` đạt số tiền tối thiểu được **kích hoạt**: `active`, hợp đồng `pending_sign` thành `active` (ghi nhận trả trước), tạo tài khoản cổng khách hàng và gửi email chào mừng, tạo dịch vụ/gói theo hợp đồng;
- số tiền dưới mức tối thiểu chỉ cộng ví, không kích hoạt;
- không khớp mã/sai số tiền/khách không tồn tại: vào hàng đợi xử lý thủ công của tài chính;
- mọi hành động ghi `activation_log`, có thể hoàn tác.

### 8.4 API tài chính

| Endpoint | Mục đích |
|---|---|
| `POST /portal/v1/topups` | Tạo yêu cầu nạp; trả liên kết cổng hoặc QR + nội dung chuyển khoản |
| `POST /webhooks/payments/{provider}` | Nhận kết quả thanh toán (SePay, VNPay, MoMo) |
| `GET /portal/v1/wallet` | Số dư, tiền đang giữ, đã chi, lịch sử |
| `POST /admin/v1/campaigns/{id}/approve` | Duyệt và chạy logic giữ tiền/tự chạy |
| `POST /admin/v1/topups/{id}/confirm` | Tài chính xác nhận thủ công |
| `POST /portal/v1/wallet/refund-requests` | Yêu cầu hoàn tiền về ngân hàng |

---

## 9. Tài khoản khách hàng và đối tác

**Luồng:** Super admin mời (vai trò + phạm vi khách hàng) → email kích hoạt hết hạn 72 giờ → đặt mật khẩu, **bắt buộc bật 2FA TOTP** → đăng nhập cổng riêng (`portal.AMS.vn`, tách khỏi `admin.AMS.vn`).

**Tải tệp:** trình duyệt lấy presigned URL theo quota → quét mã độc → kiểm tra định dạng và độ phân giải đúng loại màn → chuyển mã → vào hàng chờ duyệt (`pending`) → thông báo Quản lý nội dung → khách hàng nhận email duyệt/trả lại kèm lý do.

**Không được phép với tài khoản ngoài:** duyệt nội dung/ngân sách, xem doanh thu, giá sàn RTB, công nợ nội bộ, dữ liệu khách khác, phát hành. API trả về cho tài khoản ngoài **không chứa** số liệu tài chính của công ty. Có test chống truy cập chéo (IDOR). Tài khoản có thể bị khóa, hết hạn theo hợp đồng hoặc thu hồi ngay; mọi thao tác ghi audit kèm IP.

---

## 10. Cấu trúc dự án (monorepo)

```
AMS/
├─ apps/
│  ├─ web-admin/            # React + Vite + TS: web quản trị (theo prototype) và cổng khách hàng
│  ├─ tv-android/           # Kotlin, Android TV / Google TV
│  ├─ tv-tizen/ tv-webos/   # Web app TV (TS), dùng chung core-js
│  ├─ player-elevator/      # Player thang máy dọc (Android/Linux)
│  ├─ led-connector/        # Kết nối bộ điều khiển LED P5 (Novastar/Colorlight)
│  └─ mobile/               # Ghép đôi, ví thưởng, rút tiền
├─ services/
│  ├─ edge-gateway/         # Worker: heartbeat, events, manifest (đường nóng)
│  ├─ api/                  # Worker (Hono): admin API, portal, đối tác, auth, RBAC
│  ├─ ingest-consumer/      # Consumer hàng đợi: validate, khử trùng, ghi event store
│  ├─ scheduler/            # Dựng manifest; waterfall P1 → P2 RTB → P3 → Reserve
│  ├─ rtb-adapter/          # OpenRTB 2.5 + adapter từng đối tác, timeout 250 ms
│  ├─ payments/             # Ví, sổ cái, SePay/VNPay/MoMo webhook, kích hoạt tự động
│  ├─ settlement/           # Đối soát, VCR, thưởng, hóa đơn, chi trả, công nợ
│  ├─ contracts/            # Sinh hợp đồng từ mẫu (HTML → PDF), cảnh báo hết hạn
│  ├─ transcoder/           # Tải YouTube/Drive/Dropbox/URL (có quyền), chuyển mã, quét mã độc
│  └─ realtime/             # Durable Objects: giám sát trực tiếp, thông báo
├─ packages/
│  ├─ proto/                # protobuf/OpenAPI, sinh code TS + Kotlin
│  ├─ core-js/              # Ký/xác minh Ed25519, SDK client
│  ├─ db/                   # Migration (Drizzle/Atlas), seed, kiểu dữ liệu
│  ├─ ui/                   # Token màu/font SF từ app.css, bảng, biểu đồ, drawer
│  ├─ runtime/              # Adapter DB/Queue/KV/ObjectStore/Realtime: bản Docker và bản Cloudflare
│  └─ config/               # ESLint, tsconfig, quy tắc RBAC dùng chung
├─ infra/  (docker/ ← môi trường local · cloudflare/ · k8s/ + helm/ · clickhouse/ · postgres/)
├─ Makefile · .env.example · docker-compose*.yml
├─ tools/  (loadtest/ với k6 + bộ giả lập thiết bị Go · seed/)
└─ docs/   (ADR, runbook, bảng chi phí, mô hình mối đe dọa)
```

---

## 11. Chạy local bằng Docker trên PC (làm trước khi lên Cloudflare)

**Mục đích:** phát triển, demo và nghiệm thu toàn bộ chức năng trên một máy PC mà chưa tốn chi phí hạ tầng; cùng mã và cùng image sau này chạy ở Cloudflare/hạ tầng riêng.

### 11.1 Yêu cầu máy

Docker Desktop (Windows dùng WSL2) hoặc Docker Engine trên Linux/Mac; tối thiểu 16 GB RAM, 8 lõi, 60 GB ổ trống (khuyến nghị 32 GB RAM nếu bật ClickHouse và Redpanda cùng lúc); Node.js 20+ và pnpm cho phát triển ngoài container. Bộ khởi tạo phải kiểm tra phiên bản Docker và báo rõ nếu thiếu tài nguyên.

### 11.2 Các container (`infra/docker/docker-compose.yml`)

| Service | Image | Cổng cục bộ | Vai trò |
|---|---|---|---|
| `proxy` | Caddy hoặc Traefik | 80/443 | Tên miền cục bộ `admin.ams.localhost`, `portal.ams.localhost`, `api.ams.localhost`; HTTPS tự ký |
| `web-admin` | build từ `apps/web-admin` | 5173 | Web quản trị + cổng khách hàng |
| `api` | build từ `services/api` | 8787 | Admin API, portal, auth, RBAC |
| `edge-gateway` | build từ `services/edge-gateway` | 8788 | heartbeat, events, manifest |
| `ingest-consumer`, `scheduler`, `payments`, `settlement`, `contracts`, `transcoder` | build từ `services/*` | nội bộ | Các worker nền |
| `postgres` | postgres:16 | 5432 | DB giao dịch (volume `pgdata`) |
| `redis` | redis:7 | 6379 | KV, presence, rate limit |
| `redpanda` | redpandadata/redpanda | 9092 | Hàng đợi sự kiện (bật bằng profile `events`) |
| `clickhouse` | clickhouse/clickhouse-server | 8123/9000 | Phân tích sự kiện (profile `events`) |
| `minio` | minio/minio | 9001/9000 | Kho media, tệp ký, báo cáo |
| `mailpit` | axllent/mailpit | 8025 | Bắt email mời/kích hoạt khi thử |
| `grafana` + `otel-collector` | tùy chọn | 3000 | Quan sát (profile `obs`) |
| `tunnel` | cloudflare/cloudflared | | Mở URL công khai tạm thời để **SePay gọi webhook về PC** (profile `tunnel`) |

Dùng Compose **profiles**: `core` (postgres, redis, minio, mailpit, api, web-admin) chạy được trên máy yếu; thêm `events` khi cần kiểm thử luồng heartbeat/impression; `obs`, `tunnel` khi cần.

### 11.3 Lệnh một dòng cho người dùng

```
make setup      # kiểm tra Docker, sinh .env, tạo khóa HMAC/Ed25519 cục bộ
make up         # chạy profile core
make up-events  # thêm Redpanda + ClickHouse
make seed       # nạp dữ liệu mẫu từ prototype (khách hàng, hợp đồng, thiết bị, chiến dịch)
make test       # unit + contract + e2e Playwright trên Docker
make loadtest N=20000   # giả lập N thiết bị ảo
make tunnel     # URL công khai cho SePay/webhook thử
make down       # dừng; make reset xóa dữ liệu
```

Sau `make up`, mở `https://admin.ams.localhost` đăng nhập bằng tài khoản Super admin mẫu in ra ở cuối `make seed`. Email mời xem tại Mailpit (cổng 8025).

### 11.4 Cấu hình

Một file `.env` (mẫu `.env.example` có chú thích): `RUNTIME=docker|cloudflare|k8s`, chuỗi kết nối, khóa bí mật cục bộ, `SEPAY_MODE=mock|sandbox|production`. **Không commit bí mật.** Chế độ `mock` dùng bộ giả lập SePay có sẵn (bảng nút "Mô phỏng giao dịch" trong prototype được làm thành endpoint thật `/dev/sepay/simulate`, chỉ bật khi `RUNTIME=docker`).

### 11.5 Giới hạn của môi trường local (nêu rõ để không hiểu nhầm)

- Một PC mô phỏng được khoảng **10–50 nghìn thiết bị ảo**, không phải hàng triệu; mục đích là kiểm tra đúng chức năng, tính nhất quán dữ liệu và tìm lỗi thiết kế, **không đo được chi phí hay giới hạn ở 50 triệu**. Số đo quy mô phải thực hiện ở môi trường Cloudflare/hạ tầng riêng.
- SePay chỉ gọi được webhook khi có URL công khai (dùng profile `tunnel` hoặc chế độ `mock`).
- Transcode video nặng chạy chậm trên PC; cho phép đặt giới hạn CPU và bỏ qua chuyển mã trong chế độ dev.
- LED P5 và player thang máy dùng bộ mô phỏng (không cần phần cứng).

### 11.6 Chuyển từ Docker sang Cloudflare

1. Bật bản cài đặt Cloudflare của từng adapter (mục 4.2); chạy bộ test chung trên cả hai môi trường.
2. Tạo D1/Queues/KV/R2/Durable Objects bằng Terraform (`infra/cloudflare`); chạy migration cho D1 từ cùng nguồn migration.
3. Xuất dữ liệu Postgres cục bộ (chỉ cấu hình, khách hàng, hợp đồng, chiến dịch cần giữ; bỏ dữ liệu mẫu) và nhập vào D1; chuyển media từ MinIO sang R2 bằng công cụ `rclone`.
4. Chạy staging trên Cloudflare, thử SePay sandbox thật, rồi cắt DNS sang production; giữ môi trường Docker làm môi trường phát triển và tái hiện lỗi.
5. Giai đoạn sau, đóng gói cùng các image Docker này để chạy trên Kubernetes (hạ tầng riêng); Docker Compose vẫn là môi trường dev chuẩn.

---

## 12. Lộ trình

**Giai đoạn 0 – Nền móng và chạy local Docker (4–6 tuần).** Monorepo, CI, `packages/runtime` với bản cài đặt Docker (Postgres, Redis, MinIO, Mailpit), schema proto, thiết kế db, RBAC, đăng nhập + TOTP. Chuyển prototype sang React giữ nguyên giao diện, nối API thật. Hoàn thiện toàn bộ luồng chức năng (chiến dịch, khách hàng, hợp đồng, ví, SePay mock/tunnel, cổng khách hàng, màn hình thang máy và LED mô phỏng) chạy bằng `make up`. Nghiệm thu bản local trước khi sang giai đoạn 1.

**Giai đoạn 1 – Cloudflare (6–10 tuần), mục tiêu 1–3 triệu thiết bị.** Chuyển từ Docker theo mục 11.6 (bật adapter Cloudflare, không viết lại nghiệp vụ). Gateway Worker + Queues + Durable Objects, D1 theo miền, R2, KV, Analytics Engine/Pipelines. Web admin dùng dữ liệu thật; app TV Android trước, Tizen/webOS sau. Ví + SePay + cổng khách hàng. Màn hình thang máy và LED. Bộ giả lập tải 100k → 1M thiết bị ảo; ghi p50/p95/p99, tỷ lệ lỗi, chi phí/triệu thiết bị. Đối tác API: chạy nội dung trực tiếp + auto-fill đến khi có tài liệu và sandbox.

**Giai đoạn 2 – Tách đường nóng (8–12 tuần), mục tiêu 10 triệu.** Đưa ingest và event store sang Redpanda + ClickHouse, presence sang Redis/Scylla. Giữ Cloudflare làm CDN/WAF/DNS và cho web admin; gateway Go nhiều vùng. Chạy song song (dual-write) 2 tuần, so khớp số liệu, cắt chuyển theo 1% → 10% → 50% → 100% bằng cờ tính năng, luôn có đường quay lui.

**Giai đoạn 3 – 50 triệu.** Chia shard 4096 → 16384, thêm vùng, ClickHouse nhiều shard, Postgres tách theo tenant, tối ưu chu kỳ heartbeat do server điều khiển, chịu lỗi cấp vùng (RPO ≤5 phút, RTO ≤30 phút).

Kích thước hạ tầng gợi ý cho 50 triệu (để Agent kiểm chứng bằng tải thật, không phải cam kết): gateway ~150–300 lõi nhiều vùng, Redpanda 12–24 broker, ClickHouse 12–24 node, Redis/Scylla 24–48 node, Postgres 1 primary + 3 replica mỗi miền.

---

## 13. Yêu cầu phi chức năng

- **SLO:** API quản trị p95 <400 ms; heartbeat p99 <300 ms; manifest từ cache p99 <100 ms; từ phát đến dashboard <60 giây; uptime 99,95%.
- **Độ chính xác tiền:** đối soát impression khớp 100% giữa event store và ledger; mọi lệch có báo cáo.
- **Bảo mật:** OWASP ASVS L2, CSP, CSRF, mã hóa dữ liệu nhạy cảm theo trường (MST, người đại diện, tài khoản ngân hàng), bí mật trong secret manager, không log PII, pen-test trước go-live, backup hằng ngày.
- **Pháp lý Việt Nam:** Nghị định 13/2023 (đồng ý, quyền xóa, lưu trữ), hóa đơn điện tử (Viettel S-Invoice/MISA meInvoice), thuế TNCN khi chi trả thưởng, quy định quảng cáo; YouTube/Drive chỉ dùng nội dung có quyền sử dụng; hợp đồng mẫu do luật sư rà soát.
- **Quan sát:** log có cấu trúc, trace OpenTelemetry, Sentry, dashboard SLO, cảnh báo theo lỗi/độ trễ/lag hàng đợi.
- **Kiểm thử:** unit, contract (OpenAPI), e2e Playwright (duyệt chiến dịch, nạp tiền, tự chạy, SePay, phân quyền), test đồng thời (hai chiến dịch tranh một số dư, webhook trùng), chaos test (mất vùng, mất hàng đợi), kiểm thử tải từng mốc trước khi chuyển giai đoạn.
- **Truy cập và hiển thị:** WCAG 2.1 AA, tương phản ≥4,5:1, điều hướng bàn phím, responsive HD → 8K, font hệ thống SF (SF Pro/SF Mono trên Apple, font hệ thống gần nhất trên nền tảng khác).
- **CI/CD:** dev/staging/prod, migration có rollback, feature flag.

---

## 14. Danh sách việc giao cho Agent (theo thứ tự)

1a. **Môi trường local Docker:** monorepo, `docker-compose` với profiles, `Makefile` (setup/up/seed/test/loadtest/tunnel/down/reset), `.env.example`, Caddy/Traefik tên miền `*.ams.localhost`. *Nghiệm thu:* máy PC sạch chạy `make setup && make up && make seed` là đăng nhập được web admin, nhận email mời ở Mailpit.
1b. CI (build, test trên Docker), bản cài đặt adapter Cloudflare, Terraform `infra/cloudflare`. *Nghiệm thu:* bộ test chung đạt trên cả Docker và Cloudflare staging, tự động deploy từ `main`.
2. `proto` + OpenAPI cho mọi endpoint (mục 7, 8.4, 9); sinh SDK TS/Kotlin.
3. Migration cho schema mục 5 và DDL sự kiện; seed từ prototype.
4. `edge-gateway` + `ingest-consumer`: heartbeat, events, manifest, idempotency, chữ ký, giới hạn tốc độ.
5. `api` + RBAC (gồm vai trò ngoài) + audit log + TOTP; chuyển các trang web admin sang React, nối API thật (bảng phân trang phía máy chủ, CSV/PDF, command palette, thông báo realtime).
6. Khách hàng, hợp đồng, trình sinh hợp đồng từ mẫu (số tiền bằng chữ có test), công nợ.
7. Cổng khách hàng/đối tác: mời, kích hoạt, 2FA, tải tệp (presigned URL, quota, quét mã độc, kiểm tra kích thước theo loại màn).
8. `payments`: sổ cái ví, giữ/giải phóng/trừ tiền, SePay webhook, đối chiếu mã, bộ kích hoạt tự động và log truy vết, QR nạp tiền, trang cấu hình SePay chọn ngân hàng từ danh sách, đối soát hằng ngày.
9. `scheduler`, `settlement`, `transcoder`; lịch riêng cho thang máy và LED.
10. App TV Android: heartbeat jitter, hàng đợi sự kiện ngoại tuyến, cache media, VCR, ví thưởng; sau đó Tizen/webOS; player thang máy; kết nối bộ điều khiển LED (có chế độ mô phỏng khi chưa có phần cứng).
11. `tools/loadtest`: giả lập 100k → 1M → 10M thiết bị; báo cáo chi phí và độ trễ từng mốc.
12. Tách đường nóng sang hạ tầng riêng (giai đoạn 2), dual-write, cắt chuyển theo phần trăm.
13. Pen-test, runbook, kế hoạch khôi phục thảm họa, bàn giao.

**Tiêu chí nghiệm thu:** chạy được toàn bộ bằng `make up` trên PC (Docker); mọi nút trong prototype có API thật; RBAC kiểm thử ở máy chủ kể cả truy cập chéo khách hàng; không còn dữ liệu minh họa; giao dịch SePay thật được cộng ví và kích hoạt đúng một lần dù webhook gửi trùng; đối soát doanh thu khớp impression log; audit log đầy đủ; kiểm thử tải đạt SLO ở mốc đã cam kết.

**Điều kiện dừng và hỏi lại:** thiếu tài liệu API đối tác; chi phí ước tính vượt ngân sách ở mốc nào đó; số đo tải thật lệch quá 30% so với giả định ở mục 3; tài liệu SePay nội bộ mâu thuẫn với mục 8.3.

---

## 15. Cần chủ dự án xác nhận trước khi bắt đầu

**Tên và môi trường:** tên đầy đủ của AMS; tên miền thật; cấu hình PC chạy Docker (RAM, CPU, Windows/WSL2 hay Linux); có dùng Cloudflare tài khoản nào (Workers Paid, Enterprise) và ai quản lý.

**Hạ tầng và thiết bị:** ngân sách hạ tầng hằng tháng cho 1M / 10M / 50M; chu kỳ heartbeat chấp nhận được (đề xuất 120 giây); dòng TV ưu tiên (Android TV, Tizen hay webOS); vùng đặt máy chủ giai đoạn 2 và yêu cầu lưu trữ dữ liệu trong nước.

**Màn hình thang máy và LED:** hãng và model bộ điều khiển LED đang dùng; danh sách mô-đun P5 thực tế; người sở hữu nội dung trong thang máy (chủ tòa nhà hay công ty); quy định phát âm thanh trong thang máy.

**Tài chính:** cổng thanh toán và ngân hàng thu hộ; chính sách xuất hóa đơn (khi nạp hay khi dùng); có cho nợ/hạn mức tín dụng cho khách lớn không; hạn mức nạp tối thiểu/tối đa; phí cổng thanh toán do bên nào chịu.

**SePay:** tài khoản ngân hàng/VA gắn SePay; cấu trúc mã thanh toán đã đăng ký; số tiền tối thiểu để tự kích hoạt; gói dịch vụ nào được kích hoạt khi khách hàng mới thanh toán; phí và thời gian đối soát theo hợp đồng SePay.

**Tài khoản ngoài:** khách hàng có được tự gửi duyệt ngân sách không (đề xuất không); thời hạn tài khoản mặc định; quota tải lên; ai duyệt video của khách theo từng khu vực.

**Đối tác và tài sản:** logo và tài liệu API của Chicilon, Unique OOH, WeWin, Goldsun, Brandcom, Trimai; ảnh mẫu `ADS.png`; mẫu hợp đồng chính thức do luật sư xác nhận.
