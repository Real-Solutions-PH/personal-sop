# Screen time as a data source — design

Date: 2026-10-29 · Status: draft for approval

## Intent

Bring the phone's screen time into Unfurl as data the rest of the app can use:

1. Record how much time goes to the apps the user calls distracting (social media, games, or anything they pick), per day, and store it on the server so other numbers can be derived from it.
2. Let a habit complete itself from that data, for example "no social media today" or "at most 30 minutes of games". These habits cannot be ticked by hand. Their ring fills on its own through the day, so the user can see how close they are, and breaks the moment the limit is crossed.
3. Count screen time in the Life Score and show it as its own corner of the hexagon on the stats screen.

## What iOS allows (this shapes everything below)

Apple's Screen Time API has three parts. Only one of them lets numbers reach our code.

| Part | What it gives | Can our code or server read the numbers? |
|---|---|---|
| **FamilyControls** | Permission (`requestAuthorization(for: .individual)`, Face ID / passcode prompt) and `FamilyActivityPicker`, the system sheet where the user picks apps and whole categories (Social, Games…) | The picks come back as **opaque tokens**. We cannot read an app's name, bundle id or category name from them. We cannot preselect "Social"; the user must tick it. |
| **DeviceActivity monitor** (an app extension) | We schedule a daily window and register **events**: "the picked apps have been used for N minutes". iOS wakes our extension when each threshold is crossed. | **Yes**: the extension can write to a shared App Group store that the app reads. This is the only path. |
| **DeviceActivityReport** (an app extension) | Exact per-app minutes, pickups, charts | **No**. Apple runs it in a read-only sandbox: no network, no shared storage. It can only draw SwiftUI inside our screen. |

Consequences, stated plainly:

- **We store a lower bound, not an exact figure.** We register a ladder of thresholds (1, 5, 10, 15 minutes, then every 15 minutes up to 4 hours, then 5, 6 and 8 hours). The highest rung crossed is "at least N minutes". Between 15-minute rungs the true number is unknown.
- **Delivery is best effort.** Developers report threshold callbacks firing late, twice, or too early (an iOS 26.2–26.3 bug, FB18061981, reportedly fixed in 26.5). A missed callback means a "no social today" habit can pass when it should have failed. The design guards against the known too-early bug (see "Rules") and says "best effort" in the UI copy.
- **No history.** Nothing before the user turns the feature on, except usage earlier in the same day (`includesPastActivity`, iOS 17.4+).
- **Real device only.** The simulator has no app usage to count and does not enforce the extension sandbox. The simulator can show the screens with sample data; the end-to-end path needs Kai's iPhone.
- **iOS only.** Android has a different API (`UsageStatsManager`) and is out of scope.

## Needs Kai (Apple portal, before TestFlight)

These cannot be done from code or by an agent; they need the Apple account for team N2Y99Q8A79.

1. **Family Controls distribution entitlement — two requests.** Apple requires a separate request for the app and for every Screen Time extension: `com.schadenkai.personal-sop` and `com.schadenkai.personal-sop.activity-monitor`. Form: developer.apple.com → Account → "Family Controls (Distribution)" request. Turnaround reported from 1 day to 2+ weeks. **Without it, no TestFlight or App Store build can contain the feature.** Development builds on Kai's own phone work immediately with the development entitlement.
2. **App Group `group.com.schadenkai.personal-sop`.** The app has none today (the widget shares data through a keychain group because App Groups once needed a paid account). It must be registered and enabled on both App IDs. EAS's capability sync normally does this on the next build; if it does not, tick it by hand in the portal.
3. **After approval:** enable "Family Controls (Distribution)" on both App IDs and let EAS regenerate the provisioning profiles (`eas credentials` if it does not).

Until step 1 is approved, the native part is built **only** when the environment variable `UNFURL_SCREEN_TIME=1` is set at prebuild. Production/TestFlight builds leave it unset, so they keep shipping unchanged; the JS side detects the missing native module and shows the screen-time surfaces as locked previews (LockedPreview), never a crash. Turning it on for TestFlight later is one line in `eas.json`.

## Goals

- Per-user **screen-time groups**: a name (e.g. "Social", "Games"), the apps/categories picked for it on the phone, and a daily budget in minutes. Up to 6 groups, plus one built-in "All apps" group that counts all phone use.
- Per group per day: minutes used (lower bound), synced to the server.
- **Auto habits**: a habit can carry a screen-time rule "group G, at most M minutes today" (M = 0 means none). It cannot be ticked, skipped or logged by hand. It completes itself when the day closes within the limit.
- **Screen time module** in stats: a new area in the Life Score with its own weight and on/off switch, an eighth hexagon corner, and its own stats page section.
- Onboarding lists Screen time with the other features.

## Non-goals (this PR)

- Exact minutes, per-app breakdowns or pickups stored anywhere. A DeviceActivityReport view showing exact minutes on the phone (display only) is a good follow-up but not here.
- **Focus quality** (did the user open distracting apps during a focus session). Possible with the same mechanism (a monitor window per focus session), listed as the first follow-up.
- Blocking apps (shields).
- Android, web data entry. The web frontend gets the new module only where its shared stats code needs it to compile and render.

## Anti-goals (failure even if it works)

- Any auto habit that can be ticked by hand, or a manual tick silently overwritten.
- Production/TestFlight builds breaking or being rejected because of an entitlement Apple has not granted.
- A crash or a blank screen when the native module is missing, permission is denied or revoked.
- Presenting a lower bound as an exact number ("45 min" when it means "at least 45 min").

## Data model (backend, one Alembic revision)

- **`screen_group`** (synced entity): `id`, `owner_id`, `name`, `kind` (`"all"` | `"custom"`), `budget_min` (int ≥ 0, default 60), `sort_order`, `archived_at`. The picked tokens never leave the phone; they live in the App Group keyed by group id. A group whose tokens are missing on this phone (new phone, reinstall) shows "Pick apps again".
- **`screen_day`** (synced entity): `owner_id`, `group_id`, `day` (the app day, 04:00 cutoff), `used_min` (int ≥ 0, the highest rung crossed), `closed` (bool, true once the day's window ended), `updated_at`. Unique `(owner_id, group_id, day)`. Upsert keeps the **max** of `used_min` (two devices or a re-sync can only raise it). Days accepted: today back to 7 days ago.
- **`habit`** gains `rule_kind` (null | `"screen_limit"`), `rule_group_id` (FK `screen_group`, nullable), `rule_max_min` (int ≥ 0, nullable), with a CHECK that all three are set together.
- **`habit_log.source`** gains `"screen"`.
- **`module_pref.module`** CHECK and every module list gain `"screen"`.

## Rules (shared domain, mirrored in Python with a golden test like the other modules)

- **Day window.** Monitoring runs from the user's day start (`UserProfile.day_start_hour`, default 4) to one minute before it the next day, in the phone's time zone, so a screen-time day is the same day the rest of the app uses. Changing the day-start hour reschedules monitoring and takes effect from the next day; the day the change is made keeps its old window. *Verify on device that a window crossing midnight works; if it does not, run 00:00–23:59 and attribute usage to the calendar day — recorded in the ADR if it comes to that.*
- **Observed days.** A day counts only if the extension recorded `intervalDidStart` for it (or monitoring was started that day with `includesPastActivity`) **and** the group's app selection was present on the phone. An unobserved day writes no `screen_day` row and no auto-habit log: the habit counts as missed that day, and its row says "Not tracked" instead of a ring. Rationale: a false pass is an anti-goal; a missed day caused by a revoked permission is visible and fixable. (My call; the alternative is excluding such days from habit stats.)
- **Ladder.** Per group: the standard rungs plus every distinct `rule_max_min + 1` of habits on that group (so "at most 30" has an exact "31 reached" rung). At most 20 activities per app is Apple's cap: 6 custom groups + "All" = 7.
- **Past activity and the too-early guard.** Events use `includesPastActivity: true`, so a mid-day (re)schedule still counts the morning. The guard therefore measures from the **window start**, not from the reschedule: a callback for rung N minutes is dropped when fewer than N minutes have passed since today's window began, because that much use is physically impossible. This catches the "every threshold fires at once" form of the iOS 26.2–26.3 bug only early in the day; later in the day a spurious fire is indistinguishable from real use and is accepted (it can only make a habit fail, never pass). Monitoring is rescheduled only when groups, rungs or the day start change, not on every launch.
- **Auto habit progress, shown on its ring:**
  - Broken (any rung > `rule_max_min` crossed today): progress 0, ring in the miss colour, label "Over by ≥ N min". Stays broken for the day.
  - Otherwise: progress = fraction of the app day elapsed (04:00 → next 04:00), label "≥ N of M min" (or "None yet" for M = 0).
  - Day closed within the limit: a `done` log with `source="screen"`, id `derived_id("screen-habit", habit_id, day)` so phone and server converge on one row.
- **When logs are written.** The monitor extension records `intervalDidEnd` (day closed). When the app comes to the foreground it reconciles every closed day in the last 7 that has no log yet: writes `screen_day` rows and the auto-habit `done` logs. A broken day writes no log, so it counts as missed like any undone habit.
- **Manual actions refused.** Server: `check`, `log`, `increment`, `skip`, `DELETE log` on a habit with a rule → 409. Sync push of a `habit_log` for such a habit with a source other than `screen` → rejected. Mobile: the row has no check button or swipe actions, shows a small "auto" mark instead.
- **Editing a rule.** A habit's rule can be added to or removed from an existing habit. Existing logs are never touched: the reconciler only writes a day that has no log, so a manual tick from before the change stands. Changing the limit or group re-evaluates today from today's recorded rungs (a raised limit can un-break today). Removing the rule keeps past `screen` logs and makes the habit manual again from today. Archiving a group that a live habit's rule points at is refused (409, "change or archive these habits first", listing them); the FK is `ON DELETE RESTRICT`.
- **Day score for the Screen time area** (per group with a budget > 0, then averaged over groups): `1` if `used ≤ budget`, else `max(0, 1 − (used − budget) / budget)` (twice the budget = 0). The area rate over a range is the mean of day scores on days with a closed `screen_day`. No data → `None` (skipped by the Life Score like other empty areas).
- **Hexagon corner "Screen time"**: today's (or the range's) area rate; the facet shows "≥ N min" for the main group. It becomes the eighth corner (after Habits, Routines, Tasks, Training, Nutrition, Focus, Finance).
- **Module defaults.** `screen` is enabled by default with Life Score weight 2 (same as Focus) and is pre-selected in onboarding like every other feature (PR #119). With no data (feature not connected, or a build without the native module) its rate is `None`, so the Life Score skips it and its hexagon corner renders dimmed as a locked preview. No backfill is needed: `module_pref` only stores overrides of the defaults.

## Mobile surfaces

- **Settings → Screen time** (new screen, reached from the stats page section and from onboarding): connect (permission), groups list (name, budget, "Pick apps" opens the system picker), the "All apps" group toggle. Permission denied → explanation and a retry button.
- **Habit editor**: a "Completes from screen time" option: pick group, pick "none" or a minute limit. Hides target/step/timer fields.
- **Today and Habits lists**: auto habits render with the existing `AnimatedCheck` ring driven by the rule progress, not tappable, with the label.
- **Stats**: Screen time section with today's minutes per group ("≥ 45 min") and a 7-day bar chart of the lower bounds.
- Without the native module (Expo Go, simulator, builds without `UNFURL_SCREEN_TIME`): sample data in Expo Go as `health.ts` does, LockedPreview elsewhere.

## How (my calls, open to change)

- **Native code: our own local Expo module `mobile/modules/unfurl-screen-time` plus one `device-activity-monitor` extension target through `@bacons/apple-targets`** (already used for the widget). Not `react-native-device-activity`: it bundles its own fork of the targets plugin (`@kingstinct/expo-apple-targets`), which would sit beside `@bacons/apple-targets` and fight over the same Xcode project, it is untested on SDK 58, and it adds two shield extensions we do not need, each requiring its own Apple approval. Its Swift (MIT) is a useful reference for the monitor and picker code.
- The module exposes: `isAvailable()`, `authorizationStatus()`, `requestAuthorization()`, `pickApps(groupId)` (presents `FamilyActivityPicker` in a sheet, stores the selection in the App Group), `hasSelection(groupId)`, `startMonitoring(groups: {id, rungs[]}[])`, `stopMonitoring()`, `readEvents(sinceMs)` → `{groupId, day, rungMin, at}[]` and day-closed markers.
- Data goes to the backend through the existing sync engine (new entities registered in `sync/registry.py`), not new REST routes, as with Apple Health's adjustment. Stats endpoints change only by gaining the new module.
- A new ADR, `0027-screen-time.md`, records the sandbox constraint, the lower-bound decision and the entitlement gating.

## Left to the builder

Screen layouts within the brand system, exact copy, test layout, rung list tuning, module icon/accent token, how the habit editor groups the new option.
