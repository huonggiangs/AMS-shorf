import type { Runtime } from '@ams/runtime';

/** Ngay hien tai theo gio Viet Nam (UTC+7), dang YYYY-MM-DD. */
export const todayVn = (rt: Runtime): string => new Date(rt.clock.now().getTime() + 7 * 3600_000).toISOString().slice(0, 10);
export const isDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());
export const dayStart = (d: string): string => `${d}T00:00:00.000Z`;
export const dayEnd = (d: string): string => `${d}T23:59:59.000Z`;
export const addMonths = (d: string, months: number): string => {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1 + months, day));
  return t.toISOString().slice(0, 10);
};
export const fmtDmy = (d: string | null | undefined): string => {
  if (!d) return '…';
  const [y, m, day] = String(d).slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
};
