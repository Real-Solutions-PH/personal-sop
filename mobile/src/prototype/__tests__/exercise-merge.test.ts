// Merging duplicate exercises on the device, the duplicate suggestions, and
// the name lookups that follow a merge.
import * as FA from "@domain/fitness/actions"
import * as C from "@domain/fitness/calc"
import type { Exercise, Workout } from "@domain/fitness/data"
import {
  dismissDuplicate,
  dupesStore,
  duplicateCandidates,
} from "@domain/fitness/dupes"
import { starterRows } from "@domain/fitness/starter"
import { fitStore } from "@domain/fitness/store"
import { configureStorage, resetAll } from "@domain/lib/store"

const OWNER = "8b1f7c55-0c0e-4b7e-9a51-2f7e2d1c3a10"

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  fitStore.set((s) => ({ ...s, exercises: [], templates: [], workouts: [] }))
  FA.setSyncHooks(null)
})

const ex = (id: string, name: string, extra: Partial<Exercise> = {}) =>
  FA.upsertExercise({ id, name, ...extra })

function session(id: string, exerciseId: string, day: number): Workout {
  const at = new Date(Date.UTC(2026, 9, day, 18)).toISOString()
  return {
    id,
    name: "Session",
    startedAt: at,
    endedAt: at,
    status: "finished",
    clientId: id,
    exercises: [
      {
        id: `${id}-we`,
        exerciseId,
        sets: [
          {
            id: `${id}-s`,
            reps: 5,
            weight: 100,
            kind: "working",
            completedAt: at,
          },
        ],
      },
    ],
  }
}

function seedPair() {
  const a = ex("a", "Bench press")
  const b = ex("b", "Barbell Bench Press")
  fitStore.set((s) => ({
    ...s,
    workouts: [session("w1", "a", 1), session("w2", "b", 2)],
    templates: [
      { id: "t", name: "Push", items: [{ exerciseId: "a", sets: 3 }] },
    ],
  }))
  return { a, b }
}

describe("mergeExercises", () => {
  it("moves history and slots to the target and archives the source", () => {
    seedPair()
    const r = FA.mergeExercises("a", "b")
    expect(r.ok).toBe(true)
    const s = fitStore.get()
    expect(
      s.workouts.flatMap((w) => w.exercises.map((e) => e.exerciseId)),
    ).toEqual(["b", "b"])
    expect(s.templates[0].items[0].exerciseId).toBe("b")
    const src = s.exercises.find((e) => e.id === "a")
    expect(src).toMatchObject({ archived: true, mergedInto: "b" })
    expect(s.exercises.find((e) => e.id === "b")?.aliases).toEqual([
      "Bench press",
    ])
    expect(C.exerciseHistory(s, "b")).toHaveLength(2)
    expect(C.liveExercises(s).map((e) => e.id)).toEqual(["b"])
  })

  it("refuses another type, itself, and a source already merged", () => {
    seedPair()
    ex("p", "Plank", { loadType: "time" })
    ex("c", "Bench C")
    expect(FA.mergeExercises("a", "p")).toEqual({
      ok: false,
      reason: "Only exercises of the same type can merge",
    })
    expect(FA.mergeExercises("a", "a").ok).toBe(false)
    expect(FA.mergeExercises("a", "b").ok).toBe(true)
    expect(FA.mergeExercises("a", "c")).toEqual({
      ok: false,
      reason: "That exercise was already merged",
    })
  })

  it("flushes pending edits first, then adopts the repointed rows", () => {
    seedPair()
    const calls: string[] = []
    FA.setSyncHooks({
      flush: () => calls.push("flush"),
      adopt: (entity, ids) => calls.push(`${entity}:${ids.length}`),
    })
    FA.mergeExercises("a", "b")
    expect(calls).toEqual(["flush", "workout_exercise:1", "template_item:1"])
  })

  it("keeps a merged exercise archived and a survivor's aliases on edit", () => {
    seedPair()
    FA.mergeExercises("a", "b")
    FA.setExerciseArchived("a", false)
    FA.upsertExercise({ id: "b", name: "Barbell bench press" })
    const s = fitStore.get()
    expect(s.exercises.find((e) => e.id === "a")?.archived).toBe(true)
    expect(s.exercises.find((e) => e.id === "b")?.aliases).toEqual([
      "Bench press",
    ])
  })
})

describe("finding a merged name", () => {
  it("search and chat logging land on the survivor", () => {
    seedPair()
    FA.mergeExercises("a", "b")
    const b = fitStore.get().exercises.find((e) => e.id === "b") as Exercise
    expect(C.exerciseMatches(b, "bench pr")).toBe(true)
    const before = fitStore.get().exercises.length
    const w = FA.logWorkoutFromChat({
      name: "Chat",
      exercises: [{ exercise: "bench press", sets: [{ reps: 5, weight: 80 }] }],
    })
    expect(w.exercises[0].exerciseId).toBe("b")
    expect(fitStore.get().exercises).toHaveLength(before)
  })

  it("the starter library never adds back a name merged away", () => {
    ex("mine", "My bench")
    const starter = starterRows(fitStore.get(), OWNER).exercises.find(
      (e) => e.name === "Barbell Bench Press",
    ) as Exercise
    fitStore.set((s) => ({ ...s, exercises: [...s.exercises, starter] }))
    expect(FA.mergeExercises(starter.id, "mine").ok).toBe(true)
    const again = starterRows(fitStore.get(), OWNER)
    expect(again.exercises.map((e) => e.name)).not.toContain(
      "Barbell Bench Press",
    )
  })
})

describe("duplicateCandidates", () => {
  it("pairs names equal once normalised", () => {
    ex("x", "Pull-ups", { loadType: "bodyweight", muscle: "back" })
    ex("y", "pullup", { loadType: "bodyweight", muscle: "back" })
    const pairs = duplicateCandidates(fitStore.get(), [])
    expect(pairs.map((p) => [p.merge.id, p.keep.id, p.reason])).toEqual([
      ["y", "x", "same name"],
    ])
  })

  it("pairs a name plus its own equipment word, never another's", () => {
    const { a, b } = seedPair()
    ex("db", "Dumbbell Bench Press", { equipment: "dumbbell" })
    ex("back", "Bench press row", { muscle: "back" })
    const pairs = duplicateCandidates(fitStore.get(), []).map((p) => ({
      ids: new Set([p.keep.id, p.merge.id]),
      reason: p.reason,
    }))
    expect(pairs).toContainEqual({
      ids: new Set([a.id, b.id]),
      reason: "name contains",
    })
    // Different equipment: a different lift, whatever the name.
    expect(pairs.some((p) => p.ids.has("db"))).toBe(false)
    expect(pairs.some((p) => p.ids.has("back"))).toBe(false)
  })

  it("keeps the one with more sessions", () => {
    seedPair()
    fitStore.set((s) => ({
      ...s,
      workouts: [...s.workouts, session("w3", "a", 3)],
    }))
    const [p] = duplicateCandidates(fitStore.get(), [])
    expect([p.merge.id, p.keep.id]).toEqual(["b", "a"])
  })

  it("leaves out different muscles and dismissed pairs", () => {
    ex("c1", "Bench Press", { muscle: "chest" })
    ex("c2", "Barbell Bench Press", { muscle: "triceps" })
    expect(duplicateCandidates(fitStore.get(), [])).toEqual([])
    ex("c3", "barbell bench press", { muscle: "triceps" })
    expect(duplicateCandidates(fitStore.get())).toHaveLength(1)
    dismissDuplicate("c3", "c2")
    expect(dupesStore.get().dismissed).toEqual(["c2|c3"])
    expect(duplicateCandidates(fitStore.get())).toEqual([])
  })
})
