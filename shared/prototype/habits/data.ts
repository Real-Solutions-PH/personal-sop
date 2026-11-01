import { at, dayOffset, weekday } from "../lib/day"
import type { HabitRule } from "../screen/data"
export type HabitType = "check" | "duration" | "count"
export type HabitStatus = "active" | "paused" | "archived"
export type LogStatus = "done" | "partial" | "skipped"
export type LogSource =
  | "tap"
  | "timer"
  | "routine"
  | "capture"
  | "workout"
  | "screen"
export interface ScheduleSlot {
  days: number[]
  time?: string
  window?: number
}
export interface PauseRange {
  from: string
  to?: string
  reason?: string
}
export interface Habit {
  id: string
  name: string
  icon: string
  type: HabitType
  target?: number
  unit?: string
  step?: number
  schedule: ScheduleSlot[]
  reminder: boolean
  /** Keep reminding me: once a timed slot passes undone, remind again every
   * this many minutes for the rest of that day. Absent or null = off. */
  nagEveryMin?: number | null
  status: HabitStatus
  pauses: PauseRange[]
  linkWorkout: boolean
  /** Completes itself from screen time; manual actions are refused. */
  rule?: HabitRule
  createdAt: string
  archivedAt?: string
  sortOrder: number
}
export interface HabitLog {
  id: string
  habitId: string
  day: string
  status: LogStatus
  value?: number
  loggedAt: string
  source: LogSource
  note?: string
}
export interface RoutineStep {
  habitId: string
  minutes: number
}
export interface Routine {
  id: string
  name: string
  icon: string
  schedule: ScheduleSlot[]
  reminder: boolean
  steps: RoutineStep[]
  status: "active" | "archived"
  createdAt: string
}
export interface StepResult {
  habitId: string
  status: "done" | "skipped" | "not_reached"
  actualSec: number
}
export interface RoutineRun {
  id: string
  routineId: string
  day: string
  startedAt: string
  endedAt?: string
  steps: RoutineStep[]
  results: StepResult[]
  current: number
  stepStartedAt: string
  stepPausedSec: number
  stepBonusSec: number
  pausedAt?: string
  state: "in_progress" | "completed" | "abandoned"
}
export interface TimerSession {
  habitId: string
  day: string
  targetSec?: number
}
export interface HabitSettings {
  weekStart: 0 | 1
  defaultReminder: boolean
  streakNudge: boolean
}
export interface HabitsState {
  habits: Habit[]
  logs: HabitLog[]
  routines: Routine[]
  runs: RoutineRun[]
  timer: TimerSession | null
  settings: HabitSettings
}
export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
export const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6]
export const WEEKDAYS = [1, 2, 3, 4, 5]
export const ICONS = [
  "🏋️",
  "📖",
  "🧠",
  "🧘",
  "💧",
  "✍️",
  "📵",
  "🌙",
  "🏃",
  "🥗",
  "💊",
  "🎸",
  "🧹",
  "🙏",
  "🌅",
  "☀️",
  "💻",
  "🚶",
  "🦷",
  "🛏️",
]
export const STARTERS: Pick<
  Habit,
  "name" | "icon" | "type" | "target" | "unit"
>[] = [
  {
    name: "Drink water",
    icon: "💧",
    type: "count",
    target: 8,
    unit: "glasses",
  },
  { name: "Read", icon: "📖", type: "count", target: 20, unit: "pages" },
  { name: "Meditate", icon: "🧘", type: "duration", target: 10 },
]
function mulberry32(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
interface SeedHabit extends Habit {
  p: number
  skipP: number
  wdMod?: Partial<Record<number, number>>
}
const SKIP_NOTES = [
  "Late shift",
  "Knee is sore",
  "Rest day",
  "Out of town (Cebu)",
  "Family thing",
  undefined,
]
function seedHabitList(): SeedHabit[] {
  const base = {
    reminder: true,
    status: "active" as const,
    pauses: [] as PauseRange[],
    linkWorkout: false,
    createdAt: dayOffset(-92),
  }
  return [
    {
      ...base,
      id: "h-workout",
      name: "Morning workout",
      icon: "🏋️",
      type: "check",
      schedule: [{ days: [1, 2, 3, 4, 5, 6], time: "06:00", window: 90 }],
      linkWorkout: true,
      pauses: [
        { from: dayOffset(-55), to: dayOffset(-49), reason: "Sick — flu" },
      ],
      sortOrder: 0,
      p: 0.72,
      skipP: 0.1,
      wdMod: { 6: -0.15 },
    },
    {
      ...base,
      id: "h-meditate",
      name: "Meditate 10m",
      icon: "🧘",
      type: "duration",
      target: 10,
      schedule: [{ days: EVERY_DAY, time: "06:45", window: 60 }],
      sortOrder: 1,
      p: 0.8,
      skipP: 0.04,
    },
    {
      ...base,
      id: "h-water",
      name: "Drink water ×8",
      icon: "💧",
      type: "count",
      target: 8,
      unit: "glasses",
      step: 1,
      schedule: [{ days: EVERY_DAY }],
      reminder: false,
      sortOrder: 2,
      p: 0.58,
      skipP: 0,
    },
    {
      ...base,
      id: "h-deepwork",
      name: "Deep work 90m",
      icon: "🧠",
      type: "duration",
      target: 90,
      schedule: [
        { days: WEEKDAYS, time: "09:00", window: 120 },
        { days: [6], time: "13:00", window: 120 },
      ],
      sortOrder: 3,
      p: 0.66,
      skipP: 0.06,
      wdMod: { 1: 0.1, 5: -0.2 },
    },
    {
      ...base,
      id: "h-nosocial",
      name: "No social media before 10am",
      icon: "📵",
      type: "check",
      schedule: [{ days: EVERY_DAY, time: "10:00", window: 60 }],
      reminder: false,
      sortOrder: 4,
      p: 0.6,
      skipP: 0.02,
      wdMod: { 0: -0.2, 6: -0.15 },
    },
    {
      ...base,
      id: "h-read",
      name: "Read 20 pages",
      icon: "📖",
      type: "count",
      target: 20,
      unit: "pages",
      step: 5,
      schedule: [{ days: EVERY_DAY, time: "21:30", window: 90 }],
      sortOrder: 5,
      p: 0.7,
      skipP: 0.05,
    },
    {
      ...base,
      id: "h-journal",
      name: "Journal",
      icon: "✍️",
      type: "check",
      schedule: [{ days: EVERY_DAY, time: "22:30", window: 60 }],
      sortOrder: 6,
      p: 0.55,
      skipP: 0.05,
      wdMod: { 5: -0.15, 6: -0.1 },
    },
    {
      ...base,
      id: "h-sleep",
      name: "Sleep by 11:30pm",
      icon: "🌙",
      type: "check",
      schedule: [{ days: [0, 1, 2, 3, 4], time: "23:30", window: 30 }],
      createdAt: dayOffset(-60),
      sortOrder: 7,
      p: 0.5,
      skipP: 0.08,
    },
  ]
}
const ROUTINES: Routine[] = [
  {
    id: "r-morning",
    name: "Morning routine",
    icon: "🌅",
    schedule: [{ days: [1, 2, 3, 4, 5, 6], time: "06:00", window: 90 }],
    reminder: true,
    steps: [
      { habitId: "h-water", minutes: 2 },
      { habitId: "h-meditate", minutes: 10 },
      { habitId: "h-workout", minutes: 45 },
    ],
    status: "active",
    createdAt: dayOffset(-92),
  },
  {
    id: "r-winddown",
    name: "Wind-down",
    icon: "🌙",
    schedule: [{ days: [0, 1, 2, 3, 4], time: "22:00", window: 90 }],
    reminder: true,
    steps: [
      { habitId: "h-journal", minutes: 10 },
      { habitId: "h-read", minutes: 25 },
      { habitId: "h-sleep", minutes: 5 },
    ],
    status: "active",
    createdAt: dayOffset(-60),
  },
]
const slotOn = (s: ScheduleSlot[], day: string) =>
  s.find((x) => x.days.includes(weekday(day)))
const hm = (t = "12:00") => t.split(":").map(Number) as [number, number]
export function seedHabits(): HabitsState {
  const r = mulberry32(20260926)
  const list = seedHabitList()
  const logs: HabitLog[] = []
  const nowH = new Date().getHours()
  let n = 0
  for (let d = -90; d <= 0; d++) {
    const day = dayOffset(d)
    const wd = weekday(day)
    const slump = d > -44 && d < -33 ? -0.28 : 0
    const trend = ((d + 90) / 90) * 0.12
    const hot = d >= -9 && d < 0 ? 0.35 : 0
    for (const h of list) {
      const x = r()
      const v = r()
      const j = r()
      if (day < h.createdAt) continue
      if (h.pauses.some((p) => day >= p.from && (!p.to || day <= p.to)))
        continue
      const slot = slotOn(h.schedule, day)
      if (!slot) continue
      const [hh, mm] = hm(slot.time ?? "14:00")
      if (d === 0 && (hh > nowH || nowH < 5)) continue
      const p = Math.min(0.97, h.p + trend + slump + hot + (h.wdMod?.[wd] ?? 0))
      const jitter = Math.round((j - 0.3) * 50)
      const loggedAt = at(d, hh, Math.max(0, Math.min(59, mm + (jitter % 59))))
      const id = `sl-${n++}`
      if (x < p) {
        let value: number | undefined
        let status: LogStatus = "done"
        if (h.type === "duration" && h.target) {
          value = Math.round(h.target * (0.55 + v * 0.75))
          if (value < h.target) status = v < 0.25 ? "partial" : "done"
          if (status === "done") value = Math.max(value, h.target)
        } else if (h.type === "count" && h.target) {
          value =
            v < 0.22
              ? Math.round(h.target * (0.35 + v * 2.5))
              : Math.round(h.target * (1 + (v - 0.22) * 0.5))
          status = value >= h.target ? "done" : "partial"
        }
        logs.push({
          id,
          habitId: h.id,
          day,
          status,
          value,
          loggedAt,
          source: "tap",
        })
      } else if (x < p + h.skipP) {
        logs.push({
          id,
          habitId: h.id,
          day,
          status: "skipped",
          loggedAt,
          source: "tap",
          note: SKIP_NOTES[Math.floor(v * SKIP_NOTES.length)],
        })
      }
    }
  }
  const byKey = new Map(logs.map((l) => [`${l.habitId}|${l.day}`, l]))
  const runs: RoutineRun[] = []
  for (let d = -60; d <= -1; d++) {
    const day = dayOffset(d)
    for (const rt of ROUTINES) {
      const slot = slotOn(rt.schedule, day)
      if (!slot || day < rt.createdAt) continue
      const stepLogs = rt.steps.map((s) => byKey.get(`${s.habitId}|${day}`))
      if (!stepLogs[0] || stepLogs[0].status === "skipped") continue
      const [hh, mm] = hm(slot.time)
      let reached = true
      let total = 0
      const results: StepResult[] = rt.steps.map((s, i) => {
        const l = stepLogs[i]
        const f = 0.75 + r() * 0.55
        if (!reached || !l) {
          reached = false
          return { habitId: s.habitId, status: "not_reached", actualSec: 0 }
        }
        l.source = "routine"
        if (l.status === "skipped")
          return { habitId: s.habitId, status: "skipped", actualSec: 0 }
        const actualSec = Math.round(s.minutes * 60 * f)
        total += actualSec
        return { habitId: s.habitId, status: "done", actualSec }
      })
      const completed = results.every((x) => x.status !== "not_reached")
      const startedAt = at(d, hh, mm + 5)
      runs.push({
        id: `run-${rt.id}-${d}`,
        routineId: rt.id,
        day,
        startedAt,
        endedAt: new Date(
          new Date(startedAt).getTime() + total * 1000,
        ).toISOString(),
        steps: rt.steps,
        results,
        current: results.filter((x) => x.status !== "not_reached").length,
        stepStartedAt: startedAt,
        stepPausedSec: 0,
        stepBonusSec: 0,
        state: completed ? "completed" : "abandoned",
      })
    }
  }
  return {
    habits: list.map(({ p: _p, skipP: _s, wdMod: _w, ...h }) => h),
    logs,
    routines: ROUTINES,
    runs,
    timer: null,
    settings: { weekStart: 1, defaultReminder: true, streakNudge: true },
  }
}
