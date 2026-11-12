# ADR-0039 — The first-run guided tour is a small in-house overlay, not a tour library

- **Date:** 2026-11-12
- **Status:** accepted
- **Deciders:** Kai (asked for a driver.js-style tour, 2026-11-12), engineering

## Context

The retention audit ([27-retention-audit.md](../27-retention-audit.md), finding F6, fix 5) found onboarding long and the app's breadth visible all at once. Kai asked for a guided tour that points at the real interface one step at a time, "similar to how driver.js does it". The tour has five steps (tell Fern something; tick a habit or task; open Plan; open Stats; set reminders) and these requirements:

1. Runs on Expo SDK 58 (the app moved from 57 since the brief) with the New Architecture, on iOS and on web for the prototype build.
2. A step finishes when the person **does the action** (sends Fern a message, ticks something), not when they tap Next.
3. Steps point at controls on **different tabs and screens**: the tab bar, a card on Today, a row on Me. The Fern step must step aside while Fern's drawer (a bottom sheet) is open, because the person is typing in it.
4. A target below the fold is scrolled into view.
5. Respects Reduce Motion; licence acceptable (no AGPL).

Candidates checked on npm on 2026-11-12:

| Library | Licence | Last publish | Notes |
|---|---|---|---|
| `react-native-copilot` 3.3.3 | MIT | 2024-12 | Wraps each target in a `walkthroughable` HOC under one provider; every step's target must be mounted when the tour starts, so steps on other tabs need workarounds. Steps advance with Next; no "finish on the real action". Ships `@changesets/cli` as a runtime dependency. Needs `react-native-svg` (already in the app). |
| `react-native-spotlight-tour` 4.0.0 | MIT | 2025-06 | Hook API (`next()`, `goTo()`), so an action could advance it; pulls in `@floating-ui/react-native` and `react-native-responsive-dimensions`. Targets are `AttachStep` wrappers that must be inside its provider tree, which our tab bar (in the route layout) and pages (in the stack) do not share in a way that suits it. |
| `rn-tourguide` 3.3.2 | MIT | 2024-10 | A copilot fork with `flubber` and `lodash` helpers; same mounting model; quieter maintenance. |
| `react-native-walkthrough-tooltip` 1.7.0 | MIT | 2026-10 | A tooltip, not a spotlight tour: no dimming, no sequence. |

None is AGPL. None finishes a step on an app event out of the box, and each assumes its targets live inside its own provider tree, which fights point 3.

## Decision

Build the tour in the app, about 600 lines with no new dependency:

- **`tour/machine.ts`**: a pure reducer (`start`, `signal`, `skipStep`, `skipTour`, `unavailable`). Each step has one completion rule (`completes(step, signal)`), and the reducer emits a funnel note for every step shown, done or skipped. Fully unit tested.
- **`tour/targets.ts`**: controls register under a stable id with a ref callback (`ref={useTourTarget("tab-plan")}`); the overlay measures the active one with `measureInWindow`. A target inside a scrolling page also registers that page's existing `PageNudge` scroll, which brings it into view. Screens never import the overlay; the Plan tab is anchored from the tab bar in the route layout, so the Plan screen itself is untouched.
- **`tour/overlay.tsx`**: four dim panes around the target (the hole lets taps through to the real control, the panes hold other taps), a ring around the hole, and Fern's card with "Skip" (this step) and "Skip tour" (always visible). When Fern's drawer is open the dimming goes and only a compact card stays at the top. When a target is not on screen the card shows without dimming and says where to go. A watcher turns store changes (a new capture, a habit or task ticked, reminders granted) and route changes into signals.
- **Per-account state** in a local store keyed by the signed-in account, so neither the tour nor the one-time tips repeat for the same person on this phone. Replay lives in Me → Help.
- **Motion:** the card fades in over 200 ms when its step changes (opacity only); nothing moves under Reduce Motion. The dimming does not animate.

## Constitution clause deviated from

None. This adds no dependency and changes no default.

## Consequences

**Positive:**
- Steps finish on the real action, across tabs, and step aside for the Fern drawer, which no candidate does without patching.
- No new dependency to keep current with Expo SDK and React Native upgrades.
- The completion rules are pure functions with tests; the funnel records every step (KPI 6 in [25-retention-kpis.md](../25-retention-kpis.md)).

**Negative:**
- We own the overlay: positioning, measuring, and accessibility are ours to maintain.
- The hole is a rounded ring over a rectangular cut-out (four panes), not an SVG mask with rounded corners.
- Tour and tip state is kept per account on the phone, not synced: someone who signs in on a second phone sees the one-time tips once more there.

**Follow-ups:**
- Apple and Google one-tap sign-up in live mode needs the providers configured on the self-hosted GoTrue (ADR-0021) and in the app; until then live mode's account step is email only and the prototype shows the one-tap buttons.
