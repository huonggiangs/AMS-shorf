STATUS: running
UPDATED: 04:22 UTC

CORE-READY

Da san sang (da chay that, xem tieng Viet duoi):
- Monorepo goc: package.json, pnpm-workspace.yaml, tsconfig.base.json, .gitignore, .npmrc; stub @ams/api, @ams/edge-gateway, @ams/ingest-consumer, @ams/payments, @ams/sim; pnpm install da chay.
- packages/db: migrations/0001_init.sql (toan bo schema 5.1 + sessions/invites/mfa/settings/refund_requests/notifications/pairing_codes + ev_* + impression_hourly), 0002_append_only.{postgres,sqlite}.sql (trigger chan UPDATE/DELETE audit_log, wallet_entries, wallet_ledger), clickhouse/*.sql, migrate(db).
- packages/runtime: interface PLAN §3 + createTestRuntime() (pglite hoac dialect:'sqlite' = node:sqlite), createDockerRuntime(env), createCloudflareRuntime(env) tu '@ams/runtime/cloudflare'. Test hop dong chay tren ca hai dialect.
- packages/shared, packages/config (rbac): xong, co test.
- Dang lam tiep: seed(rt) tu prototype, test bo sung (redis that, sigv4).

CACH DUNG:
  import { createTestRuntime, type Runtime } from '@ams/runtime';
  const rt = await createTestRuntime();            // pglite + migration da chay; rt.close() khi xong
  const rt = await createTestRuntime({ dialect: 'sqlite' });
  rt.clock.set('2026-11-12T00:00:00Z'); rt.mail.outbox; rt.queue.drain(); rt.kv; rt.objects
  import { can } from '@ams/config';   import { hashPassword, ... } from '@ams/shared';
