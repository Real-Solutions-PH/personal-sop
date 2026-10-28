// Steps from Apple Health: Fitness's card (today, this week, this month, a
// bar per day) and the detail screen (week or month, totals and bests).
import { dayOffset } from "@domain/lib/day"
import { fireEvent, render, screen } from "@testing-library/react-native"
import { router } from "expo-router"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import type { Activity } from "../health"
import { StepsCard, stepStats } from "../screens/steps-card"
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
const mockRead = jest.fn<Promise<Activity | null>, [string]>()
let mockAvailable = true
jest.mock("../health", () => ({
  healthAvailable: () => mockAvailable,
  readActivity: (day: string) => mockRead(day),
}))

const week = [4000, 6000, 8000, 10000, 2000, 5000, 7000] // oldest → today
const day = (s: number, km = 5.2, kcal = 300): Activity => ({
  steps: s,
  activeKcal: kcal,
  distanceKm: km,
  workouts: 0,
})
const label = (offset: number) =>
  new Date(`${dayOffset(offset)}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
beforeEach(() => {
  mockAvailable = true
  mockRead.mockClear()
  jest.mocked(router.push).mockClear()
  mockRead.mockImplementation(async (d) => {
    const i = [6, 5, 4, 3, 2, 1, 0].findIndex((n) => dayOffset(-n) === d)
    return i < 0 ? null : day(week[i] ?? 0)
  })
})

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
  const n = Number(dayOffset(0).slice(8))
  const month = Array.from({ length: n }, (_, i) => n - 1 - i).map(
    (o) => week[6 - o] ?? 0,
  )
  const avg = Math.round(month.reduce((a, b) => a + b, 0) / n)
  expect(
    screen.getByLabelText(
      `This month: ${avg.toLocaleString("en-US")} steps a day on average`,
    ),
  ).toBeTruthy()
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
  expect(mockRead).not.toHaveBeenCalled()
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

test("detail: Month reads every day from the 1st", async () => {
  render(<StepsDetail />, { wrapper })
  await screen.findByText("42,000")
  mockRead.mockClear()
  fireEvent.press(screen.getByText("Month"))
  const n = Number(dayOffset(0).slice(8))
  expect(await screen.findByText(`1 of ${n}`)).toBeTruthy()
  expect(mockRead).toHaveBeenCalledTimes(n)
})
