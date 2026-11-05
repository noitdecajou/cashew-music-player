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
}

/** The clock. Always tagged with the track it belongs to. */
export interface PlayerProgress {
  trackId: string;
  position: number; // seconds
  duration: number; // seconds, 0 when unknown
}

export const EMPTY_SNAPSHOT: PlayerSnapshot = {
  status: 'idle', track: null, next: null, shuffle: null, repeat: null, like: null,
  volume: 100, muted: false, signedIn: null,
};

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
  | { type: 'progress-stream'; enabled: boolean };

/** Messages the page agent sends to main. */
export type AgentMessage =
  | { kind: 'snapshot'; snapshot: PlayerSnapshot }
  | { kind: 'progress'; progress: PlayerProgress }
  | { kind: 'ready' };

const VIDEO_ID = /^[\w-]{11}$/;
const str = (value: unknown, max = 500): string => (typeof value === 'string' ? value.slice(0, max) : '');
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
  if (message.kind === 'progress') {
    const p = message.progress as Record<string, unknown> | undefined;
    if (!p || !VIDEO_ID.test(str(p.trackId))) return null;
    const duration = num(p.duration, 0, 86400, 0);
    return { kind: 'progress', progress: { trackId: str(p.trackId), duration, position: num(p.position, 0, duration || 86400, 0) } };
  }
  if (message.kind === 'snapshot') {
    const s = message.snapshot as Record<string, unknown> | undefined;
    if (!s) return null;
    const t = s.track as Record<string, unknown> | null | undefined;
    const n = s.next as Record<string, unknown> | null | undefined;
    const track: Track | null = t && VIDEO_ID.test(str(t.id))
      ? { id: str(t.id), title: str(t.title), artist: str(t.artist), album: str(t.album), artwork: httpsUrl(t.artwork) }
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
      },
    };
  }
  return null;
}

/** Commands come from the shell renderer: validate before forwarding to the page. */
export function sanitizeCommand(raw: unknown): PlayerCommand | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  switch (c.type) {
    case 'toggle-play': case 'play': case 'pause': case 'next': case 'previous': case 'shuffle': case 'repeat':
      return { type: c.type };
    case 'seek':
      if (!VIDEO_ID.test(str(c.trackId)) || typeof c.position !== 'number' || !Number.isFinite(c.position) || c.position < 0) return null;
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
