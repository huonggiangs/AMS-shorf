// Nhóm thiết bị (d-tree): cây phân nhóm lồng nhau + danh sách thiết bị theo nhóm, lọc trực tuyến/ngoại tuyến, tìm kiếm,
// chuyển nhóm / gán địa điểm hàng loạt và điều chỉnh âm lượng từ xa. Trạng thái (nhóm, lọc, tìm) nằm trên URL.
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { listOf } from '../api/schemas';
import { subtree, treeDeviceSchema, type GroupNode, type TreeDevice } from '../api/deviceTree';
import { useAct } from '../api/hooks';
import { useAuth } from '../auth/AuthProvider';
import { BulkAssignDialog, BulkVolumeDialog, GroupSelect, PlacementDialog, treeErr, useGroupTree, VolumeSlider } from '../components/DeviceTree';
import { OpsDialog } from '../components/OpsDialog';
import { Btn, EmptyBlock, ErrorBlock, Field, LoadingBlock, Note, PageHead, StatusTag, Tabs } from '../components/ui';
import { fmtDateTime, num } from '../lib/format';

const PAGE_SIZE = 50;
type Status = 'all' | 'online' | 'offline';
const ROOT = 'all';

function TreeNode({ g, kids, sel, open, toggle, pick, depth }: { g: GroupNode; kids: Map<string, GroupNode[]>; sel: string; open: Set<string>; toggle: (id: string) => void; pick: (id: string) => void; depth: number }) {
  const ch = kids.get(g.id) ?? [];
  const isOpen = open.has(g.id);
  return (
    <li role="treeitem" aria-expanded={ch.length ? isOpen : undefined} aria-selected={sel === g.id}>
      <div className={`tn ${sel === g.id ? 'on' : ''}`} style={{ paddingLeft: 8 + depth * 16, display: 'flex', alignItems: 'center', gap: 6, borderRadius: 8, background: sel === g.id ? 'var(--pri-t)' : undefined }}>
        {ch.length ? <button type="button" className="btn sm" aria-label={isOpen ? `Thu gọn ${g.name}` : `Mở ${g.name}`} onClick={() => toggle(g.id)} style={{ padding: '0 6px', minWidth: 24 }}>{isOpen ? '▾' : '▸'}</button> : <span style={{ width: 24 }} />}
        <button type="button" onClick={() => pick(g.id)} style={{ flex: 1, textAlign: 'left', display: 'flex', justifyContent: 'space-between', gap: 8, background: 'none', border: 0, padding: '8px 4px', cursor: 'pointer', color: 'inherit', font: 'inherit', fontWeight: sel === g.id ? 700 : 500 }}>
          <span>{g.name}</span>
          <span className="mono" title={`${g.online_count} trực tuyến / ${g.device_count} thiết bị`}>{g.device_count}</span>
        </button>
      </div>
      {ch.length && isOpen ? <ul role="group" style={{ listStyle: 'none', margin: 0, padding: 0 }}>{ch.map((c) => <TreeNode key={c.id} g={c} kids={kids} sel={sel} open={open} toggle={toggle} pick={pick} depth={depth + 1} />)}</ul> : null}
    </li>
  );
}

type GroupDlg = { mode: 'create' | 'edit' | 'delete'; node?: GroupNode } | null;
function GroupDialog({ dlg, items, onClose, onSaved }: { dlg: GroupDlg; items: GroupNode[]; onClose: () => void; onSaved: (id?: string) => void }) {
  const act = useAct();
  const [name, setName] = useState('');
  const [parent, setParent] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!dlg) return;
    setErr('');
    setName(dlg.mode === 'edit' ? dlg.node!.name : '');
    setParent(dlg.mode === 'edit' ? dlg.node!.parent_id ?? '' : dlg.node?.id ?? '');
  }, [dlg]);
  const exclude = dlg?.mode === 'edit' && dlg.node ? subtree(items, dlg.node.id) : undefined;
  const submit = async () => {
    if (!dlg) return;
    setErr('');
    try {
      if (dlg.mode === 'create') {
        const r = (await api.post('/admin/v1/device-groups', { body: { name: name.trim(), parent_id: parent || null } })) as { id: string };
        await act(async () => undefined, `Đã thêm nhóm "${name.trim()}".`);
        onSaved(r.id);
      } else if (dlg.mode === 'edit') {
        await api.patch(`/admin/v1/device-groups/${dlg.node!.id}`, { body: { name: name.trim(), parent_id: parent || null } });
        await act(async () => undefined, 'Đã lưu nhóm.');
        onSaved(dlg.node!.id);
      } else {
        await api.del(`/admin/v1/device-groups/${dlg.node!.id}`);
        await act(async () => undefined, `Đã xóa nhóm "${dlg.node!.name}". Thiết bị và nhóm con được chuyển lên nhóm cha.`);
        onSaved();
      }
      onClose();
    } catch (e) { setErr(treeErr(e)); }
  };
  const title = dlg?.mode === 'create' ? (dlg.node ? `Thêm nhóm con của "${dlg.node.name}"` : 'Thêm nhóm') : dlg?.mode === 'edit' ? 'Đổi tên / chuyển nhóm' : 'Xóa nhóm';
  return (
    <OpsDialog open={!!dlg} onClose={onClose} label={title} width="min(480px,96vw)">
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>{title}</h2>
        {dlg?.mode === 'delete' ? (
          <Note warn>Xóa nhóm &quot;{dlg.node!.name}&quot;: {dlg.node!.direct_count} thiết bị và các nhóm con sẽ được chuyển lên nhóm cha (hoặc về &quot;Chưa xếp nhóm&quot; nếu là nhóm gốc). Không thiết bị nào bị xóa.</Note>
        ) : (
          <>
            <Field label="Tên nhóm"><input value={name} maxLength={80} autoFocus onChange={(e) => setName(e.target.value)} placeholder="Ví dụ: Miền Bắc · Hà Nội" /></Field>
            <Field label="Nhóm cha"><GroupSelect items={items} value={parent} onChange={setParent} exclude={exclude} none="— Nhóm gốc —" /></Field>
          </>
        )}
        {err ? <p role="alert" style={{ color: 'var(--bad)', margin: '8px 0 0' }}>{err}</p> : null}
        <div className="da" style={{ marginTop: 14 }}>
          <button type="button" className="btn" onClick={onClose}>Hủy</button>
          <button type="submit" className={`btn ${dlg?.mode === 'delete' ? 'd' : 'p'}`} disabled={dlg?.mode !== 'delete' && !name.trim()}>{dlg?.mode === 'delete' ? 'Xóa nhóm' : 'Lưu'}</button>
        </div>
      </form>
    </OpsDialog>
  );
}

export default function DeviceGroups() {
  const { can } = useAuth();
  const act = useAct();
  const canWrite = can('devices', 'write');
  const [sp, setSp] = useSearchParams();
  const sel = sp.get('group') ?? ROOT; // 'all' | 'none' | <id>
  const status = (sp.get('status') as Status | null) ?? 'all';
  const q = sp.get('q') ?? '';
  const page = Math.max(1, Number(sp.get('page') ?? 1) || 1);
  const [qDraft, setQDraft] = useState(q);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [gdlg, setGdlg] = useState<GroupDlg>(null);
  const [edit, setEdit] = useState<TreeDevice | null>(null);
  const [assign, setAssign] = useState<'group' | 'location' | null>(null);
  const [volDlg, setVolDlg] = useState<'group' | 'selected' | null>(null);
  const setParam = (k: string, v: string | null, resetPage = true) => {
    const n = new URLSearchParams(sp);
    if (v === null || v === '' || (k === 'status' && v === 'all') || (k === 'group' && v === ROOT)) n.delete(k); else n.set(k, v);
    if (resetPage) n.delete('page');
    setSp(n, { replace: true });
  };
  useEffect(() => { setQDraft(q); }, [q]);
  useEffect(() => { const t = setTimeout(() => { if (qDraft !== q) setParam('q', qDraft.trim()); }, 350); return () => clearTimeout(t); }, [qDraft]); // eslint-disable-line react-hooks/exhaustive-deps

  const tree = useGroupTree();
  const items = useMemo(() => tree.data?.items ?? [], [tree.data]);
  const kids = useMemo(() => { const m = new Map<string, GroupNode[]>(); for (const g of items) if (g.parent_id) m.set(g.parent_id, [...(m.get(g.parent_id) ?? []), g]); return m; }, [items]);
  const roots = useMemo(() => items.filter((g) => !g.parent_id), [items]);
  const node = items.find((g) => g.id === sel);
  useEffect(() => { // mở sẵn đường tới nhóm đang chọn
    if (!node) return;
    const by = new Map(items.map((g) => [g.id, g]));
    const add = new Set<string>();
    for (let p = node.parent_id; p; p = by.get(p)?.parent_id ?? null) add.add(p);
    if (add.size) setOpen((o) => new Set([...o, ...add]));
  }, [node?.id, items.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setOpen((o) => (o.size ? o : new Set(roots.map((g) => g.id)))); }, [roots.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = useQuery({
    queryKey: ['/admin/v1/device-groups', 'devices', sel, status, q, page],
    queryFn: () => api.get('/admin/v1/device-groups/devices', { query: { ...(sel !== ROOT ? { group_id: sel } : {}), ...(status !== 'all' ? { filter: `status:${status}` } : {}), ...(q ? { q } : {}), page, page_size: PAGE_SIZE }, schema: listOf(treeDeviceSchema) }),
    placeholderData: (p) => p,
    // có lệnh âm lượng đang chờ thì hỏi lại mỗi 15 giây để thấy trạng thái đã xác nhận
    refetchInterval: (qq) => ((qq.state.data?.items ?? []).some((d) => d.volume_cmd && (d.volume_cmd.state === 'pending' || d.volume_cmd.state === 'delivered')) ? 15000 : false),
  });
  const rows = list.data?.items ?? [];
  const total = list.data?.total ?? rows.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  useEffect(() => { setPicked(new Set()); }, [sel, status, q, page]);
  const allOn = rows.length > 0 && rows.every((r) => picked.has(r.id));
  const toggleAll = () => setPicked(allOn ? new Set() : new Set(rows.map((r) => r.id)));
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const title = sel === ROOT ? 'Tất cả cụm màn hình' : sel === 'none' ? 'Chưa xếp nhóm' : node?.name ?? 'Nhóm';
  const total0 = tree.data?.total ?? 0;
  const ids = [...picked];

  const resync = (d: TreeDevice) => void act(() => api.post(`/admin/v1/devices/${d.id}/commands`, { body: { type: 'refresh_manifest' } }), `Đã xếp lệnh đồng bộ cho "${d.name}". Thiết bị nhận ở lần heartbeat kế tiếp.`);

  return (
    <>
      <PageHead title="Nhóm thiết bị" sub="Cây phân nhóm thiết bị, đặt địa điểm và chỉnh âm lượng từ xa. Lệnh tới thiết bị ở lần heartbeat kế tiếp (không tức thời)." actions={canWrite ? <Btn tone="p" icon="plus" onClick={() => setGdlg({ mode: 'create', ...(node ? { node } : {}) })}>Thêm nhóm</Btn> : undefined} />
      <div className="g" style={{ display: 'grid', gridTemplateColumns: 'minmax(210px, 240px) minmax(0, 1fr)', gap: 14, alignItems: 'start' }}>
        <div className="card cp" aria-label="Cây phân nhóm thiết bị">
          <div className="ch"><div><h2>Cây phân nhóm thiết bị</h2><p>Số thiết bị đã cộng dồn các nhóm con</p></div></div>
          {tree.isLoading ? <LoadingBlock /> : tree.isError ? <ErrorBlock error={tree.error} onRetry={() => void tree.refetch()} /> : (
            <ul role="tree" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              <li role="treeitem" aria-selected={sel === ROOT}>
                <button type="button" onClick={() => setParam('group', ROOT)} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', padding: '8px 10px', background: sel === ROOT ? 'var(--pri-t)' : 'none', border: 0, borderRadius: 8, cursor: 'pointer', color: 'inherit', font: 'inherit', fontWeight: 700 }}>
                  <span>Tất cả cụm màn hình</span><span className="mono">{total0}</span>
                </button>
                <ul role="group" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {roots.map((g) => <TreeNode key={g.id} g={g} kids={kids} sel={sel} open={open} toggle={(id) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; })} pick={(id) => setParam('group', id)} depth={0} />)}
                  <li role="treeitem" aria-selected={sel === 'none'}>
                    <button type="button" onClick={() => setParam('group', 'none')} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', padding: '8px 10px 8px 34px', background: sel === 'none' ? 'var(--pri-t)' : 'none', border: 0, borderRadius: 8, cursor: 'pointer', color: 'var(--mut)', font: 'inherit' }}>
                      <span>Chưa xếp nhóm</span><span className="mono">{tree.data?.unassigned ?? 0}</span>
                    </button>
                  </li>
                </ul>
              </li>
            </ul>
          )}
          {!tree.isLoading && !items.length ? <p className="sub" style={{ marginTop: 10 }}>Chưa có nhóm nào. Bấm &quot;Thêm nhóm&quot; để tạo cây phân nhóm đầu tiên.</p> : null}
          {canWrite && node ? (
            <div className="acts" style={{ marginTop: 12, flexWrap: 'wrap' }}>
              <Btn onClick={() => setGdlg({ mode: 'create', node })}>Thêm nhóm con</Btn>
              <Btn onClick={() => setGdlg({ mode: 'edit', node })}>Đổi tên / chuyển</Btn>
              <Btn tone="d" onClick={() => setGdlg({ mode: 'delete', node })}>Xóa nhóm</Btn>
            </div>
          ) : null}
        </div>

        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="cp" style={{ paddingBottom: 0 }}>
            <div className="ch" style={{ margin: 0 }}>
              <div><h2>{title}</h2><p>{node ? node.path : 'Thiết bị theo nhóm đang chọn (gồm nhóm con)'} · {num(total)} thiết bị</p></div>
              {canWrite && node ? <Btn icon="plus" onClick={() => setVolDlg('group')}>Đặt âm lượng cả nhóm</Btn> : null}
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', margin: '10px 0' }}>
              <Tabs<Status> label="Trạng thái" value={status} onChange={(v) => setParam('status', v)} items={[{ id: 'all', label: 'Tất cả' }, { id: 'online', label: 'Trực tuyến' }, { id: 'offline', label: 'Ngoại tuyến' }]} />
              <input id="dg-q" type="search" aria-label="Tìm thiết bị" value={qDraft} onChange={(e) => setQDraft(e.target.value)} placeholder="Tìm tên, MAC, số Serial, địa điểm..." style={{ flex: 1, minWidth: 220 }} />
            </div>
            {canWrite && picked.size ? (
              <div className="bulk" role="toolbar" aria-label="Thao tác hàng loạt">
                <b>{picked.size} đã chọn</b>
                <button type="button" className="btn sm" onClick={() => setAssign('group')}>Chuyển nhóm</button>
                <button type="button" className="btn sm" onClick={() => setAssign('location')}>Gán địa điểm</button>
                <button type="button" className="btn sm" onClick={() => setVolDlg('selected')}>Đặt âm lượng</button>
                <button type="button" className="btn sm" onClick={() => setPicked(new Set())}>Bỏ chọn</button>
              </div>
            ) : null}
          </div>
          <div className="tw" aria-busy={list.isFetching || undefined} style={{ overflowX: 'auto' }}>
            {list.isLoading ? <LoadingBlock /> : list.isError ? <ErrorBlock error={list.error} onRetry={() => void list.refetch()} /> : !rows.length ? <EmptyBlock>Không có thiết bị nào khớp bộ lọc.</EmptyBlock> : (
              <table className="tbl">
                <thead>
                  <tr>
                    {canWrite ? <th style={{ width: 30 }}><input type="checkbox" aria-label="Chọn tất cả" checked={allOn} onChange={toggleAll} /></th> : null}
                    <th>Thiết bị</th><th>MAC / SN · Phân giải</th><th>Trạng thái</th><th>Âm lượng</th><th>Điều khiển từ xa</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((d) => (
                    <tr key={d.id}>
                      {canWrite ? <td><input type="checkbox" aria-label={`Chọn ${d.name}`} checked={picked.has(d.id)} onChange={() => toggle(d.id)} /></td> : null}
                      <td style={{ minWidth: 150 }}>
                        <b>{d.name}</b>{d.location_name ? <span style={{ color: 'var(--mut)' }}> · {d.location_name}</span> : null}
                        <div style={{ color: 'var(--mut)', fontSize: 12.5 }}>{[d.group_name, d.model].filter(Boolean).join(' · ') || 'Chưa xếp nhóm'}</div>
                      </td>
                      <td className="mono" style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{d.mac ?? '—'}<div style={{ color: 'var(--mut)', fontSize: 12.5 }}>{[d.serial, d.px_w && d.px_h ? `${d.px_w}×${d.px_h}` : null].filter(Boolean).join(' · ')}</div></td>
                      <td><StatusTag status={d.status} /><div style={{ color: 'var(--mut)', fontSize: 12.5, marginTop: 4 }}>{d.synced ? <span title={`Heartbeat ${fmtDateTime(d.last_seen_at)}`}>Đã đồng bộ</span> : 'Chờ kết nối'}</div></td>
                      <td><VolumeSlider d={d} canWrite={canWrite} /></td>
                      <td style={{ width: 128 }}>
                        <div className="acts" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
                          <button type="button" className="btn sm" style={{ whiteSpace: 'normal' }} disabled title="Cần bản app mới (lệnh screenshot chưa có trong app TV hiện tại, xem docs/DEVICE-PROTOCOL.md)">Xem màn hình</button>
                          <button type="button" className="btn sm" style={{ whiteSpace: 'normal' }} disabled={!canWrite || !d.controllable} title={d.controllable ? 'Buộc thiết bị tải lại lịch phát (lệnh refresh_manifest)' : 'Thiết bị chưa ghép mã / chưa cấp quyền nên chưa gửi lệnh được'} onClick={() => resync(d)}>Đồng bộ lại ngay</button>
                          {canWrite ? <button type="button" className="btn sm" style={{ whiteSpace: 'normal' }} onClick={() => setEdit(d)}>Nhóm / địa điểm</button> : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {pages > 1 ? (
            <div className="tf"><span>Trang {page}/{pages}</span>
              <div className="pg"><button type="button" disabled={page <= 1} onClick={() => setParam('page', String(page - 1), false)}>Trước</button><button type="button" disabled={page >= pages} onClick={() => setParam('page', String(page + 1), false)}>Sau</button></div>
            </div>
          ) : null}
        </div>
      </div>

      <GroupDialog dlg={gdlg} items={items} onClose={() => setGdlg(null)} onSaved={(id) => { if (gdlg?.mode === 'delete') setParam('group', ROOT); else if (gdlg?.mode === 'create' && id) setParam('group', id); }} />
      <PlacementDialog device={edit} onClose={() => setEdit(null)} />
      <BulkAssignDialog kind={assign} ids={ids} onClose={() => setAssign(null)} onDone={() => setPicked(new Set())} />
      <BulkVolumeDialog
        open={volDlg !== null}
        title={volDlg === 'group' ? `Đặt âm lượng nhóm "${node?.name ?? ''}"` : 'Đặt âm lượng thiết bị đã chọn'}
        count={volDlg === 'group' ? node?.device_count ?? 0 : ids.length}
        onClose={() => setVolDlg(null)}
        run={async (percent) => {
          if (volDlg === 'group' && node) {
            const r = (await api.post(`/admin/v1/device-groups/${node.id}/volume`, { body: { percent, include_children: true } })) as { queued: number; skipped: { device_id: string; reason: string }[] };
            await act(async () => undefined);
            return `Đã xếp lệnh cho ${r.queued} thiết bị${r.skipped.length ? `; bỏ qua ${r.skipped.length} thiết bị chưa ghép mã / chưa cấp quyền / bị chặn / hàng đợi đầy` : ''}.`;
          }
          let ok = 0; let skip = 0;
          for (const id of ids.slice(0, 100)) { try { await api.post(`/admin/v1/devices/${id}/commands`, { body: { type: 'set_volume', args: { percent } } }); ok++; } catch { skip++; } }
          await act(async () => undefined);
          return `Đã xếp lệnh cho ${ok} thiết bị${skip ? `; bỏ qua ${skip} thiết bị chưa ghép mã / chưa cấp quyền / bị chặn` : ''}.`;
        }}
      />
    </>
  );
}
