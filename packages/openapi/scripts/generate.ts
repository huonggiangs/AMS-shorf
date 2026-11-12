import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stringify } from 'yaml';
import { buildAll, REPO } from '../src/build.js';
import { render } from '../src/render.js';

const out = resolve(REPO, 'docs/openapi');
mkdirSync(out, { recursive: true });
const { admin, gateway, coverage } = await buildAll();
for (const [name, doc] of [['ams-admin-api', admin], ['ams-device-gateway', gateway]] as const) {
  const r = render(doc);
  writeFileSync(resolve(out, `${name}.json`), r.json);
  writeFileSync(resolve(out, `${name}.yaml`), r.yaml);
  console.log(`ghi docs/openapi/${name}.{json,yaml}`);
}
console.log(`admin: ${coverage.routes} route, ${coverage.withBodyExtracted} body trich tu zod that; chua trich: ${coverage.withoutExtraction.length}`);
void stringify;
process.exit(0);
