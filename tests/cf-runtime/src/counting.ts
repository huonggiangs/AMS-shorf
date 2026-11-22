// Boc D1Database de dem rows_read / rows_written / so cau lenh (meta cua D1 local simulator, cung dinh dang production).
export class CountingD1 {
  rowsRead = 0;
  rowsWritten = 0;
  statements = 0;
  roundTrips = 0;
  constructor(private d: any) {}
  reset(): void {
    this.rowsRead = this.rowsWritten = this.statements = this.roundTrips = 0;
  }
  private add(meta: any): void {
    this.rowsRead += Number(meta?.rows_read ?? 0);
    this.rowsWritten += Number(meta?.rows_written ?? 0);
    this.statements++;
  }
  prepare(sql: string): any {
    return this.wrap(this.d.prepare(sql));
  }
  private wrap(st: any): any {
    const self = this;
    return {
      inner: st,
      bind: (...a: unknown[]) => self.wrap(st.bind(...a)),
      async run() { self.roundTrips++; const r = await st.run(); self.add(r.meta); return r; },
      async all() { self.roundTrips++; const r = await st.all(); self.add(r.meta); return r; },
      async first(c?: string) { self.roundTrips++; const r = await st.all(); self.add(r.meta); return c ? r.results?.[0]?.[c] ?? null : r.results?.[0] ?? null; },
      async raw(o?: any) { self.roundTrips++; return st.raw(o); },
    };
  }
  async batch(stmts: any[]): Promise<any[]> {
    this.roundTrips++;
    const rs = await this.d.batch(stmts.map((s) => s.inner ?? s));
    for (const r of rs) this.add(r.meta);
    return rs;
  }
  exec(sql: string) { return this.d.exec(sql); }
}
