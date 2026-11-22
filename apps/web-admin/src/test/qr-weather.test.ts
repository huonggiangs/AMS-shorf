import { describe, expect, it } from 'vitest';
import { qrImageSrc, qrSvgDataUrl, vietqrUrl } from '../lib/qr';
import { resolveCoords, weatherInfo, weatherUrl } from '../lib/weather';

describe('QR', () => {
  it('VietQR tao URL anh dung dinh dang', () => {
    expect(vietqrUrl({ bin: '970436', account: '0123456789', name: 'ANIO', amount: 50000, memo: 'Thanh toan', template: 'qr_only' }))
      .toBe('https://img.vietqr.io/image/970436-0123456789-qr_only.png?amount=50000&addInfo=Thanh+toan&accountName=ANIO');
  });
  it('QR URL duoc tao thanh SVG ngay tren trinh duyet; anh tai len dung nguyen', () => {
    expect(qrSvgDataUrl('https://anio.vn')).toMatch(/^data:image\/svg\+xml/);
    expect(qrImageSrc({ mode: 'url', value: 'https://anio.vn' })).toMatch(/^data:image\/svg\+xml/);
    expect(qrImageSrc({ mode: 'image', value: 'data:image/png;base64,AAAA' })).toBe('data:image/png;base64,AAAA');
  });
});

describe('Thoi tiet', () => {
  it('URL Open-Meteo va toa do co dinh / GPS', () => {
    expect(weatherUrl(21.03, 105.85)).toContain('api.open-meteo.com/v1/forecast');
    expect(resolveCoords({ mode: 'fixed', lat: 10.8, lon: 106.6, label: 'HCM' }, null)).toMatchObject({ lat: 10.8, lon: 106.6 });
    expect(resolveCoords({ mode: 'gps' }, { lat: 16, lon: 108 })).toMatchObject({ lat: 16, lon: 108 });
    expect(weatherInfo(0).text).toBeTruthy();
  });
});
