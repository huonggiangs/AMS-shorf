import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { approveResultSchema, campaignSchema, listOf, mediaSchema, type Campaign } from '../api/schemas';
import { useAct } from '../api/hooks';
import { useAuth } from '../auth/AuthProvider';
import { ServerTable } from '../components/ServerTable';
import type { Col } from '../components/DataTable';
import { Btn, Kpi, Note, NameCell, PageHead, Tag } from '../components/ui';
import { PromptDialog } from '../components/Prompt';
import { CampaignDrawer } from './Campaigns';
import { useT } from '../i18n';
import { vnd } from '../lib/format';
import { useUi } from '../state/ui';

export default function Approvals() {
  const t = useT();
  const { can } = useAuth();
  const act = useAct();
  const { notify } = useUi();
  const [sp, setSp] = useSearchParams();
  const [reject, setReject] = useState<string[] | null>(null);
  const canApprove = can('approvals', 'approve');
  const pend = useQuery({ queryKey: ['/admin/v1/approvals', 'count'], queryFn: () => api.get('/admin/v1/approvals', { query: { page_size: 1 }, schema: listOf(campaignSchema) }) });
  const funds = useQuery({ queryKey: ['/admin/v1/campaigns', 'count', 'af'], queryFn: () => api.get('/admin/v1/campaigns', { query: { page_size: 1, filter: 'status:awaiting_funds' }, schema: listOf(campaignSchema) }) });
  const media = useQuery({ queryKey: ['/admin/v1/media', 'count', 'pend'], queryFn: () => api.get('/admin/v1/media', { query: { page_size: 1, filter: 'status:pending' }, schema: listOf(mediaSchema) }) });

  const approve = async (id: string) => {
    const r = await act(() => api.post(`/admin/v1/campaigns/${id}/approve`, { schema: approveResultSchema }), undefined, ['/admin/v1']);
    if (r) notify(r.message ?? (r.status === 'awaiting_funds' ? `Đã duyệt nhưng ví thiếu ${vnd(r.shortfall_vnd)}. Quảng cáo sẽ tự chạy sau khi nạp đủ.` : `Đã duyệt${r.reserved_vnd ? `, đã giữ ${vnd(r.reserved_vnd)} từ ví` : ''}.`));
  };

  const cols: Col<Campaign>[] = [
    { key: 'name', label: 'Chiến dịch', sortKey: 'name', text: (r) => r.name, cell: (r) => <NameCell icon="ads" a={r.name} b={r.brand} /> },
    { key: 'creator', label: 'Người gửi', text: (r) => r.creator ?? '' },
    { key: 'file', label: 'Tệp', text: (r) => r.media_name ?? '—' },
    { key: 'budget', label: 'Ngân sách', sortKey: 'budget_vnd', num: true, text: (r) => r.budget_vnd, cell: (r) => vnd(r.budget_vnd) },
    { key: 'comp', label: 'Tuân thủ', text: (r) => `${r.restricted_industry ? 'ngành hạn chế ' : ''}${r.content_rights_confirmed ? 'đã xác nhận quyền nội dung' : 'chưa xác nhận quyền'}`, cell: (r) => (
      <>{r.restricted_industry ? <Tag tone="bad">Ngành hạn chế</Tag> : null}{' '}{r.content_rights_confirmed ? <Tag tone="ok">Đã xác nhận quyền nội dung</Tag> : <Tag tone="warn">Chưa xác nhận quyền</Tag>}</>) },
    { key: 'dec', label: 'Quyết định', cell: (r) => canApprove ? (
      <><Btn tone="p" className="sm" onClick={() => void approve(r.id)}>{t('Duyệt')}</Btn>{' '}<Btn className="sm" onClick={() => setReject([r.id])}>{t('Trả lại')}</Btn></>) : <span style={{ color: 'var(--mut)' }}>{t('Chỉ đọc')}</span> },
  ];
  return (
    <>
      <PageHead title="Phê duyệt quảng cáo" sub="Super admin duyệt nội dung, lịch phát và ngân sách trước khi phát hành." />
      <Note>Người tải nội dung chỉ tạo bản nháp và gửi yêu cầu. Ngân sách đã duyệt là mức trần chi tiêu của chiến dịch. Khi duyệt, hệ thống giữ ngân sách từ ví và tự chạy nếu ví đủ.</Note>
      <div className="g g4">
        <Kpi label="Chờ quyết định" icon="doc" value={pend.data?.total ?? '—'} foot="Chiến dịch chờ duyệt" />
        <Kpi label="Chờ nạp tiền" icon="card" value={funds.data?.total ?? '—'} foot="Đã duyệt, thiếu số dư" />
        <Kpi label="Media chờ kiểm duyệt" icon="img" value={media.data?.total ?? '—'} foot="Xem ở Nội dung & Media" />
      </div>
      <ServerTable
        id="ap" endpoint="/admin/v1/approvals" itemSchema={campaignSchema} cols={cols} title="Yêu cầu chờ duyệt" exportName="phe-duyet"
        onOpen={(r) => setSp({ open: r.id })}
        bulk={canApprove ? [{ key: 'approve', label: 'Duyệt đã chọn', tone: 'p' }, { key: 'return', label: 'Trả lại' }] : []}
        onBulk={(k, ids, done) => { if (k === 'return') { setReject(ids); done(); return; } void (async () => { for (const id of ids) await approve(id); done(); })(); }}
      />
      <CampaignDrawer id={sp.get('open')} onClose={() => setSp({})} onReject={(id) => setReject([id])} />
      <PromptDialog open={!!reject} title="Trả lại chiến dịch" label="Lý do trả lại" onClose={() => setReject(null)}
        onSubmit={async (reason) => { for (const id of reject ?? []) await act(() => api.post(`/admin/v1/campaigns/${id}/reject`, { body: { reason } }), 'Đã trả lại.'); }} />
    </>
  );
}
