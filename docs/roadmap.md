# Roadmap

| Stage | Content | Status |
|---|---|---|
| 1. Skeleton | electron-vite, strict TypeScript, modular main process, typed IPC contracts, unit and e2e tests | ✅ |
| 2. YTM bridge | event-driven page agent, commands, volume, operations (library, search, queue, resume), validation | ✅ |
| 3. Mini-players | Actuel, Autoradio, Hi-fi, Autoradio 2000 (HF), Hi-Fi de salon (HF); volume and draggable progress everywhere | ✅ |
| 4. Features | indexed library and favorites, YouTube Music search, interactive queue (play, remove, play next), resume, settings, global shortcut, start with Windows, video fullscreen, offline mode and retries, notification-area menu | ✅ |
| 5. Hardening | security audit and fixes, Electron fuses, Dependabot, lint and formatting in CI | ✅ |
| 6. Island | top-of-screen pill with synced lyrics (LRCLIB), hover details and controls, games mode with per-game settings; settings window with a sidebar | 2.1 beta |

## Verified on the real music.youtube.com

Signed out, from the development container: metadata, up next, volume, global search (20 results with covers),
50-track queue, jump to a track, removal, play next. Signed-in features (library, playlists, resume) are validated on
Windows. A weekly check runs against the real site (`.github/workflows/live-check.yml`).

## Distribution

| Item | Status |
|---|---|
| Windows installer (NSIS) built by GitHub Actions | ✅ |
| Publication in GitHub Releases + `latest.yml` | ✅ |
| In-app updates (check, download on demand, restart) | ✅ |
| Public repository | ✅ |
| Stable version 2.0.0 | ✅ |
| Installer code signing (removes the SmartScreen warning) | not planned for now ([signing.md](signing.md)) |

## Ideas

- "Support cashew" link (donations) in the settings.
- Taskbar thumbnail buttons (previous, play, next).
- Like / dislike from the mini-player.
- Scrolling of long titles on dot-matrix displays.
