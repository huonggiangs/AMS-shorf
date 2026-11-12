// CI: that bai (exit 1) khi docs/openapi/*.{json,yaml} khong khop voi dau ra sinh moi tu route + zod that.
// Chay: pnpm --filter @ams/openapi check   (hoac `pnpm openapi:check` o goc neu f1 them script)
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildAll, REPO } from '../src/build.js';
import { render } from '../src/render.js';

const { admin, gateway } = await buildAll();
let bad = 0;
for (const [name, doc] of [['ams-admin-api', admin], ['ams-device-gateway', gateway]] as const) {
  const r = render(doc);
  for (const [ext, want] of [['json', r.json], ['yaml', r.yaml]] as const) {
    const f = resolve(REPO, `docs/openapi/${name}.${ext}`);
    const have = existsSync(f) ? readFileSync(f, 'utf8') : null;
    if (have !== want) {
      bad++;
      const wantPaths = new Set(Object.keys((doc as { paths: object }).paths));
      let hint = '';
      if (have && ext === 'json') {
        const old = new Set(Object.keys((JSON.parse(have) as { paths: object }).paths));
        const add = [...wantPaths].filter((p) => !old.has(p));
        const del = [...old].filter((p) => !wantPaths.has(p));
        hint = ` (path moi: ${add.join(', ') || '-'}; path mat: ${del.join(', ') || '-'})`;
      }
      console.error(`LECH: docs/openapi/${name}.${ext} da cu${have ? '' : ' (thieu file)'}${hint}`);
    }
  }
}
if (bad) {
  console.error('\nChay lai: pnpm --filter @ams/openapi generate && pnpm --filter @ams/sdk-ts generate');
  process.exit(1);
}
console.log('OpenAPI khop voi route/zod that.');
process.exit(0);
