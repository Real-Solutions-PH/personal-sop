import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  addExercises,
  addMealItem,
  adjustRest,
  answerFollowUp,
  confirmMeal,
  deleteTemplate,
  deleteWeighIn,
  discardWorkout,
  estimateMeal,
  finishWorkout,
  logMeal,
  logWeighIn,
  logWorkoutFromChat,
  moveExercise,
  removeExercise,
  setMacroTarget,
  skipRest,
  startWorkout,
  toggleSet,
  updateSet,
  updateSettings,
  updateWeighIn,
  upsertExercise,
  upsertTemplate,
} from "@domain/fitness/actions"
import { type FitnessState, type Meal, seed } from "@domain/fitness/data"
import { fitStore } from "@domain/fitness/store"
import { derivedId } from "@domain/lib/ids"
import { liveStore } from "@domain/lib/live"
import type { StorageAdapter } from "@domain/lib/store"
import { clearToBlank } from "../blank"
import { SyncEngine } from "../engine"
import type { Http } from "../http"
import type { AnyMapper, Payload } from "../mapper"
import {
  exerciseMapper,
  fitnessMappers,
  macroTargetMapper,
  mealMapper,
  restActions,
  type SyncedWorkout,
  settingsMapper,
  templateItemId,
  weighInMapper,
} from "../mappers/fitness"
import { createOutbox, type SyncOp } from "../outbox"
import { stabilize } from "./stable-fixture"

const USER = "8a1f6a52-2c36-4b8f-9d34-3b1f5f0f2a11"
const T0 = new Date("2026-10-19T10:00:00.000Z")

// startLive's network side, stubbed: only its mapper list is under test.
jest.mock("expo/fetch", () => ({ fetch: jest.fn() }))
jest.mock("../events", () => ({
  runEventStream: () => ({ stop: async () => {} }),
}))
jest.mock("@domain/lib/platform", () => ({
  ...jest.requireActual("@domain/lib/platform"),
  getConnectivity: () => false,
}))

function memoryStorage(): StorageAdapter {
  const m = new Map<string, string>()
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  }
}

const quietHttp: Http = {
  request: async <T>(method: string, path: string) => {
    if (method === "POST" && path === "/sync/push") return { results: [] } as T
    return { changes: [], cursor: 0, truncated: false } as T
  },
  raw: async () => {
    throw new Error("unused")
  },
}

function engine() {
  const storage = memoryStorage()
  const e = new SyncEngine({
    http: quietHttp,
    storage,
    outbox: createOutbox(storage),
    mappers: fitnessMappers(USER),
    online: () => false,
  })
  e.capture()
  return e
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

// Every upsert and action the suite produces, for the backend schema test.
// (rest_timer is action-written: its mapper sends no field writes.)
const wire: {
  entity: string
  kind: string
  name: string
  create: boolean
  data: Payload
}[] = []
const names = (ops: SyncOp[]) =>
  ops.map((o) => (o.kind === "action" ? o.name : `${o.kind}:${o.name}`))
const upsertOf = (ops: SyncOp[], id: string) =>
  ops.find((o) => o.kind === "upsert" && o.id === id)?.data
const change = (entity: string, row: Payload, deleted = false) => ({
  entity,
  id: String(row.id),
  version: 1,
  deleted,
  row: deleted ? null : row,
})
const active = () =>
  fitStore
    .get()
    .workouts.find((w) => w.status === "in_progress") as SyncedWorkout

/** Three lifts and a two-item template, all with device-minted UUIDs. */
function library() {
  const bench = upsertExercise({ name: "Bench", muscle: "chest" })
  const row = upsertExercise({
    name: "Row",
    muscle: "back",
    equipment: "cable",
  })
  const squat = upsertExercise({
    name: "Squat",
    muscle: "quads",
    repMin: 5,
    repMax: 8,
  })
  const tpl = upsertTemplate({
    name: "Full body",
    items: [
      { exerciseId: bench.id, sets: 3 },
      { exerciseId: row.id, sets: 3 },
    ],
  })
  return { bench, row, squat, tpl }
}

beforeAll(() => {
  jest.useFakeTimers({
    now: T0,
    doNotFake: [
      "nextTick",
      "queueMicrotask",
      "setImmediate",
      "clearImmediate",
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
    ],
  })
})

beforeEach(() => {
  jest.setSystemTime(T0)
  fitStore.set(blank())
  liveStore.set({ live: null })
})

afterAll(() => {
  jest.useRealTimers()
  writeFixture(join(__dirname, "fixtures", "fitness-wire.json"), wire)
})

const SCALAR = String.raw`(?:"[^"\n]*"|-?\d[\d.e+-]*|true|false|null)`
const SHORT_ARRAY = new RegExp(
  String.raw`\[\n\s*(${SCALAR}(?:,\n\s*${SCALAR})*)\n\s*\]`,
  "g",
)

/** writeStableFixture's stable ids and instants, laid out the way Biome
 * formats JSON (short scalar arrays on one line) so `biome check` passes. */
function writeFixture(path: string, data: unknown) {
  const next = `${stabilize(JSON.stringify(data, null, 2)).replace(
    SHORT_ARRAY,
    (_, items: string) => `[${items.split(/,\n\s*/).join(", ")}]`,
  )}\n`
  if (existsSync(path) && readFileSync(path, "utf8") === next) return
  writeFileSync(path, next)
}

/** Capture, recording every op for the wire file (a create is the first
 * upsert of an id). */
function step(e: SyncEngine, seen: Set<string>) {
  const ops = e.capture()
  for (const o of ops) {
    if (o.kind === "action")
      wire.push({
        entity: "",
        kind: o.kind,
        name: o.name,
        create: false,
        data: o.data ?? {},
      })
    if (o.kind !== "upsert") continue
    const id = o.id ?? ""
    wire.push({
      entity: o.name,
      kind: o.kind,
      name: o.name,
      create: !seen.has(id),
      data: o.data ?? {},
    })
    seen.add(id)
  }
  return ops
}

test("a blank live account starts with the server's goal, not the demo's", () => {
  // Live E2E: a new account's first fitness_settings push carried the
  // prototype's demo goal (cut, 76 kg) over the server default (maintain).
  fitStore.set((s) => ({ ...s, settings: seed().settings }))
  clearToBlank()
  const st = fitStore.get().settings
  expect(st.goalDirection).toBe("maintain")
  expect(st.goalWeight).toBeUndefined()
})

test("estimated and picked meal items carry UUID ids", () => {
  // Live E2E: estimator items had ids like "mi-adobo-lnxell"; /sync/push
  // validates every op id as a UUID, so the whole batch got a 422 and the
  // meal (and everything queued after it) never reached the server.
  const e = engine()
  const m = estimateMeal("lunch: rice, chicken adobo", {
    source: "text",
    eatenAt: T0.toISOString(),
    label: "lunch",
  })
  addMealItem(m!.id, "egg")
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
  const ids = e.capture().flatMap((o) => (o.id ? [o.id] : []))
  expect(ids.length).toBeGreaterThan(2)
  for (const id of ids) expect(id).toMatch(uuid)
})

test("runtime.ts lists the fitness mappers", () => {
  const rt = require("../runtime") as typeof import("../runtime")
  const e = rt.startLive(USER, memoryStorage())
  const entities = (
    e as unknown as { deps: { mappers: { entity: string }[] } }
  ).deps.mappers.map((m) => m.entity)
  rt.stopLive()
  expect(entities).toEqual(
    expect.arrayContaining([
      "exercise",
      "workout_template",
      "template_item",
      "workout",
      "workout_exercise",
      "workout_set",
      "weigh_in",
      "macro_target",
      "meal",
      "meal_item",
      "fitness_settings",
      "rest_timer",
    ]),
  )
})

// ---------------------------------------------------------------- round trip

describe("round trip from the prototype seed", () => {
  const s = seed()
  const all = fitnessMappers(USER)
  const by = (entity: string) =>
    all.find((m) => m.entity === entity) as AnyMapper

  test.each([
    "exercise",
    "workout_template",
    "template_item",
    "workout",
    "workout_exercise",
    "workout_set",
    "weigh_in",
    "macro_target",
    "meal",
    "meal_item",
    "fitness_settings",
  ])("%s rows survive toServer -> fromServer", (entity) => {
    const m = by(entity)
    const rows = m.list(s)
    expect(rows.length).toBeGreaterThan(0)
    for (const l of rows) {
      const back = m.fromServer({ ...m.toServer(l, s), id: m.id(l) }, s)
      if (entity === "workout_template") {
        const { sortOrder: _, ...t } = back as { sortOrder?: number }
        expect(t).toEqual(l)
      } else if (entity === "workout_set") {
        // completed_at of a finished workout's sets is a plain field.
        expect(back).toEqual(l)
      } else expect(back).toEqual(l)
    }
  })

  test("the seed covers the shapes the screens use", () => {
    expect(s.meals.some((m) => m.followUp)).toBe(true)
    expect(s.meals.some((m) => m.confidence === undefined)).toBe(true)
    expect(s.weighIns.some((w) => w.bodyFatPct !== undefined)).toBe(true)
    expect(
      s.workouts
        .flatMap((w) => w.exercises.flatMap((e) => e.sets))
        .some((x) => x.kind === "warmup"),
    ).toBe(true)
    expect(s.settings.weighInReminder).toBe("06:30")
  })

  test("a server instant with an offset comes back in the local format", () => {
    const m = weighInMapper()
    const w = s.weighIns[0]
    const back = m.fromServer(
      {
        ...m.toServer(w, s),
        id: w.id,
        measured_at: w.measuredAt.replace(".000Z", "+00:00"),
      },
      s,
    )
    expect(back?.measuredAt).toBe(w.measuredAt)
  })

  test("the weigh-in reminder: a time, or null when off", () => {
    const m = settingsMapper(USER)
    const off = { ...s, settings: { ...s.settings, weighInReminder: "" } }
    const [row] = m.list(off)
    expect(m.toServer(row, off).weigh_in_reminder).toBeNull()
    expect(
      m.fromServer({ ...m.toServer(row, off) }, off)?.value.weighInReminder,
    ).toBe("")
    const [on] = m.list(s)
    expect(m.toServer(on, s).weigh_in_reminder).toBe("06:30")
  })

  test("plan profile round-trips through the settings mapper", () => {
    const m = settingsMapper(USER)
    const [base] = m.list(s)
    const row = m.toServer(base, s)
    const back = m.fromServer(
      {
        ...row,
        sex: "female",
        birth_year: 1996,
        height_cm: 165,
        activity_level: "light",
        plan_goal: "recomp",
      },
      s,
    )?.value
    expect(back).toMatchObject({
      sex: "female",
      birthYear: 1996,
      heightCm: 165,
      activity: "light",
      planGoal: "recomp",
    })
    const withPlan = { ...s, settings: { ...s.settings, ...back } }
    expect(m.toServer(m.list(withPlan)[0], withPlan)).toMatchObject({
      sex: "female",
      birth_year: 1996,
      height_cm: 165,
      activity_level: "light",
      plan_goal: "recomp",
    })
    expect(row).toMatchObject({
      sex: null,
      birth_year: null,
      height_cm: null,
      activity_level: null,
      plan_goal: null,
    })
    const junk = m.fromServer(
      {
        ...row,
        sex: "x",
        activity_level: "x",
        plan_goal: "x",
        birth_year: null,
      },
      withPlan,
    )?.value
    for (const k of ["sex", "birthYear", "heightCm", "activity", "planGoal"])
      expect(junk).not.toHaveProperty(k)
  })

  test("cardio from a chat-logged workout is kept, never sent", () => {
    const m = by("workout")
    const w = s.workouts[0]
    const back = m.fromServer(
      {
        ...m.toServer(w, s),
        id: w.id,
        cardio: { activity: "run", km: 5, min: 28 },
      },
      s,
    ) as SyncedWorkout
    expect(back.cardio).toEqual({ activity: "run", km: 5, min: 28 })
    expect(m.toServer(back, s)).not.toHaveProperty("cardio")
  })
})

// ---------------------------------------------------------------- diff

describe("store edits become sync ops", () => {
  test("create a library: exercises, then the template, then its slots", () => {
    const e = engine()
    const seen = new Set<string>()
    const { bench, row, tpl } = library()
    const ops = step(e, seen)
    expect(names(ops)).toEqual([
      "upsert:exercise",
      "upsert:exercise",
      "upsert:exercise",
      "upsert:workout_template",
      "upsert:template_item",
      "upsert:template_item",
    ])
    expect(upsertOf(ops, bench.id)).toEqual({
      name: "Bench",
      equipment: "barbell",
      muscle: "chest",
      load_type: "weight",
      rep_min: 8,
      rep_max: 12,
      increment: 2.5,
      archived: false,
      track: null,
    })
    expect(upsertOf(ops, tpl.id)).toEqual({ name: "Full body", sort_order: 0 })
    // The server's own slot id for a template item.
    expect(upsertOf(ops, derivedId("template-item", tpl.id, "1"))).toEqual({
      template_id: tpl.id,
      exercise_id: row.id,
      position: 1,
      sets: 3,
      target_sec: null,
    })
    expect(templateItemId(tpl.id, 0)).toBe(
      derivedId("template-item", tpl.id, "0"),
    )
  })

  test("edit a template slot: only that slot's changed field", () => {
    const e = engine()
    const seen = new Set<string>()
    const { bench, row, tpl } = library()
    step(e, seen)
    upsertTemplate({
      ...tpl,
      items: [
        { exerciseId: bench.id, sets: 4 },
        { exerciseId: row.id, sets: 3 },
      ],
    })
    const ops = step(e, seen)
    expect(names(ops)).toEqual(["upsert:template_item"])
    expect(upsertOf(ops, templateItemId(tpl.id, 0))).toEqual({ sets: 4 })
    deleteTemplate(tpl.id)
    expect(names(step(e, seen))).toEqual([
      "delete:workout_template",
      "delete:template_item",
      "delete:template_item",
    ])
  })

  test("weigh-ins: create, one-field edit, delete", () => {
    const e = engine()
    const seen = new Set<string>()
    const w = logWeighIn(80.24, undefined, undefined, 18.5)
    let ops = step(e, seen)
    expect(upsertOf(ops, w.id)).toEqual({
      measured_at: T0.toISOString(),
      weight_kg: 80.2,
      body_fat_pct: 18.5,
      note: null,
    })
    updateWeighIn(w.id, { note: "after the run" })
    ops = step(e, seen)
    expect(ops).toHaveLength(1)
    expect(upsertOf(ops, w.id)).toEqual({ note: "after the run" })
    deleteWeighIn(w.id)
    expect(names(step(e, seen))).toEqual(["delete:weigh_in"])
  })

  test("start from a template: start_workout first, status never written", () => {
    const e = engine()
    const seen = new Set<string>()
    const { tpl } = library()
    step(e, seen)
    const r = startWorkout({ from: "template", templateId: tpl.id })
    if (!r.ok) throw new Error(r.reason)
    const w = r.workout
    const ops = step(e, seen)
    expect(names(ops)).toEqual([
      "fitness.start_workout",
      "upsert:workout",
      "upsert:workout_exercise",
      "upsert:workout_exercise",
      "upsert:workout_set",
      "upsert:workout_set",
    ])
    expect(ops[0]).toMatchObject({
      data: { source: "empty", workout_id: w.id },
    })
    expect(upsertOf(ops, w.id)).toEqual({
      name: "Full body",
      template_id: tpl.id,
      started_at: T0.toISOString(),
      ended_at: null,
      notes: null,
      source: "live",
    })
    expect(
      w.exercises.map((x) => (upsertOf(ops, x.id) as Payload).position),
    ).toEqual([0, 1])
    const set = w.exercises[0].sets[0]
    // While the workout is live, ticks are toggle_set actions only.
    expect(upsertOf(ops, set.id)).toEqual({
      workout_exercise_id: w.exercises[0].id,
      position: 0,
      reps: 8,
      weight: 0,
      kind: "working",
      duration_sec: null,
      speed_kmh: null,
    })
  })

  test("tick a set: toggle_set (and the rest timer) as actions only", () => {
    const e = engine()
    const seen = new Set<string>()
    const { tpl } = library()
    startWorkout({ from: "template", templateId: tpl.id })
    step(e, seen)
    const w = active()
    const we = w.exercises[0]
    const set = we.sets[0]
    updateSet(w.id, we.id, set.id, { reps: 10, weight: 60 })
    let ops = step(e, seen)
    expect(ops).toHaveLength(1)
    expect(upsertOf(ops, set.id)).toEqual({ reps: 10, weight: 60 })

    jest.setSystemTime(new Date(T0.getTime() + 60_000))
    toggleSet(w.id, we.id, set.id)
    ops = step(e, seen)
    expect(names(ops)).toEqual(["fitness.toggle_set", "fitness.rest.start"])
    expect(ops[0]).toMatchObject({
      data: { workout_id: w.id, workout_exercise_id: we.id, set_id: set.id },
    })
    expect(ops[1]).toMatchObject({ data: { sec: 120 } })

    adjustRest(30)
    ops = step(e, seen)
    expect(names(ops)).toEqual(["fitness.rest.adjust"])
    expect(ops[0]).toMatchObject({ data: { delta: 30 } })
    skipRest()
    expect(names(step(e, seen))).toEqual(["fitness.rest.skip"])

    toggleSet(w.id, we.id, set.id)
    ops = step(e, seen)
    expect(names(ops)).toEqual(["fitness.toggle_set"])
  })

  test("finish, ticking the open sets: finish_workout 'done' then the times", () => {
    const e = engine()
    const seen = new Set<string>()
    const { tpl } = library()
    startWorkout({ from: "template", templateId: tpl.id })
    step(e, seen)
    const w = active()
    toggleSet(w.id, w.exercises[0].id, w.exercises[0].sets[0].id)
    step(e, seen)
    const end = new Date(T0.getTime() + 45 * 60_000).toISOString()
    jest.setSystemTime(new Date(end))
    finishWorkout(w.id, { unfinished: "done" })
    const ops = step(e, seen)
    expect(ops[0]).toMatchObject({
      kind: "action",
      name: "fitness.finish_workout",
      data: { workout_id: w.id, unfinished: "done", end_at: end },
    })
    expect(upsertOf(ops, w.id)).toEqual({ ended_at: end })
    // The workout is no longer live: completed_at is now a plain field.
    const second = w.exercises[1].sets[0]
    expect(upsertOf(ops, second.id)).toEqual({ completed_at: end })
    expect(names(ops)).not.toContain("fitness.toggle_set")
    expect(fitStore.get().activeId).toBeNull()
  })

  test("finish, dropping the open sets: 'remove' and the deletes", () => {
    const e = engine()
    const seen = new Set<string>()
    const { tpl } = library()
    startWorkout({ from: "template", templateId: tpl.id })
    step(e, seen)
    const w = active()
    toggleSet(w.id, w.exercises[0].id, w.exercises[0].sets[0].id)
    step(e, seen)
    finishWorkout(w.id)
    const ops = step(e, seen)
    expect(ops[0]).toMatchObject({
      name: "fitness.finish_workout",
      data: { unfinished: "remove" },
    })
    const deleted = ops.filter((o) => o.kind === "delete").map((o) => o.id)
    expect(deleted).toEqual(
      expect.arrayContaining([w.exercises[1].id, w.exercises[1].sets[0].id]),
    )
  })

  test("discard: discard_workout, then the (no-op) deletes", () => {
    const e = engine()
    const seen = new Set<string>()
    const { tpl } = library()
    startWorkout({ from: "template", templateId: tpl.id })
    step(e, seen)
    const w = active()
    discardWorkout(w.id)
    const ops = step(e, seen)
    expect(names(ops)[0]).toBe("fitness.discard_workout")
    expect(ops[0]).toMatchObject({ data: { workout_id: w.id } })
    expect(names(ops)).toContain("delete:workout")
  })

  test("reorder and re-add exercises: positions only grow, never collide", () => {
    const e = engine()
    const seen = new Set<string>()
    const { tpl, squat } = library()
    startWorkout({ from: "template", templateId: tpl.id })
    const w0 = active()
    addExercises(w0.id, [squat.id])
    let ops = step(e, seen)
    const used = new Set<number>()
    const echo = (list: SyncOp[]) =>
      e.apply(
        list
          .filter((o) => o.kind === "upsert" && o.name === "workout_exercise")
          .map((o) => {
            const cur = active().exercises.find((x) => x.id === o.id)
            const full: Payload = {
              ...(o.data as Payload),
              id: o.id,
              workout_id: w0.id,
              exercise_id: cur?.exerciseId,
            }
            used.add(Number(full.position))
            return change("workout_exercise", full)
          }),
      )
    echo(ops)
    expect([...used].sort()).toEqual([0, 1, 2])

    const [a, b] = active().exercises
    moveExercise(w0.id, b.id, -1)
    ops = step(e, seen)
    const moved = ops.filter((o) => o.name === "workout_exercise")
    const fresh = moved.map((o) => Number((o.data as Payload).position))
    for (const p of fresh) expect(used.has(p)).toBe(false)
    echo(ops)
    expect(
      active()
        .exercises.map((x) => x.id)
        .slice(0, 2),
    ).toEqual([b.id, a.id])
    expect(names(step(e, seen))).toEqual([])

    // Remove the last exercise (its slot stays taken), then add another.
    const last = active().exercises.at(-1)
    removeExercise(w0.id, last?.id as string)
    step(e, seen)
    const [added] = addExercises(w0.id, [squat.id])
    ops = step(e, seen)
    const p = Number((upsertOf(ops, added.id) as Payload).position)
    expect(used.has(p)).toBe(false)
    expect(p).toBeGreaterThan(Math.max(...used))
  })

  test("a workout logged from chat: a finished create with set times", () => {
    const e = engine()
    const seen = new Set<string>()
    library()
    step(e, seen)
    const w = logWorkoutFromChat({
      name: "Push",
      day: "2026-10-18",
      exercises: [{ exercise: "Bench", sets: [{ reps: 8, weight: 60 }] }],
    })
    const ops = step(e, seen)
    expect(names(ops)).toEqual([
      "upsert:workout",
      "upsert:workout_exercise",
      "upsert:workout_set",
    ])
    const data = upsertOf(ops, w.id) as Payload
    expect(data).not.toHaveProperty("status")
    expect(data).toMatchObject({ source: "chat", ended_at: w.endedAt })
    expect(upsertOf(ops, w.exercises[0].sets[0].id)).toMatchObject({
      completed_at: w.startedAt,
      reps: 8,
      weight: 60,
    })
  })

  test("meals: create with items, confirm_meal, answer_follow_up", () => {
    const e = engine()
    const seen = new Set<string>()
    const m = logMeal({
      items: [
        {
          name: "Rice",
          qty: 1,
          unit: "cup",
          kcal: 200,
          protein: 4,
          carbs: 45,
          fat: 0,
        },
        {
          name: "Adobo",
          qty: 1,
          unit: "serving",
          kcal: 350,
          protein: 28,
          carbs: 4,
          fat: 24,
        },
      ],
      label: "lunch",
    })
    let ops = step(e, seen)
    expect(names(ops)).toEqual([
      "upsert:meal",
      "upsert:meal_item",
      "upsert:meal_item",
    ])
    expect(upsertOf(ops, m.id)).toEqual({
      eaten_at: T0.toISOString(),
      label: "lunch",
      source: "manual",
      raw_input: "Rice, Adobo",
      status: "confirmed",
      confidence: null,
      follow_up: null,
    })
    expect(upsertOf(ops, m.items[1].id)).toMatchObject({
      meal_id: m.id,
      position: 1,
    })

    // An estimate that asks how much rice.
    const est: Meal = {
      ...m,
      id: "5d3f7a2e-6f0b-4b7e-9a51-2b8f1c0d9e44",
      status: "estimated",
      confidence: 0.7,
      items: m.items.map((i, k) => ({
        ...i,
        id: `5d3f7a2e-6f0b-4b7e-9a51-2b8f1c0d9e5${k}`,
      })),
      followUp: {
        question: "How much rice?",
        options: ["1 cup", "1.5 cups", "2 cups"],
      },
    }
    fitStore.set((s) => ({ ...s, meals: [...s.meals, est] }))
    step(e, seen)
    answerFollowUp(est.id, "1.5 cups")
    ops = step(e, seen)
    expect(ops[0]).toMatchObject({
      name: "fitness.answer_follow_up",
      data: { meal_id: est.id, option: "1.5 cups" },
    })
    expect(upsertOf(ops, est.items[0].id)).toMatchObject({ qty: 1.5 })
    confirmMeal(est.id)
    ops = step(e, seen)
    expect(names(ops)).toEqual(["fitness.confirm_meal", "upsert:meal"])
    addMealItem(est.id, {
      name: "Egg",
      qty: 1,
      unit: "pc",
      kcal: 70,
      protein: 6,
      carbs: 0,
      fat: 5,
    })
    ops = step(e, seen)
    expect(names(ops)).toEqual(["upsert:meal_item"])
  })

  test("macro target and settings", () => {
    const e = engine()
    const seen = new Set<string>()
    const t = setMacroTarget({ kcal: 2100, protein: 150, carbs: 220, fat: 70 })
    updateSettings({ restSec: 90, weighInReminder: "07:15", units: "lb" })
    const ops = step(e, seen)
    expect(upsertOf(ops, t.id)).toEqual({
      effective_from: "2026-10-19",
      kcal: 2100,
      protein: 150,
      carbs: 220,
      fat: 70,
      sat_fat_max_g: null,
      sugar_max_g: null,
      sodium_max_mg: null,
      fiber_g: null,
    })
    const sid = derivedId("singleton", USER, "fitness_settings")
    expect(upsertOf(ops, sid)).toMatchObject({
      rest_sec: 90,
      weigh_in_reminder: "07:15",
      units: "lb",
    })
  })
})

// ---------------------------------------------------------------- pull

describe("pulled rows", () => {
  const WID = "0b6d9f0e-1c1a-4f7e-8d55-7d2f3a9c1001"
  const WEID = "0b6d9f0e-1c1a-4f7e-8d55-7d2f3a9c1002"
  const SID = "0b6d9f0e-1c1a-4f7e-8d55-7d2f3a9c1003"
  const EXID = "0b6d9f0e-1c1a-4f7e-8d55-7d2f3a9c1004"

  test("children before their workout are attached when it arrives", () => {
    const e = engine()
    e.apply([
      change("exercise", {
        id: EXID,
        name: "Bench",
        equipment: "barbell",
        muscle: "chest",
        load_type: "weight",
        rep_min: 6,
        rep_max: 10,
        increment: 2.5,
        archived: false,
      }),
      change("workout_set", {
        id: SID,
        workout_exercise_id: WEID,
        position: 0,
        reps: 5,
        weight: 80,
        kind: "working",
        completed_at: null,
      }),
      change("workout_exercise", {
        id: WEID,
        workout_id: WID,
        exercise_id: EXID,
        position: 0,
        note: null,
      }),
    ])
    expect(fitStore.get().workouts).toEqual([])
    e.apply([
      change("workout", {
        id: WID,
        name: "Push A",
        template_id: null,
        started_at: "2026-10-19T09:30:00+00:00",
        ended_at: null,
        status: "in_progress",
        notes: null,
        source: "live",
        cardio: null,
      }),
    ])
    const w = fitStore.get().workouts[0] as SyncedWorkout
    expect(w.exercises.map((x) => x.id)).toEqual([WEID])
    expect(w.exercises[0].sets.map((x) => x.id)).toEqual([SID])
    // Started on another device: it becomes this device's active workout.
    expect(fitStore.get().activeId).toBe(WID)
    // The held children were never snapshotted: each goes back once as an
    // unchanged write of the pulled values (a no-op edit on the server).
    const back = e.capture()
    expect(names(back)).toEqual([
      "upsert:workout_exercise",
      "upsert:workout_set",
    ])
    expect(upsertOf(back, WEID)).toEqual({
      workout_id: WID,
      exercise_id: EXID,
      position: 0,
      note: null,
    })
    expect(upsertOf(back, SID)).toEqual({
      workout_exercise_id: WEID,
      position: 0,
      reps: 5,
      weight: 80,
      kind: "working",
      duration_sec: null,
      speed_kmh: null,
    })
    expect(e.capture()).toEqual([])
  })

  test("the user's own limits sync, and re-saving macros keeps them", () => {
    const e = engine()
    const seen = new Set<string>()
    setMacroTarget({
      kcal: 2000,
      protein: 140,
      carbs: 200,
      fat: 65,
      satFatMax: 13,
      sugarMax: 26,
      fiberGoal: 27,
    })
    const t = setMacroTarget({ kcal: 2100, protein: 140, carbs: 200, fat: 65 })
    expect(t).toMatchObject({ satFatMax: 13, sugarMax: 26, fiberGoal: 27 })
    expect("sodiumMax" in t).toBe(false)
    expect(upsertOf(step(e, seen), t.id)).toMatchObject({
      kcal: 2100,
      sat_fat_max_g: 13,
      sugar_max_g: 26,
      sodium_max_mg: null,
      fiber_g: 27,
    })
    // A key set to undefined goes back to the default.
    const reset = setMacroTarget({ ...t, sugarMax: undefined })
    expect("sugarMax" in reset).toBe(false)
    expect(reset.satFatMax).toBe(13)
  })

  test("a pulled target carries the limits it has, and only those", () => {
    const m = fitnessMappers(USER).find(
      (x) => x.entity === "macro_target",
    ) as AnyMapper
    const row = {
      id: "t1",
      effective_from: "2026-10-19",
      kcal: 2000,
      protein: 140,
      carbs: 200,
      fat: 65,
      sat_fat_max_g: 13,
      sugar_max_g: 26,
      sodium_max_mg: null,
      fiber_g: 27,
    }
    expect(m.fromServer(row, fitStore.get())).toEqual({
      id: "t1",
      effectiveFrom: "2026-10-19",
      kcal: 2000,
      protein: 140,
      carbs: 200,
      fat: 65,
      satFatMax: 13,
      sugarMax: 26,
      fiberGoal: 27,
    })
  })

  test("a pulled target replaces the local one for the same day", () => {
    const e = engine()
    const t = setMacroTarget({ kcal: 2000, protein: 140, carbs: 200, fat: 65 })
    e.capture()
    const serverId = derivedId("macro-target", USER, "2026-10-19")
    e.apply([
      change("macro_target", {
        id: serverId,
        effective_from: "2026-10-19",
        kcal: 2000,
        protein: 140,
        carbs: 200,
        fat: 65,
      }),
    ])
    expect(fitStore.get().targets.map((x) => x.id)).toEqual([serverId])
    expect(t.id).not.toBe(serverId)
  })

  test("re-saving today's target edits the synced row, never deletes it", () => {
    // Live E2E: a second save on the same day sent upsert(new id) + delete(old
    // id); the server merged the upsert into the old row by day, then the
    // delete tombstoned it, leaving no target for today.
    const e = engine()
    const serverId = derivedId("macro-target", USER, "2026-10-19")
    e.apply([
      change("macro_target", {
        id: serverId,
        effective_from: "2026-10-19",
        kcal: 2000,
        protein: 140,
        carbs: 200,
        fat: 65,
      }),
    ])
    e.capture()
    const t = setMacroTarget({ kcal: 2050, protein: 158, carbs: 215, fat: 62 })
    const ops = e.capture().filter((o) => o.name === "macro_target")
    expect(t.id).toBe(serverId)
    expect(ops.map((o) => `${o.kind}:${o.id}`)).toEqual([`upsert:${serverId}`])
    expect(fitStore.get().targets.map((x) => x.id)).toEqual([serverId])
  })

  test("the rest timer is never sent as a field write", () => {
    // Live E2E: every sign-in pushed a create for the mapper's constant
    // rest_timer row, which the server (rest_timer is read-only there,
    // written by fitness.rest.* only) refused as unknown_entity.
    fitStore.set((s) => ({ ...s, rest: null }))
    const storage = memoryStorage()
    const e = new SyncEngine({
      http: quietHttp,
      storage,
      outbox: createOutbox(storage),
      mappers: fitnessMappers(USER),
      online: () => false,
    })
    const first = e.capture()
    expect(first.filter((o) => o.name === "rest_timer")).toEqual([])
    fitStore.set((s) => ({
      ...s,
      rest: { endsAt: "2026-10-19T10:02:00.000Z", durationSec: 120 },
    }))
    expect(names(e.capture())).toEqual(["fitness.rest.start"])
    fitStore.set((s) => ({ ...s, rest: null }))
    expect(names(e.capture())).toEqual(["fitness.rest.skip"])
  })

  test("the rest timer: pulled starts and clears never echo", () => {
    const e = engine()
    e.apply([
      change("rest_timer", {
        id: "0b6d9f0e-1c1a-4f7e-8d55-7d2f3a9c1009",
        ends_at: "2026-10-19T10:02:00+00:00",
        duration_sec: 120,
      }),
    ])
    expect(fitStore.get().rest).toEqual({
      endsAt: "2026-10-19T10:02:00.000Z",
      durationSec: 120,
    })
    expect(e.capture()).toEqual([])
    e.apply([
      change(
        "rest_timer",
        { id: "0b6d9f0e-1c1a-4f7e-8d55-7d2f3a9c1009" },
        true,
      ),
    ])
    expect(fitStore.get().rest).toBeNull()
    expect(e.capture()).toEqual([])
  })

  test("a meal pulled with a media photo shows as a photo", () => {
    const m = mealMapper({ hold() {}, drop() {}, take: () => [] })
    const local = m.fromServer(
      {
        id: "0b6d9f0e-1c1a-4f7e-8d55-7d2f3a9c1010",
        eaten_at: "2026-10-19T04:30:00+00:00",
        label: "lunch",
        source: "text",
        photo_media_id: "0b6d9f0e-1c1a-4f7e-8d55-7d2f3a9c1011",
        raw_input: "adobo",
        status: "pending_estimate",
        confidence: null,
        follow_up: null,
      },
      blank(),
    )
    expect(local).toMatchObject({
      photo: true,
      status: "pending_estimate",
      items: [],
    })
  })
})

test("rest actions: start, adjust, restart, skip", () => {
  const r = { endsAt: "2026-10-19T10:02:00.000Z", durationSec: 120 }
  expect(restActions(null, r)).toEqual([
    { name: "fitness.rest.start", data: { sec: 120 } },
  ])
  expect(
    restActions(r, { endsAt: "2026-10-19T10:01:45.000Z", durationSec: 105 }),
  ).toEqual([{ name: "fitness.rest.adjust", data: { delta: -15 } }])
  expect(
    restActions(r, { endsAt: "2026-10-19T10:04:00.000Z", durationSec: 120 }),
  ).toEqual([{ name: "fitness.rest.start", data: { sec: 120 } }])
  expect(restActions(r, null)).toEqual([
    { name: "fitness.rest.skip", data: {} },
  ])
  expect(exerciseMapper().entity).toBe("exercise")
  expect(macroTargetMapper().entity).toBe("macro_target")
})
