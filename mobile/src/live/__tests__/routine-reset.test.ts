// Starting a routine over: the open run ends unfinished, the next start is a
// fresh run at step one, and the server hears it as habits.run.abandon.
import * as A from "@domain/habits/actions"
import { habitsStore } from "@domain/habits/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { runActions } from "../mappers/habits"

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
})

it("ends today's run and the next start begins at step one", () => {
  const routine = habitsStore.get().routines[0]
  A.exitRoutine()
  const run = A.startRoutine(routine.id)
  expect(run).not.toBeNull()
  A.stepContinue(A.activeRun(routine.id)!)
  expect(A.activeRun(routine.id)?.current).toBe(1)

  A.resetRoutine(routine.id)
  const ended = habitsStore.get().runs.find((r) => r.id === run!.id)
  expect(ended?.state).toBe("abandoned")
  expect(A.activeRun(routine.id)).toBeUndefined()

  const again = A.startRoutine(routine.id)
  expect(again?.id).not.toBe(run!.id)
  expect(again?.current).toBe(0)
})

it("is sent as one abandon action", () => {
  const run = { ...habitsStore.get().runs[0], state: "in_progress" as const }
  expect(runActions(run, { ...run, state: "abandoned" })).toEqual([
    { name: "habits.run.abandon", data: { run_id: run.id } },
  ])
})
