import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Library, type LibrarySource, fold } from '../../src/main/services/library';
import { pendingWrites } from '../../src/main/services/json-file';
import type { LibraryStatus } from '../../src/shared/ipc';

const ACCOUNT = 'a'.repeat(64);
const song = (n: number, title: string, artist = 'Artiste') => ({ videoId: `vid${String(n).padStart(8, '0')}`, title, artist, artwork: '' });

function source(failing = new Set<string>()): LibrarySource & { calls: string[] } {
  const calls: string[] = [];
  const lists: Record<string, ReturnType<typeof song>[]> = {
    VLPLa: [song(1, 'Café crème', 'Élodie'), song(2, 'Nuit étoilée'), song(3, 'Matin calme')],
    VLPLb: [song(2, 'Nuit étoilée'), song(4, 'Autre chose')],
  };
  return {
    calls,
    playlists: async continuation => {
      calls.push(`playlists:${continuation ?? ''}`);
      return continuation
        ? { items: [{ id: 'VLPLb', title: 'Soirée', subtitle: '', artwork: '' }], continuation: '' }
        : { items: [{ id: 'VLPLa', title: 'Matin', subtitle: '', artwork: '' }], continuation: 'next' };
    },
    songs: async (id, continuation) => {
      calls.push(`songs:${id}:${continuation ?? ''}`);
      if (failing.has(id)) throw new Error('boom');
      const all = lists[id] ?? [];
      const offset = Number(continuation || 0);
      const next = offset + 2 < all.length ? String(offset + 2) : '';
      return { items: all.slice(offset, offset + 2), continuation: next };
    },
  };
}

async function indexed(src = source(), dir = mkdtempSync(join(tmpdir(), 'mp-lib-'))) {
  const statuses: LibraryStatus[] = [];
  const library = new Library(dir, src, s => statuses.push(s));
  await library.setAccount(ACCOUNT);
  await vi.waitFor(() => expect(library.currentStatus.state).toBe('ready'));
  return { library, statuses, dir, src };
}

describe('Library', () => {
  it('indexes every page of every playlist and searches without accents', async () => {
    const { library, src } = await indexed();
    expect(src.calls).toEqual(['playlists:', 'playlists:next', 'songs:VLPLa:', 'songs:VLPLa:2', 'songs:VLPLb:']);
    expect(library.searchSongs('cafe ELODIE').map(s => s.title)).toEqual(['Café crème']);
    expect(library.searchSongs('matin').map(s => s.title)).toEqual(['Matin calme']); // third song: second page
    expect(library.searchSongs('nuit')[0]?.detail).toBe('Matin, Soirée'); // one entry, both playlists
    expect(library.searchSongs('   ')).toEqual([]);
    expect(library.currentStatus).toMatchObject({ playlists: 2, songs: 4, error: '' });
  });

  it('persists the index and favorites per account, and reloads them without network', async () => {
    const { library, dir } = await indexed();
    await library.setFavorite('VLPLb', true);
    expect(library.searchPlaylists('').map(p => [p.title, p.favorite])).toEqual([['Soirée', true], ['Matin', false]]);
    await pendingWrites();
    const offline: LibrarySource = { playlists: () => Promise.reject(new Error('offline')), songs: () => Promise.reject(new Error('offline')) };
    const again = new Library(dir, offline, () => undefined);
    await again.setAccount(ACCOUNT);
    expect(again.searchSongs('cafe')).toHaveLength(1);
    expect(again.searchPlaylists('soir')[0]).toMatchObject({ title: 'Soirée', favorite: true });
    await expect(again.setFavorite('VLPLzzz', true)).rejects.toThrow();
  });

  it('keeps the previous complete index when a refresh partially fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mp-lib-'));
    const { library } = await indexed(source(), dir);
    const broken = new Library(dir, source(new Set(['VLPLb'])), () => undefined);
    await broken.setAccount(ACCOUNT); // cached: ready immediately
    await broken.refresh();
    expect(broken.currentStatus.error).toMatch(/ancien index conservé/);
    expect(broken.searchSongs('autre')).toHaveLength(1);
    expect(library.searchSongs('autre')).toHaveLength(1);
  });

  it('forgets everything when the account changes', async () => {
    const { library } = await indexed();
    await library.setAccount('');
    expect(library.searchSongs('cafe')).toEqual([]);
    expect(library.currentStatus.state).toBe('idle');
  });

  it('folds accents and case', () => {
    expect(fold('Élodie ÀÇÉ')).toBe('elodie ace');
  });
});
