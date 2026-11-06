import { describe, expect, it } from 'vitest';
import { sanitizeAgentMessage, sanitizeCommand } from '../../src/shared/player';

describe('sanitizeAgentMessage', () => {
  it('keeps a valid snapshot and drops unknown fields', () => {
    const message = sanitizeAgentMessage({
      kind: 'snapshot',
      snapshot: {
        status: 'playing',
        evil: true,
        track: {
          id: 'dQw4w9WgXcQ',
          title: 'T',
          artist: 'A',
          album: '',
          artwork: 'https://i.ytimg.com/x.jpg',
          extra: 1,
        },
        next: { title: 'N', artist: 'B' },
        shuffle: false,
        repeat: 'ALL',
        like: 'LIKE',
        volume: 42.4,
        muted: false,
        signedIn: true,
      },
    });
    expect(message).toEqual({
      kind: 'snapshot',
      snapshot: {
        status: 'playing',
        track: {
          id: 'dQw4w9WgXcQ',
          title: 'T',
          artist: 'A',
          album: '',
          artwork: 'https://i.ytimg.com/x.jpg',
          playlistId: '',
        },
        next: { title: 'N', artist: 'B' },
        shuffle: false,
        repeat: 'ALL',
        like: 'LIKE',
        volume: 42,
        muted: false,
        signedIn: true,
        accountKey: '',
      },
    });
  });

  it('rejects non-https artwork, bad ids and out-of-range values', () => {
    const message = sanitizeAgentMessage({
      kind: 'snapshot',
      snapshot: { status: 'hacked', track: { id: 'x', title: 'T' }, volume: 900, repeat: 'SOMETIMES' },
    });
    expect(message?.kind === 'snapshot' && message.snapshot).toMatchObject({
      status: 'idle',
      track: null,
      volume: 100,
      repeat: null,
    });
    const art = sanitizeAgentMessage({
      kind: 'snapshot',
      snapshot: { track: { id: 'dQw4w9WgXcQ', artwork: 'javascript:alert(1)' } },
    });
    expect(art?.kind === 'snapshot' && art.snapshot.track?.artwork).toBe('');
  });

  it('bounds the clock by its duration and requires a track id', () => {
    expect(
      sanitizeAgentMessage({ kind: 'progress', progress: { trackId: 'dQw4w9WgXcQ', position: 500, duration: 200 } }),
    ).toEqual({ kind: 'progress', progress: { trackId: 'dQw4w9WgXcQ', position: 200, duration: 200 } });
    expect(sanitizeAgentMessage({ kind: 'progress', progress: { trackId: '', position: 1, duration: 2 } })).toBeNull();
    expect(sanitizeAgentMessage({ kind: 'other' })).toBeNull();
    expect(sanitizeAgentMessage('snapshot')).toBeNull();
  });
});

describe('sanitizeCommand', () => {
  it('accepts known commands and clamps volume', () => {
    expect(sanitizeCommand({ type: 'next', extra: 1 })).toEqual({ type: 'next' });
    expect(sanitizeCommand({ type: 'volume', volume: 140 })).toEqual({ type: 'volume', volume: 100 });
    expect(sanitizeCommand({ type: 'seek', trackId: 'dQw4w9WgXcQ', position: 12.5 })).toEqual({
      type: 'seek',
      trackId: 'dQw4w9WgXcQ',
      position: 12.5,
    });
  });
  it('refuses the rest, including the internal progress-stream command', () => {
    for (const raw of [
      null,
      {},
      { type: 'seek', trackId: 'bad', position: 1 },
      { type: 'seek', trackId: 'dQw4w9WgXcQ', position: -1 },
      { type: 'volume', volume: Number.NaN },
      { type: 'mute', muted: 'yes' },
      { type: 'progress-stream', enabled: false },
      { type: 'queue-watch', enabled: true },
      { type: 'op', id: 1, op: 'resume', payload: {} },
    ]) {
      expect(sanitizeCommand(raw)).toBeNull();
    }
  });
});
