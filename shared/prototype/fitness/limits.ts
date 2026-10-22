// Nutrients read two ways. Protein, carbs and fiber are amounts to reach;
// saturated fat, sugar and sodium are amounts to stay under. The defaults
// follow WHO guidance for a 2,000 kcal day: saturated fat under 10% of
// energy (~20 g), free sugars under 10% (~50 g), sodium under 2,000 mg, and
// 25 g of fiber. A user's macro target can set their own (the backend holds
// the same defaults for Fern).

import type { NutrientLimits } from "./data"

export type LimitKey = "satFat" | "sugar" | "sodium"
export type Limits = Record<LimitKey, number>

export const DAILY_LIMITS: Limits = {
  satFat: 20,
  sugar: 50,
  sodium: 2000,
}
export const FIBER_GOAL = 25

/** The limits in force for a day's target: the user's own where set, else
 * the defaults. */
export function limitsFor(target: NutrientLimits | null | undefined): Limits {
  return {
    satFat: target?.satFatMax ?? DAILY_LIMITS.satFat,
    sugar: target?.sugarMax ?? DAILY_LIMITS.sugar,
    sodium: target?.sodiumMax ?? DAILY_LIMITS.sodium,
  }
}

/** The fiber goal for a day's target, else the default. */
export function fiberGoalFor(target: NutrientLimits | null | undefined) {
  return target?.fiberGoal ?? FIBER_GOAL
}

export const LIMIT_LABEL: Record<LimitKey, { label: string; unit: string }> = {
  satFat: { label: "Sat fat", unit: "g" },
  sugar: { label: "Sugar", unit: "g" },
  sodium: { label: "Sodium", unit: "mg" },
}

/** How close an amount is to its limit: under (< 80%), near, or over. */
export function limitLevel(amount: number, limit: number) {
  const share = limit > 0 ? amount / limit : 0
  return {
    share,
    level:
      share > 1
        ? ("over" as const)
        : share >= 0.8
          ? ("near" as const)
          : ("under" as const),
  }
}

type Detail = {
  fiber?: number
  satFat?: number
  sugar?: number
  sodium?: number
}

/** Totals of the detail values the items carry; a key is present only
 * when at least one item knows it. */
export function detailTotals(items: readonly Detail[]) {
  const out: Detail = {}
  for (const key of ["fiber", "satFat", "sugar", "sodium"] as const) {
    const known = items.filter((i) => i[key] !== undefined)
    if (known.length) out[key] = known.reduce((a, i) => a + (i[key] ?? 0), 0)
  }
  return out
}

/** The detail totals of one business day's meals (estimates waiting for a
 * photo read add nothing), the same rule the macro totals follow. */
export function dayDetail(
  meals: readonly {
    status: string
    items: readonly Detail[]
  }[],
) {
  return detailTotals(
    meals
      .filter((m) => m.status !== "pending_estimate")
      .flatMap((m) => m.items),
  )
}

/** Over a range of days' meals: each limit's daily average across the days
 * that carry it, and how many of those days went over. */
export function limitAverages(
  days: readonly (readonly { status: string; items: readonly Detail[] }[])[],
  limits: Limits = DAILY_LIMITS,
) {
  const avg: Partial<Record<LimitKey, number>> = {}
  const over: Partial<Record<LimitKey, number>> = {}
  const totals = days.map(dayDetail)
  for (const key of ["satFat", "sugar", "sodium"] as const) {
    const known = totals
      .map((d) => d[key])
      .filter((v): v is number => v !== undefined)
    if (!known.length) continue
    avg[key] = known.reduce((a, v) => a + v, 0) / known.length
    over[key] = known.filter((v) => v > limits[key]).length
  }
  return { avg, over }
}
