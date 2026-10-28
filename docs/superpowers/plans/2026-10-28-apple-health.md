# Apple Health Activity + Eat-back Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show today's Apple Health activity in the app and let the user opt in, per day, to add burned kcal to that day's calorie/macro budget.

**Architecture:** The app is offline-first: `fitStore` (shared/prototype/fitness) holds state, the mobile mappers sync it to backend entities via the generic sync registry. Eat-back is a new synced entity `target_adjustment` (one row per day). A new `budgetFor`/`budget_for` = base target + that day's adjustment; budget *readers* switch to it, target *editors* keep `targetFor`. HealthKit is read on-device only.

**Tech Stack:** Expo SDK 58 (prebuild), `@kingstinct/react-native-healthkit`, `expo-notifications`, FastAPI + SQLModel, Alembic, jest-expo, pytest.

**Spec:** `docs/superpowers/specs/2026-10-28-apple-health-design.md`

## Global Constraints

- Budget never changes without a user tap. No auto-apply anywhere.
- An adjustment applies to its own `day` only — never carries forward.
- `targetFor` / `target_for` stay unchanged (raw base target). Target editors (`nutrition-targets.tsx`, `nutrient-limits.tsx`, `setMacroTarget`) keep using them.
- Adjustment split: protein unchanged; added kcal split across carbs (4 kcal/g) and fat (9 kcal/g) in the base target's carbs:fat **calorie** ratio. Base with carbs = fat = 0 → all to carbs.
- Tap sets adjustment kcal to the current burned total (replace, not sum). Adjustment `kcal` ≥ 0; kcal 0 = removed.
- Server accepts `day` within `ctx.today ± 1` only.
- Card states: nothing added → "Add N kcal"; burned − added ≥ 50 → "Add N more"; else "Added ✓". Yesterday's unadded burn shows until end of today.
- Notification: local, 20:00, only if today burned − added > 100.
- HealthKit read-only: steps, active energy, walking+running distance, workout count. No writes, no Apple workouts imported.
- Health unavailable / denied → card shows "Connect Apple Health", nothing else breaks.
- Native change → EAS build (ADR-0026). Never run `eas build`/`eas update` without the user's go.
- Never hand-edit `frontend/src/client/`; regenerate (`bash scripts/generate-client.sh`) and the mobile client (`mobile/openapi-ts.config.ts`).

## Review Focus

1. Saving the target editor on a day with an adjustment → saved `MacroTarget` equals the base, not base + burn (Task 3 test).
2. Re-tapping after more burning → adjustment replaced with new total, not doubled (Task 1 test).
3. Adjustment for `today + 2` or `today − 2` via sync → rejected (Task 2 test).
4. HealthKit returns nothing / throws / permission denied → `readActivity` resolves `null`, card renders Connect state (Task 5 test).
5. Base target missing on a day with an adjustment → `budgetFor` returns `undefined` (no budget from burn alone) (Task 1 test).

---

### Task 1: Shared domain — adjustment state, `budgetFor`, action

**Files:**
- Modify: `shared/prototype/fitness/data.ts` (type + `targets`-adjacent `adjustments: TargetAdjustment[]` in state, default `[]` in seed at ~line 983)
- Modify: `shared/prototype/fitness/calc.ts` (next to `targetFor`, line 437)
- Modify: `shared/prototype/fitness/actions.ts` (next to `setMacroTarget`, line 862)
- Test: `mobile/src/prototype/__tests__/burn-adjustment.test.ts` (new)

**Interfaces:**
- Produces:
  - `interface TargetAdjustment { id: string; day: string /* dayKey */; kcal: number }`
  - `budgetFor(s: FitState, day: string): MacroTarget | undefined` — `targetFor` plus that day's adjustment split per Global Constraints; same `id`/`effectiveFrom`/limits as base.
  - `adjustmentOn(s: FitState, day: string): number` — kcal added that day, 0 if none.
  - `setBurnAdjustment(day: string, kcal: number): void` — upsert one row per day (reuse id like `setMacroTarget` does); `kcal <= 0` removes the row.

- [ ] **Step 1: Write failing tests**

```ts
test("budgetFor adds burn to carbs/fat by calorie ratio, protein fixed", () => {
  // base 2000 kcal, P150 C200 F66.7 → carb kcal 800, fat kcal 600
  setMacroTarget({ kcal: 2000, protein: 150, carbs: 200, fat: 600 / 9 })
  setBurnAdjustment(dayKey(), 350)
  const b = budgetFor(fitStore.get(), dayKey())!
  expect(b.kcal).toBe(2350)
  expect(b.protein).toBe(150)
  expect(b.carbs).toBeCloseTo(200 + (350 * 800 / 1400) / 4)
  expect(b.fat).toBeCloseTo(600 / 9 + (350 * 600 / 1400) / 9)
})
test("adjustment does not carry to the next day", ...)        // budgetFor(tomorrow).kcal === 2000
test("re-tap replaces, not sums", ...)                         // set 300 then 450 → adjustmentOn === 450, one row
test("kcal 0 removes the row", ...)                            // adjustments.length === 0
test("no base target → budgetFor undefined", ...)              // only adjustment set
test("targetFor ignores adjustments", ...)                     // targetFor(today).kcal === 2000
```

- [ ] **Step 2: Run, expect FAIL** — `cd mobile && bun run test burn-adjustment` → "budgetFor is not a function".
- [ ] **Step 3: Implement** the type, state field (default `[]`, also in `fitStore.reset` seed), `budgetFor`, `adjustmentOn`, `setBurnAdjustment`.
- [ ] **Step 4: Run, expect PASS**; also `bun run test nutrition-plan store` still pass.
- [ ] **Step 5: Commit** `feat(fitness): per-day burn adjustment and budgetFor`

---

### Task 2: Backend — model, migration, `budget_for`, sync entity

**Files:**
- Modify: `backend/app/modules/fitness/models.py` (new `TargetAdjustment` after `MacroTarget`)
- Create: Alembic revision via `make backend-revision MSG="target adjustment"`
- Modify: `backend/app/modules/fitness/calc.py` (`AdjustmentS` dataclass, `FitState.adjustments`, `budget_for` next to `target_for` line 620)
- Modify: `backend/app/modules/fitness/repo.py` (`load_state` loads adjustments, ~line 273)
- Modify: `backend/app/modules/fitness/schema.py` (`TargetAdjustmentIn`, `TargetAdjustmentPublic`)
- Modify: `backend/app/modules/fitness/sync.py` (`_upsert_adjustment`, `Entity("target_adjustment", …)` after `macro_target`)
- Test: `backend/tests/modules/fitness/unit/test_budget.py` (new), `backend/tests/modules/fitness/api/test_sync_fitness.py` (add cases)

**Interfaces:**
- Consumes: Task 1 split rule (must match TS exactly).
- Produces:
  - Table `target_adjustment`: `OwnedRow` + `day: date`, `kcal: float` (`CHECK kcal >= 0`), `source: str = "health"` (String(8)); `UniqueConstraint("owner_id", "day", name="uq_target_adjustment_day")`.
  - `calc.budget_for(s: FitState, day: date) -> TargetS | None`.
  - Sync entity `"target_adjustment"`, `create_required=("day", "kcal")`, natural key `day`; upsert raises `invalid(...)` when `abs((day - ctx.today).days) > 1`; marks the day dirty via `services._dirty(ctx, day)`.

- [ ] **Step 1: Write failing tests** — unit: same six cases as Task 1 against `budget_for` with identical numbers; api: sync create for `ctx.today` → 200 and row exists; `today + 2` and `today − 2` → rejected; second create same day → same row updated.
- [ ] **Step 2: Run, expect FAIL** — `make backend-test` (Supabase up: `make supabase-up`).
- [ ] **Step 3: Implement** model, schema, `budget_for`, repo load, sync entity.
- [ ] **Step 4: Generate migration**, read it, check up+down: `make backend-migrate && make backend-downgrade && make backend-migrate`.
- [ ] **Step 5: Run tests + `make backend-lint`, expect PASS.**
- [ ] **Step 6: Commit** `feat(fitness): target_adjustment entity and budget_for`

---

### Task 3: Switch budget readers to `budgetFor` / `budget_for`

**Files (switch to budget):**
- Backend: `calc.py` `nutrition_day` (line 646) and line 716 caller; `public.py:348`; `chat.py:306` `target_today`.
- Shared/mobile: `calc.ts:462`, `history.ts:85`, `actions.ts` `macrosLeftToday` (line 898), `nutrition.tsx:212`, `nutrition-day.tsx:15`, `nutrition-stats.tsx:55`, `nutrition-share.tsx:180`, `mobile/src/surfaces/snapshot.ts:121` (widget).

**Files (stay on target — do not touch):** `nutrition-targets.tsx:27`, `nutrient-limits.tsx:32`, `actions.ts` `setMacroTarget` `prev`, `views.target_public`, `views.targets`, `nutrition/stats.py:41`.

**Interfaces:**
- Consumes: `budgetFor`, `budget_for` from Tasks 1–2.

- [ ] **Step 1: Write failing tests**
  - `nutrition-plan.test.tsx`: `"editor save on adjusted day keeps base"` — set target 2000, `setBurnAdjustment(today, 400)`, re-save editor with its pre-filled values → `targetFor(today).kcal === 2000`.
  - `burn-adjustment.test.ts`: `macrosLeftToday().kcal` increases by 400 after adjustment.
  - backend `test_budget.py`: `nutrition_day(s, today).target.kcal == 2400` with adjustment; chat `target_today` returns 2400.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Swap the calls listed above.** Existing golden tests (`test_calc_golden.py`) must still pass unchanged (no adjustments in fixtures).
- [ ] **Step 4: Run** `cd mobile && bun run test && bun run typecheck` and `make backend-test`, expect PASS.
- [ ] **Step 5: Commit** `feat(fitness): budgets include the day's burn adjustment`

---

### Task 4: Clients + mobile mapper

**Files:**
- Regenerate: `bash scripts/generate-client.sh`; mobile client via `mobile/openapi-ts.config.ts` (its script in `mobile/package.json`).
- Modify: `mobile/src/live/mappers/fitness.ts` (new `targetAdjustmentMapper()` after `macroTargetMapper`, line 737; register in list ~line 1119; update header comment entity list)
- Test: `mobile/src/live/__tests__/fitness.test.ts`

**Interfaces:**
- Produces: `targetAdjustmentMapper(): Mapper<S, TargetAdjustment>` — entity `"target_adjustment"`, `list: s => s.adjustments`, `toServer: { day, kcal, source: "health" }`, `fromServer` → `{ id, day, kcal }`, `merge` via `mergeById`.

- [ ] **Step 1: Failing test** — `expect(targetAdjustmentMapper().entity).toBe("target_adjustment")`; round-trip `fromServer(toServer(x))` equals `x`.
- [ ] **Step 2–4: Implement, run** `bun run test fitness`, PASS.
- [ ] **Step 5: Commit** `feat(mobile): sync target adjustments`

---

### Task 5: HealthKit reader

**Files:**
- Modify: `mobile/package.json` (`bunx expo install @kingstinct/react-native-healthkit` from `mobile/`)
- Modify: `mobile/app.json` — plugin `["@kingstinct/react-native-healthkit", { "NSHealthShareUsageDescription": "Unfurl reads your steps, active calories, distance and workouts to show your daily activity and, if you choose, add burned calories to your budget.", "NSHealthUpdateUsageDescription": false }]`
- Create: `mobile/src/prototype/health.ts`
- Create: `mobile/__mocks__/@kingstinct/react-native-healthkit.ts` (or `jest.mock` in test)
- Test: `mobile/src/prototype/__tests__/health.test.ts`

**Interfaces:**
- Produces:
  - `interface Activity { steps: number; activeKcal: number; distanceKm: number; workouts: number }`
  - `healthAvailable(): boolean` — iOS and `isHealthDataAvailable()`.
  - `connectHealth(): Promise<boolean>` — requests read for `HKQuantityTypeIdentifierStepCount`, `ActiveEnergyBurned`, `DistanceWalkingRunning`, `HKWorkoutTypeIdentifier`.
  - `readActivity(day: string): Promise<Activity | null>` — sums over the device-local day; any throw / unavailable → `null`.

- [ ] **Step 1: Failing tests** — mocked lib returns samples → `readActivity` sums correctly; lib throws → `null`; `Platform.OS = "android"` → `healthAvailable() === false`, `readActivity` → `null`.
- [ ] **Step 2–4: Implement, run** `bun run test health && bun run typecheck`, PASS.
- [ ] **Step 5: Commit** `feat(mobile): read daily activity from Apple Health`

---

### Task 6: Activity card + eat-back button

**Files:**
- Create: `mobile/src/prototype/screens/activity-card.tsx`
- Modify: `mobile/src/prototype/screens/nutrition.tsx` (render card above the day's meals when `day` is today or yesterday)
- Test: `mobile/src/prototype/__tests__/activity-card.test.tsx`

**Interfaces:**
- Consumes: `readActivity`, `connectHealth`, `healthAvailable` (Task 5); `adjustmentOn`, `setBurnAdjustment` (Task 1).
- Produces: `eatBackOffer(burned: number, added: number): { kind: "add" | "more" | "added"; kcal: number }` (exported from `activity-card.tsx`) — `added === 0 && burned > 0` → add; `burned − added ≥ 50` → more (kcal = burned − added); else added.

- [ ] **Step 1: Failing tests** — `eatBackOffer(420, 0)` → `{kind:"add",kcal:420}`; `(500, 420)` → `{kind:"more",kcal:80}`; `(440, 420)` → `{kind:"added"}`; `(0,0)` → added. Render: Health null → "Connect Apple Health" visible; activity present → steps, kcal, km, workouts shown; tapping "Add 420 kcal" → `adjustmentOn(today) === 420`; yesterday card visible only for yesterday with unadded burn.
- [ ] **Step 2–4: Implement** (match existing fitness card styles in `fitness-controls.tsx`/`ui.tsx`), **run** `bun run test activity-card && bun run lint && bun run typecheck`, PASS.
- [ ] **Step 5: Commit** `feat(mobile): activity card with opt-in eat-back`

---

### Task 7: Evening notification

**Files:**
- Modify: `mobile/src/prototype/local-reminders.ts` (follow its existing scheduling pattern)
- Test: `mobile/src/prototype/__tests__/local-reminders.test.ts`

**Interfaces:**
- Consumes: `readActivity`, `adjustmentOn`.
- Produces: `scheduleEatBackReminder(burned: number, added: number): Promise<void>` — schedules for 20:00 local today if `burned − added > 100` and now < 20:00; otherwise cancels any pending one. Tap deep-links to the nutrition screen. Called when the activity card loads data.

- [ ] **Step 1: Failing tests** — (300, 0) at 15:00 → scheduled once for 20:00; (300, 250) → none/cancelled; (300, 0) at 21:00 → none.
- [ ] **Step 2–4: Implement, run** `bun run test local-reminders`, PASS.
- [ ] **Step 5: Commit** `feat(mobile): evening eat-back reminder`

---

### Task 8: Final verification

- [ ] `cd mobile && bun run typecheck && bun run lint && bun run test`
- [ ] `make backend-lint && make backend-test`
- [ ] `cd mobile && bunx expo prebuild --platform ios --no-install --clean` dry check that the HealthKit entitlement + `NSHealthShareUsageDescription` land in the generated project, then discard `ios/` if it's git-ignored.
- [ ] Ask the user before any `eas build` (native change, needs a new iOS build).
