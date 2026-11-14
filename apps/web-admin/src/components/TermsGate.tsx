import { useEffect, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMsg, onTermsRequired } from '../api/client';
import { useAuth } from '../auth/AuthProvider';
import { LEGAL_KIND_LABEL, s } from '../lib/p4';
import { Btn, Note } from './ui';

interface Pending { id: string; kind: string; version: string; title: string; sha256: string; body_md: string }

/**
 * Cong chap nhan dieu khoan (chi tai khoan ben ngoai): khi co van ban da phat hanh chua chap nhan (lan dau dang nhap hoac co phien ban moi),
 * chan toan bo giao dien cho den khi khach doc va dong y. Loi tai danh sach => khong chan (may chu van la noi chan that, 403 terms_acceptance_required).
 */
export function TermsGate({ children }: { children: ReactNode }) {
  const { isExternal } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['/portal/v1/legal/pending'],
    enabled: isExternal,
    retry: false,
    queryFn: () => api.get('/portal/v1/legal/pending') as Promise<{ pending?: Pending[] }>,
  });
  useEffect(() => {
    const off = onTermsRequired(() => void q.refetch());
    return () => void off();
  }, [q]);
  const pending = q.data?.pending ?? [];
  if (!isExternal || q.isError || pending.length === 0) return <>{children}</>;
  return <Gate pending={pending} onDone={() => void qc.invalidateQueries()} />;
}

function Gate({ pending, onDone }: { pending: Pending[]; onDone: () => void }) {
  const [ok, setOk] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const all = pending.every((d) => ok[d.id]);
  const submit = async () => {
    setBusy(true);
    setErr('');
    try {
      await api.post('/portal/v1/legal/accept', { body: { acceptances: pending.map((d) => ({ document_id: d.id, sha256: d.sha256 })) } });
      onDone();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="tvn" role="dialog" aria-modal="true" aria-label="Chấp nhận điều khoản" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div className="card cp" style={{ width: 'min(760px,100%)' }}>
        <h1 style={{ margin: '0 0 6px', fontSize: 22 }}>Điều khoản cần chấp nhận</h1>
        <p className="sub">Vui lòng đọc và đồng ý với các văn bản dưới đây để tiếp tục sử dụng hệ thống. Việc đồng ý được ghi lại (thời điểm, địa chỉ IP, phiên bản).</p>
        {pending.map((d) => (
          <section key={d.id} style={{ margin: '14px 0' }}>
            <h2 style={{ fontSize: 16, margin: '0 0 6px' }}>{LEGAL_KIND_LABEL[d.kind] ?? d.kind} <small style={{ color: 'var(--mut)' }}>· {d.title} · phiên bản {s(d.version)}</small></h2>
            <pre tabIndex={0} aria-label={`Nội dung ${d.title}`} style={{ maxHeight: 220, overflow: 'auto', whiteSpace: 'pre-wrap', background: 'var(--bg2, rgba(127,127,127,.08))', padding: 12, borderRadius: 8, fontFamily: 'inherit', fontSize: 14 }}>{d.body_md}</pre>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
              <input type="checkbox" checked={!!ok[d.id]} onChange={(e) => setOk({ ...ok, [d.id]: e.target.checked })} />
              Tôi đã đọc và đồng ý với {LEGAL_KIND_LABEL[d.kind] ?? d.title} (phiên bản {s(d.version)})
            </label>
          </section>
        ))}
        {err ? <Note warn>{err}</Note> : null}
        <div className="da" style={{ marginTop: 12 }}>
          <Btn tone="p" disabled={!all || busy} onClick={() => void submit()}>{busy ? 'Đang ghi nhận…' : 'Đồng ý và tiếp tục'}</Btn>
        </div>
      </div>
    </div>
  );
}
