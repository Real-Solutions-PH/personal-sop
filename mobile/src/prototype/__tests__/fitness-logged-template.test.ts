// A workout logged without a template becomes one of the person's own
// templates when it finishes: its exercises and working-set counts, linked
// back so the Templates list says "last <day>". Logging it again under the
// same name updates that template instead of adding a copy; a workout
// started from a template never adds one; and the person can delete it
// like any other template of theirs.
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

const own = () => fitStore.get().templates.filter((t) => !t.builtIn)
const exIds = () =>
  fitStore
    .get()
    .exercises.filter((e) => !C.isTimed(e))
    .slice(0, 2)
    .map((e) => e.id)

/** Start a free workout named ``name`` with ``sets`` working sets per
 * exercise (and one warm-up on the first), tick everything, finish it. */
function logFree(name: string, plan: [string, number][]) {
  const res = A.startWorkout({ from: "empty" })
  if (!res.ok) throw new Error(res.reason)
  const w = res.workout
  A.updateWorkoutMeta(w.id, { name })
  const wes = A.addExercises(
    w.id,
    plan.map(([id]) => id),
  )
  plan.forEach(([, n], i) => {
    const we = wes[i]
    const sets = () =>
      fitStore
        .get()
        .workouts.find((x) => x.id === w.id)
        ?.exercises.find((e) => e.id === we.id)?.sets ?? []
    for (const x of sets()) A.removeSet(w.id, we.id, x.id)
    if (i === 0) {
      const warm = A.addSet(w.id, we.id)
      A.updateSet(w.id, we.id, warm.id, { kind: "warmup" })
    }
    for (let k = 0; k < n; k++) A.addSet(w.id, we.id)
    for (const x of sets()) A.toggleSet(w.id, we.id, x.id)
  })
  return A.finishWorkout(w.id)
}

test("a free workout is kept as the person's own template, linked back", () => {
  const before = own().length
  const [a, b] = exIds()
  const w = logFree("Upper", [
    [a, 3],
    [b, 2],
  ])
  const mine = own()
  expect(mine).toHaveLength(before + 1)
  const tpl = mine.at(-1)
  expect(tpl).toMatchObject({
    name: "Upper",
    items: [
      { exerciseId: a, sets: 3 },
      { exerciseId: b, sets: 2 },
    ],
  })
  expect(tpl?.builtIn).toBeFalsy()
  expect(w?.templateId).toBe(tpl?.id)
  // The list subtitle's "last <day>" reads this link.
  expect(C.lastOfTemplate(fitStore.get(), tpl?.id ?? "")?.id).toBe(w?.id)
})

test("logging it again under the same name updates it, no copy", () => {
  const [a, b] = exIds()
  logFree("Upper", [[a, 3]])
  const count = own().length
  const again = logFree(" upper ", [
    [a, 4],
    [b, 3],
  ])
  expect(own()).toHaveLength(count)
  const tpl = own().find((t) => t.id === again?.templateId)
  expect(tpl?.name).toBe("Upper")
  expect(tpl?.items).toEqual([
    { exerciseId: a, sets: 4 },
    { exerciseId: b, sets: 3 },
  ])
})

test("a workout started from a template adds none and leaves it as it is", () => {
  const [a] = exIds()
  const tpl = A.upsertTemplate({
    name: "Push",
    items: [{ exerciseId: a, sets: 3 }],
  })
  const count = fitStore.get().templates.length
  const res = A.startWorkout({ from: "template", templateId: tpl.id })
  if (!res.ok) throw new Error(res.reason)
  A.addSet(res.workout.id, res.workout.exercises[0].id)
  for (const we of res.workout.exercises)
    for (const x of fitStore
      .get()
      .workouts.find((w) => w.id === res.workout.id)
      ?.exercises.find((e) => e.id === we.id)?.sets ?? [])
      A.toggleSet(res.workout.id, we.id, x.id)
  const w = A.finishWorkout(res.workout.id)
  expect(fitStore.get().templates).toHaveLength(count)
  expect(w?.templateId).toBe(tpl.id)
  expect(fitStore.get().templates.find((t) => t.id === tpl.id)?.items).toEqual([
    { exerciseId: a, sets: 3 },
  ])
})

test("repeating a kept workout adds no copy", () => {
  const [a] = exIds()
  const first = logFree("Legs", [[a, 3]])
  const count = own().length
  const res = A.startWorkout({ from: "repeat", workoutId: first?.id ?? "" })
  if (!res.ok) throw new Error(res.reason)
  for (const we of res.workout.exercises)
    for (const x of we.sets) A.toggleSet(res.workout.id, we.id, x.id)
  const w = A.finishWorkout(res.workout.id)
  expect(own()).toHaveLength(count)
  expect(w?.templateId).toBe(first?.templateId)
})

test("the person can delete a kept template like any of theirs", () => {
  const [a] = exIds()
  const w = logFree("Upper", [[a, 3]])
  const id = w?.templateId ?? ""
  expect(A.deleteTemplate(id)?.id).toBe(id)
  expect(fitStore.get().templates.some((t) => t.id === id)).toBe(false)
})

test("a workout finished with nothing done keeps no template", () => {
  const count = fitStore.get().templates.length
  const res = A.startWorkout({ from: "empty" })
  if (!res.ok) throw new Error(res.reason)
  A.addExercises(res.workout.id, [exIds()[0]])
  A.finishWorkout(res.workout.id)
  expect(fitStore.get().templates).toHaveLength(count)
})

test("a template the person made with the same name is never rewritten", () => {
  const [a, b] = exIds()
  const mine = A.upsertTemplate({
    name: "Arms",
    items: [{ exerciseId: b, sets: 5 }],
  })
  const w = logFree("Arms", [[a, 2]])
  expect(w?.templateId).not.toBe(mine.id)
  expect(fitStore.get().templates.find((t) => t.id === mine.id)?.items).toEqual(
    [{ exerciseId: b, sets: 5 }],
  )
})
