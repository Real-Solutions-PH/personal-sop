import { useMemo } from "react"
import type { CalendarItem, Metric, Miss, ModuleContract } from "../contract"
import { dayKey, dayOffset } from "../lib/day"
import * as C from "./calc"
import * as L from "./logic"
import { useFocusState } from "./store"

// The focus module contract (ADR-0025), the device's copy of
// backend/app/modules/focus/stats.py.

export const METRIC_KEYS = [
  "focused",
  "daily",
  "goalDays",
  "sessions",
  "pomodoros",
] as const

/** [first, last] of the `days` days ending `offset` days before today. */
const win = (days: number, offset = 0) =>
  [dayOffset(-(days - 1) - offset), dayOffset(-offset)] as const

function useAreaRate(days: number, offset = 0): number | null {
  const s = useFocusState()
  return useMemo(() => {
    const [first, last] = win(days, offset)
    return C.areaRate(s, first, last)
  }, [s, days, offset])
}

function read(
  s: ReturnType<typeof useFocusState>,
  first: string,
  last: string,
) {
  const r = C.rangeStats(s, first, last)
  const goal = C.goalSec(s)
  const total = Object.values(r.byDay).reduce((a, b) => a + b, 0)
  const due = C.dueDays(s, first, last)
  const avg = due.length ? total / due.length : null
  const onGoal = due.filter((d) => goal > 0 && (r.byDay[d] ?? 0) >= goal).length
  const lo = L.dayStart(first)
  const hi = L.dayStart(L.nextDay(last))
  const kept = r.timelines.filter(
    (tl) =>
      tl.sess.start >= lo &&
      tl.sess.start < hi &&
      tl.sess.endReason !== "abandoned",
  )
  const now = Date.now()
  const sets = kept.reduce((n, tl) => n + L.setsCompleted(tl, now), 0)
  return { total, avg, onGoal, sessions: kept.length, sets }
}

function useMetrics(days: number): Metric[] {
  const s = useFocusState()
  return useMemo(() => {
    const [f0, l0] = win(days)
    const [f1, l1] = win(days, days)
    const a = read(s, f0, l0)
    const b = read(s, f1, l1)
    return [
      {
        key: "focused",
        label: "Focused time",
        value: L.fmtHm(a.total),
        delta: (a.total - b.total) / 60,
        goodWhen: "up",
        shareable: true,
      },
      {
        key: "daily",
        label: "Average a day",
        value: a.avg === null ? "—" : L.fmtHm(a.avg),
        delta:
          a.avg !== null && b.avg !== null ? (a.avg - b.avg) / 60 : undefined,
        goodWhen: "up",
        shareable: true,
      },
      {
        key: "goalDays",
        label: "Days on goal",
        value: String(a.onGoal),
        delta: a.onGoal - b.onGoal,
        goodWhen: "up",
        shareable: true,
      },
      {
        key: "sessions",
        label: "Sessions",
        value: String(a.sessions),
        delta: a.sessions - b.sessions,
        goodWhen: "up",
        shareable: true,
      },
      {
        key: "pomodoros",
        label: "Pomodoros",
        value: String(a.sets),
        delta: a.sets - b.sets,
        goodWhen: "up",
        shareable: true,
      },
    ]
  }, [s, days])
}

function useCalendar(from: string, to: string): CalendarItem[] {
  const s = useFocusState()
  return useMemo(() => {
    const r = C.rangeStats(s, from, to)
    const out: CalendarItem[] = []
    for (const tl of r.timelines) {
      if (tl.sess.endReason === "abandoned") continue
      const spans = r.spans.filter((f) => f.sessionId === tl.sess.id)
      for (const d of L.daysBetween(from, to)) {
        const lo = L.dayStart(d)
        const hi = L.dayStart(L.nextDay(d))
        const here = spans
          .filter((f) => f.end > lo && f.start < hi)
          .map((f) => ({
            ...f,
            start: Math.max(f.start, lo),
            end: Math.min(f.end, hi),
          }))
        const total = Object.values(L.perItem(here)).reduce((a, b) => a + b, 0)
        if (total <= 0) continue
        const top = C.itemTotals(here)[0]?.item
        const start = new Date(Math.min(...here.map((f) => f.start)))
        const pad = (x: number) => String(x).padStart(2, "0")
        out.push({
          id: `focus-${tl.sess.id}-${d}`,
          day: d,
          time: `${pad(start.getHours())}:${pad(start.getMinutes())}`,
          title: `Focus ${L.fmtHm(total)}${top?.title ? ` · ${top.title}` : ""}`,
          module: "focus",
          done: true,
          href: `/focus/day?day=${d}`,
        })
      }
    }
    return out
  }, [s, from, to])
}

function useMisses(from: string, to: string): Miss[] {
  const s = useFocusState()
  return useMemo(() => {
    const goal = C.goalSec(s)
    const today = dayKey()
    const days = C.dueDays(s, from, to).filter((d) => d < today)
    if (goal <= 0 || !days.length) return []
    const by = C.rangeStats(s, days[0], days[days.length - 1]).byDay
    return days
      .filter((d) => (by[d] ?? 0) < goal)
      .map((d) => ({
        id: `focus-under-${d}`,
        day: d,
        title: `Focused ${L.fmtHm(by[d] ?? 0)} of ${L.fmtHm(goal)}`,
        module: "focus" as const,
        href: `/focus/day?day=${d}`,
      }))
      .sort((a, b) => b.day.localeCompare(a.day))
  }, [s, from, to])
}

/** The focus goal, once the person has used the timer. */
function useTodayProgress() {
  const s = useFocusState()
  return useMemo(() => {
    const goal = C.goalSec(s)
    const today = dayKey()
    const first = C.firstDay(s)
    if (goal <= 0 || !first || first > today) return { due: 0, done: 0 }
    const sec = C.rangeStats(s, today, today).byDay[today] ?? 0
    return { due: 1, done: sec >= goal ? 1 : 0 }
  }, [s])
}

export const module: ModuleContract = {
  key: "focus",
  label: "Focus",
  useAreaRate,
  useMetrics,
  useCalendar,
  useMisses,
  useTodayProgress,
  href: "/focus",
}
