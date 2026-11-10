// cashew's synced lyrics inside the YouTube Music page, like Better Lyrics:
// they replace the content of YouTube Music's own Lyrics tab, and an immersive
// view can cover the whole page (cover and title on the left, lyrics on the
// right, over the blurred cover).
//
// This runs in the preload's isolated world: the page's scripts cannot reach
// this code. It reads the DOM (shared with the page), taps the player messages
// relayed to main, and receives the lyrics from main. Only synced lyrics take
// over the tab: otherwise YouTube Music's own lyrics stay.

import { type LyricsState, estimatePosition, sanitizeLyrics } from '../shared/island';
import { type PlayerProgress, type PlayerSnapshot, sanitizeAgentMessage } from '../shared/player';
import { type LyricsLines, createLyricsLines } from '../shared/lyrics-renderer';

export interface YtmLyricsDeps {
  /** A player command for the page agent (seek). */
  command(command: unknown): void;
  /** A message for main (view shown, per-track correction). */
  report(message: unknown): void;
}

export interface YtmLyrics {
  /** Every message the page agent sends (player state, positions). */
  tap(raw: unknown): void;
  lyrics(raw: unknown): void;
  /** 'toggle' | 'open' | 'close' the immersive view. */
  immersive(action: unknown): void;
}

/** The Lyrics tab, marked by the page agent (it reads the tab's page type). */
const LYRICS_TAB = 'ytmusic-player-page tp-yt-paper-tab[data-cashew-lyrics]';
const TAB_RENDERER = 'ytmusic-player-page #tab-renderer';

export function setupYtmLyrics(deps: YtmLyricsDeps): YtmLyrics {
  let snapshot: PlayerSnapshot | null = null;
  let progress: PlayerProgress | null = null;
  let progressAt = 0;
  let lyrics: LyricsState | null = null;
  let tabShown = false;
  let immersive = false;
  let reported: string | null = null;

  const track = (): PlayerSnapshot['track'] => snapshot?.track ?? null;
  const current = (): LyricsState | null => (lyrics && lyrics.trackId === track()?.id ? lyrics : null);
  const synced = (): boolean => current()?.status === 'synced' && (current()?.lines.length ?? 0) > 0;
  const playing = (): boolean => snapshot?.status === 'playing';

  /** Position: the video element when it plays (exact), else the last report, estimated. */
  function now(): number {
    const video = document.querySelector<HTMLVideoElement>('#movie_player video');
    if (video && !video.paused && video.readyState >= 2 && Number.isFinite(video.currentTime)) return video.currentTime;
    if (!progress || progress.trackId !== track()?.id) return 0;
    return estimatePosition(progress, performance.now() - progressAt, playing());
  }
  function seek(time: number): void {
    const id = track()?.id;
    if (id) deps.command({ type: 'seek', trackId: id, position: Math.max(0, time + (current()?.offset ?? 0)) });
  }

  function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  /** Footer: source, correction (−/+ 0.5 s), immersive view. */
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
  let tabScroller: HTMLElement = document.documentElement;
  let tabLines: LyricsLines | null = null;
  const tabFoot = footer(true);

  function tabRenderer(): HTMLElement | null {
    return document.querySelector<HTMLElement>(TAB_RENDERER);
  }

  /** Our lines in the tab when it is shown and synced lyrics are known; YouTube Music's otherwise. */
  function syncTab(): void {
    const tab = document.querySelector(LYRICS_TAB);
    const layout = document.querySelector('ytmusic-app-layout');
    tabShown =
      !!tab &&
      (tab.getAttribute('aria-selected') === 'true' || tab.classList.contains('iron-selected')) &&
      (!layout || layout.hasAttribute('player-page-open'));
    // A tab disabled by YouTube Music (it has no lyrics) is enabled when we have some.
    if (tab && synced() && (tab.hasAttribute('disabled') || tab.getAttribute('aria-disabled') === 'true')) {
      tab.removeAttribute('disabled');
      tab.setAttribute('aria-disabled', 'false');
    }
    const host = tabRenderer();
    const takeOver = tabShown && !immersive && synced() && !!host;
    if (host) {
      if (!tabLines || tabScroller !== host) {
        tabScroller = host;
        tabLines?.run(false);
        tabLines = createLyricsLines({ scroller: host, now, playing, seek });
        tabRoot.replaceChildren(tabLines.element, tabFoot.root);
      }
      if (takeOver && tabRoot.parentElement !== host) host.prepend(tabRoot);
      host.toggleAttribute('cashew-lyrics', takeOver);
    }
    if (tabLines) {
      const state = current();
      if (takeOver && state) tabLines.set(`${state.trackId}:${state.lines.length}`, state.lines, state.offset ?? 0);
      tabLines.run(takeOver);
    }
    tabFoot.update();
  }

  // --- The immersive view --------------------------------------------------------
  let view: {
    root: HTMLElement;
    lines: LyricsLines;
    update(): void;
  } | null = null;

  function buildImmersive(): NonNullable<typeof view> {
    const root = el('div', 'cl-immersive');
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Paroles');
    const bg = el('img', 'cl-bg');
    bg.alt = '';
    const side = el('div', 'cl-side');
    const cover = el('img', 'cl-cover');
    cover.alt = '';
    const title = el('div', 'cl-title');
    const artist = el('div', 'cl-artist');
    side.append(cover, title, artist);
    const main = el('div', 'cl-main');
    const scroll = el('div', 'cl-scroll');
    scroll.tabIndex = 0;
    const status = el('p', 'cl-status');
    const plain = el('div', 'cl-plain');
    const lines = createLyricsLines({ scroller: scroll, now, playing, seek });
    scroll.append(status, lines.element, plain);
    const foot = footer(false);
    main.append(scroll, foot.root);
    const close = el('button', 'cl-close', '✕');
    close.title = 'Quitter le plein écran (Échap)';
    close.setAttribute('aria-label', 'Quitter le plein écran');
    close.addEventListener('click', () => setImmersive(false));
    root.append(bg, side, main, close);
    document.body.append(root);
    return {
      root,
      lines,
      update() {
        const t = track();
        const state = current();
        title.textContent = t?.title ?? '';
        artist.textContent = t ? [t.artist, t.album].filter(Boolean).join(' · ') : '';
        const art = t?.artwork ?? '';
        for (const img of [cover, bg]) if (img.getAttribute('src') !== art) img.src = art;
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
      },
    };
  }

  function setImmersive(on: boolean): void {
    if (on && !track()) return;
    immersive = on;
    if (on) view ??= buildImmersive();
    if (view) {
      view.root.hidden = !on;
      view.update();
      if (on) view.root.querySelector<HTMLElement>('.cl-scroll')?.focus({ preventScroll: true });
    }
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
    // Main fetches lyrics only while a view shows them.
    const state = JSON.stringify({ open: tabShown || immersive, immersive });
    if (state !== reported) {
      reported = state;
      deps.report({ kind: 'lyrics-view', open: tabShown || immersive, immersive });
    }
  }
  // YouTube Music re-renders the tab freely: check often, it is cheap (two queries).
  window.setInterval(syncTab, 400);
  window.setInterval(refresh, 1500);
  document.addEventListener('click', () => window.setTimeout(refresh, 60), true);

  return {
    tap(raw) {
      const message = sanitizeAgentMessage(raw);
      if (message?.kind === 'snapshot') {
        const changed = message.snapshot.track?.id !== snapshot?.track?.id;
        snapshot = message.snapshot;
        if (changed) {
          if (!snapshot.track && immersive) setImmersive(false);
          refresh();
        }
      } else if (message?.kind === 'progress') {
        progress = message.progress;
        progressAt = performance.now();
        tabLines?.update();
        view?.lines.update();
      } else if (message?.kind === 'ready') {
        reported = null;
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
