import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import SwaggerParser from '@apidevtools/swagger-parser';
import { buildAll, liveRoutes, REPO } from '../src/build.js';
import { render } from '../src/render.js';
import { eventsBody, registerBody } from '@ams/edge-gateway/protocol';

const load = (n: string) => JSON.parse(readFileSync(resolve(REPO, `docs/openapi/${n}.json`), 'utf8'));

describe('OpenAPI 3.1', () => {
  it('hai tai lieu hop le theo validator OpenAPI', async () => {
    for (const n of ['ams-admin-api', 'ams-device-gateway']) {
      const api = await SwaggerParser.validate(structuredClone(load(n)));
      expect((api as { openapi: string }).openapi).toBe('3.1.0');
    }
  });

  it('khong lech: file da commit == dau ra sinh moi (json + yaml)', async () => {
    const { admin, gateway } = await buildAll();
    expect(render(admin).json).toBe(readFileSync(resolve(REPO, 'docs/openapi/ams-admin-api.json'), 'utf8'));
    expect(render(gateway).json).toBe(readFileSync(resolve(REPO, 'docs/openapi/ams-device-gateway.json'), 'utf8'));
    expect(render(admin).yaml).toBe(readFileSync(resolve(REPO, 'docs/openapi/ams-admin-api.yaml'), 'utf8'));
  }, 60_000);

  it('moi route that deu co operation (va nguoc lai)', async () => {
    const live = await liveRoutes();
    const ops = (doc: { paths: Record<string, Record<string, unknown>> }) => new Set(Object.entries(doc.paths).flatMap(([p, m]) => Object.keys(m).map((k) => `${k.toUpperCase()} ${p.replace(/\{(\w+)\}/g, ':$1')}`)));
    const a = ops(load('ams-admin-api'));
    const g = ops(load('ams-device-gateway'));
    expect([...a].sort()).toEqual(live.api.map((r) => `${r.method} ${r.path}`).sort());
    expect([...g].sort()).toEqual(live.gateway.map((r) => `${r.method} ${r.path}`).sort());
  }, 60_000);

  it('moi route ghi body (parseBody/jsonBody) deu co requestBody trong spec', async () => {
    const { coverage } = await buildAll();
    // route moi them o noi khac ma chua khai bao tep nguon trong SRC (build.ts) => that bai o day, khong im lang
    expect(coverage.withoutExtraction).toEqual(['GET /health']);
    expect(coverage.withBodyExtracted).toBeGreaterThanOrEqual(40);
    const doc = load('ams-admin-api');
    const body = doc.paths['/admin/v1/campaigns/{id}/reject'].post.requestBody.content['application/json'].schema;
    const sch = doc.components.schemas[body.$ref.split('/').pop()!];
    expect(sch.required).toContain('reason');
    expect(sch.properties.reason.minLength).toBe(3);
  }, 60_000);

  it('schema gateway la zod protocol that', () => {
    const g = load('ams-device-gateway');
    const reg = g.components.schemas.RegisterRequest;
    expect(reg.properties.pubkey.minLength).toBe(43);
    expect(reg.properties.pubkey.maxLength).toBe(43);
    expect(Object.keys(reg.properties).sort()).toEqual(Object.keys(registerBody.shape).sort());
    const ev = g.components.schemas.EventsRequest.properties.events;
    expect(ev.maxItems).toBe(50);
    expect(eventsBody.safeParse({ events: [] }).success).toBe(false);
  });

  it('khoa quyen cua operation khop route (vd approve can campaigns/approve)', () => {
    const d = load('ams-admin-api');
    expect(d.paths['/admin/v1/campaigns/{id}/approve'].post['x-ams-permission']).toEqual({ module: 'campaigns', action: 'approve' });
    expect(d.paths['/webhooks/payments/sepay'].post.security).toHaveLength(2);
  });
});
