// The activity card: today's Apple Health numbers and the opt-in eat-back.
// Nothing changes the budget until the user taps.
import { adjustmentOn } from "@domain/fitness/calc"
import { fitStore } from "@domain/fitness/store"
import { dayKey, dayOffset } from "@domain/lib/day"
import { configureStorage, resetAll } from "@domain/lib/store"
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native"
import type { Activity } from "../health"
import { ActivityCard, eatBackOffer } from "../screens/activity-card"

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
const mockRead = jest.fn<Promise<Activity | null>, [string]>()
const mockConnect = jest.fn(async () => true)
let mockAvailable = true
jest.mock("../health", () => ({
  healthAvailable: () => mockAvailable,
  connectHealth: () => mockConnect(),
  readActivity: (day: string) => mockRead(day),
}))

const mockRemind = jest.fn(async (_b: number, _a: number) => {})
jest.mock("../local-reminders", () => ({
  scheduleEatBackReminder: (b: number, a: number) => mockRemind(b, a),
}))

const act1 = (activeKcal: number): Activity => ({
  steps: 8412,
  activeKcal,
  distanceKm: 6.27,
  workouts: 2,
})

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  fitStore.set((s) => ({ ...s, adjustments: [] }))
  mockAvailable = true
  mockRead.mockReset()
})

test("offer: add, add more once 50 kcal past, else added", () => {
  expect(eatBackOffer(420, 0)).toEqual({ kind: "add", kcal: 420 })
  expect(eatBackOffer(500, 420)).toEqual({ kind: "more", kcal: 80 })
  expect(eatBackOffer(440, 420)).toEqual({ kind: "added", kcal: 0 })
  expect(eatBackOffer(0, 0)).toEqual({ kind: "added", kcal: 0 })
})

test("shows the day's activity and adds the burn only on tap", async () => {
  mockRead.mockImplementation(async (d) => (d === dayKey() ? act1(420) : null))
  render(<ActivityCard day={dayKey()} />)
  expect(await screen.findByText("8,412")).toBeTruthy()
  expect(screen.getByText("6.27 km")).toBeTruthy()
  expect(screen.getByText("2 workouts")).toBeTruthy()
  expect(adjustmentOn(fitStore.get(), dayKey())).toBe(0)
  await act(async () =>
    fireEvent.press(screen.getByText("Add 420 kcal to budget")),
  )
  expect(adjustmentOn(fitStore.get(), dayKey())).toBe(420)
  expect(screen.getByText("Added to budget ✓")).toBeTruthy()
})

test("after more burning, a tap sets the new total", async () => {
  fitStore.set((s) => ({
    ...s,
    adjustments: [{ id: "a", day: dayKey(), kcal: 420 }],
  }))
  mockRead.mockImplementation(async (d) => (d === dayKey() ? act1(500) : null))
  render(<ActivityCard day={dayKey()} />)
  const btn = await screen.findByText("Add 80 more kcal")
  await act(async () => fireEvent.press(btn))
  expect(adjustmentOn(fitStore.get(), dayKey())).toBe(500)
})

test("no data from Health shows the connect button", async () => {
  mockRead.mockResolvedValue(null)
  render(<ActivityCard day={dayKey()} />)
  const connect = await screen.findByText("Connect Apple Health")
  mockRead.mockResolvedValue(act1(300))
  await act(async () => fireEvent.press(connect))
  expect(mockConnect).toHaveBeenCalled()
  expect(await screen.findByText("Add 300 kcal to budget")).toBeTruthy()
})

test("no Health on the device: no card", () => {
  mockAvailable = false
  render(<ActivityCard day={dayKey()} />)
  expect(screen.toJSON()).toBeNull()
})

test("today's card offers yesterday's unadded burn", async () => {
  const y = dayOffset(-1)
  mockRead.mockImplementation(async (d) =>
    d === dayKey() ? act1(100) : d === y ? act1(380) : null,
  )
  render(<ActivityCard day={dayKey()} />)
  const btn = await screen.findByText("Add yesterday's 380 kcal")
  await act(async () => fireEvent.press(btn))
  expect(adjustmentOn(fitStore.get(), y)).toBe(380)
  await waitFor(() =>
    expect(screen.queryByText("Add yesterday's 380 kcal")).toBeNull(),
  )
})

test("older days get no card", () => {
  render(<ActivityCard day={dayOffset(-2)} />)
  expect(screen.toJSON()).toBeNull()
  expect(mockRead).not.toHaveBeenCalled()
})

test("today's card keeps tonight's reminder in step with what was added", async () => {
  mockRead.mockImplementation(async (d) => (d === dayKey() ? act1(420) : null))
  render(<ActivityCard day={dayKey()} />)
  const btn = await screen.findByText("Add 420 kcal to budget")
  await waitFor(() => expect(mockRemind).toHaveBeenLastCalledWith(420, 0))
  await act(async () => fireEvent.press(btn))
  await waitFor(() => expect(mockRemind).toHaveBeenLastCalledWith(420, 420))
})
