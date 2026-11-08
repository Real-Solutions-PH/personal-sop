// The way back after missed days: when someone returns after two or more
// days with nothing logged, Fern opens with a catch-up instead of a
// scorecard, and their streaks are paused across the gap (once per 30
// days) so a week away throws nothing away. Pure rules here; the screen
// (welcome-back) and the actions below apply them.
import { dashStore } from "./dash/store"
import { updateHabit } from "./habits/actions"
import type { Habit, HabitLog } from "./habits/data"
import {
  addDays,
  daysBetween,
  isPausedOn,
  logIndex,
  streaks,
} from "./habits/logic"
import { habitsStore } from "./habits/store"
import { dayKey } from "./lib/day"

/** The pause reason a way back writes. */
export const WAY_BACK = "way_back"
/** Days a way-back pause must wait after the last one. */
export const WAY_BACK_EVERY_DAYS = 30

export interface WayBackGap {
  /** First and last fully empty day (the last is yesterday). */
  from: string
  to: string
  days: number
}

/** The latest business day before ``today`` with anything logged. */
export function lastActiveDay(
  days: Iterable<string>,
  today = dayKey(),
): string | null {
  let last: string | null = null
  for (const d of days) if (d < today && (!last || d > last)) last = d
  return last
}

/** The empty days since ``last``, when there are two or more of them. A
 * fresh install with nothing logged yet has no way back. */
export function wayBackGap(
  last: string | null,
  today = dayKey(),
): WayBackGap | null {
  if (!last) return null
  const from = addDays(last, 1)
  const to = addDays(today, -1)
  if (from > to) return null
  const days = daysBetween(from, to).length
  return days >= 2 ? { from, to, days } : null
}

/** Once per gap: ``seenFor`` is the last active day it was shown for. */
export const shouldShowWayBack = (
  gap: WayBackGap | null,
  seenFor: string,
  last: string | null,
) => !!gap && !!last && seenFor !== last

/** The pauses a way back writes: every habit still going, across the gap;
 * none when a way back already paused within ``WAY_BACK_EVERY_DAYS``. */
export function wayBackPauses(
  habits: readonly Habit[],
  gap: WayBackGap,
  today = dayKey(),
): { habitId: string; from: string; to: string }[] {
  const since = addDays(today, -WAY_BACK_EVERY_DAYS)
  const recent = habits.some((h) =>
    h.pauses.some((p) => p.reason === WAY_BACK && p.from >= since),
  )
  if (recent) return []
  return habits
    .filter((h) => h.status !== "archived" && !isPausedOn(h, gap.to))
    .map((h) => ({ habitId: h.id, from: gap.from, to: gap.to }))
}

/** Every day something was logged, as business days (for ``lastActiveDay``). */
export function activityDays(s: {
  logs: readonly { day: string }[]
  taskEvents: readonly { type: string; at: string }[]
  records: readonly { at: string }[]
  workouts: readonly { startedAt: string }[]
  runs: readonly { startedAt: string }[]
  meals: readonly { eatenAt: string }[]
  journal: readonly { day: string }[]
  captures: readonly { at: string }[]
}): string[] {
  const day = (iso: string) => dayKey(new Date(iso))
  return [
    ...s.logs.map((l) => l.day),
    ...s.taskEvents.filter((e) => e.type === "completed").map((e) => day(e.at)),
    ...s.records.map((r) => day(r.at)),
    ...s.workouts.map((w) => day(w.startedAt)),
    ...s.runs.map((r) => day(r.startedAt)),
    ...s.meals.map((m) => day(m.eatenAt)),
    ...s.journal.map((j) => j.day),
    ...s.captures.map((c) => day(c.at)),
  ]
}

/** Pause every habit across the gap (when allowed) and mark this gap seen.
 * Returns whether streaks were paused. */
export function applyWayBack(
  gap: WayBackGap,
  last: string,
  today = dayKey(),
): boolean {
  const pauses = wayBackPauses(habitsStore.get().habits, gap, today)
  for (const p of pauses) {
    const h = habitsStore.get().habits.find((x) => x.id === p.habitId)
    if (!h) continue
    updateHabit(h.id, {
      pauses: [...h.pauses, { from: p.from, to: p.to, reason: WAY_BACK }],
    })
  }
  dashStore.set((s) => ({ ...s, wayBackSeenFor: last }))
  return pauses.length > 0
}

const WEEKDAY = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
]

/** "Here's where you are": the habit with the longest run, what is on
 * today, and a win from before the gap. Three lines, no AI. */
export function wayBackLines(i: {
  habits: readonly Habit[]
  logs: readonly HabitLog[]
  today: string
  gap: WayBackGap
  due: { habits: number; tasks: number }
  lastOnTarget: string | null
}): string[] {
  const idx = logIndex(i.logs as HabitLog[])
  const live = i.habits.filter((h) => h.status !== "archived")
  const runs = live.map((h) => {
    const st = streaks(h, idx, i.today)
    const ended = st.broken.filter((b) => b.day >= i.gap.from).at(-1)
    const paused = h.pauses.some(
      (p) => p.reason === WAY_BACK && p.from === i.gap.from,
    )
    return { h, st, ended, paused, n: st.current || ended?.length || 0 }
  })
  const top = [...runs].sort((a, b) => b.n - a.n)[0]
  const days = `${i.gap.days} day${i.gap.days === 1 ? "" : "s"} missed`
  let first = "Nothing was running before the break — today starts the count."
  if (top && top.n > 0) {
    const name = top.h.name
    if (top.st.current > 0 && top.paused)
      first = `${name}: ${days} · streak paused at ${top.st.current}`
    else if (top.st.current > 0 && top.st.graceDays.length)
      first = `${name}: 🔥 ${top.st.current} · grace day used`
    else if (top.st.current > 0) first = `${name}: 🔥 ${top.st.current}`
    else first = `${name}: ${days} · run of ${top.n} ended`
  }
  const h = i.due.habits
  const t = i.due.tasks
  const second = `Today: ${h} habit${h === 1 ? "" : "s"} and ${t} task${t === 1 ? "" : "s"}`
  const best = [...runs].sort((a, b) => b.st.best - a.st.best)[0]
  const third = i.lastOnTarget
    ? `Your last on-target day was ${WEEKDAY[new Date(`${i.lastOnTarget}T12:00:00`).getDay()]}`
    : best && best.st.best > 0
      ? `Best run so far: ${best.h.name}, ${best.st.best} days`
      : "You came back — that's the step that counts."
  return [first, second, third]
}
