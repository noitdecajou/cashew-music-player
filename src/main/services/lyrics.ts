// Synced lyrics for the island, from LRCLIB (https://lrclib.net): a free,
// open database of time-stamped lyrics, no account needed. Only the title,
// artist, album and duration of the track are sent, and only when the
// option is on. YouTube Music's own lyrics are plain text (no timing), so they
// cannot follow the song.

import { readFileSync } from 'node:fs';
import { type LyricsState, parseLrc } from '../../shared/island';

export interface LyricsTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
}

export type Fetcher = (url: string) => Promise<{ status: number; text(): Promise<string> }>;

const API = 'https://lrclib.net/api';
const MAX_BODY = 512 * 1024;
const CACHE = 100;

interface LrclibRecord {
  trackName?: unknown;
  artistName?: unknown;
  duration?: unknown;
  instrumental?: unknown;
  syncedLyrics?: unknown;
}

/**
 * "Song (Official Video) [Remastered]" -> "Song", "Artist - Song" -> "Song",
 * "Song - Remastered 2011" -> "Song": for the fuzzy search fallback only.
 */
export function simplifyTitle(title: string, artist = ''): string {
  let t = title.replace(/\s*[([].*?[)\]]/g, '').trim();
  const prefix = `${artist} - `.toLowerCase();
  if (artist && t.toLowerCase().startsWith(prefix)) t = t.slice(prefix.length);
  else t = t.replace(/\s+-\s+.*$/, '');
  return t.trim() || title;
}

export class Lyrics {
  private readonly cache = new Map<string, LyricsState>();
  private current = '';
  private started = '';
  private disabledFor = '';
  private duration = 0;
  private generation = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly fetcher: Fetcher,
    private readonly publish: (state: LyricsState) => void,
    /** Right after a track change the player may still report the previous duration. */
    private readonly settleMs = 1500,
    /** Without a duration by then, search by title and artist only. */
    private readonly durationWaitMs = 4000,
  ) {}

  /**
   * The island shows `track`: publish what is known, fetch the rest once. Called on
   * every track change and with each duration report. LRCLIB matches on the
   * duration (±2 s): the request waits for the duration to settle, then uses the
   * latest one reported for this track.
   */
  show(track: LyricsTrack | null, duration: number, enabled: boolean): void {
    if (!track) {
      this.reset('');
      return;
    }
    if (!enabled) {
      // Forget the track: turning the option back on fetches it.
      if (this.disabledFor !== track.id) {
        this.reset('');
        this.disabledFor = track.id;
        this.publish({ trackId: track.id, status: 'off', lines: [] });
      }
      return;
    }
    this.disabledFor = '';
    const cached = this.cache.get(track.id);
    if (cached) {
      if (this.current !== track.id || this.started !== track.id) {
        this.reset(track.id);
        this.started = track.id;
        this.publish(cached);
      }
      return;
    }
    if (this.current !== track.id) {
      this.reset(track.id);
      this.publish({ trackId: track.id, status: 'loading', lines: [] });
      this.timer = setTimeout(() => this.settled(track), this.settleMs);
    }
    if (duration > 0) this.duration = duration;
  }

  dispose(): void {
    this.reset('');
  }

  private settled(track: LyricsTrack): void {
    this.timer = null;
    if (this.duration > 0) this.start(track);
    else this.timer = setTimeout(() => this.start(track), Math.max(0, this.durationWaitMs - this.settleMs));
  }

  private reset(trackId: string): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (trackId !== this.current) {
      this.started = '';
      this.duration = 0;
    }
    this.current = trackId;
    this.generation++;
  }

  private start(track: LyricsTrack): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.current !== track.id || this.started === track.id) return;
    this.started = track.id;
    const generation = ++this.generation;
    void this.fetchLyrics(track, this.duration).then(
      state => {
        // Only found lyrics are kept: a miss is tried again the next time the track plays.
        if (state.status === 'synced') this.remember(state);
        if (generation === this.generation) this.publish(state);
      },
      () => {
        // Network error: show the title; the next time the track plays tries again.
        if (generation === this.generation) this.publish({ trackId: track.id, status: 'none', lines: [] });
      },
    );
  }

  private remember(state: LyricsState): void {
    this.cache.delete(state.trackId);
    this.cache.set(state.trackId, state);
    while (this.cache.size > CACHE) this.cache.delete(this.cache.keys().next().value as string);
  }

  private async get(path: string, params: Record<string, string>): Promise<unknown> {
    const query = new URLSearchParams(params).toString();
    const response = await this.fetcher(`${API}/${path}?${query}`);
    if (response.status === 404) return null;
    if (response.status !== 200) throw new Error(`lrclib ${response.status}`);
    const body = await response.text();
    if (body.length > MAX_BODY) throw new Error('lrclib: response too large');
    return JSON.parse(body);
  }

  async fetchLyrics(track: LyricsTrack, duration: number): Promise<LyricsState> {
    const none: LyricsState = { trackId: track.id, status: 'none', lines: [] };
    const fromRecord = (record: LrclibRecord | null): LyricsState | null => {
      if (!record || record.instrumental === true) return record ? none : null;
      const lines = parseLrc(record.syncedLyrics);
      return lines.length ? { trackId: track.id, status: 'synced', lines } : null;
    };
    if (duration > 0) {
      const exact = await this.get('get', {
        track_name: track.title,
        artist_name: track.artist,
        ...(track.album ? { album_name: track.album } : {}),
        duration: String(Math.round(duration)),
      });
      const found = fromRecord(exact as LrclibRecord | null);
      if (found) return found;
    }
    const results = await this.get('search', {
      track_name: simplifyTitle(track.title, track.artist),
      artist_name: track.artist,
    });
    const candidates = (Array.isArray(results) ? results : []) as LrclibRecord[];
    const synced = candidates.filter(r => typeof r.syncedLyrics === 'string' && r.syncedLyrics);
    // The closest duration wins (a different cut of the song is likely off by more than 10 s).
    const gap = (r: LrclibRecord): number => Math.abs(Number(r.duration) - duration) || 0;
    const close = duration > 0 ? synced.filter(r => gap(r) <= 10).sort((a, b) => gap(a) - gap(b)) : synced;
    return fromRecord(close[0] ?? null) ?? none;
  }
}

/** Test-only: LRCLIB answers from a JSON file { "<track title>": "<LRC text>" }. */
export function fixtureFetcher(path: string): Fetcher {
  return async url => {
    const params = new URL(url).searchParams;
    const table = JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;
    const title = params.get('track_name') ?? '';
    const lrc = table[title];
    const record = { trackName: title, artistName: params.get('artist_name'), duration: 0, syncedLyrics: lrc };
    if (url.includes('/api/get')) {
      return lrc ? { status: 200, text: async () => JSON.stringify(record) } : { status: 404, text: async () => '' };
    }
    return { status: 200, text: async () => JSON.stringify(lrc ? [record] : []) };
  };
}
