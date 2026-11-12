// Rao chan an toan cho seed/bootstrap: phan biet moi truong, chan seed demo o production/staging,
// chan SEPAY production di kem bi mat mock. Khong phu thuoc runtime nao (chi doc bien moi truong).
export type AmsEnv = 'local' | 'test' | 'staging' | 'production';
type Env = Record<string, string | undefined>;

export class SeedRefusedError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'SeedRefusedError';
  }
}

const ALIASES: Record<string, AmsEnv> = {
  local: 'local', dev: 'local', development: 'local', test: 'test', staging: 'staging', stg: 'staging', production: 'production', prod: 'production',
};

/**
 * AMS_ENV quyet dinh moi truong. Khong dat: coi la 'local' neu RUNTIME la docker/test/chua dat,
 * nhung la 'production' (an toan truoc) neu RUNTIME la cloudflare/k8s. NODE_ENV KHONG dung (compose local dat NODE_ENV=production).
 */
export function resolveAmsEnv(env: Env): AmsEnv {
  const raw = (env['AMS_ENV'] ?? '').trim().toLowerCase();
  if (raw) {
    const v = ALIASES[raw];
    if (!v) throw new SeedRefusedError('bad_ams_env', `AMS_ENV="${env['AMS_ENV']}" khong hop le (local|test|staging|production).`);
    return v;
  }
  const rt = (env['RUNTIME'] ?? '').trim().toLowerCase();
  if (rt === 'cloudflare' || rt === 'k8s') return 'production';
  return rt === 'test' ? 'test' : 'local';
}

export const isLocalEnv = (e: AmsEnv) => e === 'local' || e === 'test';

/** Seed demo chi duoc o local/test; staging/production can AMS_ALLOW_DEMO_SEED=1 ro rang. */
export function assertDemoSeedAllowed(env: Env): AmsEnv {
  const e = resolveAmsEnv(env);
  if (!isLocalEnv(e) && env['AMS_ALLOW_DEMO_SEED'] !== '1') {
    throw new SeedRefusedError(
      'demo_seed_refused',
      `Tu choi nap du lieu demo o AMS_ENV=${e}. Dung "bootstrap" (chi tao Super admin + cau hinh toi thieu). ` +
        'Chi khi that su can (vd. staging dung cho demo khach) moi dat AMS_ALLOW_DEMO_SEED=1.',
    );
  }
  return e;
}

const WEAK_SECRET = /^(test|mock|change[-_ ]?me|secret|example|dummy|placeholder|password|sepay)/i;
export const isWeakSecret = (s: string | undefined) => !s || s.length < 32 || WEAK_SECRET.test(s) || /CHANGE_ME/i.test(s);

export type SepayMode = 'mock' | 'sandbox' | 'production';

/** SEPAY_MODE mac dinh mock (local). Production: khong duoc mock; che do production phai co bi mat that. */
export function assertSepaySafe(env: Env): SepayMode {
  const e = resolveAmsEnv(env);
  const mode = (env['SEPAY_MODE'] ?? 'mock').trim().toLowerCase();
  if (mode !== 'mock' && mode !== 'sandbox' && mode !== 'production') throw new SeedRefusedError('bad_sepay_mode', `SEPAY_MODE="${env['SEPAY_MODE']}" khong hop le (mock|sandbox|production).`);
  if (e === 'production' && mode === 'mock') {
    throw new SeedRefusedError('sepay_mock_in_production', 'AMS_ENV=production khong duoc dung SEPAY_MODE=mock (endpoint mo phong giao dich). Dat sandbox hoac production.');
  }
  if (mode === 'production') {
    if (isWeakSecret(env['SEPAY_WEBHOOK_SECRET'])) {
      throw new SeedRefusedError('sepay_secret_weak', 'SEPAY_MODE=production can SEPAY_WEBHOOK_SECRET that (>= 32 ky tu, khong phai gia tri mau/mock/CHANGE_ME).');
    }
    const key = env['SEPAY_API_KEY'];
    if (key && isWeakSecret(key)) throw new SeedRefusedError('sepay_apikey_weak', 'SEPAY_MODE=production nhung SEPAY_API_KEY la gia tri mau/yeu.');
  }
  return mode;
}

/** FIELD_ENC_KEY: dung 32 byte base64; o staging/production khong duoc la khoa test. */
export function assertEncKey(env: Env, testKey = 'dGVzdC1rZXktdGVzdC1rZXktdGVzdC1rZXktMTIzNDU='): void {
  const k = env['FIELD_ENC_KEY'];
  if (!k) throw new SeedRefusedError('enc_key_missing', 'Thieu FIELD_ENC_KEY (32 byte, base64).');
  let len = -1;
  try { len = atob(k).length; } catch { /* sai base64 */ }
  if (len !== 32) throw new SeedRefusedError('enc_key_invalid', `FIELD_ENC_KEY phai la 32 byte base64 (hien ${len} byte).`);
  if (!isLocalEnv(resolveAmsEnv(env)) && (k === testKey || /CHANGE_ME/i.test(k))) throw new SeedRefusedError('enc_key_test', 'FIELD_ENC_KEY la khoa mau/test, khong duoc dung o staging/production.');
}
