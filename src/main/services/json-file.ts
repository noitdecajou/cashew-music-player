import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Atomic JSON write (temp file + rename), serialized per file. */
const chains = new Map<string, Promise<void>>();
export function writeJson(file: string, value: unknown): Promise<void> {
  const data = JSON.stringify(value);
  const next = (chains.get(file) ?? Promise.resolve()).then(async () => {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(`${file}.tmp`, data);
    await rename(`${file}.tmp`, file);
  }).catch(error => { console.error('write failed', file, error); });
  chains.set(file, next);
  return next;
}

export async function readJson(file: string): Promise<unknown> {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; }
}

export function pendingWrites(): Promise<unknown> {
  return Promise.all(chains.values());
}
