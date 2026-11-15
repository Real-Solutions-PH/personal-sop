// A habit with several reminder times shows once per time in every
// timeline-style view (Today's plan, the Plan calendar, its day parts and
// hour grid, the Habits plan): skin care at 08:00 and 20:00 is two rows,
// one in the morning and one at night.
//
// The rule, decided once here and used by every view:
// - Occurrences = the distinct times the habit's schedule gives that day (a
//   day can sit in several slots; two slots at the same time are one). A
//   habit with one time, or none, keeps its single row.
// - The first slot holding the weekday (what ``slotFor``, the server's
//   calendar, reminders and Plan moves all treat as "the" occurrence) keeps
//   the plain ``habit-{id}-{day}`` id, so moves and the server's copy still
//   land on it. Every other one is ``habit-{id}-{day}@{n}``, n its 1-based
//   place in time order: unique per habit, day and slot, so it is also the
//   React key. Only the plain one can be dragged to a new time.
// - A count habit's target is shared out evenly across its occurrences in
//   time order: occurrence n of N is done once the day's count reaches
//   target * n / N (2 a day at 08:00 and 20:00: morning done at 1, night at
//   2). The last share is the whole target, so every occurrence done means
//   the habit is done. More reminders than the target is fine (3 times for
//   a target of 2 fill at 0.67, 1.33 and 2); counts past the target are
//   still allowed, as before. A log marked done fills every occurrence.
// - Ticking occurrence n raises the day's count to its share (never lowers
//   it) through the ordinary count log; reopening it lowers the count to
//   the share before it, so the earlier ones stay done.
// - A check or timed habit has one done state a day, so all its occurrences
//   show it and ticking any of them completes the day, as one row does.

import type { CalendarItem } from "../contract"
import { weekday } from "../lib/day"
import { dayMinutes } from "../schedule/logic"
import type { Habit, HabitLog } from "./data"
import { lk, slotFor } from "./logic"

export interface HabitOccurrence {
  /** 1-based place in time order (untimed last). */
  n: number
  /** How many occurrences the habit has that day. */
  of: number
  time?: string
  /** The occurrence that keeps the plain calendar id. */
  primary: boolean
}

const order = (t?: string) => (t ? dayMinutes(t) : 9999)

/** The habit's occurrences on ``day``, in time order; empty when no slot
 * holds the day. */
export function habitOccurrences(h: Habit, day: string): HabitOccurrence[] {
  const wd = weekday(day),
    first = slotFor(h.schedule, day)
  if (!first) return []
  const times: (string | undefined)[] = []
  for (const s of h.schedule)
    if (s.days.includes(wd) && !times.includes(s.time || undefined))
      times.push(s.time || undefined)
  const sorted = [...times].sort((a, b) => order(a) - order(b))
  const primaryTime = first.time || undefined
  return sorted.map((time, i) => ({
    n: i + 1,
    of: sorted.length,
    time,
    primary: time === primaryTime,
  }))
}

/** The calendar id of an occurrence. */
export const occurrenceId = (
  habitId: string,
  day: string,
  o: HabitOccurrence,
) =>
  o.primary || o.of === 1
    ? `habit-${habitId}-${day}`
    : `habit-${habitId}-${day}@${o.n}`

/** The habit and occurrence an item id names: ``n`` null for the plain id
 * (the primary occurrence, or a habit's only one). */
export function parseHabitItem(
  item: Pick<CalendarItem, "id" | "day">,
): { habitId: string; n: number | null } | null {
  if (!item.id.startsWith("habit-")) return null
  const at = item.id.lastIndexOf("@")
  const base = at > 0 ? item.id.slice(0, at) : item.id
  const n = at > 0 ? Number(item.id.slice(at + 1)) : null
  if (n !== null && !(Number.isInteger(n) && n > 0)) return null
  const tail = `-${item.day}`
  if (!base.endsWith(tail)) return null
  const habitId = base.slice(6, -tail.length)
  return habitId ? { habitId, n } : null
}

/** Which occurrence of ``h`` an item is (the primary for the plain id). */
export function occurrenceOf(
  h: Habit,
  item: Pick<CalendarItem, "id" | "day">,
): HabitOccurrence | null {
  const p = parseHabitItem(item)
  if (!p || p.habitId !== h.id) return null
  const all = habitOccurrences(h, item.day)
  return (
    (p.n === null
      ? all.find((o) => o.primary)
      : all.find((o) => o.n === p.n)) ?? null
  )
}

/** Whether the habit's count is shared out across its occurrences: a count
 * habit with more than one that day. */
export const splitsCount = (h: Habit, o: HabitOccurrence | null) =>
  !!o && o.of > 1 && h.type === "count"

/** The day's count at which occurrence ``n`` of ``of`` is done. */
export const shareAt = (h: Habit, n: number, of: number) =>
  ((h.target ?? 1) * n) / of

const EPS = 1e-9

/** How far one occurrence is (0–1): its share of a count habit's count, or
 * the whole day's state for anything else. */
export function occurrenceProgress(
  h: Habit,
  o: HabitOccurrence,
  log?: HabitLog,
): number {
  if (log?.status === "done") return 1
  if (!log || log.status === "skipped") return 0
  if (!splitsCount(h, o)) return 0
  const v = log.value ?? 0,
    lo = shareAt(h, o.n - 1, o.of),
    hi = shareAt(h, o.n, o.of)
  if (v + EPS >= hi) return 1
  return Math.max(0, Math.min(1, (v - lo) / (hi - lo)))
}

export const occurrenceDone = (h: Habit, o: HabitOccurrence, log?: HabitLog) =>
  occurrenceProgress(h, o, log) >= 1

/**
 * Each habit item with several times that day becomes one item per time,
 * each at its own time and done by its own share (see the rule above).
 * Everything else passes through untouched, in place. The plain item keeps
 * its time, so a Plan move (applied before this) stays on it.
 */
export function expandHabitSlots(
  items: readonly CalendarItem[],
  habits: readonly Habit[],
  idx: Map<string, HabitLog>,
): CalendarItem[] {
  const byId = new Map(habits.map((h) => [h.id, h]))
  const out: CalendarItem[] = []
  let grew = false
  for (const i of items) {
    const p = i.module === "habits" ? parseHabitItem(i) : null
    const h = p && p.n === null ? byId.get(p.habitId) : undefined
    const all = h ? habitOccurrences(h, i.day) : []
    if (!h || all.length < 2) {
      out.push(i)
      continue
    }
    grew = true
    const log = idx.get(lk(h.id, i.day))
    for (const o of all) {
      const done = occurrenceDone(h, o, log)
      if (o.primary) out.push({ ...i, done, slot: { n: o.n, of: o.of } })
      else {
        const { movedFrom: _m, time: _t, ...rest } = i
        out.push({
          ...rest,
          id: occurrenceId(h.id, i.day, o),
          ...(o.time ? { time: o.time } : {}),
          done,
          slot: { n: o.n, of: o.of },
        })
      }
    }
  }
  // The new rows sit at their own times: by day, then time on the business
  // day (01:00 after 23:00), untimed last. A stable sort, so a list that
  // was already in that order keeps every other row where it was.
  return grew
    ? out.sort(
        (x, y) => x.day.localeCompare(y.day) || order(x.time) - order(y.time),
      )
    : out
}
