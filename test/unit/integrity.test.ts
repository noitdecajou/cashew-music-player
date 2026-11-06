import { describe as group, expect, it } from 'vitest';
import { checkIntegrity, describe } from '../../src/main/services/integrity';

const manifest = {
  version: 1,
  files: { 'Music Player.exe': 100, 'libGLESv2.dll': 50, 'resources/app.asar': 70, 'ffmpeg.dll': 30 },
};
const disk = (files: Record<string, number>) => (path: string) => {
  const name = Object.keys(files).find(f => path.replaceAll('\\', '/').endsWith(f));
  return name ? files[name]! : null;
};

group('integrity', () => {
  it('reports nothing when every file is there with its size', () => {
    expect(checkIntegrity('/app', manifest, disk(manifest.files))).toEqual({ missing: [], changed: [] });
  });
  it('reports missing and altered files', () => {
    const report = checkIntegrity(
      '/app',
      manifest,
      disk({ 'Music Player.exe': 100, 'resources/app.asar': 71, 'ffmpeg.dll': 30 }),
    );
    expect(report).toEqual({ missing: ['libGLESv2.dll'], changed: ['resources/app.asar'] });
    expect(describe(report!)).toBe('libGLESv2.dll\nresources/app.asar');
  });
  it('only checks the presence of executables and libraries (edited or signed after packaging)', () => {
    const report = checkIntegrity(
      '/app',
      manifest,
      disk({ 'Music Player.exe': 140, 'libGLESv2.dll': 55, 'resources/app.asar': 70, 'ffmpeg.dll': 30 }),
    );
    expect(report).toEqual({ missing: [], changed: [] });
  });
  it('ignores a missing or malformed manifest and suspicious paths', () => {
    expect(checkIntegrity('/app', null)).toBeNull();
    expect(checkIntegrity('/app', { files: 'x' })).toBeNull();
    expect(checkIntegrity('/app', { files: { '../outside': 1, 'ok.dll': 'big' } }, () => null)).toEqual({
      missing: [],
      changed: [],
    });
  });
  it('summarises long lists', () => {
    const many = { missing: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], changed: [] };
    expect(describe(many, 3)).toBe('a\nb\nc\n… et 5 autre(s)');
  });
});
