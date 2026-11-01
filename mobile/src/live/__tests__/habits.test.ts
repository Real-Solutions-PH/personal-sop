import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  autoCheckWorkoutHabits,
  checkHabit,
  clearLog,
  createHabit,
  createRoutine,
  deleteHabit,
  discardTimer,
  exitRoutine,
  extendTimer,
  finishTimer,
  incrementCount,
  pauseHabit,
  pauseLive,
  resumeHabit,
  resumeLive,
  setRoutineSteps,
  skipHabit,
  startRoutine,
  startTimer,
  stepAddMinute,
  stepBack,
  stepDone,
  stepSkip,
  toggleRunPause,
  updateHabit,
  updateSettings,
} from "@domain/habits/actions"
import { type HabitsState, seedHabits } from "@domain/habits/data"
import { habitsStore } from "@domain/habits/store"
import { dayKey } from "@domain/lib/day"
import { derivedId } from "@domain/lib/ids"
import { liveStore, stopLive } from "@domain/lib/live"
import type { StorageAdapter } from "@domain/lib/store"
import { SyncEngine } from "../engine"
import type { Http } from "../http"
import type { AnyMapper, Payload } from "../mapper"
import { habitsMappers, runActions } from "../mappers/habits"
import { createOutbox, type SyncOp } from "../outbox"

const USER = "00000000-0000-4000-8000-000000000001"

function memoryStorage(): StorageAdapter {
  const m = new Map<string, string>()
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  }
}

const noHttp: Http = {
  request: async () => {
    throw new Error("unused")
  },
  raw: async () => {
    throw new Error("unused")
  },
}

const blank = (): HabitsState => ({
  ...seedHabits(),
  habits: [],
  logs: [],
  routines: [],
  runs: [],
  timer: null,
})

function engine() {
  const storage = memoryStorage()
  return new SyncEngine({
    http: noHttp,
    storage,
    outbox: createOutbox(storage),
    mappers: habitsMappers(USER),
    online: () => false,
  })
}

/** An engine that has already sent what the store holds. */
function engineAfterSetup() {
  const e = engine()
  record(e.capture())
  return e
}

const byName = (name: string) =>
  habitsMappers(USER).find((m) => m.entity === name) as AnyMapper

const noon = (day: string) => new Date(`${day}T12:00:00`).toISOString()

// Every op the diff tests produce, for the backend's wire-format check.
const wire: (SyncOp & { create?: boolean })[] = []
const seen = new Set<string>()
function record(ops: SyncOp[]) {
  for (const op of ops) {
    const key = `${op.name}:${op.id}`
    const create = op.kind === "upsert" && !seen.has(key)
    if (op.kind === "upsert") seen.add(key)
    wire.push({ ...op, ...(op.kind === "upsert" ? { create } : {}) })
  }
  return ops
}
const shape = (ops: SyncOp[]) =>
  ops.map((o) =>
    o.kind === "delete"
      ? { kind: o.kind, name: o.name }
      : { kind: o.kind, name: o.name, data: o.data },
  )

/** JSON laid out as Biome formats it: objects expanded, primitive arrays
 * inline when they fit the line. */
function biomeJson(v: unknown, indent = ""): string {
  const inner = `${indent}  `
  if (Array.isArray(v)) {
    if (!v.length) return "[]"
    if (v.every((x) => x === null || typeof x !== "object")) {
      const flat = `[${v.map((x) => JSON.stringify(x)).join(", ")}]`
      if (indent.length + flat.length <= 60) return flat
    }
    return `[\n${v.map((x) => inner + biomeJson(x, inner)).join(",\n")}\n${indent}]`
  }
  if (v && typeof v === "object") {
    const entries = Object.entries(v).filter(([, x]) => x !== undefined)
    if (!entries.length) return "{}"
    const body = entries
      .map(([k, x]) => `${inner}${JSON.stringify(k)}: ${biomeJson(x, inner)}`)
      .join(",\n")
    return `{\n${body}\n${indent}}`
  }
  return JSON.stringify(v)
}

// A frozen clock and counted ids keep the fixture byte-stable across runs.
let ids = 0
beforeAll(() => {
  jest.useFakeTimers({ now: new Date("2026-10-19T09:00:00") })
  jest
    .spyOn(globalThis.crypto, "randomUUID")
    .mockImplementation(
      () =>
        `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}` as ReturnType<
          Crypto["randomUUID"]
        >,
    )
})

afterAll(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
  const dir = join(__dirname, "fixtures")
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, "habits-wire.json"),
    `${biomeJson(wire.map(({ op_id: _o, ...rest }) => rest))}\n`,
  )
})

beforeEach(() => {
  habitsStore.set(blank())
  stopLive()
})

// ---------------------------------------------------------------- round trip

describe("round trip from the seed", () => {
  const seed = seedHabits()
  // A server row: the device's payload plus the columns only the server sets.
  const serverRow = (m: AnyMapper, local: unknown, extra: Payload = {}) => ({
    id: m.id(local),
    ...m.toServer(local, seed),
    version: 1,
    ...extra,
  })

  test("habit", () => {
    const m = byName("habit")
    for (const h of seed.habits)
      expect(
        m.fromServer(serverRow(m, h, { created_at: noon(h.createdAt) }), seed),
      ).toEqual(h)
    const archived = { ...seed.habits[0], archivedAt: "2026-10-01" }
    expect(
      m.fromServer(
        serverRow(m, archived, { created_at: noon(archived.createdAt) }),
        seed,
      ),
    ).toEqual(archived)
  })

  test("habit_pause, habit_log, routine_step, routine_step_result", () => {
    for (const name of [
      "habit_pause",
      "habit_log",
      "routine_step",
      "routine_step_result",
    ]) {
      const m = byName(name)
      const rows = m.list(seed)
      expect(rows.length).toBeGreaterThan(0)
      for (const l of rows)
        expect(m.fromServer(serverRow(m, l), seed)).toEqual(l)
    }
  })

  test("routine and routine_run", () => {
    const routine = byName("routine")
    for (const r of seed.routines)
      expect(
        routine.fromServer(
          serverRow(routine, r, { created_at: noon(r.createdAt) }),
          seed,
        ),
      ).toEqual(r)
    const run = byName("routine_run")
    expect(seed.runs.length).toBeGreaterThan(0)
    for (const r of seed.runs)
      expect(run.fromServer(serverRow(run, r), seed)).toEqual(r)
  })

  test("habit_timer and habit_settings", () => {
    const withTimer: HabitsState = {
      ...seed,
      timer: { habitId: "h-meditate", day: dayKey(), targetSec: 600 },
    }
    const view = { habits: withTimer, live: null }
    const timer = byName("habit_timer")
    const [t] = timer.list(view)
    expect(
      timer.fromServer(
        { id: "server-id", ...timer.toServer(t, view), paused_at: null },
        view,
      ),
    ).toEqual(t)
    const settings = byName("habit_settings")
    const [row] = settings.list(seed)
    expect(settings.fromServer(settings.toServer(row, seed), seed)).toEqual(row)
  })
})

// ---------------------------------------------------------------- diffs

describe("diffs on store edits", () => {
  test("habit: create, single-field edit, pause, resume, delete", () => {
    const e = engineAfterSetup()
    const h = createHabit({ name: "Stretch", type: "duration", target: 15 })
    const created = record(e.capture())
    expect(shape(created)).toEqual([
      {
        kind: "upsert",
        name: "habit",
        data: {
          name: "Stretch",
          icon: "✅",
          type: "duration",
          target: 15,
          unit: null,
          step: null,
          schedule: [{ days: [0, 1, 2, 3, 4, 5, 6] }],
          reminder: true,
          nag_every_min: null,
          status: "active",
          link_workout: false,
          archived_at: null,
          sort_order: 1,
          rule_kind: null,
          rule_group_id: null,
          rule_max_min: null,
        },
      },
    ])
    expect(created[0].id).toBe(h.id)

    updateHabit(h.id, { name: "Stretch 15m" })
    expect(shape(record(e.capture()))).toEqual([
      { kind: "upsert", name: "habit", data: { name: "Stretch 15m" } },
    ])

    pauseHabit(h.id, undefined, "Travel")
    const paused = record(e.capture())
    expect(shape(paused)).toEqual([
      { kind: "upsert", name: "habit", data: { status: "paused" } },
      {
        kind: "upsert",
        name: "habit_pause",
        data: {
          habit_id: h.id,
          from_day: dayKey(),
          to_day: null,
          reason: "Travel",
        },
      },
    ])
    expect(paused[1].id).toBe(derivedId("habit-pause", h.id, dayKey()))

    // a pause that started today is removed entirely on resume
    resumeHabit(h.id)
    expect(shape(record(e.capture()))).toEqual([
      { kind: "upsert", name: "habit", data: { status: "active" } },
      { kind: "delete", name: "habit_pause" },
    ])

    deleteHabit(h.id)
    expect(shape(record(e.capture()))).toEqual([
      { kind: "delete", name: "habit" },
    ])
  })

  test("habit_log: check, increment, skip and clear are field writes", () => {
    const water = createHabit({
      name: "Water",
      type: "count",
      target: 8,
      step: 1,
    })
    const e = engineAfterSetup()
    incrementCount(water.id)
    const [log] = record(e.capture())
    expect(log).toMatchObject({
      kind: "upsert",
      name: "habit_log",
      data: {
        habit_id: water.id,
        day: dayKey(),
        status: "partial",
        value: 1,
        source: "tap",
        note: null,
      },
    })
    incrementCount(water.id, 7)
    const [inc] = record(e.capture())
    // only what changed: logged_at too, unless both writes share a millisecond
    expect(
      Object.keys(inc.data ?? {}).filter(
        (k) => !["logged_at", "status", "value"].includes(k),
      ),
    ).toEqual([])
    expect(inc.data).toMatchObject({ status: "done", value: 8 })
    skipHabit(water.id, undefined, "Out all day")
    expect(record(e.capture())[0].data).toMatchObject({
      status: "skipped",
      value: null,
      note: "Out all day",
    })
    checkHabit(water.id)
    expect(record(e.capture())[0].data).toMatchObject({
      status: "done",
      value: 8,
    })
    clearLog(water.id)
    expect(shape(record(e.capture()))).toEqual([
      { kind: "delete", name: "habit_log" },
    ])
  })

  test("routine steps are position rows with the server's ids", () => {
    const a = createHabit({ name: "A" })
    const b = createHabit({ name: "B", type: "duration", target: 5 })
    const e = engineAfterSetup()
    const r = createRoutine({
      name: "Morning",
      steps: [
        { habitId: a.id, minutes: 2 },
        { habitId: b.id, minutes: 5 },
      ],
    })
    const ops = record(e.capture())
    expect(shape(ops)).toEqual([
      {
        kind: "upsert",
        name: "routine",
        data: {
          name: "Morning",
          icon: "🌅",
          schedule: [{ days: [0, 1, 2, 3, 4, 5, 6] }],
          reminder: true,
          status: "active",
        },
      },
      {
        kind: "upsert",
        name: "routine_step",
        data: { routine_id: r.id, habit_id: a.id, position: 0, minutes: 2 },
      },
      {
        kind: "upsert",
        name: "routine_step",
        data: { routine_id: r.id, habit_id: b.id, position: 1, minutes: 5 },
      },
    ])
    expect(ops[2].id).toBe(derivedId("routine-step", r.id, "1"))
    // swapping the steps edits only the moved habit ids; dropping one deletes
    setRoutineSteps(r.id, [
      { habitId: b.id, minutes: 5 },
      { habitId: a.id, minutes: 2 },
    ])
    expect(shape(record(e.capture()))).toEqual([
      {
        kind: "upsert",
        name: "routine_step",
        data: { habit_id: b.id, minutes: 5 },
      },
      {
        kind: "upsert",
        name: "routine_step",
        data: { habit_id: a.id, minutes: 2 },
      },
    ])
    setRoutineSteps(r.id, [{ habitId: b.id, minutes: 5 }])
    expect(shape(record(e.capture()))).toEqual([
      { kind: "delete", name: "routine_step" },
    ])
  })

  test("the routine player sends actions first and never writes the run", () => {
    const a = createHabit({ name: "Water", type: "count", target: 8, step: 1 })
    const b = createHabit({ name: "Read" })
    const c = createHabit({ name: "Journal" })
    const r = createRoutine({
      name: "Morning",
      steps: [
        { habitId: a.id, minutes: 2 },
        { habitId: b.id, minutes: 10 },
        { habitId: c.id, minutes: 5 },
      ],
    })
    const e = engineAfterSetup()
    const run = startRoutine(r.id)
    if (!run) throw new Error("no run")
    const started = record(e.capture())
    expect(shape(started)).toEqual([
      {
        kind: "action",
        name: "habits.run.start",
        data: { routine_id: r.id, run_id: run.id },
      },
      // the run's own row is read-only: its create carries no field
      { kind: "upsert", name: "routine_run", data: {} },
    ])
    const cur = () => habitsStore.get().runs.find((x) => x.id === run.id)
    const tick = (fn: () => void) => {
      fn()
      return record(e.capture())
    }
    const added = tick(() => stepAddMinute(cur()!))
    expect(shape(added)).toEqual([
      {
        kind: "action",
        name: "habits.run.add_minute",
        data: { run_id: run.id },
      },
    ])
    expect(shape(tick(() => toggleRunPause(cur()!)))).toEqual([
      {
        kind: "action",
        name: "habits.run.toggle_pause",
        data: { run_id: run.id },
      },
    ])
    expect(shape(tick(() => toggleRunPause(cur()!)))).toEqual([
      {
        kind: "action",
        name: "habits.run.toggle_pause",
        data: { run_id: run.id },
      },
    ])
    // the step's clock must read at least one second for a timed "done"
    habitsStore.set((s) => ({
      ...s,
      runs: s.runs.map((x) =>
        x.id === run.id
          ? { ...x, stepStartedAt: new Date(Date.now() - 90_000).toISOString() }
          : x,
      ),
    }))
    e.capture()
    const done = tick(() => stepDone(cur()!))
    expect(done.map((o) => [o.kind, o.name])).toEqual([
      ["action", "habits.run.done"],
      ["upsert", "habit_log"],
    ])
    expect(shape(tick(() => stepBack(cur()!)))).toEqual([
      { kind: "action", name: "habits.run.back", data: { run_id: run.id } },
    ])
    habitsStore.set((s) => ({
      ...s,
      runs: s.runs.map((x) =>
        x.id === run.id
          ? { ...x, stepStartedAt: new Date(Date.now() - 90_000).toISOString() }
          : x,
      ),
    }))
    e.capture()
    // the habit is already logged: the log edit rides along with "done"
    expect(tick(() => stepDone(cur()!)).map((o) => o.name)).toEqual([
      "habits.run.done",
      "habit_log",
    ])
    const skipped = tick(() => stepSkip(cur()!))
    expect(skipped.map((o) => [o.kind, o.name])).toEqual([
      ["action", "habits.run.skip"],
      ["upsert", "habit_log"],
    ])
    expect(skipped[1].data).toMatchObject({ status: "skipped", value: null })
    expect(cur()?.current).toBe(2)
  })

  test("several step transitions inside one capture keep their order", () => {
    const base = {
      id: "run-1",
      routineId: "r",
      day: "2026-10-19",
      startedAt: "x",
      steps: [
        { habitId: "a", minutes: 1 },
        { habitId: "b", minutes: 1 },
        { habitId: "c", minutes: 1 },
      ],
      results: [],
      current: 0,
      stepStartedAt: "x",
      stepPausedSec: 0,
      stepBonusSec: 0,
      state: "in_progress" as const,
    }
    const next = {
      ...base,
      current: 3,
      results: [
        { habitId: "a", status: "done" as const, actualSec: 70 },
        { habitId: "b", status: "skipped" as const, actualSec: 0 },
        { habitId: "c", status: "done" as const, actualSec: 0 },
      ],
      state: "completed" as const,
    }
    expect(runActions(base, next).map((a) => a.name)).toEqual([
      "habits.run.done",
      "habits.run.skip",
      "habits.run.continue",
    ])
    expect(runActions(undefined, next).map((a) => a.name)).toEqual([
      "habits.run.start",
      "habits.run.done",
      "habits.run.skip",
      "habits.run.continue",
    ])
  })

  test("leaving the player mid-run sends exit; coming back sends start", () => {
    const a = createHabit({ name: "Water" })
    const b = createHabit({ name: "Read" })
    const r = createRoutine({
      name: "Morning",
      steps: [
        { habitId: a.id, minutes: 2 },
        { habitId: b.id, minutes: 5 },
      ],
    })
    const e = engineAfterSetup()
    const run = startRoutine(r.id)
    if (!run) throw new Error("no run")
    record(e.capture())
    // exitRoutine: only the Live bar changes, the run stays in progress.
    exitRoutine()
    expect(shape(record(e.capture()))).toEqual([
      { kind: "action", name: "habits.run.exit", data: { run_id: run.id } },
    ])
    expect(shape(record(e.capture()))).toEqual([])
    startRoutine(r.id)
    expect(shape(record(e.capture()))).toEqual([
      {
        kind: "action",
        name: "habits.run.start",
        data: { routine_id: r.id, run_id: run.id },
      },
    ])
  })

  test("a run that completes releases the Live bar without an exit", () => {
    const base = {
      id: "run-1",
      routineId: "r",
      day: "2026-10-19",
      startedAt: "x",
      steps: [{ habitId: "a", minutes: 1 }],
      results: [],
      current: 0,
      stepStartedAt: "x",
      stepPausedSec: 0,
      stepBonusSec: 0,
      state: "in_progress" as const,
      live: true,
    }
    const done = {
      ...base,
      current: 1,
      results: [{ habitId: "a", status: "done" as const, actualSec: 60 }],
      state: "completed" as const,
      live: false,
    }
    expect(runActions(base, done).map((x) => x.name)).toEqual([
      "habits.run.done",
    ])
  })

  test("the habit timer: start, extend, pause, resume, finish, discard", () => {
    const h = createHabit({ name: "Meditate", type: "duration", target: 10 })
    const e = engineAfterSetup()
    startTimer(h.id)
    expect(shape(record(e.capture()))).toEqual([
      { kind: "action", name: "habits.timer.start", data: { habit_id: h.id } },
      { kind: "upsert", name: "habit_timer", data: {} },
    ])
    extendTimer(300)
    expect(shape(record(e.capture()))).toEqual([
      { kind: "action", name: "habits.timer.extend", data: { sec: 300 } },
    ])
    pauseLive()
    expect(shape(record(e.capture()))).toEqual([
      { kind: "action", name: "habits.timer.pause", data: {} },
    ])
    resumeLive()
    expect(shape(record(e.capture()))).toEqual([
      { kind: "action", name: "habits.timer.resume", data: {} },
    ])
    finishTimer(12.4)
    const finished = record(e.capture())
    expect(shape(finished)).toEqual([
      { kind: "action", name: "habits.timer.finish", data: { minutes: 12 } },
      {
        kind: "upsert",
        name: "habit_log",
        data: expect.objectContaining({
          habit_id: h.id,
          status: "done",
          value: 12,
          source: "timer",
        }),
      },
      { kind: "delete", name: "habit_timer" },
    ])
    expect(liveStore.get().live).toBeNull()

    // a timer discarded after the day is already timer-logged is a discard
    startTimer(h.id)
    record(e.capture())
    discardTimer()
    expect(shape(record(e.capture()))).toEqual([
      { kind: "action", name: "habits.timer.discard", data: {} },
      { kind: "delete", name: "habit_timer" },
    ])
  })

  test("settings send only the changed field", () => {
    const e = engineAfterSetup()
    updateSettings({ weekStart: 0 })
    expect(shape(record(e.capture()))).toEqual([
      { kind: "upsert", name: "habit_settings", data: { week_start: 0 } },
    ])
  })
})

// ---------------------------------------------------------------- pulls

describe("pulled rows", () => {
  const change = (entity: string, row: Payload, deleted = false) => ({
    entity,
    id: String(row.id),
    version: 1,
    deleted,
    row: deleted ? null : row,
  })

  test("a pulled log replaces the local log for the same habit and day", () => {
    const h = createHabit({ name: "Read" })
    const local = checkHabit(h.id)
    const e = engine()
    e.capture()
    const serverId = "9b0e5f9a-0000-4000-8000-000000000001"
    e.apply([
      change("habit_log", {
        id: serverId,
        habit_id: h.id,
        day: dayKey(),
        status: "done",
        value: null,
        logged_at: new Date().toISOString(),
        source: "tap",
        note: "from the laptop",
        version: 4,
      }),
    ])
    const logs = habitsStore.get().logs
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ id: serverId, note: "from the laptop" })
    expect(logs[0].id).not.toBe(local?.id)
    // the dropped local id only yields an idempotent delete, never a write
    expect(shape(e.capture())).toEqual([{ kind: "delete", name: "habit_log" }])
  })

  test("children pulled before their parent attach when it arrives", () => {
    const e = engineAfterSetup()
    const habitId = "11111111-0000-4000-8000-000000000001"
    const routineId = "22222222-0000-4000-8000-000000000001"
    e.apply([
      change("habit_pause", {
        id: "p1",
        habit_id: habitId,
        from_day: "2026-09-01",
        to_day: "2026-09-07",
        reason: null,
      }),
      change("routine_step", {
        id: derivedId("routine-step", routineId, "0"),
        routine_id: routineId,
        habit_id: habitId,
        position: 0,
        minutes: 4,
      }),
    ])
    expect(habitsStore.get().habits).toEqual([])
    e.apply([
      change("habit", {
        id: habitId,
        name: "Walk",
        icon: "🚶",
        type: "check",
        target: null,
        unit: null,
        step: null,
        schedule: [{ days: [1, 3, 5], time: "07:00" }],
        reminder: false,
        status: "active",
        link_workout: false,
        archived_at: null,
        sort_order: 3,
        created_at: noon("2026-08-01"),
      }),
      change("routine", {
        id: routineId,
        name: "Walks",
        icon: "🚶",
        schedule: [{ days: [1, 3, 5] }],
        reminder: false,
        status: "active",
        created_at: noon("2026-08-01"),
      }),
    ])
    const s = habitsStore.get()
    expect(s.habits[0]).toMatchObject({
      id: habitId,
      createdAt: "2026-08-01",
      schedule: [{ days: [1, 3, 5], time: "07:00" }],
      pauses: [{ id: "p1", from: "2026-09-01", to: "2026-09-07" }],
    })
    expect(s.routines[0].steps).toEqual([{ habitId, minutes: 4 }])
    // the held children were never acknowledged, so they are re-sent once
    expect(
      e
        .capture()
        .map((o) => o.name)
        .sort(),
    ).toEqual(["habit_pause", "routine_step"])
    expect(e.capture()).toEqual([])
  })

  test("pulled run and timer changes never echo as actions", () => {
    const h = createHabit({ name: "Meditate", type: "duration", target: 10 })
    const r = createRoutine({
      name: "R",
      steps: [{ habitId: h.id, minutes: 3 }],
    })
    const e = engine()
    e.capture()
    const runId = "33333333-0000-4000-8000-000000000001"
    const now = new Date().toISOString()
    e.apply([
      change("routine_run", {
        id: runId,
        routine_id: r.id,
        day: dayKey(),
        started_at: now,
        ended_at: null,
        steps: [{ habit_id: h.id, minutes: 3 }],
        current: 0,
        step_started_at: now,
        step_paused_sec: 0,
        step_bonus_sec: 0,
        paused_at: null,
        state: "in_progress",
      }),
      change("habit_timer", {
        id: "server-timer",
        habit_id: h.id,
        day: dayKey(),
        target_sec: 600,
        started_at: now,
        paused_at: null,
        paused_sec: 0,
        bonus_sec: 0,
      }),
    ])
    expect(habitsStore.get().timer).toEqual({
      habitId: h.id,
      day: dayKey(),
      targetSec: 600,
    })
    expect(e.capture()).toEqual([])
    e.apply([
      change("routine_run", {
        id: runId,
        routine_id: r.id,
        day: dayKey(),
        started_at: now,
        ended_at: now,
        steps: [{ habit_id: h.id, minutes: 3 }],
        current: 1,
        step_started_at: now,
        step_paused_sec: 0,
        step_bonus_sec: 0,
        paused_at: null,
        state: "completed",
      }),
      change("routine_step_result", {
        id: derivedId("run-step", runId, "0"),
        run_id: runId,
        position: 0,
        habit_id: h.id,
        status: "done",
        actual_sec: 200,
      }),
      change("habit_timer", { id: "server-timer" }, true),
    ])
    const s = habitsStore.get()
    expect(s.runs[0]).toMatchObject({
      state: "completed",
      results: [{ habitId: h.id, status: "done", actualSec: 200 }],
    })
    expect(s.timer).toBeNull()
    // only the local timer id's read-only delete, no action
    expect(e.capture().map((o) => o.kind)).toEqual(["delete"])
  })
})

// ---------------------------------------------------------------- derived ids

test("a workout's auto-check mints the server's derived log id", () => {
  // Values computed by backend app.shared.ids.derived_id (same inputs).
  expect(
    derivedId(
      "workout-habit",
      "00000000-0000-4000-8000-0000000000aa",
      "00000000-0000-4000-8000-0000000000bb",
    ),
  ).toBe("5832abda-e108-5fcb-8518-509aff9e786c")
  expect(
    derivedId("routine-step", "00000000-0000-4000-8000-0000000000cc", "2"),
  ).toBe("8ebaf572-d2ab-5671-94ff-4a92828d6947")
  expect(
    derivedId("run-step", "00000000-0000-4000-8000-0000000000dd", "1"),
  ).toBe("bc9ed769-4c7b-5eb9-8ffb-8803beea404e")

  const h = createHabit({ name: "Workout", linkWorkout: true })
  const workoutId = "44444444-0000-4000-8000-000000000001"
  const [log] = autoCheckWorkoutHabits("2026-10-18", workoutId)
  expect(log).toMatchObject({
    id: derivedId("workout-habit", workoutId, h.id),
    day: "2026-10-18",
    status: "done",
    source: "workout",
  })
})

// ---------------------------------------------------------------- screen rule

test("a habit's screen-time rule round-trips as three columns, all null without one", () => {
  const m = byName("habit")
  const seed = seedHabits()
  const plain = seed.habits[0]
  expect(m.toServer(plain, seed)).toMatchObject({
    rule_kind: null,
    rule_group_id: null,
    rule_max_min: null,
  })
  const ruled = {
    ...plain,
    rule: {
      kind: "screen_limit" as const,
      groupId: "55555555-0000-4000-8000-000000000001",
      maxMin: 30,
    },
  }
  const out = m.toServer(ruled, seed)
  expect(out).toMatchObject({
    rule_kind: "screen_limit",
    rule_group_id: "55555555-0000-4000-8000-000000000001",
    rule_max_min: 30,
  })
  const row = {
    id: ruled.id,
    ...out,
    created_at: noon(ruled.createdAt),
    version: 1,
  }
  expect(m.fromServer(row, seed)).toEqual(ruled)
  // A zero limit ("none today") is a rule, not a missing one.
  expect(m.fromServer({ ...row, rule_max_min: 0 }, seed)?.rule?.maxMin).toBe(0)
  // Half a rule is no rule.
  expect(
    m.fromServer({ ...row, rule_group_id: null }, seed)?.rule,
  ).toBeUndefined()
})
