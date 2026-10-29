// Patterns on Stats, from the phone's own stores and Apple Health: hidden
// until something qualifies, then up to three sentences.
import { captureStore } from "@domain/capture/store"
import { fitStore } from "@domain/fitness/store"
import { habitsStore } from "@domain/habits/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, render, screen } from "@testing-library/react-native"
import { insightDays, PatternsCard } from "../screens/patterns-card"
import { calDay } from "../screens/steps-card"

let mockNights: (days: readonly string[]) => (number | null)[] = (d) =>
  d.map(() => null)
jest.mock("../health", () => ({
  healthAvailable: () => true,
  healthAsked: async () => true,
  connectHealth: async () => true,
  readSleep: async (days: readonly string[]) => mockNights(days),
  readDays: async (days: readonly string[]) => days.map(() => null),
  localDay: jest.requireActual("../health").localDay,
}))
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
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
  withTiming: (value: unknown) => value,
  withDelay: (_: number, value: unknown) => value,
  withSequence: (...values: unknown[]) => values[values.length - 1],
  interpolate: (_: number, __: number[], output: number[]) => output[0],
  runOnJS: (fn: unknown) => fn,
  useReducedMotion: () => true,
}))
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
}))
jest.mock("react-native-gesture-handler", () => {
  const chain: object = new Proxy({}, { get: () => () => chain })
  return {
    Gesture: chain,
    GestureDetector: ({ children }: { children: unknown }) => children,
  }
})

const entry = (day: string, mood: 1 | 2 | 3 | 4 | 5) => ({
  id: `j-${day}`,
  day,
  createdAt: `${day}T09:00:00Z`,
  body: "x",
  source: "text" as const,
  mood,
  tags: [],
  private: true,
})
// The last 20 days: even days 8h of sleep and Great, odd days 5h and Okay.
const last20 = Array.from({ length: 20 }, (_, i) => calDay(i - 19))
const good = (day: string) => last20.indexOf(day) % 2 === 0

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  fitStore.set((s) => ({ ...s, workouts: [] }))
  habitsStore.set((s) => ({ ...s, habits: [], logs: [] }))
  captureStore.set((s) => ({ ...s, journal: [] }))
  mockNights = (d) => d.map(() => null)
})

test("assembly: one row per day with that day's mood average", () => {
  const rows = insightDays(
    ["2026-10-01", "2026-10-02"],
    [480, null],
    undefined,
    fitStore.get(),
    habitsStore.get(),
    [entry("2026-10-01", 5), { ...entry("2026-10-01", 3), id: "j2" }],
  )
  expect(rows).toEqual([
    expect.objectContaining({ day: "2026-10-01", sleepMin: 480, mood: 4 }),
    expect.objectContaining({
      day: "2026-10-02",
      sleepMin: null,
      mood: undefined,
    }),
  ])
})

test("card: shows the sleep and mood pattern", async () => {
  captureStore.set((s) => ({
    ...s,
    journal: last20.map((d) => entry(d, good(d) ? 5 : 3)),
  }))
  mockNights = (d) =>
    d.map((day) => (last20.includes(day) ? (good(day) ? 480 : 300) : null))
  render(<PatternsCard />)
  expect(
    await screen.findByText(
      "After 7h+ of sleep, your mood averages 5.0/5, vs 3.0 after shorter nights.",
    ),
  ).toBeTruthy()
  expect(screen.getByText("PATTERNS")).toBeTruthy()
})

test("card: nothing qualifies, nothing shown", async () => {
  render(<PatternsCard />)
  await act(async () => {})
  expect(screen.toJSON()).toBeNull()
})
