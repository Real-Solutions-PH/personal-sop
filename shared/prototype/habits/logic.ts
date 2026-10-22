import { DAY_START_HOUR, dayKey, dayOffset, weekday } from "../lib/day"
import {
  type Habit,
  type HabitLog,
  type HabitsState,
  type Routine,
  type RoutineRun,
  type ScheduleSlot,
  WEEKDAY_SHORT,
} from "./data"
export type Cell =
  | "done"
  | "partial"
  | "skipped"
  | "missed"
  | "paused"
  | "pending"
  | "bonus"
  | "none"
  | "future"
const idxCache = new WeakMap<HabitLog[], Map<string, HabitLog>>()
export const lk = (habitId: string, day: string) => `${habitId}|${day}`
export function logIndex(logs: HabitLog[]): Map<string, HabitLog> {
  let m = idxCache.get(logs)
  if (!m) {
    m = new Map(logs.map((l) => [lk(l.habitId, l.day), l]))
    idxCache.set(logs, m)
  }
  return m
}
export const slotFor = (schedule: ScheduleSlot[], day: string) =>
  schedule.find((s) => s.days.includes(weekday(day)))
export const isPausedOn = (h: Habit, day: string) =>
  h.pauses.some((p) => day >= p.from && (!p.to || day <= p.to))
export function effectiveStatus(h: Habit, today = dayKey()) {
  if (h.status === "archived") return "archived"
  return isPausedOn(h, today) ? "paused" : "active"
}
export const currentPause = (h: Habit, today = dayKey()) =>
  h.pauses.find((p) => today >= p.from && (!p.to || today <= p.to))
export function cellFor(
  h: Habit,
  day: string,
  idx: Map<string, HabitLog>,
  today = dayKey(),
): Cell {
  if (day < h.createdAt) return "none"
  if (h.archivedAt && day > h.archivedAt) return "none"
  const scheduled = !!slotFor(h.schedule, day)
  if (day > today) return scheduled && !isPausedOn(h, day) ? "future" : "none"
  const log = idx.get(lk(h.id, day))
  if (log) return scheduled ? log.status : "bonus"
  if (!scheduled) return "none"
  if (isPausedOn(h, day)) return "paused"
  return day === today ? "pending" : "missed"
}
export const isDue = (h: Habit, day: string) =>
  h.status !== "archived" &&
  day >= h.createdAt &&
  !!slotFor(h.schedule, day) &&
  !isPausedOn(h, day)
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = []
  const d = new Date(`${from}T12:00:00`)
  const end = new Date(`${to}T12:00:00`)
  while (d <= end) {
    out.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    )
    d.setDate(d.getDate() + 1)
  }
  return out
}
export const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00`)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}
export interface HabitStats {
  scheduled: number
  done: number
  partial: number
  skipped: number
  missed: number
  bonus: number
  rate: number
  skipRate: number
  minutes: number
  countTotal: number
  onTime: number
}
export function habitStats(
  h: Habit,
  idx: Map<string, HabitLog>,
  from: string,
  to: string,
  today = dayKey(),
): HabitStats {
  const s = {
    scheduled: 0,
    done: 0,
    partial: 0,
    skipped: 0,
    missed: 0,
    bonus: 0,
    minutes: 0,
    countTotal: 0,
  }
  let timed = 0
  let onTime = 0
  for (const day of daysBetween(from, to > today ? today : to)) {
    const c = cellFor(h, day, idx, today)
    const log = idx.get(lk(h.id, day))
    if (log?.value && log.status !== "skipped") {
      if (h.type === "duration") s.minutes += log.value
      if (h.type === "count") s.countTotal += log.value
    }
    if (c === "done" || c === "partial" || c === "skipped" || c === "missed") {
      s.scheduled++
      s[c]++
    }
    if (c === "bonus") s.bonus++
    if ((c === "done" || c === "partial") && log) {
      const slot = slotFor(h.schedule, day)
      if (slot?.time) {
        timed++
        const [hh, mm] = slot.time.split(":").map(Number)
        const t = new Date(log.loggedAt)
        const diff = t.getHours() * 60 + t.getMinutes() - (hh * 60 + mm)
        if (diff >= -60 && diff <= (slot.window ?? 60)) onTime++
      }
    }
  }
  const denom = s.scheduled - s.skipped
  return {
    ...s,
    rate: denom > 0 ? s.done / denom : 0,
    skipRate: s.scheduled ? s.skipped / s.scheduled : 0,
    onTime: timed ? onTime / timed : 0,
  }
}
export function streaks(
  h: Habit,
  idx: Map<string, HabitLog>,
  today = dayKey(),
) {
  let current = 0
  let d = today
  while (d >= h.createdAt) {
    const c = cellFor(h, d, idx, today)
    if (c === "done" || c === "partial") current++
    else if (c === "missed") break
    d = addDays(d, -1)
  }
  let best = 0
  let run = 0
  const broken: {
    day: string
    length: number
  }[] = []
  for (const day of daysBetween(h.createdAt, today)) {
    const c = cellFor(h, day, idx, today)
    if (c === "done" || c === "partial") {
      run++
      best = Math.max(best, run)
    } else if (c === "missed") {
      if (run >= 3) broken.push({ day, length: run })
      run = 0
    }
  }
  return { current, best, broken }
}
export interface OverallDay {
  day: string
  due: number
  done: number
  rate: number | null
}
export function overallDays(
  habits: Habit[],
  idx: Map<string, HabitLog>,
  from: string,
  to: string,
  today = dayKey(),
): OverallDay[] {
  return daysBetween(from, to).map((day) => {
    let due = 0
    let done = 0
    for (const h of habits) {
      const c = cellFor(h, day, idx, today)
      if (c === "done" || c === "partial" || c === "missed") due++
      if (c === "pending") due++
      if (c === "done") done++
    }
    return { day, due, done, rate: due ? done / due : null }
  })
}
export function overallStats(state: HabitsState, days: number, offset = 0) {
  const today = dayKey()
  const to = dayOffset(-offset)
  const from = dayOffset(-offset - days + 1)
  const idx = logIndex(state.logs)
  const hs = state.habits.filter((h) => h.status !== "archived")
  let done = 0
  let denom = 0
  let skipped = 0
  let scheduled = 0
  let minutes = 0
  let missed = 0
  for (const h of hs) {
    const s = habitStats(h, idx, from, to, today)
    done += s.done
    denom += s.scheduled - s.skipped
    skipped += s.skipped
    scheduled += s.scheduled
    minutes += s.minutes
    missed += s.missed
  }
  const perfect = overallDays(
    hs,
    idx,
    from,
    to > today ? today : to,
    today,
  ).filter((d) => d.due > 0 && d.done === d.due && d.day !== today).length
  return {
    rate: denom ? done / denom : 0,
    /** Anything was due in the window; without it there is nothing to rate. */
    rated: denom > 0,
    skipRate: scheduled ? skipped / scheduled : 0,
    minutes,
    perfect,
    missed,
    done,
  }
}
export const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number)
  return h * 60 + m
}
export function fmtTime(t?: string) {
  if (!t) return "Anytime"
  const [h, m] = t.split(":").map(Number)
  const ap = h >= 12 ? "pm" : "am"
  const h12 = h % 12 || 12
  return m ? `${h12}:${String(m).padStart(2, "0")}${ap}` : `${h12}${ap}`
}
export function daysLabel(days: number[]) {
  const s = [...days].sort()
  if (s.length === 7) return "Every day"
  if (s.join() === "1,2,3,4,5") return "Weekdays"
  if (s.join() === "0,6") return "Weekends"
  if (s.length === 6 && !s.includes(0)) return "Mon–Sat"
  if (s.join() === "0,1,2,3,4") return "Sun–Thu"
  return s.map((d) => WEEKDAY_SHORT[d]).join(" ")
}
export function scheduleLabel(schedule: ScheduleSlot[]) {
  return schedule
    .filter((s) => s.days.length)
    .map((s) => `${daysLabel(s.days)} · ${fmtTime(s.time)}`)
    .join("  +  ")
}
export function targetLabel(h: Habit) {
  if (h.type === "duration") return h.target ? `${h.target} min` : "Timed"
  if (h.type === "count") return `${h.target ?? 1} ${h.unit ?? ""}`.trim()
  return "Check"
}
export function valueLabel(h: Habit, v?: number) {
  if (v === undefined) return ""
  if (h.type === "duration") return `${v} min`
  if (h.type === "count")
    return `${v}${h.target ? `/${h.target}` : ""} ${h.unit ?? ""}`.trim()
  return ""
}
export const fmtMinutes = (m: number) =>
  m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`
export const pct = (v: number) => `${Math.round(v * 100)}%`
export type TodayGroup = "now" | "later" | "anytime" | "done"
export function todayGroup(
  h: Habit,
  log: HabitLog | undefined,
  day: string,
  now = new Date(),
): TodayGroup {
  if (log && (log.status !== "partial" || h.type === "check")) return "done"
  const slot = slotFor(h.schedule, day)
  if (!slot?.time) return "anytime"
  const t = toMin(slot.time)
  let n = now.getHours() * 60 + now.getMinutes()
  if (now.getHours() < 4) n += 24 * 60
  return n >= t - 30 ? "now" : "later"
}
export const plannedMin = (r: Routine) =>
  r.steps.reduce((a, s) => a + s.minutes, 0)
export const runState = (run: RoutineRun, today = dayKey()) =>
  run.state === "in_progress" && run.day < today ? "abandoned" : run.state
export function routineStats(
  r: Routine,
  runs: RoutineRun[],
  days: number,
  today = dayKey(),
) {
  const from = dayOffset(-days + 1)
  const mine = runs.filter((x) => x.routineId === r.id && x.day >= from)
  let scheduledDays = 0
  for (const d of daysBetween(from, today)) {
    if (d < r.createdAt || !slotFor(r.schedule, d)) continue
    if (d === today && !mine.some((x) => x.day === d)) continue
    scheduledDays++
  }
  const completed = mine.filter((x) => runState(x, today) === "completed")
  const abandoned = mine.filter((x) => runState(x, today) === "abandoned")
  const paces = completed.map((x) => {
    const actual = x.results.reduce((a, s) => a + s.actualSec, 0)
    const planned = x.steps
      .filter((_, i) => x.results[i]?.status === "done")
      .reduce((a, s) => a + s.minutes * 60, 0)
    return planned ? actual / planned : 1
  })
  return {
    runs: mine,
    scheduledDays,
    completed: completed.length,
    abandoned,
    rate: scheduledDays ? completed.length / scheduledDays : 0,
    pace: paces.length ? paces.reduce((a, b) => a + b, 0) / paces.length : 0,
  }
}
export const runActualSec = (run: RoutineRun) =>
  run.results.reduce((a, s) => a + s.actualSec, 0)
export function stepElapsed(run: RoutineRun, now = Date.now()) {
  const end = run.pausedAt ? new Date(run.pausedAt).getTime() : now
  return Math.max(
    0,
    (end - new Date(run.stepStartedAt).getTime()) / 1000 - run.stepPausedSec,
  )
}
export const weekStartOf = (day: string, weekStart: 0 | 1) => {
  const wd = weekday(day)
  return addDays(day, -((wd - weekStart + 7) % 7))
}
export function mostMissedWeekday(
  habits: Habit[],
  idx: Map<string, HabitLog>,
  from: string,
  today = dayKey(),
) {
  const miss = [0, 0, 0, 0, 0, 0, 0]
  for (const h of habits)
    for (const d of daysBetween(from, today))
      if (cellFor(h, d, idx, today) === "missed") miss[weekday(d)]++
  const max = Math.max(...miss)
  return max ? { day: WEEKDAY_SHORT[miss.indexOf(max)], count: max } : null
}
export function sortedHabits(habits: Habit[]) {
  return [...habits].sort((a, b) => a.sortOrder - b.sortOrder)
}

// When in the day a routine belongs on Today. A timed routine shows from
// LEAD minutes before its time until TAIL minutes after it should be done;
// an untimed one takes its part of the day from its name ("morning",
// "evening"...), else it shows all day. Minutes run from local midnight,
// and the hours after midnight before the day rolls over count past 24:00,
// so a late-evening window does not wrap.
const LEAD = 90
const TAIL = 120
const PARTS: [RegExp, number, number][] = [
  [/\b(morning|umaga|wake)\b/i, 4 * 60, 12 * 60],
  [/\b(afternoon|hapon|midday|lunch)\b/i, 12 * 60, 17 * 60],
  [/\b(evening|night|gabi|bedtime|wind[- ]?down)\b/i, 17 * 60, 28 * 60],
]

/** The minute of the business day: past midnight before the rollover
 * counts on from 24:00. */
export function businessMinute(d: Date, startHour = DAY_START_HOUR) {
  const m = d.getHours() * 60 + d.getMinutes()
  return d.getHours() < startHour ? m + 24 * 60 : m
}

/** [from, to] minutes of the business day the routine shows, or null for
 * all day. */
export function routineWindow(
  r: Routine,
  day: string,
): [number, number] | null {
  const time = slotFor(r.schedule, day)?.time
  if (time) {
    const [h, m] = time.split(":").map(Number)
    let at = h * 60 + m
    if (h < DAY_START_HOUR) at += 24 * 60
    return [at - LEAD, at + plannedMin(r) + TAIL]
  }
  const part = PARTS.find(([re]) => re.test(r.name))
  return part ? [part[1], part[2]] : null
}

export function routineShowsAt(r: Routine, day: string, minute: number) {
  const w = routineWindow(r, day)
  return !w || (minute >= w[0] && minute <= w[1])
}
