// Sinh kieu TS tu docs/openapi/*.json: src/generated/{admin,gateway}.d.ts. `--check` => thoat 1 neu file da cu.
import openapiTS, { astToString } from 'openapi-typescript';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '../../..');
const outDir = resolve(import.meta.dirname, '../src/generated');
const check = process.argv.includes('--check');
const HEADER = '/* Sinh tu docs/openapi/<file>.json bang packages/sdk-ts/scripts/generate.ts. KHONG sua tay. */\n';
let bad = 0;
mkdirSync(outDir, { recursive: true });
for (const [spec, out] of [['ams-admin-api', 'admin'], ['ams-device-gateway', 'gateway']] as const) {
  const ast = await openapiTS(pathToFileURL(resolve(root, `docs/openapi/${spec}.json`)));
  const text = HEADER.replace('<file>', spec) + astToString(ast);
  const f = resolve(outDir, `${out}.d.ts`);
  if (check) {
    if (!existsSync(f) || readFileSync(f, 'utf8') !== text) {
      console.error(`LECH: packages/sdk-ts/src/generated/${out}.d.ts cu so voi docs/openapi/${spec}.json`);
      bad++;
    }
  } else {
    writeFileSync(f, text);
    console.log(`ghi src/generated/${out}.d.ts`);
  }
}
if (bad) {
  console.error('Chay lai: pnpm --filter @ams/sdk-ts generate');
  process.exit(1);
}
if (check) console.log('SDK khop voi OpenAPI.');
process.exit(0);
