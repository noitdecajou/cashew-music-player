# YouTube Music bridge: what is used

Surveyed on music.youtube.com on 2026-11-05 (Electron 45, signed out), then the agent was validated on the real
page.

## Player `#movie_player`

Methods used: `getPlayerState` (−1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued), `getVideoData`
(`video_id`, `title`, `author`), `getCurrentTime`, `getDuration`, `getVolume`, `isMuted`, `setVolume`, `mute`,
`unMute`, `seekTo(s, true)`, `playVideo`, `pauseVideo`, `addEventListener`.

Events: `onStateChange`, `onVideoDataChange`, `onVolumeChange` (`{volume, muted}`).

## Queue (`ytmusic-player-queue` → `.queue.store.store`)

`getState().queue`: `items`, `selectedItemIndex`, `shuffleEnabled`, `repeatMode`, `automixItems`,
`queueContextParams`, `nextQueueItemId`…; `subscribe(fn)`. Rows: `playlistPanelVideoRenderer` (or
`playlistPanelVideoWrapperRenderer.primaryRenderer…`) with `videoId`, `title`, `shortBylineText`, `thumbnail`.
A wrapper row also holds its other version in `counterpart[0].counterpartRenderer.playlistPanelVideoRenderer`
(the music video of a song, or the song of a video, with its own `videoId`; plus a `segmentMap` pairing their
timelines). The Song/Video switch plays that version: the playing id is then the counterpart's. The agent matches
the current row on both ids and shows the song's details (square cover, not an `i.ytimg.com` frame).

## Player bar `ytmusic-player-bar`

Buttons clicked (to keep the queue logic of Music): `#play-pause-button`, `.next-button`, `.previous-button`,
`.shuffle`, `.repeat`. Attributes: `shuffle-on`, `repeat-mode`.
`ytmusic-like-button-renderer[like-status]`: `LIKE` / `DISLIKE` / `INDIFFERENT`.

## Requests (`ytmusic-app.networkManager.fetch`)

- `/browse {browseId: 'FEmusic_liked_playlists'}` then `{continuation}`: playlists (`musicTwoRowItemRenderer`,
  `VL…`).
- `/browse {browseId: 'VL…'}`: tracks in `musicPlaylistShelfRenderer`; more via `continuationItemRenderer`, then
  `appendContinuationItemsAction`.
- `/search {query}`: returns filter chips (`chipCloudChipRenderer.navigationEndpoint.searchEndpoint.params`).
  Signed out from the development container there is no "Songs" chip, only "Videos": the agent takes "Songs" when
  present, otherwise "Videos". Results: `musicResponsiveListItemRenderer`.
- `/music/get_queue {queueContextParams, queueInsertPosition: 'INSERT_AFTER_CURRENT_VIDEO', videoIds}`.

## Queue actions

- Play an item: click on the `ytmusic-play-button-renderer` of the rendered item
  (`ytmusic-player-queue #contents > *`), in the same order as `items` (verified: jump from the 1st to the 4th track).
- Remove: `queueElement.dispatch({type: 'REMOVE_ITEM', payload: index})`.
- Insert: `ADD_ITEMS` with the items returned by `/music/get_queue`.
- Navigation: `ytmusic-app.dispatchEvent(new CustomEvent('yt-navigate', {bubbles, composed, detail: {endpoint:
  {watchEndpoint}}}))`.

## Miscellaneous

- `navigator.mediaSession.metadata`: only used for the album and the fallback cover, and only when its title
  matches (it is not tied to an id).
- `ytcfg.get('LOGGED_IN')`: sign-in state.
- Real example: the player reports "Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)", the queue
  reports "Never Gonna Give You Up"; the latter is displayed.

## Limits of the development environment

From the development container, audio does not play (video streams are unreachable) and opening a `watch` page
directly triggers Google's bot check; internal navigation from the home page works. Real playback, sign-in and
transitions are validated on Windows.
