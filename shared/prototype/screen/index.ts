import { useMemo } from "react"
import type { CalendarItem, Metric, Miss, ModuleContract } from "../contract"
import { dayKey, dayOffset } from "../lib/day"
import type { ScreenDay, ScreenGroup, ScreenState } from "./data"
import { areaRate } from "./logic"
import { useScreen } from "./store"

// The Screen time module contract (spec 2026-10-29-screen-time-design), the
// device's copy of backend/app/modules/screen/stats.py. Minutes are lower
// bounds (the highest threshold crossed), so they always read "≥ N min".

export const METRIC_KEYS = ["screen.used"] as const

/** [first, last] of the `days` days ending `offset` days before today. */
const win = (days: number, offset = 0) =>
  [dayOffset(-(days - 1) - offset), dayOffset(-offset)] as const

const inWindow = (s: ScreenState, first: string, last: string) =>
  s.days.filter((d) => d.day >= first && d.day <= last)

function useAreaRate(days: number, offset = 0): number | null {
  const s = useScreen()
  return useMemo(() => {
    const [first, last] = win(days, offset)
    return areaRate(inWindow(s, first, last), s.groups)
  }, [s, days, offset])
}

/** A closed day's main figure: the All apps group's minutes when it has a
 * row that day, otherwise the busiest custom group's. */
function mainByDay(rows: ScreenDay[], groups: ScreenGroup[]) {
  const kind = new Map(groups.map((g) => [g.id, g.kind]))
  const all = new Map<string, number>()
  const custom = new Map<string, number>()
  for (const d of rows) {
    if (!d.closed) continue
    const k = kind.get(d.groupId)
    if (k === "all") all.set(d.day, Math.max(all.get(d.day) ?? 0, d.usedMin))
    else if (k === "custom")
      custom.set(d.day, Math.max(custom.get(d.day) ?? 0, d.usedMin))
  }
  const out = new Map(custom)
  for (const [day, used] of all) out.set(day, used)
  return out
}

/** The main figure a day on average over the window (null without data). */
function avgUsed(s: ScreenState, first: string, last: string): number | null {
  const by = mainByDay(inWindow(s, first, last), s.groups)
  if (!by.size) return null
  let sum = 0
  for (const v of by.values()) sum += v
  return Math.round(sum / by.size)
}

function useMetrics(days: number): Metric[] {
  const s = useScreen()
  return useMemo(() => {
    const a = avgUsed(s, ...win(days))
    const b = avgUsed(s, ...win(days, days))
    return [
      {
        key: "screen.used",
        label: "Screen time (at least)",
        value: a === null ? "—" : `≥ ${a} min`,
        delta: a !== null && b !== null ? a - b : undefined,
        goodWhen: "down",
        shareable: true,
      },
    ]
  }, [s, days])
}

// Screen time puts nothing on the calendar and lists no misses: a rule
// habit's missed day is already the habit's miss.
const NO_ITEMS: CalendarItem[] = []
const NO_MISSES: Miss[] = []
const useCalendar = (_from: string, _to: string) => NO_ITEMS
const useMisses = (_from: string, _to: string) => NO_MISSES

/** Today's closed rows of groups with a budget: due each, done within it. */
function useTodayProgress() {
  const s = useScreen()
  return useMemo(() => {
    const today = dayKey()
    const budget = new Map(s.groups.map((g) => [g.id, g.budgetMin]))
    let due = 0
    let done = 0
    for (const d of s.days) {
      const b = budget.get(d.groupId)
      if (d.day !== today || !d.closed || b === undefined || b <= 0) continue
      due++
      if (d.usedMin <= b) done++
    }
    return { due, done }
  }, [s])
}

export const module: ModuleContract = {
  key: "screen",
  label: "Screen time",
  useAreaRate,
  useMetrics,
  useCalendar,
  useMisses,
  useTodayProgress,
  href: "/screen",
}
