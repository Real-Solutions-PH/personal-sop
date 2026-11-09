// Built-in (global) exercises and routines reach the phone read-only: the
// pulled `is_global` becomes `builtIn`, the actions refuse to change one
// offline, and so no write or delete naming one ever leaves the device.
import * as A from "@domain/fitness/actions"
import { type FitnessState, seed } from "@domain/fitness/data"
import { duplicateCandidates } from "@domain/fitness/dupes"
import { fitStore } from "@domain/fitness/store"
import { liveStore } from "@domain/lib/live"
import type { StorageAdapter } from "@domain/lib/store"
import { SyncEngine } from "../engine"
import type { Http } from "../http"
import type { Payload } from "../mapper"
import { fitnessMappers, templateItemId } from "../mappers/fitness"
import { createOutbox } from "../outbox"

const USER = "8a1f6a52-2c36-4b8f-9d34-3b1f5f0f2a11"
const BENCH = "5b0c1e0a-0000-4000-8000-000000000001"
const PLANK = "5b0c1e0a-0000-4000-8000-000000000002"
const PUSH = "5b0c1e0a-0000-4000-8000-000000000003"

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

const change = (entity: string, row: Payload) => ({
  entity,
  id: String(row.id),
  version: 1,
  deleted: false,
  row,
})
const exerciseRow = (id: string, name: string, load = "weight") => ({
  id,
  name,
  equipment: "barbell",
  muscle: "chest",
  load_type: load,
  rep_min: 6,
  rep_max: 10,
  increment: 2.5,
  archived: false,
  is_global: true,
})

/** The built-in library as a pull brings it: two exercises and a routine. */
function pullBuiltIns() {
  const e = engine()
  e.apply([
    change("exercise", exerciseRow(BENCH, "Barbell Bench Press")),
    change("exercise", exerciseRow(PLANK, "Plank", "time")),
    change("workout_template", {
      id: PUSH,
      name: "Push A",
      sort_order: 0,
      is_global: true,
    }),
    change("template_item", {
      id: templateItemId(PUSH, 0),
      template_id: PUSH,
      exercise_id: BENCH,
      position: 0,
      sets: 3,
      target_sec: null,
      is_global: true,
    }),
  ])
  expect(e.capture()).toEqual([])
  return e
}

const named = (ops: { id?: string | null }[], ids: string[]) =>
  ops.filter((o) => o.id && ids.includes(o.id))

beforeEach(() => {
  fitStore.set(blank())
  liveStore.set({ live: null })
})

test("pulled built-ins are marked, and own rows are not", () => {
  pullBuiltIns()
  const s = fitStore.get()
  expect(s.exercises.map((x) => [x.name, x.builtIn])).toEqual([
    ["Barbell Bench Press", true],
    ["Plank", true],
  ])
  expect(s.templates[0]).toMatchObject({ name: "Push A", builtIn: true })
  expect(s.templates[0].items).toEqual([{ exerciseId: BENCH, sets: 3 }])
  const mine = A.upsertExercise({ name: "Sled push" })
  expect(mine.builtIn).toBeUndefined()
})

test("offline edits of a built-in change nothing and send nothing", () => {
  const e = pullBuiltIns()
  const before = fitStore.get()
  A.upsertExercise({ id: BENCH, name: "Renamed", increment: 5 })
  A.setExerciseArchived(BENCH, true)
  A.upsertTemplate({ id: PUSH, name: "Mine now", items: [] })
  expect(A.deleteTemplate(PUSH)).toBeUndefined()
  const merge = A.mergeExercises(BENCH, PLANK)
  expect(merge.ok).toBe(false)
  expect(fitStore.get().exercises).toEqual(before.exercises)
  expect(fitStore.get().templates).toEqual(before.templates)
  expect(e.capture()).toEqual([])
})

test("own routines around a built-in never write the built-in", () => {
  const e = pullBuiltIns()
  const mine = A.upsertExercise({ name: "Landmine press" })
  const first = A.upsertTemplate({
    name: "Upper",
    items: [{ exerciseId: mine.id, sets: 3 }],
  })
  // Put my routine above the built-in, then delete it: the built-in's
  // place in the list moves, which must not become a write.
  fitStore.set((s) => ({
    ...s,
    templates: [
      ...s.templates.filter((t) => t.id === first.id),
      ...s.templates.filter((t) => t.id !== first.id),
    ],
  }))
  e.capture()
  A.deleteTemplate(first.id)
  const ops = e.capture()
  expect(named(ops, [PUSH, BENCH, templateItemId(PUSH, 0)])).toEqual([])
  expect(ops.some((o) => o.kind === "delete" && o.id === first.id)).toBe(true)
})

test("a copy of a built-in routine is the person's own and syncs as new", () => {
  const e = pullBuiltIns()
  const copy = A.copyTemplate(PUSH)
  expect(copy).toMatchObject({
    name: "Push A (copy)",
    items: [{ exerciseId: BENCH, sets: 3 }],
  })
  expect(copy?.builtIn).toBeUndefined()
  A.upsertTemplate({ id: copy?.id, name: "My push", items: [] })
  const ops = e.capture()
  expect(named(ops, [PUSH])).toEqual([])
  expect(ops.some((o) => o.kind === "upsert" && o.id === copy?.id)).toBe(true)
})

test("merging my exercise into a built-in leaves the built-in untouched", () => {
  const e = pullBuiltIns()
  const mine = A.upsertExercise({ name: "Bench press" })
  e.capture()
  const r = A.mergeExercises(mine.id, BENCH)
  expect(r.ok).toBe(true)
  const bench = fitStore.get().exercises.find((x) => x.id === BENCH)
  expect(bench?.aliases).toBeUndefined()
  const ops = e.capture()
  expect(ops.filter((o) => o.kind === "upsert" && o.id === BENCH)).toEqual([])
  expect(ops.map((o) => o.name)).toContain("fitness.merge_exercises")
})

test("a duplicate pair keeps the built-in; two built-ins are no pair", () => {
  pullBuiltIns()
  A.upsertExercise({ name: "Barbell bench press" })
  A.upsertExercise({ id: "b2", name: "Plank", loadType: "time" })
  fitStore.set((s) => ({
    ...s,
    exercises: s.exercises.map((x) =>
      x.id === "b2" ? { ...x, builtIn: true } : x,
    ),
  }))
  const pairs = duplicateCandidates(fitStore.get(), [])
  expect(pairs.map((p) => [p.keep.id, p.merge.name])).toEqual([
    [BENCH, "Barbell bench press"],
  ])
})
