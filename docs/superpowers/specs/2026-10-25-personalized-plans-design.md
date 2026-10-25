# Personalized Plans — design

Date: 2026-10-25 · Status: draft for approval

## Intent

Today you type your calorie and protein targets in by hand, or accept a rough
suggestion (bodyweight × 27/32/36 kcal per kg) that knows nothing about you
except your weight. Personalized Plans replaces that guess with a real
estimate. It works out daily calories, protein, carbs, fat and fiber from your
age, sex, height, weight, optional body fat %, activity level and goal. You can
then adjust any number, and the app tells you when an adjustment looks too
high or too low.

**Why:** a starting target that fits your body and goal makes every meal you
log mean something from day 1. Without that, people either never set a target
or keep a wrong one.

## Goals

- Produce a full daily plan: kcal, protein, carbs, fat and fiber.
- Ask for it during first-run setup, and let you re-run it any time from
  Nutrition → Targets.
- Keep every number editable after the estimate.
- Show a short note under any number that drifts outside a sensible range.

## Non-goals

- Meal plans or recipes. This sets targets only.
- Per-day carb cycling or training-day vs rest-day targets.
- Changing targets automatically from weigh-in trends.
- Medical advice. The notes are guidance, not a diagnosis.

## Anti-goals (failure even if it works)

- The app **refuses** a number you chose. Notes warn; they never block saving.
- AI makes up the numbers. The estimate is a formula: same inputs give the
  same output, offline, with no AI cost.
- You're asked for your weight twice in setup.
- Re-saving a plan wipes your custom limits (sat fat, sugar, sodium). The
  existing carry-over behaviour on `PUT /targets` must keep working.

## Decisions

### The math (my call; you said "you decide")

1. **Resting burn (BMR):**
   - Body fat % known → Katch-McArdle: `370 + 21.6 × lean_kg`.
   - Otherwise → Mifflin-St Jeor: `10·kg + 6.25·cm − 5·age + (5 male / −161 female)`.
2. **Daily burn (TDEE)** = BMR × activity factor:

   | Level | Label shown | Factor |
   |---|---|---|
   | sedentary | Mostly sitting | 1.2 |
   | light | Light exercise 1–3 days/wk | 1.375 |
   | moderate | Exercise 3–5 days/wk | 1.55 |
   | active | Hard exercise 6–7 days/wk | 1.725 |
   | very_active | Physical job + training | 1.9 |

3. **Goal adjustment and protein:**

   | Goal (label) | `plan_goal` | `goal_direction` | kcal | Protein g/kg |
   |---|---|---|---|---|
   | Lose fat | `lose` | `cut` | TDEE × 0.80 | 2.2 |
   | Maintain | `maintain` | `maintain` | TDEE | 1.8 |
   | Recomp (lose fat, build muscle) | `recomp` | `maintain` | TDEE × 0.95 | 2.2 |
   | Build muscle (lean gain) | `build` | `bulk` | TDEE × 1.07 | 2.0 |

   Based on research (2026-10-25): MacroFactor and Carbon set gain and loss
   goals as a rate, and recommend small surpluses for building muscle. Helms
   et al. (2020) found trained lifters gained about as much muscle at
   maintenance as at a 5% or 15% surplus, but put on more fat with the
   surplus. So there's no aggressive "bulk" option: "Gain weight" and "Build
   muscle" are the same lean-gain goal. Recomp gets its own option because the
   evidence supports it, especially for beginners, people returning to
   training and people with more body fat (Barakat et al. 2020, SCJ 42(5)).
   Its intake sits near maintenance with protein kept high.
   Recomp's helper text: "Best if you're new to lifting, coming back, or
   carrying extra fat. Weight stays about the same."

   Protein is per kg of bodyweight. When body fat ≥ 30%, use lean mass
   instead (`lean_kg × 2.6`), so heavier users don't get inflated protein.
4. **Fat** = 27% of kcal (matches the existing auto-split). **Carbs** fill the
   remainder: `(kcal − 4·protein − 9·fat) / 4`.
5. **Fiber** = 14 g per 1,000 kcal, minimum 25 g.
6. Round kcal to 50, grams to whole numbers.

### Safety notes when adjusting (warn, never block)

| Field | Note when | Message gist |
|---|---|---|
| kcal | below BMR | "Below what your body burns at rest" |
| kcal | below 1,200 (female) / 1,500 (male) | "Very low, hard to get enough nutrients" |
| kcal | implied change > 1% bodyweight/week (`|kcal − TDEE| × 7 / 7700 > 0.01·kg`) | "Faster than ~X kg/week" |
| protein | < 0.8 g/kg | "May lose muscle" |
| protein | > 3.0 g/kg | "More than your body uses" |
| fat | < 20% of kcal | "Very low fat can affect hormones" |
| fiber | < 25 g | "Below the daily minimum" |
| totals | 4P + 4C + 9F differs from kcal by > 5% | existing mismatch check, keeps its one-tap fix |

The thresholds are starting values from standard sports-nutrition guidance
and live in one constants block so they're easy to tune.

### AI's role (my call)

Fern doesn't do the math. It can already set targets through `TargetArgs`
in `backend/app/modules/capture/fitness_tools.py`, so "give me more carbs"
works today. For v1 Fern doesn't get a new tool. Add one later if users ask
Fern to "redo my plan".

### Where it lives

- **Profile inputs:** add `sex` (`male`/`female`), `birth_year`, `height_cm` and
  `activity_level` and `plan_goal` to `FitnessSettings`
  (`backend/app/modules/fitness/models.py`), all nullable. `goal_direction`
  keeps its three values. Saving a plan writes both fields, using the
  mapping above. Weight-trend colours, the goal-weight picker and the label
  maps keep working unchanged, and older app builds can't overwrite recomp,
  because they never send `plan_goal`. Settings are saved with `PATCH`. If an
  older build changes `goal_direction` so it no longer matches `plan_goal`,
  `goal_direction` wins: the form pre-fills from it. This needs one Alembic
  revision.
  Regenerate the frontend and mobile clients.
  - I store `birth_year`, not age, so the age stays correct over time.
    Collecting the full birth date isn't needed.
- **Body fat %:** already on `WeighIn.body_fat_pct`. The plan reads the latest
  weigh-in that has one. If you enter body fat % in the plan form, it's saved
  on today's weigh-in.
- **Estimator:** pure functions in a new
  `shared/prototype/fitness/plan.ts`: `estimatePlan(inputs) → Macros & {fiber, bmr, tdee}`
  and `planNotes(target, inputs) → Note[]`. No backend computation. Inputs
  come from the local store, so it runs offline and updates as you type.
- **Setup step** (`NutritionStep` in `mobile/src/prototype/screens/setup.tsx`):
  replace the kcal/kg guess with a short form: sex, birth year, height, activity,
  goal and optional body fat %. Weight comes from the preceding
  Fitness step. If it's missing, ask for weight here instead. The form shows the
  live plan with editable steppers and the notes. **Save** writes the target and
  the profile fields.
- **Targets screen** (`mobile/src/prototype/screens/nutrition-targets.tsx`):
  the existing "suggest" button uses `estimatePlan` when the profile is
  complete. If not, it opens the same form. The notes appear under each
  stepper.

### Settled after builder check (my calls)

- **Re-editing profile:** on the Targets screen, Suggest always opens the plan
  form, pre-filled from the saved profile. It never skips the form. That's how
  you change activity level or anything else later.
- **Body fat %:** written to the latest weigh-in. If you have no weigh-in yet,
  a new one is created from the weight in the form. No placeholder weigh-ins
  are made.
- **Hard limits:** the stepper and `PUT /targets` bounds loosen to sanity-only
  values (kcal ≥ 500), so a computed plan always fits. The notes take over the
  "too low" job.
- **Profile save:** applying the form writes the profile fields straight away,
  whether or not you then save the target.

## Left to the builder

- Exact layout and copy of the form and notes, following the existing native-kit
  components.
- Where the shared tests live (mobile jest or alongside the shared module). You
  need one test file covering `estimatePlan` against hand-computed cases (both
  formulas, every goal) and each note trigger.
- Unit handling for `lb` users (convert at the input edge; store kg/cm).
- Whether the Fitness step's goal chip and the plan's goal picker merge into
  one question during setup. They write the same field, so it should be asked
  once.
