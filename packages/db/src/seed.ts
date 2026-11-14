import {
  buildSnapshot, MICRO_PER_VND, type RateCardRow,
  blindIndex, encryptField, generateTotpSecret, hashPassword, randomBytes, randomPassword, sha256Hex, shardOf, toBase64Url, toHex,
} from '@ams/shared';
import { PROTOTYPE as P } from './seed-data.gen.js';
import { CONTRACT_BODY_DEFAULT } from './seed-contract-template.js';
import { assertDemoSeedAllowed, assertEncKey, assertSepaySafe, isLocalEnv } from './seed-guard.js';
import type { DbLike, SeedRuntime } from './types.js';

export * from './seed-guard.js';
export * from './seed-bootstrap.js';

export interface SeedOptions {
  /** in thong tin dang nhap ra console (mac dinh true) */
  log?: boolean;
  /** tham so scrypt (test dung N nho cho nhanh) */
  passwordParams?: { N?: number; r?: number; p?: number };
  /** dat mat khau co dinh theo email (test); khong dat = ngau nhien */
  passwords?: Record<string, string>;
  deviceCount?: number; // mac dinh 200
  /** email/mat khau/bi mat TOTP (base32) cua Super admin mau; mac dinh admin@ams.local + ngau nhien */
  adminEmail?: string;
  adminPassword?: string;
  adminTotpSecret?: string;
}

export interface SeedCredential {
  email: string;
  role: string;
  password: string | null;
  totpSecret: string | null;
  status: string;
  /** chi co voi tai khoan moi (invited): token kich hoat tho de thu luong chap nhan loi moi */
  inviteToken?: string;
}

export interface SeedResult {
  skipped: boolean;
  tenantId: string;
  credentials: SeedCredential[];
  customers: Record<string, string>; // payment_code (K001...) -> id
  adminsByEmail: Record<string, string>;
  counts: Record<string, number>;
}

const SEED_BY = 'seed';
const vnd = (n: number): number => n * MICRO_PER_VND;
/**
 * Bang gia MAU cho demo (CHI seed demo; bootstrap production bat dau RONG va chien dich khong gui duyet duoc cho toi khi quan tri tao bang gia, xem docs/PRICING.md).
 * Don vi: d/luot (per_impression) hoac d/1.000 luot (cpm). Gia san la gia moi luot.
 */
const DEMO_RATE_CARDS: { screen: string; region: string; daypart: string; model: 'per_impression' | 'cpm'; price: number; floor: number; note: string }[] = [
  { screen: '*', region: '*', daypart: '*', model: 'per_impression', price: vnd(30), floor: vnd(15), note: 'Gia mac dinh (demo)' },
  { screen: 'tv', region: '*', daypart: 'off_peak', model: 'per_impression', price: vnd(25), floor: vnd(15), note: 'TV gio thuong (demo)' },
  { screen: 'tv', region: '*', daypart: 'peak', model: 'per_impression', price: vnd(40), floor: vnd(20), note: 'TV gio cao diem 17:00-22:00 (demo)' },
  { screen: 'tv', region: 'HN', daypart: 'peak', model: 'per_impression', price: vnd(48), floor: vnd(25), note: 'TV Ha Noi gio cao diem (demo)' },
  { screen: 'tv', region: 'HCM', daypart: 'peak', model: 'per_impression', price: vnd(48), floor: vnd(25), note: 'TV TP.HCM gio cao diem (demo)' },
  { screen: 'elevator', region: '*', daypart: 'off_peak', model: 'per_impression', price: vnd(60), floor: vnd(40), note: 'Thang may gio thuong (demo)' },
  { screen: 'elevator', region: '*', daypart: 'peak', model: 'per_impression', price: vnd(90), floor: vnd(50), note: 'Thang may gio cao diem (demo)' },
  { screen: 'led_p5', region: '*', daypart: 'off_peak', model: 'cpm', price: vnd(120_000), floor: vnd(80), note: 'LED CPM 120.000 d (demo)' },
  { screen: 'led_p5', region: '*', daypart: 'peak', model: 'cpm', price: vnd(180_000), floor: vnd(100), note: 'LED CPM 180.000 d (demo)' },
];
const REGION_CODE: Record<string, string> = { 'Hà Nội': 'HN', 'TP.HCM': 'HCM', 'Đà Nẵng': 'DN', 'Cần Thơ': 'CT', 'Hải Phòng': 'HP' };
const DEVICE_STATUS: Record<string, string> = { 'Hoạt động': 'active', 'Đã ghép đôi': 'paired', 'Cần cập nhật': 'needs_update', 'Đang kiểm tra': 'checking', 'Ngoại tuyến': 'offline' };
const CAMPAIGN_STATE: Record<string, string> = { 'Đang phát': 'active', 'Đã lên lịch': 'scheduled', 'Chờ duyệt': 'pending_review', 'Bản nháp': 'draft', 'Tạm dừng': 'paused' };
const CUSTOMER_STATE: Record<string, string> = { 'Đang hợp tác': 'active', 'Tạm dừng': 'paused', 'Chờ thanh toán': 'pending_payment' };
const CONTRACT_STATE: Record<string, string> = { 'Hiệu lực': 'active', 'Chờ ký': 'pending_sign', 'Tạm dừng': 'paused', 'Hết hạn': 'expired' };
const MEMBER_ROLE: Record<string, string> = {
  'Super admin': 'super_admin', 'Quản lý nội dung quảng cáo': 'content_manager', 'Biên tập viên quảng cáo': 'content_manager',
  'Tài chính & đối soát': 'finance', 'Quản lý thiết bị': 'device_ops', 'Khách hàng (nhãn hàng)': 'customer', 'Đối tác (nhà cung cấp)': 'partner',
};
// Khach hang co trong ads/WAL cua prototype nhung khong co trong CUS: bo sung de du khoa ngoai (MST gia, khong phai MST that)
const EXTRA_CUSTOMERS = [
  { id: 'K010', name: 'Công ty CP Sữa Mộc Châu', short: 'Mộc Châu Milk', tax: '0900000010', ind: 'FMCG · Sữa', owner: 'Ngọc Mai' },
  { id: 'K011', name: 'Tập đoàn Bảo Việt', short: 'Bảo Việt', tax: '0900000011', ind: 'Bảo hiểm', owner: 'Anh Trần' },
  { id: 'K012', name: 'Công ty TNHH CJ CGV Việt Nam', short: 'CGV', tax: '0900000012', ind: 'Giải trí', owner: 'Minh Phạm' },
];
const BRAND_TO_SHORT: Record<string, string> = { Samsung: 'Samsung Vina' };

// ---------- tien ich thoi gian (gio Viet Nam UTC+7 -> UTC ISO)
function vnDateTime(s: string): string {
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}):(\d{2}))?$/);
  if (!m) throw new Error('ngay khong hop le: ' + s);
  return new Date(Date.UTC(+m[3]!, +m[2]! - 1, +m[1]!, +(m[4] ?? 0) - 7, +(m[5] ?? 0))).toISOString();
}
function vnDate(s: string): string {
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)!;
  return `${m[3]}-${m[2]}-${m[1]}`;
}
function monthYear(s: string): string {
  const m = s.match(/^(\d{2})\/(\d{4})$/)!;
  return `${m[2]}-${m[1]}-01`;
}
const addDays = (iso: string, d: number) => new Date(new Date(iso).getTime() + d * 86400000).toISOString();

async function ins(db: DbLike, table: string, row: Record<string, unknown>): Promise<void> {
  const cols = Object.keys(row);
  await db.run(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, cols.map((c) => row[c]));
}

const CONTRACT_BODY = CONTRACT_BODY_DEFAULT;

/**
 * Nap du lieu mau lay tu prototype/app.js (xem seed-data.gen.ts, sinh boi scripts/extract-prototype.mjs).
 * Can FIELD_ENC_KEY trong rt.config.env (ma hoa MST, TOTP, so tai khoan). Khong ghi de: neu da co tenant thi bo qua.
 */
export async function seed(rt: SeedRuntime, opts: SeedOptions = {}): Promise<SeedResult> {
  return seedDemo(rt, opts);
}

/**
 * Seed DEMO (du lieu prototype: khach hang, chien dich, thiet bi, tien mau). Tu choi o AMS_ENV=production|staging
 * tru khi AMS_ALLOW_DEMO_SEED=1. San xuat dung `bootstrap()` (seed-bootstrap.ts).
 */
export async function seedDemo(rt: SeedRuntime, opts: SeedOptions = {}): Promise<SeedResult> {
  const log = opts.log ?? true;
  const env = rt.config.env;
  const amsEnv = assertDemoSeedAllowed(env);
  assertSepaySafe(env);
  if (env['FIELD_ENC_KEY']) assertEncKey(env);
  const encKey = env['FIELD_ENC_KEY'];
  if (!encKey) throw new Error('seed can FIELD_ENC_KEY (32 byte, base64) trong config.env');
  const existing = await rt.db.query<{ n: number }>('SELECT COUNT(*) AS n FROM tenants');
  if (Number(existing[0]?.n) > 0) {
    if (log) console.log('[seed] CSDL da co du lieu (tenants), bo qua.');
    return { skipped: true, tenantId: '', credentials: [], customers: {}, adminsByEmail: {}, counts: {} };
  }

  const nowIso = rt.clock.now().toISOString();
  const today = P.TODAY; // '2026-11-12'
  const todayEnd = `${today}T00:00:00.000Z`;
  const counts: Record<string, number> = {};
  const bump = (t: string, n = 1) => void (counts[t] = (counts[t] ?? 0) + n);
  const id = () => rt.id();
  const params = { N: 2 ** 15, ...(opts.passwordParams ?? {}) };

  // ================= tai khoan =================
  const tenantId = id();
  const accounts: { name: string; email: string; role: string; kind: 'internal' | 'customer' | 'partner'; status: 'active' | 'invited'; org?: string; scope?: string }[] = [];
  const adminEmail = (opts.adminEmail ?? 'admin@ams.local').toLowerCase();
  const emailOverride: Record<string, string> = { 'Anh Trần': adminEmail };
  for (const m of P.members) {
    const { name, email, role: roleTxt, status: statusTxt, scope } = m as { name: string; email: string; role: string; status: string; scope?: string };
    const role = MEMBER_ROLE[roleTxt]!;
    accounts.push({
      name, email: (emailOverride[name] ?? email).toLowerCase(), role,
      kind: role === 'customer' ? 'customer' : role === 'partner' ? 'partner' : 'internal',
      status: statusTxt === 'Đang hoạt động' ? 'active' : 'invited', ...(scope ? { scope, org: scope } : {}),
    });
  }

  const credentials: SeedCredential[] = [];
  const adminIds: Record<string, string> = {}; // email -> id
  const adminByName: Record<string, string> = {};
  const prepared: { acc: (typeof accounts)[number]; id: string; hash: string | null; totp: string | null; pw: string | null; inviteToken?: string }[] = [];
  for (const acc of accounts) {
    const aid = id();
    adminIds[acc.email] = aid;
    adminByName[acc.name] = aid;
    if (acc.status === 'active') {
      const isAdmin = acc.email === adminEmail;
      const pw = (isAdmin ? opts.adminPassword : undefined) ?? opts.passwords?.[acc.email] ?? randomPassword(16);
      prepared.push({ acc, id: aid, hash: await hashPassword(pw, params), totp: (isAdmin ? opts.adminTotpSecret : undefined) ?? generateTotpSecret(), pw });
    } else {
      prepared.push({ acc, id: aid, hash: null, totp: null, pw: null, inviteToken: toBase64Url(randomBytes(24)) });
    }
  }

  // ================= khach hang (du lieu CUS + bo sung) =================
  type Cus = { id: string; code: string; name: string; short: string; tax: string; addr: string; rep: string; title: string; phone: string; email: string; contact: string; ind: string; owner: string; terms: string; limit: number; since: string; state: string };
  const cusList: Cus[] = P.CUS.map((c) => ({
    id: id(), code: c.id, name: c.name, short: c.short, tax: c.tax, addr: c.addr, rep: c.rep, title: c.title, phone: c.phone, email: c.email,
    contact: c.contact, ind: c.ind, owner: c.owner, terms: c.terms, limit: c.limit, since: monthYear(c.since), state: CUSTOMER_STATE[c.state] ?? 'active',
  }));
  for (const e of EXTRA_CUSTOMERS)
    cusList.push({ id: id(), code: e.id, name: e.name, short: e.short, tax: e.tax, addr: 'Hà Nội', rep: 'Đại diện (mẫu)', title: 'Giám đốc', phone: '—', email: `ads@${e.short.toLowerCase().replace(/\W+/g, '')}.example`, contact: '—', ind: e.ind, owner: e.owner, terms: 'Trả trước 100% qua ví', limit: 0, since: '2026-01-01', state: 'active' });
  const cusByCode = Object.fromEntries(cusList.map((c) => [c.code, c]));
  const cusByShort = Object.fromEntries(cusList.map((c) => [c.short, c]));
  const customerIds = Object.fromEntries(cusList.map((c) => [c.code, c.id]));

  // gan khach cho tai khoan ngoai theo scope (short)
  for (const p of prepared) {
    if (p.acc.kind !== 'internal') {
      const c = cusByShort[p.acc.scope ?? ''];
      if (!c) throw new Error('tai khoan ngoai khong co khach hang: ' + p.acc.email);
      (p.acc as { customerId?: string }).customerId = c.id;
    }
  }

  // ================= nguoi dung cuoi + thiet bi =================
  const endUsers = P.users.map((u, i) => ({ id: id(), u, i }));
  const deviceCount = opts.deviceCount ?? 200;
  const devs = Array.from({ length: deviceCount }, (_, i) => {
    const m = P.mdl[(i * 3 + (i % 5)) % P.mdl.length]!;
    const st = m[0] === 'Không xác định' ? 'Đang kiểm tra' : P.stt[i % P.stt.length]!;
    const kind = m[0] === 'TV' ? 'tv' : m[0] === 'Điện thoại' ? 'phone' : 'virtual';
    const nameBase = kind === 'tv' ? ['TV phòng khách', 'TV phòng ngủ', 'TV bếp', 'TV quán cà phê'][i % 4]! + ' #' + (i + 1) : m[1]! + ' #' + (i + 1);
    return { i, kind, name: nameBase, model: m[1]!, os: m[2]!, status: DEVICE_STATUS[st]!, region: REGION_CODE[P.reg[i % 5]!]!, app: i % 7 === 3 ? '2.3.8' : '2.4.1', views: 120 + ((i * 37) % 900), owner: i % P.own.length };
  });

  await rt.db.tx(async (db) => {
    // ----- tenant -----
    await ins(db, 'tenants', { id: tenantId, name: P.businessA.name, tax_code: P.businessA.tax, created_at: nowIso });
    bump('tenants');

    // ----- khach hang (can truoc admin ngoai) -----
    for (const c of cusList) {
      await ins(db, 'customers', {
        id: c.id, tenant_id: tenantId, legal_name: c.name, short_name: c.short,
        tax_code_enc: await encryptField(encKey, c.tax, 'customers.tax_code'),
        tax_code_hash: await blindIndex(encKey, 'customers.tax_code', c.tax),
        address: c.addr, industry: c.ind, rep_name: c.rep, rep_title: c.title, phone: c.phone, email: c.email, contact_name: c.contact,
        account_owner_id: adminByName[c.owner] ?? null, payment_terms: c.terms, credit_limit_vnd: c.limit,
        payment_code: c.code, state: c.state, since: c.since, created_at: nowIso,
      });
      bump('customers');
      await ins(db, 'customer_contacts', { id: id(), customer_id: c.id, name: c.rep, title: c.title, phone: c.phone, email: c.email, is_primary: 1 });
      if (c.contact && c.contact !== '—' && c.contact !== c.rep) await ins(db, 'customer_contacts', { id: id(), customer_id: c.id, name: c.contact, title: 'Đầu mối', phone: c.phone, email: c.email, is_primary: 0 });
      bump('customer_contacts');
      await ins(db, 'upload_quotas', { customer_id: c.id, max_files_per_day: 20, max_mb_per_file: 30, max_total_gb: 5 });
    }

    // ----- admins -----
    for (const p of prepared) {
      const cid = (p.acc as { customerId?: string }).customerId ?? null;
      await ins(db, 'admins', {
        id: p.id, tenant_id: tenantId, email: p.acc.email, name: p.acc.name, role: p.acc.role, account_kind: p.acc.kind, customer_id: cid,
        org_name: p.acc.org ?? null, status: p.acc.status, password_hash: p.hash,
        totp_secret_enc: p.totp ? await encryptField(encKey, p.totp, 'admins.totp_secret') : null,
        mfa_required: 1, invited_by: adminIds[adminEmail] ?? null, created_at: nowIso,
      });
      bump('admins');
      if (p.inviteToken) {
        await ins(db, 'invites', { id: id(), admin_id: p.id, email: p.acc.email, role: p.acc.role, token_hash: await sha256Hex(p.inviteToken), invited_by: adminIds[adminEmail], expires_at: addDays(nowIso, 3), created_at: nowIso });
        bump('invites');
      }
      credentials.push({ email: p.acc.email, role: p.acc.role, password: p.pw, totpSecret: p.totp, status: p.acc.status, ...(p.inviteToken ? { inviteToken: p.inviteToken } : {}) });
    }

    // ----- mau hop dong, cai dat, quy tac kich hoat -----
    const templateId = id();
    await ins(db, 'contract_templates', { id: templateId, name: 'Hợp đồng dịch vụ quảng cáo', version: 1, body_md: CONTRACT_BODY, variables: JSON.stringify(['seller.*', 'customer.*', 'contract.*']), active: 1 });
    bump('contract_templates');
    const sepay = P.SEP;
    const sepaySetting: Record<string, unknown> = {
      enabled: sepay.on ? 1 : 0, env: String(sepay.env).toLowerCase(), auth: sepay.auth, webhook_url: sepay.url, bank: sepay.bank,
      account_no_enc: await encryptField(encKey, sepay.no, 'settings.sepay.account_no'), account_holder: sepay.holder, prefix: sepay.prefix,
      min_amount_vnd: sepay.min, auto_activate: sepay.auto ? 1 : 0,
    };
    if (env['SEPAY_WEBHOOK_SECRET']) sepaySetting['secret_enc'] = await encryptField(encKey, env['SEPAY_WEBHOOK_SECRET']!, 'settings.sepay.secret');
    await ins(db, 'settings', { key: 'sepay', value: JSON.stringify(sepaySetting), updated_by: SEED_BY, updated_at: nowIso });
    await ins(db, 'settings', { key: 'seller', value: JSON.stringify({ name: P.businessA.name, tax_code: P.businessA.tax, address: P.businessA.addr, rep: P.businessA.rep, email: P.businessA.email }), updated_by: SEED_BY, updated_at: nowIso });
    await ins(db, 'settings', { key: 'seed', value: JSON.stringify({ seeded_at: nowIso, source: 'prototype/app.js' }), updated_by: SEED_BY, updated_at: nowIso });
    bump('settings', 3);
    await ins(db, 'activation_rules', { id: id(), customer_id: null, min_amount_vnd: sepay.min, auto_activate: sepay.auto ? 1 : 0, plan_id: null });
    bump('activation_rules');

    // ----- hop dong + dong hop dong + cong no -----
    const contractIdByNo: Record<string, string> = {};
    const customerActiveContract: Record<string, string> = {};
    for (const c of P.CT) {
      const cus = cusByCode[c.cus]!;
      const cid = id();
      contractIdByNo[c.id] = cid;
      const state = CONTRACT_STATE[c.state]!;
      if (state === 'active' && !customerActiveContract[cus.id]) customerActiveContract[cus.id] = cid;
      const adv = Number(cus.terms.match(/(\d+)%/)?.[1] ?? (cus.terms.includes('100%') ? 100 : 30));
      const start = vnDate(c.from);
      await ins(db, 'contracts', {
        id: cid, no: c.id, customer_id: cus.id, title: c.title, value_vnd: c.val, vat_rate: 8, start_date: start, end_date: vnDate(c.to), advance_pct: adv, paid_pct: c.paid,
        payment_terms: cus.terms, state, signed_at: state === 'pending_sign' ? null : `${start}T02:00:00.000Z`, signed_file_key: null, template_id: templateId,
        created_by: adminByName[cus.owner] ?? null, created_at: nowIso,
      });
      bump('contracts');
      const screenType = /thang máy/i.test(c.title) ? 'elevator' : /LED/i.test(c.title) ? 'led_p5' : 'tv';
      await ins(db, 'contract_lines', { id: id(), contract_id: cid, screen_type: screenType, region_id: 'HN', daypart: screenType === 'elevator' ? 'peak' : 'all_day', frequency: 4, duration_s: 15, unit_price_vnd: c.val, qty: 1 });
      bump('contract_lines');
      if (state !== 'pending_sign') {
        const paid = Math.round((c.val * c.paid) / 100);
        await ins(db, 'receivables', { id: id(), customer_id: cus.id, contract_id: cid, invoice_id: null, amount_vnd: c.val, due_date: vnDate(c.to), paid_vnd: paid, state: c.paid >= 100 ? 'paid' : paid > 0 ? 'partial' : 'open' });
        bump('receivables');
      }
    }
    // hoa don mau
    for (const [code, period] of [['K001', '2026-10'], ['K003', '2026-11']] as const) {
      const c = cusByCode[code]!;
      await ins(db, 'invoices', { id: id(), customer_id: c.id, period, amount_vnd: 60_000_000, vat_rate: 8, status: 'issued', einvoice_ref: null, created_at: nowIso });
      bump('invoices');
    }

    // ----- nha quang cao + chien dich + creatives + lich -----
    const advertiserIds: Record<string, string> = {};
    const adv = async (brand: string) => {
      const short = BRAND_TO_SHORT[brand] ?? brand;
      if (!advertiserIds[short]) {
        advertiserIds[short] = id();
        await ins(db, 'advertisers', { id: advertiserIds[short], name: brand, tax_code: cusByShort[short]?.tax ?? null });
        bump('advertisers');
      }
      return advertiserIds[short]!;
    };
    type Camp = { id: string; cus: Cus; name: string; brand: string; state: string; budget: number; spent: number; start: string; end: string; file: string; creator: string; approved: boolean };
    const camps: Camp[] = [];
    const rawAds = [...P.ads.map((a) => ({ ...a, extra: false }))];
    for (const a of rawAds) {
      const cus = cusByShort[BRAND_TO_SHORT[a.brand] ?? a.brand]!;
      const state = CAMPAIGN_STATE[a.state]!;
      const budget = Number(a.budget);
      camps.push({
        id: id(), cus, name: a.name, brand: a.brand, state, budget, spent: state === 'active' || state === 'paused' ? Math.min(budget, a.plays * 2500) : 0,
        start: `${a.start}T00:00:00.000Z`, end: addDays(`${a.start}T00:00:00.000Z`, 30), file: a.file, creator: a.creator, approved: ['active', 'scheduled', 'paused'].includes(state),
      });
    }
    // chien dich bo sung: da duyet nhung vi thieu tien (de thu tu kich hoat khi nap)
    camps.push({ id: id(), cus: cusByShort['Unilever']!, name: 'Omo Tết 2027', brand: 'Unilever', state: 'awaiting_funds', budget: 50_000_000, spent: 0, start: '2026-12-01T00:00:00.000Z', end: '2027-01-15T00:00:00.000Z', file: '', creator: 'Ngọc Mai', approved: false });

    // bang gia mau (hieu luc tu 2026-01-01; chien dich seed duoc chot gia theo day)
    const demoCards: RateCardRow[] = [];
    for (const k of DEMO_RATE_CARDS) {
      const row = { id: id(), customer_id: '*', screen_type: k.screen, region_id: k.region, daypart: k.daypart, model: k.model, price_micro_vnd: k.price, floor_micro_vnd: k.floor, effective_from: '2026-01-01T00:00:00.000Z', effective_to: null, active: 1 };
      await ins(db, 'rate_cards', { ...row, note: k.note, created_by: adminIds[adminEmail] ?? null, created_at: nowIso });
      bump('rate_cards');
      demoCards.push(row);
    }
    for (const c of camps) {
      const live = c.approved;
      const awaiting = c.state === 'awaiting_funds';
      const created = addDays(c.start, -10);
      await ins(db, 'campaigns', {
        id: c.id, customer_id: c.cus.id, contract_id: customerActiveContract[c.cus.id] ?? null, advertiser_id: await adv(c.brand), name: c.name, state: c.state,
        budget_cap_vnd: c.budget, approved_budget_vnd: live || awaiting ? c.budget : 0, reserved_vnd: live ? c.budget - c.spent : 0, spent_vnd: c.spent,
        funding_state: live ? 'reserved' : awaiting ? 'awaiting_funds' : 'none', activate_on_approve: 1, target_types: JSON.stringify(['tv']), duration_s: /30/.test(String(P.ads.find((a) => a.name === c.name)?.dur ?? '15')) ? 30 : 15,
        start_at: c.start, end_at: c.end, created_by: adminByName[c.creator] ?? null, approved_by: live || awaiting ? adminIds[adminEmail] : null,
        approved_at: live || awaiting ? addDays(created, 3) : null, created_at: created, updated_at: nowIso,
      });
      bump('campaigns');
      if (live || awaiting) {
        // gia chot luc duyet (nhu API): chien dich seed da duyet cung co gia chot, de gateway tinh tien dung bang gia mau
        const snap = buildSnapshot({ customerId: c.cus.id, screenTypes: ['tv'], at: addDays(created, 3), rateCards: demoCards, contractLines: null, fallback: { placeholderMicro: null } });
        for (const r of snap.rows) {
          await ins(db, 'campaign_prices', { campaign_id: c.id, screen_type: r.screen_type, region_id: r.region_id, daypart: r.daypart, unit_price_micro_vnd: r.unit_price_micro_vnd, floor_micro_vnd: r.floor_micro_vnd, list_price_micro_vnd: r.list_price_micro_vnd, model: r.model, cpm_micro_vnd: r.cpm_micro_vnd, source: r.source, source_ref: r.source_ref, floored: r.floored ? 1 : 0, resolved_by: adminIds[adminEmail] ?? null, resolved_at: addDays(created, 3) });
          bump('campaign_prices');
        }
      }
      for (const dp of [['all_day', 0, 1440]] as const) {
        if (c.state === 'draft' || c.state === 'pending_review') continue;
        await ins(db, 'schedule_slots', { id: id(), campaign_id: c.id, partner_id: null, screen_group_id: null, target_type: 'tv', daypart: dp[0], start_min: dp[1], end_min: dp[2], priority: 2, reward_points: 10, regions: JSON.stringify(['HN', 'HCM']) });
        bump('schedule_slots');
      }
    }
    // creatives: tu danh sach media + tep cua chien dich
    const campByFile = Object.fromEntries(camps.filter((c) => c.file).map((c) => [c.file, c]));
    const seenFiles = new Set<string>();
    const mkCreative = async (file: string, meta: string, stateTxt: string, ownerShort: string) => {
      const m = meta.match(/(\w+) · (\d+)×(\d+)(?: · (\d+) giây)?/);
      const cus = cusByShort[BRAND_TO_SHORT[ownerShort] ?? ownerShort] ?? cusByCode['K001']!;
      const camp = campByFile[file];
      const w = m ? +m[2]! : 1920, h = m ? +m[3]! : 1080;
      const reviewState = stateTxt === 'Đã duyệt' ? 'approved' : 'pending';
      await ins(db, 'creatives', {
        id: id(), campaign_id: camp?.id ?? null, customer_id: camp?.cus.id ?? cus.id, name: file, target_type: 'tv', px_w: w, px_h: h, orientation: w >= h ? 'landscape' : 'portrait',
        kind: m?.[1]?.toLowerCase() === 'png' ? 'image' : 'video', source: 'upload', source_url: null, storage_key: `seed/${(camp?.cus.id ?? cus.id)}/${file}`, mime: m?.[1] === 'PNG' ? 'image/png' : 'video/mp4',
        size_bytes: 8_000_000, duration_s: m?.[4] ? +m[4] : null, codec: m?.[1] === 'MP4' ? 'h264' : null, uploaded_by: adminByName['Ngọc Mai'] ?? null, uploader_kind: 'internal',
        // DEMO-ONLY: du lieu mau coi nhu da quet sach de cong quet media (API duyet + manifest gateway) khong chan demo/e2e khi khong co media-worker/ClamAV. Production KHONG dung seed nay.
        scan_state: 'clean', review_state: reviewState, review_note: null, state: reviewState === 'approved' ? 'ready' : 'pending_review', created_at: nowIso,
      });
      bump('creatives');
      seenFiles.add(file);
    };
    for (const m of P.media) await mkCreative(m.name, m.meta, m.state, m.owner);
    for (const c of camps) if (c.file && !seenFiles.has(c.file)) await mkCreative(c.file, 'MP4 · 1920×1080 · 15 giây', 'Chờ duyệt', c.brand);

    // ----- vi, nap tien, so cai -----
    type Top = { code: string; cus: Cus; amount: number; method: string; at: string; status: string; provider: string | null; txn: string | null; matchedBy: string | null; raw: string | null };
    const tops: Top[] = P.TOP.map((t) => ({
      code: t.id, cus: cusByShort[t.b]!, amount: t.a,
      method: /VietQR/i.test(t.m) ? 'vietqr' : /VNPay/i.test(t.m) ? 'vnpay' : /MoMo/i.test(t.m) ? 'momo' : 'napas',
      at: vnDateTime(t.t), status: t.s === 'Đã ghi nhận' ? 'credited' : 'pending', provider: null, txn: null, matchedBy: t.s === 'Đã ghi nhận' ? 'manual' : null, raw: null,
    }));
    for (const l of P.SEP.log) // giao dich SePay mau trong prototype (MB Bank 60 trieu da cong vi)
      tops.push({ code: 'NAP-1040', cus: cusByShort[l.cus]!, amount: l.a, method: 'sepay', at: vnDateTime(l.t), status: 'credited', provider: 'sepay', txn: String(l.id), matchedBy: 'content', raw: l.c });
    const financeId = adminByName['Minh Phạm'] ?? null;
    const topIds: Record<string, string> = {};
    for (const t of tops) {
      const tid = id();
      topIds[t.code] = tid;
      await ins(db, 'topups', {
        id: tid, code: t.code, customer_id: t.cus.id, amount_vnd: t.amount, method: t.method, provider: t.provider, provider_txn_id: t.txn, matched_by: t.matchedBy, raw_content: t.raw,
        status: t.status, requested_by: null, confirmed_by: t.status === 'credited' && t.provider === null ? financeId : null, requested_at: t.at, credited_at: t.status === 'credited' ? t.at : null,
      });
      bump('topups');
    }
    for (const l of P.SEP.log) {
      await ins(db, 'payment_webhooks', {
        id: id(), provider: 'sepay', event_id: String(l.id), payload: JSON.stringify({ id: l.id, content: l.c, transferAmount: l.a, transferType: 'in' }), signature_ok: 1, result: 'credited',
        matched_customer_id: cusByShort[l.cus]!.id, topup_id: topIds['NAP-1040'], received_at: vnDateTime(l.t), processed_at: vnDateTime(l.t), retry_count: 0,
      });
      bump('payment_webhooks');
    }

    const walletSeed = P.WAL as unknown as Record<string, { bal: number; res: number; spent: number }>;
    for (const c of cusList) {
      type Ev = { at: string; seq: number; kind: 'adjust' | 'topup' | 'reserve' | 'spend'; amount: number; refType: string | null; refId: string | null; note: string | null };
      const evs: Ev[] = [];
      let seq = 0;
      const myTops = tops.filter((t) => t.cus.id === c.id && t.status === 'credited');
      const myCamps = camps.filter((k) => k.cus.id === c.id && k.approved);
      const topSum = myTops.reduce((s, t) => s + t.amount, 0);
      const spentSum = myCamps.reduce((s, k) => s + k.spent, 0);
      const budgetSum = myCamps.reduce((s, k) => s + k.budget, 0);
      const target = walletSeed[c.short]?.bal ?? 0;
      const opening = Math.max(0, target - (topSum - spentSum), budgetSum);
      if (opening > 0) evs.push({ at: '2026-01-01T00:00:00.000Z', seq: seq++, kind: 'adjust', amount: opening, refType: 'seed', refId: null, note: 'Số dư đầu kỳ (dữ liệu mẫu)' });
      for (const t of myTops) evs.push({ at: t.at, seq: seq++, kind: 'topup', amount: t.amount, refType: 'topup', refId: topIds[t.code]!, note: t.code });
      for (const k of myCamps) {
        evs.push({ at: addDays(k.start, -7), seq: seq++, kind: 'reserve', amount: k.budget, refType: 'campaign', refId: k.id, note: 'Giữ ngân sách ' + k.name });
        if (k.spent > 0) evs.push({ at: todayEnd, seq: seq++, kind: 'spend', amount: k.spent, refType: 'campaign', refId: k.id, note: 'Chi phát ' + k.name });
      }
      evs.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.seq - b.seq));
      let bal = 0, res = 0, spent = 0, last = nowIso;
      for (const e of evs) {
        if (e.kind === 'adjust' || e.kind === 'topup') bal += e.amount;
        else if (e.kind === 'reserve') res += e.amount;
        else { bal -= e.amount; res -= e.amount; spent += e.amount; }
        await ins(db, 'wallet_entries', { id: id(), customer_id: c.id, kind: e.kind, amount_vnd: e.amount, balance_after: bal, reserved_after: res, ref_type: e.refType, ref_id: e.refId, note: e.note, created_at: e.at });
        bump('wallet_entries');
        last = e.at;
      }
      await ins(db, 'ad_wallets', { customer_id: c.id, balance_vnd: bal, reserved_vnd: res, spent_vnd: spent, low_balance_alert_pct: 10, updated_at: last });
      bump('ad_wallets');
    }

    // ----- thiet bi + nguoi dung cuoi -----
    for (const e of endUsers) {
      await ins(db, 'end_users', { id: e.id, phone_hash: await sha256Hex('phone:' + e.u.phone), email_enc: await encryptField(encKey, e.u.email, 'end_users.email'), display_name: e.u.name, created_at: nowIso });
      bump('end_users');
    }
    const nowMs = rt.clock.now().getTime();
    const minsAgo = [2, 12, 18, 60, 95, 140];
    for (const d of devs) {
      const did = id();
      const user = d.kind === 'virtual' ? null : endUsers[d.owner]!.id;
      const seen = d.i < 6 ? new Date(nowMs - minsAgo[d.i]! * 60000) : new Date(nowMs - (((8 + (d.i % 12)) * 60 + ((d.i * 7) % 60)) % 1440) * 60000 - 3600000);
      await ins(db, 'devices', {
        id: did, user_id: user, name: d.name, kind: d.kind, model: d.model, os: d.os, app_version: d.app, region_id: d.region,
        pubkey_ed25519: d.status === 'checking' ? null : toBase64Url(randomBytes(32)), trust_level: d.kind === 'virtual' ? 0 : d.status === 'active' ? 2 : 1,
        status: d.status, paired_at: d.status === 'checking' ? null : addDays(nowIso, -30 - (d.i % 60)), last_seen_at: seen.toISOString(), views_30d: d.views,
        blocked: d.i % 50 === 49 ? 1 : 0, shard: shardOf(did), created_at: addDays(nowIso, -60),
      });
      bump('devices');
    }

    // thuong nguoi xem: so cai + chi tra mau
    for (const e of endUsers.slice(0, 6)) {
      for (let k = 0; k < 3; k++) {
        await ins(db, 'wallet_ledger', { id: id(), user_id: e.id, kind: 'reward', amount_vnd: 1500 + k * 500, ref_type: 'seed', ref_id: null, status: 'posted', created_at: addDays(nowIso, -k) });
        bump('wallet_ledger');
      }
    }
    await ins(db, 'payouts', { id: id(), user_id: endUsers[0]!.id, amount_vnd: 50_000, channel: 'bank', status: 'paid', external_ref: null, requested_at: addDays(nowIso, -5), paid_at: addDays(nowIso, -4) });
    await ins(db, 'payouts', { id: id(), user_id: endUsers[1]!.id, amount_vnd: 50_000, channel: 'momo', status: 'pending', external_ref: null, requested_at: nowIso, paid_at: null });
    bump('payouts', 2);

    // ----- dia diem + man hinh -----
    for (const v of P.VEN) {
      const vid = id();
      const region = REGION_CODE[v.r]!;
      await ins(db, 'venues', { id: vid, code: v.id, name: v.n, kind: v.k === 'Bãi đỗ xe' ? 'parking' : 'apartment', region_id: region, address: v.n, lat: null, lng: null, owner_contact: null, contract_ref: null, created_at: nowIso });
      bump('venues');
      await ins(db, 'screen_groups', { id: id(), venue_id: vid, name: v.n });
      bump('screen_groups');
      const isLed = v.t === 'LED P5';
      const [pw, ph] = v.px.split('×').map(Number) as [number, number];
      const mm = isLed ? v.z.match(/([\d,]+) × ([\d,]+) m/) : null;
      const stState = ({ 'Hoạt động': 'active', 'Cần cập nhật': 'needs_update', 'Ngoại tuyến': 'offline', 'Đang kiểm tra': 'checking' } as Record<string, string>)[v.s]!;
      for (let k = 0; k < v.c; k++) {
        await ins(db, 'screens', {
          id: id(), venue_id: vid, type: isLed ? 'led_p5' : 'elevator', diag_inch: isLed ? null : parseFloat(v.z.replace(',', '.')),
          width_mm: mm ? Math.round(parseFloat(mm[1]!.replace(',', '.')) * 1000) : null, height_mm: mm ? Math.round(parseFloat(mm[2]!.replace(',', '.')) * 1000) : null,
          px_w: pw, px_h: ph, orientation: pw >= ph ? 'landscape' : 'portrait', pixel_pitch_mm: isLed ? 5.0 : null, brightness_nit: isLed ? 6000 : 350,
          controller_kind: isLed ? 'novastar' : 'android_player', controller_ref: null, device_id: null, state: stState, installed_at: '2026-06-01T00:00:00.000Z',
        });
        bump('screens');
      }
    }

    // ----- doi tac, gia san RTB -----
    for (const [name, proto] of P.partners) {
      await ins(db, 'partners', { id: id(), name, protocol: proto, endpoint: null, auth_ref: null, enabled: proto === 'Chưa công bố' ? 0 : 1, floor_cpm_vnd: 0, logo_key: null });
      bump('partners');
    }
    for (const f of P.floors) {
      await ins(db, 'rtb_floors', { id: id(), category: f[0], floor_cpm_vnd: f[1], updated_by: adminIds[adminEmail], updated_at: nowIso });
      bump('rtb_floors');
    }

    // ----- nhat ky + thong bao -----
    const whoId: Record<string, string | null> = { 'Anh Trần': adminIds[adminEmail]!, 'Ngọc Mai': adminByName['Ngọc Mai'] ?? null, 'Minh Phạm': financeId, 'Quốc Bảo': adminByName['Quốc Bảo'] ?? null, 'Hệ thống': null };
    for (let i = 0; i < P.audit.length; i++) {
      const a = P.audit[i]!;
      await ins(db, 'audit_log', { id: id(), ts: vnDateTime(a.time), actor_id: whoId[a.who] ?? null, action: a.act, object_type: null, object_id: null, customer_id: null, ip: a.ip, diff: JSON.stringify({ obj: a.obj }) });
      bump('audit_log');
    }
    for (const n of P.notifs) {
      await ins(db, 'notifications', { id: id(), admin_id: adminIds[adminEmail], customer_id: null, kind: n.p, title: n.t, body: null, ref_type: null, ref_id: null, read_at: n.u ? null : nowIso, created_at: nowIso });
      bump('notifications');
    }
  });

  // Khong bao gio in mat khau/TOTP ra log: CLI ghi tep local (chi local/test) tu `credentials` tra ve.
  if (log) console.log(`[seed] Da nap du lieu DEMO tu prototype (AMS_ENV=${amsEnv}${isLocalEnv(amsEnv) ? '' : ', AMS_ALLOW_DEMO_SEED=1'}); Super admin: ${adminEmail}`);
  return { skipped: false, tenantId, credentials, customers: customerIds, adminsByEmail: adminIds, counts };
}
