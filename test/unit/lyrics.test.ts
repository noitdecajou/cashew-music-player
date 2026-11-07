import { describe, expect, it, vi } from 'vitest';
import type { LyricsState } from '../../src/shared/island';
import { type Fetcher, Lyrics, simplifyTitle } from '../../src/main/services/lyrics';

const track = { id: 'AAAAAAAAAAA', title: 'Song (Official Video)', artist: 'Artist', album: 'Album' };
const reply = (status: number, body: unknown) => ({ status, text: async () => JSON.stringify(body) });

function fake(routes: (url: URL) => { status: number; text(): Promise<string> }): { fetcher: Fetcher; urls: URL[] } {
  const urls: URL[] = [];
  return {
    urls,
    fetcher: async url => {
      const parsed = new URL(url);
      urls.push(parsed);
      return routes(parsed);
    },
  };
}

describe('LRCLIB lyrics', () => {
  it('asks /api/get with title, artist, album and duration', async () => {
    const { fetcher, urls } = fake(() => reply(200, { syncedLyrics: '[00:01.00] Hello' }));
    const state = await new Lyrics(fetcher, () => {}).fetchLyrics(track, 212.6);
    expect(state).toEqual({ trackId: track.id, status: 'synced', lines: [{ time: 1, text: 'Hello' }] });
    expect(urls[0]?.origin + urls[0]!.pathname).toBe('https://lrclib.net/api/get');
    expect(Object.fromEntries(urls[0]!.searchParams)).toEqual({
      track_name: 'Song (Official Video)',
      artist_name: 'Artist',
      album_name: 'Album',
      duration: '213',
    });
  });

  it('falls back to a search, keeping a close duration', async () => {
    const { fetcher, urls } = fake(url =>
      url.pathname.endsWith('/get')
        ? reply(404, {})
        : reply(200, [
            { duration: 300, syncedLyrics: '[00:01.00] Wrong' },
            { duration: 211, syncedLyrics: '[00:02.00] Right' },
          ]),
    );
    const state = await new Lyrics(fetcher, () => {}).fetchLyrics(track, 212);
    expect(state.lines).toEqual([{ time: 2, text: 'Right' }]);
    expect(urls[1]?.searchParams.get('track_name')).toBe('Song');
  });

  it('instrumental tracks and misses have no lyrics', async () => {
    const instrumental = fake(() => reply(200, { instrumental: true, syncedLyrics: null }));
    expect((await new Lyrics(instrumental.fetcher, () => {}).fetchLyrics(track, 200)).status).toBe('none');
    const miss = fake(url => (url.pathname.endsWith('/get') ? reply(404, {}) : reply(200, [])));
    expect((await new Lyrics(miss.fetcher, () => {}).fetchLyrics(track, 200)).status).toBe('none');
  });

  it('refuses oversized answers', async () => {
    const { fetcher } = fake(() => ({ status: 200, text: async () => 'x'.repeat(600 * 1024) }));
    await expect(new Lyrics(fetcher, () => {}).fetchLyrics(track, 200)).rejects.toThrow(/too large/);
  });

  it('simplifies titles for the search only', () => {
    expect(simplifyTitle('Song (feat. X) [Remastered 2011]')).toBe('Song');
    expect(simplifyTitle('Artist - Song (Official Video)', 'Artist')).toBe('Song');
    expect(simplifyTitle('Song - Remastered 2011', 'Artist')).toBe('Song');
    expect(simplifyTitle('(Intro)')).toBe('(Intro)');
  });
});

describe('lyrics requests', () => {
  it('nothing is fetched when the option is off', () => {
    const fetcher = vi.fn();
    const states: LyricsState[] = [];
    new Lyrics(fetcher, s => states.push(s)).show(track, 200, false);
    expect(fetcher).not.toHaveBeenCalled();
    expect(states).toEqual([{ trackId: track.id, status: 'off', lines: [] }]);
  });

  it('waits for the duration, fetches once, then serves the cache', async () => {
    const { fetcher, urls } = fake(() => reply(200, { syncedLyrics: '[00:01.00] Hi' }));
    const states: LyricsState[] = [];
    const lyrics = new Lyrics(fetcher, s => states.push(s), 20, 60);
    lyrics.show(track, 0, true);
    expect(states.at(-1)?.status).toBe('loading');
    expect(urls).toHaveLength(0);
    lyrics.show(track, 200, true);
    lyrics.show(track, 200, true);
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('synced'));
    expect(urls).toHaveLength(1);
    lyrics.show(null, 0, true);
    lyrics.show(track, 0, true);
    expect(states.at(-1)?.status).toBe('synced');
    expect(urls).toHaveLength(1);
    lyrics.dispose();
  });

  it('uses the duration reported after the track settles, not the first one', async () => {
    const { fetcher, urls } = fake(() => reply(200, { syncedLyrics: '[00:01.00] Hi' }));
    const lyrics = new Lyrics(fetcher, () => {}, 30, 60);
    lyrics.show(track, 0, true);
    lyrics.show(track, 185, true); // the previous track's duration, still reported
    await new Promise(r => setTimeout(r, 10));
    lyrics.show(track, 212, true);
    await vi.waitFor(() => expect(urls).toHaveLength(1));
    expect(urls[0]?.searchParams.get('duration')).toBe('212');
    lyrics.dispose();
  });

  it('a miss is tried again the next time the track plays; turning the option on fetches', async () => {
    let found = false;
    const { fetcher, urls } = fake(url =>
      found
        ? reply(200, { syncedLyrics: '[00:01.00] Hi' })
        : url.pathname.endsWith('/get')
          ? reply(404, {})
          : reply(200, []),
    );
    const states: LyricsState[] = [];
    const lyrics = new Lyrics(fetcher, s => states.push(s), 0, 0);
    lyrics.show(track, 200, true);
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('none'));
    found = true;
    lyrics.show({ ...track, id: 'BBBBBBBBBBB' }, 0, false);
    lyrics.show(track, 200, true);
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('synced'));
    lyrics.show(track, 200, false);
    expect(states.at(-1)?.status).toBe('off');
    const before = urls.length;
    lyrics.show(track, 200, true);
    expect(states.at(-1)?.status).toBe('synced'); // from the cache
    expect(urls).toHaveLength(before);
    lyrics.dispose();
  });

  it('searches without the duration when it does not come', async () => {
    const { fetcher, urls } = fake(() => reply(200, [{ duration: 100, syncedLyrics: '[00:01.00] Hi' }]));
    const states: LyricsState[] = [];
    const lyrics = new Lyrics(fetcher, s => states.push(s), 10, 20);
    lyrics.show(track, 0, true);
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('synced'));
    expect(urls.map(u => u.pathname)).toEqual(['/api/search']);
    lyrics.dispose();
  });

  it('a network error shows the title (no lyrics), without retrying the same track', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('offline');
    });
    const states: LyricsState[] = [];
    const lyrics = new Lyrics(fetcher, s => states.push(s), 10, 20);
    lyrics.show(track, 200, true);
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('none'));
    lyrics.show(track, 200, true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('a late answer for a previous track is not shown', async () => {
    let release: () => void = () => {};
    const slow: Fetcher = () =>
      new Promise(resolve => {
        release = () => resolve(reply(200, { syncedLyrics: '[00:01.00] Old' }));
      });
    const states: LyricsState[] = [];
    const lyrics = new Lyrics(slow, s => states.push(s), 0, 0);
    lyrics.show(track, 200, true);
    await new Promise(r => setTimeout(r, 5));
    lyrics.show({ ...track, id: 'BBBBBBBBBBB' }, 0, false);
    release();
    await new Promise(r => setTimeout(r, 10));
    expect(states.at(-1)).toEqual({ trackId: 'BBBBBBBBBBB', status: 'off', lines: [] });
  });
});
