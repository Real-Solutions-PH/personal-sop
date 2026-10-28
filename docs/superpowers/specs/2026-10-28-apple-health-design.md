# Apple Health activity + optional eat-back — design

Date: 2026-10-28 · Status: draft for approval

## Intent

Connect the iOS app to Apple Health (which the Fitness app and Apple Watch write into) so the user sees their daily activity inside Unfurl, and can **optionally** add the calories they burned to that day's calorie/macro budget.

## Decided by the user

- **Display by default.** Activity from Health is shown, never applied automatically.
- **Eat-back is opt-in, per day.** A button (and a notification) offers "You burned N kcal — add to today's budget?". Tap = that day's budget goes up. Ignore = nothing changes.
- **Unfurl stays the workout log.** Apple Health workouts are *not* imported into the app's workout list. Health is an activity dashboard plus the eat-back offer.
- Metrics: "all the important stuff".

## Goals

- Read from HealthKit, per day: **steps, active energy (kcal), walking+running distance, workout count**.
- Activity card on the fitness/nutrition home showing today's numbers.
- "Add to budget" action that applies today's burned kcal as a one-day adjustment.
- Local notification (evening) when there is burned energy not yet added.

## Non-goals

- Importing Apple workouts as Unfurl workouts; dedup between the two.
- Heart rate, sleep, VO2, body measurements, writing anything to Health.
- Android Health Connect.
- Background sync of raw Health data to the backend.

## Anti-goals (failure even if it works)

- Budget ever changing without the user tapping.
- An eat-back that carries forward to later days.
- App crashing or blocking on devices without Health / when permission is denied.

## Constraints found in the code

- `MacroTarget` is versioned by `effective_from` (`backend/app/modules/fitness/models.py:183`): a new row applies to every later day. So eat-back **must not** write a `MacroTarget`; it needs its own per-day row.
- Every "target for a day" read goes through `calc.target_for` (`backend/app/modules/fitness/calc.py:620`). It **stays unchanged** (raw base target): the target editors (`nutrition-targets.tsx`, `nutrient-limits.tsx`) pre-fill from it, and `views.target_public` reloads the row by id — an adjusted value there would leak into a saved `MacroTarget` and carry forward. Instead add `budget_for(day) = target_for(day) + adjustment(day)` and switch only the readers that *show a budget* (day view / remaining, nutrition stats, chat "today", widgets, public API budget). Editors keep `target_for`.
- Mobile computes targets on-device via `@domain/fitness/calc` + `fitStore`, so adjustments are part of the synced fitness state (same path as targets in `fitness/sync.py`), not only a backend table.
- `calc.py` is a port of `shared/prototype/fitness/calc.ts` with golden tests; the TS side gets the same change.
- Mobile already uses prebuild + custom dev client (native widget target, config plugins), and `expo-notifications` is installed. A HealthKit native module is a native change → new EAS build (ADR-0026), not an OTA update.
- Schema change → Alembic revision; API change → regenerate both clients.

## How (my calls, open to change)

- **Library:** `@kingstinct/react-native-healthkit` with its Expo config plugin (read-only; adds HealthKit entitlement + `NSHealthShareUsageDescription`). Modern TS API, maintained, works with prebuild.
- **Raw Health data stays on the device.** Mobile reads and displays it; only the applied adjustment goes to the backend.
- **Backend:** new table `target_adjustment` (`owner_id`, `day`, `kcal`, `source="health"`, unique per owner+day). Written through the existing sync registry as entity `target_adjustment` (natural key `day`), like `macro_target` — no new REST route. Re-tapping replaces with the new burned total, not adds; kcal 0 removes it.
- **Macro split of the added kcal:** protein unchanged; extra kcal split across carbs and fat in the base target's existing carbs:fat calorie ratio.
- **Full eat-back (100%)** of active energy. No percentage setting for now.
- **Day = phone's local day.** HealthKit sums by device time zone, so the client always sends `day`. Server accepts `day` within `ctx.today ± 1` (covers time-zone skew and adding yesterday's burn after midnight), rejects anything else.
- **Row stores the kcal added.** Card compares live burned vs added: shows "Add N kcal" when nothing added, "Add N more" when burned − added ≥ 50, "Added ✓" otherwise. Tap sets the row to the current burned total (replace, not sum).
- **Yesterday:** card shows yesterday's unadded burn until end of today, then it's gone.
- **Notification:** local, ~20:00, only if burned − added > 100. Tapping opens the activity card.
- **Permission flow:** "Connect Apple Health" button on the activity card → system prompt. Denied/unavailable → card shows "Connect" state, nothing else breaks.

## Left to the builder

Card layout/styling (match existing fitness cards), exact endpoint shapes, test layout, notification copy.
