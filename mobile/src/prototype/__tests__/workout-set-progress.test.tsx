// As each set is ticked, the logger says how it went against the same set
// last time: "+1 rep" in green, "New set" for a set that had none, and the
// exercise's "+1 rep" goal turns into a green check once a set meets it.
import * as A from "@domain/fitness/actions"
import * as C from "@domain/fitness/calc"
import { fitStore } from "@domain/fitness/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"

const mockParams: Record<string, string> = {}
jest.mock("expo-router", () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: () => false,
  },
  useLocalSearchParams: () => mockParams,
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
  withTiming: (value: unknown, _: unknown, done?: (ok: boolean) => void) => {
    done?.(true)
    return value
  },
  withSequence: (...values: unknown[]) => values[values.length - 1],
  interpolate: (_: number, __: number[], output: number[]) => output[0],
  interpolateColor: (_: number, __: number[], output: string[]) => output[0],
  runOnJS: (fn: unknown) => fn,
  useReducedMotion: () => true,
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
jest.mock("react-native-gesture-handler/ReanimatedSwipeable", () => {
  const { View } = require("react-native")
  return ({ children }: { children: ReactNode }) => <View>{children}</View>
})
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
}))
jest.mock("expo-audio", () => ({}))
jest.mock("react-native-view-shot", () => ({ captureRef: jest.fn() }))
jest.mock("expo-sharing", () => ({
  isAvailableAsync: jest.fn(),
  shareAsync: jest.fn(),
}))
jest.mock("../media", () => ({
  copyText: jest.fn(),
  exportCsv: jest.fn(),
  pickPhoto: jest.fn(async () => null),
}))
jest.mock("../chime", () => ({ chime: jest.fn() }))
const mockN = {
  getPermissionsAsync: jest.fn(async () => ({ status: "denied" })),
  requestPermissionsAsync: jest.fn(async () => ({ status: "denied" })),
  scheduleNotificationAsync: jest.fn(async () => "id"),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  SchedulableTriggerInputTypes: { DATE: "date" },
}
jest.mock("expo-notifications", () => mockN)

const { WorkoutLogger, tickSet } =
  require("../screens/fitness-logger") as typeof import("../screens/fitness-logger")

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 44, left: 0, right: 0, bottom: 34 },
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
)

beforeEach(() => {
  jest.useFakeTimers()
  jest.clearAllMocks()
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
})
afterEach(() => {
  act(() => jest.runOnlyPendingTimers())
  jest.useRealTimers()
})

const setsOf = (wid: string, weId: string) =>
  fitStore
    .get()
    .workouts.find((x) => x.id === wid)
    ?.exercises.find((e) => e.id === weId)?.sets ?? []

it("ticked sets show +1 rep, New set, and the goal as hit", () => {
  // Last time's bench, before today's workout exists.
  const before = fitStore.get()
  const last = C.exerciseHistory(before, "bench")
    .at(-1)
    ?.we.sets.filter(C.isWorking)
  const goal = C.suggestion(before, "bench")
  if (!last?.length || (goal.kind !== "reps" && goal.kind !== "weight"))
    throw new Error("the sample data has no bench history to beat")
  const res = A.startWorkout({ from: "empty" })
  if (!res.ok) throw new Error(res.reason)
  const w = res.workout,
    [we] = A.addExercises(w.id, ["bench"])
  // One working set more than last time: the last one is new.
  while (setsOf(w.id, we.id).filter(C.isWorking).length <= last.length)
    A.addSet(w.id, we.id)
  const sets = setsOf(w.id, we.id).filter(C.isWorking)
  // Set 1 meets today's goal; set 2 beats last time's set 2 by one rep.
  A.updateSet(w.id, we.id, sets[0].id, {
    weight: goal.weight,
    reps: goal.reps,
  })
  A.updateSet(w.id, we.id, sets[1].id, {
    weight: last[1].weight,
    reps: last[1].reps + 1,
  })

  render(<WorkoutLogger />, { wrapper })
  expect(screen.getByTestId("goal")).toBeTruthy()
  expect(screen.queryByTestId(/^set-progress-/)).toBeNull()
  act(() => {
    for (const x of setsOf(w.id, we.id)) tickSet(w.id, we.id, x.id)
  })

  expect(
    screen.getAllByLabelText("+1 rep on last time").length,
  ).toBeGreaterThan(0)
  expect(screen.getAllByTestId("set-progress-new")).toHaveLength(1)
  expect(screen.getByLabelText("New set: none last time")).toBeTruthy()
  expect(screen.getByTestId("goal-hit")).toBeTruthy()
  expect(screen.getByLabelText(`Goal ${goal.badge}: hit`)).toBeTruthy()

  // Unticking puts the plain "Last" back and the goal back to a target.
  act(() => {
    for (const x of setsOf(w.id, we.id)) tickSet(w.id, we.id, x.id)
  })
  expect(screen.queryAllByTestId(/^set-progress-/)).toHaveLength(0)
  expect(screen.queryByTestId("goal-hit")).toBeNull()
})

it("a set below last time is muted, not green", () => {
  const before = fitStore.get()
  const last = C.exerciseHistory(before, "bench")
    .at(-1)
    ?.we.sets.filter(C.isWorking)
  if (!last?.length) throw new Error("no bench history")
  const res = A.startWorkout({ from: "empty" })
  if (!res.ok) throw new Error(res.reason)
  const [we] = A.addExercises(res.workout.id, ["bench"])
  const first = setsOf(res.workout.id, we.id).filter(C.isWorking)[0]
  A.updateSet(res.workout.id, we.id, first.id, {
    weight: last[0].weight,
    reps: Math.max(1, last[0].reps - 2),
  })
  render(<WorkoutLogger />, { wrapper })
  act(() => {
    tickSet(res.workout.id, we.id, first.id)
  })
  expect(screen.getByTestId("set-progress-down")).toBeTruthy()
  expect(screen.queryByTestId("set-progress-up")).toBeNull()
})
