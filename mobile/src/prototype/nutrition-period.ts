// The Nutrition page's one period filter (a day, or the 7 or 30 days ending
// on it) and what each display reads from it: one nutrient day by day
// against its goal or limit, and the period's daily averages. A day still
// open (today) is drawn but never judged or averaged into a range, since
// half a day's eating says nothing about the day; a single day is always
// its own value.
import * as C from "@domain/fitness/calc"
import type { FitnessState, Macros } from "@domain/fitness/data"
import {
  type DayStatus,
  type GoalKind,
  statusOf,
} from "@domain/fitness/history"
import {
  dayDetail,
  fiberGoalFor,
  fiberSplit,
  type LimitKey,
  limitsFor,
} from "@domain/fitness/limits"
import { dayKey } from "@domain/lib/day"
import { num } from "@domain/lib/num"
import type { NutrientKey } from "./nutrient-insights"

export type Period = "1" | "7" | "30"
export const PERIODS: { value: Period; label: string }[] = [
  { value: "1", label: "Day" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
]
export const asPeriod = (v?: string): Period =>
  v === "7" || v === "30" ? v : "1"

/** ``n`` days ending on ``day``, oldest first. */
export const daysEnding = (day: string, n: number) =>
  Array.from({ length: n }, (_, i) => C.addDays(day, i - n + 1))

export const NUTRIENT_INFO: Record<
  NutrientKey,
  { label: string; unit: string; kind: GoalKind }
> = {
  kcal: { label: "Calories", unit: "kcal", kind: "near" },
  protein: { label: "Protein", unit: "g", kind: "reach" },
  carbs: { label: "Carbs", unit: "g", kind: "near" },
  fat: { label: "Fat", unit: "g", kind: "near" },
  fiber: { label: "Fiber", unit: "g", kind: "reach" },
  fiberSoluble: { label: "Soluble fiber", unit: "g", kind: "reach" },
  fiberInsoluble: { label: "Insoluble fiber", unit: "g", kind: "reach" },
  satFat: { label: "Sat fat", unit: "g", kind: "under" },
  sugar: { label: "Sugar", unit: "g", kind: "under" },
  sodium: { label: "Sodium", unit: "mg", kind: "under" },
}
export const isNutrient = (v: string | undefined): v is NutrientKey =>
  !!v && v in NUTRIENT_INFO
export const isLimit = (k: NutrientKey): k is LimitKey =>
  k === "satFat" || k === "sugar" || k === "sodium"

/** Whole numbers from 10 up, one decimal under it, grouped by thousands. */
export const amt = (v: number) => num(v, Math.abs(v) < 10 ? 1 : 0)
export const withUnit = (v: number, unit: string) => `${amt(v)} ${unit}`

/** The goal (or, for a limit, the max) a day's target sets. */
export function goalFor(
  target: ReturnType<typeof C.budgetFor>,
  key: NutrientKey,
): number | undefined {
  if (isLimit(key)) return limitsFor(target)[key]
  if (key === "fiber") return fiberGoalFor(target)
  if (key === "fiberSoluble") return target?.fiberSolubleGoal
  if (key === "fiberInsoluble") return target?.fiberInsolubleGoal
  return target?.[key]
}

/** One nutrient on a day: null when nothing counted was eaten, or when no
 * item eaten carries the value (a day with no sugar recorded is not a day
 * of zero sugar). */
export function amountOn(
  s: FitnessState,
  day: string,
  key: NutrientKey,
): number | null {
  const meals = C.mealsOn(s, day).filter((m) => m.status !== "pending_estimate")
  if (!meals.length) return null
  if (key === "kcal" || key === "protein" || key === "carbs" || key === "fat")
    return C.sumMacros(meals.map(C.mealTotals))[key]
  if (key === "fiberSoluble" || key === "fiberInsoluble") {
    const f = fiberSplit(meals.flatMap((m) => m.items))
    return (key === "fiberSoluble" ? f.soluble : f.insoluble) ?? null
  }
  return dayDetail(meals)[key] ?? null
}

export interface NutrientPoint {
  day: string
  value: number | null
  goal: number | undefined
  status: DayStatus
}

/** One nutrient over the ``n`` days ending on ``end``: each day's value and
 * verdict, how many settled days hit, and the amount the period is read
 * at (the day itself, or the average over settled days with a value). */
export function nutrientDays(
  s: FitnessState,
  key: NutrientKey,
  end: string,
  n: number,
) {
  const { kind } = NUTRIENT_INFO[key],
    today = dayKey()
  const points: NutrientPoint[] = daysEnding(end, n).map((day) => {
    const value = amountOn(s, day, key),
      goal = goalFor(C.budgetFor(s, day), key)
    let status: DayStatus =
      value === null || goal === undefined
        ? "none"
        : statusOf(kind, value, goal)
    // Today is settled only once it can't change back: a goal reached, or
    // a limit already passed. Short so far is still open.
    if (
      day === today &&
      status !== "none" &&
      (kind === "reach" ? status === "miss" : status !== "over")
    )
      status = "open"
    return { day, value, goal, status }
  })
  const settled = points.filter(
    (p) => p.value !== null && (n === 1 || p.day !== today),
  )
  const judged = settled.filter((p) => p.goal !== undefined)
  const mean = (list: number[]) =>
    list.length ? list.reduce((a, v) => a + v, 0) / list.length : null
  return {
    points,
    /** Days that carry a value and count towards the period's amount. */
    tracked: settled.length,
    judged: judged.length,
    hit: judged.filter((p) => p.status === "hit").length,
    over: judged.filter((p) => p.status === "over").length,
    value:
      n === 1
        ? (points[0]?.value ?? null)
        : mean(settled.map((p) => p.value as number)),
    goal:
      n === 1
        ? points[0]?.goal
        : (mean(judged.map((p) => p.goal as number)) ??
          goalFor(C.budgetFor(s, end), key)),
  }
}

/** The period's macros, a day: the day's totals, or the average over the
 * settled days that have meals. ``days`` is that divisor. */
export function periodMacros(
  s: FitnessState,
  end: string,
  n: number,
): { totals: Macros; days: number; target: ReturnType<typeof C.budgetFor> } {
  const target = C.budgetFor(s, end)
  if (n === 1) {
    const d = C.dayTotals(s, end)
    return { totals: d.totals, days: d.count ? 1 : 0, target }
  }
  const today = dayKey()
  const list = daysEnding(end, n)
    .filter((day) => day !== today)
    .map((day) => C.dayTotals(s, day))
    .filter((d) => d.count > 0)
  const sum = C.sumMacros(list.map((d) => d.totals))
  const k = list.length || 1
  return {
    totals: {
      kcal: sum.kcal / k,
      protein: sum.protein / k,
      carbs: sum.carbs / k,
      fat: sum.fat / k,
    },
    days: list.length,
    target,
  }
}
