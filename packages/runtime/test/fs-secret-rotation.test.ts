// P2: xoay SESSION_SECRET (khoa ky URL kho tep fs) khong ngung: URL cap boi khoa cu van xac minh duoc, nhung khoa cu khong bao gio de ky.
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FsObjectStore } from '../src/fs.js';

const mk = async (secret: string, prev: string[] = []) => new FsObjectStore({ dir: await mkdtemp(join(tmpdir(), 'ams-fs-')), signingSecret: secret, previousSecrets: prev });
const q = (url: string) => new URL(url, 'http://x').searchParams;

describe('FsObjectStore xoay khoa ky', () => {
  it('URL ky bang khoa cu xac minh duoc khi khoa cu nam trong previousSecrets; ky moi dung khoa moi', async () => {
    const oldStore = await mk('old-secret');
    const url = await oldStore.getSigned('media/a.png', 600);
    const key = 'media/a.png';
    expect(oldStore.verifySigned('get', key, q(url)).ok).toBe(true);
    const rotated = await mk('new-secret', ['old-secret']);
    expect(rotated.verifySigned('get', key, q(url)).ok).toBe(true);
    const onlyNew = await mk('new-secret');
    expect(onlyNew.verifySigned('get', key, q(url)).reason).toBe('bad_signature');
    // URL moi ky bang khoa moi: khoa cu khong xac minh duoc
    const fresh = await rotated.getSigned(key, 600);
    expect(onlyNew.verifySigned('get', key, q(fresh)).ok).toBe(true);
    expect(oldStore.verifySigned('get', key, q(fresh)).ok).toBe(false);
  });
});
