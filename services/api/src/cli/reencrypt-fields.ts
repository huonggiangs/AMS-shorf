// pnpm --filter @ams/api reencrypt-fields [--dry-run] [--batch=200]
// Ma hoa lai moi truong AES-GCM sang khoa ghi hien tai (FIELD_ENC_KEYS / FIELD_ENC_KEY_ID). Xem docs/ops/KEY-ROTATION.md.
// Bien: DATABASE_URL (Postgres), FIELD_ENC_KEY / FIELD_ENC_KEYS / FIELD_ENC_KEY_ID / FIELD_INDEX_KEY. Chay lai duoc; thoat 0 khi het ban ghi cu, 2 neu con ban ghi loi.
// Cloudflare D1: dung POST /admin/v1/ops/reencrypt-fields (super_admin), goi lap lai den khi pending = 0.
import { PgDb, SystemClock, createPgPool } from '@ams/runtime/pg';
import type { Runtime } from '@ams/runtime';
import { reencryptFields } from '../lib/reencrypt.js';

const dry = process.argv.includes('--dry-run');
const batch = Number((process.argv.find((a) => a.startsWith('--batch=')) ?? '--batch=200').split('=')[1]);
const url = process.env['DATABASE_URL'];
if (!url) { console.error('thieu DATABASE_URL'); process.exit(1); }
const db = new PgDb(await createPgPool(url));
// chi can db + config.env cho viec ma hoa lai
const rt = { db, clock: new SystemClock(), config: { env: process.env as Record<string, string | undefined>, runtime: 'docker' } } as unknown as Runtime;
let rounds = 0;
let last;
do {
  last = await reencryptFields(rt, { limit: batch, dryRun: dry });
  rounds++;
  console.log(`[reencrypt] vong ${rounds}: khoa ghi=${last.primaryId} doi=${last.updated} loi=${last.failed} con=${last.pending}${dry ? ' (dry-run)' : ''}`);
} while (!dry && last.pending > 0 && last.updated > 0 && rounds < 10_000);
for (const c of last.counts) console.log(`  ${c.target}: quet ${c.scanned}, doi ${c.updated}, loi ${c.failed}`);
await db.close();
if (last.failed > 0 || (!dry && last.pending > 0)) {
  console.error('[reencrypt] con ban ghi chua doi khoa (loi giai ma: kiem tra khoa cu da nap trong FIELD_ENC_KEYS chua). KHONG go khoa cu.');
  process.exit(2);
}
console.log(dry ? '[reencrypt] dry-run xong.' : '[reencrypt] xong: co the go khoa cu.');
process.exit(0);
