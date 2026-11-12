/**
 * Tach tep SQL thanh tung cau lenh (D1 khong chay duoc nhieu cau trong mot lan exec).
 * Ho tro chuoi '...' / "...", chu thich `--` va block, khoi $$...$$ (ham plpgsql)
 * va than trigger SQLite `CREATE TRIGGER ... BEGIN ...; END;`.
 */
export function splitSql(sql: string): string[] {
  const out: string[] = [];
  let cur = '';
  let i = 0;
  const n = sql.length;
  const push = () => {
    const stripped = cur.replace(/--[^\n]*/g, '').trim();
    if (stripped) out.push(cur.trim());
    cur = '';
  };
  while (i < n) {
    const c = sql[i]!;
    const two = sql.slice(i, i + 2);
    if (two === '--') {
      const e = sql.indexOf('\n', i);
      const end = e < 0 ? n : e + 1;
      cur += sql.slice(i, end);
      i = end;
    } else if (two === '/*') {
      const e = sql.indexOf('*/', i + 2);
      const end = e < 0 ? n : e + 2;
      cur += sql.slice(i, end);
      i = end;
    } else if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === c) {
          if (sql[j + 1] === c) j += 2;
          else break;
        } else j++;
      }
      cur += sql.slice(i, j + 1);
      i = j + 1;
    } else if (two === '$$') {
      const e = sql.indexOf('$$', i + 2);
      const end = e < 0 ? n : e + 2;
      cur += sql.slice(i, end);
      i = end;
    } else if (c === ';') {
      const body = cur.replace(/--[^\n]*/g, '');
      const isSqliteTrigger = /^\s*CREATE\s+TRIGGER\b/i.test(body) && /\bBEGIN\b/i.test(body);
      if (isSqliteTrigger && !/\bEND\s*$/i.test(body)) {
        cur += ';';
      } else {
        cur += ';';
        push();
      }
      i++;
    } else {
      cur += c;
      i++;
    }
  }
  push();
  return out;
}
