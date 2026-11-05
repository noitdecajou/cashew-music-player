/**
 * Runs in the YouTube Music page world (not the isolated preload world), so it
 * can use the player API (#movie_player) and Music's queue store.
 *
 * It is injected with Function.prototype.toString(): it must stay fully
 * self-contained (no imports, no references to outer variables).
 *
 * Design: push, not pull. The agent subscribes to the player's own events and
 * publishes a snapshot when something changes, plus a clock tagged with the
 * track id. The snapshot for a track is always emitted before its first clock,
 * on the same ordered channel, so consumers never pair a clock with the wrong
 * track.
 *
 * Player API surface verified against music.youtube.com on 2026-11-05:
 * getPlayerState, getVideoData, getCurrentTime, getDuration, getVolume,
 * isMuted, setVolume, mute, unMute, seekTo, playVideo, pauseVideo,
 * addEventListener('onStateChange' | 'onVideoDataChange' | 'onVolumeChange').
 * Queue state keys: items, selectedItemIndex, shuffleEnabled, repeatMode,
 * automixItems.
 */
export function pageAgent(): void {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const w = window as any;
  if (w.__musicPlayerAgentInstalled) return;
  const bridge = w.__musicPlayerBridge;
  if (!bridge || typeof bridge.emit !== 'function') return;
  w.__musicPlayerAgentInstalled = true;

  const VIDEO_ID = /^[\w-]{11}$/;
  let player: any = null;
  let queueStore: any = null;
  let unsubscribeQueue: (() => void) | null = null;
  let barObserver: MutationObserver | null = null;
  let observedBar: Element | null = null;
  let progressEnabled = true;
  let lastSnapshotJson = '';
  let lastSnapshotTrack = '';
  let lastProgressKey = '';
  let scheduled = false;

  const emit = (message: unknown): void => {
    try { bridge.emit(message); } catch { /* bridge gone during unload */ }
  };
  const text = (value: any): string =>
    (value?.simpleText ?? value?.runs?.map((run: any) => run?.text ?? '').join('') ?? '').trim();
  const unwrap = (item: any): any =>
    item?.playlistPanelVideoRenderer ??
    item?.playlistPanelVideoWrapperRenderer?.primaryRenderer?.playlistPanelVideoRenderer ??
    null;
  const call = <T,>(fn: () => T, fallback: T): T => {
    try { return fn(); } catch { return fallback; }
  };

  function findPlayer(): any {
    const element = document.querySelector('#movie_player') as any;
    return typeof element?.getPlayerState === 'function' && typeof element?.getVideoData === 'function' ? element : null;
  }

  function findQueue(): { state: any; store: any } | null {
    const element = document.querySelector('ytmusic-player-queue') as any;
    for (const store of [element?.queue?.store?.store, element?.queue?.store, element?.store]) {
      const state = call(() => store?.getState?.()?.queue, null);
      if (state && Array.isArray(state.items)) return { state, store };
    }
    return null;
  }

  /** Bigger artwork: Music serves =w60-h60 thumbnails in the queue. */
  function upscale(url: string): string {
    return url.replace(/=w\d+-h\d+/, '=w544-h544');
  }

  function bestThumbnail(thumbnails: any): string {
    const list = thumbnails?.thumbnails;
    if (!Array.isArray(list) || !list.length) return '';
    const url = list[list.length - 1]?.url;
    return typeof url === 'string' ? upscale(url) : '';
  }

  function currentRow(state: any, id: string): { row: any; index: number } | null {
    const items: any[] = state?.items ?? [];
    const selected = Number.isInteger(state?.selectedItemIndex) ? state.selectedItemIndex : -1;
    const selectedRow = unwrap(items[selected]);
    if (selectedRow?.videoId === id) return { row: selectedRow, index: selected };
    // Fallback: the only row with this id (duplicates are ambiguous).
    const matches = items.map((item, index) => ({ row: unwrap(item), index })).filter(m => m.row?.videoId === id);
    return matches.length === 1 ? matches[0]! : null;
  }

  function statusOf(code: number, id: string): string {
    switch (code) {
      case 1: return 'playing';
      case 2: return 'paused';
      case 3: return 'buffering';
      case 0: return 'ended';
      case 5: return 'paused';
      default: return id ? 'loading' : 'idle';
    }
  }

  function snapshot(): any {
    const data = call(() => player?.getVideoData?.(), null) ?? {};
    const id: string = VIDEO_ID.test(data.video_id ?? '') ? data.video_id : '';
    const queue = findQueue();
    const bar = document.querySelector('ytmusic-player-bar') as any;
    const match = id && queue ? currentRow(queue.state, id) : null;
    const row = match?.row;

    let track = null;
    if (id) {
      const title = text(row?.title) || data.title || '';
      const artist = text(row?.shortBylineText) || text(row?.longBylineText).split(' • ')[0] || data.author || '';
      const media = (navigator as any).mediaSession?.metadata;
      // mediaSession is not tied to an id: only trust it when it names this title.
      const mediaMatches = !!media && media.title === title;
      let artwork = bestThumbnail(row?.thumbnail);
      if (!artwork && mediaMatches && media.artwork?.length) artwork = upscale(String(media.artwork[media.artwork.length - 1].src ?? ''));
      if (!artwork) artwork = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
      track = { id, title, artist, album: mediaMatches ? String(media.album ?? '') : '', artwork };
    }

    let next = null;
    if (match && queue) {
      const following = unwrap(queue.state.items[match.index + 1]) ?? unwrap(queue.state.automixItems?.[0]);
      if (following && following.videoId !== id) next = { title: text(following.title), artist: text(following.shortBylineText) };
    }

    const likeElement = document.querySelector('ytmusic-player-bar ytmusic-like-button-renderer');
    const shuffleAttr = bar?.getAttribute?.('shuffle-on');
    const loggedIn = call(() => w.ytcfg?.get?.('LOGGED_IN'), undefined);
    return {
      status: statusOf(call(() => player?.getPlayerState?.(), -1), id),
      track,
      next,
      shuffle: typeof queue?.state.shuffleEnabled === 'boolean' ? queue.state.shuffleEnabled
        : typeof bar?.shuffleOn === 'boolean' ? bar.shuffleOn
        : shuffleAttr == null ? null : shuffleAttr !== 'false',
      repeat: queue?.state.repeatMode ?? bar?.getAttribute?.('repeat-mode') ?? null,
      like: likeElement?.getAttribute('like-status') ?? null,
      volume: call(() => player?.getVolume?.(), 100),
      muted: call(() => player?.isMuted?.(), false) === true,
      signedIn: typeof loggedIn === 'boolean' ? loggedIn : null,
    };
  }

  function publishSnapshot(): void {
    scheduled = false;
    attach();
    const value = snapshot();
    const json = JSON.stringify(value);
    if (json === lastSnapshotJson) return;
    lastSnapshotJson = json;
    lastSnapshotTrack = value.track?.id ?? '';
    lastProgressKey = '';
    emit({ kind: 'snapshot', snapshot: value });
    publishProgress();
  }

  function schedule(): void {
    if (scheduled) return;
    scheduled = true;
    // Next task, not microtask: the player updates its data after its events.
    setTimeout(publishSnapshot, 0);
  }

  function publishProgress(): void {
    if (!progressEnabled || !player) return;
    const id = call(() => player.getVideoData?.()?.video_id, '');
    if (!VIDEO_ID.test(id ?? '')) return;
    // Never send a clock before the card of its track.
    if (id !== lastSnapshotTrack) { schedule(); return; }
    const duration = call(() => player.getDuration?.(), 0);
    const position = call(() => player.getCurrentTime?.(), 0);
    if (!Number.isFinite(duration) || !Number.isFinite(position)) return;
    const progress = { trackId: id, duration: Math.max(0, duration), position: Math.max(0, Math.min(position, duration || position)) };
    const key = `${id}|${Math.round(progress.duration)}|${progress.position.toFixed(1)}`;
    if (key === lastProgressKey) return;
    lastProgressKey = key;
    emit({ kind: 'progress', progress });
  }

  /** (Re)binds to the player, queue store and player bar when they appear or change. */
  function attach(): void {
    const found = findPlayer();
    if (found && found !== player) {
      player = found;
      for (const name of ['onStateChange', 'onVideoDataChange', 'onVolumeChange']) {
        call(() => player.addEventListener(name, schedule), undefined);
      }
    }
    const queue = findQueue();
    if (queue && queue.store !== queueStore) {
      unsubscribeQueue?.();
      queueStore = queue.store;
      const off = call(() => queueStore.subscribe?.(schedule), null);
      unsubscribeQueue = typeof off === 'function' ? off : null;
    }
    const bar = document.querySelector('ytmusic-player-bar');
    if (bar && bar !== observedBar) {
      barObserver?.disconnect();
      observedBar = bar;
      barObserver = new MutationObserver(schedule);
      barObserver.observe(bar, { subtree: true, attributes: true, attributeFilter: ['like-status', 'shuffle-on', 'repeat-mode'] });
    }
  }

  // Media events do not bubble but can be captured at document level; this also
  // covers a media element replaced by the player.
  const onMedia = (event: Event): void => {
    if (!(event.target instanceof HTMLMediaElement)) return;
    if (event.type === 'timeupdate') publishProgress();
    else { schedule(); publishProgress(); }
  };
  for (const type of ['timeupdate', 'durationchange', 'loadedmetadata', 'play', 'pause', 'ended', 'seeked', 'emptied']) {
    document.addEventListener(type, onMedia, true);
  }

  function click(selector: string): boolean {
    const button = document.querySelector(`ytmusic-player-bar ${selector}`) as HTMLElement | null;
    button?.click();
    return !!button;
  }

  function run(command: any): void {
    attach();
    switch (command?.type) {
      case 'toggle-play':
        if (!click('#play-pause-button')) {
          if (call(() => player?.getPlayerState?.(), -1) === 1) player?.pauseVideo?.(); else player?.playVideo?.();
        }
        break;
      case 'play': player?.playVideo?.(); break;
      case 'pause': player?.pauseVideo?.(); break;
      // Bar buttons keep Music's own queue semantics (previous restarts the track first).
      case 'next': if (!click('.next-button')) player?.nextVideo?.(); break;
      case 'previous': if (!click('.previous-button')) player?.previousVideo?.(); break;
      case 'shuffle': click('.shuffle'); break;
      case 'repeat': click('.repeat'); break;
      case 'seek':
        if (call(() => player?.getVideoData?.()?.video_id, '') === command.trackId) player?.seekTo?.(command.position, true);
        break;
      case 'volume':
        player?.setVolume?.(command.volume);
        if (command.volume > 0 && call(() => player?.isMuted?.(), false)) player?.unMute?.();
        break;
      case 'mute': if (command.muted) player?.mute?.(); else player?.unMute?.(); break;
      case 'progress-stream':
        progressEnabled = command.enabled === true;
        lastProgressKey = '';
        break;
    }
    schedule();
    publishProgress();
  }

  bridge.onCommand?.(run);

  // Look for the player at a low rate until it exists. Afterwards, a slow
  // safety net for missed events (cheap: a few property reads, no DOM scan).
  const waitForPlayer = setInterval(() => {
    attach();
    if (player) { clearInterval(waitForPlayer); schedule(); }
  }, 500);
  setInterval(schedule, 3000);
  schedule();
  emit({ kind: 'ready' });
}
