// One day's meals by macro: each meal's calories, protein, carbs and fat,
// its share of the day's total for each, and which meal gave the most of
// each. Meals still waiting for an estimate have no numbers yet: they are
// listed but count towards nothing.
import { mealTotals } from "@domain/fitness/calc"
import type { Macros, Meal } from "@domain/fitness/data"

export const BREAKDOWN_KEYS = ["kcal", "protein", "carbs", "fat"] as const
export type BreakdownKey = (typeof BREAKDOWN_KEYS)[number]

export interface BreakdownRow {
  meal: Meal
  /** null while the meal waits for its estimate. */
  totals: Macros | null
  /** Share of the day's total per macro, 0..1 (0 when the day has none). */
  share: Record<BreakdownKey, number>
}

export interface Breakdown {
  rows: BreakdownRow[]
  totals: Macros
  /** The meal that gave the most of each macro; null when none gave any.
   * A tie goes to the earlier meal. */
  top: Record<BreakdownKey, { mealId: string; share: number } | null>
  pending: number
}

export function mealBreakdown(meals: Meal[]): Breakdown {
  const sorted = [...meals].sort((a, b) => a.eatenAt.localeCompare(b.eatenAt))
  const counted = sorted.map((m) => ({
    meal: m,
    totals: m.status === "pending_estimate" ? null : mealTotals(m),
  }))
  const totals: Macros = { kcal: 0, protein: 0, carbs: 0, fat: 0 }
  for (const r of counted)
    if (r.totals) for (const k of BREAKDOWN_KEYS) totals[k] += r.totals[k]
  const rows = counted.map((r) => ({
    ...r,
    share: Object.fromEntries(
      BREAKDOWN_KEYS.map((k) => [
        k,
        r.totals && totals[k] > 0 ? r.totals[k] / totals[k] : 0,
      ]),
    ) as Record<BreakdownKey, number>,
  }))
  const top = Object.fromEntries(
    BREAKDOWN_KEYS.map((k) => {
      let best: BreakdownRow | null = null
      for (const r of rows)
        if (
          r.totals &&
          r.totals[k] > 0 &&
          (!best || r.share[k] > best.share[k])
        )
          best = r
      return [k, best ? { mealId: best.meal.id, share: best.share[k] } : null]
    }),
  ) as Breakdown["top"]
  return {
    rows,
    totals,
    top,
    pending: counted.filter((r) => !r.totals).length,
  }
}

/** "Lunch", or "Snack 3:40 PM" when the day has more than one of that
 * kind, so two snacks are told apart. */
export function mealName(
  meal: Meal,
  all: Meal[],
  time: (iso: string) => string,
) {
  const kind = meal.label[0].toUpperCase() + meal.label.slice(1)
  return all.filter((m) => m.label === meal.label).length > 1
    ? `${kind} ${time(meal.eatenAt)}`
    : kind
}
