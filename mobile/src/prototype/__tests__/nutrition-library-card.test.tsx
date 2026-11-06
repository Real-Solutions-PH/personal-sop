// Log meal, top to bottom: which meal it is comes first (picked from the
// time of day), then the Food library card. Before a search the card
// previews what this person ate or logged lately, foods and whole meals in
// one list, most recent first; with no history it is dimmed real rows.

import type { Meal } from "@domain/fitness/data"
import { fitStore } from "@domain/fitness/store"
import { dayKey } from "@domain/lib/day"
import { configureStorage, resetAll } from "@domain/lib/store"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react-native"
import { SafeAreaProvider } from "react-native-safe-area-context"

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
jest.mock("react-native-gesture-handler", () => {
  const chain: object = new Proxy({}, { get: () => () => chain })
  return {
    Gesture: new Proxy({}, { get: () => () => chain }),
    GestureDetector: ({ children }: { children: unknown }) => children,
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
  usePathname: () => "/nutrition/new",
  useFocusEffect: () => {},
}))
jest.mock("expo-image", () => {
  const { View } = require("react-native")
  return { Image: (props: object) => <View {...props} /> }
})
jest.mock("@/live/config", () => ({
  liveMode: true,
  API_URL: "http://api.test",
  API_PREFIX: "/api/v1",
}))
const mockRequest = jest.fn()
jest.mock("@/live/auth", () => ({ http: { request: mockRequest } }))

const { ManualMeal } = require("../screens/nutrition-meals")
const { recentFirst } = require("../screens/nutrition-library-card")

const food = (id: string, name: string, last: string | null = null) => ({
  id,
  name,
  aliases: [],
  basis: "serving",
  unit_grams: null,
  state: null,
  kcal: 100,
  protein: 10,
  carbs: 10,
  fat: 2,
  fiber: null,
  sat_fat: null,
  sugar: null,
  sodium: null,
  notes: null,
  source: "usda",
  verified: true,
  use_count: 1,
  last_used_at: last,
  photo_media_id: null,
  photo_url: null,
  can_edit: false,
})
const meal = (id: string, at: Date, ...names: string[]): Meal => ({
  id,
  eatenAt: at.toISOString(),
  label: "lunch",
  source: "text",
  rawInput: names.join(", "),
  status: "confirmed",
  items: names.map((name, i) => ({
    id: `${id}-${i}`,
    name,
    qty: 1,
    unit: "serving",
    kcal: 200,
    protein: 10,
    carbs: 20,
    fat: 5,
  })),
})
const daysAgo = (n: number, hour = 12) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(hour, 0, 0, 0)
  return d
}
const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
}
function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <QueryClientProvider client={client}>
        <ManualMeal />
      </QueryClientProvider>
    </SafeAreaProvider>,
  )
}
const serve = (foods: object[]) =>
  mockRequest.mockImplementation(async (method: string, path: string) =>
    method === "GET" && path.startsWith("/nutrition/foods?")
      ? { data: foods, count: foods.length }
      : undefined,
  )
/** Every text on screen, top to bottom. */
const texts = () => {
  const out: string[] = []
  const walk = (n: unknown): void => {
    if (typeof n === "string") out.push(n)
    else if (Array.isArray(n)) n.forEach(walk)
    else if (n && typeof n === "object" && "children" in n)
      walk((n as { children: unknown }).children)
  }
  walk(screen.toJSON())
  return out
}

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  mockRequest.mockReset()
})
afterEach(() => jest.useRealTimers())

test("the meal type comes first, above the Food library, picked from the time", async () => {
  // Only the clock is faked: React Query's timers stay real.
  jest.useFakeTimers({
    now: new Date(2026, 10, 6, 19, 30),
    doNotFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "setImmediate",
      "clearImmediate",
      "queueMicrotask",
      "nextTick",
    ],
  })
  serve([])
  show()
  await screen.findByText("Recently eaten")
  // 7:30 pm is dinner.
  expect(screen.getByLabelText("Dinner").props.accessibilityState).toEqual({
    selected: true,
  })
  expect(screen.getByLabelText("Lunch").props.accessibilityState).toEqual({
    selected: false,
  })
  const all = texts()
  const at = (s: string) => all.indexOf(s)
  for (const s of ["breakfast", "Scan", "Food library", "Describe it"])
    expect(at(s)).toBeGreaterThanOrEqual(0)
  expect(at("breakfast")).toBeLessThan(at("Scan"))
  expect(at("Scan")).toBeLessThan(at("Food library"))
  expect(at("Food library")).toBeLessThan(at("Describe it"))
  // Not repeated further down.
  expect(all.filter((s) => s === "breakfast")).toHaveLength(1)
})

test("recent first: foods and meals by when they were last eaten", () => {
  const today = dayKey()
  const out = recentFirst(
    [
      // The server's most-used order.
      food("never", "Peanut butter"),
      food("house", "Oats", daysAgo(2).toISOString()),
      food("mine", "Egg, boiled", daysAgo(9).toISOString()),
    ],
    [
      // This person's own meal makes Egg recent, whatever the household did.
      meal("m-egg", daysAgo(0, 8), "Egg, boiled"),
      meal("m-adobo", daysAgo(1), "Adobo", "Rice"),
      meal("m-adobo-old", daysAgo(5), "Adobo", "Rice"),
      // A one-food meal of a listed food is the food's row, not a second one.
      meal("m-oats", daysAgo(3), "Oats"),
      meal("m-sinigang", daysAgo(4), "Sinigang"),
      { ...meal("m-draft", daysAgo(0, 9), "Pancit"), status: "estimated" },
    ],
    today,
  )
  expect(
    out.map((e: { kind: string; food?: { id: string }; meal?: Meal }) =>
      e.kind === "food" ? e.food?.id : e.meal?.id,
    ),
  ).toEqual([
    "mine", // today, from this person's meal
    "m-adobo", // yesterday; the older copy of the same meal is left out
    "house", // two days ago, the household's last use
    "m-sinigang", // four days ago
    "never", // saved, never eaten: last
  ])
  // Today's meals are not offered to log again on the same day.
  expect(out.some((e: { meal?: Meal }) => e.meal?.id === "m-egg")).toBe(false)
})

test("the preview lists this person's foods and meals most recent first", async () => {
  fitStore.set((s) => ({
    ...s,
    meals: [
      meal("m-old", daysAgo(6), "Chicken tinola", "Rice"),
      meal("m-new", daysAgo(1), "Beef tapa", "Garlic rice"),
    ],
  }))
  serve([
    food("f-old", "Greek yogurt", daysAgo(10).toISOString()),
    food("f-new", "Banana", daysAgo(0, 7).toISOString()),
    food("f-mid", "Whey protein", daysAgo(3).toISOString()),
  ])
  show()
  await screen.findByLabelText("Pick Banana")
  const rows = screen
    .getAllByLabelText(/^(Pick |Log )/)
    .map((n) => n.props.accessibilityLabel)
  expect(rows).toEqual([
    "Pick Banana",
    "Log Beef tapa, Garlic rice again, 400 kcal",
    "Pick Whey protein",
    "Log Chicken tinola, Rice again, 400 kcal",
    "Pick Greek yogurt",
  ])
  expect(screen.getByText("Recently eaten")).toBeTruthy()
  expect(screen.queryByTestId("foods-empty")).toBeNull()
  // The way into the whole library.
  expect(screen.getByLabelText("Browse the full food library")).toBeTruthy()
})

test("no history is dimmed real rows with the step that fills it", async () => {
  fitStore.set((s) => ({ ...s, meals: [] }))
  serve([])
  show()
  expect(await screen.findByTestId("foods-empty")).toBeTruthy()
  expect(screen.getByText(/No foods eaten yet/)).toBeTruthy()
  // The sample rows are drawn but hidden from touch and screen readers.
  expect(
    screen.getByText("Chicken breast, grilled", {
      includeHiddenElements: true,
    }),
  ).toBeTruthy()
  expect(screen.queryByLabelText(/^Pick /)).toBeNull()
  expect(screen.getByLabelText("Browse the full food library")).toBeTruthy()
})
