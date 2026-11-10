// Synced lyrics lines, shared by the lyrics views: YouTube Music's own Lyrics
// tab and the immersive view (isolated world of the YouTube Music page), and the
// mini-player's lyrics panel (drawer page). Plain DOM, no framework.
//
// The sung line is highlighted and filled word by word, the view scrolls to keep
// it a third of the way down, a click on a line goes there, the mouse wheel
// scrolls freely (the view follows the song again a moment later). It is driven
// by a timer, plus animation frames for smoothness: it never depends on frames
// alone (Chromium may hold them back for a view it thinks is hidden).

import { type LyricLine, LYRICS_LEAD_SECONDS, lineAt } from './island';

/** A gap this long between two lines is an instrumental break: shown as dots. */
export const INTERLUDE_SECONDS = 5;
/** After a manual scroll, the view follows the song again after this delay. */
export const MANUAL_SCROLL_MS = 3500;
/** Where the sung line sits, as a fraction of the visible height. */
const ANCHOR = 0.36;
/** Scroll easing time constant (ms): about 0.5 s to reach a new line. */
const EASE_MS = 140;

export interface LyricsLinesHost {
  /** The element that scrolls (the lines are inside it). */
  scroller: HTMLElement;
  /** Playback position now, in seconds. */
  now(): number;
  playing(): boolean;
  /** A click on a line: go to `time` (seconds, lyrics time). */
  seek(time: number): void;
}

export interface LyricsLines {
  /** The lines' container, to insert in the scroller. */
  readonly element: HTMLElement;
  /** Shows these lines (rebuilt only when they change). */
  set(key: string, lines: readonly LyricLine[], offset: number): void;
  /** Starts or stops following the song (when the view is shown or hidden). */
  run(on: boolean): void;
  /** Places the sung line right away (after a layout change). */
  snap(): void;
  /** Refresh now (a new position report). */
  update(): void;
}

interface Row {
  time: number;
  end: number;
  text: string;
  element: HTMLElement;
  /** Word spans and the character count at the end of each (for the fill). */
  words: { element: HTMLElement; end: number }[];
}

export function createLyricsLines(host: LyricsLinesHost): LyricsLines {
  const doc = host.scroller.ownerDocument;
  const element = doc.createElement('div');
  element.className = 'cl-lines';
  element.setAttribute('role', 'list');

  let rows: Row[] = [];
  let key = '';
  let offset = 0;
  let active = -2;
  let filled: Row | null = null;
  let running = false;
  let timer = 0;
  let frame = 0;
  let last = 0;
  let manualUntil = 0;

  function word(text: string): HTMLElement {
    const span = doc.createElement('span');
    span.className = 'cl-word';
    span.textContent = text;
    return span;
  }

  function build(lines: readonly LyricLine[]): void {
    rows = [];
    const add = (time: number, text: string, interlude: boolean): void => {
      const line = doc.createElement('div');
      line.className = interlude ? 'cl-line cl-interlude' : 'cl-line';
      line.setAttribute('role', 'listitem');
      const words: Row['words'] = [];
      if (interlude) {
        for (let i = 0; i < 3; i++) {
          const dot = doc.createElement('span');
          dot.className = 'cl-dot';
          line.append(dot);
        }
      } else {
        // Words keep their following space; the fill goes word by word.
        let count = 0;
        for (const part of (text || '♪').match(/\S+\s*/g) ?? []) {
          const span = word(part);
          count += part.trim().length;
          words.push({ element: span, end: count });
          line.append(span);
        }
      }
      line.addEventListener('click', () => {
        manualUntil = 0;
        host.seek(time);
      });
      rows.push({ time, end: Infinity, text, element: line, words });
    };
    const first = lines[0];
    if (first && first.time >= INTERLUDE_SECONDS) add(0, '', true);
    lines.forEach((line, i) => {
      const next = lines[i + 1];
      if (!line.text && next && next.time - line.time >= INTERLUDE_SECONDS) add(line.time, '', true);
      else add(line.time, line.text, false);
    });
    rows.forEach((row, i) => (row.end = rows[i + 1]?.time ?? row.time + 6));
    element.replaceChildren(...rows.map(row => row.element));
    active = -2;
    filled = null;
  }

  /** Room above and below: the first and last lines can reach the anchor. */
  function pad(): void {
    const height = host.scroller.clientHeight;
    element.style.paddingTop = `${Math.round(height * ANCHOR)}px`;
    element.style.paddingBottom = `${Math.round(height * (1 - ANCHOR))}px`;
  }

  /** Scroll position that puts row `index` at the anchor. */
  function target(index: number): number {
    const row = rows[Math.max(0, index)];
    if (!row) return 0;
    const scroller = host.scroller;
    const top = row.element.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    return Math.max(0, top + row.element.offsetHeight / 2 - scroller.clientHeight * ANCHOR);
  }

  /** Sung words in white, the word being sung filling from the left. */
  function fill(row: Row, now: number): void {
    const span = Math.max(0.5, Math.min(row.end - row.time, 12));
    const progress = Math.min(1, Math.max(0, (now - row.time) / span));
    const total = row.words.at(-1)?.end ?? 0;
    const sung = progress * total;
    let start = 0;
    for (const w of row.words) {
      const part = w.end - start;
      const ratio = part > 0 ? Math.min(1, Math.max(0, (sung - start) / part)) : 1;
      w.element.classList.toggle('cl-sung', ratio >= 1);
      w.element.style.setProperty('--fill', ratio > 0 && ratio < 1 ? ratio.toFixed(3) : '');
      start = w.end;
    }
  }
  function unfill(row: Row): void {
    for (const w of row.words) {
      w.element.classList.remove('cl-sung');
      w.element.style.removeProperty('--fill');
    }
  }

  /** Returns true while the scroll still moves toward the sung line. */
  function render(): boolean {
    if (!running || !rows.length) return false;
    const clock = performance.now();
    const elapsed = last ? Math.min(clock - last, 120) : 16;
    last = clock;
    const now = host.now() + LYRICS_LEAD_SECONDS - offset;
    const index = lineAt(rows, now);
    if (index !== active) {
      rows.forEach((row, i) => {
        row.element.classList.toggle('cl-active', i === index);
        row.element.classList.toggle('cl-past', i < index);
      });
      active = index;
    }
    const row = rows[index] ?? null;
    if (filled && filled !== row) unfill(filled);
    filled = row;
    if (row) fill(row, now);
    if (Date.now() < manualUntil) return false;
    const scroller = host.scroller;
    const goal = Math.min(target(active), scroller.scrollHeight - scroller.clientHeight);
    const gap = goal - scroller.scrollTop;
    if (Math.abs(gap) < 1) return false;
    const step = Math.abs(gap) < 2 ? gap : gap * (1 - Math.exp(-elapsed / EASE_MS));
    scroller.scrollTop += step;
    return true;
  }

  function loop(): void {
    frame = 0;
    const moving = render();
    if (running && (moving || host.playing())) frame = requestAnimationFrame(loop);
  }
  function update(): void {
    const moving = render();
    if (running && !frame && (moving || host.playing())) frame = requestAnimationFrame(loop);
  }

  // The hand wins: wheel, touch, keys or the scrollbar pause the follow.
  const manual = (): void => {
    if (running) manualUntil = Date.now() + MANUAL_SCROLL_MS;
  };
  host.scroller.addEventListener('wheel', manual, { passive: true });
  host.scroller.addEventListener('touchmove', manual, { passive: true });
  host.scroller.addEventListener('pointerdown', event => {
    if (event.target === host.scroller) manual();
  });
  host.scroller.addEventListener('keydown', event => {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) manual();
  });
  new ResizeObserver(() => {
    if (running) {
      pad();
      snap();
    }
  }).observe(host.scroller);

  function snap(): void {
    if (!running || !rows.length) return;
    render();
    if (Date.now() >= manualUntil) host.scroller.scrollTop = target(active);
  }

  return {
    element,
    set(nextKey, lines, nextOffset) {
      offset = nextOffset;
      if (nextKey !== key) {
        key = nextKey;
        manualUntil = 0;
        build(lines);
        pad();
        snap();
      }
      update();
    },
    run(on) {
      if (on === running) return;
      running = on;
      last = 0;
      if (on) {
        timer = window.setInterval(update, 100);
        manualUntil = 0;
        pad();
        snap();
        update();
      } else {
        window.clearInterval(timer);
        timer = 0;
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
      }
    },
    snap,
    update,
  };
}
