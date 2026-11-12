import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataTable, initialTableState, type Col, type TableState } from '../components/DataTable';
import { PermissionMatrix } from '../components/PermissionMatrix';
import { TopupDialog } from '../components/TopupDialog';
import { UiProvider } from '../state/ui';
import type { Permissions } from '../api/schemas';

interface Row { id: string; name: string; amount: number }
const cols: Col<Row>[] = [
  { key: 'name', label: 'Tên', sortKey: 'name', text: (r) => r.name },
  { key: 'amount', label: 'Số tiền', sortKey: 'amount', num: true, text: (r) => r.amount },
];
const rows: Row[] = [{ id: '1', name: 'Alpha', amount: 5 }, { id: '2', name: 'Beta', amount: 9 }];

function Harness({ onState, onBulk }: { onState?: (p: Partial<TableState>) => void; onBulk?: (k: string, ids: string[]) => void }) {
  const [st, setSt] = useState<TableState>(initialTableState);
  const [sel, setSel] = useState<Set<string>>(new Set());
  return (
    <UiProvider>
      <DataTable<Row> cols={cols} rows={rows} total={42} pageSize={8} rowKey={(r) => r.id} state={st}
        onState={(p) => { onState?.(p); setSt((s) => ({ ...s, ...p })); }}
        filters={[{ key: 'status', label: 'Trạng thái', options: [{ value: 'a', label: 'A' }] }]}
        bulk={[{ key: 'verify', label: 'Xác minh' }]} onBulk={onBulk} selection={sel} onSelection={setSel} onExport={() => undefined} />
    </UiProvider>
  );
}

describe('DataTable', () => {
  it('shows server total and page count, paginates through onState', async () => {
    const onState = vi.fn();
    render(<Harness onState={onState} />);
    expect(screen.getByText(/1–8/)).toBeInTheDocument();
    expect(screen.getByText(/trên 42/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '3' }));
    expect(onState).toHaveBeenCalledWith({ page: 3 });
  });
  it('sorts by clicking a sortable header (toggles direction)', async () => {
    const onState = vi.fn();
    render(<Harness onState={onState} />);
    await userEvent.click(screen.getByText('Tên'));
    expect(onState).toHaveBeenLastCalledWith({ sort: 'name', dir: 1, page: 1 });
    await userEvent.click(screen.getByText(/Tên/));
    expect(onState).toHaveBeenLastCalledWith({ dir: -1, page: 1 });
  });
  it('debounces search then resets to page 1', async () => {
    const onState = vi.fn();
    render(<Harness onState={onState} />);
    await userEvent.type(screen.getByLabelText('Tìm…'), 'abc');
    await vi.waitFor(() => expect(onState).toHaveBeenCalledWith({ q: 'abc', page: 1 }));
    expect(onState.mock.calls.filter((c) => 'q' in c[0])).toHaveLength(1);
  });
  it('filters, selects rows and runs a bulk action', async () => {
    const onState = vi.fn();
    const onBulk = vi.fn();
    render(<Harness onState={onState} onBulk={onBulk} />);
    await userEvent.selectOptions(screen.getByLabelText('Trạng thái'), 'a');
    expect(onState).toHaveBeenCalledWith({ filters: { status: 'a' }, page: 1 });
    const boxes = screen.getAllByRole('checkbox', { name: 'select' });
    await userEvent.click(boxes[0]!);
    await userEvent.click(boxes[1]!);
    expect(screen.getByText(/Đã chọn 2/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Xác minh' }));
    expect(onBulk).toHaveBeenCalledWith('verify', ['1', '2']);
    await userEvent.click(screen.getByRole('button', { name: 'Bỏ chọn' }));
    expect(screen.queryByText(/Đã chọn/)).toBeNull();
  });
  it('select-all toggles every row on the page', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'select all' }));
    expect(screen.getByText(/Đã chọn 2/)).toBeInTheDocument();
  });
  it('renders an honest empty state, not fake rows', () => {
    render(<UiProvider><DataTable<Row> cols={cols} rows={[]} total={0} pageSize={8} rowKey={(r) => r.id} state={initialTableState} onState={() => undefined} /></UiProvider>);
    expect(screen.getByText('Không có dữ liệu')).toBeInTheDocument();
    expect(screen.getByText(/0–0/)).toBeInTheDocument();
  });
  it('shows the error with a retry button', async () => {
    const onRetry = vi.fn();
    render(<UiProvider><DataTable<Row> cols={cols} rows={[]} total={0} pageSize={8} rowKey={(r) => r.id} state={initialTableState} onState={() => undefined} error="Lỗi máy chủ" onRetry={onRetry} /></UiProvider>);
    await userEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(onRetry).toHaveBeenCalled();
  });
});

describe('PermissionMatrix', () => {
  const Wrap = ({ role, init }: { role: string; init: Permissions }) => {
    const [v, setV] = useState(init);
    return <UiProvider><PermissionMatrix role={role} value={v} onChange={setV} /></UiProvider>;
  };
  it('renders 12 modules x 4 actions', () => {
    render(<Wrap role="super_admin" init={{}} />);
    expect(screen.getAllByRole('checkbox')).toHaveLength(48);
  });
  it('toggles a cell for internal roles', async () => {
    render(<Wrap role="content_manager" init={{ media: ['view'] }} />);
    const c = screen.getByTestId('perm-media-write');
    expect(c).not.toBeChecked();
    await userEvent.click(c);
    expect(c).toBeChecked();
  });
  it('locks external accounts: only campaigns/media/finance, never approve/delete', () => {
    render(<Wrap role="customer" init={{ campaigns: ['view', 'write', 'approve'], devices: ['view'] }} />);
    expect(screen.getByTestId('perm-devices-view')).toBeDisabled();
    expect(screen.getByTestId('perm-devices-view')).not.toBeChecked();
    expect(screen.getByTestId('perm-campaigns-approve')).toBeDisabled();
    expect(screen.getByTestId('perm-campaigns-approve')).not.toBeChecked();
    expect(screen.getByTestId('perm-campaigns-write')).toBeEnabled();
    expect(screen.getByTestId('perm-campaigns-write')).toBeChecked();
    expect(screen.getByTestId('perm-finance-delete')).toBeDisabled();
    const locked = screen.getAllByRole('checkbox').filter((c) => (c as HTMLInputElement).disabled);
    // 12 modules x 4 = 48; enabled = 3 modules x 2 actions (view, write)
    expect(48 - locked.length).toBe(6);
  });
});

describe('TopupDialog', () => {
  const bank = { bank: 'MBBank', account_number: '0123456789', account_holder: 'CONG TY AMS', prefix: 'AMS' };
  const fixed = { id: 'c4', code: 'K004', name: 'MB Bank' };
  it('prefills content "AMS <ma>", QR and copy buttons', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<UiProvider><TopupDialog open onClose={() => undefined} bank={bank} fixed={fixed} onSubmit={() => undefined} /></UiProvider>);
    expect(screen.getByTestId('topup-content')).toHaveTextContent('AMS K004');
    expect(screen.getByAltText('QR chuyển khoản')).toHaveAttribute('src', 'https://qr.sepay.vn/img?acc=0123456789&bank=MBBank&amount=50000000&des=AMS%20K004');
    const copies = screen.getAllByRole('button', { name: 'Chép' });
    await userEvent.click(copies[1]!);
    expect(writeText).toHaveBeenCalledWith('AMS K004');
  });
  it('rejects amounts under 5.000.000 and does not submit', async () => {
    const onSubmit = vi.fn();
    render(<UiProvider><TopupDialog open onClose={() => undefined} bank={bank} fixed={fixed} onSubmit={onSubmit} /></UiProvider>);
    const amount = screen.getByLabelText(/Số tiền/);
    await userEvent.clear(amount);
    await userEvent.type(amount, '1000000');
    await userEvent.click(screen.getByRole('button', { name: 'Đã chuyển khoản' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('5.000.000');
  });
  it('submits a valid top-up and offers simulation only when provided', async () => {
    const onSubmit = vi.fn();
    const { rerender } = render(<UiProvider><TopupDialog open onClose={() => undefined} bank={bank} fixed={fixed} onSubmit={onSubmit} /></UiProvider>);
    expect(screen.queryByRole('button', { name: 'Mô phỏng đã nhận tiền' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Đã chuyển khoản' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ customer_id: 'c4', amount_vnd: 50_000_000 }));
    const sim = vi.fn();
    rerender(<UiProvider><TopupDialog open onClose={() => undefined} bank={bank} fixed={fixed} onSubmit={onSubmit} onSimulate={sim} /></UiProvider>);
    await userEvent.click(screen.getByRole('button', { name: 'Mô phỏng đã nhận tiền' }));
    expect(sim).toHaveBeenCalledWith(expect.objectContaining({ content: 'AMS K004' }));
  });
  it('lets an admin pick the customer and updates the content', async () => {
    render(<UiProvider><TopupDialog open onClose={() => undefined} bank={bank} customers={[{ id: 'a', code: 'K001', name: 'Vinamilk' }, { id: 'b', code: 'K004', name: 'MB Bank' }]} onSubmit={() => undefined} /></UiProvider>);
    expect(screen.getByTestId('topup-content')).toHaveTextContent('AMS K001');
    await userEvent.selectOptions(screen.getByLabelText('Khách hàng'), 'b');
    expect(screen.getByTestId('topup-content')).toHaveTextContent('AMS K004');
    expect(within(screen.getByRole('dialog', { hidden: true })).getByText('MBBank')).toBeInTheDocument();
  });
});
