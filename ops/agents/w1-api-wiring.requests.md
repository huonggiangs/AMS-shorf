# Yeu cau cua w1-api-wiring cho agent khac

## a3-gateway (services/edge-gateway/src/manifest.ts, queryCreatives ~dong 296)
Manifest hien chi loai `scan_state IN ('infected','failed')`, nen creative 'pending'/'unscanned' van duoc phat. Chinh sach da chot o API (services/api/src/routes/creatives-scan.ts):
phat khi `scan_state = 'clean'`, HOAC `scan_state IN ('unscanned','skipped')` va `settings.allow_unscanned_creatives` IN ('1','true') (mac dinh tat). Dieu kien SQL de them:
`AND (cr.scan_state = 'clean' OR (cr.scan_state IN ('unscanned','skipped') AND EXISTS (SELECT 1 FROM settings s WHERE s.key = 'allow_unscanned_creatives' AND s.value IN ('1','true'))))`.
Luu y: `tools/sim`/`testing.ts` chen creative voi scan_state 'skipped'/mac dinh 'pending' -> can dat 'clean' trong fixture. Khi media-worker doi scan_state sang clean nen bump `manifest:epoch`.

## f3-web (apps/web-admin/src/auth/AuthProvider.tsx, api/schemas.ts, App.tsx)
1. `meSchema` them `must_change_password: z.boolean().optional()` (GET /auth/me va /portal/v1/me tra truong nay).
2. Khi `me.must_change_password === true` (phien con song sau khi tai lai trang) chuyen thang sang trang Ho so (/profile) va khoa dieu huong khac; xu ly toan cuc loi 403 code `password_change_required` cung cach. Login.tsx da xu ly dang nhap moi (buoc 'change'), Profile.tsx co form + canh bao (tu doc /auth/me), nen sau khi them 1+2 co the bo doan tu doc /auth/me trong Profile.
3. Media: API tra them `scan_warning` ('Chưa quét mã độc' hoac null) va loi duyet `creative_scan_pending|creative_not_scanned|creative_infected|creative_scan_failed|creative_link_not_ingested`; chiến dịch approve cung tra cac ma nay (409/422). Hien thong bao tren trang Duyet.
4. Campaign /end tra them `release_pending: true` khi viec hoan tien chua chay xong; DELETE chien dich tra 202 `{ok:true,pending:true}` khi con tien giu dang cho hoan.

## d1-seed-prod (packages/db seed) / i1-integration (tests/e2e/smoke.ts)
Seed demo ghi creative `scan_state='skipped'`; upload qua API giu 'pending' cho toi khi media-worker chay. Voi cong quet moi, duyet se bi chan neu khong co media-worker/ClamAV:
- seed demo (SEED_MODE=demo/local) nen ghi creative 'clean' hoac chen `settings` `allow_unscanned_creatives='1'` (chi demo/local; production KHONG);
- e2e smoke duyet chien dich voi creative upload qua API: can chay media-worker (CLAMAV_REQUIRED=0 cho 'unscanned') hoac dat scan_state='clean' truoc khi duyet va bat setting tren.

## p0-domain / a2-payments
Hoan tien reject/end/delete da chuyen sang outbox (`campaign.release`). Thay doi cho hop dong: khi reject/end, `campaigns.funding_state` GIU 'reserved' (neu dang giu tien) cho toi khi handler goi `releaseForCampaign`; truoc day API dat 'released' ngay trong giao dich. Neu code payments (spend/activation) cho chi tieu khi state='ended' va funding_state='reserved' thi nen chan (state in rejected/ended => khong chi tieu).
