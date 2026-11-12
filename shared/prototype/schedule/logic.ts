// Pure helpers for moving items in time: which item a calendar entry is,
// where it sits once moved, and the 15-minute grid a drag snaps to.

import type { CalendarItem } from "../contract"
import { DAY_START_HOUR } from "../lib/day"
import { derivedId } from "../lib/ids"
import type { OverrideKind, ScheduleOverride } from "./data"

/** Minutes a drag snaps to. */
export const SNAP_MIN = 15
/** The business day in minutes from midnight: 04:00 to 04:00 next day. */
export const DAY_FIRST_MIN = DAY_START_HOUR * 60
export const DAY_LAST_MIN = DAY_FIRST_MIN + 24 * 60 - SNAP_MIN

const pad = (n: number) => String(n).padStart(2, "0")

export const isClock = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)

/** HH:MM to minutes on the business day: the small hours (before 04:00)
 * come after midnight, so 01:30 is 25 h 30 m. */
export function dayMinutes(time: string): number {
  const h = Number(time.slice(0, 2)),
    m = Number(time.slice(3, 5))
  return (h < DAY_START_HOUR ? h + 24 : h) * 60 + m
}

/** Minutes on the business day back to HH:MM. */
export function clockOf(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
}

/** The nearest 15-minute slot, kept inside the business day. */
export function snapMinutes(min: number): number {
  const s = Math.round(min / SNAP_MIN) * SNAP_MIN
  return Math.min(DAY_LAST_MIN, Math.max(DAY_FIRST_MIN, s))
}

export interface ItemRef {
  kind: OverrideKind
  refId: string
}

/** What a calendar entry is, from its id (as both the phone's
 * ``useCalendar`` and the server's ``stats.calendar`` mint them). Workouts,
 * focus sessions and bills are records or dates, not plans: null. */
export function itemRef(
  item: Pick<CalendarItem, "id" | "day">,
): ItemRef | null {
  if (item.id.startsWith("task:"))
    return { kind: "task", refId: item.id.slice("task:".length) }
  for (const kind of ["habit", "routine"] as const) {
    const head = `${kind}-`,
      tail = `-${item.day}`
    if (item.id.startsWith(head) && item.id.endsWith(tail)) {
      const refId = item.id.slice(head.length, item.id.length - tail.length)
      if (refId) return { kind, refId }
    }
  }
  return null
}

/** One id per item and day on every device (the server also matches on
 * kind + item + day, so two devices' moves land on one row). */
export const overrideId = (kind: OverrideKind, refId: string, day: string) =>
  derivedId("schedule-override", `${kind}.${refId}`, day)

export function findOverride(
  overrides: readonly ScheduleOverride[],
  kind: OverrideKind,
  refId: string,
  day: string,
): ScheduleOverride | undefined {
  return overrides.find(
    (o) => o.kind === kind && o.refId === refId && o.day === day,
  )
}

/**
 * Each item at its time for that day: a move made on the Plan tab wins, then
 * the time this phone's own stores give it (``defaults``, by item id: the
 * habit's slot, the task's due time), then the time the item came with. A
 * moved item carries ``movedFrom``: the time it would have had (null when it
 * had none), so the screen can mark it and offer the way back.
 *
 * ``defaults`` matters for the server's copy of the calendar, which already
 * has moves applied and lags a reset until its next refresh.
 */
export function withOverrides(
  items: readonly CalendarItem[],
  overrides: readonly ScheduleOverride[],
  defaults: ReadonlyMap<string, string | undefined> = new Map(),
): CalendarItem[] {
  return items.map((i) => {
    const ref = itemRef(i)
    if (!ref) return i
    const base = defaults.has(i.id) ? defaults.get(i.id) : i.time
    const o = findOverride(overrides, ref.kind, ref.refId, i.day)
    if (!o) {
      if (base === i.time) return i
      const { time: _t, movedFrom: _m, ...rest } = i
      return base ? { ...rest, time: base } : rest
    }
    return { ...i, time: o.time, movedFrom: base ?? null }
  })
}
