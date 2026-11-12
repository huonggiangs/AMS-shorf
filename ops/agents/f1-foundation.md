STATUS: done
UPDATED: 06:52 UTC

CORE-READY (giu nguyen tu truoc)

Xong: monorepo goc + stub; packages/db (migrations, migrate, seed tu prototype, clickhouse DDL); packages/shared; packages/config (rbac); packages/runtime (test/docker/cloudflare).
Kiem chung: pnpm -r typecheck sach (10 goi); pnpm --filter "./packages/*" test: config 8, shared 38, db 4, runtime 34 (contract x2 dialect, seed x2, sigv4==aws-sdk, redis that) deu xanh.
Gioi han/ghi chu:
- customers: tax_code_enc + tax_code_hash (thay tax_code) vi PLAN yeu cau ma hoa MST.
- ad_wallets co balance_vnd/reserved_vnd/spent_vnd + CHECK(reserved<=balance); wallet_entries them reserved_after.
- D1: tx() KHONG hoan tac (interactiveTx=false); dung Db.batch() hoac UPDATE co dieu kien. Khong tach D1 theo mien core/finance/audit vi schema co khoa ngoai cheo mien.
- ClickHouse DDL giu nguyen van (ReplicatedMergeTree); f2 doi sang MergeTree khi nap local.
- audit-log GET = admin:view (chi super_admin).
- Seed: SEED_ADMIN_EMAIL/PASSWORD/TOTP_SECRET qua services/api scripts migrate/seed (src/cli/*.ts); van tao them tai khoan mau cac vai tro khac.
