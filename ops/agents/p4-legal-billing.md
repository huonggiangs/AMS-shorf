STATUS: done (con mot so muc ghi o "Chua lam")
UPDATED: 2026-11-14T14:30Z

# p4-legal-billing

## Da lam
- Migration 0010 (chi sua 0010, IF NOT EXISTS): legal_documents, legal_acceptances, customer_kyc, kyc_documents, campaign_compliance, einvoice_documents, dunning_events, dsr_requests, processing_records, consent_records.
- shared/compliance.ts (logic thuan: van ban, KYC, nhac no, han muc, hoa don dien tu, luu giu, DSR) + test.
- API: services/api/src/legal (van ban + cong chap nhan 403 `terms_acceptance_required`), billing (einvoice adapter manual + khung MISA/Viettel, dunning, han muc, job), compliance (DSR, luu giu, so dang ky, KYC, duyet lan hai). Test: services/api/test/p4-legal-billing.test.ts (24).
- Web-admin: TermsGate, pages Legal/Billing/Compliance/Kyc, KycPanel (Ho so cua toi), hoa don dien tu o trang Thanh toan cua khach; test apps/web-admin/src/test/p4-legal-billing.test.tsx (12). `Field` (ui.tsx) nay gan label-input bang id.
- Docs: docs/legal/README.md (viec luat su/ke toan), docs/SEPAY.md muc 5. OpenAPI: them nguon legal/compliance/billing vao packages/openapi/src/build.ts (billing tach `dunning-routes.ts` de khong trung duong dan).

## Ghep voi agent khac
- p2: `campaign_compliance` + `assertComplianceForApproval` (compliance/approval.ts) dung lam dau vao "duyet lan hai" cho nganh han che; khong dung `campaign_gate.restricted_industry` cua p2 truc tiep, p2 co the doc `restrictionInfo()`.
- p3: job dung `billingFrequentTick` (10 phut) va `billingDailyTick` (02:20 UTC / cron `15 2 * * *`) trong node.ts/worker.ts.
- Bien moi truong (khong co gia tri that trong repo): EINVOICE_MISA_* / EINVOICE_VIETTEL_* (BASE_URL, SANDBOX_URL, CLIENT_ID, SECRET, SELLER_TAX_CODE).

## Chua lam
- P1-2 hop dong PDF + chu ky (khong co bang `contract_signed_files`), loc thiet bi kid_safe theo doi tuong (`device_audience`), go noi dung theo khieu nai, dang ky cong khai.
- Anh xa truong that MISA/Viettel + thong tin xac thuc (chi co khung, chu ky giu cho HMAC).
- Noi dung phap ly cuoi (luat su), cau hinh/ke toan (xem docs/legal/README.md).
- packages/openapi test "moi route ghi body..." con do route cua p3 (media scan-review, ops, /status), khong phai cua p4.
