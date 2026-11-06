// Run after packaging, against the unpacked app (CI: dist/win-unpacked):
// MP_PACKAGE_DIR=dist/win-unpacked npx vitest run test/unit/package.test.ts
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkIntegrity, readManifest } from '../../src/main/services/integrity';

const dir = process.env.MP_PACKAGE_DIR;

describe.skipIf(!dir)('packaged app', () => {
  it('ships an integrity manifest that matches its own files (no false alarm at startup)', () => {
    const manifest = readManifest(dir!) as { files: Record<string, number> } | null;
    expect(manifest?.files).toBeTruthy();
    expect(Object.keys(manifest!.files)).toEqual(expect.arrayContaining(['resources/app.asar']));
    expect(checkIntegrity(dir!, manifest)).toEqual({ missing: [], changed: [] });
  });

  it('lists the display libraries an antivirus may quarantine', () => {
    const files = Object.keys((readManifest(dir!) as { files: Record<string, number> }).files);
    const expected = existsSync(join(dir!, 'libGLESv2.dll')) ? ['libGLESv2.dll', 'libEGL.dll', 'ffmpeg.dll'] : ['libffmpeg.so', 'libvk_swiftshader.so'];
    expect(files).toEqual(expect.arrayContaining(expected));
  });
});
