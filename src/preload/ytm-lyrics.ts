// cashew's synced lyrics inside the YouTube Music page, like Better Lyrics:
// they replace the content of YouTube Music's own Lyrics tab, and a full-screen
// view can cover the whole page: cover (or the music video), title, artist,
// progress and controls on the left, lyrics on the right, over the blurred cover.
//
// This runs in the preload's isolated world: the page's scripts cannot reach
// this code. It reads the DOM (shared with the page), taps the player messages
// relayed to main, and receives the lyrics from main. While lyrics are being
// looked for, the tab shows a short wait instead of YouTube Music's own text;
// without synced lyrics, YouTube Music's own lyrics stay.

import { type LyricsState, estimatePosition, sanitizeLyrics } from '../shared/island';
import { type LyricsLines, createLyricsLines } from '../shared/lyrics-renderer';
import { type PlayerProgress, type PlayerSnapshot, sanitizeAgentMessage } from '../shared/player';
import { formatTime } from '../renderer/src/format';

export interface YtmLyricsDeps {
  /** A player command for the page agent (seek, play/pause, previous, next). */
  command(command: unknown): void;
  /** A message for main (view shown, per-track correction). */
  report(message: unknown): void;
}

export interface YtmLyrics {
  /** Every message the page agent sends (player state, positions). */
  tap(raw: unknown): void;
  lyrics(raw: unknown): void;
  /** 'toggle' | 'open' | 'close' the full-screen view. */
  immersive(action: unknown): void;
}

/** The Lyrics tab, marked by the page agent (it reads the tab's page type). */
const LYRICS_TAB = 'ytmusic-player-page tp-yt-paper-tab[data-cashew-lyrics]';
const TAB_RENDERER = 'ytmusic-player-page #tab-renderer';
const PLAYER_PAGE = 'ytmusic-player-page';
const PLAYER = 'ytmusic-player-page ytmusic-player#player';
/** Longest wait shown in the tab before giving it back to YouTube Music. */
const WAIT_MS = 8000;
const CLIP_KEY = 'cashew.lyrics.clip';
const SVG = 'http://www.w3.org/2000/svg';
const ICONS = {
  previous: 'M6 6h2v12H6zm3.5 6 8.5 6V6z',
  next: 'M16 6h2v12h-2zM6 18l8.5-6L6 6z',
  play: 'M8 5v14l11-7z',
  pause: 'M6 5h4v14H6zm8 0h4v14h-4z',
  clip: 'M4 6h12a2 2 0 0 1 2 2v1.5l3-2v9l-3-2V16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z',
};

export function setupYtmLyrics(deps: YtmLyricsDeps): YtmLyrics {
  let snapshot: PlayerSnapshot | null = null;
  let progress: PlayerProgress | null = null;
  let progressAt = 0;
  let lyrics: LyricsState | null = null;
  let tabShown = false;
  let pageOpen = false;
  let immersive = false;
  let reported = '';
  /** When the tab started waiting for this track's lyrics. */
  let waitingFor = '';
  let waitingSince = 0;

  const track = (): PlayerSnapshot['track'] => snapshot?.track ?? null;
  const current = (): LyricsState | null => (lyrics && lyrics.trackId === track()?.id ? lyrics : null);
  const synced = (): boolean => current()?.status === 'synced' && (current()?.lines.length ?? 0) > 0;
  const playing = (): boolean => snapshot?.status === 'playing';
  /** Lyrics not known yet for the current track (being looked for). */
  const pending = (): boolean => !!track() && (!current() || current()?.status === 'loading');

  function video(): HTMLVideoElement | null {
    return document.querySelector<HTMLVideoElement>('#movie_player video');
  }
  /** Position: the video element when it plays (exact), else the last report, estimated. */
  function now(): number {
    const v = video();
    if (v && !v.paused && v.readyState >= 2 && Number.isFinite(v.currentTime)) return v.currentTime;
    if (!progress || progress.trackId !== track()?.id) return 0;
    return estimatePosition(progress, performance.now() - progressAt, playing());
  }
  function duration(): number {
    return progress && progress.trackId === track()?.id ? progress.duration : 0;
  }
  /** Seek to a lyrics time (the per-track correction applies). */
  function seekLyrics(time: number): void {
    seekTo(time + (current()?.offset ?? 0));
  }
  function seekTo(position: number): void {
    const id = track()?.id;
    if (id) deps.command({ type: 'seek', trackId: id, position: Math.max(0, position) });
  }

  function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    node.className = className;
    if (text) node.textContent = text;
    return node;
  }
  function icon(path: string): SVGSVGElement {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const shape = document.createElementNS(SVG, 'path');
    shape.setAttribute('d', path);
    svg.append(shape);
    return svg;
  }
  function iconButton(className: string, label: string, path: string, onClick: () => void): HTMLButtonElement {
    const button = el('button', className);
    button.title = label;
    button.setAttribute('aria-label', label);
    button.append(icon(path));
    button.addEventListener('click', onClick);
    return button;
  }

  /** Footer: source, correction (−/+ 0.5 s), full-screen view. */
  function footer(withImmersive: boolean): { root: HTMLElement; update(): void } {
    const root = el('div', 'cl-foot');
    const source = el('span', 'cl-source');
    const offset = el('span', 'cl-offset');
    const value = el('span', 'cl-offset-value');
    const earlier = el('button', '', '−0,5 s');
    const later = el('button', '', '+0,5 s');
    earlier.title = 'Paroles plus tôt (ce morceau)';
    later.title = 'Paroles plus tard (ce morceau)';
    earlier.addEventListener('click', () => deps.report({ kind: 'lyrics-offset', delta: -0.5 }));
    later.addEventListener('click', () => deps.report({ kind: 'lyrics-offset', delta: 0.5 }));
    offset.append(earlier, value, later);
    root.append(source, offset);
    if (withImmersive) {
      const full = el('button', 'cl-full', 'Plein écran');
      full.title = 'Paroles en plein écran (Échap pour revenir)';
      full.addEventListener('click', () => setImmersive(true));
      root.append(full);
    }
    return {
      root,
      update() {
        const state = current();
        source.textContent = state?.source ? `Paroles : ${state.source}` : '';
        offset.hidden = state?.status !== 'synced';
        const o = state?.offset ?? 0;
        value.textContent = o ? `${o > 0 ? '+' : '−'}${Math.abs(o).toFixed(1).replace('.', ',')} s` : 'calées';
      },
    };
  }

  // --- The Lyrics tab ----------------------------------------------------------
  const tabRoot = el('div', 'cl-tab');
  const tabWait = el('p', 'cl-wait', 'Recherche des paroles…');
  let tabScroller: HTMLElement | null = null;
  let tabLines: LyricsLines | null = null;
  const tabFoot = footer(true);

  /** Our lines in the tab while it is shown: synced lyrics, or a short wait while they are looked for. */
  function syncTab(): void {
    const tab = document.querySelector(LYRICS_TAB);
    const layout = document.querySelector('ytmusic-app-layout');
    pageOpen = !layout || layout.hasAttribute('player-page-open');
    tabShown =
      !!tab && (tab.getAttribute('aria-selected') === 'true' || tab.classList.contains('iron-selected')) && pageOpen;
    // A tab disabled by YouTube Music (it has no lyrics) is enabled when we have some.
    if (tab && synced() && (tab.hasAttribute('disabled') || tab.getAttribute('aria-disabled') === 'true')) {
      tab.removeAttribute('disabled');
      tab.setAttribute('aria-disabled', 'false');
    }
    const id = track()?.id ?? '';
    if (!pending()) waitingFor = '';
    else if (waitingFor !== id) {
      waitingFor = id;
      waitingSince = Date.now();
    }
    const waiting = pending() && Date.now() - waitingSince < WAIT_MS;
    const host = document.querySelector<HTMLElement>(TAB_RENDERER);
    const takeOver = tabShown && !immersive && (synced() || waiting) && !!host;
    if (host) {
      if (!tabLines || tabScroller !== host) {
        tabScroller = host;
        tabLines?.run(false);
        tabLines = createLyricsLines({ scroller: host, now, playing, seek: seekLyrics });
        tabRoot.replaceChildren(tabWait, tabLines.element, tabFoot.root);
      }
      if (takeOver && tabRoot.parentElement !== host) host.prepend(tabRoot);
      host.toggleAttribute('cashew-lyrics', takeOver);
    }
    tabWait.hidden = synced();
    if (tabLines) {
      const state = current();
      tabLines.element.hidden = !synced();
      if (takeOver && synced() && state)
        tabLines.set(`${state.trackId}:${state.lines.length}`, state.lines, state.offset ?? 0);
      tabLines.run(takeOver && synced());
    }
    tabFoot.update();
  }

  // --- The music video next to the lyrics (full-screen view) --------------------
  // YouTube Music's own player is moved over a place kept in our view (fixed
  // position, its page made invisible except the player): the video keeps
  // playing in YouTube Music's player, only its place and size change.
  // The full screen follows YouTube Music's Song/Video switch: in Video mode the
  // clip plays there (never a still frame as the cover); the camera button is
  // that switch, and the last choice made with it is remembered.
  let clipPreferred = readClip();
  /** The clip is shown in this full-screen session. */
  let clip = false;
  let shownVideo = false;
  let playerStyle: string | null = null;
  let placed = '';

  function readClip(): boolean {
    try {
      return localStorage.getItem(CLIP_KEY) === 'on';
    } catch {
      return false;
    }
  }
  function saveClip(): void {
    try {
      localStorage.setItem(CLIP_KEY, clipPreferred ? 'on' : 'off');
    } catch {
      /* private storage refused: the choice lasts for this session */
    }
  }
  /** The track can be shown as a video (YouTube Music's Song/Video switch). */
  function videoMode(): boolean {
    return document.querySelector(PLAYER_PAGE)?.hasAttribute('video-mode') ?? false;
  }
  /** YouTube Music's Song/Video switch, when it can be used for this track. */
  function avToggle(): Element | null {
    const toggle = document.querySelector('ytmusic-av-toggle');
    return toggle && !toggle.hasAttribute('toggle-disabled') ? toggle : null;
  }
  function trySwitchToVideo(): void {
    const toggle = avToggle();
    if (
      toggle?.hasAttribute('selected-item-has-video') &&
      toggle.getAttribute('is-video-playback-mode-selected') !== 'true'
    )
      toggle.querySelector<HTMLElement>('.video-button')?.click();
  }
  function trySwitchToSong(): void {
    const toggle = avToggle();
    if (
      toggle?.hasAttribute('audio-only-playback-available') &&
      toggle.getAttribute('is-audio-playback-mode-selected') !== 'true'
    )
      toggle.querySelector<HTMLElement>('.song-button')?.click();
  }

  function placePlayer(slot: HTMLElement | null): void {
    const page = document.querySelector<HTMLElement>(PLAYER_PAGE);
    const player = document.querySelector<HTMLElement>(PLAYER);
    const show = immersive && clip && videoMode() && !!slot && !!page && !!player;
    if (!show) {
      if (page?.hasAttribute('cashew-clip')) page.removeAttribute('cashew-clip');
      if (player && playerStyle !== null) {
        player.setAttribute('style', playerStyle);
        if (!playerStyle) player.removeAttribute('style');
        playerStyle = null;
        placed = '';
        window.dispatchEvent(new Event('resize'));
      }
      return;
    }
    if (!slot || !page || !player) return;
    if (playerStyle === null) playerStyle = player.getAttribute('style') ?? '';
    page.setAttribute('cashew-clip', '');
    const r = slot.getBoundingClientRect();
    const key = `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`;
    if (key === placed) return;
    placed = key;
    for (const [name, value] of [
      ['position', 'fixed'],
      ['left', `${Math.round(r.left)}px`],
      ['top', `${Math.round(r.top)}px`],
      ['width', `${Math.round(r.width)}px`],
      ['height', `${Math.round(r.height)}px`],
      ['max-width', 'none'],
      ['max-height', 'none'],
      ['margin', '0'],
      ['z-index', '1'],
    ] as const)
      player.style.setProperty(name, value, 'important');
    // The player sizes its video on resize.
    window.dispatchEvent(new Event('resize'));
  }

  // --- The full-screen view ------------------------------------------------------
  interface View {
    root: HTMLElement;
    slot: HTMLElement;
    lines: LyricsLines;
    update(): void;
    tick(): void;
  }
  let view: View | null = null;
  let ticker = 0;

  function buildImmersive(): View {
    const root = el('div', 'cl-immersive');
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Paroles');
    const bg = el('img', 'cl-bg');
    bg.alt = '';

    // Left: cover (or the video), title, artist, progress, controls, up next.
    const side = el('div', 'cl-side');
    const panel = el('div', 'cl-panel');
    const media = el('div', 'cl-media');
    const cover = el('img', 'cl-cover');
    cover.alt = '';
    const slot = el('div', 'cl-video-slot');
    media.append(cover, slot);
    const title = el('div', 'cl-title');
    const artist = el('div', 'cl-artist');

    const bar = el('div', 'cl-progress');
    bar.setAttribute('role', 'slider');
    bar.setAttribute('aria-label', 'Position');
    bar.tabIndex = 0;
    const barFill = el('div', 'cl-progress-fill');
    bar.append(barFill);
    const elapsed = el('span', 'cl-time');
    const total = el('span', 'cl-time');
    const timeRow = el('div', 'cl-times');
    timeRow.append(elapsed, total);
    let dragging: number | null = null;
    const ratioAt = (event: PointerEvent): number => {
      const r = bar.getBoundingClientRect();
      return Math.min(1, Math.max(0, (event.clientX - r.left) / Math.max(1, r.width)));
    };
    bar.addEventListener('pointerdown', event => {
      if (!duration()) return;
      bar.setPointerCapture(event.pointerId);
      dragging = ratioAt(event);
      tick();
    });
    bar.addEventListener('pointermove', event => {
      if (dragging === null) return;
      dragging = ratioAt(event);
      tick();
    });
    const release = (): void => {
      if (dragging === null) return;
      seekTo(dragging * duration());
      dragging = null;
    };
    bar.addEventListener('pointerup', release);
    bar.addEventListener('pointercancel', () => (dragging = null));
    bar.addEventListener('keydown', event => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        seekTo(now() + (event.key === 'ArrowLeft' ? -5 : 5));
      }
    });

    const buttons = el('div', 'cl-buttons');
    const previous = iconButton('cl-button', 'Précédent', ICONS.previous, () => deps.command({ type: 'previous' }));
    const play = iconButton('cl-button cl-play', 'Lecture', ICONS.play, () => deps.command({ type: 'toggle-play' }));
    const next = iconButton('cl-button', 'Suivant', ICONS.next, () => deps.command({ type: 'next' }));
    const clipButton = iconButton('cl-button cl-clip-toggle', 'Afficher le clip', ICONS.clip, () => {
      clip = !clip;
      clipPreferred = clip;
      saveClip();
      if (clip) trySwitchToVideo();
      else trySwitchToSong();
      update();
    });
    buttons.append(previous, play, next, clipButton);
    const upNext = el('div', 'cl-upnext');
    const clipNote = el('div', 'cl-clip-note');
    panel.append(media, title, artist, bar, timeRow, buttons, upNext, clipNote);
    side.append(panel);

    // Right: the lyrics.
    const main = el('div', 'cl-main');
    const scroll = el('div', 'cl-scroll');
    scroll.tabIndex = 0;
    const status = el('p', 'cl-status');
    const plain = el('div', 'cl-plain');
    const lines = createLyricsLines({ scroller: scroll, now, playing, seek: seekLyrics });
    scroll.append(status, lines.element, plain);
    const foot = footer(false);
    main.append(scroll, foot.root);

    const close = el('button', 'cl-close', '✕');
    close.title = 'Quitter le plein écran (Échap)';
    close.setAttribute('aria-label', 'Quitter le plein écran');
    close.addEventListener('click', () => setImmersive(false));
    root.append(bg, side, main, close);
    document.body.append(root);
    new ResizeObserver(() => placePlayer(slot)).observe(slot);

    function tick(): void {
      const d = duration();
      const position = dragging !== null ? dragging * d : Math.min(now(), d || Infinity);
      barFill.style.width = d ? `${((position / d) * 100).toFixed(2)}%` : '0%';
      bar.setAttribute('aria-valuenow', String(Math.round(position)));
      bar.setAttribute('aria-valuemax', String(Math.round(d)));
      elapsed.textContent = formatTime(position);
      total.textContent = d ? formatTime(d) : '';
    }

    function update(): void {
      const t = track();
      const state = current();
      title.textContent = t?.title ?? '';
      artist.textContent = t ? [t.artist, t.album].filter(Boolean).join(' · ') : '';
      const art = t?.artwork ?? '';
      for (const img of [cover, bg]) if (img.getAttribute('src') !== art) img.src = art;
      const isPlaying = playing();
      play.replaceChildren(icon(isPlaying ? ICONS.pause : ICONS.play));
      play.title = isPlaying ? 'Pause' : 'Lecture';
      play.setAttribute('aria-label', play.title);
      const n = snapshot?.next;
      upNext.textContent = n ? `À suivre : ${[n.title, n.artist].filter(Boolean).join(' — ')}` : '';
      shownVideo = videoMode();
      const withVideo = clip && shownVideo;
      root.classList.toggle('cl-with-clip', withVideo);
      clipButton.classList.toggle('cl-on', clip);
      clipButton.title = clip ? 'Masquer le clip' : 'Afficher le clip';
      clipButton.setAttribute('aria-label', clipButton.title);
      clipButton.setAttribute('aria-pressed', String(clip));
      clipNote.textContent = clip && !videoMode() ? 'Pas de clip pour ce morceau.' : '';
      const isSynced = synced();
      lines.element.hidden = !isSynced;
      if (isSynced && state) lines.set(`${state.trackId}:${state.lines.length}`, state.lines, state.offset ?? 0);
      plain.textContent = state?.status === 'plain' ? (state.plain ?? '') : '';
      status.textContent = !t
        ? 'Aucun morceau en lecture.'
        : !state || state.status === 'loading'
          ? 'Recherche des paroles…'
          : state.status === 'none' || state.status === 'off'
            ? 'Pas de paroles pour ce morceau.'
            : state.status === 'plain'
              ? 'Pas de paroles synchronisées pour ce morceau : voici le texte de YouTube Music.'
              : '';
      lines.run(immersive && isSynced);
      foot.update();
      tick();
      placePlayer(slot);
    }

    return { root, slot, lines, update, tick };
  }

  function setImmersive(on: boolean): void {
    if (on && !track()) return;
    immersive = on;
    if (on) {
      view ??= buildImmersive();
      // Video mode in YouTube Music: the clip plays here; Song mode: as last chosen.
      clip = videoMode() || clipPreferred;
      if (clip) trySwitchToVideo();
    }
    if (view) {
      view.root.hidden = !on;
      view.update();
      if (on) view.root.querySelector<HTMLElement>('.cl-scroll')?.focus({ preventScroll: true });
    }
    window.clearInterval(ticker);
    ticker = on ? window.setInterval(() => view?.tick(), 250) : 0;
    refresh();
  }

  document.addEventListener(
    'keydown',
    event => {
      if (immersive && event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        setImmersive(false);
      }
    },
    true,
  );

  // --- State ----------------------------------------------------------------------
  function refresh(): void {
    syncTab();
    view?.update();
    // Main fetches lyrics while a view shows them, and ahead while the player page is shown.
    const message = { kind: 'lyrics-view', open: tabShown || immersive, immersive, page: pageOpen };
    const key = JSON.stringify(message);
    if (key !== reported) {
      reported = key;
      deps.report(message);
    }
  }
  // YouTube Music re-renders the tab freely: check often, it is cheap (a few queries).
  window.setInterval(() => {
    syncTab();
    if (immersive && view) {
      // YouTube Music switched between Song and Video (our button, or by itself).
      if (videoMode() !== shownVideo) view.update();
      else placePlayer(view.slot);
    }
  }, 400);
  window.setInterval(refresh, 1500);
  document.addEventListener('click', () => window.setTimeout(refresh, 60), true);

  return {
    tap(raw) {
      const message = sanitizeAgentMessage(raw);
      if (message?.kind === 'snapshot') {
        const changed = message.snapshot.track?.id !== snapshot?.track?.id;
        snapshot = message.snapshot;
        if (changed && !snapshot.track && immersive) setImmersive(false);
        if (changed) refresh();
        else view?.update();
      } else if (message?.kind === 'progress') {
        progress = message.progress;
        progressAt = performance.now();
        tabLines?.update();
        view?.lines.update();
      } else if (message?.kind === 'ready') {
        reported = '';
        refresh();
      }
    },
    lyrics(raw) {
      lyrics = sanitizeLyrics(raw);
      refresh();
    },
    immersive(action) {
      if (action === 'toggle') setImmersive(!immersive);
      else if (action === 'open') setImmersive(true);
      else if (action === 'close') setImmersive(false);
    },
  };
}
