// Focus statistics over the device's records (ADR-0025), the same rules as
// backend/app/modules/focus/stats.py: a day is due from the first counted
// session on and done when its focus reaches the daily goal.

import { dayKey } from "../lib/day"
import type { FocusItem, FocusState } from "./data"
import * as L from "./logic"

export interface RangeStats {
  first: string
  last: string
  byDay: Record<string, number>
  spans: L.Focused[]
  timelines: L.Timeline[]
}

export function prevDay(d: string): string {
  const [y, m, dd] = d.split("-").map(Number)
  const n = new Date(y, m - 1, dd - 1, 12)
  const pad = (x: number) => String(x).padStart(2, "0")
  return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`
}
export const addDays = (d: string, n: number) => {
  let out = d
  for (let i = 0; i < Math.abs(n); i++)
    out = n > 0 ? L.nextDay(out) : prevDay(out)
  return out
}

export function timelines(s: FocusState, lo: number, hi: number, now: number) {
  return s.sessions
    .filter(
      (x) =>
        new Date(x.startedAt).getTime() < hi &&
        (!x.endedAt || new Date(x.endedAt).getTime() >= lo),
    )
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .map((x) => L.advance(L.toTimeline(x, s.segments), now))
}

export function rangeStats(
  s: FocusState,
  first: string,
  last: string,
  now = Date.now(),
): RangeStats {
  const lo = L.dayStart(first)
  const hi = L.dayStart(L.nextDay(last))
  const tls = timelines(s, lo, hi, now)
  const spans = L.counted(tls, now)
    .filter((f) => f.end > lo && f.start < hi)
    .map((f) => ({
      ...f,
      start: Math.max(f.start, lo),
      end: Math.min(f.end, hi),
    }))
  return {
    first,
    last,
    byDay: L.perDay(spans, first, last),
    spans,
    timelines: tls,
  }
}

/** The business day of the first session that counts. */
export function firstDay(s: FocusState): string | null {
  let first: string | null = null
  for (const x of s.sessions)
    if (x.endReason !== "abandoned" && (!first || x.startedAt < first))
      first = x.startedAt
  return first ? dayKey(new Date(first)) : null
}

export const goalSec = (s: FocusState) => s.settings.dailyGoalMin * 60

/** The window's days the goal applies to: from the first session to today. */
export function dueDays(
  s: FocusState,
  first: string,
  last: string,
  today = dayKey(),
): string[] {
  const f = firstDay(s)
  if (!f) return []
  const lo = f > first ? f : first
  const hi = last < today ? last : today
  return lo <= hi ? L.daysBetween(lo, hi) : []
}

export function areaRate(
  s: FocusState,
  first: string,
  last: string,
  now = Date.now(),
): number | null {
  const goal = goalSec(s)
  const days = dueDays(s, first, last, dayKey(new Date(now)))
  if (goal <= 0 || !days.length) return null
  const r = rangeStats(s, first, last, now)
  return (
    days.reduce((n, d) => n + Math.min(1, (r.byDay[d] ?? 0) / goal), 0) /
    days.length
  )
}

export interface ItemTotal {
  item: FocusItem | null
  sec: number
}
/** Focus by item, most first. */
export function itemTotals(spans: L.Focused[]): ItemTotal[] {
  const titles = new Map<string, FocusItem>()
  for (const f of [...spans].sort((a, b) => a.start - b.start))
    if (f.item) titles.set(L.itemKey(f.item), f.item)
  return Object.entries(L.perItem(spans))
    .filter(([, v]) => v > 0)
    .map(([k, sec]) => ({ item: k ? (titles.get(k) ?? null) : null, sec }))
    .sort(
      (a, b) =>
        b.sec - a.sec ||
        (a.item?.title ?? "~").localeCompare(b.item?.title ?? "~"),
    )
}

/** (current, best) runs of days on goal over the last `days`. */
export function streaks(s: FocusState, days = 400, now = Date.now()) {
  const goal = goalSec(s)
  if (goal <= 0) return { current: 0, best: 0 }
  const today = dayKey(new Date(now))
  const r = rangeStats(s, addDays(today, -(days - 1)), today, now)
  let best = 0
  let run = 0
  for (const d of Object.keys(r.byDay).sort()) {
    run = r.byDay[d] >= goal ? run + 1 : 0
    best = Math.max(best, run)
  }
  return { current: L.goalStreak(r.byDay, goal, today, prevDay), best }
}

/** Time on one task or habit: all of it, today, the last 7 days, and the
 * sessions it came from (newest first). */
export function itemTime(
  s: FocusState,
  kind: "task" | "habit",
  id: string,
  now = Date.now(),
) {
  const tls = s.sessions.map((x) => L.advance(L.toTimeline(x, s.segments), now))
  const spans = L.counted(tls, now).filter(
    (f) => f.item?.kind === kind && f.item.id === id,
  )
  const today = dayKey(new Date(now))
  const week = L.perDay(spans, addDays(today, -6), today)
  const bySession = new Map<string, L.Span[]>()
  for (const f of spans)
    bySession.set(f.sessionId, [
      ...(bySession.get(f.sessionId) ?? []),
      [f.start, f.end],
    ])
  const recent = [...bySession.entries()]
    .map(([sessionId, v]) => {
      const x = s.sessions.find((y) => y.id === sessionId)
      return {
        sessionId,
        startedAt: x?.startedAt ?? "",
        day: x ? dayKey(new Date(x.startedAt)) : "",
        sec: Math.floor(
          L.union(v).reduce((n, [a, b]) => n + (b - a), 0) / 1000,
        ),
      }
    })
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, 10)
  return {
    sec: Object.values(L.perItem(spans)).reduce((a, b) => a + b, 0),
    todaySec: week[today] ?? 0,
    weekSec: Object.values(week).reduce((a, b) => a + b, 0),
    recent,
  }
}

export interface Block {
  sessionId: string
  segmentId: string
  kind: "focus" | "break" | "pause"
  start: number
  end: number
  running: boolean
  abandoned: boolean
  item: FocusItem | null
}
/** The day timeline: every span on one business day, clipped to it. */
export function dayBlocks(
  s: FocusState,
  day: string,
  now = Date.now(),
): Block[] {
  const lo = L.dayStart(day)
  const hi = L.dayStart(L.nextDay(day))
  const out: Block[] = []
  for (const tl of timelines(s, lo, hi, now))
    for (const g of tl.segs)
      for (const [a, b] of L.clip([[g.start, L.endOf(g, now)]], lo, hi))
        if (b > a)
          out.push({
            sessionId: tl.sess.id,
            segmentId: g.id,
            kind: g.kind,
            start: a,
            end: b,
            running: g.end === null,
            abandoned: tl.sess.endReason === "abandoned",
            item: g.item,
          })
  return out.sort((a, b) => a.start - b.start)
}
