// Timed exercises (walking, running, planks): a template goal sets the
// planned time, speed carries over from last time, times format plainly,
// and timed sets never count toward lifting volume.
import * as A from "@domain/fitness/actions"
import * as C from "@domain/fitness/calc"
import { fitStore } from "@domain/fitness/store"
import { configureStorage, resetAll } from "@domain/lib/store"

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
})

it("formats a time plainly", () => {
  expect(C.fmtSpan(45)).toBe("45 s")
  expect(C.fmtSpan(1200)).toBe("20 min")
  expect(C.fmtSpan(90)).toBe("1:30")
})

it("a template's goal is the planned time: one 20-minute walk", () => {
  const sets = A.plannedSets("walk", 3, 1200)
  expect(sets).toHaveLength(1)
  expect(sets[0]).toMatchObject({ durationSec: 1200, reps: 0, kind: "working" })
  const sug = C.suggestion(fitStore.get(), "walk", 1200)
  expect(sug.badge).toBe("Goal 20 min")
  expect(sug.detail).toBe("First time — aim for 20 min.")
})

it("without a goal, cardio starts at 10 minutes and a plank at one", () => {
  expect(A.plannedSets("walk")[0].durationSec).toBe(600)
  expect(A.plannedSets("plank")[0].durationSec).toBe(60)
})

it("next time keeps last time's speed and says how it went", () => {
  const t = fitStore.get().templates[0]
  fitStore.set((s) => ({
    ...s,
    templates: s.templates.map((x) =>
      x.id === t.id
        ? { ...x, items: [{ exerciseId: "walk", sets: 1, targetSec: 1200 }] }
        : x,
    ),
  }))
  const res = A.startWorkout({ from: "template", templateId: t.id })
  if (!res.ok) throw new Error(res.reason)
  const w = res.workout
  const [we] = w.exercises
  expect(we.sets[0].durationSec).toBe(1200)
  A.updateSet(w.id, we.id, we.sets[0].id, { durationSec: 1080, speedKmh: 5.5 })
  A.toggleSet(w.id, we.id, we.sets[0].id)
  A.finishWorkout(w.id, { unfinished: "remove" })
  const sug = C.suggestion(fitStore.get(), "walk", 1200)
  expect(sug.detail).toBe("Last time 18 min at 5.5 km/h.")
  const [next] = A.plannedSets("walk", 1, 1200)
  expect(next).toMatchObject({ durationSec: 1200, speedKmh: 5.5 })
  // A timed set adds nothing to lifting volume.
  const done = fitStore.get().workouts.find((x) => x.id === w.id)!
  const ex = fitStore.get().exercises.find((e) => e.id === "walk")
  expect(C.exStats(done.exercises[0], ex, 70).volume).toBe(0)
})
