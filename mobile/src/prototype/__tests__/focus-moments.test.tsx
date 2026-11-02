// Ending a focus session lands as a card saying what it came to (time,
// sets, and how far the day is from its goal) instead of a silent stop, and
// the daily goal is cheered once a day.
import { DEFAULT_SETTINGS } from "@domain/focus/data"
import * as A from "@domain/focus/actions"
import { focusStore } from "@domain/focus/store"
import { liveStore } from "@domain/lib/live"
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { OverlayHost, resetOverlay } from "../overlay"
import { FocusTimer } from "../screens/focus-timer"

jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  ...require("./reanimated-extras").extras,
  default: require("react-native").Animated,
  useSharedValue: (value: unknown) =>
    require("react").useRef({ value }).current,
  useAnimatedStyle: (get: () => unknown) => get(),
  withSpring: (value: unknown) => value,
  withTiming: (value: unknown) => value,
  withDelay: (_: number, value: unknown) => value,
  withSequence: (...values: unknown[]) => values[values.length - 1],
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
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
}))
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
  usePathname: () => "/focus",
  useFocusEffect: () => {},
}))
jest.mock("expo-audio", () => ({}))

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>
    {children}
    <OverlayHost />
  </SafeAreaProvider>
)
const hidden = { includeHiddenElements: true }
const T0 = new Date(2026, 9, 20, 9, 0, 0).getTime()
const at = (m: number) => jest.setSystemTime(T0 + m * 60_000)

beforeEach(() => {
  jest.useFakeTimers({ now: T0 })
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  resetOverlay()
  liveStore.set({ live: null })
})
afterEach(() => jest.useRealTimers())

it("ending a session shows what it came to, and the goal still to go", () => {
  focusStore.set({
    sessions: [],
    segments: [],
    settings: { ...DEFAULT_SETTINGS, dailyGoalMin: 120 },
    settingsSaved: true,
  })
  render(<FocusTimer />, { wrapper })
  fireEvent.press(screen.getByLabelText("Start focus"))
  act(() => {
    at(30)
    jest.advanceTimersByTime(1000)
  })
  fireEvent.press(screen.getAllByLabelText("End session")[0])
  fireEvent.press(screen.getByText("End and keep it"))
  expect(screen.getByTestId("focus-session-done", hidden)).toBeTruthy()
  expect(screen.getByText("Session done")).toBeTruthy()
  // The set ran its 25 minutes; the break that followed is not focus.
  expect(screen.getByText(/^25m\s·\s1\sof\s4\ssets/)).toBeTruthy()
  expect(screen.getByText(/1h\s35m\sto\stoday's\sgoal/)).toBeTruthy()
  act(() => jest.advanceTimersByTime(5000))
  expect(screen.queryByTestId("focus-session-done", hidden)).toBeNull()
})

it("the daily goal is cheered once a day", () => {
  focusStore.set({
    sessions: [],
    segments: [],
    settings: { ...DEFAULT_SETTINGS, dailyGoalMin: 20 },
    settingsSaved: true,
  })
  A.startFocus({ preset: "25-5" })
  at(21)
  const first = render(<FocusTimer />, { wrapper })
  act(() => jest.advanceTimersByTime(1000))
  expect(screen.getByTestId("focus-goal-moment", hidden)).toBeTruthy()
  act(() => jest.advanceTimersByTime(5000))
  expect(screen.queryByTestId("focus-goal-moment", hidden)).toBeNull()
  first.unmount()
  render(<FocusTimer />, { wrapper })
  act(() => jest.advanceTimersByTime(1000))
  expect(screen.queryByTestId("focus-goal-moment", hidden)).toBeNull()
})
