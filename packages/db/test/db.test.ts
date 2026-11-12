import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS, migrationsFor, splitSql } from '../src/index.js';

const dir = join(import.meta.dirname, '..', 'migrations');

describe('migrations', () => {
  it('migrations.gen.ts dong bo voi thu muc migrations (chay `pnpm --filter @ams/db gen` neu lech)', () => {
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    expect(MIGRATIONS.length).toBe(files.length);
    for (const f of files) {
      const m = MIGRATIONS.find((x) => f.startsWith(x.name) && f.includes(x.dialect === 'all' ? '' : '.' + x.dialect + '.'))!;
      expect(m.sql).toBe(readFileSync(join(dir, f), 'utf8'));
    }
  });
  it('moi dialect co cung danh sach ten migration', () => {
    expect(migrationsFor('postgres').map((m) => m.name)).toEqual(migrationsFor('sqlite').map((m) => m.name));
  });
  it('splitSql: trigger SQLite, ham $$, chuoi co dau ;', () => {
    const s = splitSql(`CREATE TABLE a (x TEXT); -- c; d
INSERT INTO a VALUES ('a;b');
CREATE TRIGGER t BEFORE UPDATE ON a BEGIN SELECT RAISE(ABORT,'x;y'); END;
CREATE FUNCTION f() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;
SELECT 1;`);
    expect(s.length).toBe(5);
    expect(s[2]).toMatch(/END;$/);
    expect(s[3]).toContain('$$ LANGUAGE plpgsql;');
  });
  it('du lieu mau trich tu prototype co dung so luong', async () => {
    const { PROTOTYPE: P } = await import('../src/seed-data.gen.js');
    expect([P.CUS.length, P.CT.length, P.ads.length, P.TOP.length, P.VEN.length]).toEqual([9, 9, 10, 6, 12]);
  });
});
