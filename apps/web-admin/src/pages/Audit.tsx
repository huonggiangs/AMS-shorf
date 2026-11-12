import { auditSchema, type AuditRow } from '../api/schemas';
import { ServerTable } from '../components/ServerTable';
import type { Col } from '../components/DataTable';
import { NameCell, PageHead } from '../components/ui';
import { fmtDateTime } from '../lib/format';

export default function Audit() {
  const cols: Col<AuditRow>[] = [
    { key: 'at', label: 'Thời gian', sortKey: 'at', text: (r) => fmtDateTime(r.at) },
    { key: 'actor', label: 'Người thực hiện', sortKey: 'actor', text: (r) => r.actor ?? 'Hệ thống', cell: (r) => <NameCell icon="user" a={r.actor ?? 'Hệ thống'} b={r.actor ? 'Tài khoản' : 'Tự động'} /> },
    { key: 'action', label: 'Hành động', sortKey: 'action', text: (r) => r.action },
    { key: 'object', label: 'Đối tượng', text: (r) => r.object ?? '' },
    { key: 'ip', label: 'IP', text: (r) => r.ip ?? '' },
  ];
  return (
    <>
      <PageHead title="Nhật ký hoạt động" sub="Mọi thao tác của quản trị viên và hệ thống, bất biến, phục vụ kiểm toán." />
      <ServerTable id="au" endpoint="/admin/v1/audit-log" itemSchema={auditSchema} cols={cols} pageSize={10} exportName="nhat-ky" />
    </>
  );
}
