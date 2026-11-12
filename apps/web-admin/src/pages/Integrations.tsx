import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { listOf, partnerSchema, type Partner } from '../api/schemas';
import { useAct } from '../api/hooks';
import { useAuth } from '../auth/AuthProvider';
import { Btn, EmptyBlock, ErrorBlock, Field, LoadingBlock, Note, PageHead, StatusTag } from '../components/ui';
import { Dialog } from '../components/Dialog';
import { useT } from '../i18n';

const ini = (n: string) => n.split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();

export default function Integrations() {
  const t = useT();
  const { can } = useAuth();
  const act = useAct();
  const [cfg, setCfg] = useState<Partner | null>(null);
  const [f, setF] = useState({ endpoint: '', auth: '' });
  const q = useQuery({ queryKey: ['/admin/v1/partners', 'cards2'], queryFn: () => api.get('/admin/v1/partners', { query: { page_size: 50 }, schema: listOf(partnerSchema) }) });
  return (
    <>
      <PageHead title="Tích hợp API quảng cáo" sub="Cấu hình đối tác tiếp nhận chiến dịch, RTB và đưa creative vào lịch phát." />
      <Note>Chưa tìm thấy tài liệu API Publish công khai của các đối tác. Giao thức chỉ là đề xuất chưa xác minh; chưa gửi request thật.</Note>
      {q.isLoading ? <LoadingBlock /> : q.isError ? <ErrorBlock error={q.error} onRetry={() => void q.refetch()} /> : !q.data?.items.length ? <EmptyBlock /> : (
        <div className="g g3">
          {q.data.items.map((p) => (
            <div className="card cp" key={p.id}>
              <div className="nm">
                <span className="mono" style={{ width: 28, height: 28, borderRadius: 6, border: '1px dashed var(--line)', display: 'grid', placeItems: 'center', fontSize: 10.5, fontWeight: 700, color: 'var(--mut)', background: 'var(--bg)' }} title="Chưa có logo">{ini(p.name)}</span>
                <b style={{ fontSize: 13 }}>{p.name}</b>
                <div style={{ marginLeft: 'auto' }}><small>{p.protocol ?? ''}</small></div>
              </div>
              <div style={{ margin: '14px 0' }}><StatusTag status={p.status} /></div>
              <dl className="kv" style={{ gridTemplateColumns: '90px 1fr', margin: '0 0 14px' }}><dt>Endpoint</dt><dd>{p.endpoint ?? '—'}</dd><dt>Xác thực</dt><dd>{p.auth ?? '—'}</dd></dl>
              {can('partners', 'write') ? <Btn className="sm" onClick={() => { setCfg(p); setF({ endpoint: p.endpoint ?? '', auth: p.auth ?? '' }); }}>Cấu hình</Btn> : null}
            </div>
          ))}
        </div>
      )}
      <Dialog open={!!cfg} onClose={() => setCfg(null)} label="Cấu hình đối tác">
        <form onSubmit={async (e) => { e.preventDefault(); if (!cfg) return; const r = await act(() => api.put(`/admin/v1/partners/${cfg.id}`, { body: f }), 'Đã lưu cấu hình.'); if (r !== undefined) setCfg(null); }}>
          <h2 style={{ margin: '0 0 10px', fontSize: 18 }}>Cấu hình · {cfg?.name}</h2>
          <Field label="Endpoint (https)"><input type="url" pattern="https://.*" value={f.endpoint} onChange={(e) => setF({ ...f, endpoint: e.target.value })} /></Field>
          <Field label="Kiểu xác thực" hint="Khóa API không nhập ở trình duyệt; đặt ở máy chủ."><input value={f.auth} onChange={(e) => setF({ ...f, auth: e.target.value })} placeholder="API key, OAuth 2.0, HMAC…" /></Field>
          <div className="da" style={{ marginTop: 14 }}><button type="button" className="btn" onClick={() => setCfg(null)}>{t('Hủy')}</button><button className="btn p" type="submit">{t('Lưu')}</button></div>
        </form>
      </Dialog>
    </>
  );
}
