import { useState } from 'react';

export const SERIES_COLORS = ['#005BBF', '#0284C7', '#059669', '#D97706', '#94A3B8'];

export interface LineSeries { n: string; c: string; d: number[] }

/** Trend line with hover tooltip (port of prototype line()). */
export function LineChart({ series, labels, h = 220, fmt = (v: number) => v.toLocaleString('vi-VN') }: { series: LineSeries[]; labels: string[]; h?: number; fmt?: (v: number) => string }) {
  const [hi, setHi] = useState<number | null>(null);
  if (!labels.length || !series.length) return null;
  const W = 760, pl = 44, pb = 26, pt = 12;
  const max = Math.max(1, ...series.flatMap((s) => s.d)) * 1.1;
  const n = labels.length;
  const x = (i: number) => (n === 1 ? pl : pl + (i * (W - pl - 10)) / (n - 1));
  const y = (v: number) => pt + (h - pt - pb) * (1 - v / max);
  const tick = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}tr` : v >= 1e3 ? `${Math.round(v / 1e3)}k` : String(Math.round(v)));
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${h}`} role="img" aria-label={series.map((s) => s.n).join(', ')}>
        {[0, 0.25, 0.5, 0.75, 1].map((k) => (
          <g key={k}>
            <line x1={pl} x2={W - 10} y1={y(max * k)} y2={y(max * k)} stroke="var(--line)" />
            <text x={pl - 8} y={y(max * k) + 4} textAnchor="end">{k ? tick(max * k) : 0}</text>
          </g>
        ))}
        {series.map((s, si) => {
          const p = s.d.map((v, i) => `${i ? 'L' : 'M'}${x(i)} ${y(v)}`).join(' ');
          return (
            <g key={s.n}>
              {si === 0 ? <path d={`${p} L${x(n - 1)} ${h - pb} L${x(0)} ${h - pb}Z`} fill={s.c} opacity=".1" /> : null}
              <path d={p} fill="none" stroke={s.c} strokeWidth={si ? 2 : 3} strokeDasharray={si ? '6 5' : undefined} strokeLinecap="round" strokeLinejoin="round" />
            </g>
          );
        })}
        {labels.map((l, i) => (
          <text key={`l${i}`} x={x(i)} y={h - 6} textAnchor="middle">{l}</text>
        ))}
        {labels.map((l, i) => {
          const tx = Math.min(Math.max(x(i) - 70, pl), W - 150);
          return (
            <g key={`h${i}`} className="hv" onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)} data-hover={hi === i || undefined}>
              <rect x={x(i) - (W - pl) / n / 2} y={0} width={(W - pl) / n} height={h - pb} />
              <line x1={x(i)} x2={x(i)} y1={pt} y2={h - pb} stroke="var(--pri)" strokeOpacity=".35" />
              {series.map((s) => (
                <circle key={s.n} cx={x(i)} cy={y(s.d[i] ?? 0)} r={5} fill={s.c} stroke="#fff" strokeWidth={2} />
              ))}
              <g className="tp">
                <rect x={tx} y={4} width={140} height={22 + series.length * 18} rx={10} />
                <text x={tx + 10} y={22}>{l}</text>
                {series.map((s, k) => (
                  <text key={s.n} x={tx + 10} y={40 + k * 18}>{s.n}: {fmt(s.d[i] ?? 0)}</text>
                ))}
              </g>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export interface DonutPart { n: string; v: number; c: string }
export function Donut({ parts, centerLabel }: { parts: DonutPart[]; centerLabel?: string }) {
  const tot = parts.reduce((a, p) => a + p.v, 0);
  if (!tot) return null;
  const R = 54, C = 2 * Math.PI * R;
  let a = 0;
  return (
    <div style={{ display: 'flex', gap: 22, alignItems: 'center', flexWrap: 'wrap' }}>
      <svg width="150" height="150" viewBox="0 0 150 150" role="img" aria-label={parts.map((p) => `${p.n}: ${p.v}`).join(', ')}>
        <g transform="rotate(-90 75 75)">
          {parts.map((p) => {
            const l = (p.v / tot) * C;
            const el = (
              <circle key={p.n} cx={75} cy={75} r={R} fill="none" stroke={p.c} strokeWidth={22} strokeDasharray={`${l} ${C - l}`} strokeDashoffset={-a}>
                <title>{`${p.n}: ${p.v}`}</title>
              </circle>
            );
            a += l;
            return el;
          })}
        </g>
        <text x={75} y={80} textAnchor="middle" style={{ font: "700 18px -apple-system,BlinkMacSystemFont,'SF Pro Text',system-ui,sans-serif", fill: 'var(--ink)' }}>
          {centerLabel ?? tot.toLocaleString('vi-VN')}
        </text>
      </svg>
      <div>
        {parts.map((p) => (
          <div key={p.n} style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '6px 0' }}>
            <i style={{ width: 10, height: 10, borderRadius: 3, background: p.c }} />
            {p.n}
            <b style={{ marginLeft: 'auto', paddingLeft: 14 }}>{p.v.toLocaleString('vi-VN')}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Grouped bars (views grey, revenue blue). */
export function GroupBars({ data, highlight = [] }: { data: { label: string; a: number; b: number; tip?: string }[]; highlight?: string[] }) {
  const mx = Math.max(1, ...data.flatMap((d) => [d.a, d.b]));
  return (
    <div className="bars-v">
      {data.map((d) => (
        <div key={d.label} title={d.tip ?? `${d.label}: ${d.a} / ${d.b}`}>
          <div className="pair">
            <i style={{ height: `${(d.a / mx) * 100}%`, background: highlight.includes(d.label) ? '#F6D9B8' : '#CBD5E1' }} />
            <i style={{ height: `${(d.b / mx) * 100}%`, background: '#0284C7' }} />
          </div>
          <em style={highlight.includes(d.label) ? { color: 'var(--pri)', fontWeight: 700 } : undefined}>{d.label}</em>
        </div>
      ))}
    </div>
  );
}

/** Slot-fill heat map. rows: day + values per time column. */
export function Heat({ rows, cols }: { rows: { day: string; values: number[] }[]; cols: string[] }) {
  const col = (v: number): [string, string] =>
    v >= 100 ? ['#005BBF', '#fff'] : v >= 90 ? ['#0284C7', '#fff'] : v >= 75 ? ['#7DB5E8', '#0F172A'] : v >= 60 ? ['#BFDBF4', '#0F172A'] : ['#EEF2F7', '#64748B'];
  return (
    <div className="hm" style={cols.length === 9 ? undefined : { gridTemplateColumns: `36px repeat(${cols.length},1fr)` }}>
      <div className="h">Thứ</div>
      {cols.map((h) => (
        <div className="h" key={h}>{h}</div>
      ))}
      {rows.map((r) => (
        <Row key={r.day} r={r} col={col} />
      ))}
    </div>
  );
}
function Row({ r, col }: { r: { day: string; values: number[] }; col: (v: number) => [string, string] }) {
  return (
    <>
      <div className="r">{r.day}</div>
      {r.values.map((v, i) => {
        const c = col(v);
        return (
          <div key={i} title={`${v}% slot fill`} style={{ background: c[0], color: c[1] }}>
            {v}%
          </div>
        );
      })}
    </>
  );
}

/** Pacing / progress bar. */
export function PaceBar({ pct, warnBelow = 60 }: { pct: number; warnBelow?: number }) {
  const v = Math.max(0, Math.min(100, pct));
  return (
    <div className={`bar ${v < warnBelow ? 'w' : ''}`} role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: `${v}%` }} />
    </div>
  );
}
