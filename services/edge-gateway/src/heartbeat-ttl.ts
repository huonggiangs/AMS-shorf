// TTL cua trang thai theo thiet bi (khoa kv `dev:<id>`, `presence:<id>`) DAN XUAT tu chu ky heartbeat do may chu tra ve (next_interval),
// khong phai hang so tuy y. Tep nay khong import gi de tranh vong phu thuoc (protocol.ts / load.ts / worker.ts dung lai);
// test (test/ttl.test.ts) khoa cac hang so nay vao DEFAULT_INTERVALS, JITTER va computeInterval that.
//
// Loi cu: `dev:` 300 s < chu ky 240-360 s va PRESENCE_TTL 360 s < chu ky ranh 600 s => khoa het han GIUA hai heartbeat:
// ~mot nua heartbeat chay truy van Postgres, thiet bi ranh bi coi offline.

/** Jitter +-20% quanh chu ky co so (bang JITTER o protocol.ts). */
export const HB_JITTER = 0.2;
/** computeInterval keo gian chu ky toi da x4 khi qua tai (load.ts). */
export const HB_STRETCH_MAX = 4;
/** Chu ky co so lon nhat mac dinh (trang thai ranh, DEFAULT_INTERVALS.idleS). */
export const HB_DEFAULT_MAX_BASE_S = 600;
/** Du phong them cho tre mang / hang cho. */
export const HB_TTL_MARGIN_S = 60;

/** next_interval LON NHAT co the tra ve: max(co so) x gian toi da x (1 + jitter). Mac dinh 600 x 4 x 1,2 = 2880 s. */
export function maxNextIntervalS(cfg: { playingS: number; idleS: number; errorS: number; monitoredS: number } | { maxBaseS: number }): number {
  const base = 'maxBaseS' in cfg ? cfg.maxBaseS : Math.max(cfg.playingS, cfg.idleS, cfg.errorS, cfg.monitoredS);
  return Math.ceil(base * HB_STRETCH_MAX * (1 + HB_JITTER));
}

/** TTL toi thieu de khoa song sot qua it nhat MOT heartbeat bi tre: 2 x chu ky toi da + du phong (spec: online neu last_seen < 2,5 x chu ky). */
export function ttlForMaxInterval(maxIntervalS: number): number {
  return 2 * Math.ceil(maxIntervalS) + HB_TTL_MARGIN_S;
}

/** Gia tri mac dinh (chu ky mac dinh): 2 x 2880 + 60 = 5820 s. Gateway tinh lai tu cau hinh HB_*_S thuc te (ttlForConfig). */
export const DEFAULT_DEVICE_STATE_TTL_S = ttlForMaxInterval(maxNextIntervalS({ maxBaseS: HB_DEFAULT_MAX_BASE_S }));
/** `presence:<id>` (kv / Durable Object). */
export const PRESENCE_TTL_S = DEFAULT_DEVICE_STATE_TTL_S;
/** `dev:<id>` (kv). An toan khi dai: ben ghi (API) goi invalidate/del khoa kv khi chan/doi trust/ghep doi. */
export const DEVICE_KV_TTL_S = DEFAULT_DEVICE_STATE_TTL_S;

export function ttlForConfig(cfg: { playingS: number; idleS: number; errorS: number; monitoredS: number }): number {
  return ttlForMaxInterval(maxNextIntervalS(cfg));
}
