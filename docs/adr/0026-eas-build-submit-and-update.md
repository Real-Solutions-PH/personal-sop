# ADR-0026 — EAS Build, Submit and Update for iOS releases

- **Date:** 2026-10-26
- **Status:** accepted
- **Deciders:** owner

## Context

iOS builds 9–12 were made by hand: a build-number PR, then a Release archive
in Xcode on one Mac and an upload from the Organizer. Only a Mac with Xcode
signed in to Apple team `N2Y99Q8A79` could ship, the build environment
(live mode, production URLs) lived on that machine, and every change, even a
JavaScript-only one like #101, needed a new build and a TestFlight
processing wait before it reached a phone. The app also had no Expo project
id, so `src/live/push.ts` never registered for push.

## Decision

- **Expo project `@ervinpiol/personal-sop`** (`extra.eas.projectId` in
  `mobile/app.json`). Push registration now gets a project id.
- **EAS Build + Submit** (`mobile/eas.json`, `production` profile): builds run
  in Expo's cloud with `eas build -p ios --profile production --auto-submit`,
  which uploads to App Store Connect for TestFlight. The build number is
  remote (`appVersionSource: remote`, `autoIncrement`), so build-number PRs
  stop. Signing credentials are managed by EAS for the app and the
  `UnfurlWidgets` extension.
- **Build environment in EAS** (environment `production`): `EXPO_PUBLIC_APP_MODE=live`,
  `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_SUPABASE_URL` set to the API host,
  `EXPO_PUBLIC_SUPABASE_ANON_KEY` (public by design, copied from the
  `unfurl/gotrue` secret), and `SENTRY_DISABLE_AUTO_UPLOAD=true`. Builds and
  updates read the same values, so an update can't ship a different
  configuration from the build it lands on.
- **EAS Update** (`expo-updates`, channel `production`, `runtimeVersion`
  policy `fingerprint`): JavaScript-only changes ship with
  `eas update --channel production --environment production`. The
  fingerprint changes whenever native code or config changes, so an update
  only reaches builds with the same native layer; anything native needs a
  new build.

Releases stay deliberate commands. Nothing builds, submits or updates on
push or merge.

## Constitution clause deviated from

None. §2.2's "no auto-deploy from `main`" holds: every build and update is
started by hand.

## Consequences

**Positive:**
- Any machine with the Expo login can ship; no Xcode or Mac needed.
- JavaScript-only fixes reach installed apps on next launch, without review
  or TestFlight processing.
- Push notifications can register.

**Negative:**
- Depends on Expo's service and its free-tier limits on builds and update
  users.
- An over-the-air update skips TestFlight review, so a bad update reaches
  phones faster; `eas update:republish` / rollback is the undo.

**Follow-ups:**
- Move the Expo project to an organisation if more people need to release.
- The backend's `EXPO_ACCESS_TOKEN` must belong to this Expo account for
  push sends to be accepted.
