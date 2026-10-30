// Finished workouts reach Apple Health once, only with the switch on, and
// leave it only when a workout seen present earlier is gone, never merely
// because the store is blank or half-pulled after a sign-in.
import * as FA from "@domain/fitness/actions"
import type { Workout } from "@domain/fitness/data"
import { fitStore } from "@domain/fitness/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { toast } from "sonner-native"
import { syncReady } from "@/live/ready"

let mockOwner: string | null = "A"
jest.mock("@/live/config", () => ({ liveMode: true }))
jest.mock("@/live/runtime", () => ({ liveOwner: () => mockOwner }))
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
}))
jest.mock("@sentry/react-native", () => ({ captureMessage: jest.fn() }))
let mockCanWrite = true
let uuids = 0
const mockSave = jest.fn(async (_i: unknown): Promise<string | null> => {
  uuids += 1
  return `hk-${uuids}`
})
const mockDelete = jest.fn(async (_uuid: string) => true)
jest.mock("../health", () => ({
  canWriteWorkouts: () => mockCanWrite,
  saveWorkout: (i: unknown) => mockSave(i),
  deleteSavedWorkout: (u: string) => mockDelete(u),
}))

import {
  connectHealthWorkouts,
  healthWorkoutsStore,
  RECONCILE_MS,
} from "../health-workouts"

let disconnect: () => void = () => {}
beforeEach(() => {
  jest.useFakeTimers({ now: new Date(2026, 9, 30, 18, 0) })
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  jest.clearAllMocks()
  uuids = 0
  mockOwner = "A"
  mockCanWrite = true
  syncReady.setState({ ready: true })
  healthWorkoutsStore.set((s) => ({
    ...s,
    enabled: true,
    enabledAt: new Date(2026, 9, 30, 12, 0).toISOString(),
  }))
})
afterEach(() => {
  disconnect()
  jest.useRealTimers()
})

const connect = () => {
  disconnect = connectHealthWorkouts()
}
/** Lets pending promise callbacks (a save or delete resolving) run. */
const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

function finishOne(over: Partial<Workout> = {}): Workout {
  const t = fitStore.get().templates[0]
  const res = FA.startWorkout({ from: "template", templateId: t.id })
  if (!res.ok) throw new Error(res.reason)
  const w = res.workout
  if (Object.keys(over).length)
    fitStore.set((s) => ({
      ...s,
      workouts: s.workouts.map((x) => (x.id === w.id ? { ...x, ...over } : x)),
    }))
  const done = FA.finishWorkout(w.id, { unfinished: "done" })
  if (!done) throw new Error("not finished")
  return done
}
const saved = (who = "A") => healthWorkoutsStore.get().saved[who] ?? {}
const pass = async () => {
  jest.advanceTimersByTime(RECONCILE_MS + 1)
  await settle()
}

test("a finish with the switch on saves once and records the sample", async () => {
  connect()
  const w = finishOne()
  await settle()
  expect(mockSave).toHaveBeenCalledTimes(1)
  expect(mockSave.mock.calls[0][0]).toMatchObject({
    id: w.id,
    name: w.name,
    start: new Date(w.startedAt),
    end: new Date(w.endedAt ?? ""),
    cardio: false,
  })
  expect(saved()[w.id]).toEqual({ uuid: "hk-1", seen: true })
  expect(toast.success).toHaveBeenCalledWith("Saved to Apple Health")
  // The listener firing again (a second finish of the same workout).
  FA.finishWorkout(w.id, { unfinished: "done" })
  await settle()
  expect(mockSave).toHaveBeenCalledTimes(1)
})

test("switch off: nothing is saved", async () => {
  healthWorkoutsStore.set((s) => ({ ...s, enabled: false }))
  connect()
  finishOne()
  await settle()
  expect(mockSave).not.toHaveBeenCalled()
})

test("a chat-logged workout is never saved", async () => {
  connect()
  finishOne({ source: "chat" })
  await settle()
  expect(mockSave).not.toHaveBeenCalled()
})

test("write revoked in the Health app: skipped without a toast", async () => {
  mockCanWrite = false
  connect()
  finishOne()
  await settle()
  expect(mockSave).not.toHaveBeenCalled()
  expect(toast.error).not.toHaveBeenCalled()
})

test("a workout that ends before it starts is reported, never written", async () => {
  connect()
  const Sentry = jest.requireMock("@sentry/react-native")
  const t = fitStore.get().templates[0]
  const res = FA.startWorkout({ from: "template", templateId: t.id })
  if (!res.ok) throw new Error(res.reason)
  FA.finishWorkout(res.workout.id, {
    unfinished: "done",
    endAt: new Date(2020, 0, 1).toISOString(),
  })
  await settle()
  expect(mockSave).not.toHaveBeenCalled()
  expect(Sentry.captureMessage).toHaveBeenCalled()
})

test("deleting removes it from Health after the undo window; undo keeps it", async () => {
  connect()
  const a = finishOne()
  const b = finishOne()
  await settle()
  const removed = FA.deleteWorkout(a.id)
  await pass()
  expect(mockDelete).toHaveBeenCalledTimes(1)
  expect(mockDelete).toHaveBeenCalledWith("hk-1")
  expect(saved()[a.id]).toBeUndefined()
  expect(removed).toBeDefined()
  // Undo inside the window: the pass finds it back and deletes nothing.
  const again = FA.deleteWorkout(b.id)
  jest.advanceTimersByTime(RECONCILE_MS / 2)
  if (again) FA.restoreWorkout(again)
  await pass()
  expect(mockDelete).toHaveBeenCalledTimes(1)
  expect(saved()[b.id]).toEqual({ uuid: "hk-2", seen: true })
})

test("a failed save toasts, records nothing, and the next launch retries it once", async () => {
  mockSave.mockResolvedValueOnce(null)
  connect()
  const w = finishOne()
  await settle()
  expect(toast.error).toHaveBeenCalledWith("Couldn't save to Apple Health")
  expect(saved()[w.id]).toBeUndefined()
  expect(healthWorkoutsStore.get().finishedHere.A).toContain(w.id)
  // Next launch.
  disconnect()
  connect()
  await settle()
  expect(mockSave).toHaveBeenCalledTimes(2)
  expect(saved()[w.id]).toMatchObject({ seen: true })
})

test("the retry skips workouts older than a day, before the switch, or not finished here", async () => {
  for (let i = 0; i < 3; i++) mockSave.mockResolvedValueOnce(null)
  connect()
  const old = finishOne()
  const early = finishOne()
  const other = finishOne()
  await settle()
  disconnect()
  const at = (d: Date) => d.toISOString()
  fitStore.set((s) => ({
    ...s,
    workouts: s.workouts.map((x) =>
      x.id === old.id
        ? { ...x, endedAt: at(new Date(2026, 9, 29, 12, 0)) }
        : x.id === early.id
          ? { ...x, endedAt: at(new Date(2026, 9, 30, 11, 0)) }
          : x,
    ),
  }))
  healthWorkoutsStore.set((s) => ({
    ...s,
    finishedHere: {
      A: (s.finishedHere.A ?? []).filter((x) => x !== other.id),
    },
  }))
  mockSave.mockClear()
  connect()
  await settle()
  expect(mockSave).not.toHaveBeenCalled()
})

test("another account signing in deletes nothing and saves under its own name", async () => {
  connect()
  const a = finishOne()
  await settle()
  await pass()
  const before = saved("A")
  // B signs in: the stores are wiped and B's first pull has finished.
  mockOwner = "B"
  fitStore.set((s) => ({ ...s, workouts: [] }))
  syncReady.setState({ ready: true })
  await pass()
  expect(mockDelete).not.toHaveBeenCalled()
  expect(saved("A")).toEqual(before)
  const b = finishOne()
  await settle()
  expect(saved("B")[b.id]).toBeDefined()
  expect(saved("A")[b.id]).toBeUndefined()
  expect(saved("A")[a.id]).toBeDefined()
})

test("A signing back in keeps its entries and deletes nothing after its pull", async () => {
  connect()
  const a = finishOne()
  await settle()
  const kept = fitStore.get().workouts
  mockOwner = "B"
  fitStore.set((s) => ({ ...s, workouts: [] }))
  await pass()
  // A again: blank until its first pull finishes, then its rows are back.
  mockOwner = "A"
  syncReady.setState({ ready: false })
  fitStore.set((s) => ({ ...s, workouts: [] }))
  await pass()
  expect(mockDelete).not.toHaveBeenCalled()
  fitStore.set((s) => ({ ...s, workouts: kept }))
  syncReady.setState({ ready: true })
  await pass()
  expect(mockDelete).not.toHaveBeenCalled()
  expect(saved("A")[a.id]).toMatchObject({ seen: true })
})

test("a slow first pull: no pass runs and nothing is deleted until sync is ready", async () => {
  connect()
  const a = finishOne()
  await settle()
  const all = fitStore.get().workouts
  syncReady.setState({ ready: false })
  fitStore.set((s) => ({ ...s, workouts: [] }))
  await pass()
  await pass()
  expect(mockDelete).not.toHaveBeenCalled()
  // Half the pull has landed: still not ready.
  fitStore.set((s) => ({ ...s, workouts: all.slice(0, 1) }))
  await pass()
  expect(mockDelete).not.toHaveBeenCalled()
  fitStore.set((s) => ({ ...s, workouts: all }))
  syncReady.setState({ ready: true })
  await pass()
  expect(mockDelete).not.toHaveBeenCalled()
  expect(saved()[a.id]).toMatchObject({ seen: true })
})

test("merely absent is kept; seen and then gone is deleted once", async () => {
  connect()
  healthWorkoutsStore.set((s) => ({
    ...s,
    saved: { A: { ghost: { uuid: "hk-ghost", seen: false } } },
  }))
  await pass()
  expect(mockDelete).not.toHaveBeenCalled()
  expect(saved().ghost).toEqual({ uuid: "hk-ghost", seen: false })
  // A synced workout present at a pass is marked seen, then deleted.
  const w = finishOne()
  await settle()
  healthWorkoutsStore.set((s) => ({
    ...s,
    saved: { A: { ...s.saved.A, [w.id]: { uuid: "hk-w", seen: false } } },
  }))
  await pass()
  expect(saved()[w.id]).toEqual({ uuid: "hk-w", seen: true })
  FA.deleteWorkout(w.id)
  await pass()
  await pass()
  expect(mockDelete).toHaveBeenCalledTimes(1)
  expect(mockDelete).toHaveBeenCalledWith("hk-w")
  expect(saved()[w.id]).toBeUndefined()
  expect(saved().ghost).toBeDefined()
})

test("a delete Health refuses is kept and tried again on the next pass", async () => {
  connect()
  const w = finishOne()
  await settle()
  mockDelete.mockResolvedValueOnce(false)
  FA.deleteWorkout(w.id)
  await pass()
  expect(saved()[w.id]).toBeDefined()
  fitStore.set((s) => ({ ...s }))
  await pass()
  expect(mockDelete).toHaveBeenCalledTimes(2)
  expect(saved()[w.id]).toBeUndefined()
})
