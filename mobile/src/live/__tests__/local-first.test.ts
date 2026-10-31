// Local-first under a slow link: a write shows at once and stays shown.
//
// A fake /sync server answers every request after LATENCY ms (a slow mobile
// connection that is still online). Each test records what the screen would
// show on every store change, so a value that flips back and forth while
// the outbox drains is caught as a flicker, not just the final state.

import { logExpense } from "@domain/finance/actions"
import { finStore } from "@domain/finance/store"
import {
  addSet,
  finishWorkout,
  startWorkout,
  toggleSet,
  updateSet,
  upsertExercise,
  upsertTemplate,
} from "@domain/fitness/actions"
import { type FitnessState, seed } from "@domain/fitness/data"
import { fitStore } from "@domain/fitness/store"
import { checkHabit } from "@domain/habits/actions"
import { habitsStore } from "@domain/habits/store"
import { liveStore } from "@domain/lib/live"
import type { StorageAdapter } from "@domain/lib/store"
import { completeTask } from "@domain/tasks/actions"
import { tasksStore } from "@domain/tasks/store"
import { SyncEngine } from "../engine"
import { type Http, NetworkError, type RequestOptions } from "../http"
import type { AnyMapper, Payload } from "../mapper"
import { financeMappers } from "../mappers/finance"
import { fitnessMappers, type SyncedWorkout } from "../mappers/fitness"
import { habitsMappers } from "../mappers/habits"
import { tasksMappers } from "../mappers/tasks"
import { createOutbox, type SyncOp } from "../outbox"

const USER = "8a1f6a52-2c36-4b8f-9d34-3b1f5f0f2a11"
const T0 = new Date("2026-10-19T10:00:00.000Z")

function memoryStorage(): StorageAdapter {
  const m = new Map<string, string>()
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  }
}

/** The server side of /sync for the fitness entities, with a delay. Rows
 * merge field by field in arrival order, every write takes the next
 * version, and the actions the workout logger sends change the rows the
 * way the real handlers do. */
class SlowServer implements Http {
  latency = 0
  rows = new Map<string, { entity: string; row: Payload; version: number }>()
  version = 0
  requests: {
    method: string
    path: string
    at: number
    timeoutMs?: number
  }[] = []
  down = false

  private write(entity: string, id: string, data: Payload) {
    const cur = this.rows.get(id)?.row ?? { id }
    this.rows.set(id, {
      entity,
      row: { ...cur, ...data, id },
      version: ++this.version,
    })
    return this.rows.get(id)?.row as Payload
  }

  private action(op: SyncOp) {
    const d = op.data ?? {}
    // As the real push: the op applies as of the device's ``at``, else as
    // of when it arrived.
    const when = op.at ?? new Date().toISOString()
    if (op.name === "fitness.start_workout")
      this.write("workout", String(d.workout_id), {
        name: "Workout",
        status: "in_progress",
        started_at: when,
        source: "live",
      })
    if (op.name === "fitness.toggle_set") {
      const id = String(d.set_id)
      const done = this.rows.get(id)?.row.completed_at
      this.write("workout_set", id, { completed_at: done ? null : when })
    }
    if (op.name === "fitness.rest.start") {
      const sec = Number(d.sec)
      this.write("rest_timer", "rest", {
        duration_sec: sec,
        ends_at: new Date(new Date(when).getTime() + sec * 1000).toISOString(),
      })
    }
    if (op.name === "tasks.complete")
      this.write("task", String(d.task_id), {
        status: "done",
        completed_at: d.completed_at,
      })
    if (op.name === "fitness.finish_workout")
      this.write("workout", String(d.workout_id), {
        status: "finished",
        ended_at: d.end_at,
      })
  }

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    opts?: RequestOptions,
  ): Promise<T> {
    this.requests.push({
      method,
      path,
      at: Date.now(),
      timeoutMs: opts?.timeoutMs,
    })
    if (this.latency) await new Promise((r) => setTimeout(r, this.latency))
    if (this.down) throw new NetworkError("timeout")
    if (method === "POST" && path === "/sync/push") {
      const ops = (body as { ops: SyncOp[] }).ops
      const results = ops.map((op) => {
        if (op.kind === "action") {
          this.action(op)
          return { op_id: op.op_id, status: "applied" }
        }
        if (op.kind === "upsert" && op.id) {
          const row = this.write(op.name, op.id, op.data ?? {})
          return { op_id: op.op_id, status: "applied", row: { ...row } }
        }
        return { op_id: op.op_id, status: "applied" }
      })
      return { results } as T
    }
    if (method === "GET" && path.startsWith("/sync/pull")) {
      const cursor = Number(/cursor=(\d+)/.exec(path)?.[1] ?? 0)
      const changes = [...this.rows.entries()]
        .filter(([, r]) => r.version > cursor)
        .sort((a, b) => a[1].version - b[1].version)
        .map(([id, r]) => ({
          entity: r.entity,
          id,
          version: r.version,
          deleted: false,
          row: { ...r.row },
        }))
      return {
        changes,
        cursor: changes.at(-1)?.version ?? cursor,
        truncated: false,
      } as T
    }
    throw new Error(`unexpected ${method} ${path}`)
  }

  async raw(): Promise<Response> {
    throw new Error("unused")
  }
}

const blank = (): FitnessState => ({
  ...seed(),
  exercises: [],
  templates: [],
  workouts: [],
  weighIns: [],
  targets: [],
  meals: [],
  activeId: null,
  rest: null,
})

const engines: SyncEngine[] = []

function liveEngine(
  server: SlowServer,
  online = () => true,
  mappers: AnyMapper[] = fitnessMappers(USER),
) {
  const storage = memoryStorage()
  const e = new SyncEngine({
    http: server,
    storage,
    outbox: createOutbox(storage),
    mappers,
    online,
  })
  engines.push(e)
  // As runtime.ts subscribes: a new store state schedules a capture.
  e.start((m, onChange) => {
    let last = m.store.get()
    return m.store.subscribe(() => {
      const next = m.store.get()
      if (next !== last) {
        last = next
        onChange()
      }
    })
  })
  return e
}

const active = () =>
  fitStore
    .get()
    .workouts.find((w) => w.status === "in_progress") as SyncedWorkout

/** Every value ``read`` showed, in order, with when it changed. */
/** What a test watches: any store's change feed. */
interface Watched {
  subscribe(listener: () => void): () => void
}

function watch<T>(read: () => T, store: Watched = fitStore) {
  const shown: { value: T; at: number }[] = [{ value: read(), at: Date.now() }]
  const off = store.subscribe(() => {
    const v = read()
    if (v !== shown.at(-1)?.value) shown.push({ value: v, at: Date.now() })
  })
  return {
    values: () => shown.map((s) => s.value),
    shown,
    off,
  }
}

/** A started workout, already synced over a fast link. */
async function workoutInProgress(server: SlowServer, online = () => true) {
  const e = liveEngine(server, online)
  const bench = upsertExercise({ name: "Bench", muscle: "chest" })
  const tpl = upsertTemplate({
    name: "Push",
    items: [{ exerciseId: bench.id, sets: 3 }],
  })
  startWorkout({ from: "template", templateId: tpl.id })
  await jest.advanceTimersByTimeAsync(2_000)
  expect(e.pending()).toBe(0)
  const w = active()
  expect(server.rows.get(w.id)?.row.status).toBe("in_progress")
  addSet(w.id, w.exercises[0].id)
  await jest.advanceTimersByTimeAsync(2_000)
  expect(e.pending()).toBe(0)
  return { e, w, we: active().exercises[0] }
}

const LATENCY = 3_000

beforeEach(() => {
  // Real hrtime: the tap-to-screen time is measured on the wall clock.
  jest.useFakeTimers({ now: T0, doNotFake: ["hrtime"] })
  fitStore.set(blank())
  liveStore.set({ live: null })
})

afterEach(() => {
  for (const e of engines.splice(0)) e.stop()
  jest.useRealTimers()
})

describe("a set ticked on a slow link never unticks itself", () => {
  test("ticked while the push of its weight edit is in flight", async () => {
    const server = new SlowServer()
    const { e, w, we } = await workoutInProgress(server)
    const set = we.sets[0]
    const isDone = () =>
      Boolean(
        active()?.exercises[0]?.sets.find((x) => x.id === set.id)?.completedAt,
      )
    server.latency = LATENCY

    // Change the weight, then tick the set a second later (the weight's
    // push is still on the wire).
    updateSet(w.id, we.id, set.id, { weight: 62.5 })
    await jest.advanceTimersByTimeAsync(1_000)
    const seen = watch(isDone)
    toggleSet(w.id, we.id, set.id)
    await jest.advanceTimersByTimeAsync(30_000)
    seen.off()

    expect(e.pending()).toBe(0)
    expect(server.rows.get(set.id)?.row.completed_at).toBeTruthy()
    expect(seen.values()).toEqual([false, true])
  })

  test("ticked while its own create is in flight (a set just added)", async () => {
    const server = new SlowServer()
    const { e, w, we } = await workoutInProgress(server)
    server.latency = LATENCY

    const set = addSet(w.id, we.id)
    await jest.advanceTimersByTimeAsync(1_000)
    const isDone = () =>
      Boolean(
        active()?.exercises[0]?.sets.find((x) => x.id === set.id)?.completedAt,
      )
    const seen = watch(isDone)
    toggleSet(w.id, we.id, set.id)
    await jest.advanceTimersByTimeAsync(30_000)
    seen.off()

    expect(e.pending()).toBe(0)
    expect(seen.values()).toEqual([false, true])
  })

  test("ticked while an earlier sync's pull is in flight", async () => {
    const server = new SlowServer()
    const { e, w, we } = await workoutInProgress(server)
    const [s1, s2] = we.sets
    server.latency = LATENCY
    const isDone = () =>
      Boolean(
        active()?.exercises[0]?.sets.find((x) => x.id === s2.id)?.completedAt,
      )

    // Edit set 2, tick set 1: that sync pushes both, then pulls (set 2's
    // row is in the pull, without a tick). Tick set 2 during that pull.
    updateSet(w.id, we.id, s2.id, { reps: 6 })
    toggleSet(w.id, we.id, s1.id)
    await jest.advanceTimersByTimeAsync(400 + LATENCY + 500)
    const seen = watch(isDone)
    toggleSet(w.id, we.id, s2.id)
    await jest.advanceTimersByTimeAsync(30_000)
    seen.off()

    expect(e.pending()).toBe(0)
    expect(seen.values()).toEqual([false, true])
  })

  test("unticking while the tick is still in flight stays unticked", async () => {
    const server = new SlowServer()
    const { e, w, we } = await workoutInProgress(server)
    const set = we.sets[0]
    server.latency = LATENCY
    const isDone = () =>
      Boolean(
        active()?.exercises[0]?.sets.find((x) => x.id === set.id)?.completedAt,
      )
    const seen = watch(isDone)
    toggleSet(w.id, we.id, set.id)
    await jest.advanceTimersByTimeAsync(1_000)
    toggleSet(w.id, we.id, set.id)
    await jest.advanceTimersByTimeAsync(30_000)
    seen.off()

    expect(e.pending()).toBe(0)
    expect(server.rows.get(set.id)?.row.completed_at).toBeFalsy()
    expect(seen.values()).toEqual([false, true, false])
  })
})

test("on a slow link the elapsed time and the rest countdown never jump", async () => {
  const server = new SlowServer()
  liveEngine(server)
  const bench = upsertExercise({ name: "Bench", muscle: "chest" })
  const tpl = upsertTemplate({
    name: "Push",
    items: [{ exerciseId: bench.id, sets: 3 }],
  })
  await jest.advanceTimersByTimeAsync(2_000)
  server.latency = LATENCY

  const started = watch(() => active()?.startedAt)
  const rest = watch(() => fitStore.get().rest?.endsAt)
  const ticked = watch(() => active()?.exercises[0]?.sets[0]?.completedAt)
  startWorkout({ from: "template", templateId: tpl.id })
  await jest.advanceTimersByTimeAsync(5_000)
  const w = active()
  toggleSet(w.id, w.exercises[0].id, w.exercises[0].sets[0].id)
  await jest.advanceTimersByTimeAsync(30_000)
  for (const s of [started, rest, ticked]) s.off()

  // Each shows once, at the tap, and the server's rows (applied seconds
  // later) carry the same instants, so nothing moves when they land.
  expect(started.values().filter(Boolean)).toHaveLength(1)
  expect(rest.values().filter(Boolean)).toHaveLength(1)
  expect(ticked.values().filter(Boolean)).toHaveLength(1)
  expect(server.rows.get(w.id)?.row.started_at).toBe(w.startedAt)
  expect(server.rows.get("rest")?.row.ends_at).toBe(fitStore.get().rest?.endsAt)
})

test("replies to this device's own writes never re-render the logger", async () => {
  const server = new SlowServer()
  const { e, w, we } = await workoutInProgress(server)
  server.latency = LATENCY
  let changes = 0
  const off = fitStore.subscribe(() => void changes++)
  updateSet(w.id, we.id, we.sets[0].id, { weight: 80 })
  toggleSet(w.id, we.id, we.sets[0].id)
  const taps = changes
  await jest.advanceTimersByTimeAsync(30_000)
  off()

  expect(e.pending()).toBe(0)
  expect(server.rows.get(we.sets[0].id)?.row.weight).toBe(80)
  // Only the taps changed the store: the push replies and the pull that
  // followed carried nothing the screen did not already show.
  expect(changes).toBe(taps)
})

test("a finished workout never shows as in progress again while the finish is in flight", async () => {
  const server = new SlowServer()
  const { e, w } = await workoutInProgress(server)
  server.latency = LATENCY
  const status = () =>
    fitStore.get().workouts.find((x) => x.id === w.id)?.status

  // Rename (a field write in flight), then finish a second later.
  fitStore.set((s) => ({
    ...s,
    workouts: s.workouts.map((x) =>
      x.id === w.id ? { ...x, name: "Push day" } : x,
    ),
  }))
  await jest.advanceTimersByTimeAsync(1_000)
  const seen = watch(status)
  finishWorkout(w.id, { unfinished: "remove" })
  await jest.advanceTimersByTimeAsync(30_000)
  seen.off()

  expect(e.pending()).toBe(0)
  expect(server.rows.get(w.id)?.row.status).toBe("finished")
  expect(seen.values()).toEqual(["in_progress", "finished"])
})

test("another device's edit to a different field still arrives", async () => {
  const server = new SlowServer()
  const { e, w, we } = await workoutInProgress(server)
  const set = we.sets[0]
  server.latency = LATENCY
  const reps = () =>
    active()?.exercises[0]?.sets.find((x) => x.id === set.id)?.reps

  // The other device changed the reps; this one changes the weight.
  server.rows.set(set.id, {
    entity: "workout_set",
    row: { ...(server.rows.get(set.id)?.row ?? {}), reps: 12 },
    version: ++server.version,
  })
  updateSet(w.id, we.id, set.id, { weight: 70 })
  await jest.advanceTimersByTimeAsync(30_000)

  expect(e.pending()).toBe(0)
  expect(reps()).toBe(12)
  expect(
    active()?.exercises[0]?.sets.find((x) => x.id === set.id)?.weight,
  ).toBe(70)
})

test("an edit and a tick queued offline go in one push, and the tick holds", async () => {
  const server = new SlowServer()
  let online = true
  const { e, w, we } = await workoutInProgress(server, () => online)
  const set = we.sets[0]
  const isDone = () =>
    Boolean(
      active()?.exercises[0]?.sets.find((x) => x.id === set.id)?.completedAt,
    )
  online = false
  server.latency = LATENCY
  updateSet(w.id, we.id, set.id, { weight: 80 })
  await jest.advanceTimersByTimeAsync(1_000)
  toggleSet(w.id, we.id, set.id)
  await jest.advanceTimersByTimeAsync(1_000)
  expect(e.pending()).toBeGreaterThan(1)

  // Back online: the push carries the weight write, then the tick. The
  // reply's row for the weight write predates the tick.
  const seen = watch(isDone)
  online = true
  void e.sync()
  await jest.advanceTimersByTimeAsync(30_000)
  seen.off()

  expect(e.pending()).toBe(0)
  expect(server.rows.get(set.id)?.row).toMatchObject({ weight: 80 })
  expect(server.rows.get(set.id)?.row.completed_at).toBeTruthy()
  expect(seen.values()).toEqual([true])
})

test("a row held back for a tick still shows another device's edit after", async () => {
  const server = new SlowServer()
  const { e, w, we } = await workoutInProgress(server)
  const set = we.sets[0]
  server.latency = LATENCY

  // Another device renamed the workout; this one ticks a set. The tick
  // names the workout, so its pulled row waits for the tick; the tick
  // never touches the workout row, so no later pull brings it again.
  server.rows.set(w.id, {
    entity: "workout",
    row: { ...(server.rows.get(w.id)?.row ?? {}), name: "Leg day" },
    version: ++server.version,
  })
  void e.sync()
  await jest.advanceTimersByTimeAsync(LATENCY / 2)
  toggleSet(w.id, we.id, set.id)
  await jest.advanceTimersByTimeAsync(30_000)

  expect(e.pending()).toBe(0)
  expect(fitStore.get().workouts.find((x) => x.id === w.id)?.name).toBe(
    "Leg day",
  )
})

describe("key interactions on a slow link: tap to screen", () => {
  /** Start the engine over a fast link (the device's rows reach the
   * server), slow the link, then time ``tap`` until the screen shows it
   * and until the server has it. */
  async function timed<T>(
    store: Watched,
    mappers: AnyMapper[],
    read: () => T,
    tap: () => void,
  ) {
    const server = new SlowServer()
    const e = liveEngine(server, () => true, mappers)
    e.reupload()
    await jest.advanceTimersByTimeAsync(5_000)
    expect(e.pending()).toBe(0)
    server.latency = LATENCY
    const seen = watch(read, store)
    const t0 = Date.now()
    const wall = process.hrtime.bigint()
    tap()
    const tapToScreenMs = Number(process.hrtime.bigint() - wall) / 1e6
    const shownAt = seen.shown.at(1)?.at
    let confirmedAt = 0
    for (let i = 0; i < 300 && !confirmedAt; i++) {
      await jest.advanceTimersByTimeAsync(100)
      if (e.settled()) confirmedAt = Date.now()
    }
    seen.off()
    return {
      values: seen.values(),
      shownAfterMs: shownAt === undefined ? null : shownAt - t0,
      tapToScreenMs,
      confirmedAfterMs: confirmedAt - t0,
    }
  }

  const report = (name: string, r: Awaited<ReturnType<typeof timed>>) => {
    if (process.env.MEASURE)
      console.log(
        `MEASURE ${name}: on screen after ${r.shownAfterMs} ms (${r.tapToScreenMs.toFixed(2)} ms wall), server has it after ${r.confirmedAfterMs} ms, shown ${JSON.stringify(r.values)}`,
      )
  }

  test("set done", async () => {
    const { w, we } = await workoutInProgress(new SlowServer())
    for (const e of engines.splice(0)) e.stop()
    const set = we.sets[0]
    const r = await timed(
      fitStore,
      fitnessMappers(USER),
      () =>
        Boolean(
          active()?.exercises[0]?.sets.find((x) => x.id === set.id)
            ?.completedAt,
        ),
      () => void toggleSet(w.id, we.id, set.id),
    )
    report("set done", r)
    expect(r.shownAfterMs).toBe(0)
    expect(r.values).toEqual([false, true])
  })

  test("habit check", async () => {
    const habit = habitsStore
      .get()
      .habits.find((h) => h.type === "check" && !h.archivedAt)
    expect(habit).toBeDefined()
    const id = habit?.id as string
    const day = new Date().toISOString().slice(0, 10)
    const done = () =>
      habitsStore
        .get()
        .logs.some(
          (l) => l.habitId === id && l.status === "done" && l.day === day,
        )
    if (done())
      habitsStore.set((s) => ({
        ...s,
        logs: s.logs.filter((l) => !(l.habitId === id && l.day === day)),
      }))
    const r = await timed(
      habitsStore,
      habitsMappers(USER),
      done,
      () => void checkHabit(id, day),
    )
    report("habit check", r)
    expect(r.shownAfterMs).toBe(0)
    expect(r.values).toEqual([false, true])
  })

  test("task complete", async () => {
    const task = tasksStore
      .get()
      .tasks.find((t) => t.status === "open" && !t.recurrence)
    expect(task).toBeDefined()
    const id = task?.id as string
    const status = () => tasksStore.get().tasks.find((t) => t.id === id)?.status
    const r = await timed(
      tasksStore,
      tasksMappers(USER),
      status,
      () => void completeTask(id),
    )
    report("task complete", r)
    expect(r.shownAfterMs).toBe(0)
    expect(r.values).toEqual(["open", "done"])
  })

  test("expense log", async () => {
    const payee = "Jollibee Katipunan"
    const shown = () => finStore.get().records.some((x) => x.payee === payee)
    const r = await timed(
      finStore,
      financeMappers(USER),
      shown,
      () =>
        void logExpense({ amount: 250, payee, at: new Date().toISOString() }),
    )
    report("expense log", r)
    expect(r.shownAfterMs).toBe(0)
    expect(r.values).toEqual([false, true])
  })
})

describe("sync stays in the background", () => {
  test("failed syncs leave one retry waiting, however many were triggered", async () => {
    const server = new SlowServer()
    server.down = true
    const e = liveEngine(server, () => true, [])
    // Three triggers (an edit, the interval, a server event), each failing:
    // the backoff is 2 s, 4 s, then 8 s.
    for (let i = 0; i < 3; i++) await e.sync()
    expect(server.requests).toHaveLength(3)
    await jest.advanceTimersByTimeAsync(8_500)
    expect(server.requests).toHaveLength(4)
  })

  test("push and pull get the background timeout, not the interactive one", async () => {
    const server = new SlowServer()
    const { e } = await workoutInProgress(server)
    expect(e.pending()).toBe(0)
    const sync = server.requests.filter((r) => r.path.startsWith("/sync/"))
    expect(sync.length).toBeGreaterThan(1)
    for (const r of sync) expect(r.timeoutMs).toBe(30_000)
  })
})
