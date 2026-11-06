import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface IntegrityReport { missing: string[]; changed: string[] }

type Size = (path: string) => number | null;
const SIGNED = /\.(exe|dll|node)$/i;
const realSize: Size = path => { try { return statSync(path).size; } catch { return null; } };

/** Compares the installed files with the manifest written at build time (build/after-pack.cjs). */
export function checkIntegrity(root: string, manifest: unknown, size: Size = realSize): IntegrityReport | null {
  const files = (manifest as { version?: number; files?: Record<string, unknown> } | null)?.files;
  if (!files || typeof files !== 'object') return null;
  const report: IntegrityReport = { missing: [], changed: [] };
  for (const [name, expected] of Object.entries(files)) {
    if (typeof expected !== 'number' || name.includes('..')) continue;
    const actual = size(join(root, ...name.split('/')));
    if (actual === null) report.missing.push(name);
    // Executables and libraries are edited or signed after the manifest is
    // written (icon, version info, code signing): only their presence counts.
    else if (actual !== expected && !SIGNED.test(name)) report.changed.push(name);
  }
  return report;
}

export function readManifest(root: string): unknown {
  try { return JSON.parse(readFileSync(join(root, 'resources', 'integrity.json'), 'utf8')); } catch { return null; }
}

export function describe(report: IntegrityReport, limit = 6): string {
  const names = [...report.missing, ...report.changed];
  return names.slice(0, limit).join('\n') + (names.length > limit ? `\n… et ${names.length - limit} autre(s)` : '');
}
