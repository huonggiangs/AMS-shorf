STATUS: done
UPDATED: 2026-11-12 07:20 UTC

# a1-api-core

Hoàn thành: services/api (Hono) gồm createApp(rt, opts), node.ts, worker.ts, finance-mount.ts, ports.ts; auth (scrypt, TOTP, session cookie, CSRF, invite, rate limit/khóa tạm), RBAC (requirePerm), audit mọi thao tác ghi, routes /admin/v1 và /portal/v1.

Kiểm chứng: `pnpm --filter @ams/api typecheck` sạch; `pnpm --filter @ams/api test` = 4 file, 74 test đạt (pglite + node:sqlite + ghép a2 thật).

Chưa làm / giới hạn: xem báo cáo cuối và ops/agents/a1-api-core.requests.md.
