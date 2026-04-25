# Release Builds

Luma Arcade now builds installable files automatically through GitHub Actions.

## What Gets Built

Every push to `main` and every manual workflow run builds:

- Android debug APK
- Android release APK, unsigned by default
- Android signed release APK when keystore secrets are configured
- Windows Tauri installers, usually `.exe` and/or `.msi`

Every `v*.*.*` tag additionally publishes those files to a GitHub Release.

## Version Source

The canonical version is `package.json`.

Sync every app target after changing it:

```bash
npm run version:set -- 0.2.0
```

That updates:

- `package.json`
- `package-lock.json`
- `capacitor.config.ts`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`
- web manifest/title metadata

Android `versionCode` is generated from the semantic version plus the GitHub
Actions run number, so repeated builds of the same version still install as
newer APKs.

## Automatic Build Workflow

Workflow file:

```text
.github/workflows/build-installers.yml
```

Artifact names:

```text
luma-android-apk
luma-windows-installers
```

## Release Command

```bash
npm run version:set -- 0.2.0
git add package.json package-lock.json capacitor.config.ts src-tauri/tauri.conf.json src-tauri/Cargo.toml public/manifest.webmanifest index.html
git commit -m "Release 0.2.0"
git tag v0.2.0
git push origin main --tags
```

The tag creates the GitHub Release and attaches APK/Windows files.

## Android Signing

Debug APKs are always generated and installable for testing.

For signed release APKs, set these GitHub repository secrets:

```text
ANDROID_KEYSTORE_BASE64
ANDROID_KEYSTORE_PASSWORD
ANDROID_KEY_ALIAS
ANDROID_KEY_PASSWORD
```

Create a keystore locally:

```bash
keytool -genkeypair -v -keystore luma-release.jks -alias luma -keyalg RSA -keysize 2048 -validity 10000
```

Convert it for GitHub:

```bash
base64 -w 0 luma-release.jks
```

On Windows PowerShell:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("luma-release.jks"))
```

Put that output into `ANDROID_KEYSTORE_BASE64`.

## Local Builds

Windows:

```bash
npm run version:sync
npm run tauri:build
```

Android, generated locally:

```bash
npm run version:sync
npm run build
npm run cap:add:android
npm run cap:sync
npm run android:prepare
cd android
./gradlew assembleDebug
```

The repository intentionally ignores `android/`, `ios/`, and Tauri build output.
CI regenerates native Android files for clean, repeatable APK builds.
