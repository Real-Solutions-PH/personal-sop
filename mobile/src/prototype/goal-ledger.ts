// A goal's period ending unmet. Goals are measured over a rolling window
// (the last 7 or 30 days), so nothing in the data says "last week's value".
// This phone writes down what each goal stood at whenever a goal screen
// shows it; the last note taken in the final days of a calendar week (Mon to
// Sun) or month is that period's result. A period with no note near its end
// says nothing rather than guess. Device-local, like the moments seen.

import type { Goal } from "@domain/dash/data"
import { addDays } from "@domain/finance/calc"
import { dayKey, weekday } from "@domain/lib/day"
import { createStore } from "@domain/lib/store"
import { useEffect } from "react"

export interface GoalNote {
  goalId: string
  /** The period it belongs to: a week's Monday, or a month (YYYY-MM). */
  period: string
  day: string
  value: string
  hit: boolean
}

/** Notes taken this many days before a period's last day or later count
 * as its result: the rolling window then covers almost all of it. */
const TAIL = { week: 1, month: 2 }

export const goalLedger = createStore("goal-ledger", () => ({
  notes: [] as GoalNote[],
}))

export function periodOf(day: string, period: Goal["period"]) {
  if (period === "month") return day.slice(0, 7)
  return addDays(day, -((weekday(day) + 6) % 7))
}

export function periodEnd(key: string, period: Goal["period"]) {
  if (period === "week") return addDays(key, 6)
  const [y, m] = key.split("-").map(Number)
  const last = new Date(y, m, 0).getDate()
  return `${key}-${String(last).padStart(2, "0")}`
}

const previous = (day: string, period: Goal["period"]) =>
  period === "week"
    ? addDays(periodOf(day, "week"), -7)
    : periodOf(addDays(`${day.slice(0, 7)}-01`, -1), "month")

/** ``notes`` with today's reading of each goal, one note per goal and
 * period (the newest wins), the last two periods per goal kept. Pure. */
export function noteGoals(
  notes: readonly GoalNote[],
  goals: readonly {
    goal: Goal
    entry?: { value: string; n: number | null }
    hit: boolean
  }[],
  day: string,
): GoalNote[] {
  const out = [...notes]
  for (const g of goals) {
    if (g.goal.status !== "active" || !g.entry || g.entry.n === null) continue
    const period = periodOf(day, g.goal.period)
    const i = out.findIndex(
      (x) => x.goalId === g.goal.id && x.period === period,
    )
    const note = {
      goalId: g.goal.id,
      period,
      day,
      value: g.entry.value,
      hit: g.hit,
    }
    if (i >= 0) out[i] = note
    else out.push(note)
  }
  const keep = new Set(goals.map((g) => g.goal.id))
  return out
    .filter((x) => keep.has(x.goalId))
    .filter((x, _, all) => {
      const mine = all
        .filter((y) => y.goalId === x.goalId)
        .map((y) => y.period)
        .sort()
      return mine.indexOf(x.period) >= mine.length - 2
    })
}

export interface Missed {
  goal: Goal
  period: string
  value: string
}

/** Active goals whose last finished period ended unmet, by the note taken
 * near that period's end. Pure. */
export function missedGoals(
  notes: readonly GoalNote[],
  goals: readonly Goal[],
  today: string,
): Missed[] {
  const out: Missed[] = []
  for (const g of goals) {
    if (g.status !== "active") continue
    const period = previous(today, g.period)
    // A goal set after that period ended had nothing to miss.
    if (g.createdAt.slice(0, 10) > periodEnd(period, g.period)) continue
    const note = notes.find((x) => x.goalId === g.id && x.period === period)
    if (!note || note.hit) continue
    if (note.day < addDays(periodEnd(period, g.period), -TAIL[g.period]))
      continue
    out.push({ goal: g, period, value: note.value })
  }
  return out
}

/** "last week" / "October". */
export function periodLabel(period: string, kind: Goal["period"]) {
  if (kind === "week") return "last week"
  const [y, m] = period.split("-").map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long" })
}

type Progress = Parameters<typeof noteGoals>[1]

/** Note today's reading of ``goals`` whenever a goal screen shows them. */
export function useNoteGoals(goals: Progress) {
  const sig = goals
    .map((g) => `${g.goal.id}=${g.entry?.value ?? ""}${g.hit ? "+" : ""}`)
    .join("|")
  // biome-ignore lint/correctness/useExhaustiveDependencies: sig stands for goals
  useEffect(() => {
    const day = dayKey()
    goalLedger.set((s) => ({ notes: noteGoals(s.notes, goals, day) }))
  }, [sig])
}
