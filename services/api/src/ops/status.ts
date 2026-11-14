// Trang trang thai cong khai: chi cap do thanh phan + cau mo ta an toan (public_note). Khong lo so lieu, ma quy tac, ten host hay chi tiet su co.
import type { Runtime } from '@ams/runtime';

export type ComponentStatus = 'operational' | 'degraded' | 'major_outage';
export interface PublicComponent {
  id: string;
  name: string;
  status: ComponentStatus;
}
export interface PublicStatus {
  status: ComponentStatus;
  updated_at: string;
  components: PublicComponent[];
  incidents: { component: string; level: 'degraded' | 'major_outage'; message: string; since: string }[];
}

// component noi bo -> thanh phan cong khai
const MAP: Record<string, string> = { api: 'admin', db: 'admin', gateway: 'devices', devices: 'devices', payments: 'payments', queue: 'ads' };
const NAMES: { id: string; name: string }[] = [
  { id: 'admin', name: 'Trang quản trị và cổng khách hàng' },
  { id: 'devices', name: 'Kết nối thiết bị TV' },
  { id: 'ads', name: 'Phát và ghi nhận quảng cáo' },
  { id: 'payments', name: 'Thanh toán và nạp tiền' },
];
const rank: Record<ComponentStatus, number> = { operational: 0, degraded: 1, major_outage: 2 };
const worse = (a: ComponentStatus, b: ComponentStatus): ComponentStatus => (rank[a] >= rank[b] ? a : b);
const CACHE_KEY = 'ops:public_status';

export async function computePublicStatus(rt: Runtime, useCache = true): Promise<{ body: PublicStatus; httpStatus: number }> {
  if (useCache) {
    try {
      const c = await rt.kv.get(CACHE_KEY);
      if (c) return { body: JSON.parse(c) as PublicStatus, httpStatus: 200 };
    } catch {
      /* kv hong: tinh truc tiep */
    }
  }
  const now = rt.clock.now().toISOString();
  const comps = new Map<string, ComponentStatus>(NAMES.map((n) => [n.id, 'operational']));
  const incidents: PublicStatus['incidents'] = [];
  let dbOk = true;
  try {
    await rt.db.query('SELECT 1 AS ok');
  } catch {
    dbOk = false;
  }
  if (!dbOk) {
    const body: PublicStatus = { status: 'major_outage', updated_at: now, components: NAMES.map((n) => ({ ...n, status: 'major_outage' as const })), incidents: [{ component: 'admin', level: 'major_outage', message: 'Hệ thống đang gián đoạn, chúng tôi đang xử lý.', since: now }] };
    return { body, httpStatus: 503 };
  }
  try {
    const rows = await rt.db.query<{ component: string; severity: string; public_note: string | null; opened_at: string }>("SELECT component, severity, public_note, opened_at FROM ops_incidents WHERE status <> 'resolved' AND public_note IS NOT NULL AND public_note <> '' ORDER BY opened_at");
    for (const r of rows) {
      const id = MAP[r.component];
      if (!id) continue;
      const lvl: 'degraded' | 'major_outage' = r.severity === 'S1' ? 'major_outage' : 'degraded';
      if (r.severity === 'S3') continue; // S3 = khong anh huong nguoi dung
      comps.set(id, worse(comps.get(id) ?? 'operational', lvl));
      if (!incidents.some((i) => i.component === id && i.message === r.public_note)) incidents.push({ component: id, level: lvl, message: r.public_note!, since: r.opened_at.slice(0, 16) + ':00.000Z' });
    }
  } catch {
    /* chua migrate 0009: coi nhu binh thuong */
  }
  const components = NAMES.map((n) => ({ ...n, status: comps.get(n.id) ?? 'operational' }));
  const overall = components.reduce<ComponentStatus>((a, c) => worse(a, c.status), 'operational');
  const body: PublicStatus = { status: overall, updated_at: now, components, incidents };
  try {
    await rt.kv.set(CACHE_KEY, JSON.stringify(body), 30);
  } catch {
    /* khong cache duoc */
  }
  return { body, httpStatus: 200 };
}
