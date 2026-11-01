// The food library in live mode: loading, empty and error are three
// different screens, a failure settles on a retry card rather than a
// skeleton, and Try again loads the foods.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react-native"
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
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
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

const { FoodLibrary } = require("../screens/nutrition-foods")

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

beforeEach(() => mockRequest.mockReset())

test("asks GET /nutrition/foods and lists the foods, grouped", async () => {
  mockRequest.mockResolvedValue({ data: [food], count: 1 })
  show()
  expect(screen.getAllByLabelText("Loading foods")).toHaveLength(3)
  expect(await screen.findByText("Skyr, vanilla")).toBeTruthy()
  expect(screen.getByText(/Na 1,500 mg/)).toBeTruthy()
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
  expect(await screen.findByText("No saved foods yet")).toBeTruthy()
  expect(screen.queryByLabelText("Loading foods")).toBeNull()
  expect(screen.queryByText("Couldn’t load your foods")).toBeNull()
})

test("a failed load settles on the retry card, and Try again loads", async () => {
  mockRequest.mockRejectedValue(new Error("timeout"))
  show()
  expect(await screen.findByText("Couldn’t load your foods")).toBeTruthy()
  // The query retried once before it gave up.
  expect(mockRequest).toHaveBeenCalledTimes(2)
  expect(screen.queryByLabelText("Loading foods")).toBeNull()

  mockRequest.mockResolvedValue({ data: [food], count: 1 })
  fireEvent.press(screen.getByText("Try again"))
  expect(await screen.findByText("Skyr, vanilla")).toBeTruthy()
  expect(screen.queryByText("Couldn’t load your foods")).toBeNull()
})

test("a failed search shows the error, not the previous search's foods", async () => {
  mockRequest.mockResolvedValue({ data: [food], count: 1 })
  show()
  await screen.findByText("Skyr, vanilla")
  mockRequest.mockRejectedValue(new Error("timeout"))
  fireEvent.changeText(screen.getByPlaceholderText(/Search foods/), "adobo")
  expect(
    await screen.findByText("Couldn’t load your foods", {}, { timeout: 3000 }),
  ).toBeTruthy()
  expect(screen.queryByText("Skyr, vanilla")).toBeNull()
})
