// When the daily-loop rewards and misses play: once a day, once per streak
// break, at the streak milestones. Pure rules plus one device-local record
// of which once-a-day moments have played, so a relaunch never replays one
// and a pull from another device never plays one here.
import type { Habit, HabitLog } from "@domain/habits/data"
import { addDays, cellFor, daysBetween } from "@domain/habits/logic"
import { dayKey } from "@domain/lib/day"
import { graceReady, walkRun } from "@domain/lib/grace"
import { createStore } from "@domain/lib/store"
import { WAY_BACK } from "@domain/way-back"

/** Each once-a-day moment's key → the last day it played on this phone. */
export const rewardStore = createStore("rewards", () => ({
  days: {} as Record<string, string>,
}))

export const playedToday = (key: string, day = dayKey()) =>
  rewardStore.get().days[key] === day

/** True the first time ``key`` is claimed on ``day``; records the claim. */
export function claimDay(key: string, day = dayKey()): boolean {
  if (playedToday(key, day)) return false
  rewardStore.set((s) => ({ days: { ...s.days, [key]: day } }))
  return true
}

/** The streak lengths that earn a bigger moment. */
export const MILESTONES = [7, 30, 100, 365] as const
export const isMilestone = (n: number) =>
  (MILESTONES as readonly number[]).includes(n)

type Streaks = {
  current: number
  broken: { day: string; length: number }[]
  graceDays: string[]
}

/** A run that ended on yesterday's miss, shown for that one day: the
 * missed days in a row up to yesterday and the run they ended, or null. A
 * streak already going again (or held by a grace day) shows as a streak. */
export function streakMiss(
  h: Habit,
  idx: Map<string, HabitLog>,
  st: Streaks,
  today = dayKey(),
): { missed: number; run: number } | null {
  if (st.current > 0) return null
  const yesterday = addDays(today, -1)
  const ended = st.broken.find((b) => b.day === yesterday)
  if (!ended) return null
  let missed = 0
  for (let d = yesterday; d >= h.createdAt; d = addDays(d, -1)) {
    const c = cellFor(h, d, idx, today)
    if (c === "missed") missed++
    else if (c === "done" || c === "partial") break
  }
  return { missed, run: ended.length }
}

/** What the live streak chip adds: the way-back pause it is resting on
 * (until the habit is next done), else whether this week's rest day (the
 * grace day that bridges a lone miss) is still ready or already used. */
export function streakNote(
  h: Habit,
  idx: Map<string, HabitLog>,
  st: Streaks,
  today = dayKey(),
): string | null {
  if (st.current <= 0) return null
  const away = h.pauses
    .filter((p) => p.reason === WAY_BACK && p.to && p.to < today)
    .sort((a, b) => (a.from < b.from ? 1 : -1))[0]
  if (away?.to) {
    let doneSince = false
    for (let d = addDays(away.to, 1); d < today; d = addDays(d, 1)) {
      const c = cellFor(h, d, idx, today)
      if (c === "done" || c === "partial") doneSince = true
    }
    const t = cellFor(h, today, idx, today)
    if (t === "done" || t === "partial") doneSince = true
    if (!doneSince) {
      const n = daysBetween(away.from, away.to).length
      return `paused ${n} day${n === 1 ? "" : "s"}`
    }
  }
  return graceReady(st.current, st.graceDays, today)
    ? "rest day ready"
    : "rest day used"
}

export type DayStanding = "perfect" | "target" | "below" | "free"
/** Where today stands against the person's target. */
export function dayStanding(
  ring: { due: number; done: number },
  threshold: number,
): DayStanding {
  if (!ring.due) return "free"
  if (ring.done >= ring.due) return "perfect"
  return ring.done / ring.due >= threshold ? "target" : "below"
}

/** The moment a change in standing earns, if any: a step up only. */
export function standingMoment(
  before: DayStanding,
  after: DayStanding,
): "perfect" | "target" | null {
  const rank = { free: 0, below: 0, target: 1, perfect: 2 }
  if (rank[after] <= rank[before]) return null
  return after === "perfect" ? "perfect" : "target"
}

/** How yesterday went, for the morning strip: off target or not, whether
 * the grace day covered it, and the on-target run it ended (the same walk
 * as the streak: days with nothing due neither extend nor break). */
export function yesterdayRecap(
  series: { day: string; onTarget: boolean | null }[],
  today = dayKey(),
): { offTarget: boolean; ended: number; grace: boolean } {
  const yesterday = addDays(today, -1)
  const past = series.filter((d) => d.day < today)
  const y = past.find((d) => d.day === yesterday)
  if (y?.onTarget !== false) return { offTarget: false, ended: 0, grace: false }
  const w = walkRun(
    past.map((d): [string, boolean | null] => [d.day, d.onTarget]),
  )
  if (w.graceDays.includes(yesterday))
    return { offTarget: true, ended: 0, grace: true }
  const ended = w.broken.find((b) => b.day === yesterday)?.length ?? 0
  return { offTarget: true, ended, grace: false }
}

/** Days 1–7 of the first week, from the first day anything was logged
 * (today, before the first log): which of them have a log. Empty once the
 * first week is over. */
export function firstWeek(
  loggedDays: string[],
  today = dayKey(),
): { day: string; logged: boolean }[] {
  const first = [...loggedDays].sort()[0] ?? today
  const days = Array.from({ length: 7 }, (_, i) => addDays(first, i))
  if (today > days[6]) return []
  const have = new Set(loggedDays)
  return days.map((day) => ({ day, logged: have.has(day) }))
}

/** Whether a change just now was caused on this phone: a completion by
 * hand within ``ms`` (``markCompletion``), or a habit log written here
 * within ``ms`` (a widget or lock-screen tap logs through the same action,
 * stamped with this phone's clock). A pull carries the other device's
 * older ``loggedAt``, so it plays nothing. */
export function causedHere(
  completedAgo: number,
  lastLogAt: string | undefined,
  ms: number,
  now = Date.now(),
): boolean {
  if (completedAgo < ms) return true
  if (!lastLogAt) return false
  const ago = now - Date.parse(lastLogAt)
  return ago >= 0 && ago < ms
}
