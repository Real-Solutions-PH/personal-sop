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

- **Expo project `@real-solutions-ph/unfurl`** (`extra.eas.projectId` in
  `mobile/app.json`). Push registration now gets a project id. (Amended
  2026-10-29: first created as `@ervinpiol/personal-sop`, then moved to the
  app owner's own Expo account `@schadenkai/unfurl` so releases do not depend
  on a contributor's login, then transferred to the `real-solutions-ph`
  organisation. See *Amendments* below.)
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

## Amendments

- **2026-10-29 — project moved to `@schadenkai/unfurl`**
  (id `348dbc4a-78e1-47e9-922d-3006c4e0455a`, slug `unfurl`). Owner, project
  id, slug and `updates.url` in `mobile/app.json` changed; the `production`
  environment variables were recreated on the new project with the values
  listed above. Consequences:
  - Builds made under the old project (TestFlight builds up to and including
    the last `@ervinpiol` build) keep polling the old update URL, so an
    `eas update` published to the new project does not reach them. The first
    build from the new project is the first one that receives updates.
  - Signing credentials and the App Store Connect API key for submit are set
    up again on the new project (`eas credentials`, run by the Apple account
    holder); the Apple team `N2Y99Q8A79` and bundle ids are unchanged.
  - Push tokens issued to old builds belong to the old project. Production
    sends without `EXPO_ACCESS_TOKEN` (unset in `unfurl/third-party` on this
    date), so no backend change was needed.
  - Other people release by being added to the Expo account or an Expo
    organisation that owns the project, not by sharing the owner's login.
- **2026-10-29 — project transferred to the `real-solutions-ph` organisation**
  (`@real-solutions-ph/unfurl`, same id `348dbc4a-78e1-47e9-922d-3006c4e0455a`).
  Only `owner` in `mobile/app.json` changed: the project id, slug, `updates.url`,
  remote build number and environment variables moved with the project, so
  existing builds keep receiving updates.
  The transfer does not carry iOS signing credentials, so the Apple account
  holder runs `eas credentials -p ios` once on the new owner. The Apple team is
  an individual membership: App Store Connect Admins have no Certificates,
  Identifiers & Profiles access, so only the account holder can create them.
