"use client"
import { dashStore } from "../dash/store"
import { dayKey } from "../lib/day"
import { derivedId } from "../lib/ids"
import { type Live, liveStore, startLive, stopLive } from "../lib/live"
import { uid } from "../lib/store"
import type {
  Habit,
  HabitLog,
  HabitSettings,
  LogSource,
  LogStatus,
  Routine,
  RoutineRun,
  RoutineStep,
} from "./data"
import { addDays, isDue, lk, logIndex, slotFor, stepElapsed } from "./logic"
import { habitsStore } from "./store"

const S = habitsStore
const nowIso = () => new Date().toISOString()
const findHabit = (id: string) => S.get().habits.find((h) => h.id === id)
/** A habit driven by screen time completes itself: every manual action on
 * it is a no-op (the UI never offers one; the server answers 409). While
 * Screen time is switched off it is an ordinary check habit again. */
const manual = (id: string) => {
  const h = findHabit(id)
  return h && (!h.rule || !dashStore.get().enabled.screen) ? h : undefined
}
export interface LogInput {
  habitId: string
  day?: string
  status?: LogStatus
  value?: number
  note?: string
  source?: LogSource
  add?: boolean
  /** Id for a new log (an existing log for the day keeps its own). */
  id?: string
}
function autoStatus(h: Habit, value?: number): LogStatus {
  if (h.type === "check" || !h.target || value === undefined) return "done"
  return value >= h.target ? "done" : "partial"
}
export function logHabit(input: LogInput): HabitLog | null {
  const h = manual(input.habitId)
  if (!h) return null
  const day = input.day ?? dayKey()
  const existing = logIndex(S.get().logs).get(lk(h.id, day))
  let value = input.value
  if (input.add && existing?.value !== undefined && value !== undefined)
    value = existing.value + value
  const status = input.status ?? autoStatus(h, value)
  const log: HabitLog = {
    id: existing?.id ?? input.id ?? uid(),
    habitId: h.id,
    day,
    status,
    value: status === "skipped" ? undefined : value,
    note: input.note ?? existing?.note,
    loggedAt: nowIso(),
    source: input.source ?? "tap",
  }
  S.set((s) => ({
    ...s,
    logs: existing
      ? s.logs.map((l) => (l.id === existing.id ? log : l))
      : [...s.logs, log],
  }))
  return log
}
export function checkHabit(
  habitId: string,
  day?: string,
  source: LogSource = "tap",
  id?: string,
): HabitLog | null {
  const h = manual(habitId)
  if (!h) return null
  return logHabit({
    habitId,
    day,
    source,
    id,
    status: "done",
    value: h.type === "check" ? undefined : (h.target ?? 1),
  })
}
export function incrementCount(habitId: string, by?: number, day?: string) {
  const h = manual(habitId)
  if (!h) return null
  return logHabit({ habitId, day, value: by ?? h.step ?? 1, add: true })
}
export const skipHabit = (habitId: string, day?: string, note?: string) =>
  logHabit({ habitId, day, status: "skipped", note })
export function clearLog(habitId: string, day = dayKey()): HabitLog | null {
  if (!manual(habitId)) return null
  const existing = logIndex(S.get().logs).get(lk(habitId, day))
  if (!existing) return null
  S.set((s) => ({ ...s, logs: s.logs.filter((l) => l.id !== existing.id) }))
  return existing
}
export function deleteLog(id: string) {
  S.set((s) => ({ ...s, logs: s.logs.filter((l) => l.id !== id) }))
}
export function restoreLog(log: HabitLog) {
  S.set((s) => ({
    ...s,
    logs: [
      ...s.logs.filter(
        (l) => !(l.habitId === log.habitId && l.day === log.day),
      ),
      log,
    ],
  }))
}
/** Tick the workout-linked habits for a finished workout. With the workout's
 * id, a new log gets the id the server derives for the same tick, so the
 * device's copy and the server's converge on one row. */
export function autoCheckWorkoutHabits(
  day = dayKey(),
  workoutId?: string,
): HabitLog[] {
  const idx = logIndex(S.get().logs)
  const out: HabitLog[] = []
  for (const h of S.get().habits) {
    if (!h.linkWorkout || h.status === "archived") continue
    const cur = idx.get(lk(h.id, day))
    if (cur?.status === "done") continue
    const id = workoutId
      ? derivedId("workout-habit", workoutId, h.id)
      : undefined
    const l = checkHabit(h.id, day, "workout", id)
    if (l) out.push(l)
  }
  return out
}
export function findHabits(query: string): Habit[] {
  const q = query.toLowerCase().trim()
  return S.get().habits.filter(
    (h) =>
      h.status !== "archived" &&
      (h.name.toLowerCase().includes(q) ||
        q.includes(h.name.toLowerCase().split(" ")[0])),
  )
}
export type HabitInput = Omit<
  Habit,
  "id" | "status" | "pauses" | "createdAt" | "sortOrder" | "archivedAt"
>
export function createHabit(
  input: Partial<HabitInput> & {
    name: string
  },
): Habit {
  const s = S.get()
  const h: Habit = {
    icon: "✅",
    type: "check",
    schedule: [{ days: [0, 1, 2, 3, 4, 5, 6] }],
    reminder: s.settings.defaultReminder,
    linkWorkout: false,
    ...input,
    id: uid(),
    status: "active",
    pauses: [],
    createdAt: dayKey(),
    sortOrder: Math.max(0, ...s.habits.map((x) => x.sortOrder)) + 1,
  }
  S.set((st) => ({ ...st, habits: [...st.habits, h] }))
  return h
}
export function updateHabit(id: string, patch: Partial<Habit>) {
  S.set((s) => ({
    ...s,
    habits: s.habits.map((h) => (h.id === id ? { ...h, ...patch } : h)),
  }))
}
export function pauseHabit(id: string, until?: string, reason?: string) {
  const today = dayKey()
  const h = findHabit(id)
  if (!h) return
  const to = until ? addDays(until, -1) : undefined
  updateHabit(id, {
    status: "paused",
    pauses: [...h.pauses, { from: today, to, reason }],
  })
}
export function resumeHabit(id: string) {
  const today = dayKey()
  const h = findHabit(id)
  if (!h) return
  const yesterday = addDays(today, -1)
  updateHabit(id, {
    status: "active",
    pauses: h.pauses
      .map((p) =>
        today >= p.from && (!p.to || today <= p.to)
          ? { ...p, to: yesterday }
          : p,
      )
      .filter((p) => !p.to || p.to >= p.from),
  })
}
export const archiveHabit = (id: string) =>
  updateHabit(id, { status: "archived", archivedAt: dayKey() })
export const restoreHabit = (id: string) =>
  updateHabit(id, { status: "active", archivedAt: undefined })
export function deleteHabit(id: string) {
  S.set((s) => ({
    ...s,
    habits: s.habits.filter((h) => h.id !== id),
    logs: s.logs.filter((l) => l.habitId !== id),
    routines: s.routines.map((r) => ({
      ...r,
      steps: r.steps.filter((st) => st.habitId !== id),
    })),
  }))
}
export function reorderHabit(id: string, dir: -1 | 1) {
  const list = [...S.get().habits]
    .filter((h) => h.status !== "archived")
    .sort((a, b) => a.sortOrder - b.sortOrder)
  const i = list.findIndex((h) => h.id === id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= list.length) return
  const a = list[i].sortOrder
  updateHabit(list[i].id, { sortOrder: list[j].sortOrder })
  updateHabit(list[j].id, { sortOrder: a })
}
export function updateSettings(patch: Partial<HabitSettings>) {
  S.set((s) => ({ ...s, settings: { ...s.settings, ...patch } }))
}
export function createRoutine(
  input: Partial<Omit<Routine, "id" | "status" | "createdAt">> & {
    name: string
  },
): Routine {
  const r: Routine = {
    icon: "🌅",
    schedule: [{ days: [0, 1, 2, 3, 4, 5, 6] }],
    reminder: S.get().settings.defaultReminder,
    steps: [],
    ...input,
    id: uid(),
    status: "active",
    createdAt: dayKey(),
  }
  S.set((s) => ({ ...s, routines: [...s.routines, r] }))
  return r
}
export function updateRoutine(id: string, patch: Partial<Routine>) {
  S.set((s) => ({
    ...s,
    routines: s.routines.map((r) => (r.id === id ? { ...r, ...patch } : r)),
  }))
}
export const setRoutineSteps = (id: string, steps: RoutineStep[]) =>
  updateRoutine(id, { steps })
export const archiveRoutine = (id: string) =>
  updateRoutine(id, { status: "archived" })
export const restoreRoutine = (id: string) =>
  updateRoutine(id, { status: "active" })
export function deleteRoutine(id: string) {
  S.set((s) => ({
    ...s,
    routines: s.routines.filter((r) => r.id !== id),
    runs: s.runs.filter((r) => r.routineId !== id),
  }))
}
export function liveConflict(href: string): Live | null {
  const cur = liveStore.get().live
  return cur && cur.href !== href ? cur : null
}
export const timerHref = (habitId: string) => `/habits/${habitId}/timer`
export const playerHref = (routineId: string) =>
  `/habits/routines/${routineId}/play`
export function startTimer(habitId: string): boolean {
  const h = manual(habitId)
  if (!h) return false
  const ok = startLive({
    kind: "timer",
    label: `${h.icon} ${h.name}`,
    href: timerHref(habitId),
  })
  if (!ok) return false
  const cur = S.get().timer
  if (!cur || cur.habitId !== habitId)
    S.set((s) => ({
      ...s,
      timer: {
        habitId,
        day: dayKey(),
        targetSec:
          h.type === "duration" && h.target ? h.target * 60 : undefined,
      },
    }))
  return true
}
export function pauseLive() {
  liveStore.set((s) =>
    s.live && !s.live.pausedAt
      ? { live: { ...s.live, pausedAt: nowIso() } }
      : s,
  )
}
export function resumeLive() {
  liveStore.set((s) => {
    if (!s.live?.pausedAt) return s
    const paused = (Date.now() - new Date(s.live.pausedAt).getTime()) / 1000
    return {
      live: {
        ...s.live,
        pausedAt: undefined,
        pausedSec: (s.live.pausedSec ?? 0) + paused,
      },
    }
  })
}
export function extendTimer(sec: number) {
  S.set((s) =>
    s.timer
      ? {
          ...s,
          timer: { ...s.timer, targetSec: (s.timer.targetSec ?? 0) + sec },
        }
      : s,
  )
}
export function finishTimer(minutes: number): HabitLog | null {
  const t = S.get().timer
  if (!t) return null
  const log = logHabit({
    habitId: t.habitId,
    day: t.day,
    value: Math.max(1, Math.round(minutes)),
    source: "timer",
  })
  discardTimer()
  return log
}
export function discardTimer() {
  S.set((s) => ({ ...s, timer: null }))
  if (liveStore.get().live?.kind === "timer") stopLive()
}
const today = () => dayKey()
export const activeRun = (routineId: string) =>
  S.get().runs.find(
    (r) =>
      r.routineId === routineId &&
      r.day === today() &&
      r.state === "in_progress",
  )
function patchRun(id: string, patch: Partial<RoutineRun>) {
  S.set((s) => ({
    ...s,
    runs: s.runs.map((r) => (r.id === id ? { ...r, ...patch } : r)),
  }))
}
function liveLabel(r: Routine, run: RoutineRun) {
  const step = run.steps[run.current]
  const h = step && findHabit(step.habitId)
  return `${r.icon} ${r.name}${h ? ` · ${h.name}` : ""} (${Math.min(run.current + 1, run.steps.length)}/${run.steps.length})`
}
export function startRoutine(routineId: string): RoutineRun | null {
  const r = S.get().routines.find((x) => x.id === routineId)
  if (!r) return null
  let run = activeRun(routineId)
  const ok = startLive({
    kind: "routine",
    label: run ? liveLabel(r, run) : `${r.icon} ${r.name}`,
    href: playerHref(routineId),
  })
  if (!ok) return null
  if (!run) {
    const steps = r.steps.filter(
      (s) => findHabit(s.habitId)?.status !== "archived",
    )
    run = {
      id: uid(),
      routineId,
      day: today(),
      startedAt: nowIso(),
      steps,
      results: [],
      current: 0,
      stepStartedAt: nowIso(),
      stepPausedSec: 0,
      stepBonusSec: 0,
      state: "in_progress",
    }
    const created = run
    S.set((s) => ({ ...s, runs: [...s.runs, created] }))
    liveStore.set((s) =>
      s.live ? { live: { ...s.live, label: liveLabel(r, created) } } : s,
    )
  }
  return run
}
function advance(run: RoutineRun, status: "done" | "skipped") {
  const step = run.steps[run.current]
  if (!step) return
  const actualSec = status === "done" ? Math.round(stepElapsed(run)) : 0
  const results = [
    ...run.results.slice(0, run.current),
    { habitId: step.habitId, status, actualSec },
  ]
  const h = findHabit(step.habitId)
  const idx = logIndex(S.get().logs)
  const already = idx.get(lk(step.habitId, run.day))
  if (h && status === "done") {
    if (h.type === "duration")
      logHabit({
        habitId: h.id,
        day: run.day,
        value: Math.max(1, Math.round(actualSec / 60)),
        source: "routine",
      })
    else if (h.type === "count")
      logHabit({
        habitId: h.id,
        day: run.day,
        value: h.step ?? 1,
        add: true,
        source: "routine",
      })
    else
      logHabit({
        habitId: h.id,
        day: run.day,
        status: "done",
        source: "routine",
      })
  } else if (h && status === "skipped" && !already) {
    logHabit({
      habitId: h.id,
      day: run.day,
      status: "skipped",
      source: "routine",
    })
  }
  const next = run.current + 1
  const finished = next >= run.steps.length
  const patch: Partial<RoutineRun> = {
    results,
    current: next,
    stepStartedAt: nowIso(),
    stepPausedSec: 0,
    stepBonusSec: 0,
    pausedAt: undefined,
    ...(finished ? { state: "completed", endedAt: nowIso() } : {}),
  }
  patchRun(run.id, patch)
  const r = S.get().routines.find((x) => x.id === run.routineId)
  if (finished) {
    if (liveStore.get().live?.kind === "routine") stopLive()
  } else if (r) {
    const updated = { ...run, ...patch }
    liveStore.set((s) =>
      s.live
        ? {
            live: {
              ...s.live,
              label: liveLabel(r, updated),
              pausedAt: undefined,
            },
          }
        : s,
    )
  }
}
export const stepDone = (run: RoutineRun) => advance(run, "done")
export const stepSkip = (run: RoutineRun) => advance(run, "skipped")
export function stepContinue(run: RoutineRun) {
  const step = run.steps[run.current]
  if (!step) return
  const results = [
    ...run.results.slice(0, run.current),
    { habitId: step.habitId, status: "done" as const, actualSec: 0 },
  ]
  const next = run.current + 1
  const finished = next >= run.steps.length
  patchRun(run.id, {
    results,
    current: next,
    stepStartedAt: nowIso(),
    stepPausedSec: 0,
    stepBonusSec: 0,
    ...(finished ? { state: "completed", endedAt: nowIso() } : {}),
  })
  if (finished && liveStore.get().live?.kind === "routine") stopLive()
}
export function stepBack(run: RoutineRun) {
  if (run.current === 0) return
  patchRun(run.id, {
    current: run.current - 1,
    results: run.results.slice(0, run.current - 1),
    stepStartedAt: nowIso(),
    stepPausedSec: 0,
    stepBonusSec: 0,
    pausedAt: undefined,
  })
}
export const stepAddMinute = (run: RoutineRun) =>
  patchRun(run.id, { stepBonusSec: run.stepBonusSec + 60 })
export function toggleRunPause(run: RoutineRun) {
  if (run.pausedAt) {
    const paused = (Date.now() - new Date(run.pausedAt).getTime()) / 1000
    patchRun(run.id, {
      pausedAt: undefined,
      stepPausedSec: run.stepPausedSec + paused,
    })
    resumeLive()
  } else {
    patchRun(run.id, { pausedAt: nowIso() })
    pauseLive()
  }
}
/** Start over: today's run ends unfinished so the next start is at step
 * one. Habits its steps already logged stay logged. There is no undo (the
 * server can't reopen an ended run), so the screen asks first. */
export function resetRoutine(routineId: string): RoutineRun | null {
  const run = activeRun(routineId)
  if (!run) return null
  patchRun(run.id, {
    state: "abandoned",
    endedAt: nowIso(),
    pausedAt: undefined,
  })
  if (liveStore.get().live?.kind === "routine") stopLive()
  return run
}
export function exitRoutine() {
  if (liveStore.get().live?.kind === "routine") stopLive()
}
export function alreadyLogged(habitId: string, day = dayKey()) {
  const l = logIndex(S.get().logs).get(lk(habitId, day))
  return !!l && l.status === "done"
}
export { isDue, slotFor }
