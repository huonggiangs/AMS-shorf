import type { Db, Runtime } from '@ams/runtime';
import { decryptField, encryptField } from '@ams/shared';
import { iso } from './util.js';

export const BANKS = ['Vietcombank', 'VietinBank', 'BIDV', 'Agribank', 'MBBank', 'Techcombank', 'ACB', 'VPBank', 'TPBank', 'Sacombank', 'HDBank', 'OCB', 'MSB', 'SHB', 'VIB', 'SeABank'] as const;
export const SAMPLE_ACCOUNT = '0123456789'; // SO MAU, khong phai tai khoan that
export const DEFAULT_MIN_TOPUP_VND = 5_000_000;
export const DEFAULT_DAILY_LIMIT_VND = 2_000_000_000;
/** Yeu cau nap pending qua han nay thi khong con dung de doi chieu so tien */
export const PENDING_TOPUP_TTL_MS = 72 * 3600_000;

export type SepayMode = 'mock' | 'sandbox' | 'production';

export interface SepayConfig {
  enabled: boolean;
  bank: string | null;
  account_number: string | null;
  account_holder: string | null;
  prefix: string;
  min_amount_vnd: number;
  auto_activate: boolean;
  daily_limit_vnd: number;
  webhook_url: string;
  auth_mode: 'hmac' | 'apikey';
}

/** Che do SePay. Khong dat = production (an toan: khong mo endpoint mo phong). Gia tri la -> loi khi khoi dong. */
export function sepayMode(rt: Runtime): SepayMode {
  const m = (rt.config.env['SEPAY_MODE'] ?? 'production').toLowerCase();
  if (m !== 'mock' && m !== 'sandbox' && m !== 'production') throw new Error(`SEPAY_MODE khong hop le: ${m} (mock|sandbox|production)`);
  return m;
}

/** /dev/sepay/simulate chi khi RUNTIME=docker va SEPAY_MODE != production. */
export function devSimulateAllowed(rt: Runtime): boolean {
  return rt.config.runtime === 'docker' && sepayMode(rt) !== 'production';
}

interface StoredSepay {
  enabled?: number | boolean;
  env?: string;
  auth?: string;
  webhook_url?: string;
  bank?: string;
  account_no_enc?: string;
  account_holder?: string;
  prefix?: string;
  min_amount_vnd?: number;
  auto_activate?: number | boolean;
  daily_limit_vnd?: number;
  secret_enc?: string;
  apikey_enc?: string;
}

export async function loadStored(db: Db): Promise<StoredSepay> {
  const r = (await db.query<{ value: string }>("SELECT value FROM settings WHERE key = 'sepay'"))[0];
  if (!r) return {};
  try {
    return JSON.parse(r.value) as StoredSepay;
  } catch {
    return {};
  }
}

function fieldKey(rt: Runtime): string | null {
  return rt.config.env['FIELD_ENC_KEY'] ?? null;
}

export async function loadSepayConfig(rt: Runtime, db: Db = rt.db): Promise<SepayConfig> {
  const s = await loadStored(db);
  const key = fieldKey(rt);
  let acct: string | null = null;
  if (s.account_no_enc && key) {
    try {
      acct = await decryptField(key, s.account_no_enc, 'settings.sepay.account_no');
    } catch {
      acct = null;
    }
  }
  const env = rt.config.env;
  return {
    enabled: s.enabled === undefined ? true : !!Number(s.enabled),
    bank: s.bank ?? null,
    account_number: acct,
    account_holder: s.account_holder ?? null,
    prefix: (s.prefix ?? 'AMS').toUpperCase(),
    min_amount_vnd: Number(s.min_amount_vnd ?? DEFAULT_MIN_TOPUP_VND),
    auto_activate: s.auto_activate === undefined ? true : !!Number(s.auto_activate),
    daily_limit_vnd: Number(s.daily_limit_vnd ?? DEFAULT_DAILY_LIMIT_VND),
    webhook_url: env['SEPAY_WEBHOOK_URL'] ?? s.webhook_url ?? '',
    auth_mode: (s.auth ?? '').toLowerCase().includes('api') ? 'apikey' : 'hmac',
  };
}

/** Bi mat tu cau hinh (bien moi truong uu tien; neu khong thi gia tri ma hoa trong settings). Khong bao gio hardcode. */
export async function loadSecrets(rt: Runtime, db: Db = rt.db): Promise<{ hmacSecret: string | null; apiKey: string | null }> {
  const env = rt.config.env;
  let hmacSecret = env['SEPAY_WEBHOOK_SECRET'] || null;
  let apiKey = env['SEPAY_API_KEY'] || null;
  if (!hmacSecret || !apiKey) {
    const s = await loadStored(db);
    const key = fieldKey(rt);
    if (key) {
      try {
        if (!hmacSecret && s.secret_enc) hmacSecret = await decryptField(key, s.secret_enc, 'settings.sepay.secret');
        if (!apiKey && s.apikey_enc) apiKey = await decryptField(key, s.apikey_enc, 'settings.sepay.apikey');
      } catch {
        /* khoa sai: coi nhu khong co bi mat */
      }
    }
  }
  return { hmacSecret, apiKey };
}

export interface SepayUpdate {
  enabled?: boolean;
  bank?: string;
  account_number?: string;
  account_holder?: string;
  prefix?: string;
  min_amount_vnd?: number;
  auto_activate?: boolean;
  daily_limit_vnd?: number;
}

export async function saveSepayConfig(rt: Runtime, db: Db, u: SepayUpdate, actor: string | null): Promise<void> {
  const cur = await loadStored(db);
  const key = fieldKey(rt);
  const next: StoredSepay = { ...cur };
  if (u.enabled !== undefined) next.enabled = u.enabled ? 1 : 0;
  if (u.bank !== undefined) next.bank = u.bank;
  if (u.account_number !== undefined) {
    if (!key) throw new Error('Thiếu FIELD_ENC_KEY để mã hóa số tài khoản');
    next.account_no_enc = await encryptField(key, u.account_number, 'settings.sepay.account_no');
  }
  if (u.account_holder !== undefined) next.account_holder = u.account_holder;
  if (u.prefix !== undefined) next.prefix = u.prefix;
  if (u.min_amount_vnd !== undefined) next.min_amount_vnd = u.min_amount_vnd;
  if (u.auto_activate !== undefined) next.auto_activate = u.auto_activate ? 1 : 0;
  if (u.daily_limit_vnd !== undefined) next.daily_limit_vnd = u.daily_limit_vnd;
  const value = JSON.stringify(next);
  const r = await db.run('UPDATE settings SET value = ?, updated_by = ?, updated_at = ? WHERE key = ?', [value, actor, iso(rt), 'sepay']);
  if (r.changes === 0) await db.run('INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?,?,?,?)', ['sepay', value, actor, iso(rt)]);
}

/** QR VietQR qua SePay: https://qr.sepay.vn/img?acc=&bank=&amount=&des= */
export function qrUrl(o: { account: string; bank: string; amount: number; content: string }): string {
  return `https://qr.sepay.vn/img?acc=${encodeURIComponent(o.account)}&bank=${encodeURIComponent(o.bank)}&amount=${Math.max(0, Math.round(o.amount || 0))}&des=${encodeURIComponent(o.content)}`;
}

export const transferContent = (prefix: string, code: string): string => `${prefix} ${code}`.trim();

/** Tim ma khach trong noi dung chuyen khoan: "AMS K004", "AMSK004", "ams-k004 chuyen tien". Chi khop chinh xac token. */
export function extractPaymentCode(prefix: string, ...texts: (string | null | undefined)[]): string | null {
  const p = prefix.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!p) return null;
  const re = new RegExp(`(?:^|[^A-Z0-9])${p}[\\s\\-_.:]*([A-Z0-9]+)`);
  for (const t of texts) {
    if (!t) continue;
    const m = re.exec(t.toUpperCase());
    if (m && m[1]) return m[1];
  }
  return null;
}
