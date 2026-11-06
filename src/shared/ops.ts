// Operations main asks the page agent to perform, and validation of their
// results (the page is not trusted).
import { ACCOUNT_KEY, PLAYLIST_ID, VIDEO_ID, httpsUrl, str } from './player';

export interface Song {
  videoId: string;
  title: string;
  artist: string;
  artwork: string;
}
export interface Playlist {
  id: string;
  title: string;
  subtitle: string;
  artwork: string;
}
export interface Page<T> {
  items: T[];
  continuation: string;
}

export interface OpMap {
  'library-playlists': { payload: { continuation?: string }; result: Page<Playlist> };
  'playlist-songs': { payload: { browseId: string; continuation?: string }; result: Page<Song> };
  search: { payload: { query: string }; result: Page<Song> };
  play: { payload: { videoId?: string; playlistId?: string }; result: { ok: true } };
  'queue-play': { payload: { index: number; videoId: string }; result: { ok: true } };
  'queue-remove': { payload: { index: number; videoId: string }; result: { ok: true } };
  'queue-insert-next': { payload: { videoId: string }; result: { ok: true } };
  resume: { payload: { videoId: string; playlistId: string; position: number }; result: { ok: true } };
  session: {
    payload: Record<string, never>;
    result: { accountKey: string; videoId: string; playlistId: string; position: number };
  };
}
export type OpName = keyof OpMap;

const continuation = (value: unknown): string => {
  const token = str(value, 4000);
  return /^[\w%=+/-]*$/.test(token) ? token : '';
};

function song(raw: unknown): Song | null {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (!VIDEO_ID.test(str(s.videoId))) return null;
  return { videoId: str(s.videoId), title: str(s.title), artist: str(s.artist), artwork: httpsUrl(s.artwork) };
}

function page<T>(raw: unknown, item: (value: unknown) => T | null, max = 1000): Page<T> {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (!Array.isArray(r.items)) throw new Error('Réponse de YouTube Music non reconnue.');
  return {
    items: r.items
      .slice(0, max)
      .map(item)
      .filter((v): v is T => v !== null),
    continuation: continuation(r.continuation),
  };
}

const ok = (): { ok: true } => ({ ok: true });

export const OP_RESULTS: { [K in OpName]: (raw: unknown) => OpMap[K]['result'] } = {
  'library-playlists': raw =>
    page(raw, value => {
      const p = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
      if (!PLAYLIST_ID.test(str(p.id))) return null;
      return {
        id: str(p.id),
        title: str(p.title) || 'Playlist',
        subtitle: str(p.subtitle),
        artwork: httpsUrl(p.artwork),
      };
    }),
  'playlist-songs': raw => page(raw, song),
  search: raw => page(raw, song, 50),
  play: ok,
  'queue-play': ok,
  'queue-remove': ok,
  'queue-insert-next': ok,
  resume: ok,
  session: raw => {
    const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const position =
      typeof s.position === 'number' && Number.isFinite(s.position) ? Math.min(86400, Math.max(0, s.position)) : 0;
    return {
      accountKey: ACCOUNT_KEY.test(str(s.accountKey)) ? str(s.accountKey) : '',
      videoId: VIDEO_ID.test(str(s.videoId)) ? str(s.videoId) : '',
      playlistId: PLAYLIST_ID.test(str(s.playlistId)) ? str(s.playlistId) : '',
      position,
    };
  },
};
