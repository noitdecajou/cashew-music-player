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
- `test/live`: weekly check against the real music.youtube.com (`.github/workflows/live-check.yml`).
