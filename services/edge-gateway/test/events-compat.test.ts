import { describe, expect, it } from 'vitest';
import { uuidv7 } from '@ams/shared';
import { extractEvents, normalizeEvent, normalizeTs } from '../src/events-compat.js';

const ctx = { durationMs: (id: string) => (id === 'c15' ? 15000 : null) };
const T = Date.parse('2026-11-12T03:00:00.123Z');

describe('chuan hoa su kien (events-compat)', () => {
  it('Mindo toWire (impression) di qua NGUYEN VEN, khong alias', () => {
    const ev = { type: 'impression', event_id: uuidv7(T), ts: '2026-11-12T03:00:00.123Z', campaign_id: 'cp1', creative_id: 'c15', slot_id: 's1', vcr_pct: 100, played_ms: 15000 };
    const r = normalizeEvent(ev, ctx);
    expect(r).toEqual({ ev, aliases: [] });
  });
  it('Signage Player recordPlay (proof_of_play) di qua nguyen ven, khong alias', () => {
    const ev = { type: 'proof_of_play', event_id: uuidv7(T), ts: '2026-11-12T03:00:00.123Z', creative_id: 'c15', duration_ms: 14000 };
    expect(normalizeEvent(ev, ctx)).toEqual({ ev, aliases: [] });
  });
  it('alias va kieu cu: camelCase, so dang chuoi, epoch giay/ms, mui gio, thoi luong giay, type la', () => {
    const base = { event_id: '3f2b8f0e-5a1c-4d7e-9b21-0c8a1f3e4d55', creative_id: 'c15' };
    const a = normalizeEvent({ ...base, type: 'playback', ts: '2026-11-12T10:00:00.123+07:00', played_ms: '14000.4' }, ctx);
    expect(a).toMatchObject({ ev: { type: 'proof_of_play', ts: '2026-11-12T03:00:00.123Z', duration_ms: 14000 } });
    expect((a as { aliases: string[] }).aliases).toEqual(expect.arrayContaining(['played_ms', 'ts_format', 'type:playback']));
    expect(normalizeEvent({ ...base, type: 'proof_of_play', ts: Math.floor(T / 1000), duration: 15 }, ctx)).toMatchObject({ ev: { duration_ms: 15000, ts: '2026-11-12T03:00:00.000Z' } });
    expect(normalizeEvent({ ...base, type: 'proof_of_play', ts: T, duration_s: 15 }, ctx)).toMatchObject({ ev: { duration_ms: 15000 } });
    // impression thieu vcr_pct: suy tu played_ms / thoi luong creative
    const i = normalizeEvent({ ...base, type: 'impression', ts: T, campaign_id: 'cp1', played_ms: 7500 }, ctx);
    expect(i).toMatchObject({ ev: { vcr_pct: 50, played_ms: 7500 } });
    // khong type: co campaign + vcr => impression; chi co duration => proof_of_play
    expect(normalizeEvent({ ...base, ts: T, campaign_id: 'cp1', vcr_pct: 100, played_ms: 15000 }, ctx)).toMatchObject({ ev: { type: 'impression' } });
    expect(normalizeEvent({ ...base, ts: T, duration_ms: 15000 }, ctx)).toMatchObject({ ev: { type: 'proof_of_play' } });
  });
  it('rac van malformed: event_id khong phai UUID, thieu creative, thoi luong khong phai so, type la, khong phai object', () => {
    const ok = { type: 'proof_of_play', event_id: uuidv7(T), ts: T, creative_id: 'c15', duration_ms: 1 };
    expect(normalizeEvent({ ...ok, event_id: 'abc' }, ctx)).toEqual({ error: 'malformed' });
    expect(normalizeEvent({ ...ok, creative_id: undefined }, ctx)).toEqual({ error: 'malformed' });
    expect(normalizeEvent({ ...ok, duration_ms: 'abc' }, ctx)).toEqual({ error: 'malformed' });
    expect(normalizeEvent({ ...ok, type: 'xyz' }, ctx)).toEqual({ error: 'malformed' });
    expect(normalizeEvent('x', ctx)).toEqual({ error: 'malformed' });
    expect(normalizeEvent(null, ctx)).toEqual({ error: 'malformed' });
    expect(normalizeEvent({ ...ok, ts: 'hom qua' }, ctx)).toEqual({ error: 'malformed' });
  });
  it('kep gia tri ve khoang hop le (thoi luong <= 1 gio, vcr <= 100)', () => {
    expect(normalizeEvent({ type: 'proof_of_play', event_id: uuidv7(T), ts: T, creative_id: 'c', duration_ms: 99_999_999 }, ctx)).toMatchObject({ ev: { duration_ms: 3_600_000 } });
    expect(normalizeEvent({ type: 'impression', event_id: uuidv7(T), ts: T, campaign_id: 'x', creative_id: 'c', vcr_pct: 250, played_ms: 1 }, ctx)).toMatchObject({ ev: { vcr_pct: 100 } });
  });
  it('normalizeTs / extractEvents', () => {
    expect(normalizeTs('2026-11-12 03:00:00')).toBe('2026-11-12T03:00:00.000Z');
    expect(normalizeTs('xx')).toBeUndefined();
    expect(extractEvents({ events: [1] })).toEqual({ events: [1], alias: null });
    expect(extractEvents({ items: [1] })).toEqual({ events: [1], alias: 'body_items' });
    expect(extractEvents([1, 2])).toEqual({ events: [1, 2], alias: 'body_array' });
    expect(extractEvents({ foo: 1 }).events).toBeNull();
  });
});
