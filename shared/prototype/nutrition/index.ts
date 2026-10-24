import { useMemo } from "react"
import type { CalendarItem, Metric, Miss, ModuleContract } from "../contract"
import { adherence, nutritionDays, targetFor } from "../fitness/calc"
import { useFit } from "../fitness/store"
import { dayKey } from "../lib/day"

// Meals are not calendar items; a constant keeps memos stable.
const NO_ITEMS: CalendarItem[] = []
// Nutrition is its own module (ADR-0024). Meals and macro targets are still
// kept in the fitness store, so this reads it; only the counting is its own.

/** Calories on target and protein hit rate averaged over the logged days;
 * null when nothing was logged, which leaves the area out of the Life
 * Score. */
function useAreaRate(days: number, offset = 0): number | null {
  const s = useFit()
  return useMemo(() => {
    const a = adherence(s, days, offset)
    return a.logged ? (a.calorie + a.protein) / 2 : null
  }, [s, days, offset])
}
function useMetrics(days: number): Metric[] {
  const s = useFit()
  return useMemo(() => {
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
function useMisses(from: string, to: string): Miss[] {
  const s = useFit()
  return useMemo(() => {
    const out: Miss[] = []
    for (const d of nutritionDays(s, 90)) {
      if (
        d.day < from ||
        d.day > to ||
        d.day === dayKey() ||
        !d.over ||
        !d.target
      )
        continue
      out.push({
        id: `nut-over-${d.day}`,
        day: d.day,
        title: `Over calories by ${Math.round((d.totals.kcal / d.target.kcal - 1) * 100)}%`,
        module: "nutrition",
        href: `/nutrition?day=${d.day}`,
      })
    }
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
