// Formula-based daily macro targets: BMR (Mifflin-St Jeor, or Katch-McArdle
// when body fat is known) x activity, shifted by goal, with warn-only notes
// for numbers the user edits into something questionable.

import type { FitnessSettings, Macros } from "./data"

export type Sex = "male" | "female"
export type ActivityLevel =
  | "sedentary"
  | "light"
  | "moderate"
  | "active"
  | "very_active"
export type PlanGoal = "lose" | "maintain" | "recomp" | "build"
export interface PlanInputs {
  sex: Sex
  age: number
  heightCm: number
  weightKg: number
  bodyFatPct?: number
  activity: ActivityLevel
  goal: PlanGoal
}
export interface Plan extends Macros {
  fiberG: number
  bmr: number
  tdee: number
}
export type NoteField = "kcal" | "protein" | "fat" | "fiber" | "totals"
export interface PlanNote {
  field: NoteField
  text: string
}

export const ACTIVITY: Record<ActivityLevel, { label: string; factor: number }> =
  {
    sedentary: { label: "Mostly sitting", factor: 1.2 },
    light: { label: "Light exercise 1–3 days/wk", factor: 1.375 },
    moderate: { label: "Exercise 3–5 days/wk", factor: 1.55 },
    active: { label: "Hard exercise 6–7 days/wk", factor: 1.725 },
    very_active: { label: "Physical job + training", factor: 1.9 },
  }

export const GOALS: Record<
  PlanGoal,
  {
    label: string
    help?: string
    kcal: number
    proteinPerKg: number
    direction: FitnessSettings["goalDirection"]
  }
> = {
  lose: { label: "Lose fat", kcal: 0.8, proteinPerKg: 2.2, direction: "cut" },
  maintain: {
    label: "Maintain",
    kcal: 1,
    proteinPerKg: 1.8,
    direction: "maintain",
  },
  recomp: {
    label: "Recomp",
    help: "Best if you're new to lifting, coming back, or carrying extra fat. Weight stays about the same.",
    kcal: 0.95,
    proteinPerKg: 2.2,
    direction: "maintain",
  },
  build: {
    label: "Build muscle",
    kcal: 1.07,
    proteinPerKg: 2,
    direction: "bulk",
  },
}

export const NOTE_LIMITS = {
  kcalFloor: { female: 1200, male: 1500 } as Record<Sex, number>,
  maxWeeklyPct: 0.01,
  proteinMin: 0.8,
  proteinMax: 3,
  fatMinPct: 0.2,
  fiberMin: 25,
  totalsTolerance: 0.05,
}

const round50 = (x: number) => Math.round(x / 50) * 50
const ceil50 = (x: number) => Math.ceil(x / 50) * 50

export function ageFrom(birthYear: number, today = new Date()) {
  return today.getFullYear() - birthYear
}

export function estimatePlan(i: PlanInputs): Plan {
  const w = i.weightKg
  const bf = i.bodyFatPct
  const lean = bf ? w * (1 - bf / 100) : w
  const bmr = bf
    ? 370 + 21.6 * lean
    : 10 * w + 6.25 * i.heightCm - 5 * i.age + (i.sex === "male" ? 5 : -161)
  const tdee = bmr * ACTIVITY[i.activity].factor
  const g = GOALS[i.goal]
  const floor = ceil50(Math.max(bmr, NOTE_LIMITS.kcalFloor[i.sex]))
  const kcal = Math.max(round50(tdee * g.kcal), floor)
  const protein = Math.round(bf && bf >= 30 ? lean * 2.6 : w * g.proteinPerKg)
  const fat = Math.round((kcal * 0.27) / 9)
  const carbs = Math.max(0, Math.round((kcal - 4 * protein - 9 * fat) / 4))
  const fiberG = Math.max(25, Math.round((14 * kcal) / 1000))
  return { kcal, protein, carbs, fat, fiberG, bmr, tdee }
}

/** Warn-only notes on a (possibly edited) target, at most one per field. */
export function planNotes(
  t: Macros & { fiberG?: number },
  i: PlanInputs,
): PlanNote[] {
  const L = NOTE_LIMITS
  const { bmr, tdee } = estimatePlan(i)
  const w = i.weightKg
  const out: PlanNote[] = []
  const add = (field: NoteField, text: string) => out.push({ field, text })

  const weekly = (Math.abs(t.kcal - tdee) * 7) / 7700
  if (t.kcal < bmr) add("kcal", "Below what your body burns at rest")
  else if (t.kcal < L.kcalFloor[i.sex])
    add("kcal", "Very low — hard to get enough nutrients")
  else if (weekly > L.maxWeeklyPct * w)
    add(
      "kcal",
      `Faster than ~${weekly.toFixed(1)} kg/week ${t.kcal < tdee ? "loss" : "gain"}`,
    )

  if (t.protein < L.proteinMin * w) add("protein", "May lose muscle")
  else if (t.protein > L.proteinMax * w)
    add("protein", "More than your body uses")
  if (9 * t.fat < L.fatMinPct * t.kcal)
    add("fat", "Very low fat can affect hormones")
  if (t.fiberG !== undefined && t.fiberG < L.fiberMin)
    add("fiber", "Below the daily minimum")
  const total = 4 * t.protein + 4 * t.carbs + 9 * t.fat
  if (Math.abs(total - t.kcal) > L.totalsTolerance * t.kcal)
    add("totals", `Your macros total ${total} kcal, your target says ${t.kcal}`)
  return out
}

/** The plan goal for saved settings; goalDirection wins over a stale planGoal. */
export function planGoalFor(
  s: Pick<FitnessSettings, "goalDirection"> & { planGoal?: PlanGoal },
): PlanGoal {
  if (s.planGoal && GOALS[s.planGoal].direction === s.goalDirection)
    return s.planGoal
  return { cut: "lose", maintain: "maintain", bulk: "build" }[s.goalDirection] as PlanGoal
}
