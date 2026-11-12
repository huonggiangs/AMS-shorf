import { describe, expect, it } from 'vitest';
import { BOM, toCsv } from '../lib/csv';
import { checkCreative, checkMediaUrl, ELEVATOR_SIZES } from '../lib/creative';
import { vndInWords } from '../lib/format';
import { qrUrl, transferContent } from '../lib/sepay';
import { snapMove } from '../pages/Schedule';
import { visiblePages } from '../nav';
import { clampForRole, isLocked, ROLE_PRESET } from '../lib/rbac';
import { MODULES, type Module } from '../api/schemas';
import { tableParams } from '../components/ServerTable';
import { initialTableState } from '../components/DataTable';

describe('csv', () => {
  it('starts with UTF-8 BOM, quotes and escapes', () => {
    const c = toCsv(['Tên', 'Số tiền'], [['Sữa "tươi"', 1000]]);
    expect(c.startsWith(BOM)).toBe(true);
    expect(c).toContain('"Sữa ""tươi"""');
    expect(c.split('\r\n')).toHaveLength(2);
  });
});

describe('vndInWords', () => {
  it('spells amounts in Vietnamese', () => {
    expect(vndInWords(450_000_000)).toBe('Bốn trăm năm mươi triệu đồng chẵn');
    expect(vndInWords(1_250_000)).toBe('Một triệu hai trăm năm mươi nghìn đồng chẵn');
    expect(vndInWords(0)).toBe('Không đồng');
  });
});

describe('creative size check', () => {
  it('tv needs 16:9', () => {
    expect(checkCreative({ type: 'tv' }, { width: 1920, height: 1080 }).ok).toBe(true);
    expect(checkCreative({ type: 'tv' }, { width: 1080, height: 1920 }).ok).toBe(false);
  });
  it('elevator is portrait and exact for the chosen size', () => {
    expect(checkCreative({ type: 'elevator', px: ELEVATOR_SIZES['21.5'] }, { width: 1080, height: 1920 }).ok).toBe(true);
    expect(checkCreative({ type: 'elevator', px: ELEVATOR_SIZES['18.5'] }, { width: 1080, height: 1920 }).ok).toBe(false);
    expect(checkCreative({ type: 'elevator' }, { width: 1920, height: 1080 }).ok).toBe(false);
  });
  it('led must match exactly, no scaling', () => {
    expect(checkCreative({ type: 'led', px: { w: 512, h: 256 } }, { width: 512, height: 256 }).ok).toBe(true);
    expect(checkCreative({ type: 'led', px: { w: 512, h: 256 } }, { width: 1024, height: 512 }).ok).toBe(false);
  });
});

describe('media link domain check', () => {
  it('accepts matching hosts only', () => {
    expect(checkMediaUrl('youtube', 'https://www.youtube.com/watch?v=abc').ok).toBe(true);
    expect(checkMediaUrl('youtube', 'https://evil.example/watch').ok).toBe(false);
    expect(checkMediaUrl('drive', 'https://drive.google.com/file/d/1/view').ok).toBe(true);
    expect(checkMediaUrl('dropbox', 'https://www.dropbox.com/s/x/a.mp4?dl=1').ok).toBe(true);
    expect(checkMediaUrl('url', 'https://cdn.example.com/a.mp4').ok).toBe(true);
    expect(checkMediaUrl('url', 'http://cdn.example.com/a.mp4').ok).toBe(false);
    expect(checkMediaUrl('url', 'https://localhost/a.mp4').ok).toBe(false);
  });
});

describe('sepay helpers', () => {
  it('builds content AMS <code> and VietQR url', () => {
    expect(transferContent('AMS', 'K004')).toBe('AMS K004');
    const u = qrUrl({ account: '0123456789', bank: 'MBBank', amount: 50_000_000, content: 'AMS K004' });
    expect(u).toBe('https://qr.sepay.vn/img?acc=0123456789&bank=MBBank&amount=50000000&des=AMS%20K004');
  });
});

describe('timeline snapping', () => {
  it('snaps to 30 minutes and stays inside the day', () => {
    expect(snapMove(360, 510, 40)).toEqual([390, 540]);
    expect(snapMove(60, 180, -500)).toEqual([0, 120]);
    expect(snapMove(1300, 1400, 500)).toEqual([1340, 1440]);
  });
});

describe('menu filtering by permission', () => {
  const mk = (granted: Module[]) => (m: Module) => granted.includes(m);
  it('internal role sees only permitted pages', () => {
    const p = visiblePages(mk(['overview', 'devices']), false);
    expect(p).toContain('overview');
    expect(p).toContain('profile');
    expect(p).not.toContain('finance');
    expect(p).not.toContain('access');
  });
  it('external accounts only get ads, media and wallet even if granted more', () => {
    const p = visiblePages(mk([...MODULES]), true);
    expect(p.sort()).toEqual(['ads', 'finance', 'media']);
  });
});

describe('rbac helpers', () => {
  it('external roles are locked from approve/delete and non-ad modules', () => {
    expect(isLocked('customer', 'devices', 'view')).toBe(true);
    expect(isLocked('customer', 'campaigns', 'approve')).toBe(true);
    expect(isLocked('customer', 'campaigns', 'write')).toBe(false);
    expect(isLocked('super_admin', 'admin', 'delete')).toBe(false);
  });
  it('clamp removes locked cells', () => {
    const c = clampForRole('customer', { ...ROLE_PRESET.super_admin });
    expect(Object.keys(c).sort()).toEqual(['campaigns', 'finance', 'media']);
    expect(c.campaigns).toEqual(['view', 'write']);
  });
});

describe('server table params', () => {
  it('maps state to ?page&page_size&q&sort&filter', () => {
    const p = tableParams({ ...initialTableState, q: 'abc', page: 3, sort: 'name', dir: -1, filters: { status: 'active', region: '' } }, 8);
    expect(p).toMatchObject({ page: 3, page_size: 8, q: 'abc', sort: 'name:desc', filter: 'status:active' });
  });
});

import { emptyOverlay, overlayError, overlayPayload } from '../components/OverlayForm';
describe('overlay form helpers', () => {
  it('payload rỗng khi không nhập gì', () => {
    expect(overlayPayload(emptyOverlay())).toBeUndefined();
  });
  it('dựng đúng lược đồ hotline + qr', () => {
    const d = { ...emptyOverlay(), headline: ' Giảm 20% ', hotline_number: '1900 1234', qr_url: 'https://v.example/x', qr_title: 'Quét' };
    expect(overlayPayload(d)).toEqual({ headline: 'Giảm 20%', hotline: { number: '1900 1234' }, qr: { url: 'https://v.example/x', title: 'Quét' } });
  });
  it('từ chối QR http và hotline có chữ', () => {
    expect(overlayError({ ...emptyOverlay(), qr_url: 'http://x.example' })).toMatch(/https/);
    expect(overlayError({ ...emptyOverlay(), hotline_number: 'abc' })).toMatch(/Hotline/);
    expect(overlayError({ ...emptyOverlay(), qr_url: 'https://ok.example', hotline_number: '+84 90 123 4567' })).toBeNull();
  });
});
