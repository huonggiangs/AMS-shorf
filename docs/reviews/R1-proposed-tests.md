# R1 proposed tests (not implemented: reviewer is read-only)

Suggested locations follow existing suites: `services/api/test`, `services/payments/test`, `services/edge-gateway/test`, `tests/security/**` (PLAN §6). Each maps to a finding in `R1-SECURITY.md`.

## RBAC / auth
1. `users.invite-sets-mfa` (R1-01): invite an internal user with role `finance`; assert `admins.mfa_required = 1`; after `invite/accept` without enrolling, `POST /auth/login` must not yield a usable session (`/admin/v1/topups` => 401 `mfa_required`).
2. `users.delegated-admin-escalation` (R1-07): grant `content_manager` an `admin:write` override; as that user `POST /admin/v1/users` role `finance` without `permissions` => expect 403 `escalation`; `PUT /users/:id` role -> `finance` => 403.
3. `customers.state-transitions` (R1-08): as finance (`customers:write`, no approve): `pending_payment -> suspended -> cooperating` must be 403; `terminated -> cooperating` must be 403.
4. `rbac.finance-data-leak` (R1-17): content_manager `GET /dashboard/overview` and `/partners` must not contain `revenue_vnd`, `floor_cpm_vnd`, `ecpm_vnd`; `/customers/:id` must not contain `tax_code`, `debt_vnd`, `credit_limit_vnd` (adjust to policy decision).
5. `auth.lockout-no-oracle` (R1-19): unknown email vs locked email must return the same status/body and similar timing; 5 bad passwords by an attacker must not give a distinguishable 429 for a non-owner.
6. `auth.mfa-challenge-cap` (R1-12): with a valid password, repeated logins beyond N must be refused regardless of KV state (simulate non-atomic KV by using a KV stub whose `incr` never increments).

## IDOR (extend `api.test.ts` 127-176)
7. Partner with grant to campaign A (same customer): `GET/PUT/POST pause` on campaign B of the same customer => 404; expired grant (`expires_at` in the past) => 404; partner `GET /portal/v1/media` shows only own-uploaded or granted-campaign media.
8. `portal.partner-create-campaign` (R1-23): partner with write override creates campaign => either grant is created and response 201 readable, or 403.
9. External user cannot read other customers' `topups`, `refund-requests`, `wallet` by passing `?customer_id=` or body `customer_id` (payments routes use session only).
10. `/admin/v1/*` with an external session and `/portal/v1/*` with internal session => 403 for each finance route (loop over registered routes from the Hono router so new routes are covered automatically).
11. Route-guard coverage test: enumerate `app.routes`; every non-public route (not `/health`, `/auth/*`, `/webhooks/*`) must have an auth middleware and a `requirePerm`/`requireAnyPerm` (fail on new unguarded routes).

## Payments / money
12. `webhook.replay-with-fresh-timestamp` (R1-18): capture a valid HMAC-over-body request, replay with new `X-SePay-Timestamp` => must be `duplicate`, balance unchanged; and (after fix) the bare-body signature must be rejected.
13. `webhook.mail-failure-retries-activation` (R1-05): mail transport throws on welcome email; first webhook => credited; second delivery must complete activation (customer `active`, awaiting campaigns funded) and finally return `{success:true}`.
14. `topup.manual-confirm-then-webhook` (R1-06): customer pending top-up 5,000,000; second finance user confirms; then webhook for same amount/content arrives; assert at most one credit or a `manual:` queue entry.
15. `webhook.reject-flood` (R1-16): 1,000 unauthenticated requests => DB rows bounded by limit; row size bounded.
16. `settings.sepay-two-person` (R1-02): `PUT /settings/sepay` account change by one finance approver does not take effect until a different approver confirms; audit + notification emitted.
17. `ledger.credit-crash-d1` (R1-15): with the D1 simulator (`d1sim.test.ts`), crash after claim before applyBalance => reconcile repairs the missing ledger entry (today: orphan only reported).
18. `campaign.reject-race-resume` (R1-11): reject an active campaign while a concurrent `resume`/spend wins the state transition; assert wallet reserve is restored or campaign cannot stay `active` with `funding_state='released'`.
19. Property test: random interleavings of approve/reject/end/delete/topup/spend on one customer keep `reconcileLedger` mismatches empty (use existing fault-injection `runtime/faults.ts`).

## Device protocol / gateway
20. `events.cap-concurrency` (R1-04): fire 20 parallel `POST /v1/events` batches of 50 valid events from one trust-1 device; total `valid` must be <= `maxPerDeviceHour`.
21. `gateway.body-limit` (R1-09): chunked 50 MB body to `/v1/register`, `/v1/pair` => 413 without buffering (assert max RSS delta or stream abort).
22. `commands.ack-cross-device` (extend `commands.test.ts:31`): device B acks device A's id in both `POST /v1/commands/ack` and heartbeat `cmd_ack`; A's command stays `delivered`; response `unknown` contains the id; no timing/info difference vs a random id.
23. `gateway.dev-endpoints-prod` (R1-13): with `NODE_ENV=production` and `GATEWAY_DEV_ENDPOINTS=1` the app must refuse to start or not mount `/v1/dev/pair-confirm`; with default compose env the route must be absent.
24. `startup.weak-secrets` (R1-13): `assertFinanceConfig`/boot must throw for `SEPAY_WEBHOOK_SECRET` in {`change-me-sepay`, `CHANGE_ME_AUTO`, <32 chars} when `SEPAY_MODE=production`.
25. `nonce.replay-across-restart`: same nonce replayed after gateway restart (new `KvNonceStore` on same KV) => 409; replay after `NONCE_TTL_S` expiry is rejected by timestamp window.
26. `devices.block-propagation`: block device via bulk; next signed request from another gateway instance (separate `DeviceDirectory`) is rejected within `DEVICE_MEM_TTL_S`.

## Media
27. `manifest.excludes-unscanned` (R1-03): creative approved with `scan_state='pending'|'unscanned'` must not appear in the manifest (when policy requires clean); manifest URL must point to the rendition, not `storage_key`.
28. `media.approve-requires-scan` (R1-03): approve with `scan_state='pending'` => 409.
29. `media.presign-size-bound` (R1-10): upload 10x declared size via the presigned URL => storage rejects (needs MinIO e2e); confirm rejects and deletes object; second PUT with same URL after confirm fails.
30. `manifest.large-object-no-throw` (R1-10): approved creative with `sha256 NULL` and 200 MB object => manifest build still succeeds for other creatives (skips + logs).
31. `media.approve-version-bound` (R1-14): owner edits overlay after admin loaded the item; approve with old `content_version` => 409.
32. `import.url-denylist` (R1-22): table test for `checkImportUrl`: `https://172.16.0.1/a.mp4`, `https://100.64.0.1/a.mp4`, `https://[::1]/a.mp4`, `https://127.0.0.1.nip.io/a.mp4`, `https://user:pw@evil.com/a.mp4`, `https://evil.com:8443/a.mp4`; add resolver-level tests when the downloader exists.

## Infra / headers
33. `proxy.ip-trust` (R1-20): with `TRUST_PROXY=0`, API, gateway and payments `actor` must all ignore `x-forwarded-for`/`x-real-ip`/`cf-connecting-ip` (today gateway/payments ignore the flag).
34. `cookies.secure-flag`: when `PUBLIC_ADMIN_URL` is https every Set-Cookie has `Secure; HttpOnly` (session) and `SameSite=Lax`; fail the boot in production if the URL is not https.
