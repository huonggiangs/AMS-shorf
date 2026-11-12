export interface EndpointStats {
  count: number;
  errors: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
  statuses: Record<string, number>;
}

/** Nearest-rank percentile tren mang da sap xep tang dan. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(sorted.length, rank) - 1]!;
}

export class Recorder {
  private lat = new Map<string, number[]>();
  private st = new Map<string, Record<string, number>>();
  private errs = new Map<string, number>();
  start = 0;
  end = 0;

  add(endpoint: string, ms: number, status: number, expectedStatuses: number[] = [200, 201, 202, 304]): void {
    (this.lat.get(endpoint) ?? this.lat.set(endpoint, []).get(endpoint)!).push(ms);
    const s = this.st.get(endpoint) ?? this.st.set(endpoint, {}).get(endpoint)!;
    s[String(status)] = (s[String(status)] ?? 0) + 1;
    if (!expectedStatuses.includes(status)) this.errs.set(endpoint, (this.errs.get(endpoint) ?? 0) + 1);
  }

  summary(): Record<string, EndpointStats> {
    const out: Record<string, EndpointStats> = {};
    for (const [k, v] of this.lat) {
      const s = [...v].sort((a, b) => a - b);
      out[k] = {
        count: s.length,
        errors: this.errs.get(k) ?? 0,
        p50: percentile(s, 50),
        p95: percentile(s, 95),
        p99: percentile(s, 99),
        max: s[s.length - 1] ?? 0,
        mean: s.reduce((a, b) => a + b, 0) / (s.length || 1),
        statuses: this.st.get(k) ?? {},
      };
    }
    // tong hop
    const all = [...this.lat.values()].flat().sort((a, b) => a - b);
    const errTotal = [...this.errs.values()].reduce((a, b) => a + b, 0);
    const stAll: Record<string, number> = {};
    for (const r of this.st.values()) for (const [k, n] of Object.entries(r)) stAll[k] = (stAll[k] ?? 0) + n;
    out['ALL'] = { count: all.length, errors: errTotal, p50: percentile(all, 50), p95: percentile(all, 95), p99: percentile(all, 99), max: all[all.length - 1] ?? 0, mean: all.reduce((a, b) => a + b, 0) / (all.length || 1), statuses: stAll };
    return out;
  }

  totalRequests(): number {
    let n = 0;
    for (const v of this.lat.values()) n += v.length;
    return n;
  }
}
