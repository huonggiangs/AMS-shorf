import { describe, expect, it } from 'vitest';
import { DEFAULT_GW_CAPACITY_RPS } from '../src/gateway.js';
import { DEFAULT_DEVICE_STATE_TTL_S, DEVICE_KV_TTL_S, HB_DEFAULT_MAX_BASE_S, HB_JITTER, HB_STRETCH_MAX, PRESENCE_TTL_S, maxNextIntervalS, ttlForConfig, ttlForMaxInterval } from '../src/heartbeat-ttl.js';
import { DEFAULT_INTERVALS, computeInterval } from '../src/load.js';
import { JITTER, PRESENCE_TTL_S as PROTOCOL_PRESENCE_TTL_S } from '../src/protocol.js';

describe('TTL dan xuat tu chu ky heartbeat', () => {
  it('hang so khop voi giao thuc that (jitter, chu ky mac dinh) va protocol/presence dung chung', () => {
    expect(HB_JITTER).toBe(JITTER);
    expect(HB_DEFAULT_MAX_BASE_S).toBe(Math.max(...Object.values(DEFAULT_INTERVALS)));
    expect(PROTOCOL_PRESENCE_TTL_S).toBe(PRESENCE_TTL_S);
    expect(PRESENCE_TTL_S).toBe(DEFAULT_DEVICE_STATE_TTL_S);
    expect(DEVICE_KV_TTL_S).toBe(DEFAULT_DEVICE_STATE_TTL_S);
  });

  it('next_interval lon nhat that (moi trang thai, tai bat ky, jitter cuc tri) khong vuot maxNextIntervalS; TTL >= 2 x do', () => {
    const max = maxNextIntervalS(DEFAULT_INTERVALS);
    expect(max).toBe(2880);
    let seen = 0;
    for (const state of [0, 1, 2, 3])
      for (const load of [0, 0.5, 0.7, 1, 2, 10, 1000])
        for (const r of [0, 0.5, 1]) {
          const { next } = computeInterval(state, false, load, {}, DEFAULT_INTERVALS, () => r);
          expect(next).toBeLessThanOrEqual(max);
          seen = Math.max(seen, next);
        }
    expect(seen).toBe(max); // can chinh xac, khong du thua tuy y
    expect(PRESENCE_TTL_S).toBeGreaterThanOrEqual(2 * seen + 60);
    expect(DEVICE_KV_TTL_S).toBeGreaterThan(360); // loi cu: 300 s < chu ky 240-360 s
    expect(PRESENCE_TTL_S).toBeGreaterThan(600 * (1 + HB_JITTER) * 2.5); // loi cu: 360 s < chu ky ranh 600 s
    expect(HB_STRETCH_MAX).toBe(4);
  });

  it('theo cau hinh HB_*_S thuc te: chu ky dai hon -> TTL dai hon', () => {
    const big = { playingS: 300, idleS: 1200, errorS: 120, monitoredS: 15 };
    expect(ttlForConfig(big)).toBe(ttlForMaxInterval(Math.ceil(1200 * 4 * 1.2)));
    expect(ttlForConfig(big)).toBeGreaterThan(ttlForConfig(DEFAULT_INTERVALS));
  });

  it('cong suat mac dinh duoc ha xuong theo do (khong con 5000)', () => {
    expect(DEFAULT_GW_CAPACITY_RPS).toBe(700);
  });
});
