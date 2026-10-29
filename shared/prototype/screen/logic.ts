// Screen time's rules (spec 2026-10-29-screen-time-design, "Rules"): the
// device's copy of backend/app/modules/screen/logic.py for the parts both
// sides compute (the rung ladder, the day score, the area rate), plus the
// phone-only parts that read the monitor extension's events.
//
// iOS only tells us when a threshold of use is crossed, so every minute value
// is a lower bound: the highest rung crossed. A day counts only when the
// extension saw its window start with the group's apps picked; an unobserved
// day writes nothing, so a rule habit cannot pass on a day nobody watched.
// A rung that fires before that many minutes of the window have passed is
// physically impossible and dropped (the iOS 26.2-26.3 early-fire bug).

import type { Habit, HabitLog } from "../habits/data"
import { isDue } from "../habits/logic"
import { derivedId } from "../lib/ids"
import type { HabitRule, NativeEvent, ScreenDay, ScreenGroup } from "./data"

export const STANDARD_RUNGS: readonly number[] = [
  1, 5, 10, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180, 195, 210, 225,
  240, 300, 360, 480,
]
/** Days back from today that a reconcile (and the server) still accepts. */
const DAYS_BACK = 7
// iOS can deliver intervalDidEnd late, after the next window has opened; an
// `end` belongs to the window that closed up to this long before it arrived.
const END_GRACE_MS = 3 * 3600_000

// Stopping monitoring to reschedule may fire intervalDidEnd mid-window; only
// an `end` near the window's real end closes the day.
const END_EARLY_MS = 5 * 60_000

/** True when an `end` event marks its window's real close, not a reschedule. */
function closesWindow(e: NativeEvent, dayStartHour: number): boolean {
  const { endMs } = windowFor(eventDay(e, dayStartHour), dayStartHour)
  return e.at >= endMs - END_EARLY_MS
}

/** The app day an event belongs to: its own instant, or for an `end` the
 * window that had just closed. */
function eventDay(e: NativeEvent, dayStartHour: number): string {
  return dayOf(e.kind === "end" ? e.at - END_GRACE_MS : e.at, dayStartHour)
}

/** The ladder for a group: the standard rungs plus `limit + 1` for every
 * live rule on it, so "at most 30" has an exact "31 reached" rung. */
export function rungsFor(limits: number[]): number[] {
  const all = new Set<number>(STANDARD_RUNGS)
  for (const m of limits) all.add(m + 1)
  return [...all].sort((a, b) => a - b)
}

const pad = (n: number) => String(n).padStart(2, "0")
const keyOf = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
function parts(day: string): [number, number, number] {
  const [y, m, d] = day.split("-").map(Number)
  return [y, m - 1, d]
}
function addDays(day: string, n: number): string {
  const [y, m, d] = parts(day)
  return keyOf(new Date(y, m, d + n, 12))
}

/** The app day's monitoring window in local time: from `dayStartHour` to one
 * minute before it the next day. */
export function windowFor(
  day: string,
  dayStartHour: number,
): { startMs: number; endMs: number } {
  const [y, m, d] = parts(day)
  return {
    startMs: new Date(y, m, d, dayStartHour, 0, 0, 0).getTime(),
    endMs: new Date(y, m, d + 1, dayStartHour, -1, 0, 0).getTime(),
  }
}

/** The app-day key containing `atMs` (dayKey's rule with the given hour). */
export function dayOf(atMs: number, dayStartHour: number): string {
  return keyOf(new Date(atMs - dayStartHour * 3600_000))
}

/** A rung of N minutes cannot be crossed before N minutes of the window. */
export function plausible(
  rungMin: number,
  atMs: number,
  windowStartMs: number,
): boolean {
  return rungMin * 60_000 <= atMs - windowStartMs
}

export interface DayObservation {
  day: string
  groupId: string
  observed: boolean
  usedMin: number
  closed: boolean
}

function byDayGroup(
  events: NativeEvent[],
  dayStartHour: number,
): Map<string, { day: string; groupId: string; events: NativeEvent[] }> {
  const out = new Map<
    string,
    { day: string; groupId: string; events: NativeEvent[] }
  >()
  for (const e of events) {
    const day = eventDay(e, dayStartHour)
    const k = `${day}|${e.groupId}`
    let b = out.get(k)
    if (!b) {
      b = { day, groupId: e.groupId, events: [] }
      out.set(k, b)
    }
    b.events.push(e)
  }
  return out
}

/** What each (app day, group) with any event adds up to, sorted by day then
 * group. Observed iff a `start` with the apps picked fell in the window;
 * used = the highest plausible rung; closed iff the window's `end` arrived. */
export function observe(
  events: NativeEvent[],
  dayStartHour: number,
): DayObservation[] {
  const out: DayObservation[] = []
  for (const b of byDayGroup(events, dayStartHour).values()) {
    const { startMs } = windowFor(b.day, dayStartHour)
    let observed = false
    let closed = false
    let usedMin = 0
    for (const e of b.events) {
      if (e.kind === "start") observed ||= e.hasSelection
      else if (e.kind === "end") closed ||= closesWindow(e, dayStartHour)
      else if (plausible(e.rungMin, e.at, startMs))
        usedMin = Math.max(usedMin, e.rungMin)
    }
    out.push({ day: b.day, groupId: b.groupId, observed, usedMin, closed })
  }
  return out.sort((a, b) =>
    a.day === b.day
      ? a.groupId < b.groupId
        ? -1
        : a.groupId > b.groupId
          ? 1
          : 0
      : a.day < b.day
        ? -1
        : 1,
  )
}

export type RuleState =
  | { kind: "untracked" }
  | { kind: "broken"; usedMin: number; overMin: number }
  | { kind: "tracking"; usedMin: number; progress: number } // progress = elapsed fraction of the window, 0..1

/** A rule habit's ring for the observed day: broken once over the limit,
 * otherwise filling with the share of the window gone by. */
export function ruleState(
  rule: HabitRule,
  obs: DayObservation | undefined,
  nowMs: number,
  dayStartHour: number,
): RuleState {
  if (!obs?.observed) return { kind: "untracked" }
  if (obs.usedMin > rule.maxMin)
    return {
      kind: "broken",
      usedMin: obs.usedMin,
      overMin: obs.usedMin - rule.maxMin,
    }
  const { startMs, endMs } = windowFor(obs.day, dayStartHour)
  const f = (nowMs - startMs) / (endMs - startMs)
  return {
    kind: "tracking",
    usedMin: obs.usedMin,
    progress: Math.min(1, Math.max(0, f)),
  }
}

/** Turn the extension's events into rows to write: a `ScreenDay` for every
 * observed day of the last seven (new, or an existing one raised, keeping its
 * id, the max of `usedMin` and `closed` once either side closed it), and for
 * every closed day within a rule habit's limit a `done` log with
 * `source: "screen"` and the id the server derives too. A habit+day that
 * already has a log of any source is never written over. */
export function reconcile(args: {
  events: NativeEvent[]
  habits: Habit[]
  logs: HabitLog[]
  existingDays: ScreenDay[]
  nowMs: number
  dayStartHour: number
  newId: () => string
}): { days: ScreenDay[]; logs: HabitLog[] } {
  const { events, habits, logs, existingDays, nowMs, dayStartHour, newId } =
    args
  const today = dayOf(nowMs, dayStartHour)
  const oldest = addDays(today, -DAYS_BACK)
  const updatedAt = new Date(nowMs).toISOString()
  const existing = new Map(
    existingDays.map((d) => [`${d.day}|${d.groupId}`, d]),
  )
  const logged = new Set(logs.map((l) => `${l.habitId}|${l.day}`))
  const ends = new Map<string, number>()
  for (const e of events) {
    if (e.kind !== "end" || !closesWindow(e, dayStartHour)) continue
    const k = `${eventDay(e, dayStartHour)}|${e.groupId}`
    ends.set(k, Math.min(ends.get(k) ?? e.at, e.at))
  }
  const days: ScreenDay[] = []
  const out: HabitLog[] = []
  for (const o of observe(events, dayStartHour)) {
    if (!o.observed || o.day < oldest || o.day > today) continue
    const k = `${o.day}|${o.groupId}`
    const prev = existing.get(k)
    const usedMin = Math.max(prev?.usedMin ?? 0, o.usedMin)
    const closed = (prev?.closed ?? false) || o.closed
    if (!prev || usedMin !== prev.usedMin || closed !== prev.closed)
      days.push({
        id: prev?.id ?? newId(),
        groupId: o.groupId,
        day: o.day,
        usedMin,
        closed,
        updatedAt,
      })
    const endAt = ends.get(k)
    if (!o.closed || endAt === undefined) continue
    for (const h of habits) {
      const r = h.rule
      if (r?.kind !== "screen_limit" || r.groupId !== o.groupId) continue
      if (!isDue(h, o.day)) continue
      if (usedMin > r.maxMin || logged.has(`${h.id}|${o.day}`)) continue
      logged.add(`${h.id}|${o.day}`)
      out.push({
        id: derivedId("screen-habit", h.id, o.day),
        habitId: h.id,
        day: o.day,
        status: "done",
        loggedAt: new Date(endAt).toISOString(),
        source: "screen",
      })
    }
  }
  return { days, logs: out }
}

/** One group's day: 1 within budget, falling to 0 at twice the budget. A
 * zero budget scores 1 for no use and 0 for any (areaRate skips it). */
export function dayScore(usedMin: number, budgetMin: number): number {
  if (usedMin <= budgetMin) return 1
  if (budgetMin <= 0) return 0
  return Math.max(0, 1 - (usedMin - budgetMin) / budgetMin)
}

/** The Screen time area's rate: per day with a closed row, the mean day score
 * over its groups with a budget; then the mean over those days. `null` when
 * no such day exists. */
export function areaRate(
  days: ScreenDay[],
  groups: ScreenGroup[],
): number | null {
  const budget = new Map(groups.map((g) => [g.id, g.budgetMin]))
  const perDay = new Map<string, number[]>()
  for (const d of days) {
    const b = budget.get(d.groupId)
    if (!d.closed || b === undefined || b <= 0) continue
    const list = perDay.get(d.day) ?? []
    list.push(dayScore(d.usedMin, b))
    perDay.set(d.day, list)
  }
  if (!perDay.size) return null
  const keys = [...perDay.keys()].sort()
  let sum = 0
  for (const k of keys) {
    const s = perDay.get(k) as number[]
    sum += s.reduce((a, b) => a + b, 0) / s.length
  }
  return sum / keys.length
}
