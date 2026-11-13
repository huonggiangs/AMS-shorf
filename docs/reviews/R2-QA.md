# R2 QA gate (independent, read-only on product code)

Date: 2026-11-13 UTC. Reviewer: r2-qa. Machine was loaded by t3-load-slo (load avg ~3). No product code was changed; no tests/qa additions were needed.
Test runs used `pnpm -r --no-bail test -- --no-file-parallelism --hookTimeout 180000`; failures were re-run once in isolation.

## 1. Commands and real results

| # | Command | Result |
|---|---|---|
| 1 | `pnpm install --frozen-lockfile` | PASS (lockfile up to date, 0.7 s) |
| 2 | `pnpm typecheck` (root, `pnpm -r typecheck`) | PASS rc=0, 62 s, every package incl. tests/*, tools/* |
| 3 | `pnpm test` (all packages), first run | FAIL rc=1: 2 packages red (media-worker 1 test, flaky timeout), see below |
| 3a | per package (first run) | config 8/8; shared 51/51; db 4/4; runtime 34/34; sdk-ts 7/7; openapi 6/6; web-admin 59/59; api 222/222; payments 141/141; edge-gateway 55/55; ingest-consumer 13/13; sim 10/10; media-worker 9/10 (1 fail); contract 38/39 (1 fail); chaos 92/92 |
| 3b | media-worker rerun in isolation | PASS 10/10 (the failing test hit vitest's 5000 ms default while ffmpeg transcoded under load; passed in 2.9 s) |
| 4a | `pnpm test:contract` (rerun) | FAIL again, deterministic: 38 pass / 1 fail (not flaky) |
| 4b | `pnpm test:chaos` (sqlite) | PASS 3 files, 92/92 |
| 5 | `pnpm e2e:smoke` | PASS 35 PASS / 0 FAIL / 0 SKIP (21 s), incl. S30-S34 P0 scenarios |
| 6a | `pnpm e2e:ui` (Playwright, real PG16 + Redis) | PASS 11/11 |
| 6b | `E2E_UI_SKIP_BUILD=1 pnpm --filter @ams/e2e-ui invite` | PASS invite -> activate -> TOTP -> login |
| 7a | `pnpm --filter @ams/openapi check` | PASS "OpenAPI khop voi route/zod that" |
| 7b | `pnpm --filter @ams/sdk-ts check` | PASS "SDK khop voi OpenAPI" |
| 8 | `pnpm --filter @ams/web-admin build` | PASS (2.5 s, index chunk 342 kB). Bundle scan: no private keys, tokens or real credentials. Hits are only UI strings/schemas ("secret", "apikey" field names, `__SECRET_INTERNALS` from React), placeholder text ("so tai khoan mau 0123456789", "Nguyen Van A", "@congty.vn"). API base is `/api` (relative); no localhost/dev URLs baked in. No seed/demo data in bundle. |
| 9 | `docker compose -f infra/docker/docker-compose.yml config -q` | PASS rc=0 (syntax valid). NOT RUN: `docker compose up` (client 29.9.3 installed, but no daemon socket in this sandbox). Rendered config still has `change-me*` default secrets, which the `env-guard` service refuses outside AMS_ENV=local (read in compose lines 214-243, not executed). |

## 2. Failures

1. `tests/contract/test/tv-client.test.ts:154` "KNOWN GAP: manifest giu kid_safe/contexts/duration_s/safe_area" -> `Error: Expect test to fail`. It is an `it.fails` that now PASSES, i.e. the gap was fixed by a1/a4 and the test comment says to turn it into `it()`. Stale test, not a product bug. Owner: t2-contract-chaos. `pnpm test:contract` stays red until it is flipped.
2. `services/media-worker/test/worker.test.ts:152` ffmpeg transcode test, `Test timed out in 5000ms`, only under load; passes alone. Owner: m1-media-worker (raise per-test timeout to e.g. 30 s). Not a defect.
3. Observed in x1 log, not reproduced here: edge-gateway commands.test pglite hook timeout under load; passed in this run (55/55).

## 3. Spot-checks of earlier claims (read code/tests; all hold unless noted)

- R1-01 OK: `users.ts:182` invite inserts `mfa_required = 1` for every role; `api/test/security-x1.test.ts` asserts it for finance and all internal roles, and that login without TOTP yields only a challenge.
- R1-03 OK (gateway side): `manifest.ts:391` serves only `scan_state='clean'` unless `settings.allow_unscanned_creatives`; rendition preferred, `MANIFEST_REQUIRE_RENDITION=1` option. Remaining (x1 says NOT FIXED / out of its scope): nothing enqueues the media scan topic, NoScanner default, bucket anonymous-download, approve does not require clean. So "clean" only happens if the sweep runs a real scanner; with NoScanner creatives may never become servable, or scan may be a no-op. Needs an owner decision before staging.
- R1-04 OK: `events.ts:93` `kv.incr` per event; test 20 parallel batches x 50 -> valid == 120. Caveat: Cloudflare KV `incr` is not atomic (R1-12 still NOT FIXED), so on Workers this control is not proven.
- R1-07 OK: `guardEscalation` now called at invite (`users.ts:175`), role change (`:260`), overrides (`:323`).
- R1-09 OK: stream reader with 413 (`gateway.ts:147`), chunked 5 MB test in gateway security-x1.
- R1-13 OK: compose defaults `GATEWAY_DEV_ENDPOINTS` to 0 (lines 172/227), `.env.example:63` = 0, gateway mounts `/v1/dev/*` only when AMS_ENV local/test (`gateway.ts:368`), and rejects `change-me*` outside local (`:119`).
- P0 state machine: independent grep of `UPDATE campaigns SET` in non-test source found no write to `state =` outside `packages/shared/src/campaign-state.ts` (other updates touch only funding_state/reserved/spent/remainder or guard `state IN (editable)`). Scan test exists (`campaign-state.test.ts:109`), 8x8 invalid pair test + race tests pass; e2e S31 passes.
- P0 outbox convergence: outbox.test.ts covers power loss at each write boundary, idempotent re-run, lease expiry, dead-letter; reconcileApprovals test; e2e S30/S32 pass.
- P0 device_commands ack scoping: `ackCommands` UPDATE has `WHERE id = ? AND device_id = ?`; foreign id returns `unknown` (test commands.test.ts:31); e2e S33 pass.
- P0 spend crash: payments-chaos (webhook crash, consumer crash before k-th write, redelivery) and events-chaos pass on sqlite (92/92); e2e S34 (replay + cleared Redis done-marks) passes. Postgres chaos was not run separately (only e2e UI used real PG).
- Known unfixed from x1 log (still open, none re-tested): R1-02, 05, 06, 10, 11, 12, 14, 15, 16, 19, 20, 21, 24.

## 4. Verdicts

- Local Docker run: GO with conditions. All pnpm gates, both e2e suites, drift checks and the web build pass on a real PG16 + Redis stack. Compose file validates but was not brought up here (no Docker daemon); first `make setup` + `make up` on a real host is still unverified. Flip the stale contract test.
- Cloudflare staging: NO-GO until (a) R1-12 (KV `incr` non-atomic: login/MFA rate limits, TOTP replay, R1-04 cap) is resolved via Durable Object or accepted in writing, (b) R1-02 / R1-05 / R1-06 payments items are fixed or explicitly accepted, (c) media scan path is decided (R1-03 remainder), (d) D1/Workers path is exercised for real: only the in-memory/sqlite emulation of D1 was tested, never wrangler dev/staging.
