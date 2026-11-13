STATUS: done
UPDATED: 2026-11-13 (UTC)

# x3-followups
1. web-admin: `meSchema.must_change_password`; AuthProvider co `mustChangePassword` (tu /auth/me hoac tu loi 403 `password_change_required` qua `onPasswordChangeRequired` trong api/client.ts); Guard (App.tsx) chuyen moi duong dan ve /profile; Profile dung co cua provider, doi mat khau xong goi reload. Test: src/test/forced-password.test.tsx (4).
2. e2e: seed demo ghi creative `scan_state='clean'` (DEMO-ONLY, ghi chu trong seed.ts); smoke dat 'clean' sau confirm (khong co media-worker), them AMS_ENV=test + AMS_LOCAL_CREDS_FILE tam + SEPAY secret du 32 ky tu (seed guard cua x1 lam smoke hong tu truoc). `pnpm e2e:smoke` 35/35 PASS, `pnpm e2e:ui` 11/11 PASS (Postgres+Redis that).
3. payments/src/spend.ts: chien dich rejected/ended => no-op (khong tru, khong chiem spend_events, remainder khong quyet toan; sweeper bo qua). Test trong test/spend.test.ts (sqlite+postgres).
4. API: /auth/invite/accept dung passwordPolicyError (12 ky tu hoa/thuong/so, khong chua phan dau email, ma `weak_password`); them GET /auth/invite/info?token= (rate limit 30/15 phut/IP, 404 `invite_not_found`, khong lo bi mat, khong tieu thu token). Test: services/api/test/x3-followups.test.ts.
5. openapi: memo liveRoutes/buildAll (nap app mot lan), runtime sqlite thay pglite, scripts dung `node --max-old-space-size` (xuyen nen tang), vitest forks execArgv. Da regenerate docs/openapi + sdk-ts; `openapi check` + test 6/6 PASS.
6. outbox.ts: createOutboxHandlers gop mailOutboxHandlers() (mail loi duoc thu lai).  pruneOutboxAll = pruneOutbox + pruneMailOutbox (payments/activation.ts: mail.send done > 6h, dead > 72h) dung o node.ts (moi gio) va worker.ts (moi cron khong phai moi phut).
7. payments/jobs.ts runFrequentFinanceJobs goi sweepActivations. Test test/x3-jobs.test.ts.
8. (nhu muc 6) token trong payload mail.send chi ton tai toi da vai gio sau khi gui.
9. users.ts: them POST /admin/v1/users/:id/reset-password {password} (chinh sach 12 ky tu, khong tu reset, chi super_admin reset super_admin) dat `force_password_change:<id>` giong bootstrap, huy phien, audit `user.reset_password`. (Truoc do chua co endpoint reset nao.)
10. gateway manifest.parseOverlayJson dung reviewerFields:'keep'; fail-safe: contexts co 'lock' ma kid_safe !== true thi bo 'lock'. Contract test them trong tests/contract/test/protocol.test.ts.
11. media.ts checkFormatOverlay(…, external): khach => reviewerFields:'reject' (422 bad_overlay). Cap nhat not-connected.test.ts.
12. payouts pay: khoa hang end_users bang UPDATE (khong FOR UPDATE) truoc INSERT ledger co dieu kien => lenh dong thoi xep hang, so du doc lai moi lan. Test dua nhau 3 lenh/80k so du => dung 1 thanh cong (not-connected.test.ts). Chua chay tren Postgres that nhieu ket noi (test dung pglite).
Kiem chung: api 222 test, payments 141, gateway 55, contract protocol 31, web-admin 59, openapi 6: PASS.

Goc OOM cua packages/openapi typecheck (tim ra bang chia nho): build.ts gan schema zod 3.24.1 cua web-admin vao ZodTypeAny cua zod 3.25.76 => tsc so sanh cau truc hai ban zod. Sua: `asZ(unknown)` trong build.ts; `tsc` con 5 giay. Nen dong bo phien ban zod cua web-admin (3.24.1) voi phan con lai (3.25.76) (viec cua f3/f1).
`pnpm typecheck` goc: 18/18 du an Done, khong loi (sau khi sua AuthProvider useEffect cleanup).
