import { describe, expect, it } from 'vitest';
import { parseSession, resumeState } from '../../src/main/services/resume';
import { normalizeShortcut } from '../../src/main/services/shortcut';
import { OP_RESULTS } from '../../src/shared/ops';
import { sanitizeAgentMessage, sanitizeQueue } from '../../src/shared/player';

describe('shortcut', () => {
  it('normalizes the modifier order and refuses unsafe combinations', () => {
    expect(normalizeShortcut('Alt+Ctrl+M')).toBe('Ctrl+Alt+M');
    expect(normalizeShortcut('Shift+Super+F5')).toBe('Shift+Super+F5');
    expect(normalizeShortcut('')).toBe('');
    for (const bad of ['M', 'Shift+M', 'Ctrl+Ctrl+M', 'Ctrl+Escape', 'Hyper+M', 42]) expect(normalizeShortcut(bad)).toBeNull();
  });
});

describe('resume', () => {
  it('validates saved sessions', () => {
    expect(parseSession({ videoId: 'dQw4w9WgXcQ', playlistId: 'PLx', position: 99999, title: 'T', artwork: 'http://x' }))
      .toMatchObject({ videoId: 'dQw4w9WgXcQ', playlistId: 'PLx', position: 86400, artwork: '' });
    expect(parseSession({ videoId: '../../etc' })).toBeNull();
    expect(resumeState(null, true, 'x')).toMatchObject({ available: false, busy: false });
  });
});

describe('page results', () => {
  it('validates each operation result', () => {
    expect(OP_RESULTS.search({ items: [{ videoId: 'dQw4w9WgXcQ', title: 'T', artist: 'A', artwork: 'javascript:x' }, { videoId: 'bad' }], continuation: 'x y' }))
      .toEqual({ items: [{ videoId: 'dQw4w9WgXcQ', title: 'T', artist: 'A', artwork: '' }], continuation: '' });
    expect(() => OP_RESULTS['playlist-songs']({ nope: true })).toThrow();
    expect(OP_RESULTS['library-playlists']({ items: [{ id: 'VLPL1', title: '' }, { id: '<script>' }], continuation: 'abc%3D' }))
      .toEqual({ items: [{ id: 'VLPL1', title: 'Playlist', subtitle: '', artwork: '' }], continuation: 'abc%3D' });
    expect(OP_RESULTS.session({ accountKey: 'nope', videoId: 'dQw4w9WgXcQ', position: -5 })).toEqual({ accountKey: '', videoId: 'dQw4w9WgXcQ', playlistId: '', position: 0 });
  });

  it('validates queue messages and op results envelopes', () => {
    expect(sanitizeQueue({ items: [{ videoId: 'dQw4w9WgXcQ', title: 'T' }, { videoId: 'x' }], current: 5 })).toEqual({
      items: [{ videoId: 'dQw4w9WgXcQ', title: 'T', artist: '', artwork: '', duration: '' }], current: -1 });
    expect(sanitizeAgentMessage({ kind: 'op-result', id: 'x' })).toBeNull();
    expect(sanitizeAgentMessage({ kind: 'op-result', id: 3, ok: false, error: 'non' })).toMatchObject({ kind: 'op-result', id: 3, ok: false, error: 'non' });
  });
});
