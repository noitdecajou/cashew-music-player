# Changelog

## 2.1.0-beta.1

- **Island** (optional, off by default): a pill at the top of the screen showing a small cover and the lyric line being sung (or title and artist). On hover it grows to show the cover, title, artist, progress and the next track, with play/pause and next. Position (left, center, right), display and clock (hidden, left, right) are configurable. It never takes the focus and works while the player window is hidden.
- **Synced lyrics** from LRCLIB (lrclib.net, optional, on by default with the island): title, artist, album and duration of the track are sent to find the lyrics. YouTube Music only provides lyrics without timing.
- **Games**: the island can show only while a game is in front, with a list of games (enabled or not, position for each, centered by default) and optional detection of any fullscreen application. Windows only; nothing is injected into games (safe with anti-cheat software). Visible over borderless fullscreen games, not over exclusive fullscreen.
- **Settings** move to their own window, with sections in a sidebar: General, Player, Island, Games, Updates, About.

## 2.0.0

First stable version of **cashew**, a complete rewrite of the 1.x player (Electron + TypeScript). Since 1.7:

- **Mini-players**: 5 skins (Actuel, Autoradio, Hi-fi, Autoradio 2000, Hi-Fi de salon), each with volume and a draggable progress bar.
- **Library and search**: fast search across the user's playlists (accent- and case-insensitive), favorites, search across the whole of YouTube Music.
- **Interactive queue** (play, remove, play next), **resume** of the last track at its position.
- **Settings**: global shortcut, start with Windows (quiet or not), pin on top.
- **Updates** from within the application, with nothing downloaded without consent.
- **Reliability**: detection of files quarantined by an antivirus, display repair, diagnostic log.
- **Security**: full audit and fixes (camera and microphone never granted, navigation limited to YouTube Music and Google, hardened application and installation); see `docs/security.md`.

Beta installations receive this version as an update; afterwards, only stable versions are offered.

## 2.0.0-beta.9

- GitHub repository recreated (history cleaned of personal data): this version republishes beta.8 unchanged, so that installed applications find their updates again. No change in the application.

## 2.0.0-beta.8

Security audit (Cloudflare *security-audit-skill* method) and fixes; see `docs/security.md`.

- YouTube Music no longer has access to the camera or the microphone (they were granted without a prompt to any page shown in the player); only video fullscreen and clipboard write remain allowed, and only for music.youtube.com.
- Navigation: lookalike domains such as `accounts.google.attacker.example` are blocked.
- Updates: once releases are signed, the application will only install an update signed by the same publisher.
- Installation: always for the current user, in their folder (`%LOCALAPPDATA%\Programs`); no more "all users" installation or custom folder.
- Hardened application: the executable can no longer run Node.js code or be debugged from the command line; it only loads its own verified code; the Google session cookies are encrypted on disk (Windows). After installing this version, going back to an earlier one requires signing in to YouTube Music again.
- Miscellaneous: video fullscreen refused in the mini-player; the resume position is no longer saved in another account's session.
- Project: weekly dependency update proposals (Dependabot), pinned actions, publication restricted to `main`, code (oxlint) and formatting (Prettier) checks in CI.

## 2.0.0-beta.7

- **cashew** identity: glyph and name in the title bar, the window, the notification area and the shortcuts ("Cashew Music Player"); new application icon.
- Mini-players: "CASHEW" label; the glyph replaces the grip (Actuel, Autoradio) or the LED (Hi-fi), in each skin's color; "cashew" on the idle Autoradio display.
- Empty cover: muted glyph; Settings footer with the version; splash screen while YouTube Music loads.
- MIT license; automatic weekly check against the real YouTube Music; SignPath signing prepared.

## 2.0.0-beta.6

- Files deleted or modified after installation (typically quarantined by an antivirus): instead of a blank window, a message explains the situation and offers to download the installer or open Windows Security. The installer now contains an inventory of its files, checked at every startup.

## 2.0.0-beta.5

- Interface staying blank: automatic watchdog; if a page has not received its state a few seconds after loading, or if its process crashes, the state is sent again, then the page is reloaded.
- Troubleshooting: "Repair display" (notification-area menu → Troubleshooting, and Settings) switches back to the large player with its title bar and reloads the interface.
- Diagnostic log in the application folder (`logs/main.log`), opened from the Troubleshooting menu.

## 2.0.0-beta.4

- Panels (settings, queue, search): they now only close on an actual click in YouTube Music. Previously a mere focus change closed them, which could make them disappear as soon as they opened on Windows.

## 2.0.0-beta.3

- Volume in the Autoradio and Hi-fi mini-players: the control replaces "Up next" instead of being drawn over it.
- Publication: a single release per version, marked as a prerelease for betas (stable installations do not receive betas).

## 2.0.0-beta.2

- Automatic updates from GitHub Releases (check at startup then every 6 h, download on demand, restart to install); Windows installer built and published by GitHub Actions.
- Filled pin icon when the window is pinned.
- Autoradio: title readable across the whole display width, scrolling of long titles, "Up next" on one line, controls without outline.
- Autoradio 2000 (HF): smaller title, controls without outline.
- Dot-matrix font replaced by Doto (OFL license), which displays accented characters.

## 2.0.0-beta.1

- The 5 mini-player skins; search across playlist tracks, playlists and the whole of YouTube Music; interactive queue; resume; settings; global shortcut; start with Windows; video fullscreen; offline mode.

## 2.0.0-alpha.1

- Complete rewrite (Electron + TypeScript): event-driven YouTube Music bridge, "Actuel" mini-player with volume and draggable progress.
