// A merge made on the device syncs as one fitness.merge_exercises action:
// the repointed workout and template rows are adopted, never pushed, and a
// refused merge pulls everything again to undo the optimistic local merge.
import {
  mergeExercises,
  setSyncHooks,
  upsertExercise,
  upsertTemplate,
} from "@domain/fitness/actions"
import { type FitnessState, seed } from "@domain/fitness/data"
import { fitStore } from "@domain/fitness/store"
import type { StorageAdapter } from "@domain/lib/store"
import { SyncEngine } from "../engine"
import type { Http } from "../http"
import type { Payload } from "../mapper"
import { exerciseMapper, fitnessMappers } from "../mappers/fitness"
import { createOutbox, type SyncOp } from "../outbox"

const USER = "8a1f6a52-2c36-4b8f-9d34-3b1f5f0f2a11"

function memoryStorage(): StorageAdapter {
  const m = new Map<string, string>()
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  }
}

interface Change {
  entity: string
  id: string
  version: number
  deleted: boolean
  row: Payload | null
}

/** Applies every op, refuses the merge action when told to, and answers a
 * pull with every row above the cursor. */
class Server implements Http {
  rows = new Map<string, Change>()
  version = 0
  pushes: SyncOp[][] = []
  pulls: number[] = []
  refuseMerge = false

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (method === "POST" && path === "/sync/push") {
      const ops = (body as { ops: SyncOp[] }).ops
      this.pushes.push(ops)
      const results = ops.map((op) => {
        if (op.kind === "action")
          return this.refuseMerge && op.name === "fitness.merge_exercises"
            ? {
                op_id: op.op_id,
                status: "rejected",
                code: "merge_load_type_mismatch",
              }
            : { op_id: op.op_id, status: "applied" }
        const key = `${op.name}:${op.id}`
        const prev = this.rows.get(key)
        const row = { ...(prev?.row ?? {}), ...(op.data ?? {}), id: op.id }
        this.rows.set(key, {
          entity: op.name,
          id: String(op.id),
          version: ++this.version,
          deleted: op.kind === "delete",
          row: op.kind === "delete" ? null : row,
        })
        return { op_id: op.op_id, status: "applied", row }
      })
      return { results } as T
    }
    const cursor = Number(new URL(`http://x${path}`).searchParams.get("cursor"))
    this.pulls.push(cursor)
    const changes = [...this.rows.values()].filter((c) => c.version > cursor)
    return { changes, cursor: this.version, truncated: false } as T
  }
  raw = async () => {
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

function setup() {
  fitStore.set(blank())
  const server = new Server()
  const storage = memoryStorage()
  const engine = new SyncEngine({
    http: server,
    storage,
    outbox: createOutbox(storage),
    mappers: fitnessMappers(USER),
    online: () => true,
  })
  setSyncHooks({
    flush: () => engine.capture(),
    adopt: (entity, ids) => engine.adopt(entity, ids),
  })
  const a = upsertExercise({ name: "Bench press" })
  const b = upsertExercise({ name: "Barbell Bench Press" })
  const at = "2026-10-20T10:00:00.000Z"
  fitStore.set((s) => ({
    ...s,
    workouts: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Push",
        startedAt: at,
        endedAt: at,
        status: "finished",
        clientId: "c1",
        exercises: [
          {
            id: "22222222-2222-4222-8222-222222222222",
            exerciseId: a.id,
            sets: [],
          },
        ],
      },
    ],
  }))
  upsertTemplate({ name: "Push", items: [{ exerciseId: a.id, sets: 3 }] })
  return { server, engine, a, b }
}

afterEach(() => setSyncHooks(null))

const exerciseRefs = () => [
  ...fitStore
    .get()
    .workouts.flatMap((w) => w.exercises.map((e) => e.exerciseId)),
  ...fitStore.get().templates.flatMap((t) => t.items.map((i) => i.exerciseId)),
]

test("a merge pushes the action and no repointed rows", async () => {
  const { server, engine, a, b } = setup()
  engine.capture()
  await engine.sync()
  server.pushes = []

  expect(mergeExercises(a.id, b.id).ok).toBe(true)
  const ops = engine.capture()

  expect(
    ops.map((o) => (o.kind === "action" ? o.name : `${o.kind}:${o.name}`)),
  ).toEqual(["fitness.merge_exercises"])
  expect(ops[0].data).toEqual({ source_id: a.id, target_id: b.id })
  await engine.sync()
  // Applied: an ordinary cursor pull, not a full one.
  expect(server.pulls.at(-1)).toBeGreaterThan(0)
})

test("a refused merge pulls everything and restores the pre-merge rows", async () => {
  const { server, engine, a, b } = setup()
  engine.capture()
  await engine.sync()
  server.refuseMerge = true

  mergeExercises(a.id, b.id)
  expect(exerciseRefs()).toEqual([b.id, b.id])
  engine.capture()
  await engine.sync()

  expect(server.pulls.at(-1)).toBe(0)
  expect(exerciseRefs()).toEqual([a.id, a.id])
  const src = fitStore.get().exercises.find((e) => e.id === a.id)
  expect(src?.mergedInto).toBeUndefined()
  expect(src?.archived).toBeUndefined()
  expect(
    fitStore.get().exercises.find((e) => e.id === b.id)?.aliases,
  ).toBeUndefined()
})

test("the exercise mapper reads aliases and the pointer, and never sends them", () => {
  const m = exerciseMapper()
  const local = m.fromServer(
    {
      id: "e",
      name: "Barbell Bench Press",
      equipment: "barbell",
      muscle: "chest",
      load_type: "weight",
      rep_min: 6,
      rep_max: 10,
      increment: 2.5,
      archived: true,
      aliases: ["Bench press"],
      merged_into_id: "t",
    },
    blank(),
  )
  expect(local).toMatchObject({ aliases: ["Bench press"], mergedInto: "t" })
  const sent = m.toServer(local!, blank())
  expect(sent).not.toHaveProperty("aliases")
  expect(sent).not.toHaveProperty("merged_into_id")
  // A merged row's archive is the merge action's.
  expect(sent).not.toHaveProperty("archived")
})
