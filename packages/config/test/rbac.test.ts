import { describe, expect, it } from 'vitest';
import { ACTIONS, MODULES, ROLES, can, defaultAllows, effectivePermissions, validateOverride } from '../src/index.js';
import { ACTIONS as SA, MODULES as SM, ROLES as SR } from '../../shared/src/types.js';

describe('rbac', () => {
  it('khop hang so voi @ams/shared', () => {
    expect([...ROLES]).toEqual([...SR]);
    expect([...MODULES]).toEqual([...SM]);
    expect([...ACTIONS]).toEqual([...SA]);
  });
  it('6 vai tro x 12 mo-dun x 4 hanh dong', () => {
    expect(ROLES.length).toBe(6);
    expect(MODULES.length).toBe(12);
    expect(ACTIONS.length).toBe(4);
    for (const r of ROLES) for (const m of MODULES) for (const a of ACTIONS) expect(typeof can([], r, m, a)).toBe('boolean');
  });
  it('super_admin co tat ca 48 quyen', () => {
    let n = 0;
    for (const m of MODULES) for (const a of ACTIONS) if (can([], 'super_admin', m, a)) n++;
    expect(n).toBe(48);
  });
  it('vai tro noi bo theo dac ta 1.1', () => {
    expect(can([], 'content_manager', 'media', 'approve')).toBe(true);
    expect(can([], 'content_manager', 'campaigns', 'approve')).toBe(false); // khong duyet ngan sach
    expect(can([], 'content_manager', 'finance', 'view')).toBe(false);
    expect(can([], 'finance', 'finance', 'approve')).toBe(true);
    expect(can([], 'finance', 'devices', 'view')).toBe(false);
    expect(can([], 'device_ops', 'devices', 'write')).toBe(true);
    expect(can([], 'device_ops', 'finance', 'view')).toBe(false);
    expect(can([], 'device_ops', 'admin', 'view')).toBe(false);
  });
  it('tai khoan ngoai: chi 3 mo-dun, khong approve/delete', () => {
    expect(can([], 'customer', 'campaigns', 'write')).toBe(true);
    expect(can([], 'customer', 'finance', 'view')).toBe(true);
    expect(can([], 'customer', 'approvals', 'view')).toBe(false);
    expect(can([], 'customer', 'partners', 'view')).toBe(false);
    expect(can([], 'partner', 'finance', 'view')).toBe(false);
    expect(can([], 'partner', 'campaigns', 'write')).toBe(false);
    for (const r of ['customer', 'partner']) for (const m of MODULES) for (const a of ['approve', 'delete']) expect(can([], r, m, a)).toBe(false);
  });
  it('ghi de: cap them / thu hoi, nhung ngoai khong the vuot rang buoc cung', () => {
    expect(can([{ module: 'devices', action: 'delete', allowed: 1 }], 'device_ops', 'devices', 'delete')).toBe(true);
    expect(can([{ module: 'devices', action: 'write', allowed: 0 }], 'device_ops', 'devices', 'write')).toBe(false);
    expect(can([{ module: 'campaigns', action: 'approve', allowed: true }], 'customer', 'campaigns', 'approve')).toBe(false);
    expect(can([{ module: 'finance', action: 'delete', allowed: 1 }], 'customer', 'finance', 'delete')).toBe(false);
    expect(can([{ module: 'admin', action: 'view', allowed: 1 }], 'partner', 'admin', 'view')).toBe(false);
    expect(can([{ module: 'finance', action: 'view', allowed: 1 }], 'partner', 'finance', 'view')).toBe(false);
    expect(can([{ module: 'media', action: 'delete', allowed: 1 }], 'content_manager', 'media', 'view')).toBe(true);
  });
  it('gia tri la tu choi', () => {
    expect(can([], 'hacker', 'devices', 'view')).toBe(false);
    expect(can([], 'super_admin', 'nope', 'view')).toBe(false);
    expect(can([], 'super_admin', 'devices', 'nuke')).toBe(false);
    expect(can(null, 'super_admin', 'devices', 'view')).toBe(true);
  });
  it('effectivePermissions va validateOverride', () => {
    expect(effectivePermissions([], 'partner')).toEqual({ campaigns: ['view'], media: ['view', 'write'] });
    expect(effectivePermissions([], 'device_ops').devices).toEqual(['view', 'write']);
    expect(validateOverride('customer', 'campaigns', 'approve', true)).toMatch(/ngoai/);
    expect(validateOverride('customer', 'campaigns', 'approve', false)).toBeNull();
    expect(validateOverride('finance', 'finance', 'delete', true)).toBeNull();
    expect(validateOverride('x', 'finance', 'delete', true)).toMatch(/vai tro/);
    expect(defaultAllows('finance', 'finance', 'delete')).toBe(true);
  });
});
