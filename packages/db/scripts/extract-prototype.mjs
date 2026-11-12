// Trich du lieu mau tu prototype/app.js (chay cac khai bao mang trong vm co lap) -> src/seed-data.gen.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const lines = readFileSync(join(root, 'prototype', 'app.js'), 'utf8').split('\n');
const pick = (...ranges) => ranges.flatMap(([a, b]) => lines.slice(a - 1, b)).join('\n');
// 42-49: who, acts, audit, notifs, users, sched, partners, floors; 91: businessA
// 17-24: own, mdl, stt, reg, devices, ads, media, members; 25-27: MODS...; 83-85: VEN, CUS, CT; 179: WAL; 181: TOP; 184: SEP
const src = pick([17, 27], [42, 49], [83, 85], [91, 91], [179, 179], [181, 181], [184, 184]) +
  '\n;({ own, mdl, stt, reg, devices, ads, media, members, MODS, who, acts, audit, notifs, users, sched, partners, floors, businessA, VEN, CUS, CT, WAL, TOP, SEP, TODAY })';
const data = vm.runInNewContext(src, Object.create(null), { timeout: 2000 });
// phan lon khong chua ham; chi giu du lieu thuan
const json = JSON.parse(JSON.stringify(data));
const out =
  '// SINH TU DONG boi scripts/extract-prototype.mjs tu prototype/app.js - KHONG SUA TAY. Chay: pnpm --filter @ams/db gen\n' +
  '/* eslint-disable */\n' +
  'export const PROTOTYPE = ' + JSON.stringify(json, null, 1) + ' as const;\n';
writeFileSync(join(root, 'packages', 'db', 'src', 'seed-data.gen.ts'), out);
console.log('prototype ->', Object.entries(json).map(([k, v]) => `${k}:${Array.isArray(v) ? v.length : typeof v}`).join(' '));
