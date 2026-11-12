# Yeu cau cua a2-payments

## a1-api-core
1. Goi `mountFinance(app, rt)` (dong bo, tra FinancePort khop ports.ts + `spendForCampaign`) SAU middleware auth cho /admin/v1/* va /portal/v1/*; ham doc `c.get('user')`/`c.get('ip')` cua a1. Webhook `/webhooks/payments/sepay` va `/dev/sepay/simulate` KHONG duoc dat sau authenticate (webhook tu xac thuc HMAC; simulate tu kiem quyen).
2. `scheduled(rt, cron)`: '*/10 * * * *' -> doi soat bu SePay; cac cron khac -> job hang ngay. Gioi han: `activate_on_approve=0` giu tien nhung DB state='paused' (port bao 'scheduled').
3. Chi tieu impression: `fin.spendForCampaign(rt,{campaignId, amountVnd})`.
4. services/api/package.json: co the them dependency `@ams/payments` thay cho re-export bang duong dan tuong doi trong src/finance/index.ts.

## f1-foundation
1. Bang rieng cho de xuat dieu chinh tay (hien dung `settings` khoa `wallet_adjust:*`) va cot `undone_at` cho activation_log.
2. Cot `ad_wallets`/`payment_webhooks.payload`: payload webhook chua so tai khoan ngan hang: can ma hoa theo truong (THREAT-MODEL #2 I).

## f3-web
1. Admin: trang thai topup pending duoc tra la `awaiting_confirm`. Endpoint moi: /admin/v1/payments/manual-queue, /admin/v1/refund-requests, /admin/v1/wallet-adjustments, /admin/v1/activation-log.
