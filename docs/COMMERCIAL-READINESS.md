# AMS: đánh giá sẵn sàng thương mại (go/no-go bán dịch vụ trả phí tại Việt Nam)

Ngày: 2026-11-14 (UTC). Tác giả: agent r5-commercial. Phương pháp: đọc mã và tài liệu trong repo (commit `9335409`), đối chiếu R1 (bảo mật), R2 (QA), R3 (đặc tả), nhật ký agent và hai bản bàn giao. **Không chạy lại test, không chạy Docker, không truy cập Cloudflare/SePay thật.** Số kiểm thử trích từ R2/nhật ký agent. Công sức là **ước tính của tác giả, đơn vị người-ngày [ƯT]**, chưa đo. Mọi nhận định pháp lý/thuế là **hiểu biết chung, chưa tra cứu nguồn trong phiên này, luật sư và kế toán của công ty phải xác nhận**.

## 1. Tóm tắt điều hành (một màn hình)

**Kết luận: NO-GO cho bán đại trà. CÓ THỂ GO cho "pilot kín có kiểm soát" (3–5 khách quen, ≤ 50–100 TV, nạp trả trước, hóa đơn xuất tay) sau khi xong nhóm P0 (khoảng 36–46 người-ngày [ƯT] không kể app TV, cộng 10–15 cho app TV; đó là đường Postgres/VPS; thêm khoảng 10–13 nếu bắt buộc chạy hoàn toàn trên Cloudflare).**

Lý do chính:
1. **Lõi tiền và an toàn tốt hơn mức thông thường của một prototype**: sổ cái ví bất biến bằng trigger, webhook SePay idempotent (test trùng ×5 và đua tiền), RBAC/IDOR kiểm ở máy chủ và có test, audit log chỉ-INSERT, máy trạng thái chiến dịch một cổng, outbox, đối soát ví/doanh thu/SePay. R2 chạy lại: smoke 35/35, e2e UI 11/11 trên Postgres + Redis thật.
2. **Nhưng chưa thể tính giá thật**: đơn giá mỗi lượt hiển thị là hằng số tạm 20 ₫ (`services/edge-gateway/src/events.ts:25`, ghi chú "TAM") đặt bằng biến môi trường; `contract_lines`/bảng giá/giá sàn không nối vào đường trừ tiền. Không có trang giá, không có gói. Đây là chặn P0 thương mại số 1.
3. **Chưa từng chạy ở môi trường đích**: chưa có `make up` Docker thật, chưa có Cloudflare staging chạy thật (R2: NO-GO staging; DEPLOY/RUNBOOK/DR đều ghi "chưa chạy thật"), chưa thử SePay thật, **chưa build/chạy app TV trên TV thật** (`ops/agents/a4-tv-bridge.md`). Không có bản sao lưu nào được khôi phục thành công ngoài Postgres nhúng.
4. **Cloudflare không phải đường sẵn sàng cho tiền thật hiện nay**: `media-worker`/ClamAV không chạy được trên Cloudflare (`docs/DEPLOY-CLOUDFLARE.md:219`) nên creative mới không bao giờ thành `clean` và không thể duyệt/phát; KV `incr` không nguyên tử (R1-12, `packages/runtime/src/cloudflare/kv.ts:19-23`); D1 không có giao dịch tương tác nên mọi bước tiền phải viết lại bằng `batch` (`docs/RECONCILIATION.md` mục 4), mới được kiểm trên mô phỏng. Staging Free không chạy cron: tác vụ nền (đối soát, bắt đầu/kết thúc chiến dịch, sweep) không chạy.
5. **Pháp lý/vận hành chưa có**: không có điều khoản dịch vụ, chính sách quyền riêng tư, SLA, hợp đồng đã qua luật sư, hóa đơn điện tử thật (chỉ ô nhập tay `einvoice_ref`), cảnh báo tự động, trang trạng thái, lịch trực, pen-test, quy trình xóa dữ liệu. Tôi đã thêm 3 bản nháp trong `docs/legal/` để luật sư làm việc nhanh hơn, chúng **chưa dùng được** nếu chưa duyệt.
6. **Rủi ro ngành đặc thù**: quảng cáo hiển thị trên lớp phủ khóa của ứng dụng giám sát phụ huynh (trẻ em); thiết bị và app TV chưa được xác minh; chính sách Play/Accessibility; quy định quảng cáo và dữ liệu trẻ em. Cần quyết định của chủ dự án và luật sư trước khi bán cho nhãn hàng bất kỳ.

### Bảng xếp hạng

| # | Khu vực | Xếp hạng | Bằng chứng chính | Chặn pilot? |
|---|---|---|---|---|
| 1 | Đủ tính năng so với đặc tả | **PARTIAL** | Vòng đời chiến dịch, duyệt, lịch, ghép đôi, proof-of-play: có. Giá/billing theo hợp đồng, hóa đơn điện tử, hợp đồng PDF/ký: thiếu | Có (giá) |
| 2 | Tiền và đúng đắn | **PARTIAL (mạnh)** | Idempotency, sổ cái, đối soát: có. SePay thật chưa thử; VAT/hóa đơn thủ công; D1 nguyên tử mới kiểm trên mô phỏng | Có (SePay thật) |
| 3 | Bảo mật và tuân thủ | **PARTIAL** | RBAC/MFA/audit tốt. Còn R1-10,12,14,16,19–21,24; chưa pen-test; NĐ13, kiểm duyệt nội dung theo luật quảng cáo, kid_safe: chưa đủ | Có (pháp lý) |
| 4 | Tin cậy và vận hành | **FAIL** | Backup/restore chỉ thử trên Postgres nhúng; không cảnh báo, không status page, không lịch trực; SLO đo trên 2 vCPU dùng chung | Có |
| 5 | Tài liệu pháp lý/thương mại | **FAIL** | Không ToS/Privacy/SLA/bảng giá/dunning. Mẫu hợp đồng 11 điều chưa qua luật sư | Có |
| 6 | Ràng buộc Cloudflare và dung lượng | **PARTIAL** | Staging Free: không cron; 8 cron khai báo > 5 giới hạn Free; production cần Workers Paid; đường media/KV/D1 chưa kiểm thật. Dung lượng 100k TV tương đương đo được trên Postgres | Không (nếu chọn VPS) |
| 7 | Onboarding khách hàng | **PARTIAL** | Bán qua nhân viên: tạo khách + mời + 2FA + hạn mức tải + hàng chờ duyệt: có. Không tự đăng ký, không KYC tự động, không điều khoản chấp nhận trong luồng | Không (pilot kín) |

---

## 2. Chi tiết từng khu vực

### 2.1 Đủ tính năng so với đặc tả: PARTIAL

Đã có (R3 ngày 11-12 đã lỗi thời; trạng thái hiện tại theo nhật ký w2/x3 và R2):
- Vòng đời chiến dịch Nháp → Chờ duyệt → Chờ nạp tiền → Đã lên lịch → Đang phát → Tạm dừng/Từ chối/Kết thúc: `packages/shared/src/campaign-state.ts`, R2 độc lập grep không có ghi `state =` ngoài module này; test 8×8 cặp sai, test đua duyệt.
- Duyệt: `services/api/src/routes/approvals.ts`, `campaigns.ts`; khách không tự duyệt ngân sách (`externalAllowed` chặn approve/delete, R1 mục "Verified as sound").
- Lịch: `routes/schedule.ts` (bước 30 phút, daypart). Ghép đôi thiết bị: `services/edge-gateway/src/pairing.ts`, mã 6 số hết hạn 5 phút; `device_commands` có ack bền (R2 mục 3).
- Proof-of-play và lịch sử: `routes/history.ts` (`/admin/v1/history`, `/portal/v1/history`, khách chỉ thấy dữ liệu của mình, lọc trong SQL).
- Hợp đồng: `routes/contracts.ts` sinh từ mẫu 11 điều, số tiền bằng chữ có test; **chỉ HTML**, không PDF, không ký điện tử (cột `signed_file_key` chỉ là chỗ chứa).
- Hóa đơn: `routes/invoices.ts` tạo nháp → phát hành → thu → hủy, VAT 0/5/8/10 (`vatOf`, dòng 18, 85), tạo `receivables`; **`einvoice_ref` là chuỗi nhập tay (`invoices.ts:136-140`)**, không gọi Viettel S-Invoice/MISA nên chưa phải hóa đơn điện tử theo Nghị định 123.

Thiếu hoặc không đủ cho thương mại:
- **Định giá và billing theo hợp đồng**: `contract_lines.unit_price_vnd` chỉ được đọc để hiển thị (`contracts.ts:191`); đường trừ tiền dùng `priceMicroVnd = 20_000_000` (20 ₫/lượt, mọi quảng cáo, mọi màn) từ biến môi trường `IMPRESSION_PRICE_MICRO_VND` (`events.ts:25`, `gateway.ts:93`). Không có giá theo loại màn/khung giờ/khu vực, không giá sàn gắn vào chi tiêu, không "gói".
- Waterfall P1/P2/P3 và đối tác RTB: chưa có (không có tài liệu API đối tác; Handoff mục 7). Doanh thu đối tác/`settlement`: chưa có (R3 #9).
- App TV: chỉ có Java tham chiếu + bản vá (`integrations/brainrot-tv`), **chưa áp vào mã thật, chưa build Android, chưa chạy TV thật** (Handoff mục 8). Tizen/webOS, thang máy, LED: ngoài phạm vi.
- Thông báo thời gian thực: polling 60 giây (R3 #5b); ví thưởng người xem: có route nhưng nhiệm vụ chưa có mô hình dữ liệu (w2).
- Báo cáo xuất PDF cho nhãn hàng: chưa; CSV có ở bảng web.
- Chuyển mã media: media-worker có (ffmpeg, ClamAV) nhưng **chỉ chạy trong Docker** (xem 2.6).

### 2.2 Tiền và đúng đắn: PARTIAL (phần mạnh nhất của hệ thống)

Có, kèm bằng chứng:
- Idempotency webhook: `payment_webhooks.event_id UNIQUE`, `topups.provider_txn_id UNIQUE`, cập nhật có điều kiện; test trùng ×5 tuần tự và đồng thời (`services/payments/test/finance.test.ts`, R3 #8; R1 "Verified as sound": không có đường cộng đôi trên pg/sqlite).
- Sổ cái: `wallet_entries` bất biến (trigger `0002_append_only.*`), `ad_wallets` có CHECK `reserved <= balance` (`0001_init.sql`), `uq_wallet_entries_ref` chống ghi sổ hai lần; kiểm tổng `repairLedgerDrift`/`reconcileLedger` (`reconcile-atomic.ts`, `jobs.ts`).
- Đối soát ba chiều: ví ↔ sổ cái, chi tiêu ↔ impression (`reconcile-revenue.ts`, bảng `revenue_discrepancies`), SePay cửa sổ 168 giờ (`reconcile-sepay.ts`) (`docs/RECONCILIATION.md`).
- Đổi tài khoản nhận tiền cần 2 người + TOTP (R1-02 đã sửa: `docs/SEPAY.md` mục 3, `sepay-change.ts`); điều chỉnh tay 2 người; chặn cộng đôi giữa xác nhận tay và webhook (RECONCILIATION dòng 33, R1-06 xử lý bảo thủ).
- Hoàn tiền: `routes.ts:248-262,411-447`: chỉ phần khả dụng, qua duyệt Tài chính, ghi sổ `refund`.
- Spend sau sự cố: chaos test sqlite 92/92; e2e S34 (phát lại, xóa dấu Redis).

Khoảng trống:
1. **Chưa có giao dịch SePay thật nào**: định dạng chữ ký/payload đã đối chiếu tài liệu công khai (`docs/SEPAY.md` mục 1) nhưng danh sách IP, lịch gửi lại và tham số `page` của API đối soát **chưa xác minh** (SEPAY.md, RECONCILIATION dòng 37). Cần một giao dịch thật đầu-cuối trước khi nhận tiền khách.
2. **Giá chưa thật** (2.1): doanh thu = số lượt × 20 ₫ cố định.
3. **VAT và hóa đơn**: VAT chỉ là cột `vat_rate` trên hóa đơn; ví không biết VAT (nạp 100% vào ví, chi tiêu không tách thuế). Thời điểm xuất hóa đơn (khi nạp hay khi dùng) và hóa đơn điều chỉnh khi hoàn tiền là quyết định của kế toán (COMMERCIAL-RECOMMENDATIONS #27). Chưa có tích hợp nhà cung cấp hóa đơn.
4. **D1 và tiền**: mọi bước tiền trên D1 chạy bằng một `db.batch` (RECONCILIATION mục 4), nhưng còn các cửa sổ không nguyên tử đã được ghi nhận (`settleRemainder`, `creditTopup` hai bước dựa vào sweeper). Chỉ được kiểm trên mô phỏng `d1sim`, **không phải D1 thật**. Handoff mục 6 tự khuyến nghị tiền chạy Postgres nếu cần chặt.
5. Số dư ví chưa có cảnh báo tự động khi lệch (đối soát chạy theo cron; staging không có cron).
6. Dunning/công nợ: mô hình trả trước nên rủi ro thấp; `receivables.state='overdue'` tồn tại nhưng không có job chuyển trạng thái, nhắc nợ hay tự tạm dừng (grep rỗng). Hạn mức công nợ (`credit_limit_vnd`) chỉ lưu, không thấy chặn thực thi.
7. R1-15, R1-16 còn mở theo nhật ký x1 (nhật ký x1 đã cũ: R1-02/05/06/11 đã có sửa ở các commit sau, nhưng **chưa có lần R1 chạy lại để xác nhận**).

### 2.3 Bảo mật và tuân thủ: PARTIAL

Đạt:
- Xác thực: scrypt, khóa tạm, TOTP bắt buộc cho tài khoản ngoài và mọi tài khoản nội bộ mới (R1-01 FIXED, `users.ts:182`, R2 xác nhận), phiên băm SHA-256, CSRF, mời một lần 72 giờ, buộc đổi mật khẩu lần đầu, `reset-password` có audit.
- RBAC 6 vai × 12 mô-đun × 4 hành động (`packages/config/src/rbac.ts`), `guardEscalation` (R1-07 FIXED), IDOR lọc trong SQL, test chéo khách hàng (`api.test.ts:117-176`).
- Audit log chỉ INSERT, kèm IP, không PII trong diff (`lib/audit.ts`; R3 PASS). Chưa có bản sao object-lock (DR dòng 167).
- Thiết bị: Ed25519 trên từng yêu cầu, nonce, `trust_level` (thiết bị chưa chứng thực không được tính tiền), trần 120 lượt/giờ (`events.ts:22`, R1-04 FIXED trên Postgres/Redis).
- Mã hóa theo trường cho MST, TOTP, khóa SePay (AES-GCM).
- Creative: chỉ `clean` mới duyệt/phát (`creatives-scan.ts`, `manifest.ts:391`, `media.ts:383`, enqueue quét cùng giao dịch `media.ts:319`).

Còn mở (đối chiếu R1/R2/x1, trạng thái ngày 13-11):
- R1-12 KV `incr` không nguyên tử trên Cloudflare: giới hạn đăng nhập/MFA, chống phát lại TOTP, trần impression đều mềm trên Workers.
- R1-10 (presign không giới hạn kích thước), R1-14 (duyệt không gắn phiên bản nội dung: khách đổi QR/hotline sau khi người duyệt xem), R1-16 (webhook lưu mọi yêu cầu giả không giới hạn, lưu số tài khoản thô), R1-19 (đoán email qua `account_locked`), R1-20/24/21 (IP tin cậy, cookie, scrypt N=2^15 dưới khuyến nghị OWASP, không xoay khóa `FIELD_ENC_KEY`), R1-17/26 (quyền xem tài chính của vai nội dung, device_ops tự nâng `trust_level`).
- **Chưa có pen-test** (`docs/ops/PENTEST-PLAN.md:3`), `tests/security/**` ở mức nhật ký x1. CI không quét CVE (RELEASE-CHECKLIST dòng 20).
- **Nghị định 13/2023 và luật bảo vệ dữ liệu cá nhân sau đó**: thiết kế có `phone_hash`/`email_enc`, không log PII, nhưng không có: bản chính sách quyền riêng tư (nay có bản nháp), cơ chế ghi nhận đồng ý, quy trình xóa/ẩn danh theo yêu cầu (sổ cái/audit bất biến phải có quy trình ẩn danh riêng), hồ sơ đánh giá tác động, hồ sơ chuyển dữ liệu ra nước ngoài (Cloudflare), chính sách lưu giữ tự động (RUNBOOK dòng 227). Vùng đặt dữ liệu (trong nước hay không) chưa quyết (COMMERCIAL-RECOMMENDATIONS #26).
- **Kiểm duyệt nội dung theo luật quảng cáo**: có hàng chờ duyệt bắt buộc và quét mã độc; có danh sách ngành cấm **chỉ cho kid_safe** (`tv-experience.ts:19`, mặc định rượu bia, thuốc lá, cá cược, cờ bạc, vay nóng, người lớn, thực phẩm chức năng, thuốc). Không có checklist ngành hạn chế (thuốc, thực phẩm chức năng, tài chính, bất động sản...) cho phần còn lại, không ô xác nhận quyền sử dụng nội dung/bản quyền ghi audit, không quy trình gỡ khi bị khiếu nại. Nhập từ YouTube/Drive: chỉ lưu tham chiếu, không tải (`media.ts:344`), đúng hướng tắt tính năng cho tới khi có xác nhận pháp lý.
- **kid_safe**: workflow đã có (cần `tv_experience:approve`, chặn ngành cấm, gateway fail-safe bỏ `lock` nếu `kid_safe !== true`, `x3` mục 10; test contract). Nhưng quyết định sản phẩm "quảng cáo trên màn khóa trẻ em" vẫn **chờ chủ dự án** (Handoff mục 7), app chưa chạy thật, đồng ý của phụ huynh ở app điện thoại chưa làm (`TV-APP-INTEGRATION.md` 8.2), và rủi ro Accessibility/Play (8.4). Đây là rủi ro pháp lý và danh tiếng lớn nhất không nằm trong mã.

### 2.4 Tin cậy và vận hành: FAIL

- **Sao lưu/khôi phục**: kịch bản Postgres đã chạy thật ở chế độ direct trên DB seed 13 MB (DR mục 7). **D1 Time Travel/export, R2, Docker thật, WAL/PITR: chưa chạy** (DR dòng 5, 162-167). Không có bản sao ngoài Cloudflare, không có lịch tự động. RPO/RTO là mục tiêu chưa đo.
- **Kho chứng cứ impression**: chưa chốt (D1 hay Analytics Engine không khôi phục được; DR dòng 20, 164). Đây là bằng chứng tính tiền.
- **Giám sát/cảnh báo**: chưa có Sentry/Grafana alert nối sẵn (`RUNBOOK.md:228`); không có giám sát ngoài (uptime). Cảnh báo tiền (lệch ví, webhook thất bại, hàng đợi) mới là truy vấn thủ công trong RUNBOOK mục 3.
- **Quay lui**: có quy trình (DEPLOY-CLOUDFLARE mục 8, RELEASE-CHECKLIST), chưa từng chạy; migration chỉ tiến, không có down (R3 mục C). Không có phát hành app TV theo giai đoạn.
- **SLO**: có tài liệu và số đo (`docs/SLO.md`, `LOAD-TEST-REPORT.md`): trên 2 vCPU dùng chung, tương đương 100k TV, heartbeat p99 14 ms, 0 lỗi/92.630; điểm gãy khoảng 1.000 req/s; bão khởi động p99 5,4 s (chưa cải thiện). 1M và 10M chỉ ngoại suy. SLO 99,95% là mục tiêu đặc tả, không có HA nào chứng minh nó.
- **Runbook**: có (`RUNBOOK.md` 242 dòng, DR, RELEASE-CHECKLIST, PENTEST-PLAN) nhưng toàn bộ lệnh Cloudflare/Docker "chưa chạy thật"; mục liên hệ/leo thang bỏ trống (`RUNBOOK.md:221`); chưa có script phát lại DLQ Cloudflare.
- **Trang trạng thái, lịch trực, hệ thống hỗ trợ (ticket)**: không có. Hiện vận hành dựa vào một người (người dùng) và CTO.
- Đơn điểm lỗi: một nhà cung cấp thanh toán (SePay), không có đường nạp dự phòng (RUNBOOK dòng 204); email thật chưa cấu hình (RUNBOOK dòng 22): không gửi được thư mời/kích hoạt.

### 2.5 Tài liệu pháp lý và thương mại: FAIL

Trước phiên này không có file nào về điều khoản dịch vụ, quyền riêng tư, SLA hay bảng giá (grep toàn repo chỉ khớp `COMMERCIAL-RECOMMENDATIONS.md`). Có: mẫu hợp đồng 11 điều trong hệ thống (`contracts.ts`, `seed-contract-template.ts`) chưa qua luật sư (R3 #6). Tôi đã thêm bản nháp **cần luật sư rà**: `docs/legal/TERMS-OF-SERVICE.draft.md`, `PRIVACY-POLICY.draft.md`, `SLA.draft.md`. Vẫn thiếu: bảng giá niêm yết và chính sách giá sàn, chính sách hoàn tiền (có trong mã, chưa có văn bản), chính sách dunning, phụ lục đo lường, quy trình tiếp nhận khiếu nại nội dung/bản quyền.

### 2.6 Ràng buộc Cloudflare và dung lượng: PARTIAL

Bằng chứng và hệ quả cụ thể:
- **Số cron vượt giới hạn Free**: `infra/cloudflare/api/wrangler.toml:90,162` khai 3 cron/môi trường, `edge-gateway/wrangler.toml:84,153` khai 1 cron: tổng **8 cron trên hai môi trường**, trong khi Workers Free cho tối đa 5 cron/tài khoản (ghi ở `scripts/deploy-cloudflare.mjs:19`, commit `5471d50`). Giải pháp hiện tại `--no-crons` (staging) biến cron thành rỗng (`wrangler.generated.toml:90`). **Hệ quả: trên staging không chạy** `startDueCampaigns/endDueCampaigns`, sweep outbox/kích hoạt, đối soát hằng ngày, `repairLedgerDrift`, dọn outbox. Một chiến dịch `scheduled` sẽ không tự lên phát. Staging chỉ kiểm thử được ở mức "gọi tay".
- **Production cần Workers Paid** (COST-MODEL dòng 52: $5/tháng + dùng thêm; DEPLOY-CLOUDFLARE dòng 34, 227). Cần Paid cho: Queues và Durable Objects theo mô tả repo, cron đủ số lượng, CPU/giới hạn request. Hạn mức Free cụ thể của D1/KV/Queues tôi **không tra cứu lại trong phiên này**: kiểm tra trên trang giá Cloudflare trước khi cam kết.
- **D1**: tối đa 10 GB/DB, xử lý tuần tự (~1.000 query/s khi 1 ms/query) (COST-MODEL dòng 56, 203); không có giao dịch tương tác (xem 2.2). Ba DB `core/finance/audit` hiện chỉ dùng `core` (DR dòng 21): mọi thứ cùng giới hạn 10 GB. `ev_*` trong D1 sẽ chạm trần nhanh khi lượt hiển thị tăng: cần bảng gộp và chính sách xóa (chưa có job).
- **Đường media không chạy được trên Cloudflare** (DEPLOY-CLOUDFLARE:219): ffmpeg và ClamAV không chạy trong Worker; nên creative upload mới giữ `scan_state` khác `clean`, và cổng duyệt/manifest (đúng) chặn chúng. Cần một VPS chạy `media-worker` + ClamAV nối R2 qua S3 API, hoặc cho phép `allow_unscanned_creatives` (không khuyến nghị cho khách trả tiền).
- **R1-12** KV không nguyên tử; `GW_CAPACITY_RPS=700` đặt cho một instance 2 vCPU (SLO mục 6), phải đo lại trên phần cứng thật.
- **Dung lượng thực** (đã đo trên Postgres + Redis, không phải Cloudflare): 100k TV tương đương = 612 req/s ổn định, vừa trong một gateway; consumer 793 msg/s/tiến trình; một VPS 4–8 vCPU thoải mái cho pilot và vài nghìn TV đầu tiên. Dung lượng Cloudflare chưa đo.

**Khuyến nghị kiến trúc cho giai đoạn đầu**: chạy phương án Docker/Postgres trên một VPS (ưu tiên máy chủ tại Việt Nam nếu luật sư yêu cầu dữ liệu trong nước), vì đó là đường duy nhất đã được e2e thật và có đủ media-worker, cron, giao dịch tương tác. Cloudflare dùng cho CDN/WAF phía trước và web tĩnh. Chuyển lõi sang Workers khi R1-12, đường media và D1 thật đã được kiểm.

### 2.7 Onboarding khách hàng: PARTIAL (đủ cho bán có người)

Có: nhân viên tạo khách (`customers.ts` POST, MST mã hóa, trạng thái `pending_payment`), tạo hợp đồng, mời người dùng (72 giờ, 2FA, đổi mật khẩu bắt buộc), kích hoạt tự động sau khi nạp đủ mức tối thiểu (`activation.ts`, có log hoàn tác), hạn mức tải (`upload_quotas`: 20 tệp/ngày, 30 MB/tệp, 5 GB mặc định), kiểm kích thước/định dạng theo loại màn, hàng chờ duyệt nội dung, trang kích hoạt/mời trong web (`Invite.tsx`, `Activate.tsx`; e2e `invite` PASS).

Thiếu: tự đăng ký (không có, không cần cho pilot), KYC nhà quảng cáo (chỉ MST + người đại diện nhập tay; không đối chiếu giấy phép kinh doanh/giấy phép ngành, không có cờ "ngành hạn chế đã xuất trình giấy tờ"), chấp nhận điều khoản trong luồng (không có màn đồng ý ToS/Privacy lưu audit), hộp xác nhận quyền sử dụng nội dung, quy trình tranh chấp nội dung, email thật.

---

## 3. Danh sách việc cần làm trước khi ra mắt

Công sức: người-ngày [ƯT], một kỹ sư thành thạo repo; không gồm thời gian chờ bên ngoài (luật sư, SePay, nhà cung cấp hóa đơn, mua TV thử).

### P0: bắt buộc trước khách trả tiền đầu tiên (pilot kín)

| # | Việc | Vì sao | Công sức | Phụ thuộc |
|---|---|---|---|---|
| P0-1 | **Chốt môi trường chạy tiền**: Docker/Postgres trên VPS (khuyến nghị) và chạy thật `make up` + seed bootstrap + smoke; hoặc hoàn tất Cloudflare (R1-12 sang Durable Object, đường media ngoài, kiểm D1 thật) | Chưa môi trường nào chạy tiền thật; R2 NO-GO staging | VPS: 4. Cloudflare: +10 | Quyết định chủ dự án |
| P0-2 | **Engine giá**: bảng giá theo loại màn × khung giờ × khu vực (CPM hoặc giá cố định), gắn vào `contract_lines`/campaign, trừ tiền theo giá đó; bỏ hằng số 20 ₫; báo cáo cho khách | Hiện không thể báo giá thật; tính sai doanh thu = tranh chấp | 6–8 | Chủ dự án chốt bảng giá thử (xem mục 4) |
| P0-3 | **Giao dịch SePay thật đầu-cuối**: tạo webhook thật, nạp 1 khoản nhỏ, kiểm trùng, trễ, mã không khớp, đối soát bù, xác minh danh sách IP và lịch gửi lại; ghi vào SEPAY.md | Điều kiện nghiệm thu "SePay thật" chưa đạt | 2 | Tài khoản SePay + VA |
| P0-4 | **Xác nhận lại R1**: chạy R1 lần 2 cho các mục payments (R1-05, 06, 11, 15, 16), media (R1-10, 14), auth (R1-19, 24); sửa mục còn mở; bắt buộc: R1-16 (giới hạn + mã hóa số tài khoản), R1-14 (gắn phiên bản nội dung), R1-19 | Nhật ký x1 đã cũ; một số mục tiền chưa có kiểm độc lập | 5 | |
| P0-5 | **Hóa đơn điện tử**: cho pilot, quy trình thủ công kế toán xuất trên Viettel S-Invoice/MISA rồi nhập `einvoice_ref`; chốt với kế toán thời điểm xuất (khi nạp/khi dùng), hóa đơn điều chỉnh khi hoàn tiền, ghi vào ToS 4.5 | NĐ123; không tích hợp vẫn bán được nếu có quy trình thủ công đúng luật | 1 (quy trình) | Kế toán |
| P0-6 | **Pháp lý**: luật sư duyệt và hoàn thiện ToS, Privacy, SLA, hợp đồng mẫu; quyết định vùng dữ liệu và hồ sơ NĐ13 (đánh giá tác động, chuyển ra nước ngoài); checklist ngành hạn chế + ô xác nhận quyền nội dung + quy trình gỡ; thêm màn chấp nhận điều khoản (ghi audit) | Không có nền pháp lý thì không ký được khách | Nội bộ 5 + luật sư (ngoài) | Luật sư |
| P0-7 | **Quyết định kid_safe/lớp phủ trẻ em** và đồng ý phụ huynh: chọn (a) chỉ bán trên màn không dành cho trẻ em, tắt `lock` context; hoặc (b) hoàn thiện đồng ý trong app và hồ sơ pháp lý | Rủi ro pháp lý và danh tiếng cao nhất | 2 (quyết định) + 5–8 nếu (b) | Chủ dự án + luật sư |
| P0-8 | **App TV thật**: áp bản vá vào Brain-rot, build, chạy trên ≥ 3 mẫu TV thật, kiểm ghép đôi, manifest, offline, hiển thị lớp phủ; phát hành app theo giai đoạn (1% → 10% → 100%) và thu hồi từ xa | Chưa từng chạy trên TV; không có sản phẩm nếu không có màn | 10–15 | Mã `D:\JOB\TV Block`, TV thử |
| P0-9 | **Cảnh báo và giám sát tối thiểu**: uptime ngoài (2 điểm), cảnh báo tới điện thoại cho: webhook SePay 4xx/5xx, lệch ví/đối soát, hàng đợi/dead-letter > 0, gateway 5xx, backup lỗi; Sentry; điền mục liên hệ/leo thang trong RUNBOOK | Không có cảnh báo = lỗi tiền được phát hiện bởi khách | 3 | |
| P0-10 | **Sao lưu ngoài nơi chạy + diễn tập khôi phục**: lịch tự động (`pg_dump` hoặc `d1 export`) sang nơi khác (B2/S3/máy khác), mã hóa, giữ 14 bản; sao chép media; **một lần khôi phục thật trên môi trường đích, ghi số RPO/RTO vào DR mục 7**; chốt kho chứng cứ impression | Chưa từng chứng minh khôi phục; mất dữ liệu = mất tiền khách | 3 | P0-1 |
| P0-11 | **Email thật** (SMTP/dịch vụ gửi thư, SPF/DKIM) cho thư mời/kích hoạt/nạp tiền | Không gửi được thư mời nếu không có (RUNBOOK:22) | 1 | Tên miền |
| P0-12 | **Pen-test nội bộ theo PENTEST-PLAN** (P0 items), vá lỗi Cao; chạy `pnpm audit`/osv trên lockfile | Tiền thật + dữ liệu khách | 4 | P0-4 |

Tổng P0 (đường VPS): khoảng 46–61 người-ngày [ƯT] gồm P0-8 (10–15) và nhánh (b) của P0-7; nếu loại P0-8 vì app TV do người khác làm: 36–46. Đường Cloudflare cộng khoảng 10–13 (P0-1 nhánh Cloudflare + kiểm D1 thật).

### P1: trong 30 ngày sau khách đầu tiên

| # | Việc | Công sức |
|---|---|---|
| P1-1 | Tích hợp hóa đơn điện tử (Viettel S-Invoice hoặc MISA meInvoice): phát hành từ `invoices/:id/issue`, lưu mã CQT, hóa đơn điều chỉnh khi hoàn | 8–10 |
| P1-2 | Hợp đồng PDF + chữ ký (ký số/điện tử) + lưu bản ký (`signed_file_key`) | 4–6 |
| P1-3 | Dunning tối thiểu: job chuyển `receivables` sang `overdue`, email nhắc, tự tạm dừng chiến dịch khi nợ quá hạn, thực thi `credit_limit_vnd`; cảnh báo số dư thấp qua email | 3–4 |
| P1-4 | Báo cáo proof-of-play xuất PDF/CSV có dấu thời gian cho nhãn hàng, trang giá/gói công khai | 4 |
| P1-5 | Quy trình quyền chủ thể dữ liệu: ẩn danh `end_users`/thiết bị theo yêu cầu, giữ sổ cái, chính sách lưu giữ tự động `ev_*` | 4 |
| P1-6 | Pen-test bên ngoài (ngân sách ngoài) và sửa lỗi | 3 + chi phí ngoài |
| P1-7 | Hệ thống hỗ trợ (hộp thư + ticket), trang trạng thái công khai, lịch trực 2 người, 10 runbook sự cố đầu có diễn tập | 4 |
| P1-8 | Media-worker cho đường Cloudflare (VPS riêng) hoặc dừng Cloudflare cho lõi; R1-12 sang Durable Object nếu dùng Workers | 5–8 |
| P1-9 | KYC nhà quảng cáo có kiểm soát: tải giấy phép kinh doanh/giấy phép ngành, người duyệt xác nhận, cờ ngành hạn chế (hàng chờ trước khi duyệt chiến dịch) | 4 |
| P1-10 | Xoay khóa `FIELD_ENC_KEY` (key id), scrypt tăng tham số (R1-21), IP tin cậy (R1-20), tách quyền xem tài chính (R1-17, R1-26) | 4 |
| P1-11 | Kiểm chứng tải trên phần cứng thật, đặt lại `GW_CAPACITY_RPS`; sửa bão khởi động | 3 |
| P1-12 | Thông báo thời gian thực (SSE) thay polling | 3 |

### P2: về sau

Phương án thanh toán thứ hai (VNPay/MoMo) 8–10; waterfall RTB sau khi có tài liệu đối tác 15+; settlement đối tác 8; xác thực thiết bị bằng Play Integrity/Widevine 15–20; đa vùng/HA, k8s 20+; white-label agency 10; chuyển sang ClickHouse khi vượt vài triệu TV 20+; kiểm toán đo lường bên thứ ba; ảnh chụp đối chứng LED, thang máy/LED connector (chưa biết model).

---

## 4. Kế hoạch ra mắt theo giai đoạn và rào chắn giá

### Giai đoạn 0 (tuần 0–6): sẵn sàng, không bán
Làm P0. Cổng ra: (1) e2e smoke + UI xanh trên môi trường đích; (2) giao dịch SePay thật thành công, có đối soát; (3) khôi phục thật từ sao lưu có số đo; (4) app TV chạy trên 3 TV thật ≥ 7 ngày liên tục; (5) luật sư ký duyệt ToS/Privacy/hợp đồng; (6) cảnh báo gửi tới điện thoại người trực khi mô phỏng lỗi.

### Giai đoạn 1: pilot kín, 3–5 khách quen, 20–50 TV (tuần 6–14)
- Bán có người: nhân viên tạo khách, ký hợp đồng giấy/PDF, nạp trước, hóa đơn xuất tay. Không tự đăng ký. Khách đầu tiên được thông báo rõ là pilot.
- Chỉ chiến dịch ngành an toàn; từ chối ngành hạn chế cho tới khi checklist pháp lý xong; không chạy trên màn có trẻ em nếu P0-7 chọn (a).
- Giới hạn: tổng ví tất cả khách ≤ `[20–30 triệu ₫]` lúc đầu, mỗi khách nạp 5–10 triệu, không cho nợ, không hoàn tiền tự động (hoàn thủ công 2 người).
- Cổng ra: 8 tuần không có sai lệch đối soát chưa giải thích, 0 sự cố mất/cộng đôi tiền, ≥ 99% thời gian TV online theo giờ phát, ≥ 3 khách tiếp tục nạp lần hai, hóa đơn mọi giao dịch được xuất đúng hạn.

### Giai đoạn 2: mở rộng có kiểm soát, 100–1.000 TV, 10–20 khách (tháng 4–9)
Làm P1 (hóa đơn điện tử, dunning, báo cáo PDF, DSR, pen-test ngoài, hỗ trợ, trạng thái). Vẫn bán qua nhân viên; tự đăng ký chỉ mở sau khi KYC (P1-9). Đo lại tải trên phần cứng thật; xác định có chuyển lõi sang Cloudflare hay giữ VPS. SLA thương mại 99,5% chỉ cam kết khi có giám sát ngoài và đã có diễn tập DR đạt.

### Giai đoạn 3: quy mô (từ khoảng 1.000 TV)
P2 theo nhu cầu khách; đa vùng; nhiều thiết bị. Khuyến nghị cam kết thương mại 5–10 triệu TV thay vì 50 triệu (COMMERCIAL-RECOMMENDATIONS mục 10; số thật cần chủ dự án quyết).

### Rào chắn giá (đề xuất để chủ dự án quyết, [ƯT], chưa có dữ liệu thị trường)
1. **Không bán dưới giá vốn đã đo**: chi phí hạ tầng pilot là VPS + Cloudflare Paid, cỡ vài triệu đồng/tháng cố định; giá bán phải tính theo từng màn và tổng ngân sách pilot, không dựa vào mô hình 50M thiết bị. Chạy lại `docs/COST-MODEL.md` với số TV thật.
2. **Bảng giá niêm yết + giá sàn trong hệ thống** (đã có `rtb_floors`, chưa nối): không cho nhân viên đặt đơn giá dưới sàn nếu không có hai người duyệt.
3. **Nạp trả trước bắt buộc, tối thiểu 5.000.000 ₫** (mặc định đề xuất trong COMMERCIAL-RECOMMENDATIONS #34); không công nợ trong pilot; hạn mức công nợ chỉ cho khách lớn, hai người duyệt, thực thi bằng mã (P1-3).
4. **Giá thử với 3–5 khách trước khi niêm yết công khai** (COMMERCIAL-RECOMMENDATIONS #33): ghi giá thử là "pilot", không cam kết giữ giá sang giai đoạn 2.
5. **Không cam kết lượt xem, doanh số hay SLA > 99,5%** cho tới khi có số đo thật trên TV thật và diễn tập DR; hợp đồng ghi số liệu của AMS là căn cứ tính tiền.
6. **Phí cổng chưa rõ ai chịu** (chuyển khoản SePay theo gói SePay [chưa kiểm]); chốt trước khi niêm yết giá, gộp vào giá.
7. Tổng số dư ví khách trong pilot là rủi ro trách nhiệm của công ty: giữ ≤ mức chấp nhận mất, cho tới khi pen-test + diễn tập khôi phục xong.

---

## 5. Điều chưa xác minh trong đánh giá này (nói thẳng)

- Không chạy lại test; số liệu R2/nhật ký agent lấy nguyên. Không kiểm dòng mã sau commit `9335409`.
- Không biết người dùng đã deploy thành công staging Cloudflare hay chưa (có commit `deploy`/`BOOTSTRAP-ADMIN.bat` nhưng không có kết quả chạy trong repo).
- Giới hạn gói Free/Paid của Cloudflare (D1, KV, Queues, cron) trích từ tài liệu nội bộ của repo (COST-MODEL, scripts); chưa tra lại trang giá hiện hành.
- Điều khoản pháp lý (Nghị định 13/2023, luật bảo vệ dữ liệu cá nhân, Nghị định 123/2020, Luật Quảng cáo, quy định trẻ em, thuế) viết theo hiểu biết chung, chưa tra cứu; không dùng làm cơ sở pháp lý.
- Ước tính công sức là của tác giả, chưa đo, độ lệch ±50%.

## 6. Tài liệu đã thêm trong phiên này
`docs/legal/TERMS-OF-SERVICE.draft.md`, `docs/legal/PRIVACY-POLICY.draft.md`, `docs/legal/SLA.draft.md` (bản nháp, cần luật sư), `docs/COMMERCIAL-READINESS.md` (tài liệu này), `ops/agents/r5-commercial.md` (nhật ký). Không đổi mã ứng dụng.
