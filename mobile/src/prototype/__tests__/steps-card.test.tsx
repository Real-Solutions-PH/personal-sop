// Fitness's steps card: today's count and the last seven days, like the
// Health app's summary.
import { dayOffset } from "@domain/lib/day"
import { render, screen } from "@testing-library/react-native"
import type { Activity } from "../health"
import { StepsCard } from "../screens/steps-card"

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
const mockRead = jest.fn<Promise<Activity | null>, [string]>()
let mockAvailable = true
jest.mock("../health", () => ({
  healthAvailable: () => mockAvailable,
  readActivity: (day: string) => mockRead(day),
}))

const steps = [4000, 6000, 8000, 10000, 2000, 5000, 7000] // oldest → today
beforeEach(() => {
  mockAvailable = true
  mockRead.mockClear()
  mockRead.mockImplementation(async (d) => {
    const i = [6, 5, 4, 3, 2, 1, 0].findIndex((n) => dayOffset(-n) === d)
    return i < 0
      ? null
      : { steps: steps[i] ?? 0, activeKcal: 0, distanceKm: 5.2, workouts: 0 }
  })
})

test("today's steps, the 7-day average and a bar per day", async () => {
  render(<StepsCard />)
  expect(await screen.findByText("7,000")).toBeTruthy()
  expect(screen.getByText("Avg 6,000 a day · 5.2 km today")).toBeTruthy()
  expect(
    screen.getByLabelText(
      "Steps, last 7 days: 4,000, 6,000, 8,000, 10,000, 2,000, 5,000, 7,000",
    ),
  ).toBeTruthy()
  expect(mockRead).toHaveBeenCalledTimes(7)
})

test("a day Health could not read counts as zero", async () => {
  mockRead.mockImplementation(async (d) =>
    d === dayOffset(0)
      ? { steps: 700, activeKcal: 0, distanceKm: 0.5, workouts: 0 }
      : null,
  )
  render(<StepsCard />)
  expect(await screen.findByText("700")).toBeTruthy()
  expect(screen.getByText("Avg 100 a day · 0.5 km today")).toBeTruthy()
})

test("no Health on the device: no card", () => {
  mockAvailable = false
  render(<StepsCard />)
  expect(screen.toJSON()).toBeNull()
  expect(mockRead).not.toHaveBeenCalled()
})
