// Adding focus time by hand (Kai: "there is no way to create focus time
// records"): the Focus page's header opens the sheet, the duration has
// − / +, the saved block lands in the day's timeline (rising in, tinted)
// and counts in the day's total; a logged block opens its editor to change
// or delete it, and a timed one can be deleted after a confirm.

import * as A from "@domain/focus/actions"
import { DEFAULT_SETTINGS, type FocusState } from "@domain/focus/data"
import * as P from "@domain/focus/past"
import { focusStore } from "@domain/focus/store"
import { liveStore } from "@domain/lib/live"
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import { Alert } from "react-native"
import { SafeAreaProvider } from "react-native-safe-area-context"
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
  withRepeat: (value: unknown) => value,
  interpolate: (_: number, __: number[], output: number[]) => output[0],
  runOnJS: (fn: unknown) => fn,
  useReducedMotion: () => true,
}))
jest.mock("react-native-gesture-handler", () => {
  const chain: object = new Proxy({}, { get: () => () => chain })
  return {
    Gesture: new Proxy({}, { get: () => () => chain }),
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
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
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
  usePathname: () => "/focus",
  useFocusEffect: () => {},
  Redirect: () => null,
}))

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
}
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
)

// 09:00 local on a Tuesday, well inside one business day.
const T0 = new Date(2026, 9, 20, 9, 0, 0).getTime()
const MIN = 60_000

const empty = (): FocusState => ({
  sessions: [],
  segments: [],
  settings: { ...DEFAULT_SETTINGS },
  settingsSaved: false,
})

beforeEach(() => {
  jest.useFakeTimers({ now: T0 })
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  focusStore.set(empty())
  liveStore.set({ live: null })
})
afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})

const sessions = () => focusStore.get().sessions

it("adds focus time from the header: − / + set the length, the block lands in the timeline", () => {
  render(<FocusTimer />, { wrapper })
  // The header's icon button, the first of the two ways in.
  fireEvent.press(screen.getAllByLabelText("Add focus time")[0])
  expect(screen.getAllByText("Add focus time").length).toBeGreaterThan(0)
  // A fresh block is the last hour: 08:00-09:00, 60 min.
  expect(screen.getByLabelText("Duration").props.value).toBe("60")
  fireEvent.press(screen.getByLabelText("Increase Duration"))
  expect(screen.getByLabelText("Duration").props.value).toBe("65")
  fireEvent.press(screen.getByLabelText("Decrease Duration"))
  fireEvent.press(screen.getByLabelText("Decrease Duration"))
  // 60 + 5 − 5 − 5 = 55 min; the end moved to 08:55.
  expect(screen.getByLabelText("Duration").props.value).toBe("55")
  fireEvent.changeText(
    screen.getByPlaceholderText("e.g. Reading chapter 3"),
    "Reading",
  )
  fireEvent.press(screen.getByText("Save focus time"))
  const [x] = sessions()
  // 55 min = 3,300 s, logged by hand.
  expect(x).toMatchObject({ source: "manual", label: "Reading" })
  expect(x.focusSec).toBe(3300)
  expect(new Date(x.startedAt).getTime()).toBe(T0 - 60 * MIN)
  expect(new Date(x.endedAt as string).getTime()).toBe(T0 - 5 * MIN)
  // The new row is in the timeline, tinted while it lands, then plain.
  expect(screen.getAllByText("Reading").length).toBeGreaterThan(0)
  expect(screen.getByTestId("focus-block-fresh")).toBeTruthy()
  act(() => {
    jest.advanceTimersByTime(3000)
  })
  expect(screen.queryByTestId("focus-block-fresh")).toBeNull()
  expect(screen.getAllByText("55m").length).toBeGreaterThan(0)
})

it("refuses a block in the future and says so under the field", () => {
  render(<FocusTimer />, { wrapper })
  fireEvent.press(screen.getAllByLabelText("Add focus time")[1])
  // 08:00 + 75 min ends 09:15, past now (09:00).
  fireEvent.press(screen.getByLabelText("Increase Duration"))
  fireEvent.press(screen.getByLabelText("Increase Duration"))
  fireEvent.press(screen.getByLabelText("Increase Duration"))
  expect(screen.getByText("That's in the future")).toBeTruthy()
  fireEvent.press(screen.getByText("Save focus time"))
  expect(sessions()).toHaveLength(0)
})

it("a logged block opens its editor: change it, or delete it", () => {
  const id = P.savePastSession({
    kind: "focus",
    start: T0 - 120 * MIN,
    end: T0 - 90 * MIN,
    label: "Typo",
  }) as string
  render(<FocusTimer />, { wrapper })
  fireEvent.press(screen.getByLabelText("Edit focus time"))
  expect(screen.getByText("Edit focus time")).toBeTruthy()
  expect(screen.getByLabelText("Duration").props.value).toBe("30")
  fireEvent.changeText(
    screen.getByPlaceholderText("e.g. Reading chapter 3"),
    "Reading",
  )
  fireEvent.press(screen.getByLabelText("Increase Duration"))
  fireEvent.press(screen.getByText("Save changes"))
  // Same session, 35 min = 2,100 s.
  expect(sessions()).toHaveLength(1)
  expect(sessions()[0]).toMatchObject({ id, label: "Reading", focusSec: 2100 })
  // The sheet finishes leaving before it is opened again.
  act(() => {
    jest.advanceTimersByTime(1000)
  })
  fireEvent.press(screen.getByLabelText("Edit focus time"))
  fireEvent.press(screen.getByText("Delete focus time"))
  expect(sessions()).toHaveLength(0)
})

it("a timed block can be deleted after a confirm; a running one cannot", () => {
  const alert = jest.spyOn(Alert, "alert")
  jest.setSystemTime(T0 - 60 * MIN)
  A.startFocus({ preset: "25-5" })
  jest.setSystemTime(T0 - 50 * MIN)
  A.stopFocus()
  jest.setSystemTime(T0)
  render(<FocusTimer />, { wrapper })
  fireEvent.press(screen.getByLabelText("Delete focus session"))
  expect(alert).toHaveBeenCalledTimes(1)
  const buttons = alert.mock.calls[0][2] as {
    text: string
    onPress?: () => void
  }[]
  act(() => buttons.find((b) => b.text === "Delete")?.onPress?.())
  expect(sessions()).toHaveLength(0)
  // A session still running offers nothing to delete in the timeline.
  act(() => {
    A.startFocus({ preset: "25-5" })
    jest.advanceTimersByTime(60_000)
  })
  expect(screen.queryByLabelText("Delete focus session")).toBeNull()
})
