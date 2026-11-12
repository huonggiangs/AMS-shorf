// pnpm --filter @ams/api seed [bootstrap|demo]
//   bootstrap : san xuat toi thieu = tenant + cai dat mac dinh + Super admin dau tien (doi mat khau bat buoc, dang ky TOTP khi dang nhap lan dau).
//               Khong co khach hang/chien dich/thiet bi/tien mau. An toan cho production/staging.
//   demo      : du lieu mau tu prototype. Tu choi khi AMS_ENV=production|staging tru khi AMS_ALLOW_DEMO_SEED=1.
//   (khong tham so) : SEED_MODE, neu khong dat thi local/test -> demo, con lai -> bootstrap.
// Bien chung: DATABASE_URL, FIELD_ENC_KEY, AMS_ENV, SEPAY_MODE (mac dinh mock; production tu choi mock), SEPAY_WEBHOOK_SECRET.
// Bootstrap: BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD | BOOTSTRAP_ADMIN_PASSWORD_FILE | nhap an khi duoc hoi (TTY); BOOTSTRAP_TENANT_NAME, BOOTSTRAP_TENANT_TAX_CODE.
//   Chi local moi duoc doc SEED_ADMIN_* (tuong thich compose) va tu sinh mat khau.
// Demo: SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD, SEED_ADMIN_TOTP_SECRET (tuy chon).
// Mat khau chi ghi ra tep local (AMS_LOCAL_CREDS_FILE, mac dinh .env.local-credentials, 0600) va CHI o local/test; production khong bao gio in/log bi mat.
import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { bootstrap, isLocalEnv, resolveAmsEnv, seedDemo, SeedRefusedError } from '@ams/db';
import type { SeedCredential } from '@ams/db';
import { PgDb, SystemClock, createPgPool } from '@ams/runtime/pg';
import { ulid } from '@ams/shared';

const env = process.env as Record<string, string | undefined>;

export async function promptHidden(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const w = (rl as unknown as { _writeToOutput: (s: string) => void });
  w._writeToOutput = (s: string) => { if (s.includes(question)) process.stdout.write(s); };
  const answer = await new Promise<string>((res) => rl.question(question, res));
  rl.close();
  process.stdout.write('\n');
  return answer;
}

async function resolveBootstrapPassword(local: boolean): Promise<string | undefined> {
  const file = env['BOOTSTRAP_ADMIN_PASSWORD_FILE'];
  if (file) return readFileSync(file, 'utf8').trim();
  if (env['BOOTSTRAP_ADMIN_PASSWORD']) return env['BOOTSTRAP_ADMIN_PASSWORD'];
  if (local && env['SEED_ADMIN_PASSWORD']) return env['SEED_ADMIN_PASSWORD'];
  if (process.stdin.isTTY && process.stdout.isTTY) {
    const a = await promptHidden('Mat khau Super admin (>= 12 ky tu, co hoa/thuong/so): ');
    const b = await promptHidden('Nhap lai: ');
    if (a !== b) throw new SeedRefusedError('admin_password_mismatch', 'Hai lan nhap mat khau khong khop.');
    return a;
  }
  return undefined; // local: se tu sinh; production: bootstrap() tu choi
}

function writeLocalCreds(lines: string[]): string {
  const path = env['AMS_LOCAL_CREDS_FILE'] || '.env.local-credentials';
  writeFileSync(path, lines.join('\n') + '\n', { mode: 0o600 });
  try { chmodSync(path, 0o600); } catch { /* Windows */ }
  return path;
}

async function main(): Promise<void> {
  if (!env['DATABASE_URL']) throw new SeedRefusedError('no_database_url', 'thieu DATABASE_URL');
  const amsEnv = resolveAmsEnv(env);
  const local = isLocalEnv(amsEnv);
  const arg = process.argv[2];
  const mode = (arg === 'bootstrap' || arg === 'demo' ? arg : env['SEED_MODE'] || (local ? 'demo' : 'bootstrap')).toLowerCase();
  if (mode !== 'bootstrap' && mode !== 'demo') throw new SeedRefusedError('bad_mode', `che do seed "${mode}" khong hop le (bootstrap|demo)`);

  const db = new PgDb(await createPgPool(env['DATABASE_URL']));
  const clock = new SystemClock();
  const rt = { db, clock, config: { env }, id: () => ulid(clock.now().getTime()) };
  try {
    if (mode === 'bootstrap') {
      const email = env['BOOTSTRAP_ADMIN_EMAIL'] ?? (local ? env['SEED_ADMIN_EMAIL'] : undefined);
      const password = await resolveBootstrapPassword(local);
      const r = await bootstrap(rt, { ...(email ? { adminEmail: email } : {}), ...(password ? { adminPassword: password } : {}) });
      if (r.skipped) {
        console.log('[bootstrap] CSDL da co du lieu (tenants), bo qua.');
        return;
      }
      console.log(`[bootstrap] AMS_ENV=${r.env}: da tao tenant + cai dat mac dinh + Super admin ${r.adminEmail}. Khong co du lieu demo.`);
      console.log('[bootstrap] Dang nhap lan dau: bat buoc doi mat khau va dang ky TOTP (xac thuc hai buoc).');
      if (r.generatedPassword) {
        const path = writeLocalCreds([`# AMS local bootstrap (chi dung dev, KHONG commit)`, `email=${r.adminEmail}`, `password=${r.generatedPassword}`, 'totp=dang ky khi dang nhap lan dau']);
        console.log(`[bootstrap] Mat khau tam duoc ghi MOT LAN vao tep local: ${path} (khong in ra log).`);
      }
    } else {
      const adminTotp = env['SEED_ADMIN_TOTP_SECRET'];
      const r = await seedDemo(rt, {
        ...(env['SEED_ADMIN_EMAIL'] ? { adminEmail: env['SEED_ADMIN_EMAIL'] } : {}),
        ...(env['SEED_ADMIN_PASSWORD'] ? { adminPassword: env['SEED_ADMIN_PASSWORD'] } : {}),
        ...(adminTotp ? { adminTotpSecret: adminTotp } : {}),
      });
      if (r.skipped) return;
      console.log('[seed] so ban ghi:', JSON.stringify(r.counts));
      if (local) {
        const rows = r.credentials.map((c: SeedCredential) => `${c.role}\t${c.email}\t${c.password ?? '(moi)'}\t${c.totpSecret ?? ''}`);
        const path = writeLocalCreds(['# AMS DEMO (chi dung dev, KHONG commit): vai tro, email, mat khau, TOTP', ...rows]);
        console.log(`[seed] Tai khoan demo ghi vao tep local: ${path} (khong in ra log).`);
      }
    }
  } finally {
    await db.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')) {
  main().catch((e) => {
    console.error(e instanceof SeedRefusedError ? `[seed] TU CHOI (${e.code}): ${e.message}` : e);
    process.exit(e instanceof SeedRefusedError ? 3 : 1);
  });
}
