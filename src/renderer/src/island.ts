// The island page: a pill at the top of the screen. Compact: small cover and
// the current lyric line (or title — artist). On hover: cover, title, artist,
// progress, up next, play/pause and next.

import type { ShellApi } from '../../shared/ipc';
import { type GamePrompt, type IslandView, type LyricsState, lineAt } from '../../shared/island';
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

function setArt(url: string): void {
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
  if (track && lyrics?.trackId === track.id && lyrics.status === 'synced' && progress?.trackId === track.id) {
    const index = lineAt(lyrics.lines, estimatedPosition() + LEAD_SECONDS);
    const sung = index >= 0 ? lyrics.lines[index]?.text : undefined;
    if (sung) {
      text = sung;
      isLyric = true;
    } else if (index >= 0) {
      text = '♪';
      isLyric = true;
    }
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
}

/** The window lets clicks through except over the pill. */
function setHovering(value: boolean): void {
  if (value === hovering) return;
  hovering = value;
  api.islandHover(value);
  renderView();
}
document.addEventListener('mousemove', event => {
  setHovering(!island.hidden && island.contains(event.target as Node));
});
document.addEventListener('mouseleave', () => setHovering(false));
window.addEventListener('blur', () => setHovering(false));

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
api.on('island:view', applyView);
api.on('island:peek', ms => peek(Math.min(Math.max(ms, 500), 15000)));
api.on('island:prompt', value => {
  prompt = value;
  setText($('.prompt .game'), value?.name ?? '');
  renderView();
});
