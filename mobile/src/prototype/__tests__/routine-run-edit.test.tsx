// Adding and removing steps while a routine plays: progress, the planned
// total, what gets logged, the saved routine (only when asked) and Undo.
import * as A from "@domain/habits/actions"
import { type HabitsState, seedHabits } from "@domain/habits/data"
import * as L from "@domain/habits/logic"
import { habitsStore } from "@domain/habits/store"
import { liveStore, stopLive } from "@domain/lib/live"
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { RoutinePlayer } from "../screens/routine-player"
import { addableHabits, UNDO_MS } from "../screens/routine-run-edit"

jest.mock("expo-router", () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: () => false,
  },
  useLocalSearchParams: () => ({}),
  usePathname: () => "/",
}))
jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  ...require("./reanimated-extras").extras,
  default: require("react-native").Animated,
  useSharedValue: (value: unknown) =>
    require("react").useRef({ value }).current,
  useAnimatedStyle: (get: () => unknown) => get(),
  withSpring: (value: unknown) => value,
  withTiming: (value: unknown) => value,
  withSequence: (...values: unknown[]) => values[values.length - 1],
  interpolate: (_: number, __: number[], output: number[]) => output[0],
  interpolateColor: (_: number, __: number[], output: string[]) => output[0],
  runOnJS: (fn: unknown) => fn,
  useReducedMotion: () => true,
}))
jest.mock("react-native-gesture-handler", () => {
  const chain: object = new Proxy({}, { get: () => () => chain })
  return {
    Gesture: new Proxy({}, { get: () => () => chain }),
    GestureDetector: ({ children }: { children: ReactNode }) => children,
    ScrollView: require("react-native").ScrollView,
  }
})
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
}))
jest.mock("expo-haptics", () => ({
  notificationAsync: jest.fn(async () => {}),
  impactAsync: jest.fn(async () => {}),
  selectionAsync: jest.fn(async () => {}),
  NotificationFeedbackType: { Success: "success" },
  ImpactFeedbackStyle: { Light: "light" },
}))

const blank = (): HabitsState => ({
  ...seedHabits(),
  habits: [],
  logs: [],
  routines: [],
  runs: [],
  timer: null,
})

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  habitsStore.set(blank())
  stopLive()
})

/** "Morning": skin care 15 min, journal 10 min, stretch 5 min. */
function morning() {
  const skin = A.createHabit({
    name: "Face skin care routine",
    type: "duration",
    target: 15,
  })
  const journal = A.createHabit({ name: "Morning journal" })
  const stretch = A.createHabit({ name: "Stretch" })
  const read = A.createHabit({ name: "Read", type: "duration", target: 20 })
  const water = A.createHabit({ name: "Water" })
  const r = A.createRoutine({
    name: "Morning routine",
    steps: [
      { habitId: skin.id, minutes: 15 },
      { habitId: journal.id, minutes: 10 },
      { habitId: stretch.id, minutes: 5 },
    ],
  })
  const run = A.startRoutine(r.id)
  if (!run) throw new Error("no run")
  return { r, run, skin, journal, stretch, read, water }
}
const runOf = (id: string) => {
  const run = habitsStore.get().runs.find((x) => x.id === id)
  if (!run) throw new Error("no run")
  return run
}
const routineOf = (id: string) => {
  const r = habitsStore.get().routines.find((x) => x.id === id)
  if (!r) throw new Error("no routine")
  return r
}
const ids = (steps: { habitId: string }[]) => steps.map((s) => s.habitId)
const plannedSec = (steps: { minutes: number }[]) =>
  steps.reduce((a, s) => a + s.minutes * 60, 0)

describe("adding a step mid-run", () => {
  test("goes up next by default, with the habit's own minutes", () => {
    const { r, run, skin, journal, stretch, read } = morning()
    A.stepDone(run) // now on the journal: 2/3
    expect(A.runAddStep(runOf(run.id), read.id)).toBe(2)
    const after = runOf(run.id)
    expect(ids(after.steps)).toEqual([skin.id, journal.id, read.id, stretch.id])
    expect(after.steps[2].minutes).toBe(20)
    // still on step 2, now of 4; planned total grows by 20 min
    expect(after.current).toBe(1)
    expect(after.steps.length).toBe(4)
    expect(plannedSec(after.steps)).toBe((15 + 10 + 20 + 5) * 60)
    // the saved routine is untouched unless asked
    expect(ids(routineOf(r.id).steps)).toEqual([
      skin.id,
      journal.id,
      stretch.id,
    ])
    // Live bar label follows the new count
    expect(liveStore.get().live?.label).toContain("(2/4)")
  })

  test("at the end, and a non-timed habit gets five minutes", () => {
    const { run, water } = morning()
    expect(A.runAddStep(runOf(run.id), water.id, "end")).toBe(3)
    expect(runOf(run.id).steps[3]).toEqual({ habitId: water.id, minutes: 5 })
  })

  test("also changing the routine puts it after the current step's habit", () => {
    const { r, run, skin, journal, stretch, read, water } = morning()
    A.runAddStep(runOf(run.id), read.id, "next", true)
    expect(ids(routineOf(r.id).steps)).toEqual([
      skin.id,
      read.id,
      journal.id,
      stretch.id,
    ])
    A.runAddStep(runOf(run.id), water.id, "end", true)
    expect(ids(routineOf(r.id).steps)).toEqual([
      skin.id,
      read.id,
      journal.id,
      stretch.id,
      water.id,
    ])
  })

  test("an added step plays and logs like any other", () => {
    const { run, read } = morning()
    A.runAddStep(runOf(run.id), read.id)
    A.stepDone(runOf(run.id)) // skin care
    A.stepDone(runOf(run.id)) // read (added)
    const log = habitsStore
      .get()
      .logs.find((l) => l.habitId === read.id && l.source === "routine")
    expect(log).toBeTruthy()
    expect(runOf(run.id).results.map((x) => x.habitId)[1]).toBe(read.id)
  })

  test("the picker offers only habits not already in the run", () => {
    const { run, read, water } = morning()
    const names = (q = "") =>
      addableHabits(habitsStore.get().habits, runOf(run.id), q).map((h) => h.id)
    expect(names()).toEqual([read.id, water.id])
    expect(names("wat")).toEqual([water.id])
    A.runAddStep(runOf(run.id), read.id)
    expect(names()).toEqual([water.id])
  })
})

describe("removing a step mid-run", () => {
  test("an upcoming step goes without a log or a result", () => {
    const { r, run, skin, journal, stretch } = morning()
    const removed = A.runRemoveStep(runOf(run.id), 1)
    expect(removed?.finished).toBe(false)
    const after = runOf(run.id)
    expect(ids(after.steps)).toEqual([skin.id, stretch.id])
    expect(after.current).toBe(0)
    expect(plannedSec(after.steps)).toBe(20 * 60)
    expect(habitsStore.get().logs.some((l) => l.habitId === journal.id)).toBe(
      false,
    )
    expect(ids(routineOf(r.id).steps)).toEqual([
      skin.id,
      journal.id,
      stretch.id,
    ])
    // finishing the run: two results, nothing skipped or unreached
    A.stepDone(after)
    A.stepDone(runOf(run.id))
    const done = runOf(run.id)
    expect(done.state).toBe("completed")
    expect(done.results.map((x) => x.status)).toEqual(["done", "done"])
    expect(L.runActualSec(done)).toBeGreaterThanOrEqual(0)
  })

  test("the current step moves on, like a skip that isn't a miss", () => {
    const { run, journal, stretch } = morning()
    A.stepDone(run)
    A.toggleRunPause(runOf(run.id))
    A.stepAddMinute(runOf(run.id))
    A.runRemoveStep(runOf(run.id), 1)
    const after = runOf(run.id)
    expect(after.current).toBe(1)
    expect(after.steps[after.current].habitId).toBe(stretch.id)
    // the next step starts on a fresh clock
    expect(after.pausedAt).toBeUndefined()
    expect(after.stepBonusSec).toBe(0)
    expect(after.results).toHaveLength(1)
    const journalLog = habitsStore
      .get()
      .logs.find((l) => l.habitId === journal.id)
    expect(journalLog).toBeUndefined()
  })

  test("removing the last step left finishes the run", () => {
    const { run, journal } = morning()
    A.stepDone(run)
    A.stepDone(runOf(run.id))
    const removed = A.runRemoveStep(runOf(run.id), 2)
    expect(removed?.finished).toBe(true)
    const after = runOf(run.id)
    expect(after.state).toBe("completed")
    expect(after.results.map((x) => x.status)).toEqual(["done", "done"])
    expect(liveStore.get().live).toBeNull()
    // an ended run can't take it back
    if (!removed) throw new Error("not removed")
    expect(A.undoRemoveStep(removed)).toBe(false)
    expect(habitsStore.get().logs.some((l) => l.habitId === journal.id)).toBe(
      true,
    )
  })

  test("played steps and a run's only step can't be removed", () => {
    const { run } = morning()
    A.stepDone(run)
    expect(A.runRemoveStep(runOf(run.id), 0)).toBeNull()
    const solo = A.createHabit({ name: "Solo" })
    const r2 = A.createRoutine({
      name: "One",
      steps: [{ habitId: solo.id, minutes: 5 }],
    })
    A.exitRoutine()
    stopLive()
    const one = A.startRoutine(r2.id)
    if (!one) throw new Error("no run")
    expect(A.canRemoveStep(one, 0)).toBe(false)
    expect(A.runRemoveStep(one, 0)).toBeNull()
  })

  test("also changing the routine drops it there; Undo puts both back", () => {
    const { r, run, skin, journal, stretch } = morning()
    const removed = A.runRemoveStep(runOf(run.id), 1, true)
    expect(ids(routineOf(r.id).steps)).toEqual([skin.id, stretch.id])
    if (!removed) throw new Error("not removed")
    expect(A.undoRemoveStep(removed)).toBe(true)
    expect(ids(runOf(run.id).steps)).toEqual([skin.id, journal.id, stretch.id])
    expect(ids(routineOf(r.id).steps)).toEqual([
      skin.id,
      journal.id,
      stretch.id,
    ])
    expect(routineOf(r.id).steps[1].minutes).toBe(10)
  })

  test("Undo of the current step's removal makes it current again", () => {
    const { run, journal } = morning()
    A.stepDone(run)
    const removed = A.runRemoveStep(runOf(run.id), 1)
    if (!removed) throw new Error("not removed")
    A.undoRemoveStep(removed)
    const after = runOf(run.id)
    expect(after.current).toBe(1)
    expect(after.steps[1].habitId).toBe(journal.id)
    expect(after.steps.length).toBe(3)
  })
})

// ---------------------------------------------------------------- player

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 44, left: 0, right: 0, bottom: 34 },
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
)

test("the player adds a habit from the picker and removes one with Undo", () => {
  jest.useFakeTimers()
  const { r, run, read } = morning()
  render(<RoutinePlayer id={r.id} />, { wrapper })
  expect(screen.getByText("1/3")).toBeTruthy()

  // Add: search, clear, pick
  fireEvent.press(screen.getByRole("button", { name: "Add a step" }))
  expect(screen.getByText("Add a step")).toBeTruthy()
  fireEvent.changeText(screen.getByLabelText("Search habits"), "rea")
  expect(screen.queryByRole("button", { name: "Add Water" })).toBeNull()
  fireEvent.press(screen.getByRole("button", { name: "Clear search" }))
  expect(screen.getByRole("button", { name: "Add Water" })).toBeTruthy()
  // habits already in the run are not offered
  expect(screen.queryByRole("button", { name: "Add Stretch" })).toBeNull()
  fireEvent.press(screen.getByRole("button", { name: "Add Read" }))
  expect(screen.getByText("1/4")).toBeTruthy()
  expect(screen.getByText(/Up next · .* Read · 20m/)).toBeTruthy()
  expect(runOf(run.id).steps[1].habitId).toBe(read.id)

  // Remove the step just added, from the steps list, then undo it
  fireEvent.press(screen.getByRole("button", { name: "Remove Read" }))
  expect(screen.getByText("1/3")).toBeTruthy()
  expect(screen.getAllByText(/Removed Read/).length).toBeGreaterThan(0)
  fireEvent.press(
    screen.getAllByRole("button", { name: "Undo removing Read" })[0],
  )
  expect(screen.getByText("1/4")).toBeTruthy()
  expect(habitsStore.get().logs.some((l) => l.habitId === read.id)).toBe(false)

  // The undo offer goes away on its own
  fireEvent.press(screen.getByRole("button", { name: "Remove Read" }))
  expect(screen.getAllByText(/Removed Read/).length).toBeGreaterThan(0)
  act(() => {
    jest.advanceTimersByTime(UNDO_MS + 10)
  })
  expect(screen.queryByText(/Removed Read/)).toBeNull()
  jest.useRealTimers()
})

test("a new habit named in the picker is created and added", () => {
  const { r, run } = morning()
  render(<RoutinePlayer id={r.id} />, { wrapper })
  fireEvent.press(screen.getByRole("button", { name: "Add a step" }))
  fireEvent.changeText(screen.getByLabelText("Search habits"), "Floss")
  fireEvent.press(screen.getByRole("button", { name: "At the end" }))
  fireEvent.press(screen.getByRole("button", { name: "Create habit Floss" }))
  const floss = habitsStore.get().habits.find((h) => h.name === "Floss")
  expect(floss).toBeTruthy()
  const steps = runOf(run.id).steps
  expect(steps[steps.length - 1]).toEqual({ habitId: floss?.id, minutes: 5 })
  // this run only by default
  expect(routineOf(r.id).steps.some((s) => s.habitId === floss?.id)).toBe(false)
})
