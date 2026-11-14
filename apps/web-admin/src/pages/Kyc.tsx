import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { ServerTable } from '../components/ServerTable';
import type { Col } from '../components/DataTable';
import { KycPanel } from '../components/KycPanel';
import { Btn, PageHead, Tag } from '../components/ui';
import { fmtDateTime } from '../lib/format';
import { anyRow, KYC_STATE, n, s, type Row } from '../lib/p4';

/** Hàng chờ duyệt hồ sơ pháp lý (KYC) của nhãn hàng: giấy phép kinh doanh, giấy phép ngành nghề, cờ ngành hạn chế. */
export default function Kyc() {
  const { can } = useAuth();
  const [open, setOpen] = useState<Row | null>(null);
  const cols: Col<Row>[] = [
    { key: 'customer', label: 'Khách hàng', sortKey: 'customer', text: (r) => s(r.customer) },
    { key: 'industry', label: 'Ngành', text: (r) => s(r.industry) || '—' },
    { key: 'state', label: 'Trạng thái', sortKey: 'state', text: (r) => KYC_STATE[s(r.state)]?.label ?? s(r.state), cell: (r) => <Tag tone={KYC_STATE[s(r.state)]?.tone ?? 'info'}>{KYC_STATE[s(r.state)]?.label ?? s(r.state)}</Tag> },
    { key: 'docs', label: 'Tệp chờ duyệt', num: true, text: (r) => n(r.pending_docs) },
    { key: 'restricted', label: 'Ngành hạn chế', text: (r) => (r.restricted_industry ? 'Có' : 'Không') },
    { key: 'sub', label: 'Nộp lúc', sortKey: 'submitted_at', text: (r) => (r.submitted_at ? fmtDateTime(s(r.submitted_at)) : '—') },
    { key: 'act', label: '', text: () => '', cell: (r) => <Btn onClick={() => setOpen(r)}>{s(r.state) === 'submitted' ? 'Xem xét' : 'Mở hồ sơ'}</Btn> },
  ];
  return (
    <>
      <PageHead title="Hồ sơ pháp lý khách hàng" sub="Duyệt giấy phép kinh doanh và giấy phép ngành nghề của nhãn hàng. Ngành hạn chế bắt buộc duyệt lần hai nội dung chiến dịch." />
      <ServerTable id="kyc" endpoint="/admin/v1/compliance/kyc" itemSchema={anyRow} cols={cols} extra={{ sort: 'submitted_at:asc' }} filters={[{ key: 'state', label: 'Trạng thái', options: Object.entries(KYC_STATE).map(([value, v]) => ({ value, label: v.label })) }]} exportName="ho-so-phap-ly" rowKey={(r) => s(r.customer_id)} emptyText="Chưa có hồ sơ nào." />
      {open ? (
        <div className="card cp" style={{ marginTop: 12 }}>
          <div className="ch"><h2>{s(open.customer)}</h2><Btn onClick={() => setOpen(null)}>Đóng</Btn></div>
          <KycPanel base={`/admin/v1/compliance/kyc/${s(open.customer_id)}`} canWrite={can('customers', 'write')} canReview={can('customers', 'approve')} />
        </div>
      ) : null}
    </>
  );
}
