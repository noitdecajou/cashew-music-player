# Code signing (SignPath Foundation)

**Status:** releases are not signed. A request to SignPath Foundation (free certificates for open source projects)
was declined in November 2026 for lack of project reputation (users, stars, downloads). The release workflow is
ready for signing and publishes unsigned releases until the settings below exist; a new request can be made if the
project gains an audience.

Signing reduces SmartScreen warnings and helps with antivirus trust.

## What the workflow does when signing is configured

1. builds the application (`dist/win-unpacked`);
2. sends it to SignPath, which signs `Music Player.exe` (artifact configuration `app`);
3. rebuilds the installer from the signed application (`--prepackaged`);
4. sends the installer to SignPath (artifact configuration `installer`);
5. recomputes the hash, size and `.blockmap` of the signed installer in `latest.yml`
   (`build/update-metadata.cjs`), without which installed applications would reject the update;
6. publishes the release.

Only published versions are signed; build-only runs are not. Electron libraries (`ffmpeg.dll`, etc.) are not signed:
they are third-party files, which SignPath Foundation does not sign for another project.

## Setup

1. **Requirements**: public repository, open source license (MIT), at least one published release, actively
   maintained project, and some reputation.
2. **README section**, required by SignPath Foundation, to add back before applying:

   ```markdown
   ## Code signing policy

   Free code signing provided by [SignPath.io](https://signpath.io), certificate by
   [SignPath Foundation](https://signpath.org).

   - Committers and reviewers: [noitdecajou](https://github.com/noitdecajou)
   - Approvers: [noitdecajou](https://github.com/noitdecajou)

   Signed binaries are built only by the public GitHub Actions workflow of this repository
   (`.github/workflows/release.yml`), from the sources of this repository.

   Privacy policy: this program will not transfer any information to other networked systems unless specifically
   requested by the user or the person installing or operating it, except the connections described in "Privacy"
   above (YouTube Music, and GitHub to check for updates).
   ```

3. **Request** at https://signpath.org/apply with the repository URL.
4. In the SignPath project space, once accepted:
   - enable two-factor authentication on the account;
   - create the project (for example `cashew-music-player`), linked to the GitHub repository, with the "GitHub
     Actions" source ("Trusted Build System");
   - create two **artifact configurations** with the content of:
     - `build/signpath/app.xml`, slug **`app`**;
     - `build/signpath/installer.xml`, slug **`installer`**;
   - note the slug of the release **signing policy** (usually `release-signing`);
   - create an **API token** for CI.
5. On GitHub, repository → Settings → Secrets and variables → Actions:
   - **Secrets**: `SIGNPATH_API_TOKEN` = the token;
   - **Variables**:
     - `SIGNPATH_ORGANIZATION_ID` = the SignPath organization id,
     - `SIGNPATH_PROJECT_SLUG` = the project slug,
     - `SIGNPATH_SIGNING_POLICY_SLUG` = the signing policy slug,
     - `SIGNPATH_PUBLISHER_NAME` = the common name (CN) of the signing certificate, as shown in the signed
       installer's properties → Digital Signatures (for SignPath Foundation: `SignPath Foundation`). **Required**:
       without it, the workflow refuses to publish a signed release.
6. Publish a version as usual ([releasing.md](releasing.md)). Depending on the policy, SignPath may require a
   **manual approval** of each signing request; the workflow then waits for it.

## After the first signed release

- Signed releases write `SIGNPATH_PUBLISHER_NAME` to `resources/app-update.yml`: they only install updates signed
  by that publisher (electron-updater Authenticode check). Without it, the only check is the `latest.yml` hash,
  published next to the installer (security audit, 2.0.0-beta.8). Every later version must therefore be signed with
  the same certificate.
- Installed unsigned applications accept the first signed release normally.

## Who can publish

- The workflow only publishes commits of `main` (run from `main`, or a tag on a commit of `main`).
- Anyone with write access to the repository can run the release workflow: write access stays with the owner
  (Settings → Collaborators).
- `v*` tags are protected so that a published version can be neither moved nor deleted: Settings → **Rules** →
  **Rulesets** → **New ruleset** → **New tag ruleset**:
  - name `versions`; **Enforcement status**: **Active**;
  - **Target tags** → **Add target** → **Include by pattern** → `v*`;
  - rules: **Restrict updates** and **Restrict deletions**;
  - **Restrict creations** must stay unchecked: the workflow creates the tag itself when **Publish** is ticked.

  On a free GitHub account, rulesets only apply to public repositories.
- Optional, to require an approval before each publication: create a `release` environment (Settings →
  Environments) with "Required reviewers", move `SIGNPATH_API_TOKEN` into it, and add `environment: release` to the
  workflow job.
