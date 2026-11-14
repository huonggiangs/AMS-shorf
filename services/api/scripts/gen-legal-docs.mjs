// Dong goi docs/legal/*.draft.md thanh src/legal/documents.gen.ts (Workers khong co fs). Chay: pnpm --filter @ams/api gen:legal
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SOURCES = [
  { kind: 'terms', file: 'TERMS-OF-SERVICE.draft.md', title: 'Điều khoản dịch vụ AMS' },
  { kind: 'privacy', file: 'PRIVACY-POLICY.draft.md', title: 'Chính sách bảo mật AMS' },
  { kind: 'sla', file: 'SLA.draft.md', title: 'Cam kết mức dịch vụ (SLA) AMS' },
];
const docs = SOURCES.map((s) => ({ kind: s.kind, title: s.title, version: '0.1-draft', body_md: readFileSync(join(root, 'docs', 'legal', s.file), 'utf8').replace(/\r\n/g, '\n') }));
const out =
  '// SINH TU DONG boi scripts/gen-legal-docs.mjs tu docs/legal/*.draft.md - KHONG SUA TAY. Chay: pnpm --filter @ams/api gen:legal\n' +
  "// Day la BAN NHAP chua duoc luat su duyet: chi duoc nap o trang thai 'draft'. Phat hanh = hanh dong cua quan tri (legal/service.ts).\n" +
  'export interface SeedLegalDoc { kind: string; title: string; version: string; body_md: string }\n' +
  'export const SEED_LEGAL_DOCS: SeedLegalDoc[] = ' + JSON.stringify(docs, null, 2) + ';\n';
writeFileSync(join(root, 'services', 'api', 'src', 'legal', 'documents.gen.ts'), out);
console.log('da dong goi', docs.length, 'van ban phap ly');
