// Chuyen ma trinh duyet: danh gia tep nguon, chon thong so theo loai man, quyet dinh can/khong can chuyen, tien do chung, thoi gian con lai (phan thuan, khong WebCodecs).
import { describe, expect, it } from 'vitest';
import {
  ELEVATOR_TIERS, MB, RULES, assessSource, estimateSeconds, etaSeconds, fmtDuration, inferTarget, overallPercent, pickSettings, pickTier, reasonText, type SourceInfo,
} from '../lib/transcode-plan';

const src = (o: Partial<SourceInfo> = {}): SourceInfo => ({ width: 1080, height: 1920, durationSec: 20, codec: 'avc', container: 'mp4', fps: 30, bitrateBps: 6_000_000, sizeBytes: 15 * MB, hasAudio: true, ...o });

describe('inferTarget', () => {
  it('doc -> thang may; ngang -> TV', () => {
    expect(inferTarget(1080, 1920)).toBe('elevator');
    expect(inferTarget(3840, 2160)).toBe('tv');
    expect(inferTarget(1000, 1000)).toBe('tv');
  });
});

describe('assessSource: quyet dinh can / khong can chuyen', () => {
  it('H.264 MP4 9:16 1080x1920 20 giay: dat chuan, khong de nghi chuyen', () => {
    const a = assessSource(src(), 'elevator');
    expect(a).toMatchObject({ required: [], recommended: [], blockers: [], trimTo: null, needsConvert: false, offerConvert: false });
  });
  it('AV1 (thang may): BAT BUOC chuyen; kem codec lam ly do', () => {
    const a = assessSource(src({ codec: 'av1', width: 2160, height: 3840 }), 'elevator');
    expect(a.needsConvert).toBe(true);
    expect(a.required).toContain('codec_unsupported');
  });
  it('VP9 thang may: duoc phep nhung NEN chuyen (khong bat buoc); H.265 thang may: dat; H.265/VP9 cho TV: bat buoc', () => {
    expect(assessSource(src({ codec: 'vp9' }), 'elevator')).toMatchObject({ needsConvert: false, offerConvert: true, recommended: expect.arrayContaining(['codec_not_ideal']) });
    expect(assessSource(src({ codec: 'hevc' }), 'elevator')).toMatchObject({ needsConvert: false, offerConvert: false });
    expect(assessSource(src({ codec: 'hevc', width: 1920, height: 1080 }), 'tv').required).toContain('codec_tv');
    expect(assessSource(src({ codec: 'vp9', width: 1920, height: 1080 }), 'tv').needsConvert).toBe(true);
  });
  it('WebM / MOV: nen chuyen sang MP4; MP4 thi khong', () => {
    expect(assessSource(src({ container: 'webm', codec: 'avc' }), 'elevator').recommended).toContain('container');
    expect(assessSource(src({ container: 'mov', codec: 'avc' }), 'elevator').offerConvert).toBe(true);
  });
  it('video ngang dua vao man 9:16: bat buoc (sai ti le); video doc dua vao TV: cung vay', () => {
    expect(assessSource(src({ width: 1920, height: 1080 }), 'elevator').required).toContain('wrong_ratio');
    expect(assessSource(src({ width: 1080, height: 1920 }), 'tv').required).toContain('wrong_ratio');
  });
  it('qua 200 MB (thang may) / 100 MB (TV), qua 4K / qua Full HD TV, nho hon HD thang may: bat buoc', () => {
    expect(assessSource(src({ sizeBytes: 202 * MB }), 'elevator').required).toContain('too_big');
    expect(assessSource(src({ sizeBytes: 150 * MB, width: 1920, height: 1080 }), 'tv').required).toContain('too_big');
    expect(assessSource(src({ width: 2400, height: 4267 }), 'elevator').required).toContain('res_high');
    expect(assessSource(src({ width: 3840, height: 2160 }), 'tv').required).toContain('res_high');
    expect(assessSource(src({ width: 540, height: 960 }), 'elevator').required).toContain('res_low');
  });
  it('bitrate > 16 Mbps (thang may): nen chuyen', () => {
    expect(assessSource(src({ bitrateBps: 20_000_000 }), 'elevator').recommended).toContain('bitrate_high');
  });
  it('thoi luong: qua dai -> can cat (trimTo = tran); qua ngan -> khong sua duoc; trong khoang -> khong gi', () => {
    expect(assessSource(src({ durationSec: 232.5 }), 'elevator').trimTo).toBe(30);
    expect(assessSource(src({ durationSec: 232.5, width: 1920, height: 1080 }), 'tv').trimTo).toBe(60);
    expect(assessSource(src({ durationSec: 4 }), 'elevator').blockers).toContain('too_short');
    expect(assessSource(src({ durationSec: 30.3 }), 'elevator').trimTo).toBeNull();
  });
  it('tep that: Silhouette of Vietnam 4K WebM AV1 202 MB 232 giay (16:9) -> TV: bat buoc chuyen + cat 60 giay; thang may: bat buoc (AV1 + ngang + 202 MB), cat 30 giay', () => {
    const real = src({ width: 3840, height: 2160, durationSec: 232.5, codec: 'av1', container: 'webm', sizeBytes: 202 * MB, bitrateBps: 7_000_000 });
    const tv = assessSource(real, 'tv');
    expect(tv.required).toEqual(expect.arrayContaining(['codec_unsupported', 'too_big', 'res_high']));
    expect(tv.trimTo).toBe(60);
    const el = assessSource(real, 'elevator');
    expect(el.required).toEqual(expect.arrayContaining(['codec_unsupported', 'wrong_ratio']));
    expect(el.trimTo).toBe(30);
  });
});

describe('pickSettings: thong so theo loai man', () => {
  it('thang may 9:16 4K: ha ve 1080x1920 (mac dinh), 7 Mbps, <= 30 fps, H.264, khung chinh moi 2 giay, vua khung', () => {
    const r = pickSettings(src({ width: 2160, height: 3840, fps: 60 }), 'elevator');
    expect(r.settings).toMatchObject({ width: 1080, height: 1920, fit: 'contain', videoBps: 7_000_000, fps: 30, keyFrameSec: 2, audioBps: 128_000, trimEndSec: null });
    expect(r.tooBig).toBe(false);
    expect(r.estimatedBytes).toBeLessThan(RULES.elevator.maxBytes);
  });
  it('tran cau hinh: 4K tuy chon; 720 nhe nhat; khong phong to qua tep goc', () => {
    expect(pickSettings(src({ width: 2160, height: 3840 }), 'elevator', { ceiling: 2160 }).settings).toMatchObject({ width: 2160, height: 3840, videoBps: 15_000_000 });
    expect(pickSettings(src({ width: 2160, height: 3840 }), 'elevator', { ceiling: 720 }).settings).toMatchObject({ width: 720, height: 1280, videoBps: 4_500_000 });
    expect(pickSettings(src({ width: 720, height: 1280 }), 'elevator', { ceiling: 2160 }).settings).toMatchObject({ width: 720, height: 1280 });
    expect(pickSettings(src({ width: 540, height: 960 }), 'elevator').settings).toMatchObject({ width: 720, height: 1280 }); // nho hon bac thap nhat: len HD
  });
  it('video ngang vao man 9:16: khung doc 1080x1920 (vua khung, khong cat); 4K ngang -> TV 1920x1080 6 Mbps', () => {
    expect(pickSettings(src({ width: 3840, height: 2160 }), 'elevator').settings).toMatchObject({ width: 1080, height: 1920, fit: 'contain' });
    expect(pickSettings(src({ width: 3840, height: 2160 }), 'tv').settings).toMatchObject({ width: 1920, height: 1080, videoBps: 6_000_000, fit: 'contain' });
    expect(pickSettings(src({ width: 1280, height: 720 }), 'tv').settings).toMatchObject({ width: 1280, height: 720 });
  });
  it('fps goc thap giu nguyen (24), khong co fps -> 30; mac dinh khong cat', () => {
    expect(pickSettings(src({ fps: 24 }), 'elevator').settings.fps).toBe(24);
    expect(pickSettings(src({ fps: null }), 'elevator').settings.fps).toBe(30);
  });
  it('cat ngan khi nguoi dung dong y: 232 giay -> 30 giay; khong dong y thi giu nguyen', () => {
    const long = src({ durationSec: 232.5 });
    expect(pickSettings(long, 'elevator', { trim: true }).settings).toMatchObject({ trimEndSec: 30, outDurationSec: 30 });
    expect(pickSettings(long, 'elevator', { trim: false }).settings.trimEndSec).toBeNull();
  });
  it('dung luong: bitrate duoc ha de ket qua <= tran 200/100 MB (de lai 8%); khong ha duoc thi tooBig', () => {
    const r = pickSettings(src({ durationSec: 232.5, width: 3840, height: 2160 }), 'tv'); // TV 100 MB cho 232 giay -> ~3 Mbps
    expect(r.settings.videoBps).toBeLessThan(6_000_000);
    expect(r.estimatedBytes).toBeLessThanOrEqual(RULES.tv.maxBytes * 0.93);
    const huge = pickSettings(src({ durationSec: 3000 }), 'elevator');
    expect(huge.tooBig).toBe(true);
  });
  it('pickTier chon dung bac', () => {
    expect(pickTier({ width: 1440, height: 2560 }, 'elevator', 1440)).toBe(ELEVATOR_TIERS[2]);
    expect(pickTier({ width: 1440, height: 2560 }, 'elevator')).toBe(ELEVATOR_TIERS[1]);
  });
});

describe('tien do va thoi gian', () => {
  it('mot thanh chung: co chuyen ma 0-60% chuyen, 60-97% tai len, 97-100% xac nhan; khong chuyen ma: tai len 0-97%', () => {
    expect(overallPercent('convert', 0, true)).toBe(0);
    expect(overallPercent('convert', 0.5, true)).toBe(30);
    expect(overallPercent('convert', 1, true)).toBe(60);
    expect(overallPercent('upload', 0, true)).toBe(60);
    expect(overallPercent('upload', 1, true)).toBe(97);
    expect(overallPercent('finish', 1, true)).toBe(100);
    expect(overallPercent('upload', 0.5, false)).toBe(49);
    expect(overallPercent('upload', 2, false)).toBe(97); // bi chan o 1
    const seq = [overallPercent('convert', 0.3, true), overallPercent('convert', 0.9, true), overallPercent('upload', 0.1, true), overallPercent('upload', 0.9, true), overallPercent('finish', 0.5, true)];
    expect([...seq].sort((x, y) => x - y)).toEqual(seq); // khong lui
  });
  it('etaSeconds: can du tien do + thoi gian; uoc luong ban dau va dinh dang', () => {
    expect(etaSeconds(0.01, 10)).toBeNull();
    expect(etaSeconds(0.5, 60)).toBe(60);
    expect(etaSeconds(0.25, 30)).toBe(90);
    expect(estimateSeconds(30, 1080, 1920)).toBe(18);
    expect(fmtDuration(45)).toBe('45 giây');
    expect(fmtDuration(125)).toBe('2 phút 5 giây');
    expect(fmtDuration(180)).toBe('3 phút');
  });
  it('reasonText: ngon ngu don gian, an codec tru khi chi tiet', () => {
    const s = src({ codec: 'av1' });
    expect(reasonText('codec_unsupported', s, 'elevator')).not.toMatch(/AV1/);
    expect(reasonText('codec_unsupported', s, 'elevator', true)).toMatch(/AV1/);
    expect(reasonText('wrong_ratio', s, 'elevator')).toMatch(/không cắt, không méo/);
    expect(reasonText('too_big', src({ sizeBytes: 202 * MB }), 'elevator')).toMatch(/202 MB.*200 MB/);
  });
});
