// The bridge writes the widget snapshot when the stores change, keeps the
// lock-screen activity in step with the running routine, applies taps that
// were mockQueued while the app was closed, and clears both on sign-out.
import * as HA from "@domain/habits/actions"
import { habitsStore } from "@domain/habits/store"
import { dayKey } from "@domain/lib/day"
import { liveStore } from "@domain/lib/live"
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, render } from "@testing-library/react-native"
import type { LiveState, SurfaceAction, WidgetSnapshot } from "../types"

const mockQueued: SurfaceAction[] = []
const mockNative = {
  surfacesAvailable: true,
  writeSnapshot: jest.fn<void, [WidgetSnapshot]>(),
  writeLive: jest.fn<void, [LiveState | null]>(),
  clearSurfaces: jest.fn(),
  onQueuedAction: jest.fn(() => () => {}),
  drainActions: jest.fn(() => mockQueued.splice(0)),
}
jest.mock("../native", () => mockNative)

// Imported after the mock so the bridge sees it.
const { SurfacesBridge } = require("../bridge") as typeof import("../bridge")

beforeEach(() => {
  jest.useFakeTimers()
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  liveStore.set({ live: null })
  habitsStore.set((s) => ({
    ...s,
    runs: s.runs.filter((r) => r.day !== dayKey()),
    timer: null,
  }))
  for (const fn of Object.values(mockNative))
    if (typeof fn === "function") fn.mockClear()
})
afterEach(() => jest.useRealTimers())

const lastSnapshot = () => mockNative.writeSnapshot.mock.calls.at(-1)?.[0]
const lastLive = () => mockNative.writeLive.mock.calls.at(-1)?.[0]

it("writes the snapshot once the stores settle, and again when they change", () => {
  render(<SurfacesBridge />)
  expect(mockNative.writeSnapshot).not.toHaveBeenCalled()
  act(() => jest.advanceTimersByTime(700))
  expect(mockNative.writeSnapshot).toHaveBeenCalledTimes(1)
  expect(lastSnapshot()?.day).toBe(dayKey())
  const open = lastSnapshot()?.habits.items.find((h) => !h.done && h.checkable)
  if (!open) return
  act(() => {
    HA.checkHabit(open.id)
  })
  act(() => jest.advanceTimersByTime(700))
  expect(mockNative.writeSnapshot).toHaveBeenCalledTimes(2)
  expect(lastSnapshot()?.habits.done).toBeGreaterThan(0)
})

it("starting a routine shows it on the lock screen; finishing it ends it", () => {
  render(<SurfacesBridge />)
  expect(lastLive()).toBeNull()
  const r = habitsStore
    .get()
    .routines.find((x) => x.status === "active" && x.steps.length > 0)
  if (!r) throw new Error("no routine")
  let runId = ""
  act(() => {
    runId = HA.startRoutine(r.id)?.id ?? ""
  })
  expect(lastLive()).toMatchObject({ kind: "routine", id: runId, key: "0" })
  act(() => {
    HA.resetRoutine(r.id)
  })
  expect(lastLive()).toBeNull()
})

it("applies taps mockQueued while the app was closed as it starts", () => {
  const r = habitsStore
    .get()
    .routines.find((x) => x.status === "active" && x.steps.length >= 2)
  if (!r) throw new Error("no routine")
  const run = HA.startRoutine(r.id)
  if (!run) throw new Error("not started")
  mockQueued.push({
    id: "t1",
    type: "done",
    kind: "routine",
    target: run.id,
    key: "0",
    at: Date.now(),
  })
  render(<SurfacesBridge />)
  expect(mockNative.drainActions).toHaveBeenCalled()
  expect(habitsStore.get().runs.find((x) => x.id === run.id)?.current).toBe(1)
  expect(lastLive()).toMatchObject({ key: "1", index: 1 })
})

it("clears the widgets and the activity on sign-out", () => {
  const view = render(<SurfacesBridge />)
  view.unmount()
  expect(mockNative.clearSurfaces).toHaveBeenCalledTimes(1)
})
