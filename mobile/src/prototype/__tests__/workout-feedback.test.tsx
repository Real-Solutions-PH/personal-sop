// Workout feedback round: a set can be removed from a visible button, a
// finished workout lands on its share card with a way out, the card's photo
// can come from the camera, and the rest timer chimes in the app when it
// ends (but not late, after the app was away).
import * as A from "@domain/fitness/actions"
import { fitStore } from "@domain/fitness/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { AppState } from "react-native"
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

const { router } = require("expo-router") as {
  router: { replace: jest.Mock }
}
const { pickPhoto } = require("../media") as { pickPhoto: jest.Mock }
const { chime } = require("../chime") as { chime: jest.Mock }
const { WorkoutLogger } =
  require("../screens/fitness-logger") as typeof import("../screens/fitness-logger")
const { FitnessShare } =
  require("../screens/fitness-share") as typeof import("../screens/fitness-share")
const { startRestAlarm } =
  require("../rest-alarm") as typeof import("../rest-alarm")

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
  for (const k of Object.keys(mockParams)) delete mockParams[k]
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

const withBench = () => {
  const res = A.startWorkout({ from: "empty" })
  if (!res.ok) throw new Error(res.reason)
  const [we] = A.addExercises(res.workout.id, ["bench"])
  return { w: res.workout, we }
}
const setsOf = (wid: string, weId: string) =>
  fitStore
    .get()
    .workouts.find((x) => x.id === wid)
    ?.exercises.find((e) => e.id === weId)?.sets ?? []

it("Remove set takes off the last set", () => {
  const { w, we } = withBench()
  const before = setsOf(w.id, we.id).map((x) => x.id)
  render(<WorkoutLogger />, { wrapper })
  fireEvent.press(screen.getByLabelText(/^Remove last set of/))
  expect(setsOf(w.id, we.id).map((x) => x.id)).toEqual(before.slice(0, -1))
})

it("Remove set is gone once no sets are left", () => {
  const { w, we } = withBench()
  for (const x of setsOf(w.id, we.id)) A.removeSet(w.id, we.id, x.id)
  render(<WorkoutLogger />, { wrapper })
  expect(screen.queryByLabelText(/^Remove last set of/)).toBeNull()
  expect(screen.getByText("Add set")).toBeTruthy()
})

it("finishing a workout opens its celebration summary", () => {
  const { w, we } = withBench()
  for (const x of setsOf(w.id, we.id)) {
    A.updateSet(w.id, we.id, x.id, { weight: 60, reps: 8 })
    A.toggleSet(w.id, we.id, x.id)
  }
  render(<WorkoutLogger />, { wrapper })
  fireEvent.press(screen.getByLabelText("Finish workout"))
  expect(router.replace).toHaveBeenCalledWith(
    `/fitness/workouts/${w.id}/summary`,
  )
  expect(fitStore.get().workouts.find((x) => x.id === w.id)?.status).toBe(
    "finished",
  )
})

it("the share card after a workout asks, and Not now goes back", () => {
  const { w, we } = withBench()
  for (const x of setsOf(w.id, we.id)) A.toggleSet(w.id, we.id, x.id)
  A.finishWorkout(w.id, { unfinished: "remove" })
  mockParams.done = "1"
  render(<FitnessShare id={w.id} />, { wrapper })
  expect(screen.getByText("Post your workout?")).toBeTruthy()
  fireEvent.press(screen.getByLabelText("Not now"))
  expect(router.replace).toHaveBeenCalledWith("/fitness")
})

it("the share card from history has no Not now", () => {
  const { w } = withBench()
  A.finishWorkout(w.id, { unfinished: "done" })
  render(<FitnessShare id={w.id} />, { wrapper })
  expect(screen.getByText("Share workout")).toBeTruthy()
  expect(screen.queryByLabelText("Not now")).toBeNull()
})

it("the card's photo can come from the camera", async () => {
  const { w } = withBench()
  A.finishWorkout(w.id, { unfinished: "done" })
  render(<FitnessShare id={w.id} />, { wrapper })
  fireEvent.press(screen.getByLabelText("Photo background"))
  expect(pickPhoto).toHaveBeenLastCalledWith()
  await act(async () => {})
  fireEvent.press(screen.getByLabelText("Take a photo"))
  expect(pickPhoto).toHaveBeenLastCalledWith(true)
})

describe("rest chime", () => {
  // jest-expo's AppState is a mock: the app is on screen.
  beforeEach(() => {
    Object.defineProperty(AppState, "currentState", {
      value: "active",
      configurable: true,
    })
  })
  it("chimes when rest ends, even without notification permission", async () => {
    startRestAlarm()
    withBench()
    A.startRest(60)
    await act(async () => {})
    act(() => jest.advanceTimersByTime(59_000))
    expect(chime).not.toHaveBeenCalled()
    act(() => jest.advanceTimersByTime(1_500))
    expect(chime).toHaveBeenCalledTimes(1)
    // No notification was allowed, so none was scheduled.
    expect(mockN.scheduleNotificationAsync).not.toHaveBeenCalled()
  })

  it("a skipped rest stays quiet", async () => {
    startRestAlarm()
    withBench()
    A.startRest(60)
    await act(async () => {})
    A.skipRest()
    await act(async () => {})
    act(() => jest.advanceTimersByTime(120_000))
    expect(chime).not.toHaveBeenCalled()
  })

  it("a timer that fires late (app was away) stays quiet", async () => {
    startRestAlarm()
    withBench()
    A.startRest(60)
    await act(async () => {})
    // The clock jumps past the end without the timer running (suspended).
    jest.setSystemTime(Date.now() + 70_000)
    act(() => jest.advanceTimersByTime(60_000))
    expect(chime).not.toHaveBeenCalled()
  })
})
