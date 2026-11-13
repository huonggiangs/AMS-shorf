# R1 Security review (adversarial, read-only)

Date: 2026-11-12. Reviewer: r1-security. Scope: `services/api`, `services/payments`, `services/edge-gateway`, `services/ingest-consumer`, `services/media-worker`, `packages/{shared,config,runtime}`, `infra/docker`.
Method: static code reading only (no exploit run). Other agents were editing in parallel (payments `webhook.ts`/`config.ts`/`routes.ts` changed at 14:24 UTC during the review), so line numbers are as of ~14:27 UTC and may drift. Everything below is verified in code unless tagged **[UNVERIFIED]**.

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 3 |
| Medium | 13 |
| Low | 13 |

No Critical found: no auth bypass on the SePay webhook, no cross-tenant read/write on API routes, no cross-device command ack, no double-spend path found on the pg/sqlite engines.

Top 5: R1-01 (internal accounts without 2FA), R1-02 (single person can redirect the receiving bank account), R1-03 (scan/transcode control not enforced, unscanned originals reach TVs), R1-04 (impression cap race), R1-05 (paid but never activated after mail failure).

---

## HIGH

### R1-01 Internal accounts are created without mandatory 2FA (contradicts THREAT-MODEL)
- Evidence: `services/api/src/routes/users.ts:173-174` inserts `mfa_required = external ? 1 : 0`; `services/api/src/auth/routes.ts:151` and `auth/session.ts:105` only require MFA when `account_kind != internal || mfa_required = 1 || totp enrolled`. THREAT-MODEL §3 says "`mfa_required` mặc định true"; DB default is 1 (`0001_init.sql:53`) but the invite path overrides it to 0.
- Exploit: an invited finance/content_manager/device_ops user (finance has `finance:approve`, can change the SePay account, confirm top-ups, approve adjustments) can skip the TOTP enrollment screen after `invite/accept` (the `mfa_token` is only a hint) and later log in with password alone. Any phished or reused password gives a full session. (Seeded super admin has `mfa_required=1`, so this affects invited internal users.)
- Fix: set `mfa_required = 1` for all roles on invite; refuse a session (not just a challenge) for internal accounts without TOTP when role has any `approve`/`finance` right; add a startup/test invariant "no active internal admin with mfa_required=0 and no totp".

### R1-02 One finance approver can redirect all customer payments (receiving bank account) with no second person or step-up
- Evidence: `services/payments/src/routes.ts:494-516` `PUT /admin/v1/settings/sepay` requires only `finance:approve`; `saveSepayConfig` (`config.ts`) stores the new `account_number`/`bank`/`account_holder`; `GET /portal/v1/wallet` (`routes.ts:180-197`) and `createTopup` (`routes.ts:199-223`) hand that account and a VietQR to every customer. The manual adjustment path has a two-person rule (`routes.ts:388`) but this higher-impact change does not. Audit masks the number (`***xyz`).
- Exploit: compromise or insider on one finance account (see R1-01) changes the account; customers keep transferring to the attacker. The webhook flags real deposits as `manual:account_mismatch` only after the fact (`webhook.ts decide`, and only when both `cfg.account_number` and `p.accountNumber` are present; if the encryption key is wrong `acct=null` silently disables the check, `config.ts loadSepayConfig`).
- Fix: two-person approval (propose/approve like wallet adjustments) for bank/account/holder/enabled changes, fresh-TOTP step-up, notify all finance users and super admins by email on change, and show the account change in the portal with a delay (e.g. 24 h) before customers see it.

### R1-03 Claimed "scan + transcode, never play the original" control is not enforced
- Evidence:
  - `services/edge-gateway/src/manifest.ts:291-298` selects creatives with `scan_state NOT IN ('infected','failed')`, so `pending` and `unscanned` creatives are served; the manifest URL is built from `storage_key` (`manifest.ts:256`), i.e. the customer's original upload; the transcoded renditions written by `media-worker` (`worker.ts:133-149`) are never referenced.
  - `services/api/src/routes/media.ts:368-381` (approve) and `campaigns.ts approve` only check `review_state`; nothing requires `scan_state='clean'`.
  - Nothing enqueues `MEDIA_TOPIC` (grep: only the worker subscribes); the worker only runs from `sweep()`, and `NoScanner` is the default (`worker.ts:41`), `CLAMAV_REQUIRED` is opt-in.
  - `infra/docker/docker-compose.yml:317` makes the whole media bucket anonymously downloadable (`mc anonymous set download`), so signed URLs (`media.ts:209`) add nothing and unapproved/uploading objects are readable by anyone who knows the key (ULID is not secret: returned by the API and embedded in manifests).
  - Confirm only checks magic bytes for images (`media.ts:278-286`); video is accepted on declared/HEAD content-type.
- Exploit: customer uploads a crafted MP4/WebM that targets the TV decoder; a content manager approves after a visual check; it is delivered untouched to TVs. THREAT-MODEL §4 lists this as "Có (quy trình)", which is not true in code.
- Fix: manifest query must require `scan_state='clean'` (or explicit admin override flag) and serve the transcoded rendition (`renditions/.../manifest.json`) with its sha256; block media approve unless scan done; send `MEDIA_TOPIC` on confirm; make bucket private and serve through signed/CDN-token URLs; set `CLAMAV_REQUIRED=1` outside dev.

---

## MEDIUM

### R1-04 Per-device impression cap is a read-modify-write race (revenue and reward inflation)
- Evidence: `edge-gateway/src/events.ts:47-49` reads `cap:<dev>:<hour>` once, `:90` counts against the local copy, `:112` writes `used+delta`. Concurrent batches each start from the same `used`. Rate limit is 30 batches/min x 50 events (`gateway.ts` `evLimit`).
- Exploit: a trusted device (trust>=1, obtained by pairing/bulk verify) sends parallel batches: up to ~30x the intended 120 valid impressions/hour, each billed to the advertiser (`priceMicroVnd`) and rewarded to the viewer (`reward_vnd`). Event ids are device-minted UUIDv7 (no server issuance), so the cap is the only volume control.
- Fix: atomic counter (`kv.incr` per event, or DO/SQL conditional update) with reject on exceed; also cap per campaign/hour and flag impossible rates (>1 per `duration_s`).

### R1-05 Paid-but-not-activated: mail failure inside activation breaks idempotent retry
- Evidence: `payments/src/activation.ts:116` `await rt.mail.send(...)` is not guarded and runs inside `runActivationTx`; `webhook.ts:224-227` credits first, then `runActivation`. If it throws: pg rolls the activation back, the webhook returns 500, SePay retries, but retry hits `creditTopup -> 'already'` (`webhook.ts:225`) and returns `duplicate` without re-running activation. Same for `confirmTopup` (`routes.ts:283-294`, retry gives 409 `already_processed`).
- Impact: customer funded and ledgered but stays `pending_payment`, contracts not activated, awaiting-funds campaigns not started until another top-up. Availability/integrity bug (no theft).
- Fix: use `trySend`/outbox for the welcome mail (outside the tx); make `runActivation` idempotently re-runnable from the `already` branch and from a periodic sweep.

### R1-06 Manual confirm can double credit a transfer that later arrives by webhook
- Evidence: `routes.ts:283-294` `confirmTopup -> creditTopup` credits a customer-created `pending` top-up (no bank proof, `provider_txn_id` stays NULL). `webhook.ts decide` only reuses pending top-ups with `status='pending' AND provider_txn_id IS NULL` (`~:186`); the manually credited one is `credited`, so the real SePay transaction creates a new top-up and credits again.
- Exploit/impact: finance approver confirms on the customer's claim "I paid" (or colludes); when the real transfer webhook arrives the wallet is credited twice (or the customer never paid and one credit is unbacked). No code ties a manual confirm to a bank transaction id.
- Fix: require a bank reference (`provider_txn_id`) on manual confirm, or mark manual credits `provider='manual'` and let the webhook/reconcile match amount+content to recently manually credited top-ups and flag `manual:possible_double`; add a second-person rule on manual confirm of non-webhook top-ups (the `requested_by` rule only blocks self-confirm).

### R1-07 Delegated `admin:write` holder can mint any role's default rights (escalation guard checks overrides only)
- Evidence: `users.ts:101-107` `guardEscalation` compares only explicit `overrides`; `:166` (invite, no `permissions` sent => `useOverrides=[]`) and `:228` (role change, `guardEscalation(actor, b.role, [])`) never check the role's default grants against the actor. Only `role==='super_admin'` is blocked.
- Exploit: a non-super user granted `admin:write` (override) invites a `finance` user to an attacker-controlled email and accepts the invite, gaining `finance:approve` they never had; or promotes an existing account.
- Fix: in `guardEscalation` also require `can(actor, role-default grants)` for every default grant of the target role (or restrict role assignment to super_admin).

### R1-08 `customers:approve` gate bypass via a two-step state change
- Evidence: `customers.ts:242-248`: approval is required only for `pending_payment -> active` and `-> terminated`. `customers:write` (finance) can set `pending_payment -> suspended` then `suspended -> cooperating`, or `terminated -> cooperating`, without `customers:approve`.
- Impact: bypasses payment-gated activation and re-opens terminated customers (customer portal accounts regain access once state is not terminated, `session.ts:102`).
- Fix: validate transitions with an explicit table (like campaign-state) and require approve for any move into `active`/out of `terminated`.

### R1-09 Edge gateway reads unbounded request bodies before authentication
- Evidence: `gateway.ts:130-136` `readBody` checks `content-length` only when present, then `await c.req.arrayBuffer()` of the full body; the gateway app has no `bodyLimit` (API has one, `api/src/app.ts`). `register`/`pair`/`heartbeat` call it before `verifyEnvelope`.
- Exploit: unauthenticated chunked POSTs of hundreds of MB to `/v1/register` exhaust memory (Node; Workers cap ~100 MB).
- Fix: add `bodyLimit` middleware per route sized to `MAX_*_BYTES`, reject without `content-length` > limit.

### R1-10 Presigned upload is unbounded and reusable; large approved files can break manifest builds
- Evidence: `media.ts:243` presign binds only `Content-Type` (`runtime/s3.ts:37-41`, `r2.ts:18-24`), not length; the URL stays valid 900 s after confirm and is reusable. `confirm` reads whole objects into memory (`media.ts:279-306`); `SHA_MAX_BYTES=128 MB` leaves `sha256` NULL for larger TV files (limit 500 MB); then `manifest.ts:301-311 sha256Of` loads the entire object into the gateway while building the manifest, uncaught (`rebuild` rejects) so every heartbeat of that model group fails; on Workers (128 MB) this is an easy OOM. Rejected-on-confirm objects are not deleted.
- Impact: storage-cost abuse, swap content after sha256 is recorded (device-side hash check catches it only if it verifies), and group-wide manifest outage by one large approved file.
- Fix: presign with content-length-range (POST policy / signed `Content-Length`), single-use key, delete on reject, hash in the media worker for all sizes (streaming), and make `sha256Of` skip + alert instead of throwing.

### R1-11 Release-before-transition leaves a live campaign with no funds
- Evidence: `campaigns.ts:411` (reject), `:431` (end), `:445` (delete) call `releaseIfFunded` (wallet reserve returned, campaign `funding_state='released'`, `reserved_vnd=0`) before `transitionCampaign`; if the transition then 409s (e.g. customer `resume` or exhaustion raced), the money is released but the campaign stays `active`. `spendCampaign` then returns `exhausted:true` with no state change (`ledger.ts spendCampaign`, remaining=0 path), nothing ends it (`endDueCampaigns` is date-based only). Documented as a known gap in p0-domain.md "Rủi ro còn lại"; confirmed exploitable ordering.
- Impact: free ad serving until end date; also reject of an active campaign with in-flight spend.
- Fix: do the transition first (state `rejected/ended`), then release via outbox topic `campaign.release`; or make `release` conditional on state already being terminal.

### R1-12 Cloudflare KV `incr` is not atomic: login/MFA rate limits, TOTP replay marker, gateway rate limits [UNVERIFIED on real Workers]
- Evidence: `packages/runtime/src/cloudflare/kv.ts:19-23` read-then-put; used by `rl:login:*`, `rl:mfa:*`, `totp:used:*` (`auth/routes.ts:91-93,116-117,201`), gateway `rl:*` (`gateway.ts rateLimit`), media/outbox locks. Nonces use a Durable Object (good, `edge-gateway/worker.ts`).
- Impact: with a valid password an attacker mints new MFA challenges (5 TOTP guesses each; per-token `attempts` is in DB but token creation is limited only by the KV counter), TOTP codes are replayable across colos within ~60 s, gateway register/event limits are soft. Failed-password lockout is DB-based and fine.
- Fix: move counters to a DO (or D1 conditional updates) on Cloudflare; also add a DB-backed cap on MFA challenge creation per admin.

### R1-13 Docker defaults enable dev backdoors and known secrets
- Evidence: `docker-compose.yml:170` `GATEWAY_DEV_ENDPOINTS: ${GATEWAY_DEV_ENDPOINTS:-1}`; `gateway.ts:331-340` `/v1/dev/pair-confirm` is unauthenticated and only gated by that flag + `runtime!=='cloudflare'` (not by `SEPAY_MODE`/`NODE_ENV`). Same file `:56-58` defaults `FIELD_ENC_KEY=change-me-field-enc-key`, `SEPAY_WEBHOOK_SECRET=change-me-sepay`; `assertFinanceConfig` (`routes.ts:118`) only checks the secret is non-empty, so the default satisfies it (the weak-secret check exists only in the seed, `packages/db/src/seed-bootstrap` / `seed-guard.ts`).
- Exploit: a docker deployment started without `make setup`: anyone reaching the gateway registers a device, `POST /v1/pair`, then `/v1/dev/pair-confirm` => trust 1 => billable valid impressions and rewards; with the default HMAC secret anyone can forge SePay webhooks and credit wallets. Ports are bound to 127.0.0.1 in compose, so exposure needs a reverse proxy/tunnel (`make tunnel` is advertised for SePay).
- Fix: default the dev flag to 0; at startup refuse `CHANGE_ME*`/`change-me*`/short secrets whenever `NODE_ENV=production` or `SEPAY_MODE=production`; never mount dev endpoints when `NODE_ENV=production`.

### R1-14 Content approval is not bound to content version (TOCTOU between view and approve)
- Evidence: `media.ts:368-381` approve takes only the id; `PUT /:id/overlay` (`:346-364`) lets the owner change `overlay`/`format` of a not-yet-approved creative without any version bump (`resetReview` applies only to already approved). THREAT-MODEL §6 says "nội dung duyệt gắn phiên bản".
- Exploit: customer shows a harmless QR/hotline, then swaps it to a phishing URL right before the content manager clicks approve.
- Fix: add `content_version`/hash on creatives, send it with the approve request, and 409 if changed.

### R1-15 D1 non-atomic windows not covered by p0-domain.md
- `ledger.ts:73-85 creditTopup` claims the top-up as `credited` BEFORE crediting the wallet; on D1 (`withTx` runs without a transaction, `payments/src/util.ts:21-25`) a crash leaves `credited` with no balance and no ledger row; the retry sees `already`. `reconcileLedger` (`jobs.ts`) detects orphans only for rows with `provider IS NOT NULL` and never repairs. `applyBalance` is three statements (ensure, update, entry). `undoActivation` marker row is not unique (`activation.ts` ~146). `enqueueCommand` open-count check is not atomic (`commands.ts:68-69`, can exceed 50).
- Fix: credit via a single conditional `UPDATE ... WHERE credited_at IS NULL` plus idempotent ledger insert keyed by `ref_id` (UNIQUE `(kind,ref_type,ref_id)`), and let the reconcile job repair top-ups missing ledger rows.

### R1-16 Webhook endpoint stores every unauthenticated request (storage DoS) and the raw payload in clear
- Evidence: `routes.ts:135-161` + `webhook.ts storeRejected` insert up to 100 KB per rejected request into `payment_webhooks` with no rate limit (API body limit is 2 MB, route cap 64 KB); stores attacker-controlled `x-forwarded-for`. Accepted payloads are stored raw including `accountNumber` (`webhook.ts processIncoming` insert) although THREAT-MODEL §2 flags field encryption as "cần xác nhận".
- Fix: per-IP/global limit before DB write, aggregate counters for repeated rejects, retention/prune job, encrypt or truncate `accountNumber`/`content` at rest.

---

## LOW

- R1-17 Finance-sensitive data visible to non-finance internal roles. `dashboard.ts` overview returns `revenue_vnd`, `reward_cost_vnd`, `revenue_split` to anyone with `overview:view` (content_manager, device_ops); `partners.ts:138` list (floor CPM, eCPM, endpoint, fill rate) allowed with `schedule:view`; `customers.ts presentCustomer` returns decrypted `tax_code`, `credit_limit_vnd`, `debt_vnd` to `customers:view` (content_manager). THREAT-MODEL only promises this for external accounts; decide policy and mask.
- R1-18 SePay HMAC: `webhook.ts:67-72` accepts a signature over the bare body (`okB`), so the 5-minute timestamp check is not bound to the signature and `Authorization: Apikey` has no timestamp. Replay is neutralised only by `event_id` UNIQUE (verified). Prefer one signed format once SePay's real format is confirmed (**[UNVERIFIED]** against real SePay docs).
- R1-19 Login: `auth/routes.ts:135-138` returns `429 account_locked` before checking the password, revealing that an email exists and letting anyone lock any account (5 bad tries, 15 min); `:117` per-email bucket can be exhausted by an attacker to block the victim (12/15 min). Timing differs on the locked path (no scrypt).
- R1-20 IP trust: `api lib/http.js:38-45` prefers `cf-connecting-ip`, `x-real-ip`, XFF unless `TRUST_PROXY=0`; gateway `util.ts:32-38` and payments `actor.ts:19` ignore `TRUST_PROXY` entirely. Safe behind Caddy (overwrites, `Caddyfile client_ip`) and Cloudflare, spoofable if a port is exposed directly (register limit, audit `ip`).
- R1-21 Crypto hygiene: scrypt `N=2^15,r=8,p=1` (`shared/password.ts:6`) is below the OWASP 2^17 minimum; AES-GCM field encryption has no key id/version (`aes.ts`, "xoay vòng theo phiên bản" in THREAT-MODEL is not possible without re-encrypt), AAD is a fixed label (ciphertext can be swapped between rows), and the same `FIELD_ENC_KEY` also feeds the blind index HMAC.
- R1-22 SSRF in link import is latent only: `checkImportUrl` (`creative.ts` end) lacks 172.16/12, 100.64/10, IPv6 literals other than via `:` check, and any DNS-to-private resolution/redirect handling; `source:'url'` accepts any https host. Today nothing fetches `source_url` (verified by grep; `media-worker` skips non-upload sources), so no live SSRF. Block-list must be enforced at fetch time (resolve, pin IP, re-check redirects) when the downloader is built.
- R1-23 Partner flow: a partner with `campaigns:write` override creates campaigns (`campaigns.ts:235-259`) but no `campaign_grants` row, so the response (`loadCampaign`) returns 404 and the campaign becomes invisible orphan under the customer's name.
- R1-24 Cookies: `Secure` flag depends on `PUBLIC_ADMIN_URL` being https (`session.ts:19`); no `__Host-` prefix; MFA cookie accepted on `/auth/mfa/verify` without CSRF (low impact, login-CSRF only).
- R1-25 Refund path: approve and mark-paid are the same single `finance:approve` role (`routes.ts:411-447`); no check that payout goes to the originating account, only a free-text `voucher_ref`.
- R1-26 `POST /admin/v1/devices/bulk verify` (`devices.ts:105-110`) lets `devices:write` (device_ops) set `trust_level=2`; device_ops can therefore make fraudulent devices billable (separation-of-duties issue). Device cache can be re-populated from a stale DB read after `dropDeviceCache` (race, <=5 min).
- R1-27 Public manifest `/v1/manifest/g/:group` is unauthenticated by design (`gateway.ts:307-313`); group strings like `ALL.all.tv` are guessable, exposing campaign/creative ids, overlays (hotline/QR) and media URLs of all active ads. Malformed `%` in `:group` throws URIError => 500.
- R1-28 `enqueueCommand` has no API route yet (library only, `edge-gateway/src/commands.ts`); when an admin route is added it must require `devices:write`, validate `type` against an allow-list and not accept free `args`. Also PoP events accept arbitrary `creative_id` strings (`events.ts:268`).
- R1-29 Webhook `p.accountNumber` check is skipped when either side is missing (`webhook.ts decide`).

---

## Verified as sound (explicitly checked)

- Device command ack: `commands.ts:162-171` updates `WHERE id=? AND device_id=?` (device from the verified envelope, `auth.ts authenticateDevice`); the `known` probe is also device-scoped, so no cross-device ack and no id oracle. Heartbeat `cmd_ack` goes through the same function. Existing test covers it (`commands.test.ts:31`).
- Device protocol: Ed25519 over `METHOD\npath?query\nts\nnonce\nsha256(body)`, +-300 s skew, nonce claimed only after a valid signature, per-device scope (`auth.ts:52-61`); DO-backed nonce store on Cloudflare; register proves key ownership; new devices `trust_level=0`; impressions from trust<1 are `untrusted_device`.
- SePay webhook auth: no bypass found (secret empty => reject; constant-time compare; apikey/HMAC both need a configured secret); `event_id` UNIQUE + conditional UPDATEs; top-up claim `WHERE status IN ('pending','unmatched')`; `ON CONFLICT (provider_txn_id)`; double-credit under replay is not possible on pg/sqlite.
- RBAC/IDOR: every `/admin/v1` route has `requirePerm`; `/admin/v1/*` and `/portal/v1/*` middleware runs before `mountFinance` routes; external scope is applied in SQL (`lib/scope.ts`) for campaigns/media incl. writes and `attachMedia`; other customers' ids return 404; portal wallet/topup/refund routes take `customer_id` only from the session; `externalAllowed` hard-blocks approve/delete/finance(partner) even with overrides. Escalation: self-modify blocked, super_admin-only protections present, sessions revoked on lock/role/permission change.
- Campaign state: all transitions go through `transitionCampaign` (conditional UPDATE); approve race gives one winner (409 for the other); outbox claims with a conditional UPDATE and dedupe key.
- Spend: per-event `spend_events` claim + conditional remainder update (`spend.ts`) is correct and idempotent on pg/sqlite.
- Passwords/sessions: scrypt + constant-time compare, dummy hash on unknown email, session token SHA-256 stored, idle + absolute expiry, CSRF header (timing-safe) on all state-changing session routes, TOTP replay marker, invite token single-use/72 h, contract HTML renders with escaping + CSP.

## Not verified / out of scope

Cloudflare runtime semantics (D1 batch atomicity, DO, R2 presign), real SePay signature format and IP list, web-admin XSS/CSP and nginx config, k8s charts, MinIO policy beyond the line cited, Redis/Postgres hardening, dependency CVEs (no SBOM scan run), load/DoS behaviour.
