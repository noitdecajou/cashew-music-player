// The island page: a pill at the top of the screen. Compact: small cover and
// the current lyric line (or title — artist). On hover: cover, title, artist,
// progress, up next, play/pause and next.

import type { ShellApi } from '../../shared/ipc';
import { type IslandView, type LyricsState, lineAt } from '../../shared/island';
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
let expanded = false;

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
  island.hidden = !track;
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
  $('.clock-left').hidden = view.clock !== 'left';
  $('.clock-right').hidden = view.clock !== 'right';
}

// --- Hover: the window lets clicks through except over the pill --------------
function setExpanded(value: boolean): void {
  if (value === expanded) return;
  expanded = value;
  if (value) renderProgress();
  island.classList.toggle('expanded-view', value);
  api.islandHover(value);
}
document.addEventListener('mousemove', event => {
  setExpanded(!island.hidden && island.contains(event.target as Node));
});
document.addEventListener('mouseleave', () => setExpanded(false));
window.addEventListener('blur', () => setExpanded(false));

$('.play').addEventListener('click', () => api.command({ type: 'toggle-play' }));
$('.next').addEventListener('click', () => api.command({ type: 'next' }));

api.on('player:snapshot', value => {
  snapshot = value;
  renderSnapshot();
  updateTicker();
});
api.on('player:progress', value => {
  progress = value;
  progressAt = performance.now();
  renderLine();
  if (expanded) renderProgress();
});
api.on('lyrics:state', value => {
  lyrics = value;
  renderLine();
  updateTicker();
});
api.on('island:view', applyView);
