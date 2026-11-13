import { enqueueOutbox, processOutbox, type Db, type OutboxHandlers, type Runtime } from '@ams/runtime';
import { sha256Hex, toBase64Url, randomBytes, transitionCampaign } from '@ams/shared';
import { loadSepayConfig } from './config.js';
import { runAwaitingFunds } from './ledger.js';
import { audit, bumpManifest, iso, n, notify, withTx } from './util.js';

export type ActivationAction =
  | { type: 'customer_activated'; prev_state: string; prev_since: string | null }
  | { type: 'contract_activated'; id: string; prev_state: string; prev_signed_at: string | null; prev_paid_pct: number }
  | { type: 'portal_account_created'; admin_id: string; invite_id: string; email: string }
  | { type: 'welcome_email_sent'; to: string }
  | { type: 'welcome_email_skipped'; reason: string }
  | { type: 'campaign_funded'; campaign_id: string; state: string; reserved_vnd: number };

async function minForCustomer(db: Db, rt: Runtime, customerId: string): Promise<{ min: number; auto: boolean }> {
  const rule = (await db.query<{ min_amount_vnd: unknown; auto_activate: unknown }>(
    'SELECT min_amount_vnd, auto_activate FROM activation_rules WHERE customer_id = ? ORDER BY min_amount_vnd DESC LIMIT 1', [customerId]))[0]
    ?? (await db.query<{ min_amount_vnd: unknown; auto_activate: unknown }>('SELECT min_amount_vnd, auto_activate FROM activation_rules WHERE customer_id IS NULL LIMIT 1'))[0];
  const cfg = await loadSepayConfig(rt, db);
  if (rule) return { min: n(rule.min_amount_vnd), auto: Number(rule.auto_activate) === 1 && cfg.auto_activate };
  return { min: cfg.min_amount_vnd, auto: cfg.auto_activate };
}

/**
 * Bo kich hoat tu dong sau khi mot khoan nap duoc ghi co.
 *  1. chien dich awaiting_funds duoc giu ngan sach, tu chay theo thu tu duyet
 *  2. khach pending_payment dat muc toi thieu (tong da nap >= min) -> active, hop dong pending_sign -> active,
 *     tai khoan cong + email chao; duoi muc toi thieu chi cong vi.
 * Moi hanh dong ghi activation_log (hoan tac duoc bang undoActivation).
 */
export async function runActivation(rt: Runtime, dbIn: Db, customerId: string, topupId: string | null): Promise<{ log_id: string | null; actions: ActivationAction[] }> {
  const r = await runActivationTx(rt, dbIn, customerId, topupId);
  if (r.actions.length) await bumpManifest(rt); // chien dich vua duoc giu tien co the da len `active`
  await drainMailOutbox(rt); // thu chao: ngoai giao dich, loi khong bao gio chan kich hoat (R1-05)
  return r;
}

/**
 * Kich hoat co the CHAY LAI (RECONCILIATION muc 2 / R1-05): goi tu nhanh 'already' cua creditTopup (webhook gui lai sau khi vi da duoc cong
 * nhung runActivation chua chay/hong) va tu sweepActivations. Idempotent; luon tang epoch manifest vi lan truoc co the dut giua commit va bump.
 */
export async function healActivation(rt: Runtime, db: Db, customerId: string, topupId: string | null): Promise<void> {
  await runActivation(rt, db, customerId, topupId);
  await bumpManifest(rt);
}

/**
 * Sweeper: tim khach co tien da co nhung chua kich hoat roi chay lai runActivation (idempotent):
 *  - chien dich awaiting_funds ma so du kha dung >= ngan sach da duyet;
 *  - khach pending_payment da co topup 'credited'.
 * Goi theo lich (cung nhip job tan suat cao). Loi cua tung khach khong chan khach khac.
 */
export async function sweepActivations(rt: Runtime): Promise<{ checked: number; activated: number; failed: number }> {
  const rows = await rt.db.query<{ customer_id: string }>(
    `SELECT DISTINCT c.customer_id AS customer_id FROM campaigns c JOIN ad_wallets w ON w.customer_id = c.customer_id
      WHERE c.state = 'awaiting_funds' AND c.funding_state = 'awaiting_funds' AND c.approved_budget_vnd > 0
        AND w.balance_vnd - w.reserved_vnd >= c.approved_budget_vnd
     UNION
     SELECT c2.id AS customer_id FROM customers c2
      WHERE c2.state = 'pending_payment' AND EXISTS (SELECT 1 FROM topups t WHERE t.customer_id = c2.id AND t.status = 'credited')`,
  );
  let activated = 0, failed = 0;
  for (const r of rows) {
    try {
      const res = await runActivation(rt, rt.db, r.customer_id, null);
      if (res.actions.length) activated++;
    } catch (e) {
      failed++;
      console.error(`[activation-sweep] ${r.customer_id}: ${(e as Error).message}`);
    }
  }
  await drainMailOutbox(rt);
  return { checked: rows.length, activated, failed };
}

// --- thu chao qua outbox (R1-05) ---
export const TOPIC_MAIL_SEND = 'mail.send';
interface MailPayload { to: string; subject: string; html: string; text?: string }

/** Handler outbox gui thu: NEM loi de outbox thu lai co lui luy thua. Gop vao bo handler cua API (outbox.ts) de thu lai theo lich. */
export function mailOutboxHandlers(): OutboxHandlers {
  return {
    [TOPIC_MAIL_SEND]: async (msg, rt) => {
      const p = msg.payload as MailPayload | null;
      if (!p?.to || !p.subject) return; // payload hong: bo
      await rt.mail.send(p);
    },
  };
}

/** Gui thu dang cho ngay sau commit (best-effort, khong nem). Thu lai nho outbox processor. */
export async function drainMailOutbox(rt: Runtime): Promise<void> {
  try {
    await processOutbox(rt, mailOutboxHandlers(), { limit: 10, rounds: 1 });
  } catch (e) {
    console.error('[activation] mail outbox:', (e as Error).message);
  }
}

async function runActivationTx(rt: Runtime, dbIn: Db, customerId: string, topupId: string | null): Promise<{ log_id: string | null; actions: ActivationAction[] }> {
  return withTx(dbIn, async (db) => {
    const actions: ActivationAction[] = [];
    const cust = (await db.query<{ state: string; since: string | null; email: string | null; short_name: string; legal_name: string; payment_code: string }>(
      'SELECT state, since, email, short_name, legal_name, payment_code FROM customers WHERE id = ?', [customerId]))[0];
    if (!cust) return { log_id: null, actions };

    if (cust.state === 'pending_payment') {
      const { min, auto } = await minForCustomer(db, rt, customerId);
      const sum = n((await db.query<{ s: unknown }>("SELECT COALESCE(SUM(amount_vnd),0) AS s FROM topups WHERE customer_id = ? AND status = 'credited'", [customerId]))[0]?.s);
      if (auto && sum >= min) {
        const claim = await db.run(
          "UPDATE customers SET state = 'active', since = COALESCE(since, ?) WHERE id = ? AND state = 'pending_payment'",
          [iso(rt).slice(0, 10), customerId],
        );
        if (claim.changes === 1) {
          actions.push({ type: 'customer_activated', prev_state: 'pending_payment', prev_since: cust.since });
          const cons = await db.query<{ id: string; signed_at: string | null; paid_pct: unknown; advance_pct: unknown }>(
            "SELECT id, signed_at, paid_pct, advance_pct FROM contracts WHERE customer_id = ? AND state = 'pending_sign'", [customerId]);
          for (const k of cons) {
            const r = await db.run(
              "UPDATE contracts SET state = 'active', signed_at = COALESCE(signed_at, ?), paid_pct = CASE WHEN paid_pct < advance_pct THEN advance_pct ELSE paid_pct END WHERE id = ? AND state = 'pending_sign'",
              [iso(rt), k.id],
            );
            if (r.changes === 1) actions.push({ type: 'contract_activated', id: k.id, prev_state: 'pending_sign', prev_signed_at: k.signed_at, prev_paid_pct: n(k.paid_pct) });
          }
          await portalAccount(db, rt, customerId, cust, actions);
          await notify(db, rt, { customer: customerId, kind: 'account_activated', title: 'Tài khoản đã được kích hoạt', body: 'Khoản nạp đầu tiên đã đạt mức tối thiểu.' });
        }
      }
    }

    // chien dich cho nap tien (ca khi khach da active)
    for (const f of await runAwaitingFunds(db, rt, customerId, topupId)) actions.push({ type: 'campaign_funded', ...f });

    if (!actions.length) return { log_id: null, actions };
    const logId = rt.id();
    await db.run('INSERT INTO activation_log (id, customer_id, trigger_topup_id, actions, created_at) VALUES (?,?,?,?,?)', [logId, customerId, topupId, JSON.stringify(actions), iso(rt)]);
    await audit(db, rt, { action: 'finance.activation', type: 'customer', id: customerId, customer: customerId, diff: { log_id: logId, actions: actions.map((a) => a.type) } });
    return { log_id: logId, actions };
  });
}

async function portalAccount(
  db: Db, rt: Runtime, customerId: string,
  cust: { email: string | null; short_name: string; legal_name: string; payment_code: string },
  actions: ActivationAction[],
): Promise<void> {
  const existing = (await db.query<{ id: string }>("SELECT id FROM admins WHERE customer_id = ? AND account_kind = 'customer' LIMIT 1", [customerId]))[0];
  if (existing) {
    actions.push({ type: 'welcome_email_skipped', reason: 'portal_account_exists' });
    return;
  }
  const email = cust.email?.trim().toLowerCase();
  if (!email) {
    actions.push({ type: 'welcome_email_skipped', reason: 'customer_has_no_email' });
    return;
  }
  const taken = (await db.query('SELECT 1 AS x FROM admins WHERE email = ?', [email]))[0];
  if (taken) {
    actions.push({ type: 'welcome_email_skipped', reason: 'email_already_used' });
    return;
  }
  const tenant = (await db.query<{ tenant_id: string }>('SELECT tenant_id FROM customers WHERE id = ?', [customerId]))[0]!.tenant_id;
  const adminId = rt.id();
  const token = toBase64Url(randomBytes(24));
  const inviteId = rt.id();
  await db.run(
    "INSERT INTO admins (id, tenant_id, email, name, role, account_kind, customer_id, org_name, status, mfa_required, created_at) VALUES (?,?,?,?, 'customer', 'customer', ?, ?, 'invited', 1, ?)",
    [adminId, tenant, email, cust.short_name, customerId, cust.legal_name, iso(rt)],
  );
  const exp = new Date(rt.clock.now().getTime() + 72 * 3600_000).toISOString();
  await db.run(
    "INSERT INTO invites (id, admin_id, email, role, token_hash, invited_by, expires_at, created_at) VALUES (?,?,?, 'customer', ?, NULL, ?, ?)",
    [inviteId, adminId, email, await sha256Hex(token), exp, iso(rt)],
  );
  actions.push({ type: 'portal_account_created', admin_id: adminId, invite_id: inviteId, email });
  const base = (rt.config.env['PORTAL_PUBLIC_URL'] ?? '').replace(/\/$/, '');
  const link = `${base}/invite?token=${token}`;
  // thu di qua outbox CUNG giao dich (khong gui truc tiep): loi SMTP khong lam hong/rollback kich hoat; outbox thu lai (R1-05)
  await enqueueOutbox(db, rt, {
    topic: TOPIC_MAIL_SEND,
    dedupeKey: `mail:welcome:${inviteId}`,
    payload: {
      to: email,
      subject: 'Chào mừng đến AMS: tài khoản cổng khách hàng đã sẵn sàng',
      html: `<p>Xin chào ${escapeHtml(cust.short_name)},</p><p>Khoản thanh toán đã được ghi nhận và tài khoản của bạn đã được kích hoạt (mã khách hàng ${escapeHtml(cust.payment_code)}).</p><p><a href="${link}">Đặt mật khẩu và bật xác thực 2 lớp</a> (liên kết hết hạn sau 72 giờ).</p>`,
      text: `Tài khoản AMS đã được kích hoạt. Đặt mật khẩu và bật 2FA tại: ${link} (hết hạn sau 72 giờ).`,
    } satisfies MailPayload,
  });
  actions.push({ type: 'welcome_email_sent', to: email });
}

const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Hoan tac mot lan kich hoat. Khong hoan tien (tien nap van o vi). Chi hoan tac phan con an toan:
 * khach/hop dong tro lai trang thai cu, tai khoan cong bi khoa, chien dich chua chi duoc nha giu va quay lai awaiting_funds.
 */
export async function undoActivation(rt: Runtime, dbIn: Db, logId: string, actor: string | null): Promise<{ undone: string[]; skipped: string[] }> {
  const r = await undoActivationTx(rt, dbIn, logId, actor);
  await bumpManifest(rt);
  return r;
}

async function undoActivationTx(rt: Runtime, dbIn: Db, logId: string, actor: string | null): Promise<{ undone: string[]; skipped: string[] }> {
  return withTx(dbIn, async (db) => {
    const log = (await db.query<{ customer_id: string; actions: string }>('SELECT customer_id, actions FROM activation_log WHERE id = ?', [logId]))[0];
    if (!log) throw Object.assign(new Error('not_found'), { code: 'not_found' });
    const done = (await db.query('SELECT 1 AS x FROM activation_log WHERE trigger_topup_id = ?', [`undo:${logId}`]))[0];
    if (done) throw Object.assign(new Error('already_undone'), { code: 'already_undone' });
    const actions = JSON.parse(log.actions) as ActivationAction[];
    const undone: string[] = [];
    const skipped: string[] = [];
    // ghi dau da hoan tac truoc (chong hoan tac hai lan khi chay dong thoi khong the lam bang UNIQUE vi khong co cot: dung mot dong dau)
    const markId = rt.id();
    await db.run('INSERT INTO activation_log (id, customer_id, trigger_topup_id, actions, created_at) VALUES (?,?,?,?,?)', [markId, log.customer_id, `undo:${logId}`, '[]', iso(rt)]);
    for (const a of actions.slice().reverse()) {
      if (a.type === 'campaign_funded') {
        const c = (await db.query<{ spent_vnd: unknown; funding_state: string }>('SELECT spent_vnd, funding_state FROM campaigns WHERE id = ?', [a.campaign_id]))[0];
        if (!c || n(c.spent_vnd) > 0 || c.funding_state !== 'reserved') { skipped.push(`campaign:${a.campaign_id}`); continue; }
        await releaseCampaignNoCascade(rt, db, a.campaign_id);
        await transitionCampaign(db, { id: a.campaign_id, from: ['scheduled', 'active', 'paused'], to: 'awaiting_funds', nowIso: iso(rt), allowNone: true, set: { funding_state: 'awaiting_funds' }, where: { sql: "funding_state = 'released'" } });
        undone.push(`campaign:${a.campaign_id}`);
      } else if (a.type === 'portal_account_created') {
        await db.run("UPDATE admins SET status = 'disabled' WHERE id = ? AND status = 'invited'", [a.admin_id]);
        await db.run('UPDATE invites SET expires_at = ? WHERE id = ? AND accepted_at IS NULL', [iso(rt), a.invite_id]);
        undone.push(`portal_account:${a.admin_id}`);
      } else if (a.type === 'contract_activated') {
        const r = await db.run("UPDATE contracts SET state = ?, signed_at = ?, paid_pct = ? WHERE id = ? AND state = 'active'", [a.prev_state, a.prev_signed_at, a.prev_paid_pct, a.id]);
        (r.changes ? undone : skipped).push(`contract:${a.id}`);
      } else if (a.type === 'customer_activated') {
        const r = await db.run("UPDATE customers SET state = ?, since = ? WHERE id = ? AND state = 'active'", [a.prev_state, a.prev_since, log.customer_id]);
        (r.changes ? undone : skipped).push(`customer:${log.customer_id}`);
      }
    }
    await db.run('INSERT INTO activation_log (id, customer_id, trigger_topup_id, actions, created_at) VALUES (?,?,?,?,?)', [
      rt.id(), log.customer_id, `undo-detail:${logId}`, JSON.stringify({ undone, skipped }), iso(rt),
    ]);
    await audit(db, rt, { actor, action: 'finance.activation.undo', type: 'activation_log', id: logId, customer: log.customer_id, diff: { undone, skipped } });
    return { undone, skipped };
  });
}

// release khong chay lai runAwaitingFunds (se giu lai ngay chinh chien dich vua hoan tac)
async function releaseCampaignNoCascade(rt: Runtime, db: Db, campaignId: string): Promise<void> {
  const c = (await db.query<{ customer_id: string; reserved_vnd: unknown }>('SELECT customer_id, reserved_vnd FROM campaigns WHERE id = ?', [campaignId]))[0]!;
  const amt = n(c.reserved_vnd);
  const claim = await db.run("UPDATE campaigns SET reserved_vnd = 0, funding_state = 'released', updated_at = ? WHERE id = ? AND funding_state = 'reserved' AND reserved_vnd = ?", [iso(rt), campaignId, amt]);
  if (claim.changes !== 1) return;
  const rows = await db.query<{ balance_vnd: unknown; reserved_vnd: unknown }>(
    'UPDATE ad_wallets SET reserved_vnd = reserved_vnd - ?, updated_at = ? WHERE customer_id = ? AND reserved_vnd >= ? RETURNING balance_vnd, reserved_vnd', [amt, iso(rt), c.customer_id, amt]);
  if (rows[0] && amt > 0) {
    await db.run(
      'INSERT INTO wallet_entries (id, customer_id, kind, amount_vnd, balance_after, reserved_after, ref_type, ref_id, note, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [rt.id(), c.customer_id, 'release', amt, n(rows[0].balance_vnd), n(rows[0].reserved_vnd), 'campaign', campaignId, 'Hoàn tác kích hoạt', iso(rt)],
    );
  }
}

