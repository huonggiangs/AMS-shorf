import { describe, expect, it } from 'vitest';
import { parseOverlay } from '../src/index.js';

const base = { headline: 'Xin chào', qr: { url: 'https://a.vn/x', hint: 'Quét bằng Camera' }, duration_s: 15, safe_area: { top: 5, right: 5, bottom: 5, left: 5 }, contexts: ['fullscreen', 'pause'] };

describe('parseOverlay: truong mo rong cho TV', () => {
  it('giu qr.hint, duration_s, safe_area, contexts', () => {
    const r = parseOverlay(base);
    expect(r).toEqual({ ok: true, value: { headline: 'Xin chào', qr: { url: 'https://a.vn/x', hint: 'Quét bằng Camera' }, duration_s: 15, safe_area: { top: 5, right: 5, bottom: 5, left: 5 }, contexts: ['fullscreen', 'pause'] } });
  });
  it('kiem tra bien: hint > 40, duration 4/61, safe_area 16, context la', () => {
    for (const bad of [{ qr: { url: 'https://a.vn', hint: 'x'.repeat(41) } }, { duration_s: 4 }, { duration_s: 61 }, { duration_s: 7.5 }, { safe_area: { top: 16, right: 0, bottom: 0, left: 0 } }, { safe_area: { top: 1 } }, { contexts: ['menu'] }, { kid_safe: 'yes' }]) {
      expect(parseOverlay(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });
  it('mac dinh an toan: kid_safe=true va context lock bi bo am tham (strip)', () => {
    const r = parseOverlay({ ...base, kid_safe: true, contexts: ['lock', 'fullscreen'] });
    expect(r.ok && r.value).toMatchObject({ contexts: ['fullscreen'] });
    expect(r.ok && r.value && 'kid_safe' in r.value).toBe(false);
    const only = parseOverlay({ headline: 'a', kid_safe: true, contexts: ['lock'] });
    expect(only).toEqual({ ok: true, value: { headline: 'a' } });
  });
  it('reject: tra loi cho khach; kid_safe=false van duoc phep', () => {
    expect(parseOverlay({ kid_safe: true }, { reviewerFields: 'reject' }).ok).toBe(false);
    expect(parseOverlay({ contexts: ['lock'] }, { reviewerFields: 'reject' }).ok).toBe(false);
    expect(parseOverlay({ kid_safe: false }, { reviewerFields: 'reject' })).toEqual({ ok: true, value: { kid_safe: false } });
  });
  it('keep: du lieu da duoc nguoi duyet giu nguyen', () => {
    const r = parseOverlay({ headline: 'a', kid_safe: true, contexts: ['lock', 'fullscreen'] }, { reviewerFields: 'keep' });
    expect(r).toEqual({ ok: true, value: { headline: 'a', kid_safe: true, contexts: ['lock', 'fullscreen'] } });
  });
  it('khop luoc do brainrot-tv: moi overlay hop le cua may chu deu qua overlaySchema cua TV', async () => {
    const { overlaySchema } = await import('../../../integrations/brainrot-tv/schema/overlay.js').catch(() => ({ overlaySchema: null }));
    if (!overlaySchema) return; // integrations/brainrot-tv khong thuoc workspace; neu khong nap duoc (thieu zod) bo qua
    const r = parseOverlay({ ...base, kid_safe: true, contexts: ['lock'] }, { reviewerFields: 'keep' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(overlaySchema.safeParse(r.value).success).toBe(true);
  });
});
