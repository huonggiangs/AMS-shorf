STATUS: running
UPDATED: 2026-11-13T01:10:00Z

# w4-reconcile (đối soát doanh thu, cộng kép, SePay cửa sổ dài, D1 nguyên tử + sweeper)

## Đã làm (chờ kết quả kiểm chứng cuối)
- migration 0005_reconcile.sql (reconcile_runs, revenue_discrepancies, topup_credit_claims) + gen lại migrations.gen.ts bằng `node packages/db/scripts/embed.mjs`.
- services/payments/src/reconcile-revenue.ts: reconcileRevenue / listRevenueDiscrepancies / resolveRevenueDiscrepancy.
- services/payments/src/reconcile-sepay.ts: reconcileSepayWindow (cửa sổ mặc định 168h, tối đa 2160h, lát cắt + phân trang) + createSepayPagedFetcher.
- services/payments/src/reconcile-atomic.ts: applyBalance/reserve/release/spend nguyên tử bằng db.batch (chỉ khi interactiveTx === false) + repairLedgerDrift.
- ledger.ts (ngoài danh sách sở hữu nhưng bắt buộc cho mục 2 và 4; sửa cục bộ: creditTopup, applyBalance, tryReserve, releaseCampaign, spendCampaign nhánh D1).
- jobs.ts: runDailyFinanceJobs gọi repair + reconcileRevenue; thêm runFrequentFinanceJobs; re-export các module mới.
- test/reconcile.test.ts, docs/RECONCILIATION.md.

## Không đụng
webhook.ts, config.ts, routes settings (s1). Yêu cầu cho s1/chủ routes: xem w4-reconcile.requests.md.
