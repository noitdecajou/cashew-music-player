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
  let queueWatching = false;
  let lastQueueKey = '';
  let accountKey = '';
  let accountIdentity: string | null = null;

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
      let playlistId = call(() => String(player?.getPlaylistId?.() ?? ''), '');
      if (!playlistId) playlistId = call(() => new URL(location.href).searchParams.get('list') ?? '', '');
      track = { id, title, artist, album: mediaMatches ? String(media.album ?? '') : '', artwork, playlistId };
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
      accountKey: currentAccountKey(loggedIn === true),
    };
  }

  /** SHA-256 of the account id, computed asynchronously once per identity. */
  function currentAccountKey(loggedIn: boolean): string {
    const identity = loggedIn ? String(call(() => w.ytcfg?.get?.('DATASYNC_ID') || w.ytcfg?.get?.('CHANNEL_ID') || '', '')) : '';
    if (identity !== accountIdentity) {
      accountIdentity = identity;
      accountKey = '';
      if (identity) {
        void crypto.subtle.digest('SHA-256', new TextEncoder().encode('music-player-account-v2:' + identity)).then(bytes => {
          if (accountIdentity !== identity) return;
          accountKey = [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
          schedule();
        });
      }
    }
    return accountKey;
  }

  // ---------------------------------------------------------------- queue --
  function queueItems(state: any): any[] {
    return (state?.items ?? []).map((item: any) => {
      const row = unwrap(item);
      return row ? { videoId: row.videoId, title: text(row.title), artist: text(row.shortBylineText) || text(row.longBylineText).split(' • ')[0],
        artwork: bestThumbnail(row.thumbnail), duration: text(row.lengthText) } : { videoId: '' };
    });
  }

  function publishQueue(): void {
    if (!queueWatching) return;
    const queue = findQueue();
    const items = queue ? queueItems(queue.state) : [];
    const id = call(() => player?.getVideoData?.()?.video_id, '');
    const match = queue && id ? currentRow(queue.state, id) : null;
    const value = { items, current: match ? match.index : -1 };
    const key = JSON.stringify(value);
    if (key === lastQueueKey) return;
    lastQueueKey = key;
    emit({ kind: 'queue', queue: value });
  }

  // ----------------------------------------------------------- operations --
  const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
  const musicApp = (): any => document.querySelector('ytmusic-app');

  async function request(route: string, body: unknown): Promise<any> {
    const manager = musicApp()?.networkManager;
    if (typeof manager?.fetch !== 'function') throw new Error('YouTube Music n’est pas encore prêt. Réessaie dans un instant.');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        manager.fetch(route, body),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('YouTube Music met trop de temps à répondre.')), 20000); }),
      ]);
    } finally { clearTimeout(timer); }
  }

  function walk(root: any, visit: (node: any) => void): void {
    const stack = [root];
    const seen = new Set<any>();
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== 'object' || seen.has(node)) continue;
      seen.add(node);
      visit(node);
      // Reverse push: nodes are visited in document order (playlists keep their order).
      const values = Object.values(node);
      for (let i = values.length - 1; i >= 0; i--) if (values[i] && typeof values[i] === 'object') stack.push(values[i]);
    }
  }

  function tokenIn(root: any): string {
    let token = '';
    walk(root, node => {
      token ||= node.nextContinuationData?.continuation ?? node.continuationEndpoint?.continuationCommand?.token ?? node.continuationCommand?.token ?? '';
    });
    return token;
  }

  function songFrom(renderer: any): any {
    const columns = renderer.flexColumns ?? [];
    const titleText = columns[0]?.musicResponsiveListItemFlexColumnRenderer?.text;
    const videoId = renderer.playlistItemData?.videoId
      ?? titleText?.runs?.find((run: any) => run.navigationEndpoint?.watchEndpoint?.videoId)?.navigationEndpoint.watchEndpoint.videoId
      ?? renderer.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId;
    if (!VIDEO_ID.test(videoId ?? '')) return null;
    const runs: any[] = columns[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? [];
    const pageType = (run: any): string => run.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType ?? '';
    const artists = runs.filter(run => /ARTIST|USER_CHANNEL/.test(pageType(run))).map(run => run.text);
    const artist = artists.length ? artists.join(', ') : (text({ runs }).split(' • ').find(part => !/^(Song|Video|Titre|Vidéo|Chanson)$/i.test(part)) ?? '');
    return { videoId, title: text(titleText), artist, artwork: bestThumbnail(renderer.thumbnail?.musicThumbnailRenderer?.thumbnail) };
  }

  /** Rows of the playlist shelf only (not the "suggestions" shelf of the page). */
  async function playlistSongs(payload: any): Promise<any> {
    const data = await request('/browse', payload.continuation ? { continuation: payload.continuation } : { browseId: payload.browseId });
    const containers: any[] = [];
    walk(data, node => {
      if (node.musicPlaylistShelfRenderer) containers.push(node.musicPlaylistShelfRenderer);
      if (node.musicPlaylistShelfContinuation) containers.push(node.musicPlaylistShelfContinuation);
      if (payload.continuation && node.musicShelfContinuation) containers.push(node.musicShelfContinuation);
      if (payload.continuation && node.appendContinuationItemsAction) containers.push({ contents: node.appendContinuationItemsAction.continuationItems });
    });
    if (!containers.length) throw new Error('Format de playlist YouTube Music non reconnu.');
    const items: any[] = [];
    let continuation = '';
    for (const container of containers) {
      for (const row of container.contents ?? []) {
        if (row.musicResponsiveListItemRenderer) { const song = songFrom(row.musicResponsiveListItemRenderer); if (song) items.push(song); }
        if (row.continuationItemRenderer) continuation ||= tokenIn(row.continuationItemRenderer);
      }
      continuation ||= tokenIn(container.continuations);
    }
    return { items, continuation };
  }

  async function libraryPlaylists(payload: any): Promise<any> {
    const data = await request('/browse', payload.continuation ? { continuation: payload.continuation } : { browseId: 'FEmusic_liked_playlists' });
    const items = new Map<string, any>();
    let continuation = '';
    walk(data, node => {
      const r = node.musicTwoRowItemRenderer ?? node.gridPlaylistRenderer;
      if (r) {
        const id = r.navigationEndpoint?.browseEndpoint?.browseId
          ?? r.title?.runs?.find((run: any) => run.navigationEndpoint?.browseEndpoint)?.navigationEndpoint.browseEndpoint.browseId;
        if (typeof id === 'string' && id.startsWith('VL') && !items.has(id)) {
          items.set(id, { id, title: text(r.title), subtitle: text(r.subtitle), artwork: bestThumbnail(r.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail) });
        }
      }
      if (node.gridRenderer || node.gridContinuation || node.appendContinuationItemsAction) {
        continuation ||= tokenIn((node.gridRenderer ?? node.gridContinuation)?.continuations ?? node.appendContinuationItemsAction?.continuationItems?.at?.(-1));
      }
    });
    return { items: [...items.values()], continuation };
  }

  async function search(payload: any): Promise<any> {
    const query = String(payload.query ?? '').slice(0, 200);
    let data = await request('/search', { query });
    // Prefer Music's "Songs" filter; it is absent in some regions/sessions, then "Videos".
    const chips: any[] = [];
    walk(data, node => { if (node.chipCloudChipRenderer) chips.push(node.chipCloudChipRenderer); });
    const chip = ['Songs', 'Titres', 'Videos', 'Vidéos'].map(name => chips.find(c => c.uniqueId === name || text(c.text) === name)).find(Boolean);
    const params = chip?.navigationEndpoint?.searchEndpoint?.params;
    if (params) data = await request('/search', { query, params });
    const items: any[] = [];
    const seen = new Set<string>();
    walk(data, node => {
      const song = node.musicResponsiveListItemRenderer ? songFrom(node.musicResponsiveListItemRenderer) : null;
      if (song && !seen.has(song.videoId)) { seen.add(song.videoId); items.push(song); }
    });
    return { items: items.slice(0, 50), continuation: '' };
  }

  function navigate(endpoint: any): void {
    const target = musicApp() ?? document;
    target.dispatchEvent(new CustomEvent('yt-navigate', { bubbles: true, composed: true, detail: { endpoint } }));
  }

  function queueContext(): { element: any; store: any; state: any } {
    const element = document.querySelector('ytmusic-player-queue') as any;
    const queue = findQueue();
    if (!element || !queue) throw new Error('La file YouTube Music est indisponible. Lance d’abord un morceau.');
    return { element, store: queue.store, state: queue.state };
  }

  function checkedIndex(state: any, index: number, videoId: string): void {
    if (!Number.isInteger(index) || unwrap(state.items?.[index])?.videoId !== videoId) {
      throw new Error('La file a changé entre-temps. Réessaie.');
    }
  }

  async function waitFor<T>(read: () => T | null | undefined | false, timeout: number, message: string): Promise<T> {
    const end = Date.now() + timeout;
    for (;;) {
      const value = read();
      if (value) return value;
      if (Date.now() > end) throw new Error(message);
      await sleep(100);
    }
  }

  const operations: Record<string, (payload: any) => Promise<unknown>> = {
    'library-playlists': libraryPlaylists,
    'playlist-songs': playlistSongs,
    search,
    play: async payload => {
      const endpoint: any = {};
      if (payload.videoId) endpoint.videoId = payload.videoId;
      if (payload.playlistId) endpoint.playlistId = payload.playlistId;
      navigate({ watchEndpoint: endpoint });
      return { ok: true };
    },
    'queue-play': async payload => {
      const { element, state } = queueContext();
      checkedIndex(state, payload.index, payload.videoId);
      const rendered = element.querySelectorAll('#contents > *')[payload.index];
      const item = rendered?.matches?.('ytmusic-player-queue-item') ? rendered : rendered?.querySelector?.('ytmusic-player-queue-item');
      const button = item?.querySelector('ytmusic-play-button-renderer');
      if (button && item.querySelector('.song-title')?.textContent?.trim() === text(unwrap(state.items[payload.index])?.title)) button.click();
      else navigate({ watchEndpoint: { videoId: payload.videoId, playlistId: call(() => player?.getPlaylistId?.(), '') || undefined, index: payload.index } });
      return { ok: true };
    },
    'queue-remove': async payload => {
      const { element, store, state } = queueContext();
      checkedIndex(state, payload.index, payload.videoId);
      if (currentRow(state, call(() => player?.getVideoData?.()?.video_id, ''))?.index === payload.index) throw new Error('Impossible de retirer le morceau en cours.');
      const removed = state.items[payload.index];
      element.dispatch({ type: 'REMOVE_ITEM', payload: payload.index });
      if ((store.getState()?.queue?.items ?? []).includes(removed)) throw new Error('Le retrait n’a pas pu être confirmé.');
      return { ok: true };
    },
    'queue-insert-next': async payload => {
      const { element, store, state } = queueContext();
      if (typeof element.dispatch !== 'function') throw new Error('La file YouTube Music est inaccessible.');
      const id = call(() => player?.getVideoData?.()?.video_id, '');
      const current = id ? currentRow(state, id) : null;
      if (!current) throw new Error('Lance d’abord un morceau avant d’utiliser « Lire ensuite ».');
      const data = await request('/music/get_queue', { queueContextParams: state.queueContextParams, queueInsertPosition: 'INSERT_AFTER_CURRENT_VIDEO', videoIds: [payload.videoId] });
      const items = (data?.queueDatas ?? []).map((entry: any) => entry.content).filter((item: any) => unwrap(item)?.videoId === payload.videoId).slice(0, 1);
      if (!items.length) throw new Error('YouTube Music n’a pas renvoyé ce morceau.');
      const fresh = store.getState().queue;
      const index = currentRow(fresh, id)?.index ?? current.index;
      element.dispatch({ type: 'ADD_ITEMS', payload: { nextQueueItemId: fresh.nextQueueItemId, index: index + 1, items, shuffleEnabled: !!fresh.shuffleEnabled, shouldAssignIds: true } });
      if (unwrap(store.getState().queue?.items?.[index + 1])?.videoId !== payload.videoId) throw new Error('L’ajout n’a pas pu être confirmé. Vérifie la file.');
      return { ok: true };
    },
    resume: async payload => {
      const currentId = (): string => call(() => player?.getVideoData?.()?.video_id, '');
      if (currentId() !== payload.videoId) {
        navigate({ watchEndpoint: payload.playlistId ? { videoId: payload.videoId, playlistId: payload.playlistId } : { videoId: payload.videoId } });
      }
      await waitFor(() => { attach(); return currentId() === payload.videoId; }, 15000, 'Le morceau à reprendre n’a pas pu être chargé.');
      if (payload.position > 1) {
        await waitFor(() => call(() => player.getDuration(), 0) > 0, 10000, 'La durée du morceau est indisponible.');
        player.seekTo(Math.min(payload.position, player.getDuration() - 1), true);
      }
      player.playVideo?.();
      return { ok: true };
    },
    session: async () => ({
      accountKey,
      videoId: call(() => player?.getVideoData?.()?.video_id, ''),
      playlistId: call(() => String(player?.getPlaylistId?.() ?? ''), ''),
      position: call(() => player?.getCurrentTime?.(), 0),
    }),
  };

  async function runOperation(command: any): Promise<void> {
    const operation = operations[command.op];
    try {
      if (!operation) throw new Error('Opération inconnue.');
      const value = await operation(command.payload ?? {});
      emit({ kind: 'op-result', id: command.id, ok: true, value, error: '' });
    } catch (error) {
      emit({ kind: 'op-result', id: command.id, ok: false, value: null, error: error instanceof Error ? error.message : String(error) });
    }
    schedule();
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
    if (queueWatching) setTimeout(publishQueue, 0);
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
      case 'op': void runOperation(command); return;
      case 'queue-watch':
        queueWatching = command.enabled === true;
        lastQueueKey = '';
        if (queueWatching) publishQueue();
        return;
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
