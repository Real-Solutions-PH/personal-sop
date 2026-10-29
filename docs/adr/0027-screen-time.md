# ADR-0027 — Screen time: lower-bound minutes from DeviceActivity thresholds

- **Date:** 2026-10-29
- **Status:** accepted
- **Deciders:** owner (design approved 2026-10-29)
- **Design:** [2026-10-29-screen-time-design.md](../superpowers/specs/2026-10-29-screen-time-design.md)

## Context

The owner wants the phone's screen time as data: per group of apps (social media, games, anything picked), stored on the server, driving habits that complete themselves ("no social media today") and counted in the Life Score and the stats hexagon.

Apple exposes screen time to third-party apps only through the Screen Time API, and only one part of it lets numbers reach the app's own code:

- **FamilyControls** grants permission (`.individual`) and shows the system app picker. The picks are opaque tokens; the app cannot read app names, bundle ids or category names, and cannot preselect a category.
- **DeviceActivity monitor** (an app extension) is woken when "the picked apps have been used for N minutes" in a scheduled window. It can write to an App Group the app reads.
- **DeviceActivityReport** (an app extension) sees exact per-app minutes, but runs in a read-only sandbox: no network, no shared storage. Apple confirms this is deliberate.

The entitlement `com.apple.developer.family-controls` must be granted by Apple for distribution, separately for the app and for every Screen Time extension.

## Decision

- **Store a lower bound.** One repeating DeviceActivity window per group, from the user's day start to one minute before it, with threshold events at 1, 5, 10, 15 minutes, every 15 minutes to 4 hours, then 5, 6 and 8 hours, plus `limit + 1` for every habit limit on the group. The highest threshold crossed is "at least N minutes". Every surface says "≥ N min".
- **Only observed days count.** A day is observed when the extension recorded the window's start with the group's apps picked. An unobserved day writes nothing: an auto habit counts as missed and says "Not tracked", because a pass with no measurement is the failure the owner cares about most.
- **Thresholds are checked for plausibility.** `includesPastActivity` is on, so a mid-day reschedule still counts the morning; a threshold of N minutes crossed less than N minutes after the window began is dropped (the iOS 26.2–26.3 bug fires every threshold at once).
- **Auto habits** carry a rule (`rule_kind = 'screen_limit'`, group, `rule_max_min`). They are never ticked by hand: the server answers 409 `habit_auto` and the device offers no control. The phone writes a `done` log with `source = 'screen'` and a derived id when a closed, observed day stayed within the limit; it never overwrites an existing log.
- **Screen time is a module** (`screen`), a seventh Life Score area (weight 2, enabled by default) and the eighth hexagon facet, appended after Finance so existing corners keep their places. Day score: 1 within budget, falling linearly to 0 at twice the budget.
- **Native code is ours.** A local Expo module (`mobile/modules/unfurl-screen-time`) and one `device-activity-monitor` extension through `@bacons/apple-targets`, which the widget already uses. `react-native-device-activity` was rejected: it bundles its own fork of the targets plugin, which would fight `@bacons/apple-targets` over the Xcode project, it is untested on Expo SDK 58, and it adds two shield extensions that would each need their own Apple approval.
- **Gated build.** The entitlements and the extension are added at prebuild only when `UNFURL_SCREEN_TIME=1`. Without it the build is unchanged, the JS sees no native module, and screen-time surfaces render as locked previews. This keeps TestFlight shipping while Apple reviews the distribution entitlement.

## Consequences

- Minutes are coarse (15-minute steps above 15 minutes) and best effort: a missed callback can let an auto habit pass. Accepted and stated in the UI.
- No history before the feature is switched on, beyond the current day.
- Testing needs a real iPhone; the simulator has no usage to count and does not enforce the report sandbox.
- The owner must request "Family Controls (Distribution)" for `com.schadenkai.personal-sop` and `com.schadenkai.personal-sop.activity-monitor` and register the App Group `group.com.schadenkai.personal-sop` before a TestFlight build can carry the feature.
- Follow-ups: focus quality (a monitor window per focus session), a display-only DeviceActivityReport view with exact minutes.
