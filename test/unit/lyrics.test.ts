import { describe, expect, it, vi } from 'vitest';
import type { LyricsState } from '../../src/shared/island';
import { type Fetcher, Lyrics, simplifyTitle } from '../../src/main/services/lyrics';
import { fetchYtmSynced, lyricsBrowseId, parseTimedLyrics } from '../../src/main/services/ytm-synced';

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
    expect(state).toEqual({
      trackId: track.id,
      status: 'synced',
      lines: [{ time: 1, text: 'Hello' }],
      source: 'LRCLIB',
    });
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

  it('a network error is logged and tried once more, then shows the title (no further retry)', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('offline');
    });
    const states: LyricsState[] = [];
    const errors: string[] = [];
    const lyrics = new Lyrics(fetcher, s => states.push(s), 10, 20, undefined, {
      retryMs: 10,
      onError: source => errors.push(source),
    });
    lyrics.show(track, 200, true);
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('none'));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(errors).toEqual(['lrclib', 'lrclib']);
    lyrics.show(track, 200, true);
    await new Promise(r => setTimeout(r, 30));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("YouTube Music's own synced lyrics are asked first; LRCLIB when it has none or fails", async () => {
    const { fetcher, urls } = fake(() => reply(200, { syncedLyrics: '[00:01.00] From LRCLIB' }));
    const ytm = new Lyrics(fetcher, () => {}, 0, 0, undefined, {
      first: async () => ({ lines: [{ time: 2, text: 'From YouTube Music' }], source: 'Musixmatch' }),
    });
    expect(await ytm.fetchLyrics(track, 200)).toEqual({
      trackId: track.id,
      status: 'synced',
      lines: [{ time: 2, text: 'From YouTube Music' }],
      source: 'YouTube Music · Musixmatch',
    });
    expect(urls).toHaveLength(0);
    const errors: string[] = [];
    const failing = new Lyrics(fetcher, () => {}, 0, 0, undefined, {
      first: async () => {
        throw new Error('blocked');
      },
      onError: source => errors.push(source),
    });
    expect((await failing.fetchLyrics(track, 200)).source).toBe('LRCLIB');
    expect(errors).toEqual(['youtube music']);
    const none = new Lyrics(fetcher, () => {}, 0, 0, undefined, { first: async () => null });
    expect((await none.fetchLyrics(track, 200)).lines[0]?.text).toBe('From LRCLIB');
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

describe('lyrics kept on disk', () => {
  it('seeded lyrics are served without a request; new ones are reported', async () => {
    const { fetcher, urls } = fake(() => reply(200, { syncedLyrics: '[00:01.00] New' }));
    const states: LyricsState[] = [];
    let learned = 0;
    const lyrics = new Lyrics(
      fetcher,
      s => states.push(s),
      0,
      0,
      () => learned++,
    );
    lyrics.seed([{ trackId: track.id, status: 'synced', lines: [{ time: 1, text: 'Saved' }] }]);
    lyrics.show(track, 200, true);
    expect(states.at(-1)?.lines[0]?.text).toBe('Saved');
    expect(urls).toHaveLength(0);
    lyrics.show({ ...track, id: 'BBBBBBBBBBB' }, 200, true);
    await vi.waitFor(() => expect(learned).toBe(1));
    expect(lyrics.cached().map(s => s.trackId)).toEqual([track.id, 'BBBBBBBBBBB']);
    lyrics.dispose();
  });
});

describe('lyrics lookups: robust to early and refused requests', () => {
  it('waits for the title and uses the latest details of the track', async () => {
    const { fetcher, urls } = fake(() => reply(200, { syncedLyrics: '[00:01.00] Hello' }));
    const states: LyricsState[] = [];
    const lyrics = new Lyrics(fetcher, s => states.push(s), 0, 0);
    lyrics.show({ ...track, title: '', artist: '' }, 200, true, true);
    await new Promise(r => setTimeout(r, 20));
    expect(urls).toHaveLength(0);
    lyrics.show(track, 200, true, true);
    await vi.waitFor(() => expect(states.at(-1)?.status).toBe('synced'));
    expect(urls[0]?.searchParams.get('track_name')).toBe(track.title);
    lyrics.dispose();
  });

  it('a refused exact request (4xx) still searches; no exact request without a duration', async () => {
    const { fetcher, urls } = fake(url =>
      url.pathname.endsWith('/get') ? reply(400, {}) : reply(200, [{ duration: 200, syncedLyrics: '[00:01.00] Hi' }]),
    );
    const errors: string[] = [];
    const lyrics = new Lyrics(fetcher, () => {}, 0, 0, undefined, { onError: source => errors.push(source) });
    expect((await lyrics.fetchLyrics(track, 200)).lines[0]?.text).toBe('Hi');
    expect(errors).toEqual(['lrclib get']);
    urls.length = 0;
    await lyrics.fetchLyrics(track, 0.4);
    expect(urls.map(u => u.pathname)).toEqual(['/api/search']);
  });
});

describe("YouTube Music's synced lyrics", () => {
  const next = {
    contents: {
      singleColumnMusicWatchNextResultsRenderer: {
        tabbedRenderer: {
          watchNextTabbedResultsRenderer: {
            tabs: [
              { tabRenderer: { title: 'Up next' } },
              {
                tabRenderer: {
                  endpoint: {
                    browseEndpoint: {
                      browseId: 'MPLYt_abc',
                      browseEndpointContextSupportedConfigs: {
                        browseEndpointContextMusicConfig: { pageType: 'MUSIC_PAGE_TYPE_TRACK_LYRICS' },
                      },
                    },
                  },
                },
              },
            ],
          },
        },
      },
    },
  };
  const browse = (lines: unknown[]) => ({
    contents: {
      elementRenderer: {
        newElement: {
          type: {
            componentType: {
              model: {
                timedLyricsModel: { lyricsData: { timedLyricsData: lines, sourceMessage: 'Source: Musixmatch' } },
              },
            },
          },
        },
      },
    },
  });

  it('finds the lyrics page and reads time-stamped lines', async () => {
    expect(lyricsBrowseId(next)).toBe('MPLYt_abc');
    expect(lyricsBrowseId({})).toBe('');
    const timed = browse([
      { lyricLine: 'Two', cueRange: { startTimeMilliseconds: '2500', endTimeMilliseconds: '4000' } },
      { lyricLine: '♪', cueRange: { startTimeMilliseconds: '1000', endTimeMilliseconds: '2500' } },
    ]);
    expect(parseTimedLyrics(timed)).toEqual({
      lines: [
        { time: 1, text: '' },
        { time: 2.5, text: 'Two' },
      ],
      source: 'Musixmatch',
    });
    const posts: string[] = [];
    const found = await fetchYtmSynced(async (url, body) => {
      posts.push(`${url.split('/').pop()} ${JSON.stringify(body).includes('IOS_MUSIC')}`);
      return url.includes('/next') ? next : timed;
    }, 'AAAAAAAAAAA');
    expect(found?.lines).toHaveLength(2);
    expect(posts).toEqual(['next?prettyPrint=false false', 'browse?prettyPrint=false true']);
  });

  it('plain text only (no timing), or nothing: no synced lyrics', async () => {
    expect(parseTimedLyrics(browse([{ lyricLine: 'No timing' }]))).toBeNull();
    expect(parseTimedLyrics(browse([]))).toBeNull();
    expect(parseTimedLyrics({ contents: { sectionListRenderer: {} } })).toBeNull();
    expect(await fetchYtmSynced(async () => ({}), 'AAAAAAAAAAA')).toBeNull();
    expect(await fetchYtmSynced(async () => next, 'not an id')).toBeNull();
  });
});
