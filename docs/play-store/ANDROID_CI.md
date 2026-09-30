# Android Play CI — Closed testing (+ Internal dual-publish)

Automates signed AAB builds and uploads for **Medicine Support Hub**
(`com.medicinesupporthub.app`) via [`.github/workflows/android-play-closed.yml`](../../.github/workflows/android-play-closed.yml).

**Play Console account:** `octoberservice1@gmail.com` only.

## Dual-publish policy

On every successful release path the workflow uploads the **same AAB** to:

1. **Internal testing** track (default API name `internal`; some apps expose it as `qa`)
2. **Closed testing** track (default `alpha`)

Always publish to Closed testing. Do not ship production from this workflow.
Promote Closed → Production manually in Play Console when ready.

Manual run inputs:

| Input | Default | Purpose |
|---|---|---|
| `release_notes` | Bug fixes and improvements | en-US Play release notes |
| `skip_upload` | `false` | Build + artifact only |
| `closed_track` | `alpha` | Closed testing track name |
| `internal_track` | `internal` | Internal track (`internal` or `qa`) |
| `version_code` / `version_name` | (empty) | Optional overrides; else auto-bump |

## Triggers

- **`workflow_dispatch`** — manual release from Actions
- **`push` to `main`** when these paths change:
  - `apps/web/**`, `android/**`, `capacitor.config.*`
  - `package.json`, `pnpm-lock.yaml`
  - `scripts/build-android-bundle.mjs`, `scripts/bump-android-version.mjs`
  - the workflow file itself

Concurrency group `android-play-upload` ensures only one Play upload runs at a time.

## One-time setup

### 1. Create a Google Cloud service account

1. Sign in to Google Cloud with access tied to Play Console account **`octoberservice1@gmail.com`**.
2. Enable **Google Play Android Developer API**:  
   https://console.cloud.google.com/apis/library/androidpublisher.googleapis.com
3. **IAM & Admin → Service accounts → Create service account**  
   - Name e.g. `play-publisher-ci`  
   - Do **not** grant GCP project roles (Play permissions are granted in Play Console).
4. Open the service account → **Keys → Add key → JSON**. Download the JSON file.

### 2. Grant the service account on the app in Play Console

1. Open https://play.google.com/console with **`octoberservice1@gmail.com`**.
2. **Users and permissions → Invite new users**.
3. Paste the service account email (`…@….iam.gserviceaccount.com`).
4. App permissions → select **Medicine Support Hub** (`com.medicinesupporthub.app`).
5. Grant at least:
   - **View app information and download bulk reports**
   - **Release to testing tracks** (Internal + Closed / Alpha)
   - **Manage testing tracks and edit tester lists** (optional but useful)
6. Send invite / ensure the user shows as Active.

> First-time API uploads require that the app already exists and that at least one AAB was uploaded manually through the Console.

### 3. Encode the upload keystore

On a trusted machine that already has the Play **upload** keystore (never the Google Play App Signing key):

```bash
base64 -w0 android/app/upload.keystore > /tmp/keystore.b64   # Linux
# macOS: base64 -i android/app/upload.keystore | tr -d '\n' > /tmp/keystore.b64
```

Keep the raw `.keystore` / `keystore.properties` **out of git** (already gitignored).

### 4. GitHub repository secrets

Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
|---|---|
| `PLAY_SERVICE_ACCOUNT_JSON` | Full contents of the service-account JSON key |
| `ANDROID_KEYSTORE_BASE64` | Single-line base64 of the upload keystore |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | Key alias (e.g. `medicine-support-hub`) |
| `ANDROID_KEY_PASSWORD` | Key password |

Local builds still use `ANDROID_KEYSTORE_PATH` / `PASSWORD` / `KEY_ALIAS` / `KEY_PASSWORD` or `android/keystore.properties` (see `scripts/build-android-bundle.mjs`).

## Soft-fail when Play credentials are missing

If `PLAY_SERVICE_ACCOUNT_JSON` is unset:

1. The workflow still builds a signed AAB (when keystore secrets are present).
2. The AAB is uploaded as a **workflow artifact**.
3. Play upload is **skipped with a warning** and the job **succeeds** (soft-fail), so other CD workflows are not blocked.

Set `skip_upload=true` on `workflow_dispatch` for the same artifact-only behavior on purpose.

## Version bumps

Each run auto-increments `versionCode` by 1 and bumps the patch segment of `versionName` in `android/app/build.gradle` (via `scripts/bump-android-version.mjs`), unless overrides are provided.

After a **successful** Play upload the workflow tries to commit that bump back to the triggering branch. If `GITHUB_TOKEN` cannot push (protected `main`), the job prints the next version in the Actions summary — apply it manually before the next release:

```text
versionCode <N>
versionName "<x.y.z>"
```

## Verify a run

1. Actions → **Android Play Closed (+ Internal)** → latest run.
2. Confirm artifact `app-release-<versionName>-<versionCode>`.
3. Play Console (`octoberservice1@gmail.com`) → **Testing → Internal testing** and **Closed testing (Alpha)** show the new release as completed.
4. Install from the tester join link on a device.


## Troubleshooting: `cap sync android` / extractTemplate

If **Build signed AAB** fails with:

```text
TypeError: Cannot read properties of undefined (reading 'extract')
  at extractTemplate (.../@capacitor/cli/.../util/template.js)
```

Root cause under pnpm: `@capacitor/cli@6` does `tslib.__importDefault(require('tar')).extract`. **tar@7** is ESM (`__esModule`, no `.default`), so `.extract` throws. Do **not** override `tar` to `^7`.

Fix (already in `pnpm-workspace.yaml`):

```yaml
overrides:
  tar: 6.2.1
```

Verify locally after `pnpm install`:

```bash
node -e "console.log(require('@capacitor/cli/package.json') && require(require.resolve('tar',{paths:[require.resolve('@capacitor/cli')]} )/package.json').version)"
# expect 6.x under the CLI; then:
npx cap sync android
```

## Related

- Manual checklist: [`CHECKLIST.md`](./CHECKLIST.md)
- Internal tester install notes: [`../INTERNAL_TESTERS.md`](../INTERNAL_TESTERS.md)
- Publisher action: [r0adkll/upload-google-play](https://github.com/r0adkll/upload-google-play)

## Startup gate

Pull requests run `StartupSmokeTest` on an API 35 emulator with packaged production
web assets in a debug Android shell (no Play credentials). The Play workflow runs
the same test against the signed release build before the upload step. It waits
for the app header and main content to replace the boot screen, then recreates the
activity and checks again. A failure blocks upload and retains instrumentation
reports as an artifact. This checks startup and activity recreation; it does not
prove an upgrade from every previously installed version or cover every WebView.
