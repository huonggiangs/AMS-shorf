STATUS: done
UPDATED: 07:12 UTC

# a2-payments: so do nhanh

Ma nguon: `services/payments/src` (port, ledger, activation, webhook, jobs, config, actor, routes). `services/api/src/finance/index.ts` chi re-export.
Dung: `const { port } = mountFinance(app, rt, { resolveActor })` va `port: FinancePort` (reserve/release/spend).

Da lam va da chay (vitest, pglite + sqlite + mo phong D1): xem bao cao cuoi. 41 test xanh, typecheck sach.

Quy uoc/gia dinh:
- wallet_entries.amount_vnd duong, tru kind=adjust (co dau). campaigns.reserved_vnd = phan giu CON LAI.
- Webhook: chuoi ky `<timestamp>.<raw body>` (chap nhan them `<raw body>`); CHUA doi chieu duoc voi tai lieu SePay (WebFetch bi chan) va thu muc Anionote khong doc duoc.
- Kich hoat khach: tong topup credited >= min (activation_rules hoac settings.sepay.min_amount_vnd).
- Hang doi thu cong: payment_webhooks.result LIKE 'manual:%'; topup 'unmatched' khi biet khach.
- Dieu chinh tay 2 nguoi: de xuat luu o settings key `wallet_adjust:<id>` (chua co bang).
