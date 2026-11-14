import { useEffect, useState } from 'react';
import { API_BASE } from '../api/client';

interface PublicStatus {
  status: 'operational' | 'degraded' | 'major_outage';
  updated_at: string;
  components: { id: string; name: string; status: 'operational' | 'degraded' | 'major_outage' }[];
  incidents: { component: string; level: string; message: string; since: string }[];
}
const LABEL = { operational: 'Hoạt động bình thường', degraded: 'Suy giảm một phần', major_outage: 'Gián đoạn' } as const;
const COLOR = { operational: '#1a8f4c', degraded: '#c77d00', major_outage: '#c62828' } as const;

/** Trang trạng thái công khai (không cần đăng nhập): đọc GET /status, chỉ hiện mức thành phần và thông báo an toàn. */
export default function Status() {
  const [s, setS] = useState<PublicStatus | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const r = await fetch(`${API_BASE}/status`, { headers: { Accept: 'application/json' } });
        const j = (await r.json()) as PublicStatus;
        if (live) { setS(j); setErr(false); }
      } catch {
        if (live) setErr(true);
      }
    };
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => { live = false; clearInterval(t); };
  }, []);
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '32px 16px', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ margin: '0 0 4px' }}>Trạng thái hệ thống AMS</h1>
      <p style={{ margin: '0 0 20px', color: '#666' }}>Cập nhật tự động mỗi phút.</p>
      {err && !s ? <p role="alert">Không tải được trạng thái. Nếu bạn không vào được trang này, hệ thống có thể đang gián đoạn.</p> : null}
      {s ? (
        <>
          <div role="status" style={{ padding: 16, borderRadius: 8, color: '#fff', background: COLOR[s.status], fontWeight: 600, marginBottom: 16 }}>{LABEL[s.status]}</div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, border: '1px solid #ddd', borderRadius: 8 }}>
            {s.components.map((c) => (
              <li key={c.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #eee' }}>
                <span>{c.name}</span><span style={{ color: COLOR[c.status], fontWeight: 600 }}>{LABEL[c.status]}</span>
              </li>
            ))}
          </ul>
          {s.incidents.length ? (
            <section style={{ marginTop: 20 }}>
              <h2 style={{ fontSize: 18 }}>Sự cố đang xử lý</h2>
              <ul>{s.incidents.map((i, k) => (<li key={k}>{i.message} <small style={{ color: '#666' }}>(từ {new Date(i.since).toLocaleString('vi-VN')})</small></li>))}</ul>
            </section>
          ) : null}
          <p style={{ color: '#666', marginTop: 20 }}><small>Cập nhật lúc {new Date(s.updated_at).toLocaleString('vi-VN')}. Liên hệ hỗ trợ: support@anio.vn</small></p>
        </>
      ) : null}
    </main>
  );
}
