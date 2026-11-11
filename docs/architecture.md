# Architecture

```
┌──────────────────────────── BrowserWindow (frameless) ──────────────────────────┐
│ Shell (src/renderer): title bar, toolbar, mini-player, panels                   │
│   window.player (src/preload/shell.ts)                                          │
│        │ shell:command / shell:window / shell:drag      ▲ player:snapshot       │
│        ▼                                                │ player:progress       │
│ Main (src/main)                                         │ ui:state              │
│   index.ts ── validates every input (sanitizeCommand / sanitizeAgentMessage)    │
│   window/main-window.ts: modes, skin sizes, panels, window moves                │
│   ytm/ytm-view.ts: YouTube Music view, navigation, permissions                  │
│        │ ytm:command                                    ▲ ytm:message           │
│        ▼                                                │                       │
│ WebContentsView music.youtube.com (partition persist:music)                     │
│   src/preload/ytm.ts (isolated world): relay only                               │
│   src/preload/page-agent.ts (page world): subscribes to the YTM player          │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## Principles

1. **Push, don't poll.** The page agent subscribes to player events (`onStateChange`, `onVideoDataChange`,
   `onVolumeChange`), to media events and to the queue store. There is no observer on the whole DOM and no fast
   heartbeat: only a safety net every 3 s (a few property reads).
2. **One card, then its clock.** The agent publishes a track's `snapshot` before its first `progress`, on a single
   ordered channel. Each position carries its track id; the shell ignores positions that do not match the card on
   display. The metadata/clock races of 1.x are thus impossible by construction (dedicated e2e test).
3. **Identity comes from the player.** `getVideoData().video_id` identifies the track; the Music title and artist
   come from the queue row with that id, otherwise from the player data.
4. **Nothing is trusted.** Page messages and shell commands are validated (shapes, bounds, ids, https URLs). The
   YouTube Music page only gets two relay functions.
5. **Frugal when hidden.** Positions are only streamed while the window is visible.
6. **The hand wins.** While dragging (progress, volume), external updates are ignored; the progress bar only seeks
   on release.

## Window

- Large player: title bar (30 px) + toolbar (52 px); YouTube Music below.
- Panels (search, queue, settings): a renderer page (`?view=drawer`) in its own native view, stacked above YouTube
  Music. In the large player it covers the right 380 px without resizing YouTube Music, and closes on a click in
  YouTube Music; in the mini-player it fills the space under the card (total height 450).
- Mini-player: content size set by the skin (`src/shared/themes.ts`), + 30 px when the title bar is shown; an open
  panel makes the total height 450. The YouTube Music view is detached and keeps playing.
- Moving the mini-player without a title bar: grip, cover or title (pointer capture, screen positions from the main
  process), arrow keys on the grip.

## Lyrics

- **Engine** (`src/shared/lyrics-renderer.ts`, styles `src/shared/lyrics.css`, classes `cl-…`): builds the lines
  (instrumental breaks ≥ 5 s are dots), marks the sung line, fills it word by word (characters as a proxy for
  time; a registered, animated `--cl-fill` paints each word through a gradient, so nothing switches abruptly), eases the scroll so the line sits a third of the way down, seeks on click, pauses the follow 3.5 s after a
  wheel, touch, key or scrollbar move. Driven by a 100 ms timer plus animation frames while playing (never frames
  alone).
- **In YouTube Music** (`src/preload/ytm-lyrics.ts`, isolated world of the preload, so the page's scripts cannot
  reach it): the page agent marks the Lyrics tab (`data-cashew-lyrics`, found by its page type
  `MUSIC_PAGE_TYPE_TRACK_LYRICS`). When that tab is selected and synced lyrics are known, the host puts its lines in
  `#tab-renderer` and hides YouTube Music's content (`cashew-lyrics` attribute); otherwise YouTube Music's own lyrics
  stay; while lyrics are looked for, a short wait replaces YouTube Music's text (8 s at most). The full-screen view is
  a fixed overlay over the whole page: cover, title, artist, progress, previous / play-pause / next, up next; with
  the clip on, YouTube Music's own player (`ytmusic-player#player`) is moved over a 16:9 place of the view (fixed
  position, its page `cashew-clip`: invisible except the player, above the overlay, no transform) and put back on
  leaving. Styles go in with `webFrame.insertCSS` (outside the
  page's content security policy). The position comes from the `<video>` element while it plays, else from the
  player reports relayed to main; a click seeks through the page agent. The host reports `lyrics-view` (shown or not)
  and `lyrics-offset` to main; main sends `ytm:lyrics` (the lyrics) and `ytm:lyrics-view` (immersive toggle).
- **Mini-player**: panel `lyrics` of the drawer (`src/renderer/src/lyrics-view.ts`), same engine; plain lyrics or a
  status otherwise.
- **Sources** (`src/main/services/lyrics.ts`): YouTube Music's own timed lyrics first (`ytm-synced.ts`: `/next` →
  `MPLY…` → `/browse` asked as the mobile app, anonymous; often plain only), then LRCLIB. Requested while the island
  shows lyrics, a lyrics view is open or the player page is shown (fetched ahead). The lookup waits for the track's
  title and uses its latest details; a track already playing (duration known) is looked up at once. Failures are logged; a network failure is tried again once. Without synced
  lyrics, main asks the page agent for YouTube Music's plain lyrics (`lyrics` operation).

## Island and settings windows

- **Island** (`src/main/window/island-window.ts`, page `island.html`): a transparent, frameless, always-on-top
  (`screen-saver` level), non-focusable window hanging from the top edge of the chosen display. It ignores the mouse
  (clicks go through) except while the pointer is over the pill: the page reports it (`island:hover`). It receives the
  snapshot, the progress and the lyrics, and may only send play/pause, next and previous. Visibility and position come
  from `decideIsland` (`src/shared/island.ts`): mode (off, always, games), game list, automatic fullscreen detection.
- **Foreground** (`src/main/services/foreground.ts`): on Windows, polls every 1.5 s while the island is on or the
  settings are open: the foreground window's process path (asked once per process) and whether it covers its monitor
  (read-only user32/kernel32 calls through koffi; no injection, no hooks). `isGame` (`src/shared/island.ts`) decides
  from the install folder (game stores) and the games Windows knows (`GameConfigStore`, read with `reg.exe`); browsers,
  Explorer, launchers and shell overlays never count.
- **Lyrics** (`src/main/services/lyrics.ts`): see "Lyrics" above; LRCLIB `/api/get` (title, artist, album,
  duration), then `/api/search`; LRC parsed in `src/shared/island.ts`, synced lyrics cached per track on disk.
- **Display choices**: "on track change" mode shows the pill compact or detailed (`trackView`); the animations
  follow the `animations` setting, not Windows' "show animations" (`prefers-reduced-motion`).
- **Settings** (`src/main/window/settings-window.ts`, page `settings.html`): a regular window with a sidebar
  (General, Player, Island, Games, Updates, About); same IPC rights as the shell.

## Page operations

Main asks the agent for actions with `ytm:command` `{type: 'op', id, op, payload}`; the agent answers `op-result`
with the same `id`. Each result is validated in `src/shared/ops.ts`; a page navigation fails pending operations, and
each operation has a timeout.

| Operation | Purpose |
|---|---|
| `library-playlists`, `playlist-songs` | Library (`/browse`, with continuation pages); only the playlist shelf is read, not the suggestions |
| `search` | YouTube Music search (`/search`, "Songs" filter, otherwise "Videos", read from the response) |
| `play` | Internal `watchEndpoint` navigation |
| `queue-play`, `queue-remove`, `queue-insert-next` | Music queue (item button, `REMOVE_ITEM`, `/music/get_queue` + `ADD_ITEMS`), with index check |
| `resume`, `session` | Resume at a position; current state, saved on quit |

## Services (src/main/services)

- `library.ts`: index of the tracks of every playlist, per account (key = SHA-256 of the account id), stored in
  `userData/library/`, refreshed after 6 h; an incomplete refresh keeps the previous index. Playlist favorites
  (200 max).
- `resume.ts`: last track, playlist and position per account (`userData/sessions/`).
- `preferences.ts` (+ 1.x migration), `shortcut.ts`, `startup.ts`, `json-file.ts` (atomic writes),
  `updater.ts`, `integrity.ts` (installed-files check), `log.ts`.

## Tests

- `test/unit`: validation, navigation rules, preferences and 1.x migration, geometry, update metadata, integrity.
- `test/e2e`: real Electron + `test/fixtures/ytm.html`, a fake page that reproduces the player API, the queue,
  `networkManager.fetch` and the navigation observed on the real site. `features.test.mjs` covers library, search,
  playlists, queue, settings, fullscreen and resume after a restart; `player.test.mjs` covers card/clock ordering
  during natural transitions with a late queue, commands, progress dragging, volume, skin sizes and rejection of
  invalid commands; `permissions.test.mjs` checks that camera and microphone are never granted.
- `test/e2e/island.test.mjs`: island modes, position, clock, hover and controls, restricted commands, games mode
  (the foreground is read from a file), settings window. `MP_LYRICS_FIXTURE` and `MP_FAKE_FOREGROUND` replace
  LRCLIB and the Windows foreground in unpackaged builds only.
- `test/live`: weekly check against the real music.youtube.com (`.github/workflows/live-check.yml`).
