// pnpm --filter @ams/api seed : nap du lieu mau tu prototype (idempotent: bo qua neu da co tenant).
// Bien: DATABASE_URL, FIELD_ENC_KEY, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD, SEED_ADMIN_TOTP_SECRET (base32, tuy chon), SEPAY_WEBHOOK_SECRET (tuy chon).
import { seed } from '@ams/db';
import { PgDb, SystemClock, createPgPool } from '@ams/runtime/pg';
import { ulid } from '@ams/shared';

const env = process.env as Record<string, string | undefined>;
if (!env['DATABASE_URL']) {
  console.error('thieu DATABASE_URL');
  process.exit(1);
}
const db = new PgDb(await createPgPool(env['DATABASE_URL']));
const clock = new SystemClock();
try {
  const r = await seed(
    { db, clock, config: { env }, id: () => ulid(clock.now().getTime()) },
    {
      ...(env['SEED_ADMIN_EMAIL'] ? { adminEmail: env['SEED_ADMIN_EMAIL'] } : {}),
      ...(env['SEED_ADMIN_PASSWORD'] ? { adminPassword: env['SEED_ADMIN_PASSWORD'] } : {}),
      ...(env['SEED_ADMIN_TOTP_SECRET'] ? { adminTotpSecret: env['SEED_ADMIN_TOTP_SECRET'] } : {}),
    },
  );
  if (!r.skipped) console.log('[seed] so ban ghi:', JSON.stringify(r.counts));
} finally {
  await db.close();
}
