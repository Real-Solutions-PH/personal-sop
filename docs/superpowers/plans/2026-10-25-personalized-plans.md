# Personalized Plans Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the kcal-per-kg guess with a formula-based daily plan (kcal, protein, carbs, fat, fiber) built from the user's body stats, activity and goal, editable afterwards, with warn-only notes on adjustments.

**Architecture:** Four nullable profile fields plus `plan_goal` go on `FitnessSettings` (backend + sync + mobile mapper). A pure estimator in `shared/prototype/fitness/plan.ts` does the math and the notes, offline. One `PlanForm` component serves both the setup step and the Targets screen.

**Tech Stack:** FastAPI + SQLModel + Alembic (mypy strict), shared TS domain (`@domain/*` → `shared/prototype/*`), Expo / React Native, jest-expo, Biome.

**Spec:** `docs/superpowers/specs/2026-10-25-personalized-plans-design.md`

## Global Constraints

- Notes warn, never block saving.
- The estimate is a formula; no AI call anywhere in this feature.
- `goal_direction` keeps exactly `cut | maintain | bulk`. The new goal lives in `plan_goal`: `lose | maintain | recomp | build` → `cut | maintain | maintain | bulk`.
- When `goal_direction` disagrees with the mapping of `plan_goal`, `goal_direction` wins.
- Store kg / cm. `lb` users convert at the input edge (`LB_TO_KG` in `shared/prototype/fitness/actions.ts:297`).
- Re-saving targets must keep custom limits (existing carry-over in `PUT /targets`, `routes.py:542`). Do not touch it.
- Never hand-edit `frontend/src/client/` or `mobile/src/client/`; regenerate.
- Run mobile tests with `bun run test` from `mobile/`, never `bun test`.
- Conventional commits; end each with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Sedentary + lose for a small user:** 0.8 × 1.2 × BMR < BMR, so the raw estimate lands below resting burn and triggers its own note. The estimate is clamped up to `max(BMR, sex floor)`, then rounded up to 50. (My call: an estimate that warns about itself is wrong.) Test in Task 2.
2. **Stale goal from an old build:** `plan_goal = recomp` but an old client patched `goal_direction = bulk`. `planGoalFor` returns `build`. Test in Task 2.
3. **No weigh-in yet** (Fitness setup step skipped or module off): the form asks for weight, and Save creates a weigh-in with it (plus body fat if given). Test in Task 4.
4. **Partial profile** (existing user, no birth year): Suggest opens the form with blanks, and Apply stays disabled until sex, birth year, height, weight and activity are set. Test in Task 4.
5. **Out-of-range inputs:** age under 13 or over 100, height outside 100–250 cm, body fat outside 3–70%. The backend rejects them with 422, and the form disables Apply. Tests in Tasks 1 and 4.

---

### Task 1: Backend profile fields

**Files:**
- Modify: `backend/app/modules/fitness/models.py` (`FitnessSettings`, ~line 280)
- Modify: `backend/app/modules/fitness/schema.py` (`FitnessSettingsIn` :274, `FitnessSettingsPublic` :158, Literals near :32)
- Create: `backend/app/alembic/versions/<rev>_personalized_plan_profile.py`
- Test: `backend/tests/modules/fitness/api/test_library_settings.py`
- Regenerate: `frontend/src/client/`, `mobile/src/client/`

**Interfaces:**
- Produces wire fields on `/fitness/settings` and the `fitness_settings` sync entity: `sex: "male"|"female"|null`, `birth_year: int|null`, `height_cm: float|null`, `activity_level: "sedentary"|"light"|"moderate"|"active"|"very_active"|null`, `plan_goal: "lose"|"maintain"|"recomp"|"build"|null`.

- [ ] **Step 1: Write the failing test** `test_settings_plan_profile_round_trip_and_validation`

```python
def test_settings_plan_profile_round_trip_and_validation(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    body = {"sex": "female", "birth_year": 1996, "height_cm": 165,
            "activity_level": "light", "plan_goal": "recomp"}
    st = ok(client.patch(f"{API}/settings", headers=h, json=body))
    assert {k: st[k] for k in body} == body
    assert st["goal_direction"] == "maintain"  # untouched; client writes both
    for bad in ({"height_cm": 99}, {"height_cm": 251}, {"birth_year": 1899},
                {"birth_year": utcnow().year - 12}, {"sex": "x"},
                {"activity_level": "extreme"}, {"plan_goal": "bulk"}):
        assert client.patch(f"{API}/settings", headers=h, json=bad).status_code == 422
```

- [ ] **Step 2: Run it, expect FAIL** (unknown fields are dropped, so the `==` fails)

Run: `make backend-test` (or `cd backend && uv run pytest tests/modules/fitness/api/test_library_settings.py -k plan_profile -v`; needs `make supabase-up`)

- [ ] **Step 3: Implement**
  - Model: add the five nullable columns (`sex` String(6), `birth_year` Integer, `height_cm` Float, `activity_level` String(11), `plan_goal` String(8)). Use `enum_check` for the three enums, allowing NULL like the existing pattern, plus `CheckConstraint("height_cm IS NULL OR height_cm BETWEEN 100 AND 250")` and `"birth_year IS NULL OR birth_year >= 1900"`.
  - Schema: add the Literals `Sex`, `ActivityLevel` and `PlanGoal`. `FitnessSettingsIn` gets optional fields: `height_cm` with `ge=100, le=250`, and `birth_year` with `ge=1900`, plus a validator rejecting `> current_year - 13`. `FitnessSettingsPublic` gets the five as `| None`.
  - Migration: `make backend-revision MSG="personalized plan profile"`. Read the script and make sure the check constraints are in it (autogenerate misses them). The downgrade drops the constraints, then the columns. Confirm a single head (`uv run alembic heads`).
- [ ] **Step 4: Run test, expect PASS.** Then `make backend-migrate && make backend-downgrade && make backend-migrate` to confirm the migration runs up and down cleanly. Then `make backend-lint`.
- [ ] **Step 5: Regenerate clients:** `bash scripts/generate-client.sh`, then `cp frontend/openapi.json mobile/openapi.json && cd mobile && bun run generate-client`.
- [ ] **Step 6: Commit** `feat(fitness): plan profile fields on fitness settings`

---

### Task 2: Estimator and notes

**Files:**
- Create: `shared/prototype/fitness/plan.ts`
- Test: `mobile/src/prototype/__tests__/fitness-plan.test.ts`

**Interfaces:**
- Consumes: `Macros`, `FitnessSettings` from `@domain/fitness/data` (Task 3 adds the fields `planGoal` reads; until then, type the param as `Pick<FitnessSettings, "goalDirection"> & { planGoal?: PlanGoal }`).
- Produces:

```ts
export type Sex = "male" | "female"
export type ActivityLevel = "sedentary" | "light" | "moderate" | "active" | "very_active"
export type PlanGoal = "lose" | "maintain" | "recomp" | "build"
export interface PlanInputs {
  sex: Sex; age: number; heightCm: number; weightKg: number
  bodyFatPct?: number; activity: ActivityLevel; goal: PlanGoal
}
export interface Plan extends Macros { fiberG: number; bmr: number; tdee: number }
export type NoteField = "kcal" | "protein" | "fat" | "fiber" | "totals"
export interface PlanNote { field: NoteField; text: string }
export const ACTIVITY: Record<ActivityLevel, { label: string; factor: number }>
export const GOALS: Record<PlanGoal, { label: string; help?: string; kcal: number; proteinPerKg: number; direction: FitnessSettings["goalDirection"] }>
export const NOTE_LIMITS: { kcalFloor: Record<Sex, number>; maxWeeklyPct: number; proteinMin: number; proteinMax: number; fatMinPct: number; fiberMin: number; totalsTolerance: number }
export function ageFrom(birthYear: number, today?: Date): number
export function estimatePlan(i: PlanInputs): Plan
export function planNotes(t: Macros & { fiberG?: number }, i: PlanInputs): PlanNote[]
export function planGoalFor(s: Pick<FitnessSettings, "goalDirection"> & { planGoal?: PlanGoal }): PlanGoal
```

Values, copied from the spec:
- **Activity factors:** 1.2 / 1.375 / 1.55 / 1.725 / 1.9. The labels come from the spec table.
- **GOALS:**
  - lose: 0.80, 2.2, `cut`
  - maintain: 1.00, 1.8, `maintain`
  - recomp: 0.95, 2.2, `maintain`. Help text: "Best if you're new to lifting, coming back, or carrying extra fat. Weight stays about the same."
  - build: 1.07, 2.0, `bulk`
- **Labels:** "Lose fat", "Maintain", "Recomp", "Build muscle".
- **NOTE_LIMITS:** `kcalFloor {female: 1200, male: 1500}`, `maxWeeklyPct 0.01`, `proteinMin 0.8`, `proteinMax 3.0`, `fatMinPct 0.20`, `fiberMin 25`, `totalsTolerance 0.05`.

Algorithm (order matters for the rounding):
1. **BMR:** `bmr = bodyFatPct ? 370 + 21.6 * lean : 10w + 6.25h − 5a + (male ? 5 : −161)`, where `lean = w × (1 − bf/100)`. `tdee = bmr × factor`.
2. **kcal:** `kcal = round50(tdee × goal.kcal)`. Then `kcal = max(kcal, ceil50(max(bmr, floor[sex])))`, the Review Focus 1 clamp.
3. **Protein:** `protein = round(bf >= 30 ? lean × 2.6 : w × goal.proteinPerKg)`.
4. **Fat, carbs, fiber:** `fat = round(kcal × 0.27 / 9)`, `carbs = max(0, round((kcal − 4·protein − 9·fat) / 4))`, `fiberG = max(25, round(14 × kcal / 1000))`.
5. **Notes**, at most one per field, `kcal` checks in this order:
   - `kcal < bmr` → "Below what your body burns at rest"
   - `kcal < floor` → "Very low — hard to get enough nutrients"
   - `|kcal − tdee| × 7 / 7700 > 0.01·w` → `` `Faster than ~${x} kg/week loss` `` (or `gain`, by sign), with x to 1 decimal.

   Protein outside `[0.8w, 3.0w]` → "May lose muscle" / "More than your body uses". `9·fat < 0.20·kcal` → "Very low fat can affect hormones". `fiberG < 25` → "Below the daily minimum". `|4P+4C+9F − kcal| > 0.05·kcal` → `` `Your macros total ${n} kcal, your target says ${kcal}` ``.

- [ ] **Step 1: Write the failing tests**

```ts
const A: PlanInputs = { sex: "male", age: 30, heightCm: 180, weightKg: 80, activity: "moderate", goal: "maintain" }
const B: PlanInputs = { sex: "female", age: 25, heightCm: 165, weightKg: 60, bodyFatPct: 25, activity: "light", goal: "lose" }
const C: PlanInputs = { sex: "male", age: 40, heightCm: 175, weightKg: 110, bodyFatPct: 35, activity: "sedentary", goal: "recomp" }

test("Mifflin-St Jeor, maintain", () => {
  expect(estimatePlan(A)).toMatchObject({ bmr: 1780, kcal: 2750, protein: 144, fat: 83, carbs: 357, fiberG: 39 })
  expect(estimatePlan(A).tdee).toBeCloseTo(2759)
})
test("Katch-McArdle when body fat known, lose", () => {
  expect(estimatePlan(B)).toMatchObject({ bmr: 1342, kcal: 1500, protein: 132, fat: 45, carbs: 142, fiberG: 25 })
})
test("lean-mass protein at 30%+ body fat, recomp", () => {
  expect(estimatePlan(C)).toMatchObject({ kcal: 2200, protein: 186 })
})
test("build is a lean surplus", () => {
  expect(estimatePlan({ ...A, goal: "build" }).kcal).toBe(2950)
})
test("estimate never lands below BMR or the floor", () => {
  const small: PlanInputs = { sex: "female", age: 60, heightCm: 150, weightKg: 45, activity: "sedentary", goal: "lose" }
  const p = estimatePlan(small)
  expect(p.kcal).toBeGreaterThanOrEqual(Math.max(p.bmr, 1200))
})
test.each([A, B, C, { ...A, goal: "build" as const }])("a fresh estimate carries no notes", (i) => {
  expect(planNotes(estimatePlan(i), i)).toEqual([])
})
test("each note fires", () => {
  const p = estimatePlan(A)
  const fields = (t: Partial<Plan>) => planNotes({ ...p, ...t }, A).map((n) => n.field)
  expect(planNotes({ ...p, kcal: 1700 }, A).filter((n) => n.field === "kcal")).toHaveLength(1)
  expect(planNotes({ ...p, kcal: 1700 }, A)[0].text).toBe("Below what your body burns at rest")
  expect(planNotes({ ...p, kcal: 3700, carbs: 594 }, A).find((n) => n.field === "kcal")?.text).toBe("Faster than ~0.9 kg/week gain")
  expect(fields({ protein: 50, carbs: 451 })).toEqual(["protein"])
  expect(fields({ protein: 260, carbs: 236 })).toContain("protein")
  expect(fields({ fat: 40, carbs: 452 })).toContain("fat")
  expect(fields({ fiberG: 20 })).toEqual(["fiber"])
  expect(fields({ carbs: 200 })).toEqual(["totals"])
})
test("goal_direction wins over a stale plan_goal", () => {
  expect(planGoalFor({ goalDirection: "bulk", planGoal: "recomp" })).toBe("build")
  expect(planGoalFor({ goalDirection: "maintain", planGoal: "recomp" })).toBe("recomp")
  expect(planGoalFor({ goalDirection: "cut" })).toBe("lose")
})
test("ageFrom", () => expect(ageFrom(1996, new Date("2026-10-25"))).toBe(30))
```

The values above were checked with a script against the algorithm. The rate note's exact copy is `` `Faster than ~${x} kg/week ${loss|gain}` ``. The kcal 1700 case also fires `totals`; that's expected.

- [ ] **Step 2: Run, expect FAIL:** `cd mobile && bun run test -- fitness-plan`
- [ ] **Step 3: Implement `plan.ts`** to the interfaces and algorithm above. `planGoalFor`: if `planGoal` is set and `GOALS[planGoal].direction === goalDirection`, return it; otherwise map `cut→lose`, `maintain→maintain`, `bulk→build`.
- [ ] **Step 4: Run, expect PASS.** Then `bun run typecheck && bun run lint` from `mobile/`.
- [ ] **Step 5: Commit** `feat(fitness): personalized plan estimator and notes`

---

### Task 3: Settings type and mapper

**Files:**
- Modify: `shared/prototype/fitness/data.ts:136` (`FitnessSettings`)
- Modify: `mobile/src/live/mappers/fitness.ts:955-995` (settings `toServer` / `fromServer`)
- Test: `mobile/src/live/__tests__/fitness.test.ts`

**Interfaces:**
- Consumes: `Sex`, `ActivityLevel`, `PlanGoal` from Task 2.
- Produces: `FitnessSettings` gains the optional fields `sex?`, `birthYear?`, `heightCm?`, `activity?` and `planGoal?`.

- [ ] **Step 1: Write the failing test** `"plan profile round-trips through the settings mapper"`. Feed `fromServer` a row with `sex: "female", birth_year: 1996, height_cm: 165, activity_level: "light", plan_goal: "recomp"`, and expect the camelCase values. Feed `toServer` a settings object with those values and expect snake_case. Unknown enum values (`"x"`) and nulls come back `undefined`, not defaulted. Follow how the existing tests in this file reach the mapper.
- [ ] **Step 2: Run, expect FAIL:** `cd mobile && bun run test -- live/__tests__/fitness`
- [ ] **Step 3: Implement.** In `toServer`, send `null` for unset fields. In `fromServer`, strip the five fields from `cur` first, the same way `goalWeight` is stripped today, then spread only the non-null valid ones. Use the existing `pick` for the enums, with a no-default variant or an inline check.
- [ ] **Step 4: Run, expect PASS**, plus typecheck/lint.
- [ ] **Step 5: Commit** `feat(mobile): map plan profile fields`

---

### Task 4: PlanForm component

**Files:**
- Create: `mobile/src/prototype/screens/nutrition-plan.tsx`
- Test: `mobile/src/prototype/__tests__/nutrition-plan.test.tsx`

**Interfaces:**
- Consumes: `estimatePlan`, `planNotes`, `planGoalFor`, `ageFrom`, `ACTIVITY`, `GOALS` (Task 2). `updateSettings`, `logWeighIn`, `updateWeighIn`, `LB_TO_KG` (`@domain/fitness/actions`). `latestBodyweight` (`@domain/fitness/calc`). `fitStore`.
- Produces:

```ts
export function PlanForm(props: { onApply: (plan: Plan) => void; applyLabel?: string }): JSX.Element
export function PlanNotes(props: { notes: PlanNote[]; field: NoteField }): JSX.Element | null
```

Behavior:
- **Fields:**
  - sex (Segmented)
  - birth year (numeric input)
  - height, in cm, or ft/in when `units === "lb"` (convert to cm)
  - weight, pre-filled from `latestBodyweight` and shown in the user's units
  - activity (five options with the ACTIVITY labels)
  - goal (four options with the GOALS labels, recomp showing its help text), pre-filled from `planGoalFor(settings)`
  - body fat % (optional)

  Every field pre-fills from settings or the store.
- **Apply:**
  - Disabled unless the required fields are valid: age 13–100, height 100–250 cm, body fat 3–70 if given, weight > 20 kg.
  - On press, calls `updateSettings({ sex, birthYear, heightCm, activity, planGoal: goal, goalDirection: GOALS[goal].direction })`.
  - Weight and body fat: if the entered weight differs from the latest weigh-in, or there is no weigh-in, call `logWeighIn(kg, undefined, undefined, bf)`. Otherwise, if bf is given, call `updateWeighIn(latest.id, { bodyFatPct: bf })`.
  - Finally calls `onApply(estimatePlan(inputs))`.
- `PlanNotes` renders the notes for one field as muted warning copy under a stepper. Use the existing `Copy` component with the theme's warning colour.

- [ ] **Step 1: Write the failing tests** (render with the project's existing RN testing setup, the same way the other `.test.tsx` files in this folder do):
  - `"apply is disabled until the profile is complete"`: empty settings, then Apply is disabled. Fill in sex, birth year, height, weight and activity, and Apply becomes enabled.
  - `"apply writes profile, both goal fields, and the estimate"`: `onApply` is called with `kcal: 2750` for case A's inputs. The store settings end with `planGoal` and `goalDirection` set.
  - `"no weigh-in yet: apply creates one with weight and body fat"`: `weighIns` is empty, then after Apply there is exactly one, with `weightKg: 60, bodyFatPct: 25`.
  - `"same weight: body fat goes on the latest weigh-in, no new one"`.
  - `"out-of-range age disables apply"`: with `birth_year = this year − 10`, Apply is disabled.
- [ ] **Step 2: Run, expect FAIL:** `cd mobile && bun run test -- nutrition-plan`
- [ ] **Step 3: Implement** using the native-kit components (`Copy`, `Frame`, `Line`, `Tap`), plus `Segmented`, `Stepper` and `Button` as used in `setup.tsx` / `nutrition-targets.tsx`.
- [ ] **Step 4: Run, expect PASS**, plus typecheck/lint.
- [ ] **Step 5: Commit** `feat(mobile): personalized plan form`

---

### Task 5: Setup step and Targets screen

**Files:**
- Modify: `mobile/src/prototype/screens/setup.tsx:658-715` (`NutritionStep`) and the `nutrition` copy at :78
- Modify: `mobile/src/prototype/screens/nutrition-targets.tsx` (`suggest` :40-55, steppers :60-90)
- Test: `mobile/src/prototype/__tests__/nutrition-plan.test.tsx` (extend)

**Interfaces:**
- Consumes: `PlanForm`, `PlanNotes` (Task 4). `planNotes`, `estimatePlan` (Task 2). `setMacroTarget` (existing).

Behavior:
- **`NutritionStep`** has two phases:
  1. `PlanForm` with `applyLabel="See my plan"`.
  2. The plan, shown as kcal / protein / carbs / fat / fiber Steppers. Each Stepper has `<PlanNotes>` under it, recomputed live with `planNotes`. The existing auto-split line ("carbs and fat fill the rest") goes.

  **Save targets** calls `setMacroTarget({ kcal, protein, carbs, fat, fiberGoal: fiberG })` and keeps the existing toast and `onDone`. Delete the old `perKg` 27/32/36 code. The step's `why` copy becomes: "Your calories and macros, worked out from your body and goal. Adjust anything."
- **Targets screen:** the Suggest button opens `PlanForm`, always, pre-filled. Its `onApply` feeds the existing `suggestion` state, so the existing apply-suggestion UI is reused. Delete the inline 27/32/36 formula. Add `<PlanNotes>` under the kcal, protein, fat and fiber steppers. Notes only show when the profile is complete; without inputs, show none.
- **Stepper bounds:** setup and Targets both use kcal `min={500}`. Protein `max` goes to 500 on both, and so does carbs/fat wherever it's lower. The backend `Macro` bound (`ge=0`) already allows this.

- [ ] **Step 1: Write the failing tests**
  - `"setup nutrition step saves the estimated target"`: render `NutritionStep`, fill the form with case A, tap See my plan, then Save targets. `targetFor(store, today)` has `kcal: 2750, protein: 144`.
  - `"lowering kcal under BMR shows the note but still saves"`: step kcal down to 1700. The note text is visible, Save still works, and the target is stored with `kcal: 1700`.
- [ ] **Step 2: Run, expect FAIL**
- [ ] **Step 3: Implement** as described above.
- [ ] **Step 4: Run the whole mobile suite:** `cd mobile && bun run test && bun run typecheck && bun run lint`. All must pass.
- [ ] **Step 5: Manual check on the iOS simulator.** Run first-run setup and go through the nutrition step, then Targets → Suggest. Confirm the notes appear and the save works. Screenshot both.
- [ ] **Step 6: Commit** `feat(mobile): personalized plan in setup and targets`

---

### Task 6: Docs and full verification

**Files:**
- Modify: `docs/README.md` (index the spec and this plan)

- [ ] **Step 1:** Add both docs to the `docs/README.md` index.
- [ ] **Step 2:** Run `make backend-lint`, `make test-docker`, `bun run lint` (root), and the mobile `bun run test` / `typecheck` / `lint`. All must be green.
- [ ] **Step 3: Commit** `docs: index personalized plans spec and plan`
