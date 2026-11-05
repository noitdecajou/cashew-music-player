import { join } from 'node:path';
import type { LibraryStatus, PlaylistResult, SongResult } from '../../shared/ipc';
import type { Page, Playlist, Song } from '../../shared/ops';
import { ACCOUNT_KEY, PLAYLIST_ID, VIDEO_ID, httpsUrl, str } from '../../shared/player';
import { readJson, writeJson } from './json-file';

export const fold = (value: string): string => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const REFRESH_AFTER_MS = 6 * 60 * 60 * 1000;
const MAX_FAVORITES = 200;
const MAX_PAGES = 200;

interface IndexedSong extends Song { playlists: string[]; key: string }
interface CacheFile { version: 2; updatedAt: number; playlists: Playlist[]; songs: (Song & { playlists: string[] })[]; favorites: string[] }

export interface LibrarySource {
  playlists(continuation?: string): Promise<Page<Playlist>>;
  songs(browseId: string, continuation?: string): Promise<Page<Song>>;
}

/**
 * Index of the songs of the account's playlists, searchable offline.
 * Built by walking every playlist; persisted per account; a refresh keeps the
 * previous complete index until the new one is complete.
 */
export class Library {
  private account = '';
  private generation = 0;
  private playlists = new Map<string, Playlist>();
  private songs = new Map<string, IndexedSong>();
  private favorites = new Set<string>();
  private updatedAt = 0;
  private status: LibraryStatus = { state: 'idle', playlists: 0, songs: 0, done: 0, total: 0, updatedAt: 0, error: '' };

  constructor(private readonly directory: string, private readonly source: LibrarySource, private readonly notify: (status: LibraryStatus) => void) {}

  private file(account: string): string { return join(this.directory, 'library', `${account}.json`); }

  get currentStatus(): LibraryStatus { return this.status; }

  private setStatus(patch: Partial<LibraryStatus>): void {
    this.status = { ...this.status, ...patch, playlists: this.playlists.size, songs: this.songs.size, updatedAt: this.updatedAt };
    this.notify(this.status);
  }

  /** Switches to an account (or none): loads its cache, refreshes when stale. */
  async setAccount(account: string): Promise<void> {
    if (account === this.account) return;
    this.account = ACCOUNT_KEY.test(account) ? account : '';
    const generation = ++this.generation;
    this.playlists = new Map(); this.songs = new Map(); this.favorites = new Set(); this.updatedAt = 0;
    this.setStatus({ state: 'idle', done: 0, total: 0, error: '' });
    if (!this.account) return;
    const cache = parseCache(await readJson(this.file(this.account)));
    if (generation !== this.generation) return;
    if (cache) {
      this.playlists = new Map(cache.playlists.map(p => [p.id, p]));
      this.songs = new Map(cache.songs.map(s => [s.videoId, { ...s, key: fold(`${s.title} ${s.artist}`) }]));
      this.favorites = new Set(cache.favorites.filter(id => this.playlists.has(id)));
      this.updatedAt = cache.updatedAt;
      this.setStatus({ state: 'ready' });
    }
    if (!cache || Date.now() - cache.updatedAt > REFRESH_AFTER_MS || Date.now() < cache.updatedAt) void this.refresh();
  }

  async refresh(): Promise<void> {
    if (!this.account || this.status.state === 'indexing') return;
    const generation = this.generation;
    const firstRun = this.updatedAt === 0;
    this.setStatus({ state: 'indexing', done: 0, total: 0, error: '' });
    try {
      const playlists = new Map<string, Playlist>();
      await this.pages(continuation => this.source.playlists(continuation), page => { for (const p of page.items) playlists.set(p.id, p); }, generation);
      if (generation !== this.generation) return;
      if (firstRun) this.playlists = playlists;
      this.setStatus({ total: playlists.size });
      const songs = new Map<string, IndexedSong>();
      let failures = 0;
      let done = 0;
      for (const playlist of playlists.values()) {
        try {
          await this.pages(continuation => this.source.songs(playlist.id, continuation), page => {
            for (const song of page.items) {
              const known = songs.get(song.videoId);
              if (known) { if (!known.playlists.includes(playlist.title)) known.playlists.push(playlist.title); }
              else songs.set(song.videoId, { ...song, playlists: [playlist.title], key: fold(`${song.title} ${song.artist}`) });
            }
            // First run: searchable while indexing.
            if (firstRun) this.songs = songs;
          }, generation);
        } catch { failures++; }
        if (generation !== this.generation) return;
        this.setStatus({ done: ++done });
      }
      if (failures && !firstRun) throw new Error(`${failures} playlist(s) illisible(s) : ancien index conservé.`);
      this.playlists = playlists;
      this.songs = songs;
      this.favorites = new Set([...this.favorites].filter(id => playlists.has(id)));
      this.updatedAt = Date.now();
      this.setStatus({ state: 'ready', error: failures ? `${failures} playlist(s) n’ont pas pu être lues.` : '' });
      await this.save();
    } catch (error) {
      if (generation === this.generation) this.setStatus({ state: this.updatedAt ? 'ready' : 'error', error: error instanceof Error ? error.message : String(error) });
    }
  }

  private async pages<T>(load: (continuation?: string) => Promise<Page<T>>, use: (page: Page<T>) => void, generation: number): Promise<void> {
    const seen = new Set<string>();
    let continuation: string | undefined;
    for (let i = 0; i < MAX_PAGES; i++) {
      const page = await load(continuation);
      if (generation !== this.generation) return;
      use(page);
      if (!page.continuation || seen.has(page.continuation)) return;
      seen.add(page.continuation);
      continuation = page.continuation;
    }
  }

  private save(): Promise<void> {
    if (!this.account) return Promise.resolve();
    const data: CacheFile = {
      version: 2, updatedAt: this.updatedAt, playlists: [...this.playlists.values()],
      songs: [...this.songs.values()].map(({ key: _key, ...song }) => song), favorites: [...this.favorites],
    };
    return writeJson(this.file(this.account), data);
  }

  searchSongs(query: string): SongResult[] {
    const terms = fold(query).trim().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const results: SongResult[] = [];
    for (const song of this.songs.values()) {
      if (terms.every(term => song.key.includes(term))) {
        results.push({ videoId: song.videoId, title: song.title, artist: song.artist, artwork: song.artwork, detail: song.playlists.join(', ') });
        if (results.length === 100) break;
      }
    }
    return results;
  }

  searchPlaylists(query: string): PlaylistResult[] {
    const terms = fold(query).trim().split(/\s+/).filter(Boolean);
    return [...this.playlists.values()]
      .filter(p => terms.every(term => fold(p.title).includes(term)))
      .map(p => ({ ...p, favorite: this.favorites.has(p.id) }))
      .sort((a, b) => Number(b.favorite) - Number(a.favorite));
  }

  hasPlaylist(id: string): boolean { return this.playlists.has(id); }

  async setFavorite(id: string, favorite: boolean): Promise<void> {
    if (!this.playlists.has(id)) throw new Error('Playlist absente de la bibliothèque.');
    if (favorite && !this.favorites.has(id) && this.favorites.size >= MAX_FAVORITES) throw new Error(`Limite de ${MAX_FAVORITES} favoris atteinte.`);
    if (favorite) this.favorites.add(id); else this.favorites.delete(id);
    await this.save();
  }
}

function parseCache(raw: unknown): CacheFile | null {
  const c = raw as Record<string, unknown> | null;
  if (!c || c.version !== 2 || typeof c.updatedAt !== 'number' || !Array.isArray(c.playlists) || !Array.isArray(c.songs)) return null;
  const playlists = c.playlists.flatMap((v): Playlist[] => {
    const p = v as Record<string, unknown>;
    return PLAYLIST_ID.test(str(p?.id)) ? [{ id: str(p.id), title: str(p.title), subtitle: str(p.subtitle), artwork: httpsUrl(p.artwork) }] : [];
  });
  const songs = c.songs.flatMap((v): (Song & { playlists: string[] })[] => {
    const s = v as Record<string, unknown>;
    return VIDEO_ID.test(str(s?.videoId)) ? [{ videoId: str(s.videoId), title: str(s.title), artist: str(s.artist), artwork: httpsUrl(s.artwork),
      playlists: Array.isArray(s.playlists) ? s.playlists.map(x => str(x)).slice(0, 50) : [] }] : [];
  });
  const favorites = Array.isArray(c.favorites) ? c.favorites.map(x => str(x)).filter(x => PLAYLIST_ID.test(x)) : [];
  return { version: 2, updatedAt: c.updatedAt, playlists, songs, favorites };
}
