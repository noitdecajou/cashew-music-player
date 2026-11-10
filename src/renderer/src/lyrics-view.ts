// Lyrics view of the player (side panel, or immersive over the whole YouTube
// Music area): lines scroll smoothly to keep the sung one in view, the sung
// line fills as it goes, other lines fade, a click on a line goes there.
// Synced lyrics come from LRCLIB; otherwise YouTube Music's own (plain) lyrics.

import { type LyricLine, type LyricsState, lineAt } from '../../shared/island';
import type { PlayerProgress, PlayerSnapshot } from '../../shared/player';
import { $, el, setText } from './dom';

/** Lines read as they are sung: shown a little before their time stamp. */
const LEAD_SECONDS = 0.3;
/** A gap this long between two lines is an instrumental break: shown as dots. */
const INTERLUDE_SECONDS = 5;
/** After a manual scroll, the view follows the song again after this delay. */
const MANUAL_SCROLL_MS = 3500;

interface Row {
  time: number;
  /** Time of the next row (end of this one). */
  end: number;
  text: string;
  interlude: boolean;
  element: HTMLElement;
}

export interface LyricsView {
  /** The view is shown (the panel is 'lyrics' or 'lyrics-full'). */
  setOpen(open: boolean, immersive: boolean): void;
}

export function setupLyricsView(): LyricsView {
  const api = window.player;
  const section = $('section[data-panel="lyrics"]');
  const scroll = $('.lyrics-scroll', section);
  const list = $('.lyrics-lines', section);
  const plain = $('.lyrics-plain', section);
  const status = $('.lyrics-status', section);

  let snapshot: PlayerSnapshot | null = null;
  let progress: PlayerProgress | null = null;
  let progressAt = 0;
  let lyrics: LyricsState | null = null;
  let rows: Row[] = [];
  let builtFor = '';
  let active = -2;
  let open = false;
  let frame = 0;
  let manualUntil = 0;
  let manualShift = 0;

  const playing = (): boolean => snapshot?.status === 'playing';
  const offset = (): number => lyrics?.offset ?? 0;

  /** Position now: last report, plus the time elapsed while playing (at most 1 s). */
  function position(): number {
    if (!progress) return 0;
    const elapsed = playing() ? Math.min((performance.now() - progressAt) / 1000, 1) : 0;
    return progress.position + elapsed;
  }

  function seekTo(time: number): void {
    const track = snapshot?.track;
    if (!track) return;
    manualUntil = 0;
    api.command({ type: 'seek', trackId: track.id, position: Math.max(0, time + offset()) });
  }

  /** Builds the rows of the current lyrics, with dots for instrumental breaks. */
  function build(lines: LyricLine[]): void {
    rows = [];
    const add = (time: number, text: string, interlude: boolean): void => {
      const element = el('div', { className: interlude ? 'lyric interlude' : 'lyric', role: 'listitem' });
      if (interlude)
        element.append(
          el('span', { className: 'dot' }),
          el('span', { className: 'dot' }),
          el('span', { className: 'dot' }),
        );
      else element.append(el('span', { className: 'words' }, text || '♪'));
      element.addEventListener('click', () => seekTo(time));
      rows.push({ time, end: Infinity, text, interlude, element });
    };
    const first = lines[0];
    if (first && first.time >= INTERLUDE_SECONDS) add(0, '', true);
    lines.forEach((line, i) => {
      const next = lines[i + 1];
      if (!line.text && next && next.time - line.time >= INTERLUDE_SECONDS) add(line.time, '', true);
      else add(line.time, line.text, false);
    });
    rows.forEach((row, i) => (row.end = rows[i + 1]?.time ?? row.time + 6));
    list.replaceChildren(...rows.map(r => r.element));
    active = -2;
    manualShift = 0;
  }

  /** Scrolls so the sung line sits a third of the way down (smooth, CSS transition). */
  function place(index: number): void {
    const row = rows[Math.max(0, index)];
    if (!row) return;
    const target = scroll.clientHeight * 0.36 - (row.element.offsetTop + row.element.offsetHeight / 2);
    list.style.transform = `translateY(${Math.round(target + manualShift)}px)`;
  }

  function render(): void {
    frame = 0;
    if (!open || lyrics?.status !== 'synced' || !rows.length) return;
    const now = position() + LEAD_SECONDS - offset();
    const times = rows.map(r => ({ time: r.time, text: '' }));
    const index = lineAt(times, now);
    if (index !== active) {
      rows.forEach((row, i) => {
        row.element.classList.toggle('active', i === index);
        row.element.classList.toggle('past', i < index);
      });
      active = index;
      if (Date.now() > manualUntil) {
        manualShift = 0;
        place(index);
      }
    }
    // The sung line fills from left to right over its duration.
    const row = rows[index];
    if (row) {
      const fill = Math.min(1, Math.max(0, (now - row.time) / Math.max(0.5, Math.min(row.end - row.time, 12))));
      row.element.style.setProperty('--fill', fill.toFixed(3));
    }
    if (Date.now() > manualUntil && manualShift) {
      manualShift = 0;
      place(active);
    }
    if (playing()) frame = requestAnimationFrame(render);
  }

  function schedule(): void {
    if (!frame && open) frame = requestAnimationFrame(render);
  }

  /** What to show: synced lines, plain text, or a status message. */
  function show(): void {
    const track = snapshot?.track ?? null;
    setText($('.lyrics-title', section), track?.title ?? '');
    setText($('.lyrics-artist', section), track ? [track.artist, track.album].filter(Boolean).join(' · ') : '');
    for (const img of [
      $<HTMLImageElement>('.lyrics-art', section),
      $<HTMLImageElement>('.lyrics-backdrop-art', section),
    ])
      if (track?.artwork && img.getAttribute('src') !== track.artwork) img.src = track.artwork;
    const current = track && lyrics?.trackId === track.id ? lyrics : null;
    const synced = current?.status === 'synced';
    section.classList.toggle('synced', synced);
    list.hidden = !synced;
    plain.hidden = current?.status !== 'plain';
    if (synced && current && builtFor !== `${current.trackId}:${current.lines.length}`) {
      builtFor = `${current.trackId}:${current.lines.length}`;
      build(current.lines);
      requestAnimationFrame(() => place(Math.max(0, active)));
    }
    if (!synced) builtFor = '';
    if (current?.status === 'plain') setText(plain, current.plain ?? '');
    setText(
      status,
      !track
        ? 'Aucun morceau en lecture.'
        : !current || current.status === 'loading'
          ? 'Recherche des paroles…'
          : current.status === 'none'
            ? 'Pas de paroles pour ce morceau.'
            : current.status === 'off'
              ? 'Paroles synchronisées désactivées (Réglages → Island → Paroles).'
              : '',
    );
    setText($('.lyrics-source', section), current?.source ? `Paroles : ${current.source}` : '');
    const o = current?.offset ?? 0;
    $('.lyrics-offset', section).hidden = !synced;
    setText(
      $('.lyrics-offset-value', section),
      o ? `${o > 0 ? '+' : '−'}${Math.abs(o).toFixed(1).replace('.', ',')} s` : 'calées',
    );
    active = -2;
    schedule();
  }

  // Manual scroll with the wheel: the view follows the song again a moment later.
  scroll.addEventListener(
    'wheel',
    event => {
      if (lyrics?.status !== 'synced') return;
      event.preventDefault();
      manualShift -= event.deltaY;
      manualUntil = Date.now() + MANUAL_SCROLL_MS;
      const row = rows[Math.max(0, active)];
      if (row) {
        const target = scroll.clientHeight * 0.36 - (row.element.offsetTop + row.element.offsetHeight / 2);
        list.style.transform = `translateY(${Math.round(target + manualShift)}px)`;
      }
      window.setTimeout(schedule, MANUAL_SCROLL_MS + 50);
    },
    { passive: false },
  );
  for (const button of section.querySelectorAll<HTMLButtonElement>('[data-shift]'))
    button.addEventListener('click', () => api.islandLyricsOffset(Number(button.dataset.shift)));
  new ResizeObserver(() => place(Math.max(0, active))).observe(scroll);

  api.on('player:snapshot', value => {
    const changed = value.track?.id !== snapshot?.track?.id;
    snapshot = value;
    if (changed) show();
    else schedule();
  });
  api.on('player:progress', value => {
    progress = value;
    progressAt = performance.now();
    schedule();
  });
  api.on('lyrics:state', value => {
    lyrics = value;
    show();
  });

  return {
    setOpen(value, immersive) {
      open = value;
      document.body.classList.toggle('lyrics-immersive', value && immersive);
      if (value) {
        show();
        requestAnimationFrame(() => place(Math.max(0, active)));
        scroll.focus({ preventScroll: true });
      }
    },
  };
}
