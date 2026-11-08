// The food library in live mode: loading, empty and error are three
// different screens, a failure settles on a retry card rather than a
// skeleton, and Try again loads the foods. Every row says where its food
// came from; a filter asks the server for one source; a search shows the
// words it matched, and a search that finds nothing says so.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native"
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
  usePathname: () => "/nutrition/foods",
  useFocusEffect: () => {},
}))
jest.mock("@/live/config", () => ({
  liveMode: true,
  API_URL: "http://api.test",
  API_PREFIX: "/api/v1",
}))
const mockRequest = jest.fn()
jest.mock("@/live/auth", () => ({ http: { request: mockRequest } }))

// A search waits for a typing pause, which a loaded test host stretches.
jest.setTimeout(30_000)

const { FoodLibrary } = require("../screens/nutrition-foods")
const { fitStore } = require("@domain/fitness/store")

const food = {
  id: "f1",
  name: "Skyr, vanilla",
  aliases: [],
  basis: "serving",
  unit_grams: 150,
  kcal: 1200,
  protein: 15,
  carbs: 10,
  fat: 0,
  fiber: null,
  sat_fat: null,
  sugar: null,
  sodium: 1500,
  source: "label",
  verified: true,
  use_count: 3,
  last_used_at: null,
}
const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
}

function show() {
  // A fresh client per test: a shared cache would carry one test's answer
  // into the next.
  const client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: 0 } },
  })
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <QueryClientProvider client={client}>
        <FoodLibrary />
      </QueryClientProvider>
    </SafeAreaProvider>,
  )
}

beforeEach(() => {
  mockRequest.mockReset()
  // No meal history: the rows come from the server alone.
  fitStore.set((s: { meals: unknown[] }) => ({ ...s, meals: [] }))
})

test("asks GET /nutrition/foods and lists the foods, grouped", async () => {
  mockRequest.mockResolvedValue({ data: [food], count: 1 })
  show()
  expect(screen.getAllByLabelText("Loading foods")).toHaveLength(3)
  expect(await screen.findByText("Skyr, vanilla")).toBeTruthy()
  expect(screen.getByLabelText("Open Skyr, vanilla, from Fern")).toBeTruthy()
  expect(screen.queryByLabelText("Loading foods")).toBeNull()
  expect(mockRequest).toHaveBeenCalledWith(
    "GET",
    "/nutrition/foods?limit=100",
    undefined,
    { timeoutMs: 8000 },
  )
})

test("an empty library is the dimmed preview, not the skeleton", async () => {
  mockRequest.mockResolvedValue({ data: [], count: 0 })
  show()
  expect(await screen.findByText("Your library fills as you log")).toBeTruthy()
  expect(screen.queryByLabelText("Loading foods")).toBeNull()
  expect(screen.queryByText("Couldn’t reach the food library")).toBeNull()
})

test("a failed load settles on the retry card, and Try again loads", async () => {
  mockRequest.mockRejectedValue(new Error("timeout"))
  show()
  expect(
    await screen.findByText("Couldn’t reach the food library"),
  ).toBeTruthy()
  // The query retried once before it gave up.
  expect(mockRequest).toHaveBeenCalledTimes(2)
  expect(screen.queryByLabelText("Loading foods")).toBeNull()

  mockRequest.mockResolvedValue({ data: [food], count: 1 })
  fireEvent.press(screen.getByText("Try again"))
  expect(await screen.findByText("Skyr, vanilla")).toBeTruthy()
  expect(screen.queryByText("Couldn’t reach the food library")).toBeNull()
})

test("a failed search shows the error, not the previous search's foods", async () => {
  mockRequest.mockResolvedValue({ data: [food], count: 1 })
  show()
  await screen.findByText("Skyr, vanilla")
  mockRequest.mockRejectedValue(new Error("timeout"))
  fireEvent.changeText(screen.getByLabelText("Search foods"), "adobo")
  expect(
    await screen.findByText(
      "Couldn’t reach the food library",
      {},
      { timeout: 10_000 },
    ),
  ).toBeTruthy()
  expect(screen.queryByText("Skyr, vanilla")).toBeNull()
})

const usda = {
  ...food,
  id: "u1",
  name: "Egg, whole, raw",
  source: "usda",
  origin: "database",
  verified: true,
  use_count: 0,
}

test("each row says its source; a filter asks the server for one", async () => {
  mockRequest.mockResolvedValue({
    data: [
      food,
      { ...food, id: "f2", name: "Ube jam", source: "import", origin: "you" },
      usda,
    ],
    count: 3,
  })
  show()
  expect(await screen.findByText("Skyr, vanilla")).toBeTruthy()
  expect(screen.getByLabelText("Open Skyr, vanilla, from Fern")).toBeTruthy()
  expect(screen.getByLabelText("Open Ube jam, from You")).toBeTruthy()
  expect(screen.getByLabelText("Open Egg, whole, raw, from USDA")).toBeTruthy()
  // The household's own foods sit apart from the database's.
  expect(screen.getByText("Recent and yours")).toBeTruthy()
  expect(screen.getByText("Database foods you ate")).toBeTruthy()

  mockRequest.mockResolvedValue({ data: [usda], count: 8000 })
  fireEvent.press(screen.getByLabelText("Show foods from USDA"))
  expect(await screen.findByText("1 of 8,000")).toBeTruthy()
  expect(mockRequest).toHaveBeenLastCalledWith(
    "GET",
    "/nutrition/foods?limit=100&origin=database",
    undefined,
    { timeoutMs: 8000 },
  )
  expect(screen.queryByText("Skyr, vanilla")).toBeNull()
})

test("a search reaches every source and shows what it matched", async () => {
  mockRequest.mockResolvedValue({ data: [food], count: 1 })
  show()
  await screen.findByText("Skyr, vanilla")
  mockRequest.mockResolvedValue({ data: [food, usda], count: 2 })
  fireEvent.changeText(screen.getByLabelText("Search foods"), "sky")
  // The matched part is its own, stronger piece of the name.
  expect(await screen.findByText("Sky")).toBeTruthy()
  // The server is asked after the typing pause.
  await waitFor(
    () =>
      expect(mockRequest).toHaveBeenLastCalledWith(
        "GET",
        "/nutrition/foods?limit=100&q=sky",
        undefined,
        { timeoutMs: 8000 },
      ),
    { timeout: 10_000 },
  )
  // The USDA egg misses "sky", so it is not listed even though the server
  // sent it.
  expect(screen.queryByLabelText("Open Egg, whole, raw, from USDA")).toBeNull()
  fireEvent.press(screen.getByLabelText("Clear search"))
  expect(screen.getByLabelText("Search foods").props.value).toBe("")
})

test("a search that finds nothing says so, with the ways on", async () => {
  mockRequest.mockResolvedValue({ data: [food], count: 1 })
  show()
  await screen.findByText("Skyr, vanilla")
  mockRequest.mockResolvedValue({ data: [], count: 0 })
  fireEvent.press(screen.getByLabelText("Show foods from Fern"))
  fireEvent.changeText(screen.getByLabelText("Search foods"), "zzz")
  expect(
    await screen.findByText(
      "No food matches “zzz” in Fern",
      {},
      { timeout: 10_000 },
    ),
  ).toBeTruthy()
  expect(screen.getByText("Search every source")).toBeTruthy()
  fireEvent.press(screen.getByText("Clear search"))
  expect(screen.getByLabelText("Search foods").props.value).toBe("")
})

test("a food the person logged by hand shows from their meals, marked You", async () => {
  mockRequest.mockResolvedValue({ data: [], count: 0 })
  fitStore.set((s: object) => ({
    ...s,
    meals: [
      {
        id: "m1",
        eatenAt: "2026-11-06T04:00:00.000Z",
        label: "lunch",
        source: "manual",
        rawInput: "",
        status: "confirmed",
        items: [
          {
            id: "i1",
            name: "Tinola",
            qty: 1,
            unit: "bowl",
            kcal: 300,
            protein: 25,
            carbs: 10,
            fat: 12,
          },
        ],
      },
    ],
  }))
  show()
  expect(
    await screen.findByLabelText("Open the day you ate Tinola, logged by You"),
  ).toBeTruthy()
})
