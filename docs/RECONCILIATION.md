# Đối soát doanh thu, tiền nạp và sổ cái (w4-reconcile)

Mã: `services/payments/src/{reconcile-revenue,reconcile-sepay,reconcile-atomic,jobs,spend}.ts`, migration `packages/db/migrations/0005_reconcile.sql`, test `services/payments/test/reconcile.test.ts`.
Mọi ví dụ giả định tiền là số nguyên đồng, doanh thu impression là micro-VND (1 VND = 1.000.000 micro).

## 1. Doanh thu/chi tiêu so với impression log

Hàm: `reconcileRevenue(rt, opts)` (gọi được từ admin), `listRevenueDiscrepancies`, `resolveRevenueDiscrepancy`. Chạy định kỳ trong `runDailyFinanceJobs` (cron CF `15 2 * * *`, node scheduler cùng đường `scheduled()`).

So sánh theo (chiến dịch, ngày giờ Việt Nam), chỉ các ngày ĐÃ KẾT THÚC cộng độ trễ (mặc định 60 phút), mặc định quét lại 3 ngày:

| Loại | Hai vế | Ý nghĩa |
|---|---|---|
| `claim_vs_impression` | micro đã chiếm trong `spend_events` và doanh thu impression hợp lệ trong `impression_hourly` | Phải khớp tuyệt đối khi hết độ trễ (consumer chiếm spend trước, append sau). `diff` dương = thu thừa (trừ tiền không có impression), âm = thu thiếu (có impression chưa trừ) |
| `ledger_vs_claim` | `spend_dedupe.charged_vnd` * 1e6 và micro đã chiếm | Chỉ báo thu THỪA sổ cái. Không báo thu thiếu vì phần dư dưới 1 VND được dồn sang lô sau, chiến dịch hết ngân sách bị từ chối hợp lệ, và `settleSpendRemainders` không cộng vào `spend_dedupe` |

Giá (p1): cả hai vế cùng lấy từ `revenue_micro_vnd` của impression, mà gateway tính theo giá CHỐT của chiến dịch lúc duyệt (`campaign_prices`, xem `docs/PRICING.md`), nên đổi bảng giá không làm lệch đối soát; đơn giá mỗi lượt đọc được ở `spend_events.amount_micro_vnd`.

Chia ngày: claim được gán ngày theo `ts` của impression (join `spend_events.event_id = ev_ad_impression.event_id`); claim chưa có impression gán theo `created_at`; nếu bảng `ev_ad_impression` không có trong DB (ClickHouse) thì mọi claim chia theo `created_at` (có thể báo oan quanh nửa đêm: ghi ở đây, chưa kiểm chứng).

Dung sai: `max(toleranceAbsMicro, floor(doanh_thu * tolerancePct))`, mặc định 1 VND và 0,5% (env `REVENUE_RECONCILE_TOLERANCE_MICRO`, `REVENUE_RECONCILE_TOLERANCE_PCT`, `REVENUE_RECONCILE_DAYS`, `REVENUE_RECONCILE_GRACE_MIN`).

Ghi nhận: bảng `revenue_discrepancies` (UNIQUE kind+campaign+day, chạy lại chỉ cập nhật). Trạng thái `open` -> `resolved` tự động khi lần chạy sau thấy hết lệch (ví dụ sự kiện trễ về), hoặc người đóng (`resolved`) / bỏ qua (`ignored`, job không mở lại). Mỗi lần chạy có dòng ở `reconcile_runs` (ok/error). Lệch mới ghi `audit_log` (`finance.reconcile.revenue_discrepancy`) và `notifications`. Job KHÔNG tự sửa tiền.

Giới hạn thật: `spend_events` bị dọn sau 7 ngày (`pruneSpendEvents`), nên không đối soát được xa hơn 7 ngày; `days` tối đa 60 nhưng phần quá 7 ngày sẽ thấy claim = 0 và báo thu thiếu giả. Giữ `days <= 7`.

## 2. Cộng kép giữa đường thủ công và webhook

Bảng `topup_credit_claims`, khóa `claim_key` (PRIMARY KEY) ghi trong `creditTopup` TRƯỚC khi cộng:
- `txn:<provider>:<mã giao dịch ngân hàng>` nếu topup có `provider_txn_id` (webhook, đối soát bù SePay, hàng đợi thủ công), cùng một giao dịch ở hai đường chỉ một topup chiếm được; topup thứ hai bị đóng `rejected` (`matched_by='duplicate_txn'`) và audit `finance.topup.duplicate_txn_blocked`.
- `topup:<id>` cho nạp thủ công không có mã giao dịch.
- Chiếm khóa idempotent: lần chạy lại của chính topup đó (đứt giữa chừng trên D1) đi tiếp được.
- Cộng ví có thêm `uq_wallet_entries_ref` (một sổ cái `topup` cho mỗi topups.id) làm lớp cuối.

Trường hợp khó: admin xác nhận tay một yêu cầu QR (chưa có mã giao dịch), sau đó webhook của CHÍNH khoản chuyển đó đến. Hệ thống không có mã giao dịch ở đường thủ công nên không thể khớp chắc chắn. Quy tắc bảo thủ: đường TỰ ĐỘNG (không có người xác nhận) gặp topup đã được người xác nhận tay, cùng khách, cùng số tiền, trong `DOUBLE_CREDIT_WINDOW_HOURS` (mặc định 72) thì KHÔNG tự cộng: chuyển `unmatched` + `matched_by='manual:possible_double_credit'` + thông báo + audit. Người xem xác nhận (đường thủ công, `confirmedBy` khác rỗng) thì cộng, vì khoản thứ hai có thể là thật. Cái giá: hai khoản nạp thật cùng số tiền trong 72 giờ, khoản đầu xác nhận tay, thì khoản sau phải qua tay người. `creditTopup` trả `'already'` cho trường hợp giữ lại; webhook.ts hiện hiểu là `duplicate` (đã yêu cầu s1 phân biệt, `ops/agents/w4-reconcile.requests.md`).

## 3. Đối soát bù SePay cửa sổ dài + phân trang

`reconcileSepayWindow(rt, fetchPage, opts)`; mặc định 168 giờ (7 ngày), tối đa 2160 giờ (env `SEPAY_RECONCILE_LOOKBACK_HOURS`), chia lát 24 giờ (`SEPAY_RECONCILE_SLICE_HOURS`), 200 giao dịch/trang (`SEPAY_RECONCILE_PAGE_SIZE`), tối đa 50 trang/lát, 20.000 giao dịch/lần (cờ `truncated`). Mỗi trang đi qua `reconcileSepay` cũ, nên mọi khử trùng giữ nguyên (event_id, `provider_txn_id` UNIQUE, claim). Chạy lại/chồng lên nhau vô hại. Lát cắt đi từ cũ đến mới. `createSepayPagedFetcher` dùng `transaction_date_min/max`, `limit`, `page`: tham số `page` chưa kiểm chứng với SePay thật; nếu API bỏ qua `page`, vòng lặp tự dừng ở trang lặp lại (lọc id trùng) và chỉ thấy tối đa `limit` giao dịch mỗi lát, khi đó giảm `SEPAY_RECONCILE_SLICE_HOURS`. Hàm `reconcileSepay` 48 giờ cũ vẫn còn (webhook.ts, không đổi).

## 4. Cửa sổ không nguyên tử trên D1 và sweeper

Trên D1 (`db.interactiveTx === false`) `tx()` không hoàn tác. Trước đây reserve/release/spend/cộng ví là chuỗi UPDATE rời, đứt giữa chừng để lại ví giữ đôi hoặc thiếu sổ cái. Nay các bước tiền trên D1 chạy bằng MỘT `db.batch` (D1 chạy batch trong một giao dịch, tất cả hoặc không gì):
1. `INSERT INTO wallet_entries ... SELECT ... WHERE <đủ tiền, đúng trạng thái>` (dòng sổ cái chỉ ra khi điều kiện đúng, số dư sau tính trong SQL).
2. Các `UPDATE` cache (campaigns, ad_wallets) kèm `AND EXISTS (SELECT 1 FROM wallet_entries WHERE id = <dòng vừa chèn>)`.
Đổi trạng thái chiến dịch vẫn qua `transitionCampaign` (ghi lại câu lệnh rồi nhét vào batch). Áp dụng cho: `applyBalance` (nạp/điều chỉnh/hoàn), `tryReserve`, `releaseCampaign`, `spendCampaign`. Postgres/SQLite vẫn dùng đường giao dịch tương tác cũ (đường batch dựa vào việc D1 tuần tự hóa batch, KHÔNG an toàn dưới READ COMMITTED đồng thời của Postgres, nên không bật ở đó; test chạy nhánh này trên pglite/sqlite chỉ tuần tự hoặc qua d1Like).

Sweeper `repairLedgerDrift(rt, {minAgeSec=300, dryRun, fixCacheFromLedger})` (chạy trong job ngày; admin gọi được; mỗi sửa có CAS + audit `finance.repair.*`):
- topup `credited` không có dòng sổ cái: phát lại cộng nguyên tử (khóa `uq_wallet_entries_ref` chống cộng hai lần);
- chiến dịch `reserved` mà `reserved_vnd = 0` vẫn `active/scheduled/paused`: chuyển `ended`+`released` (đứt sau lần chi cuối);
- `ad_wallets.reserved_vnd` khác tổng giữ của chiến dịch: kéo cache về chiến dịch (nguồn sự thật của phần giữ);
- `balance`/`spent` cache khác tổng sổ cái: MẶC ĐỊNH CHỈ BÁO CÁO (audit + thông báo), sửa khi `fixCacheFromLedger` (sổ cái là nguồn sự thật, bất biến theo migration 0002).
Chỉ động đến ví cập nhật cách đây hơn `minAgeSec` để tránh đạp lên thao tác đang chạy.

### Cửa sổ còn lại (nói thẳng)
- Settle chi tiêu impression trên D1 (`settleRemainder`): chiếm phần dư (`UPDATE campaigns SET spend_remainder_micro = ... - whole`) rồi mới `spendCampaign`; đứt giữa hai bước làm mất tối đa vài VND doanh thu (nghiêng về phía khách), không bao giờ trừ đôi. Chưa gộp được vào một batch vì `spendCampaign` đọc lại trạng thái để cắt theo phần giữ còn lại. `claim_vs_impression` không thấy phần này (chiếm đã đủ), `ledger_vs_claim` chỉ báo thu thừa.
- Đường `creditTopup`: đánh dấu topup `credited` rồi mới cộng ví (hai bước). Đứt giữa chừng: topup credited chưa có tiền, sweeper phát lại sau `minAgeSec` (đến lúc đó khách thấy ví chưa có tiền tối đa vài phút; không bao giờ cộng đôi).
- `runAwaitingFunds` sau release/nạp lặp `tryReserve` từng chiến dịch (mỗi cái nguyên tử, cả vòng thì không): đứt giữa vòng, chiến dịch sau chưa được giữ cho tới lần nạp/quét sau. Không mất tiền.
- Duyệt chiến dịch -> chèn outbox (p0) và reject/end/delete hoàn tiền trước khi đổi trạng thái: giữ nguyên như p0 ghi nhận, ngoài phạm vi ở đây.
- Sweeper không phân biệt được "cache sai" với "sổ cái thiếu dòng" ở balance/spent: vì thế mặc định chỉ báo cáo.
- Cần tải thật để kiểm chứng batch D1 với D1 thật (đây mới chạy trên mô phỏng d1Like quanh sqlite/pglite).

## 5. Lập lịch và route (chưa nối hết, nói thẳng)

- Đã nối: `runDailyFinanceJobs` gọi `repairLedgerDrift` và `reconcileRevenue` (mỗi job có `guarded`, một job lỗi không chặn job khác; kết quả trả trong object).
- Chưa nối (file không thuộc w4): `scheduled()` trong `routes.ts` nhánh `*/10` chưa gọi `runFrequentFinanceJobs` / `reconcileSepayWindow`, và chưa có route admin cho các hàm trên. Danh sách việc cụ thể nằm ở `ops/agents/w4-reconcile.requests.md`.
