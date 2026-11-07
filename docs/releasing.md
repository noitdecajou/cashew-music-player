# Releasing

Versions are built and published by GitHub Actions (`.github/workflows/release.yml`) on a Windows runner.
Installed applications find a new version in the repository **Releases** (the `latest.yml` file published with
the installer).

## Requirements

- The repository must be **public**: otherwise the installer cannot be downloaded and installed applications
  cannot check for updates.
- The workflow declares the permissions it needs (`contents: write` to create the release); the repository default
  (Settings → Actions → General → Workflow permissions) can stay read-only.
- Settings → Actions → General → Actions permissions must allow actions created by GitHub and
  `signpath/github-action-submit-signing-request@*`.

## Publishing

1. Update `CHANGELOG.md`.
2. Change the version in `package.json` (for example `2.1.0`, or `2.1.0-beta.1` for a prerelease), then run
   `npm install --package-lock-only`.
3. Commit and push to `main`, then either:
   - on GitHub: **Actions → Release → Run workflow** from `main`, tick **Publish**, then **Run workflow**;
   - or create and push the tag:

   ```powershell
   git tag v2.1.0
   git push origin main v2.1.0
   ```

4. The workflow checks that the commit is on `main`, that the tag matches `package.json` and does not exist yet,
   runs the type check, lint and tests, builds `MusicPlayer-Setup-<version>.exe` and publishes the release with the
   matching `CHANGELOG.md` section as notes. A version with a suffix (`-beta.N`) is published as a prerelease.

Installed stable versions are only offered stable versions; a prerelease is also offered the following
prereleases, then the next stable version.

## Building without publishing

**Actions → Release → Run workflow** without ticking **Publish**: the installer is available in the run artifacts.
Locally: `npm run dist:win` (output in `dist/`).

## Code signing

Releases are not signed for now; see [signing.md](signing.md).
