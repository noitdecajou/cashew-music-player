// The island page: a pill at the top of the screen. Compact: small cover and
// the current lyric line (or title — artist). On hover: cover (opens the player),
// title, artist, progress, three lyric lines, up next, previous, play/pause, next.

import type { ShellApi } from '../../shared/ipc';
import {
  type GamePrompt,
  type IslandEvent,
  type IslandView,
  type LyricsState,
  lineAt,
  tintFromRgb,
} from '../../shared/island';
import type { PlayerProgress, PlayerSnapshot } from '../../shared/player';
import { formatTime } from './format';
import { $, $$, setText } from './dom';

declare global {
  interface Window {
    player: ShellApi;
  }
}

const api = window.player;
const island = $('#island');
const lineBox = $('.line');
const lineText = $('.text', lineBox);
const playIcon = $<SVGUseElement>('.play use');
let snapshot: PlayerSnapshot | null = null;
let lyrics: LyricsState | null = null;
let progress: PlayerProgress | null = null;
/** When the last position arrived: the player reports it ~4 times a second, the clock in between is estimated. */
let progressAt = 0;
/** Lines appear this much before their time stamp, so they read as they are sung. */
const LEAD_SECONDS = 0.3;
let ticker = 0;
let shownLine = '';
/** The pointer is over the pill (the window then takes clicks). */
let hovering = false;
/** Details shown for a moment without the mouse (track change, shortcut). */
let peekTimer = 0;
let prompt: GamePrompt | null = null;
/** A short message replacing the compact line for a moment (pause, volume…). */
let eventText = '';
let eventTimer = 0;

/** The island takes the cover's color (equalizer, progress, glow). */
let tintedFor = '';
function tint(url: string): void {
  if (url === tintedFor) return;
  tintedFor = url;
  const root = document.documentElement;
  if (!url) {
    root.style.removeProperty('--tint');
    return;
  }
  const image = new Image();
  image.crossOrigin = 'anonymous'; // without CORS the canvas is unreadable: keep the default accent
  image.onload = () => {
    if (tintedFor !== url) return;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 16;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return;
      context.drawImage(image, 0, 0, 16, 16);
      const data = context.getImageData(0, 0, 16, 16).data;
      // Average of the colorful pixels: greys and near-black/white would wash the tint out.
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        const pr = data[i] ?? 0;
        const pg = data[i + 1] ?? 0;
        const pb = data[i + 2] ?? 0;
        const spread = Math.max(pr, pg, pb) - Math.min(pr, pg, pb);
        if (spread < 30) continue;
        r += pr;
        g += pg;
        b += pb;
        n++;
      }
      const color = n ? tintFromRgb(r / n, g / n, b / n) : null;
      if (color) root.style.setProperty('--tint', color);
      else root.style.removeProperty('--tint');
    } catch {
      root.style.removeProperty('--tint');
    }
  };
  image.onerror = () => root.style.removeProperty('--tint');
  image.src = url;
}

function setArt(url: string): void {
  tint(url);
  for (const img of $$<HTMLImageElement>('.art')) {
    if (url) {
      if (img.getAttribute('src') !== url) img.src = url;
      img.classList.remove('missing');
    } else {
      img.removeAttribute('src');
      img.classList.add('missing');
    }
  }
}

/** The compact text: the line being sung, else "title — artist". */
function isPlaying(): boolean {
  return snapshot?.status === 'playing';
}

/** The position now: the last one reported, plus the time elapsed while playing (at most 1 s). */
function estimatedPosition(): number {
  if (!progress) return 0;
  const elapsed = isPlaying() ? Math.min((performance.now() - progressAt) / 1000, 1) : 0;
  const position = progress.position + elapsed;
  return progress.duration > 0 ? Math.min(position, progress.duration) : position;
}

/** While synced lyrics play, the line follows the estimated clock (10 times a second). */
function updateTicker(): void {
  const active = isPlaying() && lyrics?.status === 'synced' && lyrics.trackId === snapshot?.track?.id && !island.hidden;
  if (active && !ticker) ticker = window.setInterval(renderLine, 100);
  else if (!active && ticker) {
    window.clearInterval(ticker);
    ticker = 0;
  }
}

function renderLine(): void {
  const track = snapshot?.track;
  let text = track ? [track.title, track.artist].filter(Boolean).join(' — ') : '';
  let isLyric = false;
  const synced =
    !!track && lyrics?.trackId === track.id && lyrics.status === 'synced' && progress?.trackId === track.id;
  island.classList.toggle('with-lyrics', synced);
  $('.karaoke').hidden = !synced;
  if (synced && lyrics) {
    const lines = lyrics.lines;
    const index = lineAt(lines, estimatedPosition() + LEAD_SECONDS - (lyrics.offset ?? 0));
    const at = (i: number): string => (i >= 0 ? (lines[i]?.text ?? '') || '♪' : '');
    const sung = index >= 0 ? lines[index]?.text : undefined;
    if (sung) {
      text = sung;
      isLyric = true;
    } else if (index >= 0) {
      text = '♪';
      isLyric = true;
    }
    setText($('.k-prev'), at(index - 1));
    setText($('.k-now'), index >= 0 ? at(index) : '♪');
    setText($('.k-next'), index + 1 < lines.length ? at(index + 1) : '');
    const offset = lyrics.offset ?? 0;
    setText(
      $('.offset-value'),
      offset ? `${offset > 0 ? '+' : '−'}${Math.abs(offset).toFixed(1).replace('.', ',')} s` : 'calées',
    );
  }
  if (eventText) {
    text = eventText;
    isLyric = false;
  }
  island.classList.toggle('lyric', isLyric);
  if (text === shownLine) return;
  shownLine = text;
  setText(lineText, text);
  lineBox.title = text;
  // Restart the line-change animation.
  lineText.classList.remove('enter');
  void lineText.offsetWidth;
  lineText.classList.add('enter');
}

/** Pause, resume, volume: a short message in place of the line. */
function showEvent(event: IslandEvent): void {
  eventText =
    event.kind === 'pause'
      ? '⏸ En pause'
      : event.kind === 'play'
        ? '▶ Lecture'
        : event.kind === 'mute'
          ? 'Son coupé'
          : `Volume ${event.volume} %`;
  window.clearTimeout(eventTimer);
  eventTimer = window.setTimeout(() => {
    eventText = '';
    renderLine();
  }, 2000);
  renderLine();
}

function renderProgress(): void {
  const p = progress && progress.trackId === snapshot?.track?.id ? progress : null;
  setText($('.elapsed'), formatTime(p?.position ?? 0));
  setText($('.total'), formatTime(p?.duration ?? 0));
  const ratio = p && p.duration > 0 ? Math.min(1, p.position / p.duration) : 0;
  $('.fill').style.width = `${(ratio * 100).toFixed(2)}%`;
}

function renderSnapshot(): void {
  const track = snapshot?.track ?? null;
  island.hidden = !track && !prompt;
  if (!track) return;
  const playing = snapshot?.status === 'playing' || snapshot?.status === 'buffering';
  island.classList.toggle('playing', playing);
  playIcon.setAttribute('href', playing ? '#i-pause' : '#i-play');
  setArt(track.artwork);
  setText($('.title'), track.title);
  setText($('.artist'), [track.artist, track.album].filter(Boolean).join(' · '));
  const next = snapshot?.next;
  setText($('.upnext'), next ? `Ensuite · ${[next.title, next.artist].filter(Boolean).join(' — ')}` : '');
  renderLine();
  renderProgress();
}

// --- Clock -----------------------------------------------------------------
const clockFormat = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
function renderClock(): void {
  const now = clockFormat.format(new Date());
  for (const clock of $$('.clock')) setText(clock, now);
}
setInterval(renderClock, 10_000);
renderClock();

function applyView(view: IslandView): void {
  document.body.className = `pos-${view.position}`;
  // CSS zoom, not the page zoom: Chromium shares page zoom between pages of the same origin.
  document.documentElement.style.setProperty('zoom', String(view.scale));
  document.documentElement.style.setProperty('--pill', `rgba(10, 10, 14, ${(view.opacity / 100).toFixed(2)})`);
  $('.clock-left').hidden = view.clock !== 'left';
  $('.clock-right').hidden = view.clock !== 'right';
}

// --- Views: compact, details (hover or peek), question about a new game -----------
function renderView(): void {
  const details = !prompt && (hovering || peekTimer !== 0);
  if (details) renderProgress();
  island.classList.toggle('expanded-view', details);
  island.classList.toggle('prompt-view', !!prompt);
  island.hidden = !snapshot?.track && !prompt;
  reportPill();
}

/**
 * The window lets clicks through except over the pill. Main watches the real
 * cursor and tells the page ('island:hover'); mouse moves inside the window are
 * reported too. No 'mouseleave'/'blur' here: on Windows they fire spuriously while
 * clicks go through, which used to swallow clicks on the buttons.
 */
function setHovering(value: boolean, report: boolean): void {
  if (value === hovering) return;
  hovering = value;
  if (report) api.islandHover(value);
  renderView();
}
document.addEventListener('mousemove', event => {
  setHovering(!island.hidden && island.contains(event.target as Node), true);
});

/** Tells main where the pill is (visual pixels, also under CSS zoom), as it grows and shrinks. */
let pillFrame = 0;
let lastPill = '';
function reportPill(): void {
  if (pillFrame) return;
  pillFrame = requestAnimationFrame(() => {
    pillFrame = 0;
    const box = island.getBoundingClientRect();
    // getBoundingClientRect is in zoomed CSS pixels (Chromium's standard CSS zoom), i.e. window pixels.
    const rect = { x: box.left, y: box.top, width: box.width, height: box.height };
    const key = JSON.stringify(rect);
    if (key === lastPill || island.hidden) return;
    lastPill = key;
    api.islandPill(rect);
  });
}
new ResizeObserver(reportPill).observe(island);
island.addEventListener('transitionend', reportPill);

function peek(ms: number): void {
  window.clearTimeout(peekTimer);
  peekTimer = window.setTimeout(() => {
    peekTimer = 0;
    renderView();
  }, ms);
  renderView();
}

// Seek: click on the progress bar. Volume: mouse wheel over the island.
$('.rail').addEventListener('click', event => {
  const track = snapshot?.track;
  if (!track || !progress || progress.trackId !== track.id || !(progress.duration > 0)) return;
  const rail = event.currentTarget as HTMLElement;
  const box = rail.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
  api.command({ type: 'seek', trackId: track.id, position: ratio * progress.duration });
});
island.addEventListener(
  'wheel',
  event => {
    if (!snapshot || prompt) return;
    event.preventDefault();
    const step = event.deltaY < 0 ? 5 : -5;
    const volume = Math.min(100, Math.max(0, Math.round((snapshot.volume + step) / 5) * 5));
    if (volume === snapshot.volume) return;
    snapshot = { ...snapshot, volume };
    api.command({ type: 'volume', volume });
    showVolume(volume);
  },
  { passive: false },
);
let volumeTimer = 0;
function showVolume(volume: number): void {
  const badge = $('.volume-badge');
  setText(badge, `Volume ${volume} %`);
  badge.hidden = false;
  window.clearTimeout(volumeTimer);
  volumeTimer = window.setTimeout(() => {
    badge.hidden = true;
  }, 1200);
}

for (const button of $$<HTMLButtonElement>('.answer'))
  button.addEventListener('click', () => api.islandAnswer(button.dataset.answer as 'add'));

$('.play').addEventListener('click', () => api.command({ type: 'toggle-play' }));
$('.prev').addEventListener('click', () => api.command({ type: 'previous' }));
$('.cover').addEventListener('click', () => api.islandOpenPlayer());
for (const button of $$<HTMLButtonElement>('.shift'))
  button.addEventListener('click', () => api.islandLyricsOffset(Number(button.dataset.shift)));
$('.next').addEventListener('click', () => api.command({ type: 'next' }));

api.on('player:snapshot', value => {
  snapshot = value;
  renderSnapshot();
  renderView();
  updateTicker();
});
api.on('player:progress', value => {
  progress = value;
  progressAt = performance.now();
  renderLine();
  if (island.classList.contains('expanded-view')) renderProgress();
});
api.on('lyrics:state', value => {
  lyrics = value;
  renderLine();
  updateTicker();
});
api.on('island:view', view => {
  applyView(view);
  lastPill = '';
  reportPill();
});
api.on('island:hover', value => setHovering(value, false));
api.on('island:event', showEvent);
api.on('island:peek', ms => peek(Math.min(Math.max(ms, 500), 15000)));
api.on('island:prompt', value => {
  prompt = value;
  setText($('.prompt .game'), value?.name ?? '');
  renderView();
});
