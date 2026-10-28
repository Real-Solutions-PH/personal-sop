// The starter gym library and splits, the rest timer's −15/+15, and the
// alarm that rings when rest is over.
import * as FA from "@domain/fitness/actions"
import { STARTER_EXERCISES, STARTER_SPLITS } from "@domain/fitness/starter"
import { fitStore } from "@domain/fitness/store"
import { isUuid } from "@domain/lib/ids"
import { configureStorage, resetAll } from "@domain/lib/store"
import { restNotice } from "../rest-alarm"

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
})

const OWNER = "8b1f7c55-0c0e-4b7e-9a51-2f7e2d1c3a10"

describe("starter library", () => {
  it("gives an empty account every exercise and complete splits", () => {
    fitStore.set((s) => ({ ...s, exercises: [], templates: [] }))
    const added = FA.installStarter(OWNER)
    const s = fitStore.get()
    expect(added.exercises).toBe(STARTER_EXERCISES.length)
    expect(added.templates).toBeGreaterThanOrEqual(10)
    const ids = new Set(s.exercises.map((e) => e.id))
    for (const e of s.exercises) expect(isUuid(e.id)).toBe(true)
    for (const t of s.templates) {
      expect(isUuid(t.id)).toBe(true)
      expect(t.items.length).toBeGreaterThanOrEqual(5)
      for (const it of t.items) expect(ids.has(it.exerciseId)).toBe(true)
    }
    // Synced rows: names fit the server's 80 characters, reps its check.
    for (const e of s.exercises) {
      expect(e.name.length).toBeLessThanOrEqual(80)
      expect(e.repMax).toBeGreaterThanOrEqual(e.repMin)
    }
  })

  it("never doubles an exercise the account has, and runs again as a no-op", () => {
    fitStore.set((s) => ({
      ...s,
      exercises: s.exercises.filter((e) => e.name === "Barbell Bench Press"),
      templates: [],
    }))
    const bench = fitStore.get().exercises[0]
    FA.installStarter(OWNER)
    const s = fitStore.get()
    expect(
      s.exercises.filter((e) => e.name === "Barbell Bench Press"),
    ).toHaveLength(1)
    // A split using the bench uses the account's own bench.
    const upper = s.templates.find((t) => t.name === "Upper")
    expect(upper?.items[0].exerciseId).toBe(bench.id)
    expect(FA.installStarter(OWNER)).toEqual({ exercises: 0, templates: 0 })
  })

  it("an account with its own splits gets the exercises but no splits", () => {
    fitStore.set((s) => ({
      ...s,
      exercises: [],
      templates: [{ id: "mine", name: "My Day", items: [] }],
    }))
    const added = FA.installStarter(OWNER)
    expect(added.exercises).toBe(STARTER_EXERCISES.length)
    expect(added.templates).toBe(0)
    expect(fitStore.get().templates.map((t) => t.name)).toEqual(["My Day"])
  })
})

describe("rest timer", () => {
  const ends = () => new Date(fitStore.get().rest?.endsAt ?? 0).getTime()

  it("+15 and −15 move the end and the length together", () => {
    FA.startRest(90)
    const before = ends()
    FA.adjustRest(15)
    expect(ends()).toBe(before + 15_000)
    expect(fitStore.get().rest?.durationSec).toBe(105)
    FA.adjustRest(-15)
    FA.adjustRest(-15)
    expect(ends()).toBe(before - 15_000)
    expect(fitStore.get().rest?.durationSec).toBe(75)
  })

  it("−15 with less than 15 seconds left ends rest now, not in the past", () => {
    FA.startRest(10)
    FA.adjustRest(-15)
    expect(ends()).toBeGreaterThanOrEqual(Date.now() - 1000)
    expect(ends()).toBeLessThanOrEqual(Date.now() + 1000)
    expect(fitStore.get().rest?.durationSec).toBe(0)
  })

  it("rings when rest is over, following every adjustment", () => {
    FA.startRest(60)
    expect(restNotice(fitStore.get())?.at.getTime()).toBe(ends())
    FA.adjustRest(15)
    expect(restNotice(fitStore.get())?.at.getTime()).toBe(ends())
    FA.skipRest()
    expect(restNotice(fitStore.get())).toBeNull()
  })
})

describe("a set's own unit", () => {
  it("carries to the next set and to next time's plan", () => {
    const ex = fitStore.get().exercises.find((e) => e.loadType === "weight")
    if (!ex) throw new Error("no weighted exercise in the seed")
    const res = FA.startWorkout({ from: "empty" })
    if (!res.ok) throw new Error(res.reason)
    const w = res.workout
    const [we] = FA.addExercises(w.id, [ex.id])
    // Every set entered in lb: stored in kg, shown in lb.
    const sets =
      fitStore.get().workouts.find((x) => x.id === w.id)?.exercises[0].sets ??
      []
    for (const x of sets) FA.updateSet(w.id, we.id, x.id, { unit: "lb" })
    expect(FA.addSet(w.id, we.id).unit).toBe("lb")
    FA.finishWorkout(w.id, { unfinished: "done" })
    const next = FA.plannedSets(ex.id, 3).filter((x) => x.kind === "working")
    expect(next.every((x) => x.unit === "lb")).toBe(true)
  })
})

describe("demo data", () => {
  it("starts with the whole gym library and every split, no name twice", () => {
    const s = fitStore.get()
    const names = s.exercises.map((e) => e.name.toLowerCase())
    expect(new Set(names).size).toBe(names.length)
    for (const [, name] of STARTER_EXERCISES)
      expect(names).toContain(name.toLowerCase())
    const splits = s.templates.map((t) => t.name)
    for (const [, name] of STARTER_SPLITS) expect(splits).toContain(name)
    // The demo's own history still runs on its Push/Pull/Legs A.
    expect(splits.slice(0, 3)).toEqual(["Push A", "Pull A", "Legs A"])
    const ids = new Set(s.exercises.map((e) => e.id))
    for (const t of s.templates)
      for (const it of t.items) expect(ids.has(it.exerciseId)).toBe(true)
  })
})

describe("a split for someone who never trained", () => {
  it("plans every set the split asks for, not one", () => {
    fitStore.set((s) => ({ ...s, workouts: [], exercises: [], templates: [] }))
    FA.installStarter(OWNER)
    const push = fitStore.get().templates.find((t) => t.name === "Push")
    if (!push) throw new Error("no Push split")
    const res = FA.startWorkout({ from: "template", templateId: push.id })
    if (!res.ok) throw new Error(res.reason)
    expect(res.workout.exercises.map((e) => e.sets.length)).toEqual(
      push.items.map((it) => it.sets),
    )
  })
})
