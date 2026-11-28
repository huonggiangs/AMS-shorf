import { describe, expect, it } from 'vitest';
import { absBox, flattenZones, zoneTreeIssue, type GroupableZone } from '../src/index.js';

const z = (id: string, type: string, x: number, y: number, w: number, h: number, extra: Partial<GroupableZone> = {}): GroupableZone => ({ id, type, x, y, w, h, ...extra });

describe('flattenZones', () => {
  it('bo cuc phang (khong nhom) giu nguyen ven (cung doi tuong)', () => {
    const a = [z('a', 'video', 0, 0, 100, 80, { z: 0 }), z('b', 'marquee', 0, 80, 100, 20, { z: 1 })];
    expect(flattenZones(a)).toBe(a);
  });

  it('doi vung con sang toa do tuyet doi, bo nhom + parent_id, them group_id, giu thu tu/lop', () => {
    const zones = [
      z('bar', 'marquee', 0, 90, 100, 10),
      z('g', 'group', 10, 10, 50, 50),
      z('v', 'video', 0, 0, 100, 49, { parent_id: 'g' }),
      z('t', 'text', 0, 47, 100, 12, { parent_id: 'g' }),
      z('i', 'image', 20, 57, 60, 43, { parent_id: 'g' }),
    ];
    const f = flattenZones(zones);
    expect(f.map((x) => x.id)).toEqual(['bar', 'v', 't', 'i']); // khong co nhom
    expect(f.every((x) => !('parent_id' in x))).toBe(true);
    expect(f[0]).toMatchObject({ id: 'bar', x: 0, y: 90, w: 100, h: 10, z: 0 });
    expect(f[0]).not.toHaveProperty('group_id');
    expect(f[1]).toMatchObject({ id: 'v', group_id: 'g', x: 10, y: 10, w: 50, h: 24.5, z: 1 });
    expect(f[2]).toMatchObject({ id: 't', group_id: 'g', x: 10, y: 33.5, w: 50, h: 6, z: 2 });
    expect(f[3]).toMatchObject({ id: 'i', group_id: 'g', x: 20, y: 38.5, w: 30, h: 21.5, z: 3 });
  });

  it('vung con xuat ngay tai vi tri nhom (nhom truoc vung khac): thu tu nhom roi con', () => {
    const f = flattenZones([z('g', 'group', 0, 0, 100, 50), z('c1', 'text', 0, 0, 50, 50, { parent_id: 'g' }), z('main', 'video', 0, 50, 100, 50), z('c2', 'image', 50, 0, 50, 100, { parent_id: 'g' })]);
    expect(f.map((x) => x.id)).toEqual(['c1', 'c2', 'main']);
    expect(f[1]).toMatchObject({ x: 50, y: 0, w: 50, h: 50 });
  });

  it('kep trong 0..100 khi toa do tuong doi vuot', () => {
    const f = flattenZones([z('g', 'group', 80, 80, 40, 40), z('c', 'video', 50, 50, 100, 100, { parent_id: 'g' })]);
    expect(f[0]!.x + f[0]!.w).toBeLessThanOrEqual(100);
    expect(f[0]!.y + f[0]!.h).toBeLessThanOrEqual(100);
    expect(absBox(z('g', 'group', 0, 0, 100, 100), z('c', 'text', 0, 0, 100, 100))).toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });

  it('nhom rong khong xuat gi; vung mo coi (cha khong co) coi nhu vung ngoai; z toi da 20', () => {
    expect(flattenZones([z('g', 'group', 0, 0, 50, 50), z('m', 'video', 0, 0, 100, 100)]).map((x) => x.id)).toEqual(['m']);
    const o = flattenZones([z('o', 'text', 5, 5, 10, 10, { parent_id: 'zzz' }), z('g', 'group', 0, 0, 100, 100)]);
    expect(o.map((x) => x.id)).toEqual(['o']);
    expect(o[0]).toMatchObject({ x: 5, y: 5 });
    const many = [z('g', 'group', 0, 0, 100, 100), ...Array.from({ length: 30 }, (_, i) => z(`c${i}`, 'text', 0, 0, 10, 10, { parent_id: 'g' }))];
    expect(Math.max(...flattenZones(many).map((x) => x.z ?? 0))).toBe(20);
  });
});

describe('zoneTreeIssue', () => {
  const g = z('g', 'group', 0, 0, 50, 50);
  it('hop le: nhom + con; bo cuc phang', () => {
    expect(zoneTreeIssue([g, z('c', 'video', 0, 0, 100, 100, { parent_id: 'g' })])).toBeNull();
    expect(zoneTreeIssue([z('a', 'video', 0, 0, 10, 10)])).toBeNull();
  });
  it('tu choi: cha khong ton tai, cha khong phai nhom, nhom long nhau, tu tro, qua 50 con, qua 100 vung, qua 8 vung ngoai', () => {
    expect(zoneTreeIssue([z('c', 'video', 0, 0, 1, 1, { parent_id: 'x' })])?.message).toMatch(/không tồn tại/);
    expect(zoneTreeIssue([z('a', 'video', 0, 0, 1, 1), z('c', 'video', 0, 0, 1, 1, { parent_id: 'a' })])?.message).toMatch(/không phải là nhóm/);
    expect(zoneTreeIssue([g, z('g2', 'group', 0, 0, 1, 1, { parent_id: 'g' })])?.message).toMatch(/một cấp/);
    expect(zoneTreeIssue([z('c', 'video', 0, 0, 1, 1, { parent_id: 'c' })])?.message).toMatch(/chính nó/);
    const kids = (n: number) => Array.from({ length: n }, (_, i) => z(`c${i}`, 'text', 0, 0, 1, 1, { parent_id: 'g' }));
    expect(zoneTreeIssue([g, ...kids(50)])).toBeNull();
    expect(zoneTreeIssue([g, ...kids(51)])?.message).toMatch(/tối đa 50/);
    expect(zoneTreeIssue([g, z('g2', 'group', 0, 0, 1, 1), ...Array.from({ length: 99 }, (_, i) => z(`d${i}`, 'text', 0, 0, 1, 1, { parent_id: i < 50 ? 'g' : 'g2' }))])?.message).toMatch(/Tối đa 100/);
    expect(zoneTreeIssue(Array.from({ length: 9 }, (_, i) => z(`t${i}`, 'text', 0, 0, 1, 1)))?.message).toMatch(/Tối đa 8/);
  });
});
