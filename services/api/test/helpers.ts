import { seed } from '@ams/db';
import type { SeedResult } from '@ams/db';
import { createTestRuntime } from '@ams/runtime';
import type { TestRuntime } from '@ams/runtime';
import { totp } from '@ams/shared';
import { createApp } from '../src/app.js';
import type { AppOptions } from '../src/app.js';

export const NOW = '2026-11-12T03:00:00.000Z';

export interface Env {
  rt: TestRuntime;
  app: ReturnType<typeof createApp>;
  seed: SeedResult;
  cred: (email: string) => { password: string; totpSecret: string; role: string };
  byRole: (role: string, nth?: number) => string;
}

export async function setup(opts: AppOptions = {}, dialect: 'postgres' | 'sqlite' = 'postgres'): Promise<Env> {
  const rt = await createTestRuntime({ now: NOW, dialect, env: { SCRYPT_N: '1024' } });
  const s = await seed(rt, { log: false, passwordParams: { N: 1024 }, deviceCount: 20 });
  // du lieu seed demo co scan_state='skipped' (chua quet): cho phep duyet trong test, giong cau hinh demo (xem routes/creatives-scan.ts)
  await rt.db.run("INSERT INTO settings (key, value, updated_by, updated_at) VALUES ('allow_unscanned_creatives', '1', NULL, ?)", [NOW]);
  const app = createApp(rt, opts);
  const creds = new Map(s.credentials.map((c) => [c.email, c]));
  return {
    rt,
    app,
    seed: s,
    cred: (email) => {
      const c = creds.get(email);
      if (!c || !c.password || !c.totpSecret) throw new Error(`khong co tai khoan ${email}`);
      return { password: c.password, totpSecret: c.totpSecret, role: c.role };
    },
    byRole: (role, nth = 0) => {
      const l = s.credentials.filter((c) => c.role === role && c.status === 'active');
      const e = l[nth]?.email;
      if (!e) throw new Error(`khong co vai tro ${role} #${nth}`);
      return e;
    },
  };
}

export interface Session {
  cookie: string;
  csrf: string;
  req: (method: string, path: string, body?: unknown, extra?: { csrf?: string | null; headers?: Record<string, string> }) => Promise<Response>;
  json: <T = any>(method: string, path: string, body?: unknown) => Promise<{ status: number; body: T }>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const cookiesOf = (res: Response): string[] => res.headers.getSetCookie().map((c) => c.split(';')[0]!);

/** Dang nhap + TOTP; tien dong ho 31 giay truoc moi lan de ma TOTP moi (chong replay). */
export async function login(env: Env, email: string): Promise<Session> {
  const { password, totpSecret } = env.cred(email);
  env.rt.clock.advance(31_000);
  const r1 = await env.app.request('/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const b1 = (await r1.json()) as { mfa_required: boolean; mfa_token?: string; csrf_token?: string };
  let jar = cookiesOf(r1);
  let csrf = b1.csrf_token ?? '';
  if (b1.mfa_required) {
    const code = await totp(totpSecret, env.rt.clock.now().getTime());
    const r2 = await env.app.request('/auth/mfa/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mfa_token: b1.mfa_token, code }) });
    if (r2.status !== 200) throw new Error(`mfa that bai ${r2.status} ${await r2.text()}`);
    jar = [...jar, ...cookiesOf(r2)];
    csrf = ((await r2.json()) as { csrf_token: string }).csrf_token;
  }
  const cookie = jar.filter((c) => !/=$/.test(c)).join('; ');
  const req: Session['req'] = (method, path, body, extra) => {
    const headers: Record<string, string> = { cookie, ...(extra?.headers ?? {}) };
    if (extra?.csrf !== null && method !== 'GET') headers['x-csrf-token'] = extra?.csrf ?? csrf;
    let init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      init = { ...init, body: JSON.stringify(body) };
    }
    return Promise.resolve(env.app.request(path, init));
  };
  return {
    cookie,
    csrf,
    req,
    json: async (method, path, body) => {
      const res = await req(method, path, body);
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    },
  };
}
