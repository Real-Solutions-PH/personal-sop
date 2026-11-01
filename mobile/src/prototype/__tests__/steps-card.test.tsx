// Steps from Apple Health: Fitness's card (today, this week, this month, a
// bar per day) and the detail screen (week or month, totals and bests).
// Days are calendar days (midnight to midnight), as Health counts them.
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import { router } from "expo-router"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import type { DayActivity } from "../health"
import { calDay, StepsCard, stepStats } from "../screens/steps-card"
import { StepsDetail } from "../screens/steps-detail"

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
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
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
const mockReadDays = jest.fn<
  Promise<(DayActivity | null)[]>,
  [readonly string[]]
>()
let mockAvailable = true
let mockAsked: () => Promise<boolean> = async () => true
const mockConnect = jest.fn(async () => {
  mockAsked = async () => true
  return true
})
jest.mock("../health", () => ({
  healthAvailable: () => mockAvailable,
  healthAsked: () => mockAsked(),
  connectHealth: () => mockConnect(),
  readDays: (days: readonly string[]) => mockReadDays(days),
  localDay: jest.requireActual("../health").localDay,
}))

const week = [4000, 6000, 8000, 10000, 2000, 5000, 7000] // oldest → today
const day = (s: number, km = 5.2, kcal = 300): DayActivity => ({
  steps: s,
  activeKcal: kcal,
  distanceKm: km,
})
const label = (offset: number) =>
  new Date(`${calDay(offset)}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
const fromWeek = async (days: readonly string[]) =>
  days.map((d) => {
    const i = [6, 5, 4, 3, 2, 1, 0].findIndex((n) => calDay(-n) === d)
    return i < 0 ? null : day(week[i] ?? 0)
  })
// The clock is pinned mid-month, as on most days: "this month" then spans
// more than this week. On the 1st the month is one day long and its average
// is today's figure, which the expectations below don't describe. Only Date
// is faked, so the real timers still drive findBy and waitFor.
const pinMidMonth = () =>
  jest.useFakeTimers({
    now: new Date(2026, 9, 15, 12),
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
beforeEach(() => {
  pinMidMonth()
  mockAvailable = true
  mockAsked = async () => true
  mockConnect.mockClear()
  mockReadDays.mockReset()
  mockReadDays.mockImplementation(fromWeek)
  jest.mocked(router.push).mockClear()
})
afterEach(() => jest.useRealTimers())

test("stats: total, average, best day, distance, kcal and 10k days", () => {
  expect(
    stepStats([
      day(4000, 3, 200),
      null,
      day(12000, 9, 600),
      day(10000, 7, 500),
    ]),
  ).toEqual({
    total: 26000,
    avg: 6500,
    best: 2,
    km: 19,
    kcal: 1300,
    goalDays: 2,
  })
  expect(stepStats([])).toEqual({
    total: 0,
    avg: 0,
    best: -1,
    km: 0,
    kcal: 0,
    goalDays: 0,
  })
})

test("card: today's steps, this week's and this month's averages", async () => {
  render(<StepsCard />)
  expect(await screen.findByText("7,000")).toBeTruthy()
  expect(screen.getByText("5.2 km today")).toBeTruthy()
  expect(
    screen.getByLabelText("This week: 6,000 steps a day on average"),
  ).toBeTruthy()
  // This month: the 1st to today; days Health had nothing for count 0.
  const n = new Date().getDate()
  const month = Array.from({ length: n }, (_, i) => n - 1 - i).map(
    (o) => week[6 - o] ?? 0,
  )
  const avg = Math.round(month.reduce((a, b) => a + b, 0) / n)
  expect(
    screen.getByLabelText(
      `This month: ${avg.toLocaleString("en-US")} steps a day on average`,
    ),
  ).toBeTruthy()
  // One batched read for the whole span, not one per day.
  expect(mockReadDays).toHaveBeenCalledTimes(1)
})

test("card: after midnight 'today' is the new calendar day, as in Health", async () => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] })
  jest.setSystemTime(new Date(2026, 9, 28, 1, 30))
  render(<StepsCard />)
  await act(async () => {})
  expect(mockReadDays.mock.calls[0]?.[0].at(-1)).toBe("2026-10-28")
})

test("card: tapping a day's bar shows that day's steps", async () => {
  render(<StepsCard />)
  await screen.findByText("7,000")
  fireEvent.press(screen.getByLabelText(`${label(-3)}: 10,000 steps`))
  expect(screen.getByText("10,000")).toBeTruthy()
  expect(screen.getByText(`STEPS · ${label(-3).toUpperCase()}`)).toBeTruthy()
  expect(screen.getByText("5.2 km that day")).toBeTruthy()
  expect(
    screen.getByLabelText(`${label(-3)}: 10,000 steps`).props
      .accessibilityState,
  ).toMatchObject({ selected: true })
  fireEvent.press(screen.getByLabelText(`${label(0)}: 7,000 steps`))
  expect(screen.getByText("STEPS TODAY")).toBeTruthy()
})

test("card: Details opens the steps screen", async () => {
  render(<StepsCard />)
  await screen.findByText("7,000")
  fireEvent.press(screen.getByLabelText("Step details"))
  expect(router.push).toHaveBeenCalledWith("/fitness/steps")
})

test("card: no Health on the device, no card", () => {
  mockAvailable = false
  render(<StepsCard />)
  expect(screen.toJSON()).toBeNull()
  expect(mockReadDays).not.toHaveBeenCalled()
})

test("card: before Health is allowed, a Connect button instead of zeros", async () => {
  mockAsked = async () => false
  render(<StepsCard />)
  const connect = await screen.findByText("Connect Apple Health")
  expect(screen.queryByText("STEPS TODAY")).toBeNull()
  await act(async () => fireEvent.press(connect))
  expect(mockConnect).toHaveBeenCalled()
  expect(await screen.findByText("7,000")).toBeTruthy()
})

test("connecting in one place updates every card at once", async () => {
  mockAsked = async () => false
  render(
    <>
      <StepsCard />
      <StepsCard />
    </>,
  )
  const [first] = await screen.findAllByText("Connect Apple Health")
  await act(async () => fireEvent.press(first as never))
  expect(await screen.findAllByText("7,000")).toHaveLength(2)
  expect(screen.queryByText("Connect Apple Health")).toBeNull()
})

test("detail: the week's totals, best day and 10k days", async () => {
  render(<StepsDetail />, { wrapper })
  expect(await screen.findByText("42,000")).toBeTruthy() // total
  expect(screen.getByText("6,000")).toBeTruthy() // daily average
  expect(screen.getByText(`10,000 · ${label(-3)}`)).toBeTruthy() // best
  expect(screen.getByText("1 of 7")).toBeTruthy() // days at 10k
  expect(screen.getByText("36.4 km")).toBeTruthy()
  expect(screen.getByText("2,100 kcal")).toBeTruthy()
})

test("detail: Month reads every day from the 1st in one batch", async () => {
  render(<StepsDetail />, { wrapper })
  await screen.findByText("42,000")
  mockReadDays.mockClear()
  fireEvent.press(screen.getByText("Month"))
  const n = new Date().getDate()
  expect(await screen.findByText(`1 of ${n}`)).toBeTruthy()
  expect(mockReadDays).toHaveBeenCalledTimes(1)
  expect(mockReadDays.mock.calls[0]?.[0]).toHaveLength(n)
})

test("detail: month labels stay on one line", async () => {
  render(<StepsDetail />, { wrapper })
  await screen.findByText("42,000")
  fireEvent.press(screen.getByText("Month"))
  await screen.findByText(`1 of ${new Date().getDate()}`)
  expect(screen.getByText("1").props.numberOfLines).toBe(1)
})

test("detail: switching range never pairs the old days with the new dates", async () => {
  render(<StepsDetail />, { wrapper })
  await screen.findByText("42,000")
  let finish: () => void = () => {}
  const gate = new Promise<void>((r) => {
    finish = r
  })
  mockReadDays.mockImplementation(async (d) => {
    await gate
    return fromWeek(d)
  })
  fireEvent.press(screen.getByText("Month"))
  expect(screen.queryByText("1 of 7")).toBeNull()
  expect(screen.queryByText("42,000")).toBeNull()
  await act(async () => finish())
  expect(await screen.findByText(`1 of ${new Date().getDate()}`)).toBeTruthy()
})

test("detail: while checking Health, no 'isn't connected' flash", async () => {
  let answer: (v: boolean) => void = () => {}
  mockAsked = () =>
    new Promise<boolean>((r) => {
      answer = r
    })
  render(<StepsDetail />, { wrapper })
  expect(screen.queryByText("Apple Health isn't connected")).toBeNull()
  await act(async () => answer(true))
  expect(await screen.findByText("42,000")).toBeTruthy()
})

test("detail: before Health is allowed, a Connect button", async () => {
  mockAsked = async () => false
  render(<StepsDetail />, { wrapper })
  expect(await screen.findByText("Connect Apple Health")).toBeTruthy()
  expect(screen.queryByText("Total steps")).toBeNull()
})
