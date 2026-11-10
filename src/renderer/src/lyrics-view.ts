// Lyrics panel of the mini-player (the large player shows them in YouTube
// Music's own Lyrics tab: src/preload/ytm-lyrics.ts). Synced lyrics from the
// shared renderer; otherwise YouTube Music's own (plain) lyrics, or a status.

import '../../shared/lyrics.css';
import { type LyricsState, estimatePosition } from '../../shared/island';
import { createLyricsLines } from '../../shared/lyrics-renderer';
import type { PlayerProgress, PlayerSnapshot } from '../../shared/player';
import { $, setText } from './dom';

export interface LyricsView {
  /** The panel is shown. */
  setOpen(open: boolean): void;
}

export function setupLyricsView(): LyricsView {
  const api = window.player;
  const section = $('section[data-panel="lyrics"]');
  const scroll = $('.lyrics-scroll', section);
  const plain = $('.lyrics-plain', section);
  const status = $('.lyrics-status', section);

  let snapshot: PlayerSnapshot | null = null;
  let progress: PlayerProgress | null = null;
  let progressAt = 0;
  let lyrics: LyricsState | null = null;
  let open = false;

  const playing = (): boolean => snapshot?.status === 'playing';
  const current = (): LyricsState | null =>
    lyrics && snapshot?.track && lyrics.trackId === snapshot.track.id ? lyrics : null;

  const lines = createLyricsLines({
    scroller: scroll,
    playing,
    now: () =>
      progress && progress.trackId === snapshot?.track?.id
        ? estimatePosition(progress, performance.now() - progressAt, playing())
        : 0,
    seek: time => {
      const track = snapshot?.track;
      if (track)
        api.command({ type: 'seek', trackId: track.id, position: Math.max(0, time + (current()?.offset ?? 0)) });
    },
  });
  scroll.insertBefore(lines.element, plain);

  /** What to show: synced lines, plain text, or a status message. */
  function show(): void {
    const track = snapshot?.track ?? null;
    setText($('.lyrics-title', section), track?.title ?? '');
    setText($('.lyrics-artist', section), track ? [track.artist, track.album].filter(Boolean).join(' · ') : '');
    const art = $<HTMLImageElement>('.lyrics-art', section);
    if (track?.artwork && art.getAttribute('src') !== track.artwork) art.src = track.artwork;
    const state = current();
    const synced = state?.status === 'synced' && state.lines.length > 0;
    section.classList.toggle('synced', synced);
    lines.element.hidden = !synced;
    if (synced && state) lines.set(`${state.trackId}:${state.lines.length}`, state.lines, state.offset ?? 0);
    lines.run(open && synced);
    plain.hidden = state?.status !== 'plain';
    setText(plain, state?.status === 'plain' ? (state.plain ?? '') : '');
    setText(
      status,
      !track
        ? 'Aucun morceau en lecture.'
        : !state || state.status === 'loading'
          ? 'Recherche des paroles…'
          : state.status === 'none' || state.status === 'off'
            ? 'Pas de paroles pour ce morceau.'
            : state.status === 'plain'
              ? 'Pas de paroles synchronisées pour ce morceau : voici le texte de YouTube Music, sans défilement.'
              : '',
    );
    setText($('.lyrics-source', section), state?.source ? `Paroles : ${state.source}` : '');
    const o = state?.offset ?? 0;
    $('.lyrics-offset', section).hidden = !synced;
    setText(
      $('.lyrics-offset-value', section),
      o ? `${o > 0 ? '+' : '−'}${Math.abs(o).toFixed(1).replace('.', ',')} s` : 'calées',
    );
  }

  for (const button of section.querySelectorAll<HTMLButtonElement>('[data-shift]'))
    button.addEventListener('click', () => api.islandLyricsOffset(Number(button.dataset.shift)));

  api.on('player:snapshot', value => {
    const changed = value.track?.id !== snapshot?.track?.id;
    snapshot = value;
    if (changed) show();
    else lines.update();
  });
  api.on('player:progress', value => {
    progress = value;
    progressAt = performance.now();
    lines.update();
  });
  api.on('lyrics:state', value => {
    lyrics = value;
    show();
  });

  return {
    setOpen(value) {
      open = value;
      show();
      if (value) scroll.focus({ preventScroll: true });
    },
  };
}
