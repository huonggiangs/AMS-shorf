import { Hono } from 'hono';
import { eq, jsonParse, runList } from '../lib/http.js';
import type { ListSpec } from '../lib/http.js';
import { requirePerm } from '../auth/middleware.js';
import type { AppEnv } from '../types.js';


interface Row {
  id: string;
  ts: string;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  object_type: string | null;
  object_id: string | null;
  customer_id: string | null;
  ip: string | null;
  diff: string | null;
}

const spec: ListSpec = {
  from: 'FROM audit_log l LEFT JOIN admins a ON a.id = l.actor_id',
  select: 'l.id, l.ts, l.actor_id, a.name AS actor_name, l.action, l.object_type, l.object_id, l.customer_id, l.ip, l.diff',
  search: ['l.action', 'a.name', 'l.object_id', 'l.object_type'],
  sorts: { at: 'l.ts', action: 'l.action', actor: 'a.name' },
  defaultSort: 'at:desc',
  tiebreak: 'l.id',
  filters: {
    action: (v) => ({ sql: 'l.action LIKE ?', params: [`${v.replace(/[%_\\]/g, '')}%`] }),
    actor_id: eq('l.actor_id'),
    object_type: eq('l.object_type'),
    object_id: eq('l.object_id'),
    customer_id: eq('l.customer_id'),
  },
};

// Chi doc: khong co route sua/xoa. diff khong chua PII (ghi luc tao).
export function auditRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.get('/', requirePerm('admin', 'view'), async (c) => {
    const res = await runList<Row>(c, spec);
    return c.json({
      ...res,
      items: res.items.map((l) => {
        const d = jsonParse<Record<string, unknown>>(l.diff, {});
        const obj = typeof d['obj'] === 'string' ? (d['obj'] as string) : l.object_type ? `${l.object_type}${l.object_id ? `:${l.object_id}` : ''}` : null;
        return { id: l.id, at: l.ts, actor: l.actor_name ?? l.actor_id ?? 'system', actor_id: l.actor_id, action: l.action, object: obj, object_type: l.object_type, object_id: l.object_id, customer_id: l.customer_id, ip: l.ip, diff: jsonParse(l.diff, null) };
      }),
    });
  });
  return r;
}
