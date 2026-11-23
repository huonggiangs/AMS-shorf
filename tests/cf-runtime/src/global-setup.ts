// Build bundle Worker that bang `wrangler deploy --dry-run --outdir` (moi truong production, ID gia) + ap migration 0001-0015
// vao D1 cuc bo bang `wrangler d1 migrations apply --local` (cong cu that cua Cloudflare). Khong can token/mang Cloudflare.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const PERSIST = join(ROOT, '.wrangler/cf-runtime-state');

function sh(cmd: string, args: string[], cwd = ROOT): string {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' } });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} -> ${r.status}\n${r.stdout}\n${r.stderr}`);
  return r.stdout + r.stderr;
}

export default function setup(): void {
  // 1. bundle + cau hinh sinh ra (cung duong voi deploy that, co cron/route/DO/queue)
  sh('node', ['scripts/deploy-cloudflare.mjs', '--env', 'production', '--fake-ids', '--dry-run', '--only', 'gateway,api', '--skip-build', '--yes']);
  for (const w of ['api', 'edge-gateway']) if (!existsSync(join(ROOT, '.wrangler/dry', w, 'worker.js'))) throw new Error(`thieu bundle ${w}`);
  // 2. D1 sach + migration that
  rmSync(PERSIST, { recursive: true, force: true });
  mkdirSync(PERSIST, { recursive: true });
  const out = sh('npx', ['wrangler', 'd1', 'migrations', 'apply', 'DB_CORE', '--local', '--persist-to', PERSIST, '-c', 'infra/cloudflare/api/wrangler.generated.toml', '--env', 'production']);
  // TAT CA migration trong packages/db/migrations (bo .postgres.sql) phai duoc ap: lay danh sach tu thu muc nguon
  const all = readdirSync(join(ROOT, 'packages/db/migrations')).filter((f) => f.endsWith('.sql') && !f.includes('.postgres.')).map((f) => f.replace('.sqlite', '').replace(/\.sql$/, ''));
  const miss = all.filter((n) => !out.includes(n));
  if (miss.length) throw new Error('migration khong duoc ap: ' + miss.join(', ') + '\n' + out);
  process.env['CF_TEST_MIGRATIONS_OUT'] = out.slice(-4000); // gioi han: 1 bien moi truong > 128 KB lam fork worker loi E2BIG
}
