import type { Context } from 'hono';
import type { ZodTypeAny, z } from 'zod';
import type { Runtime } from '@ams/runtime';
import { badRequest, unprocessable } from './errors.js';
import type { AppEnv } from '../types.js';

export type Ctx = Context<AppEnv>;

export const getRt = (c: Ctx): Runtime => c.get('rt');

/** Doc JSON; body rong = {}; loi cu phap = 400. */
export async function readJson(c: Ctx): Promise<unknown> {
  const text = await c.req.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw badRequest('Nội dung gửi lên không phải JSON hợp lệ.', 'bad_json');
  }
}

export async function parseBody<S extends ZodTypeAny>(c: Ctx, schema: S): Promise<z.infer<S>> {
  const raw = await readJson(c);
  return validate(schema, raw);
}

export function validate<S extends ZodTypeAny>(schema: S, raw: unknown): z.infer<S> {
  const r = schema.safeParse(raw);
  if (!r.success) {
    const first = r.error.issues[0];
    const where = first && first.path.length ? first.path.join('.') : '';
    throw unprocessable(`Dữ liệu không hợp lệ${where ? ` (${where})` : ''}: ${first?.message ?? 'sai định dạng'}.`, 'validation_error', r.error.flatten());
  }
  return r.data;
}

/** IP client: Cloudflare, sau do proxy (Caddy/nginx), sau do 'unknown'. Dat TRUST_PROXY=0 de bo qua header. */
export function clientIp(c: Ctx): string {
  const env = c.get('rt').config.env;
  if (env['TRUST_PROXY'] === '0') return 'unknown';
  const h = c.req.header.bind(c.req);
  const ip = h('cf-connecting-ip') ?? h('x-real-ip') ?? h('x-forwarded-for')?.split(',')[0]?.trim();
  return (ip && ip.length <= 64 ? ip : 'unknown');
}

// ---------------- danh sach: page, page_size, q, sort, filter ----------------
export interface SqlFrag {
  sql: string;
  params: unknown[];
}
export interface FilterDef {
  (value: string): SqlFrag | null;
}
export interface ListSpec {
  /** `FROM ... JOIN ...` (khong co WHERE) */
  from: string;
  /** danh sach cot SELECT */
  select: string;
  /** dieu kien co dinh (phan quyen/pham vi) – luon ap dung, trong SQL */
  where?: SqlFrag[];
  /** bieu thuc SQL de tim q */
  search?: string[];
  /** ten truong API -> bieu thuc SQL cho ORDER BY (danh sach trang) */
  sorts: Record<string, string>;
  defaultSort: string;
  /** khoa phu de phan trang on dinh, vd `c.id` */
  tiebreak: string;
  filters: Record<string, FilterDef>;
}

const RESERVED = new Set(['page', 'page_size', 'q', 'sort', 'filter']);
export const MAX_PAGE_SIZE = 200;

export const eq = (col: string): FilterDef => (v) => ({ sql: `${col} = ?`, params: [v] });
export const eqMapped = (col: string, map: Record<string, string | string[]>): FilterDef => (v) => {
  const m = map[v] ?? v;
  const arr = Array.isArray(m) ? m : [m];
  return { sql: `${col} IN (${arr.map(() => '?').join(',')})`, params: arr };
};
export const num = (n: unknown, d = 0): number => {
  const x = Number(n);
  return Number.isFinite(x) ? x : d;
};

export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

function intParam(v: string | undefined, def: number, min: number, max: number): number {
  if (v === undefined || v === '') return def;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) throw badRequest('Tham số phân trang không hợp lệ.', 'bad_pagination');
  return Math.min(max, Math.max(min, n));
}

export interface ListResult<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export function parseFilters(c: Ctx, spec: ListSpec): Map<string, string> {
  const out = new Map<string, string>();
  const raw = c.req.query('filter');
  if (raw) {
    for (const part of raw.split(',')) {
      const i = part.indexOf(':');
      if (i <= 0) continue;
      const k = part.slice(0, i).trim();
      const v = part.slice(i + 1).trim();
      if (k && v) out.set(k, v);
    }
  }
  for (const [k, v] of Object.entries(c.req.query())) {
    if (!RESERVED.has(k) && Object.hasOwn(spec.filters, k) && v) out.set(k, v);
  }
  return out;
}

/** Chay danh sach phan trang phia may chu. Moi gia tri di qua tham so; ten cot chi lay tu bang trang. */
export async function runList<T extends object>(c: Ctx, spec: ListSpec, extra: SqlFrag[] = []): Promise<ListResult<T>> {
  const rt = getRt(c);
  const page = intParam(c.req.query('page'), 1, 1, 1_000_000);
  const pageSize = intParam(c.req.query('page_size'), 20, 1, MAX_PAGE_SIZE);
  const where: SqlFrag[] = [...(spec.where ?? []), ...extra];

  for (const [k, v] of parseFilters(c, spec)) {
    const def = Object.hasOwn(spec.filters, k) ? spec.filters[k] : undefined;
    const frag = def ? def(v) : null;
    if (frag) where.push(frag);
  }
  const q = c.req.query('q')?.trim();
  if (q && spec.search?.length) {
    const lower = escapeLike(q.toLowerCase());
    const raw = escapeLike(q);
    const ors: string[] = [];
    const params: unknown[] = [];
    for (const col of spec.search) {
      ors.push(`(LOWER(${col}) LIKE ? ESCAPE '\\' OR ${col} LIKE ? ESCAPE '\\')`);
      params.push(`%${lower}%`, `%${raw}%`);
    }
    where.push({ sql: `(${ors.join(' OR ')})`, params });
  }

  const sortRaw = c.req.query('sort') || spec.defaultSort;
  const [sf, sd] = sortRaw.split(':');
  const field = sf && Object.hasOwn(spec.sorts, sf) ? sf : spec.defaultSort.split(':')[0]!;
  const dir = (sd ?? spec.defaultSort.split(':')[1] ?? 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  const orderBy = `${spec.sorts[field]} ${dir}, ${spec.tiebreak} ${dir}`;

  const whereSql = where.length ? ` WHERE ${where.map((w) => `(${w.sql})`).join(' AND ')}` : '';
  const params = where.flatMap((w) => w.params);
  const total = num((await rt.db.query<{ n: number }>(`SELECT COUNT(*) AS n ${spec.from}${whereSql}`, params))[0]?.n);
  const items = await rt.db.query<T>(`SELECT ${spec.select} ${spec.from}${whereSql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`, [...params, pageSize, (page - 1) * pageSize]);
  return { items, total, page, page_size: pageSize };
}

export const jsonParse = <T>(s: unknown, fallback: T): T => {
  if (typeof s !== 'string' || !s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

export const placeholders = (n: number): string => Array.from({ length: n }, () => '?').join(',');
export const isoDate = (iso: string | null | undefined): string | null => (iso ? String(iso).slice(0, 10) : null);
