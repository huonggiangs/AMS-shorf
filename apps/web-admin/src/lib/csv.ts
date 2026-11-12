/** CSV with UTF-8 BOM so Excel opens Vietnamese text correctly. */
export const BOM = '﻿';
const q = (v: unknown): string => `"${String(v ?? '').replace(/"/g, '""')}"`;
export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  return BOM + [header, ...rows].map((r) => r.map(q).join(',')).join('\r\n');
}
export function downloadCsv(name: string, csv: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
