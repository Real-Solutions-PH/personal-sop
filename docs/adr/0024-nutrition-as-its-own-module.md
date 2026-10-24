# ADR-0024 — Nutrition as its own module

- **Date:** 2026-10-24
- **Status:** accepted
- **Deciders:** owner (delegated: "decide rather than ask")

## Context

Nutrition grew up inside Fitness. Meals, macro targets, nutrient limits and
the food library were a section of the Fitness page (`/fitness/nutrition/*`),
and every surface that sums the app up treated eating as part of training:

- the **Fitness area rate** averaged the workout session rate with calorie
  adherence, so a missed workout and an over-calorie day moved the same
  Life Score area;
- the Fitness **metrics** carried "Protein hit rate" and "Calories on target";
  its **misses** carried "Over calories by N%"; its **Today ring** counted
  the protein target; its **facets** had a "Nutrition" facet whose module was
  `fitness`;
- turning Fitness off in Settings hid meals too, and setup and onboarding had
  no way to pick one without the other.

People track one without the other all the time (someone counting macros who
does not lift; someone lifting who does not log food). The owner asked for
Nutrition to be its own feature: its own module, its own button on Today, its
own main page with statistics, and its own place in setup, Stats and the
Life Score. Fitness keeps training: workouts, exercises, routines and
weigh-ins.

## Decision

### One more module key, `nutrition`

`ModuleKey` becomes `habits | tasks | fitness | nutrition | finance` in the
app (`shared/prototype/contract.ts`) and on the server (profile, dashboard and
stats contracts). Nutrition is a full module:

| Surface | Nutrition |
|---|---|
| Area | `nutrition`, label "Nutrition", accent `nut` (already in the theme) |
| Enable toggle | its own `module_pref` row; default **on** |
| Life Score weight | its own; default **2** |
| Area rate | the mean of "calories on target" and "protein hit rate" over days with meals and a target; **null** (left out of the Life Score) when nothing was logged |
| Metrics | `calories` (Calories on target), `protein` (Protein hit rate), `kcal` (Average calories), `logged` (Days logged) |
| Today ring | the protein target, when a target applies |
| Misses | days more than 10% over the calorie target |
| Facet | "Nutrition", module `nutrition`, href `/nutrition` |
| Routes | `/nutrition` (main page), `/nutrition/history`, `/nutrition/meals/[id]`, `/nutrition/new`, `/nutrition/targets`, `/nutrition/foods` |
| Setup and onboarding | its own setup step (macro targets) and its own pick in "What do you want to track?" |

Fitness keeps the session rate as its whole area rate, and keeps workouts,
PRs, volume, progress rate and weight as metrics, the gym-session misses and
stalled lifts, and the weigh-in and workout in the Today ring.

### Data stays where it is

The tables (`meal`, `meal_item`, `macro_target`, `food_item`), their sync
entities and the device's `fitness` store are **not** moved. The nutrition
module on both sides reads them through the fitness module's existing code
(`shared/prototype/fitness/calc.ts`, `app.modules.fitness.calc` and
`repo.load_state`). Moving rows between tables or store keys would risk data
on every device that has not updated yet and buys nothing the person can see;
the boundary that matters to them is the one in the app.

The existing write API (`/api/v1/fitness/meals`, `/fitness/targets`,
`/fitness/nutrition/day`) stays, because Fern's meal tools, the outbox and
every installed build call it. A nutrition-facing read surface is added for
what the app could not read before: `GET /api/v1/nutrition/foods`, the
person's own food library (the foods Fern has read from labels and saved).

### Schema change (Alembic, one revision)

Three check constraints list the module keys and must admit `nutrition`:
`ck_module_pref_module`, `ck_setup_skip_module` and
`ck_daily_module_stat_module`. The same revision:

- gives every person who has a `fitness` preference row a `nutrition` row with
  the same enabled flag and the default weight, so someone who had turned
  Fitness off (and with it meals) does not find Nutrition switched back on;
- renames goal metric references `fitness:protein` and `fitness:calories` to
  `nutrition:protein` and `nutrition:calories`, so a goal set on either keeps
  tracking.

The downgrade reverses the goal rename, deletes the `nutrition` rows from the
three tables, and restores the four-key constraints. The device applies the
same two rules to its own saved state (a missing `nutrition` switch inherits
the Fitness one; a goal on an old reference reads the new one).

### Old links keep working

`/fitness/nutrition`, `/fitness/nutrition/history`, `/fitness/nutrition/new`,
`/fitness/nutrition/targets` and `/fitness/nutrition/meals/[id]` redirect to
their `/nutrition` counterparts with the query string carried over, and
`/fitness?tab=eat` redirects to `/nutrition`. Notifications, widgets, Fern's
cards and stored Life Score history that hold an old link still land.

### Fern

Fern's meal logging and nutrition status are unchanged in behaviour: the tools
still live with the fitness capture code. Fern's grounding names what is left
in the Nutrition ring separately from the Fitness one. A separate nutrition
routing group, if wanted, belongs with the Fern tools work and is not part of
this change.

## Constitution clause deviated from

None.

## Consequences

**Positive:**
- Nutrition can be switched on, weighted and set up without Fitness, and the
  reverse.
- The Life Score reads training and eating as two areas, so one no longer
  hides the other.
- No data moves, so no device can lose meals during the rollout.

**Negative:**
- The nutrition module's code reads the fitness module's tables and store, so
  the two stay coupled in code even though they are separate in the app.
- Stored daily rollups (`daily_module_stat`) from before the change hold the
  old blended Fitness rate until they are rebuilt; Life Score history for
  past days may differ by a few points from what is computed now.

**Follow-ups:**
- If the meal tables ever need their own owner (for example a nutrition-only
  export), move them behind `app.modules.nutrition` with a data migration of
  their own.
- A nutrition routing group for Fern, coordinated with the Fern tools work.
