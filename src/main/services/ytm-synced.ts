// YouTube Music's own synced lyrics, when it has them (as Pear Desktop reads
// them): the track's lyrics page (`MPLY…`, from /next), asked as the mobile
// app does, carries time-stamped lines for some tracks ("timedLyricsModel").
// Anonymous requests (no cookies) to music.youtube.com only. Often only the
// plain text is given ("staticLayout"): then nothing is returned and LRCLIB is
// asked instead.

import type { LyricLine } from '../../shared/island';

const API = 'https://music.youtube.com/youtubei/v1';
const WEB_CLIENT = { clientName: 'WEB_REMIX', clientVersion: '1.20241111.01.00', hl: 'en' };
const MOBILE_CLIENT = { clientName: 'IOS_MUSIC', clientVersion: '7.27.52', hl: 'en' };
const MOBILE_AGENT = 'com.google.ios.youtubemusic/7.27.52 (iPhone16,2; U; CPU iOS 17_5 like Mac OS X;)';
const MAX_BODY = 2 * 1024 * 1024;
const MAX_LINES = 400;

export type PostJson = (url: string, body: unknown, headers: Record<string, string>) => Promise<unknown>;

export interface YtmSynced {
  lines: LyricLine[];
  /** "Musixmatch", "LyricFind"… */
  source: string;
}

/** The lyrics page id from a /next response ('' when the track has none). */
export function lyricsBrowseId(next: unknown): string {
  const tabs = (next as any)?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer
    ?.watchNextTabbedResultsRenderer?.tabs;
  if (!Array.isArray(tabs)) return '';
  for (const tab of tabs) {
    const endpoint = tab?.tabRenderer?.endpoint?.browseEndpoint;
    const type = endpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
    if (type === 'MUSIC_PAGE_TYPE_TRACK_LYRICS' && typeof endpoint.browseId === 'string')
      return /^MPLY[\w-]{1,100}$/.test(endpoint.browseId) ? endpoint.browseId : '';
  }
  return '';
}

/** Time-stamped lines from a /browse response of the lyrics page; null without timing. */
export function parseTimedLyrics(browse: unknown): YtmSynced | null {
  const data = (browse as any)?.contents?.elementRenderer?.newElement?.type?.componentType?.model?.timedLyricsModel
    ?.lyricsData;
  const raw = data?.timedLyricsData;
  if (!Array.isArray(raw) || !raw.length) return null;
  const lines: LyricLine[] = [];
  for (const item of raw.slice(0, MAX_LINES)) {
    const start = Number(item?.cueRange?.startTimeMilliseconds);
    if (!Number.isFinite(start) || start < 0) return null; // no timing: plain text only
    const text = typeof item?.lyricLine === 'string' ? item.lyricLine.trim().slice(0, 200) : '';
    lines.push({ time: start / 1000, text: text === '♪' ? '' : text });
  }
  lines.sort((a, b) => a.time - b.time);
  // All lines at 0: not really synced.
  if (lines.length > 1 && lines.every(line => line.time === lines[0]?.time)) return null;
  const message = typeof data?.sourceMessage === 'string' ? data.sourceMessage : '';
  return { lines, source: message.replace(/^Source\s*:\s*/i, '').slice(0, 60) };
}

export async function fetchYtmSynced(post: PostJson, videoId: string): Promise<YtmSynced | null> {
  if (!/^[\w-]{11}$/.test(videoId)) return null;
  const next = await post(`${API}/next?prettyPrint=false`, { videoId, context: { client: WEB_CLIENT } }, {});
  const browseId = lyricsBrowseId(next);
  if (!browseId) return null;
  const browse = await post(
    `${API}/browse?prettyPrint=false`,
    { browseId, context: { client: MOBILE_CLIENT } },
    { 'User-Agent': MOBILE_AGENT },
  );
  return parseTimedLyrics(browse);
}

/** A JSON POST through Electron's network stack (no cookies: the default session). */
export function netPost(fetch: (url: string, init: RequestInit) => Promise<Response>): PostJson {
  return async (url, body, headers) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    if (response.status !== 200) throw new Error(`youtube music ${response.status}`);
    const text = await response.text();
    if (text.length > MAX_BODY) throw new Error('youtube music: response too large');
    return JSON.parse(text);
  };
}
