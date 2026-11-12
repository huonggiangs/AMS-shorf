import { VirtualDevice, type DeviceOpts, type DeviceReport } from './device.js';
import { Recorder } from './stats.js';
import type { Transport } from './transport.js';

export interface FleetOpts {
  devices: number;
  concurrency: number;
  cycles: number;
  eventsPerDevice: number;
  transport: Transport;
  timeScale?: number;
  confirmPairing?: DeviceOpts['confirmPairing'];
  kind?: string;
  /** vung cua tung thiet bi (i -> ma vung) */
  region?: (i: number) => string;
  nowSec?: () => number;
  onProgress?: (done: number, total: number) => void;
}

export interface FleetReport {
  devices: number;
  completed: number; // da dang ky + heartbeat OK + (neu co lich) da gui su kien
  registered: number;
  paired: number;
  heartbeats: number;
  retries: number;
  manifestFetches: number;
  manifest304: number;
  eventsSent: number;
  eventsAccepted: number;
  eventsValid: number;
  deviceErrors: number;
  firstErrors: string[];
  intervals: { base: number; next: number }[];
  wallSeconds: number;
  requests: number;
  throughputRps: number;
  endpoints: ReturnType<Recorder['summary']>;
}

export async function runFleet(o: FleetOpts): Promise<FleetReport> {
  const rec = new Recorder();
  const reports: DeviceReport[] = [];
  let next = 0;
  let done = 0;
  rec.start = performance.now();
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= o.devices) return;
      const d = new VirtualDevice({
        transport: o.transport,
        rec,
        ...(o.timeScale !== undefined ? { timeScale: o.timeScale } : {}),
        ...(o.confirmPairing ? { confirmPairing: o.confirmPairing } : {}),
        ...(o.kind ? { kind: o.kind } : {}),
        ...(o.region ? { region: o.region(i) } : {}),
        ...(o.nowSec ? { nowSec: o.nowSec } : {}),
      });
      reports.push(await d.run({ cycles: o.cycles, eventsPerDevice: o.eventsPerDevice }));
      o.onProgress?.(++done, o.devices);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(o.concurrency, o.devices)) }, worker));
  rec.end = performance.now();
  const wall = (rec.end - rec.start) / 1000;
  const sum = (f: (r: DeviceReport) => number) => reports.reduce((s, r) => s + f(r), 0);
  const requests = rec.totalRequests();
  return {
    devices: o.devices,
    completed: reports.filter((r) => r.registered && r.heartbeats >= o.cycles && r.errors.length === 0 && (o.eventsPerDevice === 0 || r.creatives === 0 || r.eventsAccepted === r.eventsSent)).length,
    registered: reports.filter((r) => r.registered).length,
    paired: reports.filter((r) => r.paired).length,
    heartbeats: sum((r) => r.heartbeats),
    retries: sum((r) => r.retries),
    manifestFetches: sum((r) => r.manifestFetches),
    manifest304: sum((r) => r.manifest304),
    eventsSent: sum((r) => r.eventsSent),
    eventsAccepted: sum((r) => r.eventsAccepted),
    eventsValid: sum((r) => r.eventsValid),
    deviceErrors: reports.filter((r) => r.errors.length > 0).length,
    firstErrors: reports.flatMap((r) => r.errors).slice(0, 5),
    intervals: reports.flatMap((r) => r.intervals),
    wallSeconds: wall,
    requests,
    throughputRps: wall > 0 ? requests / wall : 0,
    endpoints: rec.summary(),
  };
}
