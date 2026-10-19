// Habits & routines mappers: the prototype habits store against the server's
// habit, habit_pause, habit_log, routine, routine_step, routine_run,
// routine_step_result, habit_timer and habit_settings entities.
//
// Shapes the store nests are flattened into child rows: a habit's `pauses`
// become habit_pause rows, a routine's `steps` become routine_step rows (id
// derived from routine + position, as the server's own `step_id`), and a
// run's `results` are the server's routine_step_result rows (id derived from
// run + position, as the server's `_set_result`).
//
// Logs are field writes (the server's upsert reconciles on habit + day); the
// routine player and the habit timer are action-driven: their rows are never
// written, and each local transition becomes a `habits.run.*` or
// `habits.timer.*` action. The engine has no "actions only" mode, so the run
// and timer mappers own every field: the one empty create a new run or timer
// produces (and the delete when one disappears) is refused by the server as
// a read-only entity, which is logged and dropped.
//
// A child row pulled before its parent (a later page of the same pull) is
// held here and attached when the parent arrives; it is then pushed once as
// an unchanged write, which the server applies as a no-op edit.

import type {
  Habit,
  HabitLog,
  HabitSettings,
  HabitStatus,
  HabitsState,
  HabitType,
  LogSource,
  LogStatus,
  PauseRange,
  Routine,
  RoutineRun,
  RoutineStep,
  ScheduleSlot,
  StepResult,
} from "@domain/habits/data"
import { habitsStore } from "@domain/habits/store"
import { dayKey } from "@domain/lib/day"
import { derivedId } from "@domain/lib/ids"
import { type Live, liveStore } from "@domain/lib/live"
import type { Store } from "@domain/lib/store"
import type { ActionOp, Mapper } from "../mapper"
import { singleton } from "./helpers"

type S = HabitsState

// ---------------------------------------------------------------- shapes

const str = (v: unknown) => String(v)
const optStr = (v: unknown) => (v == null ? undefined : String(v))
const optNum = (v: unknown) => (v == null ? undefined : Number(v))

/** A business day as an instant (local noon), for `*_at` columns the store
 * keeps as a day. Noon survives any offset and the 04:00 day start. */
const dayToInstant = (day: string) => new Date(`${day}T12:00:00`).toISOString()
const instantToDay = (iso: unknown) => dayKey(new Date(String(iso)))

const scheduleOut = (slots: ScheduleSlot[]) =>
  slots.map((s) => ({
    days: [...s.days].sort((a, b) => a - b),
    ...(s.time ? { time: s.time } : {}),
    ...(s.window != null ? { window: s.window } : {}),
  }))

function scheduleIn(raw: unknown): ScheduleSlot[] {
  if (!Array.isArray(raw)) return []
  return raw.map((s: Record<string, unknown>) => ({
    days: Array.isArray(s.days) ? s.days.map(Number) : [],
    ...(s.time ? { time: String(s.time) } : {}),
    ...(s.window != null ? { window: Number(s.window) } : {}),
  }))
}

/** Children pulled before their parent, keyed by parent id. */
function orphans<T extends { id: string }>() {
  const byParent = new Map<string, Map<string, T>>()
  return {
    hold(parent: string, row: T) {
      const m = byParent.get(parent) ?? new Map<string, T>()
      m.set(row.id, row)
      byParent.set(parent, m)
    },
    drop(id: string) {
      for (const m of byParent.values()) m.delete(id)
    },
    take(parent: string): T[] {
      const m = byParent.get(parent)
      byParent.delete(parent)
      return m ? [...m.values()] : []
    },
  }
}

/** Upsert-by-id into a list, keeping order; new rows go last. */
function mergeById<T>(
  list: T[],
  ups: T[],
  dels: string[],
  id: (t: T) => string,
): T[] {
  const gone = new Set(dels)
  const map = new Map<string, T>()
  for (const t of list) if (!gone.has(id(t))) map.set(id(t), t)
  for (const u of ups) map.set(id(u), u)
  return [...map.values()]
}

// ---------------------------------------------------------------- habit

function habitMapper(
  held: ReturnType<typeof orphans<PauseRow>>,
): Mapper<S, Habit> {
  return {
    entity: "habit",
    store: habitsStore,
    list: (s) => s.habits,
    id: (h) => h.id,
    toServer: (h) => ({
      name: h.name,
      icon: h.icon,
      type: h.type,
      target: h.target ?? null,
      unit: h.unit ?? null,
      step: h.step ?? null,
      schedule: scheduleOut(h.schedule),
      reminder: h.reminder,
      status: h.status,
      link_workout: h.linkWorkout,
      archived_at: h.archivedAt ? dayToInstant(h.archivedAt) : null,
      sort_order: h.sortOrder,
    }),
    fromServer: (row, s) => {
      const id = str(row.id)
      const cur = s.habits.find((h) => h.id === id)
      return {
        id,
        name: str(row.name),
        icon: str(row.icon),
        type: str(row.type) as HabitType,
        target: optNum(row.target),
        unit: optStr(row.unit),
        step: optNum(row.step),
        schedule: scheduleIn(row.schedule),
        reminder: Boolean(row.reminder),
        status: str(row.status) as HabitStatus,
        pauses: cur?.pauses ?? [],
        linkWorkout: Boolean(row.link_workout),
        createdAt: row.created_at
          ? instantToDay(row.created_at)
          : (cur?.createdAt ?? dayKey()),
        archivedAt: row.archived_at ? instantToDay(row.archived_at) : undefined,
        sortOrder: Number(row.sort_order ?? 0),
      }
    },
    merge: (s, ups, dels) => {
      if (!ups.length && !dels.length) return s
      const known = new Set(s.habits.map((h) => h.id))
      const attached = ups.map((h) =>
        known.has(h.id)
          ? h
          : { ...h, pauses: [...h.pauses, ...held.take(h.id).map(toPause)] },
      )
      return { ...s, habits: mergeById(s.habits, attached, dels, (h) => h.id) }
    },
  }
}

// ---------------------------------------------------------------- pause

interface PauseRow {
  id: string
  habitId: string
  from: string
  to?: string
  reason?: string
}
/** A pause pulled from the server keeps its row id on the range object. */
type SyncedPause = PauseRange & { id?: string }

const pauseId = (habitId: string, p: SyncedPause) =>
  p.id ?? derivedId("habit-pause", habitId, p.from)

const toPause = (r: PauseRow): SyncedPause => ({
  id: r.id,
  from: r.from,
  ...(r.to ? { to: r.to } : {}),
  ...(r.reason ? { reason: r.reason } : {}),
})

function pauseMapper(
  held: ReturnType<typeof orphans<PauseRow>>,
): Mapper<S, PauseRow> {
  return {
    entity: "habit_pause",
    store: habitsStore,
    list: (s) =>
      s.habits.flatMap((h) =>
        h.pauses.map((p: SyncedPause) => ({
          id: pauseId(h.id, p),
          habitId: h.id,
          from: p.from,
          to: p.to,
          reason: p.reason,
        })),
      ),
    id: (p) => p.id,
    toServer: (p) => ({
      habit_id: p.habitId,
      from_day: p.from,
      to_day: p.to ?? null,
      reason: p.reason ?? null,
    }),
    fromServer: (row, s) => {
      const p: PauseRow = {
        id: str(row.id),
        habitId: str(row.habit_id),
        from: str(row.from_day),
        to: optStr(row.to_day),
        reason: optStr(row.reason),
      }
      if (s.habits.some((h) => h.id === p.habitId)) return p
      held.hold(p.habitId, p)
      return null
    },
    merge: (s, ups, dels) => {
      if (!ups.length && !dels.length) return s
      for (const d of dels) held.drop(d)
      const gone = new Set(dels)
      return {
        ...s,
        habits: s.habits.map((h) => {
          const mine = ups.filter((u) => u.habitId === h.id)
          const touched =
            mine.length || h.pauses.some((p) => gone.has(pauseId(h.id, p)))
          if (!touched) return h
          const pauses = mergeById<SyncedPause>(
            h.pauses,
            mine.map(toPause),
            dels,
            (p) => pauseId(h.id, p),
          )
          return { ...h, pauses }
        }),
      }
    },
  }
}

// ---------------------------------------------------------------- log

function logMapper(): Mapper<S, HabitLog> {
  return {
    entity: "habit_log",
    store: habitsStore,
    list: (s) => s.logs,
    id: (l) => l.id,
    toServer: (l) => ({
      habit_id: l.habitId,
      day: l.day,
      status: l.status,
      value: l.value ?? null,
      logged_at: l.loggedAt,
      source: l.source,
      note: l.note ?? null,
    }),
    fromServer: (row) => ({
      id: str(row.id),
      habitId: str(row.habit_id),
      day: str(row.day),
      status: str(row.status) as LogStatus,
      value: optNum(row.value),
      loggedAt: str(row.logged_at),
      source: str(row.source) as LogSource,
      note: optStr(row.note),
    }),
    // One log per habit and day: a pulled row replaces a local row holding
    // the same day under another id (the server's id wins).
    merge: (s, ups, dels) => {
      if (!ups.length && !dels.length) return s
      const key = (l: HabitLog) => `${l.habitId}|${l.day}`
      const pulled = new Map(ups.map((u) => [key(u), u.id]))
      const kept = s.logs.filter((l) => {
        const winner = pulled.get(key(l))
        return winner === undefined || winner === l.id
      })
      return { ...s, logs: mergeById(kept, ups, dels, (l) => l.id) }
    },
  }
}

// ---------------------------------------------------------------- routine

function routineMapper(
  held: ReturnType<typeof orphans<StepRow>>,
): Mapper<S, Routine> {
  return {
    entity: "routine",
    store: habitsStore,
    list: (s) => s.routines,
    id: (r) => r.id,
    toServer: (r) => ({
      name: r.name,
      icon: r.icon,
      schedule: scheduleOut(r.schedule),
      reminder: r.reminder,
      status: r.status,
    }),
    fromServer: (row, s) => {
      const id = str(row.id)
      const cur = s.routines.find((r) => r.id === id)
      return {
        id,
        name: str(row.name),
        icon: str(row.icon),
        schedule: scheduleIn(row.schedule),
        reminder: Boolean(row.reminder),
        steps: cur?.steps ?? [],
        status: row.status === "archived" ? "archived" : "active",
        createdAt: row.created_at
          ? instantToDay(row.created_at)
          : (cur?.createdAt ?? dayKey()),
      }
    },
    merge: (s, ups, dels) => {
      if (!ups.length && !dels.length) return s
      const known = new Set(s.routines.map((r) => r.id))
      const attached = ups.map((r) =>
        known.has(r.id) ? r : { ...r, steps: placeSteps([], held.take(r.id)) },
      )
      return {
        ...s,
        routines: mergeById(s.routines, attached, dels, (r) => r.id),
        // a deleted routine takes its runs with it, as on the server
        runs: dels.length
          ? s.runs.filter((run) => !dels.includes(run.routineId))
          : s.runs,
      }
    },
  }
}

// ---------------------------------------------------------------- step

interface StepRow {
  id: string
  routineId: string
  habitId: string
  position: number
  minutes: number
}

const stepId = (routineId: string, position: number) =>
  derivedId("routine-step", routineId, String(position))

/** Lay pulled steps onto a step list by position (gaps close up). */
function placeSteps(steps: RoutineStep[], rows: StepRow[]): RoutineStep[] {
  const slots: (RoutineStep | undefined)[] = [...steps]
  for (const r of rows)
    slots[r.position] = { habitId: r.habitId, minutes: r.minutes }
  return slots.filter((x): x is RoutineStep => x !== undefined)
}

function stepMapper(
  held: ReturnType<typeof orphans<StepRow>>,
): Mapper<S, StepRow> {
  return {
    entity: "routine_step",
    store: habitsStore,
    list: (s) =>
      s.routines.flatMap((r) =>
        r.steps.map((st, i) => ({
          id: stepId(r.id, i),
          routineId: r.id,
          habitId: st.habitId,
          position: i,
          minutes: st.minutes,
        })),
      ),
    id: (st) => st.id,
    toServer: (st) => ({
      routine_id: st.routineId,
      habit_id: st.habitId,
      position: st.position,
      minutes: st.minutes,
    }),
    fromServer: (row, s) => {
      const st: StepRow = {
        id: str(row.id),
        routineId: str(row.routine_id),
        habitId: str(row.habit_id),
        position: Number(row.position),
        minutes: Number(row.minutes),
      }
      if (s.routines.some((r) => r.id === st.routineId)) return st
      held.hold(st.routineId, st)
      return null
    },
    merge: (s, ups, dels) => {
      if (!ups.length && !dels.length) return s
      for (const d of dels) held.drop(d)
      const gone = new Set(dels)
      return {
        ...s,
        routines: s.routines.map((r) => {
          const mine = ups.filter((u) => u.routineId === r.id)
          const slots: (RoutineStep | undefined)[] = r.steps.map((st, i) =>
            gone.has(stepId(r.id, i)) ? undefined : st,
          )
          if (!mine.length && !slots.includes(undefined)) return r
          // positions index the list before any removal; gaps close up
          for (const u of mine)
            slots[u.position] = { habitId: u.habitId, minutes: u.minutes }
          return {
            ...r,
            steps: slots.filter((x): x is RoutineStep => x !== undefined),
          }
        }),
      }
    },
  }
}

// ---------------------------------------------------------------- run

const RUN_FIELDS = [
  "routine_id",
  "day",
  "started_at",
  "ended_at",
  "steps",
  "current",
  "step_started_at",
  "step_paused_sec",
  "step_bonus_sec",
  "paused_at",
  "state",
] as const

/** The `habits.run.*` actions one local run transition stands for. */
export function runActions(
  prev: RoutineRun | undefined,
  next: RoutineRun | undefined,
): ActionOp[] {
  if (!next) return [] // a removed run goes with its routine's delete
  const run_id = next.id
  const out: ActionOp[] = []
  const was = prev ?? {
    current: 0,
    pausedAt: undefined,
    stepBonusSec: 0,
  }
  if (!prev)
    out.push({
      name: "habits.run.start",
      data: { routine_id: next.routineId, run_id },
    })
  if (next.current > was.current) {
    for (let i = was.current; i < next.current; i++) {
      const r = next.results[i]
      const verb =
        r?.status === "skipped"
          ? "skip"
          : r && r.actualSec > 0
            ? "done"
            : "continue" // done with no time: the habit was already logged
      out.push({ name: `habits.run.${verb}`, data: { run_id } })
    }
    return out
  }
  for (let i = next.current; i < was.current; i++)
    out.push({ name: "habits.run.back", data: { run_id } })
  if (next.current !== was.current) return out
  if (!!was.pausedAt !== !!next.pausedAt)
    out.push({ name: "habits.run.toggle_pause", data: { run_id } })
  const minutes = Math.round((next.stepBonusSec - was.stepBonusSec) / 60)
  for (let i = 0; i < minutes; i++)
    out.push({ name: "habits.run.add_minute", data: { run_id } })
  return out
}

function runMapper(
  held: ReturnType<typeof orphans<ResultRow>>,
): Mapper<S, RoutineRun> {
  return {
    entity: "routine_run",
    store: habitsStore,
    list: (s) => s.runs,
    id: (r) => r.id,
    toServer: (r) => ({
      routine_id: r.routineId,
      day: r.day,
      started_at: r.startedAt,
      ended_at: r.endedAt ?? null,
      steps: r.steps.map((st) => ({
        habit_id: st.habitId,
        minutes: st.minutes,
      })),
      current: r.current,
      step_started_at: r.stepStartedAt,
      step_paused_sec: r.stepPausedSec,
      step_bonus_sec: r.stepBonusSec,
      paused_at: r.pausedAt ?? null,
      state: r.state,
    }),
    fromServer: (row, s) => {
      const id = str(row.id)
      const cur = s.runs.find((r) => r.id === id)
      const steps = Array.isArray(row.steps)
        ? row.steps.map((st: Record<string, unknown>) => ({
            habitId: str(st.habit_id),
            minutes: Number(st.minutes),
          }))
        : []
      return {
        id,
        routineId: str(row.routine_id),
        day: str(row.day),
        startedAt: str(row.started_at),
        endedAt: optStr(row.ended_at),
        steps,
        results: cur?.results ?? [],
        current: Number(row.current ?? 0),
        stepStartedAt: str(row.step_started_at),
        stepPausedSec: Number(row.step_paused_sec ?? 0),
        stepBonusSec: Number(row.step_bonus_sec ?? 0),
        pausedAt: optStr(row.paused_at),
        state: str(row.state) as RoutineRun["state"],
      }
    },
    merge: (s, ups, dels) => {
      if (!ups.length && !dels.length) return s
      const known = new Set(s.runs.map((r) => r.id))
      const attached = ups.map((r) =>
        known.has(r.id)
          ? r
          : { ...r, results: placeResults([], held.take(r.id)) },
      )
      return { ...s, runs: mergeById(s.runs, attached, dels, (r) => r.id) }
    },
    actionFields: RUN_FIELDS,
    actions: (prev, next) => runActions(prev, next),
  }
}

// ---------------------------------------------------------------- results

interface ResultRow {
  id: string
  runId: string
  position: number
  habitId: string
  status: StepResult["status"]
  actualSec: number
}

const resultId = (runId: string, position: number) =>
  derivedId("run-step", runId, String(position))

function placeResults(results: StepResult[], rows: ResultRow[]) {
  const slots: (StepResult | undefined)[] = [...results]
  for (const r of rows)
    slots[r.position] = {
      habitId: r.habitId,
      status: r.status,
      actualSec: r.actualSec,
    }
  return slots.filter((x): x is StepResult => x !== undefined)
}

function resultMapper(
  held: ReturnType<typeof orphans<ResultRow>>,
): Mapper<S, ResultRow> {
  return {
    entity: "routine_step_result",
    store: habitsStore,
    readOnly: true,
    list: (s) =>
      s.runs.flatMap((run) =>
        run.results.map((r, i) => ({
          id: resultId(run.id, i),
          runId: run.id,
          position: i,
          ...r,
        })),
      ),
    id: (r) => r.id,
    toServer: (r) => ({
      run_id: r.runId,
      position: r.position,
      habit_id: r.habitId,
      status: r.status,
      actual_sec: r.actualSec,
    }),
    fromServer: (row, s) => {
      const r: ResultRow = {
        id: str(row.id),
        runId: str(row.run_id),
        position: Number(row.position),
        habitId: str(row.habit_id),
        status: str(row.status) as StepResult["status"],
        actualSec: Number(row.actual_sec ?? 0),
      }
      if (s.runs.some((run) => run.id === r.runId)) return r
      held.hold(r.runId, r)
      return null
    },
    merge: (s, ups, dels) => {
      if (!ups.length && !dels.length) return s
      for (const d of dels) held.drop(d)
      const gone = new Set(dels)
      return {
        ...s,
        runs: s.runs.map((run) => {
          const mine = ups.filter((u) => u.runId === run.id)
          const slots: (StepResult | undefined)[] = run.results.map((r, i) =>
            gone.has(resultId(run.id, i)) ? undefined : r,
          )
          if (!mine.length && !slots.includes(undefined)) return run
          for (const u of mine)
            slots[u.position] = {
              habitId: u.habitId,
              status: u.status,
              actualSec: u.actualSec,
            }
          return {
            ...run,
            results: slots.filter((x): x is StepResult => x !== undefined),
          }
        }),
      }
    },
  }
}

// ---------------------------------------------------------------- timer

/** The habits store plus the Live bar, which holds the timer's pause. */
export interface TimerView {
  habits: S
  live: Live | null
}

function timerView(): Store<TimerView> {
  let cache: TimerView | null = null
  const get = (): TimerView => {
    const habits = habitsStore.get()
    const live = liveStore.get().live
    if (!cache || cache.habits !== habits || cache.live !== live)
      cache = { habits, live }
    return cache
  }
  return {
    get,
    set: (next) => {
      const cur = get()
      const v = typeof next === "function" ? next(cur) : next
      if (v.habits !== cur.habits) habitsStore.set(v.habits)
      if (v.live !== cur.live) liveStore.set({ live: v.live })
    },
    use: () => {
      throw new Error("timerView is the sync engine's view, not a UI store")
    },
    reset: () => {
      habitsStore.reset()
      liveStore.reset()
    },
    flush: () => {
      const a = habitsStore.flush()
      const b = liveStore.flush()
      return a && b
    },
    subscribe: (l) => {
      const a = habitsStore.subscribe(l)
      const b = liveStore.subscribe(l)
      return () => {
        a()
        b()
      }
    },
  }
}

interface TimerRow {
  id: string
  habitId: string
  day: string
  targetSec?: number
  paused: boolean
  /** The habit's log for the timer's day when this row was read: finishing
   * the timer is the only way a timer-sourced log appears with it. */
  logAt?: string
}

const TIMER_FIELDS = ["habit_id", "day", "target_sec"] as const
const MAX_EXTEND_SEC = 7200

const logFor = (s: S, habitId: string, day: string) =>
  s.logs.find((l) => l.habitId === habitId && l.day === day)

/** The `habits.timer.*` actions one local timer transition stands for. */
export function timerActions(
  prev: TimerRow | undefined,
  next: TimerRow | undefined,
  view: TimerView,
): ActionOp[] {
  const out: ActionOp[] = []
  if (prev && !next) {
    const log = logFor(view.habits, prev.habitId, prev.day)
    const finished =
      log?.source === "timer" &&
      log.value != null &&
      log.loggedAt !== prev.logAt
    out.push(
      finished
        ? { name: "habits.timer.finish", data: { minutes: log.value } }
        : { name: "habits.timer.discard", data: {} },
    )
    return out
  }
  if (!next) return out
  let base = prev?.targetSec ?? 0
  let paused = prev?.paused ?? false
  if (!prev || prev.habitId !== next.habitId) {
    out.push({ name: "habits.timer.start", data: { habit_id: next.habitId } })
    const h = view.habits.habits.find((x) => x.id === next.habitId)
    base = h?.type === "duration" && h.target ? h.target * 60 : 0
    paused = false
  }
  let extra = (next.targetSec ?? 0) - base
  while (extra > 0) {
    const sec = Math.min(extra, MAX_EXTEND_SEC)
    out.push({ name: "habits.timer.extend", data: { sec } })
    extra -= sec
  }
  if (paused !== next.paused)
    out.push({
      name: next.paused ? "habits.timer.pause" : "habits.timer.resume",
      data: {},
    })
  return out
}

function timerMapper(userId: string): Mapper<TimerView, TimerRow> {
  // At most one timer per user: the device names it with one stable id.
  const id = derivedId("habit-timer", userId, "timer")
  return {
    entity: "habit_timer",
    store: timerView(),
    list: (v) => {
      const t = v.habits.timer
      if (!t) return []
      return [
        {
          id,
          habitId: t.habitId,
          day: t.day,
          targetSec: t.targetSec,
          paused: v.live?.kind === "timer" && !!v.live.pausedAt,
          logAt: logFor(v.habits, t.habitId, t.day)?.loggedAt,
        },
      ]
    },
    id: (t) => t.id,
    toServer: (t) => ({
      habit_id: t.habitId,
      day: t.day,
      target_sec: t.targetSec ?? null,
    }),
    fromServer: (row, v) => {
      const habitId = str(row.habit_id)
      const day = str(row.day)
      return {
        id,
        habitId,
        day,
        targetSec: optNum(row.target_sec),
        paused: row.paused_at != null,
        logAt: logFor(v.habits, habitId, day)?.loggedAt,
      }
    },
    // A delete of the user's timer row ends the local timer.
    merge: (v, ups, dels) => {
      const last = ups.at(-1)
      if (last) {
        const timer = {
          habitId: last.habitId,
          day: last.day,
          ...(last.targetSec != null ? { targetSec: last.targetSec } : {}),
        }
        return { ...v, habits: { ...v.habits, timer } }
      }
      if (dels.length && v.habits.timer)
        return { ...v, habits: { ...v.habits, timer: null } }
      return v
    },
    actionFields: TIMER_FIELDS,
    actions: timerActions,
  }
}

// ---------------------------------------------------------------- settings

function settingsMapper(userId: string) {
  return singleton<S, HabitSettings>({
    entity: "habit_settings",
    userId,
    store: habitsStore,
    read: (s) => s.settings,
    write: (s, settings) => ({ ...s, settings }),
    toServer: (v) => ({
      week_start: v.weekStart,
      default_reminder: v.defaultReminder,
      streak_nudge: v.streakNudge,
    }),
    fromServer: (row, cur) => ({
      ...cur,
      weekStart: Number(row.week_start) === 0 ? 0 : 1,
      defaultReminder: Boolean(row.default_reminder),
      streakNudge: Boolean(row.streak_nudge),
    }),
  })
}

// ---------------------------------------------------------------- factory

/** Parents before children: a create pushes, and a pull merges, in order. */
export function habitsMappers(userId: string) {
  const pauses = orphans<PauseRow>()
  const steps = orphans<StepRow>()
  const results = orphans<ResultRow>()
  return [
    habitMapper(pauses),
    pauseMapper(pauses),
    logMapper(),
    routineMapper(steps),
    stepMapper(steps),
    runMapper(results),
    resultMapper(results),
    timerMapper(userId),
    settingsMapper(userId),
  ]
}
