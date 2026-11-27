import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ATTESTED_BY_MAX, KID_SAFE_HELP_VI, KID_SAFE_LABEL_VI, LEGAL_ATTESTATION_STATUS_NOTE, LEGAL_ATTESTATION_TEXT_VI, LEGAL_ATTESTATION_VERSION } from '../src/index.js';

const root = resolve(import.meta.dirname, '../../..');
describe('cam ket phap ly: 3 ban van ban khop nhau', () => {
  const web = readFileSync(resolve(root, 'apps/web-admin/src/lib/attest.ts'), 'utf8');
  const doc = readFileSync(resolve(root, `docs/legal/CAM-KET-NOI-DUNG-${LEGAL_ATTESTATION_VERSION}.md`), 'utf8');
  it('web-admin khop shared', () => {
    for (const v of [LEGAL_ATTESTATION_TEXT_VI, KID_SAFE_LABEL_VI, KID_SAFE_HELP_VI, LEGAL_ATTESTATION_STATUS_NOTE, LEGAL_ATTESTATION_VERSION]) expect(web).toContain(`'${v}'`);
  });
  it('tai lieu docs/legal chua dung van ban + ghi ro cho luat su ra soat', () => {
    expect(doc).toContain(LEGAL_ATTESTATION_TEXT_VI);
    expect(doc.toLowerCase()).toContain(LEGAL_ATTESTATION_STATUS_NOTE.toLowerCase());
  });
  it('hang so', () => {
    expect(LEGAL_ATTESTATION_VERSION).toBe('legal-v1');
    expect(ATTESTED_BY_MAX).toBe(64);
  });
});
