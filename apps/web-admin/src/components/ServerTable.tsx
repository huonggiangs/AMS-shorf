import { useCallback, useMemo, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import { api, errMsg, type Query } from '../api/client';
import { listOf, type Paged } from '../api/schemas';
import { DataTable, initialTableState, type BulkDef, type Col, type FilterDef, type TableState } from './DataTable';
import { downloadCsv, toCsv } from '../lib/csv';
import { useT } from '../i18n';
import { useUi } from '../state/ui';

export const tableParams = (s: TableState, pageSize: number, extra?: Query): Query => {
  const filter = Object.entries(s.filters)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}:${v}`)
    .join(',');
  return {
    page: s.page,
    page_size: pageSize,
    q: s.q || undefined,
    sort: s.sort ? `${s.sort}:${s.dir > 0 ? 'asc' : 'desc'}` : undefined,
    filter: filter || undefined,
    ...extra,
  };
};

export interface ServerTableProps<S extends z.ZodTypeAny> {
  id: string;
  endpoint: string;
  itemSchema: S;
  cols: Col<z.infer<S>>[];
  rowKey?: (r: z.infer<S>) => string;
  title?: string;
  sub?: React.ReactNode;
  pageSize?: number;
  filters?: FilterDef[];
  bulk?: BulkDef[];
  onBulk?: (key: string, ids: string[], done: () => void) => void;
  onOpen?: (r: z.infer<S>) => void;
  extra?: Query;
  exportName?: string;
  emptyText?: string;
  enabled?: boolean;
}

export function ServerTable<S extends z.ZodTypeAny>(p: ServerTableProps<S>) {
  type R = z.infer<S>;
  const t = useT();
  const { notify } = useUi();
  const qc = useQueryClient();
  const pageSize = p.pageSize ?? 8;
  const [state, setState] = useState<TableState>(initialTableState);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const params = useMemo(() => tableParams(state, pageSize, p.extra), [state, pageSize, p.extra]);
  const listSchema = useMemo(() => listOf(p.itemSchema), [p.itemSchema]);
  const key = [p.endpoint, params];
  const q = useQuery<Paged<R>>({
    queryKey: key,
    queryFn: ({ signal }) => api.get(p.endpoint, { query: params, schema: listSchema, signal }) as Promise<Paged<R>>,
    placeholderData: keepPreviousData,
    enabled: p.enabled ?? true,
  });
  const rowKey = p.rowKey ?? ((r: R) => String((r as { id: unknown }).id));

  const exportCsv = useCallback(async () => {
    setExporting(true);
    try {
      const all: R[] = [];
      for (let pg = 1; pg <= 25; pg++) {
        const r = (await api.get(p.endpoint, { query: tableParams({ ...state, page: pg }, 200, p.extra), schema: listSchema })) as Paged<R>;
        all.push(...r.items);
        if (all.length >= r.total || !r.items.length) break;
      }
      const cs = p.cols.filter((c) => c.label);
      downloadCsv(p.exportName ?? p.id, toCsv(cs.map((c) => t(c.label)), all.map((r) => cs.map((c) => (c.text ? c.text(r) : ((r as Record<string, unknown>)[c.key] as string | number | null | undefined))))));
    } catch (e) {
      notify(errMsg(e));
    } finally {
      setExporting(false);
    }
  }, [p.endpoint, p.cols, p.extra, p.exportName, p.id, state, listSchema, notify, t]);

  return (
    <DataTable<R>
      title={p.title}
      sub={p.sub}
      cols={p.cols}
      rows={q.data?.items ?? []}
      total={q.data?.total ?? 0}
      pageSize={pageSize}
      rowKey={rowKey}
      state={state}
      onState={(patch) => setState((s) => ({ ...s, ...patch }))}
      loading={q.isLoading}
      error={q.isError ? errMsg(q.error) : null}
      onRetry={() => void q.refetch()}
      filters={p.filters}
      bulk={p.bulk}
      selection={sel}
      onSelection={setSel}
      onBulk={(k, ids) => p.onBulk?.(k, ids, () => { setSel(new Set()); void qc.invalidateQueries({ queryKey: [p.endpoint] }); })}
      onOpen={p.onOpen}
      onExport={exportCsv}
      exporting={exporting}
      emptyText={p.emptyText}
    />
  );
}
