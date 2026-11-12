# R3 - Đối chiếu đặc tả mục 14 (checklist nghiệm thu)

Reviewer: r3-spec (chỉ đọc). Ngày: 2026-11-12. Phạm vi: `docs/DAC-TA-GIAO-VIEC-AGENT.md` §14 + `docs/PLAN.md` §1 (phạm vi phiên này, PLAN thắng đặc tả).
Phương pháp: đọc mã, test, nhật ký `ops/agents/*.md`, handoff. **Không chạy lại test/Docker** (khu vực campaign state, outbox, device_commands, spend đang được agent khác sửa nên bỏ qua). Các "đã pass" dưới đây là lời của nhật ký agent, không do reviewer tái chạy.
Ký hiệu: PASS / PARTIAL / FAIL / OOS (ngoài phạm vi PLAN §1, đã khai báo là backlog).

## A. Danh sách việc §14

| # | Hạng mục | Kết quả | Bằng chứng / khoảng trống |
|---|---|---|---|
| 1a | Docker local: compose profiles, Makefile (setup/up/seed/test/loadtest/tunnel/down/reset), `.env.example`, Caddy `*.ams.localhost` | PARTIAL | Có `Makefile` đủ 8 lệnh, `infra/docker/docker-compose.yml` (profiles core/events/obs/tunnel), `Caddyfile`, `.env.example`, `scripts/ams.ps1`. Chưa từng chạy thật (không có Docker daemon): tiêu chí "máy PC sạch `make setup && make up && make seed` đăng nhập được, nhận email mời ở Mailpit" CHƯA được kiểm chứng; chỉ có `bundle-check` + `e2e:smoke` trên Postgres/Redis thật (i1-integration.md). Mailpit có trong compose, gửi mail mời có test (SMTP giả). |
| 1b | CI, adapter Cloudflare, Terraform | PARTIAL | `.github/workflows/ci.yml` (typecheck, test, compose config, build image), `deploy-cloudflare.yml`, `packages/runtime/src/cloudflare/*`, `infra/cloudflare/terraform`. Chỉ `tsc` biên dịch; "bộ test chung đạt trên Cloudflare staging" chưa có (f2-infra.md: chưa chạy wrangler/terraform). CI còn matrix build image `payments` (`ci.yml` dòng 59) trong khi compose đã bỏ service payments (docker-compose.yml:209): nên xác nhận Dockerfile `services/payments/Dockerfile` còn build được. |
| 2 | `proto` + OpenAPI mọi endpoint; sinh SDK TS/Kotlin | FAIL | Không có tệp/chuỗi `openapi` nào trong repo (grep trống); không có `proto/`, SDK TS/Kotlin. Hợp đồng chỉ nằm ở PLAN §4 và `docs/DEVICE-PROTOCOL.md`; web dùng zod schema viết tay `apps/web-admin/src/api/schemas.ts`. Không có contract test theo OpenAPI (§13 cũng yêu cầu). |
| 3 | Migration schema §5 + DDL sự kiện; seed từ prototype | PASS | `packages/db/migrations/0001_init.sql`, `0002_append_only.{postgres,sqlite}.sql`, `0003_integration.sql`; `packages/db/clickhouse/001_events.sql`, `002_aggregates.sql`; `packages/db/src/seed.ts` + `scripts/extract-prototype.mjs`; test `packages/db/test/db.test.ts`, `packages/runtime/test/seed.test.ts` (chạy cả pglite và sqlite). Ghi chú: ClickHouse id kiểu UInt64 chưa map (a3-gateway.md). |
| 4 | edge-gateway + ingest-consumer: heartbeat, events, manifest, idempotency, chữ ký, rate limit | PASS | `services/edge-gateway/src/{gateway,auth,events,manifest,pairing,protocol}.ts` (Ed25519, 50 sự kiện/lô, idempotent theo event_id, rate limit trong `protocol.ts`/`gateway.ts`); `services/ingest-consumer/src/consumer.ts` (khử trùng, ghi `impression_hourly`, trừ chi tiêu); test gateway 29, consumer 5 (theo nhật ký). Giới hạn: attestation, FCM chưa có; ClickHouse thật chưa chạy (PLAN §1 cho phép). |
| 5a | `api` + RBAC (gồm vai trò ngoài) + audit + TOTP | PASS | `services/api/src/auth/{routes,middleware,session}.ts` (scrypt, TOTP, CSRF, invite 72h, khóa tạm), `packages/config/src/rbac.ts` (6 vai x 12 mô-đun x 4 hành động), `lib/audit.ts`; `services/api/test/api.test.ts` (RBAC từng vai, chống leo thang quyền, audit append-only, không PII trong diff), `auth.test.ts`. |
| 5b | Chuyển trang web admin sang React nối API thật; bảng phân trang phía máy chủ; CSV/PDF; command palette; thông báo realtime | PARTIAL | React + Vite có (`apps/web-admin/src/pages/*`), `ServerTable.tsx`, `lib/csv.ts`, `components/Palette.tsx`. Thông báo là **polling 60 giây** (`components/Notifications.tsx` refetchInterval 60_000), không có SSE/WebSocket: chưa "realtime". PDF: phía web chỉ thấy tham chiếu trong DataTable/Overview; chưa kiểm xuất PDF thật; API hợp đồng trả HTML. Web "chưa thử với backend thật" (handoff), chỉ 33 test vitest + smoke e2e phía API. |
| 6 | Khách hàng, hợp đồng, trình sinh hợp đồng từ mẫu (số tiền bằng chữ có test), công nợ | PASS | `routes/customers.ts` (debt_vnd từ `receivables`), `routes/contracts.ts` (mẫu 11 điều, render HTML), `packages/shared/src/vnd.ts` + `shared.test.ts` (số tiền bằng chữ), `api.test.ts` "hop dong" (XSS, số bằng chữ, MST mã hóa). Lưu ý: xuất PDF thật chưa có (PLAN §4 ghi "HTML/PDF"). Mẫu chưa qua luật sư (§15). |
| 7 | Cổng khách hàng/đối tác: mời, kích hoạt, 2FA, presigned upload, quota, quét mã độc, kiểm kích thước theo loại màn | PARTIAL | Mời/kích hoạt/TOTP đối tác: `auth/routes.ts`, test "doi tac" (api.test.ts:221). Presigned + quota/ngày + tổng GB + kích thước theo loại màn + kiểm kích thước thật khi confirm: `routes/media.ts:139-237`, `lib/creative.ts`, test api.test.ts:399-474. **Quét mã độc: chưa có**: `scan_state` chỉ được gán 'pending', không có tiến trình nào đổi trạng thái (media.ts:334 "do dich vu transcoder dam nhan"; không có transcoder). Import từ link chỉ lưu tham chiếu, không tải về. |
| 8 | `payments`: sổ cái ví, giữ/giải phóng/trừ, SePay webhook, đối chiếu mã, kích hoạt tự động + log, QR, cấu hình SePay chọn ngân hàng, đối soát hằng ngày | PASS (có điều kiện) | `services/payments/src/{ledger,webhook,activation,spend,jobs,routes,config}.ts`; `services/payments/test/finance.test.ts` (đua tiền 2 và 10 chiến dịch, webhook trùng x5 tuần tự+đồng thời, sai chữ ký, Apikey, hàng đợi thủ công, kích hoạt theo mức tối thiểu, sổ cái bất biến, đối soát bù SePay, điều chỉnh 2 người, hoàn tiền, cấu hình SePay/ngân hàng, dev simulate không lọt production), chạy cả pglite và sqlite. Điều kiện: định dạng chữ ký/payload SePay **chưa đối chiếu với tài liệu thật** (a2-payments.md) => đúng "điều kiện dừng" §14 nếu mâu thuẫn; cần giao dịch SePay thật để đóng. Phần đang bị agent khác sửa (state/outbox/spend) không đánh giá ở đây. |
| 9 | `scheduler`, `settlement`, `transcoder`; lịch riêng thang máy và LED | PARTIAL / FAIL | Có `scheduled()` cron (`services/payments/src/jobs.ts`: scheduled->active, hết hạn, reconcile ledger; gọi từ `api/src/node.ts:17`) và `routes/schedule.ts` (bước 30 phút, daypart). **Không có** service `transcoder` (không mã nguồn), **không có** `settlement` (quyết toán đối tác/thanh toán doanh thu; Finance.tsx "Hóa đơn VAT & chi trả" là NotConnected), lịch riêng thang máy/LED chỉ ở mức loại màn hình/seed (OOS theo PLAN §1: player thang máy, LED). |
| 10 | App TV Android (jitter, hàng đợi offline, cache, VCR, ví thưởng), Tizen/webOS, thang máy, LED | OOS (PLAN §1) | Đã thay bằng cầu nối `integrations/brainrot-tv` (Java tham chiếu + patch + 28 vitest) và `tools/sim` (thiết bị ảo). Chưa build Android SDK/chạy TV thật (a4-tv-bridge.md). Trang `TvExperience.tsx` hiển thị NotConnected. |
| 11 | `tools/loadtest` 100k -> 1M -> 10M; báo cáo chi phí và độ trễ từng mốc | PARTIAL | `tools/sim/src/{fleet,loadtest,stats}.ts` (p50/p95/p99), `make loadtest`; test chỉ 2.000 thiết bị ảo. Không có kết quả đo ở 100k/1M/10M; `docs/COST-MODEL.md` + `docs/cost-model/cost.py` là mô hình tính toán, không phải số đo. Không có ngưỡng SLO tự động trong loadtest. |
| 12 | Tách đường nóng sang hạ tầng riêng, dual-write, cắt chuyển % | OOS | `infra/k8s` chỉ là khung (README + charts); không có dual-write. Đặc tả coi là giai đoạn 2. |
| 13 | Pen-test, runbook, DR, bàn giao | PARTIAL | Có `docs/THREAT-MODEL.md`, `docs/DEPLOY-CLOUDFLARE.md`, handoff `handoff/HANDOFF-*.md`. Không có runbook vận hành/kế hoạch khôi phục thảm họa riêng; `tests/security/**` và `ops/reviews/` (r1/r2) **chưa tồn tại** tại thời điểm rà soát; không có pen-test. |

## B. Tiêu chí nghiệm thu (đoạn "Tiêu chí nghiệm thu" cuối §14)

| Tiêu chí | Kết quả | Bằng chứng / khoảng trống |
|---|---|---|
| Chạy toàn bộ bằng `make up` trên PC (Docker) | PARTIAL | Compose hợp lệ về cú pháp (CI `compose config`), `bundle-check` chạy bundle đúng tham số Dockerfile trên Postgres/Redis thật; **chưa có lần `make up` thật nào** (handoff: không có Docker daemon). i1 đã sửa 9 lỗi ghép nối chỉ nhờ đọc/ chạy bundle, nên còn rủi ro phát sinh khi chạy thật (MinIO, Caddy, healthcheck). |
| Mọi nút trong prototype có API thật | FAIL | Các trang còn `NotConnected`: `TvExperience.tsx` (ví thưởng, nhiệm vụ, rút tiền, cài đặt TV), `History.tsx` (proof-of-play), `Finance.tsx:52,55` (doanh thu theo tháng khi rỗng, hóa đơn VAT & chi trả). f3-web.md thừa nhận: TvExperience, History, hóa đơn VAT, doanh thu theo giờ chưa có API. Các route khác (devices, campaigns, customers, contracts, approvals, media, screens, schedule, users, permissions, audit-log, dashboard, revenue, partners, rtb-floors, topups, wallets, settings/sepay) có trong `services/api/src/routes` + `finance`. Chưa có kiểm tra tự động "mọi nút" và chưa chạy web với backend thật. |
| RBAC kiểm thử ở máy chủ kể cả truy cập chéo khách hàng | PASS | `api.test.ts:48-115` (RBAC), `:117-176` (IDOR: list/detail/sửa/gửi duyệt/media/wallet của khách khác -> 404, lọc trong SQL), `sqlite.test.ts:27`, `finance.test.ts:320` (portal ví, body customer_id bị bỏ qua). |
| Không còn dữ liệu minh họa | PARTIAL | Web không nhúng số liệu giả (NotConnected thay vì số). Nhưng dữ liệu seed lấy từ prototype (`packages/db/src/seed-data.gen.ts`) là dữ liệu mẫu theo thiết kế; cần cờ/seed tách riêng cho production (chưa thấy cơ chế phân biệt trong deploy Cloudflare). Số tài khoản mẫu `0123456789`. |
| Giao dịch SePay thật được cộng ví và kích hoạt đúng một lần dù webhook trùng | PARTIAL | Tính đúng-một-lần được chứng minh bằng test mô phỏng (finance.test.ts:63 trùng x5 tuần tự và đồng thời; UNIQUE + cập nhật nguyên tử). "SePay thật" CHƯA kiểm: chưa đối chiếu định dạng chữ ký/payload với tài liệu SePay (a2-payments.md), chưa có tunnel + giao dịch thật. |
| Đối soát doanh thu khớp impression log | PARTIAL | Có `impression_hourly` (revenue_micro_vnd) ghi bởi consumer và trừ chi tiêu theo idempotencyKey; `reconcileLedger` đối soát ví/sổ cái; dashboard/revenue đọc từ `impression_hourly`. **Không thấy job/test đối soát tổng doanh thu và chi tiêu chiến dịch với log impression** (reconcile hiện chỉ ví vs sổ cái, và SePay bù). Giới hạn đã biết: spendFn trên D1 không atomic giữa các câu lệnh (i1-integration.md). |
| Audit log đầy đủ | PASS | `lib/audit.ts`, `lib/audit-ctx.ts`; test api.test.ts:255-298 (mọi thao tác ghi có dòng audit, không PII, append-only ở tầng CSDL qua `0002_append_only`, GET chỉ đọc); payments ghi `finance.*` audit. |
| Kiểm thử tải đạt SLO ở mốc cam kết | FAIL | Chỉ có harness + test 2.000 thiết bị ảo; không có SLO định nghĩa trong công cụ, không có số đo 100k+; số đo thật chưa so với giả định §3 (điều kiện dừng 30%). Handoff còn ghi mâu thuẫn §3 (140k vs 83k req/s) chưa được chủ dự án quyết. |

## C. Hạng mục §13 quan sát thêm (không thuộc checklist §14 nhưng đặc tả bắt buộc)

- Test e2e Playwright (duyệt, nạp tiền, tự chạy, SePay, phân quyền): FAIL. Chỉ có `tests/e2e/smoke.ts` (30 bước qua HTTP, không trình duyệt); không có Playwright.
- Contract test OpenAPI, chaos test: FAIL (không có).
- Quan sát: OTel collector + Grafana trong compose; Sentry/SLO dashboard/cảnh báo: chưa có (PARTIAL).
- WCAG 2.1 AA, responsive HD-8K: không có bằng chứng kiểm (chưa đánh giá).
- Feature flag, migration có rollback (§13 CI/CD): không có (migration chỉ tiến, không có down).

## D. Tổng hợp

PASS: 3, 4, 5a, 6, 8 (có điều kiện); RBAC/IDOR, audit log.
OOS (đã khai báo, không tính lỗi): 10, 12 và phần LED/thang máy của 9.

### Danh sách FAIL
1. #2 Không có OpenAPI/proto/SDK TS-Kotlin.
2. #9 Thiếu `transcoder` và `settlement` (và quét mã độc phụ thuộc transcoder).
3. Tiêu chí "mọi nút prototype có API thật": TvExperience, History (proof-of-play), hóa đơn VAT/chi trả, doanh thu theo giờ.
4. Tiêu chí "tải đạt SLO": chưa có số đo/SLO.
5. §13: không có e2e Playwright, contract test, chaos test.

### Danh sách PARTIAL
1. #1a/#1b/tiêu chí `make up`: chưa chạy thật trên Docker/Cloudflare; CI còn build image `payments` dù compose đã bỏ service.
2. #5b: thông báo là polling 60s (không realtime); PDF; web chưa thử với backend thật.
3. #7: quét mã độc chưa có (`scan_state` mãi 'pending'); import link chỉ lưu tham chiếu.
4. #8 và tiêu chí SePay thật: chưa đối chiếu tài liệu/giao dịch SePay thật.
5. #11: loadtest mới 2.000 thiết bị ảo, chưa báo cáo 100k/1M/10M.
6. #13: thiếu runbook/DR/pen-test; `tests/security` và `ops/reviews` chưa có.
7. Đối soát doanh thu với impression log: chưa có job/test đối soát chi tiêu/doanh thu vs impression.
8. "Không còn dữ liệu minh họa": seed từ prototype; cần tách cấu hình production.

Ưu tiên khuyến nghị: (a) chạy `make up` thật trên PC chủ dự án và ghi kết quả; (b) thêm OpenAPI (sinh từ zod) + contract test; (c) job đối soát impression vs chi tiêu; (d) quét mã độc/transcoder tối thiểu (hoặc khai báo OOS trong PLAN); (e) xác nhận chữ ký SePay với tài liệu thật; (f) khai báo rõ các trang NotConnected là backlog trong PLAN.
