import { Hono } from 'hono';
import { z } from 'zod';
import { formatVnd, vndToWordsVi } from '@ams/shared';
import type { Runtime } from '@ams/runtime';
import { audit as auditCtx } from '../lib/audit-ctx.js';
import { diffObjects } from '../lib/audit.js';
import { AAD, decField } from '../lib/crypto.js';
import { conflict, forbidden, notFound, unprocessable } from '../lib/errors.js';
import { eq, eqMapped, getRt, jsonParse, num, parseBody, runList } from '../lib/http.js';
import type { Ctx, ListSpec } from '../lib/http.js';
import { addMonths, fmtDmy, isDate, todayVn } from '../lib/dates.js';
import { esc } from '../lib/mail.js';
import { hasPerm, requirePerm } from '../auth/middleware.js';
import type { AppEnv } from '../types.js';

const STATE_TO_API: Record<string, string> = { active: 'effective', paused: 'suspended' };
const STATE_FROM_API: Record<string, string> = { effective: 'active', suspended: 'paused' };

const K_SELECT = `ct.id, ct.no, ct.customer_id, ct.title, ct.value_vnd, ct.vat_rate, ct.start_date, ct.end_date, ct.advance_pct, ct.paid_pct, ct.payment_terms, ct.state, ct.signed_at, ct.template_id, ct.created_at,
  cu.short_name AS customer_name, cu.payment_code AS customer_code`;
const K_FROM = 'FROM contracts ct JOIN customers cu ON cu.id = ct.customer_id';

interface ContractRow {
  id: string;
  no: string;
  customer_id: string;
  title: string;
  value_vnd: number;
  vat_rate: number;
  start_date: string | null;
  end_date: string | null;
  advance_pct: number;
  paid_pct: number;
  payment_terms: string | null;
  state: string;
  signed_at: string | null;
  template_id: string | null;
  created_at: string;
  customer_name: string;
  customer_code: string;
}

const present = (r: ContractRow) => ({
  id: r.id,
  number: r.no,
  customer_id: r.customer_id,
  customer_name: r.customer_name,
  customer_code: r.customer_code,
  title: r.title,
  value_vnd: num(r.value_vnd),
  vat_rate: num(r.vat_rate),
  start_date: r.start_date,
  end_date: r.end_date,
  advance_pct: num(r.advance_pct),
  paid_pct: num(r.paid_pct),
  payment_terms: r.payment_terms,
  status: STATE_TO_API[r.state] ?? r.state,
  signed_at: r.signed_at,
  created_at: r.created_at,
});

const spec: ListSpec = {
  from: K_FROM,
  select: K_SELECT,
  search: ['ct.no', 'ct.title', 'cu.short_name', 'cu.legal_name'],
  sorts: { number: 'ct.no', value_vnd: 'ct.value_vnd', start_date: 'ct.start_date', end_date: 'ct.end_date', paid_pct: 'ct.paid_pct', status: 'ct.state', created_at: 'ct.created_at', customer: 'cu.short_name' },
  defaultSort: 'number:asc',
  tiebreak: 'ct.id',
  filters: { status: eqMapped('ct.state', STATE_FROM_API), customer_id: eq('ct.customer_id') },
};

async function loadContract(c: Ctx, id: string): Promise<ContractRow> {
  const r = (await getRt(c).db.query<ContractRow>(`SELECT ${K_SELECT} ${K_FROM} WHERE ct.id = ?`, [id]))[0];
  if (!r) throw notFound('Không tìm thấy hợp đồng.');
  return r;
}

const dateStr = z.string().refine(isDate, 'Ngày phải theo dạng YYYY-MM-DD');
const createBody = z.object({
  customer_id: z.string().min(1).max(64),
  number: z.string().trim().max(60).optional().nullable(),
  title: z.string().trim().max(300).optional().nullable(),
  value_vnd: z.coerce.number().int().min(0).max(1e14),
  vat_rate: z.coerce.number().int().min(0).max(30).optional(),
  start_date: dateStr.optional().nullable(),
  months: z.coerce.number().int().min(1).max(120).default(12),
  advance_pct: z.coerce.number().int().min(0).max(100).default(0),
  payment_terms: z.string().trim().max(300).optional().nullable(),
});
const updateBody = z.object({
  title: z.string().trim().max(300).optional(),
  value_vnd: z.coerce.number().int().min(0).max(1e14).optional(),
  vat_rate: z.coerce.number().int().min(0).max(30).optional(),
  start_date: dateStr.optional(),
  end_date: dateStr.optional(),
  advance_pct: z.coerce.number().int().min(0).max(100).optional(),
  payment_terms: z.string().trim().max(300).optional(),
  status: z.enum(['pending_sign', 'effective', 'suspended', 'expired', 'terminated', 'draft']).optional(),
});

// ---------- dung hop dong tu mau ----------
function renderInline(text: string, vars: Record<string, string>): string {
  let out = '';
  let last = 0;
  const re = /\{\{\s*([a-z_.]+)\s*\}\}/g;
  for (const m of text.matchAll(re)) {
    out += esc(text.slice(last, m.index));
    out += esc(vars[m[1]!] ?? '……………');
    last = m.index! + m[0].length;
  }
  out += esc(text.slice(last));
  return out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/ {3,}/g, '<span class="gap"></span>');
}

export function mdToHtml(md: string, vars: Record<string, string>): string {
  return md
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      if (block.startsWith('# ')) return `<h1>${renderInline(block.slice(2), vars)}</h1>`;
      return `<p>${block.split('\n').map((l) => renderInline(l, vars)).join('<br>')}</p>`;
    })
    .join('\n');
}

export async function renderContract(rt: Runtime, row: ContractRow, over: { advance_pct?: number | undefined; months?: number | undefined }): Promise<{ html: string; amount_in_words: string }> {
  const tpl = (
    row.template_id
      ? await rt.db.query<{ id: string; version: number; body_md: string }>('SELECT id, version, body_md FROM contract_templates WHERE id = ?', [row.template_id])
      : await rt.db.query<{ id: string; version: number; body_md: string }>('SELECT id, version, body_md FROM contract_templates WHERE active = 1 ORDER BY version DESC LIMIT 1')
  )[0];
  if (!tpl) throw notFound('Chưa có hợp đồng mẫu đang áp dụng.', 'template_not_found');
  const cu = (
    await rt.db.query<{ legal_name: string; tax_code_enc: string | null; address: string | null; rep_name: string | null; rep_title: string | null; phone: string | null }>(
      'SELECT legal_name, tax_code_enc, address, rep_name, rep_title, phone FROM customers WHERE id = ?',
      [row.customer_id],
    )
  )[0];
  if (!cu) throw notFound('Không tìm thấy khách hàng của hợp đồng.');
  const seller = jsonParse<Record<string, string>>((await rt.db.query<{ value: string }>("SELECT value FROM settings WHERE key = 'seller'"))[0]?.value, {});
  let tax = '';
  if (cu.tax_code_enc) {
    try {
      tax = await decField(rt, cu.tax_code_enc, AAD.taxCode);
    } catch {
      tax = '';
    }
  }
  const start = row.start_date ?? todayVn(rt);
  const end = over.months ? addMonths(start, over.months) : (row.end_date ?? addMonths(start, 12));
  const value = num(row.value_vnd);
  const words = vndToWordsVi(value, { capitalize: true });
  const vars: Record<string, string> = {
    'seller.name': seller['name'] ?? '', 'seller.tax_code': seller['tax_code'] ?? '', 'seller.address': seller['address'] ?? '', 'seller.rep': seller['rep'] ?? '', 'seller.email': seller['email'] ?? '',
    'customer.legal_name': cu.legal_name, 'customer.tax_code': tax, 'customer.address': cu.address ?? '', 'customer.rep_name': cu.rep_name ?? '', 'customer.rep_title': cu.rep_title ?? '', 'customer.phone': cu.phone ?? '',
    'contract.no': row.no, 'contract.start_date': fmtDmy(start), 'contract.end_date': fmtDmy(end), 'contract.value_vnd': formatVnd(value), 'contract.value_words': words,
    'contract.vat_rate': String(num(row.vat_rate)), 'contract.advance_pct': String(over.advance_pct ?? num(row.advance_pct)), 'contract.payment_terms': row.payment_terms ?? 'theo thỏa thuận',
  };
  const body = mdToHtml(tpl.body_md, vars);
  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<title>${esc(row.no)}</title>
<style>@page{size:A4;margin:20mm}body{font:14px/1.65 "Times New Roman",serif;color:#111;background:#fff;margin:0;padding:24px}.doc{max-width:800px;margin:0 auto}h1{text-align:center;font-size:20px;margin:0 0 8px}p{margin:0 0 10px;text-align:justify}.gap{display:inline-block;width:3em}.note{margin-top:24px;padding:8px 12px;border:1px dashed #999;font:12px/1.5 sans-serif;color:#555}@media print{.note{display:none}}</style></head>
<body><div class="doc">${body}<div class="note">Hợp đồng mẫu tham khảo, được điền sẵn từ hồ sơ khách hàng. Luật sư của công ty phải rà soát trước khi sử dụng chính thức.</div></div></body></html>`;
  return { html, amount_in_words: words };
}

async function nextContractNo(rt: Runtime, db: { query: Runtime['db']['query'] }, year: string): Promise<string> {
  const rows = await db.query<{ no: string }>('SELECT no FROM contracts WHERE no LIKE ? ORDER BY LENGTH(no) DESC, no DESC LIMIT 20', [`HD-${year}-%`]);
  let max = 0;
  for (const r of rows) {
    const n = Number(r.no.split('-').pop());
    if (Number.isInteger(n) && n > max) max = n;
  }
  void rt;
  return `HD-${year}-${String(max + 1).padStart(3, '0')}`;
}

export function contractRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get('/', requirePerm('customers', 'view'), async (c) => {
    const res = await runList<ContractRow>(c, spec);
    return c.json({ ...res, items: res.items.map(present) });
  });

  r.get('/:id', requirePerm('customers', 'view'), async (c) => {
    const rt = getRt(c);
    const row = await loadContract(c, c.req.param('id'));
    const lines = await rt.db.query('SELECT id, screen_type, region_id, daypart, frequency, duration_s, unit_price_vnd, qty FROM contract_lines WHERE contract_id = ? ORDER BY id', [row.id]);
    return c.json({ ...present(row), lines });
  });

  r.post('/', requirePerm('customers', 'write'), async (c) => {
    const rt = getRt(c);
    const u = c.get('user');
    const b = await parseBody(c, createBody);
    const cu = (await rt.db.query<{ id: string; payment_terms: string | null; state: string }>('SELECT id, payment_terms, state FROM customers WHERE id = ?', [b.customer_id]))[0];
    if (!cu) throw unprocessable('Khách hàng không tồn tại.', 'customer_not_found');
    if (cu.state === 'terminated') throw conflict('Khách hàng đã chấm dứt hợp tác.', 'customer_inactive');
    const start = b.start_date ?? todayVn(rt);
    const end = addMonths(start, b.months);
    const tpl = (await rt.db.query<{ id: string }>('SELECT id FROM contract_templates WHERE active = 1 ORDER BY version DESC LIMIT 1'))[0];
    const id = rt.id();
    const nowIso = rt.clock.now().toISOString();
    let no = b.number?.trim() || '';
    let err: unknown;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await rt.db.tx(async (db) => {
          const number = no || (await nextContractNo(rt, db, start.slice(0, 4)));
          await db.run(
            `INSERT INTO contracts (id, no, customer_id, title, value_vnd, vat_rate, start_date, end_date, advance_pct, paid_pct, payment_terms, state, template_id, created_by, created_at)
             VALUES (?,?,?,?,?,?,?,?,?,0,?, 'pending_sign', ?, ?, ?)`,
            [id, number, b.customer_id, b.title || 'Hợp đồng dịch vụ quảng cáo', b.value_vnd, b.vat_rate ?? 10, start, end, b.advance_pct, b.payment_terms ?? cu.payment_terms, tpl?.id ?? null, u.id, nowIso],
          );
          await auditCtx(c, db, { action: 'contract.create', objectType: 'contract', objectId: id, customerId: b.customer_id, diff: { no: number, value_vnd: b.value_vnd } });
        });
        err = undefined;
        break;
      } catch (e) {
        err = e;
        if (no || !/unique|duplicate|constraint/i.test((e as Error).message ?? '')) break;
      }
    }
    if (err) {
      if (/unique|duplicate|constraint/i.test((err as Error).message ?? '')) throw conflict('Số hợp đồng đã tồn tại.', 'duplicate_contract_no');
      throw err;
    }
    return c.json(present(await loadContract(c, id)), 201);
  });

  r.put('/:id', requirePerm('customers', 'write'), async (c) => {
    const rt = getRt(c);
    const row = await loadContract(c, c.req.param('id'));
    const b = await parseBody(c, updateBody);
    const editable = ['draft', 'pending_sign'].includes(row.state);
    const fieldsTouched = [b.title, b.value_vnd, b.vat_rate, b.start_date, b.end_date, b.advance_pct, b.payment_terms].some((x) => x !== undefined);
    if (fieldsTouched && !editable) throw conflict('Chỉ sửa nội dung hợp đồng ở trạng thái bản nháp hoặc chờ ký.', 'invalid_state');
    const start = b.start_date ?? row.start_date;
    const end = b.end_date ?? row.end_date;
    if (start && end && end < start) throw unprocessable('Ngày kết thúc phải sau ngày bắt đầu.', 'bad_dates');
    const sets: string[] = [];
    const params: unknown[] = [];
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    const put = (col: string, key: string, v: unknown, cur: unknown) => {
      if (v === undefined) return;
      sets.push(`${col} = ?`);
      params.push(v);
      before[key] = cur;
      after[key] = v;
    };
    put('title', 'title', b.title, row.title);
    put('value_vnd', 'value_vnd', b.value_vnd, num(row.value_vnd));
    put('vat_rate', 'vat_rate', b.vat_rate, row.vat_rate);
    put('start_date', 'start_date', b.start_date, row.start_date);
    put('end_date', 'end_date', b.end_date, row.end_date);
    put('advance_pct', 'advance_pct', b.advance_pct, row.advance_pct);
    put('payment_terms', 'payment_terms', b.payment_terms, row.payment_terms);
    if (b.status !== undefined) {
      const to = STATE_FROM_API[b.status] ?? b.status;
      if (to !== row.state) {
        if ((to === 'active' || to === 'terminated') && !hasPerm(c, 'customers', 'approve')) throw forbidden('Chỉ người có quyền duyệt mới kích hoạt hoặc chấm dứt hợp đồng.', 'forbidden', { module: 'customers', action: 'approve' });
        put('state', 'status', to, row.state);
        if (to === 'active' && !row.signed_at) {
          sets.push('signed_at = ?');
          params.push(rt.clock.now().toISOString());
        }
      }
    }
    if (!sets.length) return c.json(present(row));
    await rt.db.tx(async (db) => {
      await db.run(`UPDATE contracts SET ${sets.join(', ')} WHERE id = ?`, [...params, row.id]);
      await auditCtx(c, db, { action: 'contract.update', objectType: 'contract', objectId: row.id, customerId: row.customer_id, diff: diffObjects(before, after) });
    });
    return c.json(present(await loadContract(c, row.id)));
  });

  r.post('/:id/render', requirePerm('customers', 'view'), async (c) => {
    const rt = getRt(c);
    const row = await loadContract(c, c.req.param('id'));
    const b = await parseBody(c, z.object({ advance_pct: z.coerce.number().int().min(0).max(100).optional(), months: z.coerce.number().int().min(1).max(120).optional() }));
    const out = await renderContract(rt, row, b);
    return c.json({ ...out, contract_no: row.no });
  });

  return r;
}
