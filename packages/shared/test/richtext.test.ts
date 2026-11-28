import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseRich, plainToRich, richHtmlToPlain, sanitizeRich, serializeRich, singleLine, normColor, richToPlain } from '../src/richtext.js';
import * as web from '../../../apps/web-admin/src/lib/richtext.js';

describe('richtext sanitizer', () => {
  it('giữ định dạng cho phép và chuẩn hoá', () => {
    const h = '<div style="text-align:center"><b>Đậm</b> <span style="color: rgb(255, 0, 0); font-size: 32px; font-family: &quot;Arial&quot;, sans-serif">đỏ</span><br><i><u>nghiêng</u></i></div>';
    expect(sanitizeRich(h)).toBe('<p style="text-align:center"><b>Đậm</b> <span style="color:#FF0000;font-size:32px;font-family:Arial">đỏ</span><i><u><br>nghiêng</u></i></p>');
  });
  it('loại script, sự kiện, thuộc tính và kiểu nguy hiểm', () => {
    const bad = '<p onclick="x()" class="a" style="position:fixed;color:url(javascript:1);background-color:#abc;font-family:Comic Sans">a<script>alert(1)</script><img src=x onerror=alert(1)><iframe src="//e"></iframe><a href="javascript:1">link</a><span style="font-size:999px;letter-spacing:5px">b</span></p>';
    const out = sanitizeRich(bad);
    expect(out).toBe('<p><span style="background-color:#AABBCC">alink</span><span style="background-color:#AABBCC;font-size:200px;letter-spacing:5px">b</span></p>');
    expect(out).not.toMatch(/script|onerror|onclick|javascript|iframe|position|class/);
  });
  it('thoát ký tự HTML và không tái tạo thẻ từ văn bản', () => {
    expect(sanitizeRich('<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; 1 &lt; 2</p>')).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; 1 &lt; 2</p>');
    expect(richHtmlToPlain('<p>&lt;b&gt; &amp;</p>')).toBe('<b> &');
  });
  it('cân bằng thẻ lệch và đóng đủ', () => {
    expect(sanitizeRich('<p><b>a<i>b</p>c</i></b>')).toBe('<p><b>a</b><b><i>b</i></b></p><p>c</p>');
  });
  it('xuống dòng: đoạn, br, dòng trống và br cuối chỉ là chỗ giữ', () => {
    const d = parseRich('<div>một</div><div><br></div><div>hai<br>ba<br></div>');
    expect(richToPlain(d)).toBe('một\n\nhai\nba');
    expect(serializeRich(d)).toBe('<p>một</p><p><br></p><p>hai<br>ba</p>');
    expect(richToPlain(parseRich('<p>a<br><br></p>'))).toBe('a\n');
    expect(serializeRich(parseRich('<p>a<br><br></p>'))).toBe('<p>a<br><br></p>');
  });
  it('trọng số: 700 thành <b>, 300/500/900 thành span, 400 bỏ', () => {
    expect(sanitizeRich('<span style="font-weight:300">a</span><span style="font-weight:900">b</span><b><span style="font-weight:normal">c</span></b>')).toBe('<p><span style="font-weight:300">a</span><span style="font-weight:900">b</span>c</p>');
  });
  it('plain <-> rich và chữ chạy một dòng', () => {
    expect(plainToRich('a & b\n\nc')).toBe('<p>a &amp; b</p><p><br></p><p>c</p>');
    expect(sanitizeRich('<p><b>x</b></p><p>y</p>', { singleLine: true })).toBe('<p><b>x</b> y</p>');
    expect(singleLine([])).toEqual([]);
    expect(sanitizeRich('<p><br></p><script>1</script>')).toBe('');
  });
  it('màu', () => {
    expect(normColor('#f00')).toBe('#FF0000');
    expect(normColor('rgba(0, 0, 0, 0)')).toBeUndefined();
    expect(normColor('red')).toBeUndefined();
  });
  it('chặn đầu vào cực lớn', () => {
    const out = sanitizeRich('<p>' + 'x'.repeat(50_000) + '</p>');
    expect(richHtmlToPlain(out).length).toBe(5000);
  });
  it('bản sao trong web-admin hành xử y hệt', () => {
    const a = readFileSync(new URL('../src/richtext.ts', import.meta.url), 'utf8');
    const b = readFileSync(new URL('../../../apps/web-admin/src/lib/richtext.ts', import.meta.url), 'utf8');
    expect(b).toBe(a);
    expect(web.sanitizeRich('<b>x</b>')).toBe('<p><b>x</b></p>');
  });
});

import { itemDurationS } from '../src/zone-duration.js';
describe('itemDurationS', () => {
  it('anh mac dinh 8 s, video thieu = phat het, kep 1..3600', () => {
    expect(itemDurationS(undefined, 'a', 'image')).toBe(8);
    expect(itemDurationS({}, 'a', 'video')).toBeNull();
    expect(itemDurationS({ a: 12 }, 'a', 'image')).toBe(12);
    expect(itemDurationS({ a: 30 }, 'a', 'video')).toBe(30);
    expect(itemDurationS({ a: 99999 }, 'a', 'image')).toBe(3600);
    expect(itemDurationS({ a: 'x' }, 'a', 'image')).toBe(8);
  });
});
