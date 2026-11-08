import { useMemo } from "react"
import type { CalendarItem, Metric, Miss, ModuleContract } from "../contract"
import {
  adherence,
  type DayNutrition,
  mealsOn,
  nutritionDays,
  targetFor,
} from "../fitness/calc"
import type { FitnessState } from "../fitness/data"
import { dayDetail, fiberGoalFor, LIMIT_LABEL, limitsFor } from "../fitness/limits"
import { useFit } from "../fitness/store"
import { dayKey } from "../lib/day"
import { useSharedMemo } from "../lib/memo"

// Meals are not calendar items; a constant keeps memos stable.
const NO_ITEMS: CalendarItem[] = []
// Nutrition is its own module (ADR-0024). Meals and macro targets are still
// kept in the fitness store, so this reads it; only the counting is its own.

/** Calories on target and protein hit rate averaged over the logged days;
 * null when nothing was logged, which leaves the area out of the Life
 * Score. */
function useAreaRate(days: number, offset = 0): number | null {
  const s = useFit()
  return useSharedMemo("nutrition.useAreaRate", () => {
    const a = adherence(s, days, offset)
    return a.logged ? (a.calorie + a.protein) / 2 : null
  }, [s, days, offset])
}
function useMetrics(days: number): Metric[] {
  const s = useFit()
  return useSharedMemo("nutrition.useMetrics", () => {
    const a = adherence(s, days)
    const b = adherence(s, days, days)
    const eaten = (x: typeof a) => x.days.filter((d) => d.meals > 0)
    const avg = (x: typeof a) => {
      const list = eaten(x)
      return list.length
        ? list.reduce((sum, d) => sum + d.totals.kcal, 0) / list.length
        : null
    }
    const kcal = avg(a),
      kcalPrev = avg(b)
    return [
      {
        key: "calories",
        label: "Calories on target",
        value: `${Math.round(a.calorie * 100)}%`,
        goodWhen: "up",
        shareable: true,
      },
      {
        key: "protein",
        label: "Protein hit rate",
        value: `${Math.round(a.protein * 100)}%`,
        goodWhen: "up",
        shareable: true,
      },
      {
        key: "kcal",
        label: "Average calories",
        value:
          kcal === null
            ? "—"
            : `${Math.round(kcal).toLocaleString("en-US")} kcal`,
        delta:
          kcal !== null && kcalPrev !== null
            ? Math.round(kcal - kcalPrev)
            : undefined,
        shareable: false,
      },
      {
        key: "logged",
        label: "Days logged",
        value: String(eaten(a).length),
        delta: eaten(a).length - eaten(b).length,
        goodWhen: "up",
        shareable: true,
      },
    ]
  }, [s, days])
}
const whole = (n: number) => Math.round(n).toLocaleString("en-US")

/** What one closed, logged day missed, in the order the day is read:
 * calories more than 10% over, protein under 90% of its target, fiber under
 * 90% of its goal (only when the day's items say how much fiber they hold),
 * and each stay-under limit (sat fat, sugar, sodium) crossed. The server's
 * nutrition contributor writes the same ids and titles. */
export function dayMisses(s: FitnessState, d: DayNutrition): Miss[] {
  if (!d.target || d.meals === 0) return []
  const t = d.target
  const href = `/nutrition?day=${d.day}`
  const out: Miss[] = []
  const add = (id: string, title: string) =>
    out.push({ id: `${id}-${d.day}`, day: d.day, title, module: "nutrition", href })
  if (d.over)
    add(
      "nut-over",
      `Over calories by ${Math.round((d.totals.kcal / t.kcal - 1) * 100)}%`,
    )
  if (!d.proteinHit && t.protein > 0)
    add(
      "nut-protein",
      `Protein short by ${whole(t.protein - d.totals.protein)} g (${whole(d.totals.protein)} of ${whole(t.protein)} g)`,
    )
  const detail = dayDetail(mealsOn(s, d.day))
  const goal = fiberGoalFor(t)
  if (detail.fiber !== undefined && goal > 0 && detail.fiber < goal * 0.9)
    add(
      "nut-fiber",
      `Fiber short by ${whole(goal - detail.fiber)} g (${whole(detail.fiber)} of ${whole(goal)} g)`,
    )
  const limits = limitsFor(t)
  for (const key of ["satFat", "sugar", "sodium"] as const) {
    const amount = detail[key]
    if (amount === undefined || amount <= limits[key]) continue
    const { label, unit } = LIMIT_LABEL[key]
    add(
      `nut-limit-${key}`,
      `Over ${label.toLowerCase()} limit by ${whole(amount - limits[key])} ${unit} (${whole(amount)} of ${whole(limits[key])} ${unit})`,
    )
  }
  return out
}

function useMisses(from: string, to: string): Miss[] {
  const s = useFit()
  return useSharedMemo("nutrition.useMisses", () => {
    const out: Miss[] = []
    for (const d of nutritionDays(s, 90)) {
      if (d.day < from || d.day > to || d.day === dayKey()) continue
      out.push(...dayMisses(s, d))
    }
    // Stable: a day's misses keep their reading order.
    return out.sort((a, b) => b.day.localeCompare(a.day))
  }, [s, from, to])
}
/** The protein target, when one applies today. */
function useTodayProgress() {
  const s = useFit()
  return useMemo(() => {
    if (!targetFor(s, dayKey())) return { due: 0, done: 0 }
    const hit = nutritionDays(s, 1)[0]?.proteinHit
    return { due: 1, done: hit ? 1 : 0 }
  }, [s])
}
export const module: ModuleContract = {
  key: "nutrition",
  label: "Nutrition",
  useAreaRate,
  useMetrics,
  useCalendar: () => NO_ITEMS,
  useMisses,
  useTodayProgress,
  href: "/nutrition",
}
