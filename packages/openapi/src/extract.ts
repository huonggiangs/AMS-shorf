// Trich xuat tu ma nguon that (services/* chi doc): schema body inline (parseBody/jsonBody), quyen (requirePerm), danh sach (runList).
// Cach lam: TypeScript AST -> tim loi goi r.<method>('<subpath>', ...) -> trong handler tim parseBody(c, EXPR) / jsonBody(c, EXPR)
// -> eval EXPR bang zod that cung cac `const` cap tren cung va import cua tep. Neu khong eval duoc, ghi vao `unresolved` (KHONG doan).
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { z, type ZodTypeAny } from 'zod';

export interface Extracted {
  method: string; // GET|POST|PUT|PATCH|DELETE
  subpath: string; // nhu khai bao trong tep ('/' hoac '/:id/approve') hoac duong day du (payments)
  body?: ZodTypeAny;
  bodyExpr?: string;
  perm?: { module: string; action: string; kind?: string };
  list: boolean;
  /** ma 2xx ghi nhan trong c.json(x, 2xx) / .body(..., 2xx) (khong co => 200) */
  statuses: number[];
  line: number;
}
export interface FileExtract {
  file: string;
  routes: Extracted[];
  unresolved: { method: string; subpath: string; expr: string; reason: string }[];
}

const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);
const BODY_FNS = new Set(['parseBody', 'jsonBody']);

/** Cac identifier tham chieu that (bo ten thuoc tinh sau dau '.', bo noi dung chuoi/comment). */
function identifiersOf(src: string): Set<string> {
  const f = ts.createSourceFile('x.ts', `(${src})`, ts.ScriptTarget.ES2022, true);
  const out = new Set<string>();
  const local = new Set<string>();
  const w = (n: ts.Node): void => {
    if ((ts.isParameter(n) || ts.isVariableDeclaration(n) || ts.isBindingElement(n)) && ts.isIdentifier(n.name)) local.add(n.name.text);
    if (ts.isIdentifier(n)) {
      const p = n.parent;
      const isProp = (ts.isPropertyAccessExpression(p) && p.name === n) || (ts.isPropertyAssignment(p) && p.name === n) || (ts.isShorthandPropertyAssignment(p) && false);
      if (!isProp) out.add(n.text);
    }
    ts.forEachChild(n, w);
  };
  w(f);
  for (const l of local) out.delete(l);
  return out;
}

export async function extractFile(file: string): Promise<FileExtract> {
  const text = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const decls = new Map<string, { text: string; order: number }[]>();
  const imports = new Map<string, { spec: string; name: string }>();
    const collect = (n: ts.Node): void => {
    // `const` o moi do sau (ke ca ben trong ham khoi tao route); ten trung: lay khai bao gan nhat TRUOC vi tri route
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) decls.set(n.name.text, [...(decls.get(n.name.text) ?? []), { text: n.initializer.getText(sf), order: n.getStart(sf) }]);
    ts.forEachChild(n, collect);
  };
  collect(sf);
  for (const st of sf.statements) {
    if (ts.isVariableStatement(st)) {
      /* da thu thap o tren */
    } else if (ts.isImportDeclaration(st) && st.importClause?.namedBindings && ts.isNamedImports(st.importClause.namedBindings) && ts.isStringLiteral(st.moduleSpecifier)) {
      if (st.importClause.isTypeOnly) continue;
      for (const el of st.importClause.namedBindings.elements) imports.set(el.name.text, { spec: st.moduleSpecifier.text, name: (el.propertyName ?? el.name).text });
    }
  }
  const importCache = new Map<string, Promise<unknown>>();
  const loadImport = async (id: string): Promise<unknown> => {
    const imp = imports.get(id);
    if (!imp) return undefined;
    let p = importCache.get(imp.spec);
    if (!p) {
      const spec = imp.spec.startsWith('.') ? pathToFileURL(resolve(dirname(file), imp.spec.replace(/\.js$/, '.ts'))).href : pathToFileURL(createRequire(file).resolve(imp.spec)).href;
      p = import(spec);
      importCache.set(imp.spec, p);
    }
    return ((await p) as Record<string, unknown>)[imp.name];
  };

  const pick = (name: string, pos: number) => {
    const a = decls.get(name);
    if (!a) return undefined;
    return [...a].reverse().find((d) => d.order <= pos) ?? a[0]!;
  };
  async function evalExpr(expr: string, pos: number): Promise<ZodTypeAny> {
    const chosen = new Map<string, { text: string; order: number }>();
    // dong dependency: cac identifier trong expr trung ten `const` cap tren hoac import
    const need = new Set<string>();
    const visit = (src: string) => {
      for (const id of identifiersOf(src)) {
        if (need.has(id) || id === 'z') continue;
        const d = pick(id, pos);
        if (d && !imports.has(id)) {
          need.add(id);
          chosen.set(id, d);
          visit(d.text);
        } else if (imports.has(id)) need.add(id);
      }
    };
    visit(expr);
    const consts = [...need].filter((n) => chosen.has(n)).sort((a, b) => chosen.get(a)!.order - chosen.get(b)!.order);
    const imps = [...need].filter((n) => !chosen.has(n));
    const impVals = await Promise.all(imps.map(loadImport));
    const body = consts.map((n) => `const ${n} = (${chosen.get(n)!.text});`).join('\n') + `\nreturn (${expr});`;
    const js = ts.transpileModule(`function __f(z${imps.map((i) => ', ' + i).join('')}) {\n${body}\n}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    // eslint-disable-next-line no-new-func
    const v = new Function(`${js}\nreturn __f;`)()(z, ...impVals) as unknown;
    if (!v || typeof (v as { safeParse?: unknown }).safeParse !== 'function') throw new Error('khong phai zod schema');
    return v as ZodTypeAny;
  }

  const routes: Extracted[] = [];
  const unresolved: FileExtract['unresolved'] = [];
  const pending: Promise<void>[] = [];

  const visitNode = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && METHODS.has(node.expression.name.text) && node.arguments.length >= 2 && ts.isStringLiteralLike(node.arguments[0]!)) {
      const method = node.expression.name.text.toUpperCase();
      const subpath = (node.arguments[0] as ts.StringLiteralLike).text;
      const r: Extracted = { method, subpath, list: false, statuses: [], line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 };
      routes.push(r);
      let bodyExpr: string | undefined;
      const inner = (n: ts.Node): void => {
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ['json', 'body', 'text', 'html'].includes(n.expression.name.text)) {
          const last = n.arguments[1];
          if (last && ts.isNumericLiteral(last)) {
            const code = Number(last.text);
            if (code >= 200 && code < 300 && !r.statuses.includes(code)) r.statuses.push(code);
          }
        }
        if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
          const fn = n.expression.text;
          if (BODY_FNS.has(fn) && n.arguments.length >= 2 && !bodyExpr) bodyExpr = n.arguments[1]!.getText(sf);
          if (fn === 'runList') r.list = true;
          if ((fn === 'requirePerm' || fn === 'requireAnyPerm') && !r.perm) {
            const lits = n.arguments.filter(ts.isStringLiteralLike).map((a) => a.text);
            if (fn === 'requirePerm' && lits.length >= 2) r.perm = { module: lits[0]!, action: lits[1]!, ...(lits[2] ? { kind: lits[2] } : {}) };
          }
        }
        ts.forEachChild(n, inner);
      };
      for (const a of node.arguments.slice(1)) inner(a);
      if (bodyExpr) {
        r.bodyExpr = bodyExpr;
        const expr = bodyExpr;
        pending.push(
          evalExpr(expr, node.getStart(sf)).then(
            (s) => void (r.body = s),
            (e: Error) => void unresolved.push({ method, subpath, expr: expr.slice(0, 160), reason: e.message }),
          ),
        );
      }
      return; // khong di tiep vao route long nhau
    }
    ts.forEachChild(node, visitNode);
  };
  visitNode(sf);
  await Promise.all(pending);
  return { file, routes, unresolved };
}
