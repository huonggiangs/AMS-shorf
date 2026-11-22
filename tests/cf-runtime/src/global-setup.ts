// Build bundle Worker that bang `wrangler deploy --dry-run --outdir` (moi truong production, ID gia) + ap migration 0001-0015
// vao D1 cuc bo bang `wrangler d1 migrations apply --local` (cong cu that cua Cloudflare). Khong can token/mang Cloudflare.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
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
  if (!/0015_device_ops/.test(out)) throw new Error('migration 0015 khong duoc ap:\n' + out);
  process.env['CF_TEST_MIGRATIONS_OUT'] = out;
}
