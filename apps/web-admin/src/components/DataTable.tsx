import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { useT } from '../i18n';

export interface Col<R> {
  key: string;
  label: string;
  /** server-side sort field; omitted = not sortable */
  sortKey?: string;
  num?: boolean;
  cell?: (r: R) => ReactNode;
  /** plain value used for CSV export */
  text?: (r: R) => string | number | null | undefined;
}
export interface FilterDef {
  key: string;
  label: string;
  options: { value: string; label: string }[];
}
export interface BulkDef {
  key: string;
  label: string;
  tone?: 'p' | 'd' | '';
}
export interface TableState {
  q: string;
  sort: string | null;
  dir: 1 | -1;
  page: number;
  filters: Record<string, string>;
}
export const initialTableState: TableState = { q: '', sort: null, dir: 1, page: 1, filters: {} };

export interface DataTableProps<R> {
  title?: string;
  sub?: ReactNode;
  cols: Col<R>[];
  rows: R[];
  total: number;
  pageSize: number;
  rowKey: (r: R) => string;
  state: TableState;
  onState: (patch: Partial<TableState>) => void;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  filters?: FilterDef[];
  bulk?: BulkDef[];
  onBulk?: (key: string, ids: string[]) => void;
  selection?: Set<string>;
  onSelection?: (s: Set<string>) => void;
  onOpen?: (r: R) => void;
  onExport?: () => void;
  exporting?: boolean;
  emptyText?: string;
  label?: string;
}

export function pageWindow(cur: number, pages: number): (number | '…')[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const s = new Set([1, 2, cur - 1, cur, cur + 1, pages - 1, pages].filter((p) => p >= 1 && p <= pages));
  const arr = [...s].sort((a, b) => a - b);
  const out: (number | '…')[] = [];
  arr.forEach((p, i) => {
    if (i && p - arr[i - 1]! > 1) out.push('…');
    out.push(p);
  });
  return out;
}

export function DataTable<R>(p: DataTableProps<R>) {
  const t = useT();
  const { state, onState, cols, rows, total, pageSize } = p;
  const [qInput, setQInput] = useState(state.q);
  useEffect(() => setQInput(state.q), [state.q]);
  // debounce search -> server
  useEffect(() => {
    if (qInput === state.q) return;
    const h = setTimeout(() => onState({ q: qInput, page: 1 }), 300);
    return () => clearTimeout(h);
  }, [qInput]); // eslint-disable-line react-hooks/exhaustive-deps

  const sel = p.selection ?? new Set<string>();
  const hasBulk = !!p.bulk?.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const keys = rows.map(p.rowKey);
  const allSel = rows.length > 0 && keys.every((k) => sel.has(k));
  const from = total ? (state.page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, state.page * pageSize);
  const setSel = (s: Set<string>) => p.onSelection?.(s);

  return (
    <div className="card" style={{ overflow: 'hidden' }} data-testid="data-table">
      {p.title ? (
        <div className="cp" style={{ paddingBottom: 0 }}>
          <div className="ch" style={{ margin: 0 }}>
            <div>
              <h2>{t(p.title)}</h2>
              {p.sub ? <p>{p.sub}</p> : null}
            </div>
          </div>
        </div>
      ) : null}
      <div className="tb">
        <label className="sr">
          <Icon n="search" />
          <input value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder={t('Tìm…')} aria-label={t('Tìm…')} />
        </label>
        {(p.filters ?? []).map((f) => (
          <select
            key={f.key}
            className="sel"
            aria-label={f.label}
            value={state.filters[f.key] ?? ''}
            onChange={(e) => onState({ filters: { ...state.filters, [f.key]: e.target.value }, page: 1 })}
          >
            <option value="">
              {f.label}: {t('Tất cả')}
            </option>
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ))}
        <span style={{ flex: 1 }} />
        {p.onExport ? (
          <>
            <button type="button" className="btn sm" onClick={p.onExport} disabled={p.exporting}>
              <Icon n="dl" />
              {t('Xuất CSV')}
            </button>
            <button type="button" className="btn sm" onClick={() => window.print()}>
              {t('Xuất PDF')}
            </button>
          </>
        ) : null}
      </div>
      {sel.size > 0 && hasBulk ? (
        <div className="bulk" role="toolbar" aria-label="bulk">
          {t('Đã chọn')} {sel.size}
          {p.bulk!.map((b) => (
            <button key={b.key} type="button" className={`btn sm ${b.tone ?? ''}`} onClick={() => p.onBulk?.(b.key, [...sel])}>
              {b.label}
            </button>
          ))}
          <button type="button" className="btn sm" onClick={() => setSel(new Set())}>
            {t('Bỏ chọn')}
          </button>
        </div>
      ) : null}
      <div className="tw" aria-busy={p.loading || undefined}>
        <table aria-label={p.label ?? p.title}>
          <thead>
            <tr>
              {hasBulk ? (
                <th style={{ width: 44 }}>
                  <input
                    type="checkbox"
                    aria-label="select all"
                    checked={allSel}
                    onChange={() => {
                      const n = new Set(sel);
                      if (allSel) keys.forEach((k) => n.delete(k));
                      else keys.forEach((k) => n.add(k));
                      setSel(n);
                    }}
                  />
                </th>
              ) : null}
              {cols.map((c) => {
                const active = c.sortKey && state.sort === c.sortKey;
                return (
                  <th
                    key={c.key}
                    className={`${c.sortKey ? 's' : ''} ${c.num ? 'n' : ''}`}
                    aria-sort={active ? (state.dir > 0 ? 'ascending' : 'descending') : undefined}
                    onClick={() => {
                      if (!c.sortKey) return;
                      onState(state.sort === c.sortKey ? { dir: (state.dir * -1) as 1 | -1, page: 1 } : { sort: c.sortKey, dir: 1, page: 1 });
                    }}
                  >
                    {t(c.label)}
                    {active ? (state.dir > 0 ? ' ↑' : ' ↓') : ''}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const k = p.rowKey(r);
              return (
                <tr
                  key={k}
                  className={p.onOpen ? 'cl' : ''}
                  onClick={(e) => {
                    if (!p.onOpen || (e.target as HTMLElement).closest('input,a,button,select')) return;
                    p.onOpen(r);
                  }}
                >
                  {hasBulk ? (
                    <td>
                      <input
                        type="checkbox"
                        aria-label="select"
                        checked={sel.has(k)}
                        onChange={() => {
                          const n = new Set(sel);
                          if (n.has(k)) n.delete(k);
                          else n.add(k);
                          setSel(n);
                        }}
                      />
                    </td>
                  ) : null}
                  {cols.map((c) => (
                    <td key={c.key} className={c.num ? 'n' : ''}>
                      {c.cell ? c.cell(r) : String(c.text?.(r) ?? '')}
                    </td>
                  ))}
                </tr>
              );
            })}
            {!rows.length ? (
              <tr>
                <td colSpan={cols.length + (hasBulk ? 1 : 0)} style={{ textAlign: 'center', color: p.error ? 'var(--bad)' : 'var(--mut)', padding: 40 }}>
                  {p.loading ? (
                    t('Đang tải…')
                  ) : p.error ? (
                    <>
                      {p.error}{' '}
                      {p.onRetry ? (
                        <button type="button" className="btn sm" onClick={p.onRetry}>
                          {t('Thử lại')}
                        </button>
                      ) : null}
                    </>
                  ) : (
                    p.emptyText ?? t('Không có dữ liệu')
                  )}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="tf">
        <span>
          {t('Hiển thị')} {from}–{to} {t('trên')} {total}
        </span>
        <div className="pg">
          {pageWindow(state.page, pages).map((n, i) =>
            n === '…' ? (
              <span key={`e${i}`} style={{ padding: '0 6px', color: 'var(--mut)' }}>
                …
              </span>
            ) : (
              <button key={n} type="button" className={n === state.page ? 'on' : ''} aria-current={n === state.page ? 'page' : undefined} onClick={() => onState({ page: n })}>
                {n}
              </button>
            ),
          )}
        </div>
      </div>
    </div>
  );
}
