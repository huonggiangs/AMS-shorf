import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BG_TIERS,
  FORMAT_SUPPORT,
  backgroundSizeProblem,
  isLockEligible,
  manifestCreativeWithOverlay,
  overlaySchema,
  type OverlayInput,
} from '../schema/overlay.js';

const vf9 = JSON.parse(readFileSync(new URL('../schema/overlay.example.vf9.json', import.meta.url), 'utf8')) as OverlayInput;

describe('overlay VF9 dung tu assets/formats/ADS.png', () => {
  const o = overlaySchema.parse(vf9);

  it('giu nguyen chu trong anh', () => {
    expect(o.sponsor_tag).toBe('TÀI TRỢ • QUẢNG CÁO 4K');
    expect(o.badges).toEqual(['DOLBY VISION & ATMOS']);
    expect(o.brand_label).toBe('VINFAST AUTO');
    expect(o.scte_id).toBe('VF9-800V-VN'); // hien thi "SCTE-35 ID #VF9-800V-VN"
    expect(o.headline).toBe('VinFast VF 9 - Đỉnh Cao Trải Nghiệm Doanh Nhân');
    expect(o.hotline).toEqual({ label: 'HOTLINE TƯ VẤN 24/7', number: '1900 23 23 89', sub: 'Miễn cước CSKH' });
    expect(o.qr?.label).toBe('ƯU ĐÃI ĐẶC QUYỀN');
    expect(o.qr?.title).toBe('VOUCHER 500K');
    expect(o.qr?.hint).toBe('Quét bằng Camera điện thoại');
  });

  it('la creative fullscreen hien o man khoa, 16:9 FHD, an toan cho man hinh co tre em do nguoi duyet', () => {
    expect(isLockEligible(o)).toBe(true);
    expect(o.background).toMatchObject({ px_w: 1920, px_h: 1080 });
    expect(FORMAT_SUPPORT.fullscreen.contexts).toEqual(expect.arrayContaining(o.contexts));
  });

  it('nam trong manifest creative hop le (them truong overlay, khong doi truong cu)', () => {
    const creative = {
      id: '01M7799CBSK3S99KH0R0ZMB62T',
      campaign_id: '01M7799CBSK3S99KH0R0ZMB62R',
      url: 'https://media.anio.vn/ads/vf9-night-1920x1080.jpg',
      sha256: o.background!.sha256,
      duration_s: 15,
      px_w: 1920,
      px_h: 1080,
      format: 'fullscreen',
      media_type: 'image',
      size_bytes: 412345,
      overlay: vf9,
    };
    expect(manifestCreativeWithOverlay.safeParse(creative).success).toBe(true);
    expect(manifestCreativeWithOverlay.safeParse({ ...creative, overlay: undefined }).success).toBe(true);
  });
});

describe('gia tri mac dinh', () => {
  it('safe_area 5%, 15 giay, khong kid_safe, chi fullscreen', () => {
    const o = overlaySchema.parse({ v: 1, sponsor_tag: 'TÀI TRỢ', brand_label: 'ACME', headline: 'Khuyến mãi' });
    expect(o.safe_area).toEqual({ top: 5, right: 5, bottom: 5, left: 5 });
    expect(o.duration_s).toBe(15);
    expect(o.kid_safe).toBe(false);
    expect(o.contexts).toEqual(['fullscreen']);
    expect(o.badges).toEqual([]);
    expect(isLockEligible(o)).toBe(false);
  });

  it('chua duoc duyet kid_safe thi khong dat dieu kien hien tren man khoa du contexts co lock', () => {
    const o = overlaySchema.parse({ ...vf9, kid_safe: false });
    expect(o.contexts).toContain('lock');
    expect(isLockEligible(o)).toBe(false);
  });
});

describe('tu choi du lieu sai', () => {
  const bad: [string, Record<string, unknown>][] = [
    ['v khac 1', { v: 2 }],
    ['headline rong', { headline: '' }],
    ['headline qua 140 ky tu', { headline: 'x'.repeat(141) }],
    ['ky tu dieu khien', { headline: 'a\u0000b' }],
    ['qr http (khong phai https)', { qr: { url: 'http://q.ams.example/vf9', title: 'VOUCHER 500K' } }],
    ['qr url co khoang trang', { qr: { url: 'https://q.ams.example/a b', title: 'T' } }],
    ['qr url > 512 ky tu', { qr: { url: 'https://q.ams.example/' + 'a'.repeat(500), title: 'T' } }],
    ['hotline co chu', { hotline: { label: 'HOTLINE', number: '1900-ABCD' } }],
    ['duration_s < 5', { duration_s: 4 }],
    ['duration_s > 60', { duration_s: 61 }],
    ['safe_area > 15%', { safe_area: { top: 16, right: 5, bottom: 5, left: 5 } }],
    ['context la', { contexts: ['tv'] }],
    ['contexts rong', { contexts: [] }],
    ['scte_id chu thuong/khoang trang', { scte_id: 'vf9 800v' }],
    ['qua 6 badge', { badges: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }],
    ['sha256 sai', { background: { ...vf9.background!, sha256: 'zz' } }],
    ['nen khong 16:9', { background: { ...vf9.background!, px_h: 1000 } }],
    ['nen nho hon HD', { background: { ...vf9.background!, px_w: 960, px_h: 540 } }],
    ['truong thua (go nham)', { sponsor_tags: 'x' }],
  ];
  for (const [name, patch] of bad) {
    it(name, () => {
      expect(overlaySchema.safeParse({ ...vf9, ...patch }).success).toBe(false);
    });
  }
});

describe('kich thuoc anh nen HD -> 8K', () => {
  it('chap nhan bon bac 16:9 chuan', () => {
    for (const t of BG_TIERS) expect(backgroundSizeProblem(t.w, t.h)).toBeNull();
  });
  it('tu choi sai ti le, qua nho, qua lon', () => {
    expect(backgroundSizeProblem(1920, 1200)).toMatch(/16:9/);
    expect(backgroundSizeProblem(1024, 576)).toMatch(/toi thieu/);
    expect(backgroundSizeProblem(8192, 4608)).toMatch(/toi da/);
  });
});

describe('6 dinh dang cua dac ta', () => {
  it('co du 6 dinh dang va chi fullscreen/pause_ad/qr_corner co noi hien thi trong v1', () => {
    expect(Object.keys(FORMAT_SUPPORT).sort()).toEqual(['fullscreen', 'l_banner', 'menu_banner', 'pause_ad', 'qr_corner', 'reward']);
    const supported = Object.entries(FORMAT_SUPPORT).filter(([, v]) => v.contexts.length > 0).map(([k]) => k).sort();
    expect(supported).toEqual(['fullscreen', 'pause_ad', 'qr_corner']);
  });
});

// Hop dong voi may chu: packages/shared/src/overlay.ts (parseOverlay) la nguon su that cua cot creatives.overlay (JSON TEXT).
// Gateway chi phat 7 truong (sponsor_tag, brand_label, headline, hotline, qr, scte_id, badges), khong co "v", khong co kid_safe/contexts.
describe('tuong thich voi parseOverlay cua may chu', () => {
  const serverShape = {
    sponsor_tag: 'TÀI TRỢ • QUẢNG CÁO 4K',
    brand_label: 'VINFAST AUTO',
    headline: 'VinFast VF 9 - Đỉnh Cao Trải Nghiệm Doanh Nhân',
    hotline: { number: '1900 23 23 89' },
    qr: { url: 'https://q.ams.example/vf9' },
    scte_id: 'vf9_800v.vn',
    badges: ['a', 'b', 'c', 'd', 'e', 'f'],
  };
  const bg = { url: 'https://media.anio.vn/a.jpg', sha256: 'a'.repeat(64), px_w: 1920, px_h: 1080 };
  it('chap nhan overlay toi thieu cua may chu (+ nen lay tu creative)', () => {
    const r = overlaySchema.safeParse({ ...serverShape, background: bg });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.kid_safe).toBe(false); // may chu chua cap kid_safe => khong bao gio len man khoa
      expect(r.data.contexts).toEqual(['fullscreen']);
    }
  });
});
