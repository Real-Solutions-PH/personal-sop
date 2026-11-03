// A routine finished away from its page lands as a card over any screen,
// once per run, says what was done (and what was skipped), never blocks,
// waits while the app is in the background or another moment is up, and
// shares its once-only record with the routine summary so neither plays the
// same finish twice.
import { fitStore } from "@domain/fitness/store"
import * as HA from "@domain/habits/actions"
import type { Routine, RoutineRun } from "@domain/habits/data"
import { habitsStore } from "@domain/habits/store"
import { dayKey } from "@domain/lib/day"
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { AppState } from "react-native"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { anchor, OverlayHost, resetOverlay } from "../overlay"

const mockMotion = { reduced: false }
const mockPath = { current: "/today" }
jest.mock("expo-router", () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: () => false,
  },
  useLocalSearchParams: () => ({}),
  usePathname: () => mockPath.current,
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
  runOnJS: (fn: unknown) => fn,
  useReducedMotion: () => mockMotion.reduced,
  isSharedValue: () => false,
}))
jest.mock("react-native-gesture-handler", () => {
  const chain: object = new Proxy({}, { get: () => () => chain })
  return {
    Gesture: new Proxy({}, { get: () => () => chain }),
    GestureDetector: ({ children }: { children: ReactNode }) => children,
    ScrollView: require("react-native").ScrollView,
  }
})
jest.mock("expo-haptics", () => ({
  notificationAsync: jest.fn(async () => {}),
  impactAsync: jest.fn(async () => {}),
  selectionAsync: jest.fn(async () => {}),
  NotificationFeedbackType: { Success: "success" },
  ImpactFeedbackStyle: { Light: "light" },
}))
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
}))
jest.mock("expo-audio", () => ({}))
jest.mock("../media", () => ({
  copyText: jest.fn(),
  exportCsv: jest.fn(),
  pickPhoto: jest.fn(),
}))

const { celebrateStore } =
  require("../celebration") as typeof import("../celebration")
const { momentSlot } = require("../moment") as typeof import("../moment")
const { ROUTINE_MS, FinishWatcher, finishedRuns, routineStreak } =
  require("../routine-done") as typeof import("../routine-done")
const { RoutineSummary } =
  require("../screens/routines") as typeof import("../screens/routines")
const Haptics = require("expo-haptics")
const { router } = require("expo-router")

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 44, left: 0, right: 0, bottom: 34 },
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>
    {children}
    <OverlayHost />
  </SafeAreaProvider>
)
const hidden = { includeHiddenElements: true }
const card = () => screen.queryByTestId("routine-done")
const run = (id: string) => habitsStore.get().runs.find((x) => x.id === id)!
const routine = () => {
  const r = habitsStore.get().routines.find((x) => x.steps.length > 1)
  if (!r) throw new Error("seed has no routine")
  return r
}
/** Runs a routine to its end the way the Live Activity does: step by step,
 * with the last ``skip`` steps skipped. */
function finish(r: Routine, skip = 0) {
  const started = HA.startRoutine(r.id)
  if (!started) throw new Error("could not start")
  for (let i = 0; i < r.steps.length; i++)
    (i >= r.steps.length - skip ? HA.stepSkip : HA.stepDone)(run(started.id))
  return started.id
}
let appState: (s: string) => void = () => {}

beforeEach(() => {
  jest.useFakeTimers()
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  resetOverlay()
  anchor.measure = (_, done) => done({ x: 0, y: 0, width: 0, height: 0 })
  // The demo seed's own finishes were announced long ago. Seeded on the
  // business day, one can end inside the watcher's six-hour window at some
  // hours (a live workout at 19:32 UTC, for a run at 00:31 UTC) and take
  // the card's slot ahead of the finish under test.
  celebrateStore.set({
    ids: [
      ...habitsStore.get().runs.map((r) => r.id),
      ...fitStore.get().workouts.map((w) => w.id),
    ],
  })
  momentSlot.set({ holder: null })
  mockMotion.reduced = false
  mockPath.current = "/today"
  jest.clearAllMocks()
  jest.spyOn(AppState, "addEventListener").mockImplementation((_, fn) => {
    appState = fn as (s: string) => void
    return { remove: () => {} } as ReturnType<typeof AppState.addEventListener>
  })
})
afterEach(() => {
  act(() => jest.runOnlyPendingTimers())
  jest.useRealTimers()
  jest.restoreAllMocks()
})

test("a routine finished from another screen lands as a card", () => {
  const r = routine()
  render(<FinishWatcher />, { wrapper })
  expect(card()).toBeNull()
  let id = ""
  act(() => {
    id = finish(r)
  })
  expect(card()).toBeTruthy()
  expect(screen.getByText("Routine done")).toBeTruthy()
  expect(screen.getByText(r.name)).toBeTruthy()
  expect(
    screen.getByText(
      new RegExp(`${r.steps.length} of ${r.steps.length} steps`),
    ),
  ).toBeTruthy()
  expect(Haptics.notificationAsync).toHaveBeenCalledWith("success")
  expect(celebrateStore.get().ids).toContain(id)
})

test("it draws in the top layer, never blocks, and leaves on its own", () => {
  act(() => {
    finish(routine())
  })
  render(<FinishWatcher />, { wrapper })
  const layer = screen.getByTestId("overlay-layer", hidden)
  let node = card()?.parent
  while (node && node !== layer) node = node.parent
  expect(node).toBe(layer)
  expect(layer.props.pointerEvents).toBe("box-none")
  act(() => jest.advanceTimersByTime(ROUTINE_MS - 100))
  expect(card()).toBeTruthy()
  act(() => jest.advanceTimersByTime(200))
  expect(card()).toBeNull()
})

test("a tap opens its summary, which then shows settled", () => {
  const r = routine()
  let id = ""
  act(() => {
    id = finish(r)
  })
  render(<FinishWatcher />, { wrapper })
  fireEvent.press(screen.getByLabelText(new RegExp(`^${r.name} done`)))
  expect(router.push).toHaveBeenCalledWith(
    `/habits/routines/${r.id}/summary?run=${id}`,
  )
  expect(card()).toBeNull()
  // The summary's own finish moment does not play a second time.
  Haptics.notificationAsync.mockClear()
  render(<RoutineSummary id={r.id} runId={id} />, { wrapper })
  expect(screen.queryAllByTestId("celebration-leaf", hidden)).toHaveLength(0)
  expect(Haptics.notificationAsync).not.toHaveBeenCalled()
})

test("Dismiss closes it at once", () => {
  act(() => {
    finish(routine())
  })
  render(<FinishWatcher />, { wrapper })
  fireEvent.press(screen.getByLabelText("Dismiss"))
  expect(card()).toBeNull()
})

test("on the routine's own pages it stays out; the summary plays instead", () => {
  const r = routine()
  mockPath.current = `/habits/routines/${r.id}/play`
  const view = render(<FinishWatcher />, { wrapper })
  let id = ""
  act(() => {
    id = finish(r)
  })
  expect(card()).toBeNull()
  // The player hands over to the summary, which celebrates the run.
  mockPath.current = `/habits/routines/${r.id}/summary`
  view.rerender(<FinishWatcher />)
  render(<RoutineSummary id={r.id} runId={id} />, { wrapper })
  expect(screen.getByTestId("celebration")).toBeTruthy()
  // Leaving the summary never brings the card after it.
  mockPath.current = "/today"
  view.rerender(<FinishWatcher />)
  expect(card()).toBeNull()
})

test("finished while in the background: it lands when the app comes back", () => {
  render(<FinishWatcher />, { wrapper })
  act(() => appState("background"))
  act(() => {
    finish(routine())
  })
  expect(card()).toBeNull()
  act(() => appState("active"))
  expect(card()).toBeTruthy()
})

test("once per run: a relaunch does not replay it", () => {
  act(() => {
    finish(routine())
  })
  render(<FinishWatcher />, { wrapper }).unmount()
  resetOverlay()
  render(<FinishWatcher />, { wrapper })
  expect(card()).toBeNull()
})

test("skipped steps say so, in the warning colour", () => {
  const r = routine()
  act(() => {
    finish(r, 1)
  })
  render(<FinishWatcher />, { wrapper })
  expect(screen.getByText("Routine finished")).toBeTruthy()
  const skipped = screen.getByText("· 1 skipped")
  expect(skipped.props.style.color).toBe("#94600e")
  expect(
    screen.getByText(
      new RegExp(`${r.steps.length - 1} of ${r.steps.length} steps`),
    ),
  ).toBeTruthy()
})

test("it waits while a trophy card holds the top, then lands", () => {
  act(() => momentSlot.set({ holder: "trophy" }))
  act(() => {
    finish(routine())
  })
  render(<FinishWatcher />, { wrapper })
  expect(card()).toBeNull()
  act(() => momentSlot.set({ holder: null }))
  expect(card()).toBeTruthy()
})

test("steps ticked with no timer claim no time", () => {
  act(() => {
    finish(routine())
  })
  render(<FinishWatcher />, { wrapper })
  expect(screen.queryByText(/00:00/)).toBeNull()
})

test("reduced motion: the card still lands", () => {
  mockMotion.reduced = true
  act(() => {
    finish(routine())
  })
  render(<FinishWatcher />, { wrapper })
  expect(card()).toBeTruthy()
  expect(Haptics.notificationAsync).toHaveBeenCalledWith("success")
})

describe("finishedRuns", () => {
  const base: RoutineRun = {
    id: "x",
    routineId: "r",
    day: dayKey(),
    startedAt: new Date().toISOString(),
    steps: [],
    results: [],
    current: 0,
    stepStartedAt: new Date().toISOString(),
    stepPausedSec: 0,
    stepBonusSec: 0,
    state: "completed",
  }
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
  it("keeps recent completed runs not yet celebrated, oldest first", () => {
    const runs = [
      { ...base, id: "new", endedAt: ago(60_000) },
      { ...base, id: "older", endedAt: ago(3_600_000) },
      { ...base, id: "history", endedAt: ago(7 * 3_600_000) },
      { ...base, id: "seen", endedAt: ago(60_000) },
      { ...base, id: "running", state: "in_progress" as const },
    ]
    expect(finishedRuns(runs, ["seen"]).map((x) => x.id)).toEqual([
      "older",
      "new",
    ])
  })
})

describe("routineStreak", () => {
  const daily: Routine = {
    id: "r",
    name: "Morning",
    icon: "🌅",
    schedule: [{ days: [0, 1, 2, 3, 4, 5, 6] }],
    reminder: false,
    steps: [],
    status: "active",
    createdAt: "2000-01-01",
  }
  const done = (day: string, id = day) =>
    ({
      id,
      routineId: "r",
      day,
      state: "completed",
    }) as RoutineRun
  const HA_ =
    require("@domain/habits/logic") as typeof import("@domain/habits/logic")
  it("counts scheduled days in a row up to the run's day", () => {
    const d = dayKey()
    const runs = [done(d), done(HA_.addDays(d, -1)), done(HA_.addDays(d, -3))]
    expect(routineStreak(daily, runs, d)).toBe(2)
  })
})
