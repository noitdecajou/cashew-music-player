// Synced lyrics for the island and the lyrics views: YouTube Music's own when
// it has timed ones (see ytm-synced.ts), else LRCLIB (https://lrclib.net), a
// free, open database of time-stamped lyrics, no account needed. Only the
// title, artist, album and duration of the track are sent to LRCLIB.

import { readFileSync } from 'node:fs';
import { type LyricLine, type LyricsState, parseLrc } from '../../shared/island';

export interface LyricsTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
}

export type Fetcher = (url: string) => Promise<{ status: number; text(): Promise<string> }>;

/** Another source of synced lyrics, asked first (YouTube Music's own). */
export type SyncedSource = (track: LyricsTrack) => Promise<{ lines: LyricLine[]; source: string } | null>;

export interface LyricsOptions {
  /** Asked before LRCLIB; its failures are only reported. */
  first?: SyncedSource;
  /** A source failed (network, server): for the diagnostic log. */
  onError?: (source: string, error: unknown) => void;
  /** Delay before trying again after a network error (once per track). */
  retryMs?: number;
}

const API = 'https://lrclib.net/api';
const MAX_BODY = 512 * 1024;
const CACHE = 500;

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

class LrclibError extends Error {
  constructor(
    readonly status: number,
    request: string,
  ) {
    super(`lrclib ${status} (${request})`);
  }
}

export class Lyrics {
  private readonly cache = new Map<string, LyricsState>();
  private current = '';
  private started = '';
  private disabledFor = '';
  private duration = 0;
  private generation = 0;
  private timer: NodeJS.Timeout | null = null;
  /** The latest details of the current track (YouTube Music may name it a moment after its id). */
  private latest: LyricsTrack | null = null;

  constructor(
    private readonly fetcher: Fetcher,
    private readonly publish: (state: LyricsState) => void,
    /** Right after a track change the player may still report the previous duration. */
    private readonly settleMs = 1500,
    /** Without a duration by then, search by title and artist only. */
    private readonly durationWaitMs = 4000,
    /** Called when new lyrics are found (to keep them on disk). */
    private readonly onLearn: () => void = () => {},
    private readonly options: LyricsOptions = {},
  ) {}

  /** Lyrics found earlier (from disk). */
  seed(states: LyricsState[]): void {
    for (const state of states)
      if (state.status === 'synced' && !this.cache.has(state.trackId)) this.cache.set(state.trackId, state);
    while (this.cache.size > CACHE) this.cache.delete(this.cache.keys().next().value as string);
  }

  /** Found lyrics, oldest first (what is kept on disk). */
  cached(): LyricsState[] {
    return [...this.cache.values()];
  }

  /**
   * The island shows `track`: publish what is known, fetch the rest once. Called on
   * every track change and with each duration report. LRCLIB matches on the
   * duration (±2 s): the request waits for the duration to settle, then uses the
   * latest one reported for this track.
   */
  show(track: LyricsTrack | null, duration: number, enabled: boolean, settled = false): void {
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
      this.latest = track;
      this.publish({ trackId: track.id, status: 'loading', lines: [] });
      // A track playing for a while already has its own duration: no need to wait.
      if (settled && duration > 0) {
        this.duration = duration;
        this.start(track);
      } else this.timer = setTimeout(() => this.settled(track), this.settleMs);
    }
    if (duration > 0) this.duration = duration;
    this.latest = track;
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

  private start(first: LyricsTrack, retry = true): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const track = this.latest?.id === first.id ? this.latest : first;
    if (this.current !== track.id || (retry && this.started === track.id)) return;
    // No title yet: nothing to look for; wait for the track's details.
    if (!track.title.trim()) {
      this.timer = setTimeout(() => this.start(track, retry), 500);
      return;
    }
    this.started = track.id;
    const generation = ++this.generation;
    void this.fetchLyrics(track, this.duration).then(
      state => {
        // Only found lyrics are kept: a miss is tried again the next time the track plays.
        if (state.status === 'synced') {
          this.remember(state);
          this.onLearn();
        }
        if (generation === this.generation) this.publish(state);
      },
      error => {
        this.options.onError?.('lrclib', error);
        if (generation !== this.generation) return;
        // Network error: one more try a moment later, then the title; the next time
        // the track plays tries again.
        if (retry) this.timer = setTimeout(() => this.start(track, false), this.options.retryMs ?? 3000);
        else this.publish({ trackId: track.id, status: 'none', lines: [] });
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
    if (response.status !== 200) throw new LrclibError(response.status, `${path}?${query}`);
    const body = await response.text();
    if (body.length > MAX_BODY) throw new Error('lrclib: response too large');
    return JSON.parse(body);
  }

  async fetchLyrics(track: LyricsTrack, duration: number): Promise<LyricsState> {
    if (this.options.first) {
      try {
        const found = await this.options.first(track);
        if (found?.lines.length)
          return {
            trackId: track.id,
            status: 'synced',
            lines: found.lines,
            source: `YouTube Music${found.source ? ` · ${found.source}` : ''}`,
          };
      } catch (error) {
        this.options.onError?.('youtube music', error);
      }
    }
    const none: LyricsState = { trackId: track.id, status: 'none', lines: [] };
    const fromRecord = (record: LrclibRecord | null): LyricsState | null => {
      if (!record || record.instrumental === true) return record ? none : null;
      const lines = parseLrc(record.syncedLyrics);
      return lines.length ? { trackId: track.id, status: 'synced', lines, source: 'LRCLIB' } : null;
    };
    // LRCLIB refuses a zero duration: the exact match needs at least a second.
    if (Math.round(duration) >= 1) {
      let exact: unknown = null;
      try {
        exact = await this.get('get', {
          track_name: track.title,
          artist_name: track.artist,
          ...(track.album ? { album_name: track.album } : {}),
          duration: String(Math.round(duration)),
        });
      } catch (error) {
        // A refused request (4xx) still leaves the search; a network failure does not.
        if (!(error instanceof LrclibError) || error.status >= 500) throw error;
        this.options.onError?.('lrclib get', error);
      }
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
    const close = duration >= 1 ? synced.filter(r => gap(r) <= 10).sort((a, b) => gap(a) - gap(b)) : synced;
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
