# Changelog

## 2.3.0

- **Synced lyrics in YouTube Music's Lyrics tab**, like Better Lyrics: the sung line lights up word by word and stays in view, a click on a line goes there, the mouse wheel scrolls freely, per-track correction (±0.5 s). **Full screen**: cover, title and artist on the left, lyrics on the right, over the blurred colors of the cover (Escape leaves it). Without synced lyrics, YouTube Music's own lyrics stay. A lyrics panel in the mini-player.
- **More lyrics found**: YouTube Music's own synced lyrics when it has them, then LRCLIB; network failures are tried again and logged.
- **Island**: livelier, subtle animations (appearing, hover, new track), even with Windows animations off (can be turned off); "On track change" mode compact or detailed; darker background.

## 2.3.0-beta.3

- **Lyrics, rebuilt like Better Lyrics**: in the large player, cashew's synced lyrics now take the place of YouTube Music's own **Lyrics tab**: the sung line lights up word by word, the view glides to keep it in sight, a click on a line goes there, the mouse wheel scrolls freely. **Full screen** ("Plein écran" under the lyrics): cover, title and artist on the left, lyrics on the right, over the blurred colors of the cover; Escape leaves it. When no synced lyrics exist, YouTube Music's own lyrics stay in the tab. The mini-player keeps its lyrics panel, with the same engine.
- **More lyrics found**: YouTube Music's own synced lyrics are used when it has them, then LRCLIB. Opening the lyrics fetches them even when the island's lyrics option is off (that option now only concerns the island). A network failure is tried again once and written to the diagnostic log.

## 2.3.0-beta.2

- **Lyrics view fixes**: the sung line is highlighted and the view scrolls with the song again (the view no longer depends on animation frames, which Windows could hold back); the lines glide even with Windows animations turned off; when only YouTube Music's lyrics (without timing) exist, the view says so.
- **YouTube Music's Lyrics tab** opens cashew's synced lyrics view instead.
- **Island**: in "On track change" mode, the island shows compact by default; a new setting chooses compact or detailed. The animations play even when Windows animations are turned off, and can be turned off in Settings → Island.
- Code: one shared position estimate for the island and the lyrics view.

## 2.3.0-beta.1

- **Lyrics view** in the player ("Paroles" in the toolbar): synced lyrics scroll smoothly to keep the sung line in view, the sung line fills as it is sung, other lines fade, instrumental breaks show breathing dots, a click on a line goes there, the mouse wheel scrolls freely (the view follows the song again after a moment), per-track correction (±0.5 s). **Immersive mode** (button or F key): big lines over the blurred, slowly drifting cover, across the whole YouTube Music area. When LRCLIB has no synced lyrics, YouTube Music's own lyrics (without timing) are shown instead.
- **Island animations**: slides down when it appears and back up when it leaves, springier growth on hover, a short pulse and the cover popping in at each new track, smoother question about a new game.
- Island background closer to black, to melt into the screen's edge.

## 2.2.0

- **Fixes**: island buttons and the new-game question respond reliably; the playing equalizer moves even with Windows animations turned off; the island stays next to the mini-player (or hides, as chosen); Settings → Games: "Recently detected" first, collapsible lists.
- **Island on hover**: previous button, click on the cover to open the player, three lyric lines, per-track lyrics correction (±0.5 s).
- **Cover color**: the equalizer, progress bar and glow take the color of the cover.
- **Events**: shows for a moment on pause, resume and volume changes (option).
- **Discretion**: hide after a pause of 1 to 10 minutes (option), invisible in screenshots and screen sharing (Windows 10 2004 and later), steps aside in Windows presentation mode.

## 2.2.0-beta.1

- Fixes: island buttons and the new-game question respond reliably (main now watches the cursor over the pill; the page's mouse events were unreliable on Windows while clicks go through); the playing equalizer moves even when Windows animations are turned off; Settings → Games: "Recently detected" comes first and the three lists can be collapsed (remembered).
- Island on hover: previous button; click on the cover opens the player; three lyric lines (previous, current, next); per-track lyrics correction (−0.5 s / +0.5 s), kept on disk.
- The island takes the color of the cover (equalizer, progress, glow).
- Shows for a moment on pause, resume and volume changes (option).
- Discretion: hide after a pause of 1 to 10 minutes (option); invisible in screenshots and screen sharing (Windows 10 2004 and later, option, on by default); steps aside in Windows presentation mode.

## 2.1.1

- Island with the mini-player: by default the island stays on screen next to the mini-player; a setting can hide it instead ("Avec le mini-player"). Switching to the mini-player or pinning it no longer puts the island behind it.
- Games mode: clicking the mini-player or the settings during a game no longer hides the island (cashew's own windows do not count as leaving the game).
- New-game question appears faster: the island window is prepared in advance, detection runs every second, and the list of games Windows knows is read at startup.

## 2.1.0

- **Island** (optional, off by default): a pill at the top of the screen with a small cover and the lyric line being sung, or title and artist. On hover: cover, title, artist, progress (click to seek), next track, play/pause and next; the mouse wheel sets the volume. Shown always, for a few seconds at each track change, or only over games. Position, display, clock, size and opacity are configurable, and a customizable shortcut (Ctrl+Alt+I) shows the details without the mouse. It never takes the focus and works while the player is hidden.
- **Synced lyrics** from LRCLIB (optional): in time with the singing, kept on disk once found.
- **Games**: games are recognized by their install folder (Steam, Epic Games, GOG, Ubisoft, EA, Riot, Xbox…) or because Windows knows them, never because they are fullscreen (browsers and videos never count). The island offers each new game (add, decline, later); per-game settings (shown or not, position). Nothing is injected into games.
- **Settings** in their own window with a sidebar, opened on the player's display; "Settings" entry in the notification-area menu.
- **Fixes**: Google sign-in pages shown during a first sign-in are allowed (sign-in needed two attempts); the splash screen goes away as soon as YouTube Music is usable (first start could take minutes).

The beta notes below detail each step.

## 2.1.0-beta.5

- New games: when a game not in the list is detected, the island asks whether to add it (Add, Decline, Later). Without an answer after 15 seconds it counts as "Later". Declined games are listed in the settings (add them, or allow them to be proposed again); postponed ones appear under "Recently detected", with Add and Decline.
- "On track change" mode: the island shows its details for a few seconds at each new track.
- Customizable global shortcut (Ctrl+Alt+I by default) showing the island's details for a few seconds, without the mouse (handy in games).
- Click on the progress bar to seek; mouse wheel over the island sets the volume.
- Island size (small, normal, large, extra large) and opacity.
- Lyrics found are kept on disk (instant next time, also offline).
- Settings: the Games lists no longer rebuild every 2 seconds (clicks and menus stay stable).

## 2.1.0-beta.4

- Game detection: an application counts as a game when it is installed in a game store folder (Steam, Epic Games, GOG, Ubisoft, EA, Riot, Xbox, Amazon, Rockstar, Battle.net, itch, Heroic) or known to Windows as a game (Xbox Game Bar list), never because it is fullscreen: maximized or fullscreen browsers, videos and the Alt+Tab switcher are no longer taken for games. Browsers, Explorer, launchers and Windows overlays never count. Alt+Tab no longer makes the island blink. The game's executable path is asked for once per process.
- The Games section shows whether the application in front is recognized as a game and how many games Windows knows.

## 2.1.0-beta.3

- Settings window: opens on the display of the player window (and moves there if it was left on another one).
- Lyrics: in time with the singing (the clock is estimated between the player's position reports, lines show slightly ahead, shorter transition); after a track change, the request waits for the new track's duration, so lyrics no longer stop after the first song; a miss is tried again the next time the track plays. The option reads "Afficher les paroles" (off: title and artist only).
- Game detection: windows a few pixels short of the full screen, Windows' own "full-screen application" signal, and games whose executable cannot be read now count; detection also runs in "always" mode and while the settings are open, and no longer stops after errors. The Games section shows the last application detected in front, live.

## 2.1.0-beta.2

- Settings window: always opens in front, also when the player is pinned on top; failures are logged.
- Google sign-in: the pages Google may show during a first sign-in (recovery options, security checks on gds.google.com, myaccount.google.com, www.google.com) are allowed; blocked navigations are written to the diagnostic log.
- First start: the splash screen goes away as soon as YouTube Music is usable instead of waiting for the page to load completely (which could take minutes), and never stays more than 20 seconds.

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
