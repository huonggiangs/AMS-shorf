import { describe, expect, it } from 'vitest';
import {
  BLANK, CONTRACT_VARIABLES, contractContentHash, contractPlainText, extractPlaceholders, fillPlaceholders, renderArticles, validateArticles, viDateWords,
} from '../src/index.js';
import type { ContractArticle, PriceTable } from '../src/index.js';

const price: PriceTable = { lines: [{ screen_type: 'Smart TV', region: 'Q1', daypart: 'Cao điểm', frequency: '10', duration_s: '15', qty: 2, impression_price_vnd: '120.5' }], value_vnd: 1000, vat_rate: 10, vat_vnd: 100, total_vnd: 1100 };
const arts: ContractArticle[] = [
  { key: 'open', numbered: false, title: 'Các bên', body: 'Bên A: **{{seller.name}}**\n\n- MST {{seller.tax_code}}' },
  { key: 'price', title: 'Giá {{contract.no}}', body: 'Chi tiết:\n\n{{price_table}}\n\nTổng {{contract.total_vnd}}. `[luật sư điền]`' },
];

describe('contract-doc: bien', () => {
  it('extractPlaceholders bo trung va bo price_table', () => {
    expect(extractPlaceholders('{{a.b}} {{ a.b }} {{price_table}} {{c_d}} {{BAD}}')).toEqual(['a.b', 'c_d']);
  });
  it('fillPlaceholders thay bien, bien thieu/trong thanh cho trong va duoc bao', () => {
    const miss = new Set<string>();
    expect(fillPlaceholders('x {{a}} y {{b}} z {{c}}', { a: 'A', b: '  ' }, miss)).toBe(`x A y ${BLANK} z ${BLANK}`);
    expect([...miss].sort()).toEqual(['b', 'c']);
  });
  it('gia tri bien chua dau {{ }} khong bi thay lan thu hai (khong de quy)', () => {
    const miss = new Set<string>();
    expect(fillPlaceholders('{{a}}', { a: '{{b}}', b: 'X' }, miss)).toBe('{{b}}');
  });
  it('danh muc bien khong trung khoa', () => {
    const keys = CONTRACT_VARIABLES.map((v) => v.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('contract-doc: render', () => {
  it('danh so dieu, tach khoi, bo dau ` quanh cho trong, chen bang gia', () => {
    const r = renderArticles(arts, {}, { 'seller.name': 'Công ty ANIO', 'seller.tax_code': '0123', 'contract.no': 'HD-1', 'contract.total_vnd': '1.100' });
    expect(r.missing).toEqual([]);
    expect(r.articles[0]!.no).toBeNull();
    expect(r.articles[1]!.no).toBe(1);
    expect(r.articles[1]!.title).toBe('Giá HD-1');
    expect(r.articles[0]!.blocks).toEqual([{ type: 'p', text: 'Bên A: **Công ty ANIO**' }, { type: 'bullet', text: 'MST 0123' }]);
    expect(r.articles[1]!.blocks.map((b) => b.type)).toEqual(['p', 'price_table', 'p']);
    expect(JSON.stringify(r.articles)).toContain('[luật sư điền]');
    expect(JSON.stringify(r.articles)).not.toContain('`');
  });
  it('ghi de dieu khoan va bao bien thieu', () => {
    const r = renderArticles(arts, { price: { body: 'Nội dung mới {{customer.address}}' } }, { 'contract.no': 'HD-1' });
    expect(r.missing).toEqual(['seller.name', 'seller.tax_code', 'customer.address']);
    expect(r.articles[1]!.blocks).toEqual([{ type: 'p', text: `Nội dung mới ${BLANK}` }]);
  });
  it('van ban thuan co bang gia va giu dau tieng Viet', () => {
    const r = renderArticles(arts, {}, { 'seller.name': 'Đặng Thị Ánh', 'seller.tax_code': '1', 'contract.no': 'N', 'contract.total_vnd': '1.100' });
    const t = contractPlainText(r.articles, price);
    expect(t).toContain('Điều 1. Giá N');
    expect(t).toContain('Đặng Thị Ánh');
    expect(t).toContain('1 | Smart TV | Q1 | Cao điểm | 10 | 15 | 2 | 120.5');
    expect(t).not.toContain('**');
  });
});

describe('contract-doc: dau van tay', () => {
  const meta = { contractNo: 'HD-1', docVersion: 1, templateCode: 'ads', templateVersion: 1 };
  it('on dinh va doi khi doi bat ky thanh phan nao', async () => {
    const h = await contractContentHash(meta, 'abc', price);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await contractContentHash(meta, 'abc', price)).toBe(h);
    expect(await contractContentHash(meta, 'abd', price)).not.toBe(h);
    expect(await contractContentHash({ ...meta, docVersion: 2 }, 'abc', price)).not.toBe(h);
    expect(await contractContentHash({ ...meta, templateVersion: 2 }, 'abc', price)).not.toBe(h);
    expect(await contractContentHash(meta, 'abc', { ...price, value_vnd: 1001 })).not.toBe(h);
    expect(await contractContentHash(meta, 'abc', { ...price, lines: [{ ...price.lines[0]!, impression_price_vnd: '120.6' }] })).not.toBe(h);
  });
});

describe('contract-doc: kiem tra mau', () => {
  it('bat bien la, khoa trung, noi dung rong', () => {
    const issues = validateArticles([{ key: 'a', title: 'A', body: '{{khong.co}}' }, { key: 'a', title: 'B', body: ' ' }, { key: 'Bad', title: 'C', body: 'x' }]);
    expect(issues.map((i) => i.code).sort()).toEqual(['bad_key', 'duplicate_key', 'empty_body', 'unknown_variable']);
  });
  it('viDateWords', () => {
    expect(viDateWords('2026-11-12')).toBe('ngày 12 tháng 11 năm 2026');
    expect(viDateWords('x')).toBe('');
  });
});
