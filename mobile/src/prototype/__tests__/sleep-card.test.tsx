// Sleep from Apple Health: the card on Fitness and Today (last night, the
// week's average, a bar per night) and the detail screen (week or month).
// A night belongs to the day you wake.
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import { router } from "expo-router"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { hm, SleepCard, SleepPart, sleepStats } from "../screens/sleep-card"
import { SleepDetail } from "../screens/sleep-detail"
import { calDay } from "../screens/steps-card"

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
  interpolate: (_: number, __: number[], output: number[]) => output[0],
  runOnJS: (fn: unknown) => fn,
  useReducedMotion: () => true,
}))
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
  usePathname: () => "/",
}))
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
}))
jest.mock("react-native-gesture-handler", () => {
  const chain: object = new Proxy({}, { get: () => () => chain })
  return {
    Gesture: chain,
    GestureDetector: ({ children }: { children: ReactNode }) => children,
  }
})
const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
)
const mockReadSleep = jest.fn<Promise<(number | null)[]>, [readonly string[]]>()
let mockAsked: () => Promise<boolean> = async () => true
jest.mock("../health", () => ({
  healthAvailable: () => true,
  healthAsked: () => mockAsked(),
  connectHealth: async () => true,
  readSleep: (days: readonly string[]) => mockReadSleep(days),
  localDay: jest.requireActual("../health").localDay,
}))

// Minutes asleep, oldest → last night; one night untracked.
const week = [420, 390, null, 480, 400, 360, 450]
const fromWeek = async (days: readonly string[]) =>
  days.map((d) => {
    const i = [6, 5, 4, 3, 2, 1, 0].findIndex((n) => calDay(-n) === d)
    return i < 0 ? null : (week[i] ?? null)
  })
// Mid-month, so "this month" has more days than the week shown; on the 1st
// the month's average is today's and the figures can't be told apart. Only
// Date is faked: the screens' timers and promises run as usual.
const pinDay = () => {
  jest.useFakeTimers({
    doNotFake: [
      "hrtime",
      "nextTick",
      "performance",
      "queueMicrotask",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "requestIdleCallback",
      "cancelIdleCallback",
      "setImmediate",
      "clearImmediate",
      "setInterval",
      "clearInterval",
      "setTimeout",
      "clearTimeout",
    ],
  })
  jest.setSystemTime(new Date(2026, 9, 22, 12))
}
beforeEach(() => {
  pinDay()
  mockAsked = async () => true
  mockReadSleep.mockReset()
  mockReadSleep.mockImplementation(fromWeek)
  jest.mocked(router.push).mockClear()
})
afterEach(() => jest.useRealTimers())

test("hours and minutes", () => {
  expect(hm(425)).toBe("7h 05m")
  expect(hm(0)).toBe("0h 00m")
})

test("stats skip nights with no data instead of counting them as 0h", () => {
  expect(sleepStats([null, 0, 480, 360])).toEqual({
    avg: 420,
    best: 2,
    goalNights: 1,
    tracked: 2,
  })
  expect(sleepStats([])).toEqual({
    avg: 0,
    best: -1,
    goalNights: 0,
    tracked: 0,
  })
})

test("card: last night and the week's average", async () => {
  render(<SleepCard />)
  expect(await screen.findByText("7h 30m")).toBeTruthy()
  expect(screen.getByText("LAST NIGHT")).toBeTruthy()
  // (420+390+480+400+360+450)/6 = 416.67 → 6h 57m
  expect(
    screen.getByLabelText("This week: 6h 57m a night on average"),
  ).toBeTruthy()
})

test("card: Details opens the sleep screen", async () => {
  render(<SleepCard />)
  await screen.findByText("7h 30m")
  fireEvent.press(screen.getByLabelText("Sleep details"))
  expect(router.push).toHaveBeenCalledWith("/fitness/sleep")
})

test("card: nothing tracked this week, no card", async () => {
  mockReadSleep.mockImplementation(async (d) => d.map(() => 0))
  render(<SleepCard />)
  await act(async () => {})
  expect(screen.queryByText("LAST NIGHT")).toBeNull()
  expect(screen.queryByText("0h 00m")).toBeNull()
})

test("card: before Health is allowed, nothing (Steps shows the Connect button)", async () => {
  mockAsked = async () => false
  render(<SleepCard />)
  await act(async () => {})
  expect(screen.queryByText("Connect Apple Health")).toBeNull()
  expect(screen.queryByText("LAST NIGHT")).toBeNull()
})

test("Today's row: last night and the 7-night average, opens Sleep", async () => {
  render(<SleepPart />)
  expect(await screen.findByText("7h 30m sleep last night")).toBeTruthy()
  expect(screen.getByText("7-night avg 6h 57m")).toBeTruthy()
  fireEvent.press(screen.getByLabelText("Sleep details"))
  expect(router.push).toHaveBeenCalledWith("/fitness/sleep")
})

test("Today's row: nothing tracked, no row", async () => {
  mockReadSleep.mockImplementation(async (d) => d.map(() => null))
  render(<SleepPart />)
  await act(async () => {})
  expect(screen.toJSON()).toBeNull()
})

test("detail: the week's average, best night and nights at 7h", async () => {
  render(<SleepDetail />, { wrapper })
  expect(await screen.findByText("6h 57m")).toBeTruthy()
  expect(screen.getByText("Nights at 7h")).toBeTruthy()
  expect(screen.getByText("3 of 6")).toBeTruthy() // 420, 480, 450
  expect(screen.getByText("6 of 7")).toBeTruthy() // nights tracked
})

test("detail: Month reads every night from the 1st in one batch", async () => {
  render(<SleepDetail />, { wrapper })
  await screen.findByText("6h 57m")
  mockReadSleep.mockClear()
  fireEvent.press(screen.getByText("Month"))
  const n = new Date().getDate()
  expect(await screen.findByText(`6 of ${n}`)).toBeTruthy()
  expect(mockReadSleep.mock.calls[0]?.[0]).toHaveLength(n)
})

test("detail: nothing tracked, an empty state instead of 0h bars", async () => {
  mockReadSleep.mockImplementation(async (d) => d.map(() => null))
  render(<SleepDetail />, { wrapper })
  expect(await screen.findByText("No sleep in Apple Health yet")).toBeTruthy()
  expect(screen.queryByText("Nights at 7h")).toBeNull()
})
