// loadtest --devices N [--gateway URL] [--concurrency C] [--cycles K] [--events E] [--time-scale S] [--dialect sqlite|postgres] [--json]
// Khong co --gateway: chay IN-PROCESS (gateway + consumer + CSDL bo nho, khong qua mang) — so do la do tre CPU, KHONG phai do tre mang.
import { createInProcessEnv } from './inproc.js';
import { runFleet, type FleetReport } from './fleet.js';
import { httpTransport } from './transport.js';

export function parseArgs(argv: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  const a = argv.filter((x) => x !== '--');
  for (let i = 0; i < a.length; i++) {
    const t = a[i]!;
    if (!t.startsWith('--')) continue;
    const [k, v] = t.slice(2).split('=');
    if (v !== undefined) out[k!] = v;
    else if (a[i + 1] && !a[i + 1]!.startsWith('--')) out[k!] = a[++i]!;
    else out[k!] = true;
  }
  return out;
}

const f = (n: number) => n.toFixed(n < 10 ? 2 : 1);

export function formatReport(r: FleetReport, mode: string): string {
  const lines: string[] = [];
  lines.push(`== loadtest ${mode} ==`);
  lines.push(`thiet bi: ${r.devices}  hoan tat luong: ${r.completed}  dang ky: ${r.registered}  ghep doi: ${r.paired}`);
  lines.push(`request: ${r.requests}  thoi gian: ${f(r.wallSeconds)}s  thong luong: ${f(r.throughputRps)} req/s`);
  const all = r.endpoints['ALL']!;
  lines.push(`ty le loi (HTTP khac 2xx/304, gom 429/503 bi giam tai): ${((all.errors / Math.max(1, all.count)) * 100).toFixed(2)}%  (${all.errors}/${all.count})  thu lai: ${r.retries}`);
  lines.push(`su kien: gui ${r.eventsSent}, chap nhan ${r.eventsAccepted}, hop le ${r.eventsValid}; manifest: ${r.manifestFetches} lan (304: ${r.manifest304})`);
  lines.push('');
  lines.push('endpoint        so luong    p50(ms)   p95(ms)   p99(ms)   max(ms)  loi');
  for (const [k, s] of Object.entries(r.endpoints)) lines.push(`${k.padEnd(14)} ${String(s.count).padStart(9)} ${f(s.p50).padStart(9)} ${f(s.p95).padStart(9)} ${f(s.p99).padStart(9)} ${f(s.max).padStart(9)} ${String(s.errors).padStart(5)}`);
  if (r.firstErrors.length) lines.push('', 'loi dau tien: ' + r.firstErrors.join(' | '));
  return lines.join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const devices = Number(args['devices'] ?? 100);
  const concurrency = Number(args['concurrency'] ?? 50);
  const cycles = Number(args['cycles'] ?? 2);
  const events = Number(args['events'] ?? 5);
  const timeScale = Number(args['time-scale'] ?? 0);
  const regions = ['HN', 'HCM'];
  const progress = (d: number, t: number) => {
    if (!args['json'] && d % Math.max(1, Math.floor(t / 10)) === 0) process.stderr.write(`  ${d}/${t}\r`);
  };
  if (typeof args['gateway'] === 'string') {
    const transport = httpTransport(args['gateway']);
    // ghep doi qua endpoint dev cua gateway (GATEWAY_DEV_ENDPOINTS=1 hoac RUNTIME=test); 404 => bo qua, thiet bi o lai trust 0
    let devPair = true;
    const confirmPairing = async (code: string) => {
      if (!devPair) return false;
      const res = await fetch(args['gateway'] + '/v1/dev/pair-confirm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
      if (res.status === 404 && !(await res.clone().text()).includes('"ok"')) {
        devPair = false;
        return false;
      }
      return res.ok;
    };
    const r = await runFleet({ devices, concurrency, cycles, eventsPerDevice: events, transport, timeScale, confirmPairing, region: (i) => regions[i % 2]!, onProgress: progress });
    console.log(args['json'] ? JSON.stringify(r) : formatReport(r, `HTTP ${args['gateway']} (qua mang that)`));
    process.exit(r.completed === r.devices ? 0 : 1);
  }
  const dialect = args['dialect'] === 'postgres' ? 'postgres' : 'sqlite';
  const env = await createInProcessEnv({ dialect });
  const r = await runFleet({ devices, concurrency, cycles, eventsPerDevice: events, transport: env.transport, timeScale, confirmPairing: env.confirmPairing, region: (i) => regions[i % 2]!, onProgress: progress });
  await env.settle();
  const evCount = Number((await env.rt.db.query<{ n: number }>('SELECT COUNT(*) AS n FROM ev_ad_impression'))[0]!.n);
  const hourly = Number((await env.rt.db.query<{ n: number }>('SELECT COALESCE(SUM(impressions),0) AS n FROM impression_hourly'))[0]!.n);
  const spent = env.spends.reduce((s, x) => s + x.impressions, 0);
  console.log(args['json'] ? JSON.stringify({ ...r, db: { ev_ad_impression: evCount, impression_hourly: hourly, spendImpressions: spent } }) : formatReport(r, `IN-PROCESS (${dialect}, khong qua mang; do tre = CPU gateway + DB bo nho)`));
  if (!args['json']) console.log(`\ndoi chieu DB: ev_ad_impression=${evCount} impression_hourly=${hourly} chi tieu(goi spend)=${spent} su kien hop le gui=${r.eventsValid}`);
  await env.close();
  process.exit(r.completed === r.devices && evCount === r.eventsValid ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) void main();
