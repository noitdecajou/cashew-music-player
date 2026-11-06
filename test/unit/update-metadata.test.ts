import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { updateMetadata } = require('../../build/update-metadata.cjs') as { updateMetadata: (a: string, b: string) => Promise<{ sha512: string; size: number }> };

describe('update metadata after signing', () => {
  it('rewrites sha512 and size in latest.yml and rebuilds the blockmap', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mp-meta-'));
    const installer = join(dir, 'MusicPlayer-Setup-9.9.9.exe');
    const bytes = Buffer.alloc(300_000, 7);
    bytes.write('signed!', 1000);
    writeFileSync(installer, bytes);
    const yml = join(dir, 'latest.yml');
    writeFileSync(yml, [
      'version: 9.9.9', 'files:', '  - url: MusicPlayer-Setup-9.9.9.exe', '    sha512: OLD', '    size: 1', 'path: MusicPlayer-Setup-9.9.9.exe',
      'sha512: OLD', "releaseDate: '2026-11-06T00:00:00.000Z'", '',
    ].join('\n'));
    const result = await updateMetadata(installer, yml);
    const expected = createHash('sha512').update(bytes).digest('base64');
    expect(result).toEqual({ sha512: expected, size: bytes.length });
    const text = readFileSync(yml, 'utf8');
    expect(text.match(new RegExp(`sha512: ${expected.replace(/[+/]/g, m => `\\${m}`)}`, 'g'))).toHaveLength(2);
    expect(text).toContain(`size: ${bytes.length}`);
    expect(text).toContain('url: MusicPlayer-Setup-9.9.9.exe');
    expect(existsSync(`${installer}.blockmap`)).toBe(true);
  });

  it('refuses metadata that describes another file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mp-meta-'));
    writeFileSync(join(dir, 'a.exe'), 'x');
    writeFileSync(join(dir, 'latest.yml'), 'path: b.exe\nsha512: OLD\n');
    await expect(updateMetadata(join(dir, 'a.exe'), join(dir, 'latest.yml'))).rejects.toThrow(/does not describe/);
  });
});
