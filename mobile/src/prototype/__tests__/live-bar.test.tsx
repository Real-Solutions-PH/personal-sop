// The bar above the tab bar while something runs: each row says what it
// is, the step or set now, a live clock, how far through it is, and one
// action that moves it on; the rest of the row opens it.

import { liveStore } from "@domain/lib/live"
import { configureStorage, resetAll } from "@domain/lib/store"
import { fireEvent, render, screen } from "@testing-library/react-native"
import type { LiveState } from "@/surfaces/types"
import { LiveBar, rowOf } from "../live-bar"
import { go } from "../navigation"

jest.mock("../navigation", () => ({ go: jest.fn(), replace: jest.fn() }))
jest.mock("@/surfaces/actions", () => ({ applySurfaceAction: jest.fn() }))
jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: "light" },
}))
const { applySurfaceAction } = jest.requireMock("@/surfaces/actions")

const NOW = new Date(2026, 9, 31, 9, 0).getTime()

const workout: LiveState = {
  kind: "workout",
  id: "w1",
  title: "Push",
  icon: "🏋️",
  step: "Pec deck machine",
  detail: "Set 2 of 4 · 47 kg × 7",
  key: "we1/s2",
  index: 3,
  count: 12,
  paused: false,
  startedAt: NOW - 25 * 60_000,
  elapsedSec: 1500,
  restSec: 90,
  next: [],
  controls: ["finishSet", "finish"],
  href: "/fitness/workout",
}

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  jest.clearAllMocks()
})

test("a workout row: the set now, the workout clock, sets done, and Set done", () => {
  const r = rowOf(workout, false, NOW)
  expect(r.title).toBe("Push")
  expect(r.step).toBe("Pec deck machine · Set 2 of 4 · 47 kg × 7")
  expect(r.clock).toBe(1500)
  expect(r.down).toBe(false)
  expect(r.progress).toBe(3 / 12)
  expect(r.action?.label).toBe("Set done")
  r.action?.run()
  expect(applySurfaceAction).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "finishSet",
      kind: "workout",
      target: "w1",
      key: "we1/s2",
    }),
  )
})

test("resting, the clock counts the rest down and the action skips it", () => {
  const r = rowOf(
    {
      ...workout,
      restEndsAt: NOW + 45_000,
      controls: ["subRest", "addRest", "skipRest", "finish"],
    },
    false,
    NOW,
  )
  expect(r.clockLabel).toBe("Rest")
  expect(r.clock).toBe(45)
  expect(r.down).toBe(true)
  expect(r.action?.label).toBe("Skip rest")
})

test("a paused routine shows its frozen step countdown and offers Step done", () => {
  const r = rowOf(
    {
      ...workout,
      kind: "routine",
      title: "Morning routine",
      step: "Stretch",
      detail: "Step 2 of 5 · 10 min",
      index: 1,
      count: 5,
      paused: true,
      remainingSec: 312,
      controls: ["done", "skip", "resume", "finish"],
      href: "/habits/routines/r1/play",
    },
    false,
    NOW,
  )
  expect(r.paused).toBe(true)
  expect(r.clock).toBe(312)
  expect(r.down).toBe(true)
  expect(r.progress).toBe(1 / 5)
  expect(r.action?.label).toBe("Step done")
})

test("Finish is never the row's quick action", () => {
  const r = rowOf({ ...workout, controls: ["finish"] }, false, NOW)
  expect(r.action).toBeUndefined()
})

test("the bar shows what runs, opens it on tap, and hides on its own screen", () => {
  liveStore.set({
    live: {
      kind: "workout",
      label: "Push",
      href: "/fitness/workout",
      startedAt: new Date(Date.now() - 65_000).toISOString(),
    },
  })
  const r = render(<LiveBar path="/today" />)
  expect(screen.getByTestId("live-bar")).toBeTruthy()
  fireEvent.press(screen.getByRole("button", { name: /^In progress: Push/ }))
  expect(go).toHaveBeenCalledWith("/fitness/workout")
  r.rerender(<LiveBar path="/fitness/workout" />)
  expect(screen.queryByTestId("live-bar")).toBeNull()
})

test("nothing running, no bar", () => {
  liveStore.set({ live: null })
  render(<LiveBar path="/today" />)
  expect(screen.queryByTestId("live-bar")).toBeNull()
})
