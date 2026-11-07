# Security

## Model

cashew shows music.youtube.com in an isolated view (`persist:music` partition, sandbox, context isolation, no
Node.js). The page talks to the application only through a minimal bridge (`emit` / `onCommand`), accepted only from
the main frame of music.youtube.com, and every message is validated against a schema (`src/shared/player.ts`,
`src/shared/ops.ts`). The application's own pages (title bar, panels) accept privileged calls only from their own
windows (`fromUi`) and render page data as text only. Local files are re-validated when read.

## Island (2.1)

- The island window is not focusable, never steals input, and its page may only send play/pause, next and previous;
  every other IPC channel rejects it (`fromIsland` in `src/main/index.ts`).
- Game detection uses read-only Windows calls (foreground window, its size, the process's executable path asked
  once per process with the minimal `PROCESS_QUERY_LIMITED_INFORMATION` right, as Task Manager does) and reads the
  list of games Windows knows (`HKCU\System\GameConfigStore\Children`, through `reg.exe query`). It never reads or
  writes game memory, never injects code and installs no hooks: the island is an ordinary topmost window, like the
  Xbox Game Bar. Per-game settings can turn it off for games whose anti-cheat forbids any overlay.
- LRCLIB requests are optional and only send the track's title, artist, album and duration; answers are size-limited,
  parsed as LRC and validated (`sanitizeLyrics`).

## Audit of November 2026 (2.0.0-beta.7 → beta.8)

Full audit following the Cloudflare *security-audit-skill* method (standard profile, revision `2a06548`): 25
coverage units, with checks run offline in a sandbox. Each result was reviewed by two independent verifiers.

| Finding | Status | Fix (beta.8) |
|---|---|---|
| Camera and microphone granted without a prompt to any page or frame shown in the YouTube Music view (medium) | confirmed | permissions limited to fullscreen and clipboard write, for the music.youtube.com main frame only; `src/main/ytm/ytm-view.ts`, test `test/e2e/permissions.test.mjs` |
| Navigation filter accepted `accounts.google.<anything>` (low) | confirmed | Google country domains only; `src/main/ytm/navigation.ts`, test `test/unit/navigation.test.ts` |
| Updates verified only by the `latest.yml` hash, with no publisher check | needs validation | publisher written to `app-update.yml` for signed releases ([signing.md](signing.md)) |
| "All users" installation into a chosen folder, without access-right protection | needs validation | per-user installation only, default folder |

Hardening: Electron fuses (no Node.js mode, no `NODE_OPTIONS` or `--inspect`, verified asar loaded exclusively,
encrypted cookies), no permissions and no downloads for the application's own pages, no downloads from the YouTube
Music view, read-only CI token, actions pinned by SHA, publication restricted to `main`, Dependabot, oxlint.

Repository settings: public repository, protected `v*` tags (ruleset described in [signing.md](signing.md), "Who can
publish"), private vulnerability reporting enabled, two-factor authentication on the owner account, write access
restricted to the owner.

Releases are not code-signed ([signing.md](signing.md)): the authenticity of updates therefore relies on the owner's
GitHub account, the only one able to publish a release. If signing is enabled, `SIGNPATH_PUBLISHER_NAME` makes
installed applications accept signed updates only.

## Reporting a vulnerability

Open a private report: **Security** tab of the repository → **Report a vulnerability**. Please do not publish details
before a fix is available.
