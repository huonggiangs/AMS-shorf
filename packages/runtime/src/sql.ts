/** Doi placeholder `?` -> `$1..$n` (bo qua `?` trong chuoi '...', "..." va chu thich). */
export function toPgPlaceholders(sql: string): string {
  let out = '';
  let n = 0;
  let i = 0;
  while (i < sql.length) {
    const c = sql[i]!;
    const two = sql.slice(i, i + 2);
    if (two === '--') {
      const e = sql.indexOf('\n', i);
      const end = e < 0 ? sql.length : e;
      out += sql.slice(i, end);
      i = end;
    } else if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === c) {
          if (sql[j + 1] === c) j += 2;
          else break;
        } else j++;
      }
      out += sql.slice(i, j + 1);
      i = j + 1;
    } else if (c === '?') {
      out += '$' + ++n;
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** Chuan hoa tham so truoc khi gui xuong driver (undefined->null, boolean->0/1, Date->ISO, object->JSON). */
export function normalizeParams(params: unknown[] | undefined): unknown[] {
  if (!params) return [];
  return params.map((p) => {
    if (p === undefined || p === null) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    if (p instanceof Date) return p.toISOString();
    if (typeof p === 'bigint') return Number(p);
    if (p instanceof Uint8Array) return p;
    if (typeof p === 'object') return JSON.stringify(p);
    return p;
  });
}
