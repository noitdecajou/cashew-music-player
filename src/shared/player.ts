// State published by the YouTube Music page agent. The agent is the only
// writer; main validates it and forwards it unchanged to the shell.

export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'buffering' | 'ended';
export type RepeatMode = 'NONE' | 'ALL' | 'ONE';
export type LikeStatus = 'LIKE' | 'DISLIKE' | 'INDIFFERENT';

export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  artwork: string;
  /** Playlist the track is played from ('' when unknown): used to resume. */
  playlistId: string;
}

export interface UpNext {
  title: string;
  artist: string;
}

/** Everything except the clock. Sent only when something changes. */
export interface PlayerSnapshot {
  status: PlaybackStatus;
  track: Track | null;
  next: UpNext | null;
  shuffle: boolean | null;
  repeat: RepeatMode | null;
  like: LikeStatus | null;
  volume: number; // 0..100
  muted: boolean;
  signedIn: boolean | null;
  /** SHA-256 of the account id ('' when signed out): scopes caches and resume. */
  accountKey: string;
}

/** The clock. Always tagged with the track it belongs to. */
export interface PlayerProgress {
  trackId: string;
  position: number; // seconds
  duration: number; // seconds, 0 when unknown
}

export const EMPTY_SNAPSHOT: PlayerSnapshot = {
  status: 'idle',
  track: null,
  next: null,
  shuffle: null,
  repeat: null,
  like: null,
  volume: 100,
  muted: false,
  signedIn: null,
  accountKey: '',
};

export interface QueueItem {
  videoId: string;
  title: string;
  artist: string;
  artwork: string;
  duration: string; // "3:45" as displayed by Music
}

export interface QueueState {
  items: QueueItem[];
  current: number; // index of the playing item, -1 when unknown
}

export type PlayerCommand =
  | { type: 'toggle-play' }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'shuffle' }
  | { type: 'repeat' }
  | { type: 'seek'; trackId: string; position: number }
  | { type: 'volume'; volume: number }
  | { type: 'mute'; muted: boolean }
  | { type: 'progress-stream'; enabled: boolean }
  | { type: 'queue-watch'; enabled: boolean }
  /** Show YouTube Music's player page on its Lyrics tab (cashew's lyrics take it over). */
  | { type: 'open-lyrics' }
  | { type: 'op'; id: number; op: string; payload: unknown };

/** Messages the page agent sends to main. */
export type AgentMessage =
  | { kind: 'snapshot'; snapshot: PlayerSnapshot }
  | { kind: 'progress'; progress: PlayerProgress }
  | { kind: 'queue'; queue: QueueState }
  | { kind: 'op-result'; id: number; ok: boolean; value: unknown; error: string }
  | { kind: 'ready' }
  /** The lyrics host of the YouTube Music page is (re)loaded: send it the lyrics. */
  | { kind: 'lyrics-host' }
  /** cashew's lyrics are shown in the page (Lyrics tab or immersive view), or no longer. */
  | { kind: 'lyrics-view'; open: boolean; immersive: boolean }
  /** Per-track lyrics correction from the page's lyrics footer. */
  | { kind: 'lyrics-offset'; delta: number };

export const VIDEO_ID = /^[\w-]{11}$/;
export const PLAYLIST_ID = /^[\w-]{2,200}$/;
export const ACCOUNT_KEY = /^[a-f0-9]{64}$/;
export const str = (value: unknown, max = 500): string => (typeof value === 'string' ? value.slice(0, max) : '');
const num = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): T | null =>
  allowed.includes(value as T) ? (value as T) : null;
const bool = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null);

export function httpsUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2000) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

/** The page is not trusted: validate shape and bounds of every field. */
export function sanitizeAgentMessage(raw: unknown): AgentMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const message = raw as Record<string, unknown>;
  if (message.kind === 'ready') return { kind: 'ready' };
  if (message.kind === 'lyrics-host') return { kind: 'lyrics-host' };
  if (message.kind === 'lyrics-view')
    return { kind: 'lyrics-view', open: message.open === true, immersive: message.immersive === true };
  if (message.kind === 'lyrics-offset')
    return message.delta === 0.5 || message.delta === -0.5 ? { kind: 'lyrics-offset', delta: message.delta } : null;
  if (message.kind === 'op-result') {
    if (!Number.isSafeInteger(message.id)) return null;
    // The value is validated by the caller, per operation (see shared/ops.ts).
    return {
      kind: 'op-result',
      id: message.id as number,
      ok: message.ok === true,
      value: message.value,
      error: str(message.error, 300),
    };
  }
  if (message.kind === 'queue') return { kind: 'queue', queue: sanitizeQueue(message.queue) };
  if (message.kind === 'progress') {
    const p = message.progress as Record<string, unknown> | undefined;
    if (!p || !VIDEO_ID.test(str(p.trackId))) return null;
    const duration = num(p.duration, 0, 86400, 0);
    return {
      kind: 'progress',
      progress: { trackId: str(p.trackId), duration, position: num(p.position, 0, duration || 86400, 0) },
    };
  }
  if (message.kind === 'snapshot') {
    const s = message.snapshot as Record<string, unknown> | undefined;
    if (!s) return null;
    const t = s.track as Record<string, unknown> | null | undefined;
    const n = s.next as Record<string, unknown> | null | undefined;
    const track: Track | null =
      t && VIDEO_ID.test(str(t.id))
        ? {
            id: str(t.id),
            title: str(t.title),
            artist: str(t.artist),
            album: str(t.album),
            artwork: httpsUrl(t.artwork),
            playlistId: PLAYLIST_ID.test(str(t.playlistId)) ? str(t.playlistId) : '',
          }
        : null;
    return {
      kind: 'snapshot',
      snapshot: {
        status: oneOf(s.status, ['idle', 'loading', 'playing', 'paused', 'buffering', 'ended'] as const) ?? 'idle',
        track,
        next: n && str(n.title) ? { title: str(n.title), artist: str(n.artist) } : null,
        shuffle: bool(s.shuffle),
        repeat: oneOf(s.repeat, ['NONE', 'ALL', 'ONE'] as const),
        like: oneOf(s.like, ['LIKE', 'DISLIKE', 'INDIFFERENT'] as const),
        volume: Math.round(num(s.volume, 0, 100, 100)),
        muted: s.muted === true,
        signedIn: bool(s.signedIn),
        accountKey: ACCOUNT_KEY.test(str(s.accountKey)) ? str(s.accountKey) : '',
      },
    };
  }
  return null;
}

export function sanitizeQueue(raw: unknown): QueueState {
  const q = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const items = (Array.isArray(q.items) ? q.items : []).slice(0, 500).flatMap((value): QueueItem[] => {
    const i = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
    if (!VIDEO_ID.test(str(i.videoId))) return [];
    return [
      {
        videoId: str(i.videoId),
        title: str(i.title),
        artist: str(i.artist),
        artwork: httpsUrl(i.artwork),
        duration: str(i.duration, 12),
      },
    ];
  });
  const current =
    Number.isInteger(q.current) && (q.current as number) >= 0 && (q.current as number) < items.length
      ? (q.current as number)
      : -1;
  return { items, current };
}

/** Commands come from the shell renderer: validate before forwarding to the page. */
export function sanitizeCommand(raw: unknown): PlayerCommand | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  switch (c.type) {
    case 'toggle-play':
    case 'play':
    case 'pause':
    case 'next':
    case 'previous':
    case 'shuffle':
    case 'repeat':
      return { type: c.type };
    case 'seek':
      if (
        !VIDEO_ID.test(str(c.trackId)) ||
        typeof c.position !== 'number' ||
        !Number.isFinite(c.position) ||
        c.position < 0
      )
        return null;
      return { type: 'seek', trackId: str(c.trackId), position: Math.min(c.position, 86400) };
    case 'volume':
      if (typeof c.volume !== 'number' || !Number.isFinite(c.volume)) return null;
      return { type: 'volume', volume: Math.round(Math.min(100, Math.max(0, c.volume))) };
    case 'mute':
      return typeof c.muted === 'boolean' ? { type: 'mute', muted: c.muted } : null;
    default:
      return null;
  }
}
