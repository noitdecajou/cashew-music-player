import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MAX_BYTES = 512 * 1024;
let file = '';

/** Small rotating log in userData/logs: makes Windows-only problems diagnosable. */
export function initLog(userData: string): string {
  const directory = join(userData, 'logs');
  try { mkdirSync(directory, { recursive: true }); } catch { /* logging stays best-effort */ }
  file = join(directory, 'main.log');
  return directory;
}

export function log(...parts: unknown[]): void {
  if (!file) return;
  const line = `${new Date().toISOString()} ${parts.map(p => (p instanceof Error ? p.stack ?? p.message : typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}\n`;
  try {
    try { if (statSync(file).size > MAX_BYTES) renameSync(file, file.replace(/\.log$/, '.old.log')); } catch { /* no file yet */ }
    appendFileSync(file, line);
  } catch { /* disk full or locked: ignore */ }
}
