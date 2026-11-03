// Logging a meal by hand from the food library, on Log meal's Eat again
// card: one tap adds a saved food at its usual amount, or pick it to say how
// much, and it joins the meal with the food's numbers scaled to that amount;
// the meal saves it like any other item and the food's use is counted. The
// card's loading, empty and error looks stay apart: a failed read (a 401 on
// an expired session, a timeout) is an error with Try again, never an empty
// library.

import { fitStore } from "@domain/fitness/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
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

const { ApiError, NetworkError } = require("@/live/http")
const { ManualMeal } = require("../screens/nutrition-meals")
const { libraryItem, unitsFor } = require("../screens/nutrition-food-pick")

const chicken = {
  id: "f-chicken",
  name: "Chicken breast, grilled",
  aliases: [],
  basis: "100g",
  unit_grams: null,
  state: "cooked",
  kcal: 165,
  protein: 31,
  carbs: 0,
  fat: 3.6,
  fiber: null,
  sat_fat: 1,
  sugar: null,
  sodium: 74,
  notes: null,
  source: "label",
  verified: true,
  use_count: 2,
  last_used_at: null,
  photo_media_id: null,
  photo_url: null,
  can_edit: false,
}
const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
}

function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: 0 } },
  })
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <QueryClientProvider client={client}>
        <ManualMeal />
      </QueryClientProvider>
    </SafeAreaProvider>,
  )
}

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  mockRequest.mockReset()
  mockRequest.mockImplementation(async (method: string, path: string) =>
    method === "GET" && path.startsWith("/nutrition/foods?")
      ? { data: [chicken], count: 1 }
      : undefined,
  )
})

test("150 g of a per-100 g food fills the item with 1.5× its numbers", async () => {
  show()
  fireEvent.press(await screen.findByLabelText("Pick Chicken breast, grilled"))
  // A per-100 g food starts at 100 g.
  expect(screen.getByLabelText("Amount").props.value).toBe("100")
  fireEvent.changeText(screen.getByLabelText("Amount"), "150")
  fireEvent.press(screen.getByText("Add to meal"))

  expect(
    screen.getByText("From your food library: Chicken breast, grilled"),
  ).toBeTruthy()
  expect(mockRequest).toHaveBeenCalledWith(
    "POST",
    "/nutrition/foods/f-chicken/use",
  )
  // Saving goes through the meal's own save, unchanged.
  fireEvent.press(screen.getByText("Save meal · 248 kcal"))
  const meal = fitStore
    .get()
    .meals.find((m) =>
      m.items.some((i) => i.name === "Chicken breast, grilled"),
    )
  if (!meal) throw new Error("the meal was not saved")
  expect(meal.items).toHaveLength(1)
  expect(meal.items[0]).toMatchObject({
    name: "Chicken breast, grilled",
    qty: 150,
    unit: "g",
    kcal: 247.5,
    protein: 46.5,
    carbs: 0,
    fat: 5.4,
    satFat: 1.5,
    sodium: 111,
    assumption: "From your food library: Chicken breast, grilled",
  })
  expect(meal.items[0]).not.toHaveProperty("fiber")
})

test("a per-piece food starts at one piece and can be logged in grams", () => {
  const egg = { ...chicken, basis: "piece", unit_grams: 50, kcal: 70 }
  expect(unitsFor(egg)).toEqual(["piece", "g"])
  expect(unitsFor(chicken)).toEqual(["g"])
  expect(unitsFor({ ...chicken, unit_grams: 120 })).toEqual(["g", "piece"])
  expect(libraryItem(egg, 2, "piece")?.kcal).toBe(140)
  expect(libraryItem(egg, 25, "g")?.kcal).toBe(35)
  expect(libraryItem(egg, 0, "piece")).toBeNull()
})

const egg = {
  ...chicken,
  id: "f-egg",
  name: "Egg, boiled",
  basis: "piece",
  unit_grams: 50,
  kcal: 70,
  protein: 6,
  use_count: 9,
}
const foodsCalls = () =>
  mockRequest.mock.calls.filter(
    ([m, path]) => m === "GET" && String(path).startsWith("/nutrition/foods?"),
  )

test("the card reads the first 100 foods with its own short timeout", async () => {
  show()
  await screen.findByLabelText("Pick Chicken breast, grilled")
  expect(mockRequest).toHaveBeenCalledWith(
    "GET",
    "/nutrition/foods?limit=100",
    undefined,
    { timeoutMs: 8000 },
  )
  // The separate "Pick from library" entry is gone: the card is the way in.
  expect(screen.queryByText("Pick from library")).toBeNull()
})

test("one tap adds a food at its usual amount and counts the use", async () => {
  mockRequest.mockImplementation(async (method: string, path: string) =>
    method === "GET" && path.startsWith("/nutrition/foods?")
      ? { data: [egg, chicken], count: 2 }
      : undefined,
  )
  show()
  // Most used first, as the server sends them.
  const picks = await screen.findAllByLabelText(/^Pick /)
  expect(picks.map((n) => n.props.accessibilityLabel)).toEqual([
    "Pick Egg, boiled",
    "Pick Chicken breast, grilled",
  ])
  fireEvent.press(screen.getByLabelText("Add 1 piece of Egg, boiled"))
  fireEvent.press(screen.getByLabelText("Add 1 piece of Egg, boiled"))
  fireEvent.press(screen.getByLabelText("Add 100 g of Chicken breast, grilled"))
  expect(mockRequest).toHaveBeenCalledWith("POST", "/nutrition/foods/f-egg/use")
  // The button says it landed; the footer carries the new total.
  expect(
    screen.getByLabelText("Add 1 piece of Egg, boiled").props.accessibilityHint,
  ).toBe("Added 2 so far")
  expect(screen.getByText("Save meal · 305 kcal")).toBeTruthy()
  fireEvent.press(screen.getByText("Save meal · 305 kcal"))
  const meal = fitStore
    .get()
    .meals.find((m) => m.items.some((i) => i.name === "Egg, boiled"))
  expect(meal?.items.map((i) => [i.name, i.qty, i.unit])).toEqual([
    ["Egg, boiled", 1, "piece"],
    ["Egg, boiled", 1, "piece"],
    ["Chicken breast, grilled", 100, "g"],
  ])
})

test("search narrows the foods after a pause, and says when nothing matches", async () => {
  mockRequest.mockImplementation(async (method: string, path: string) => {
    if (method !== "GET") return undefined
    if (path.includes("q=chick")) return { data: [chicken], count: 1 }
    if (path.includes("q=")) return { data: [], count: 0 }
    return { data: [egg, chicken], count: 2 }
  })
  show()
  await screen.findByLabelText("Pick Egg, boiled")
  const typed = async (text: string) => {
    fireEvent.changeText(screen.getByLabelText("Search your foods"), text)
    // The search waits 300 ms for typing to pause, then asks the server;
    // React Query hands the answer over on a later tick.
    await act(() => new Promise((done) => setTimeout(done, 350)))
    await act(() => new Promise((done) => setTimeout(done, 300)))
  }
  await typed("chick")
  expect(screen.queryByLabelText("Pick Egg, boiled")).toBeNull()
  expect(foodsCalls().at(-1)?.[1]).toBe("/nutrition/foods?limit=100&q=chick")
  expect(screen.getByLabelText("Pick Chicken breast, grilled")).toBeTruthy()
  await typed("zzz")
  expect(screen.getByText("No saved food matches “zzz”.")).toBeTruthy()
})

test("while loading it shows skeleton rows, neither empty nor an error", async () => {
  mockRequest.mockImplementation(() => new Promise(() => {}))
  show()
  expect(screen.getAllByLabelText("Loading foods")).toHaveLength(3)
  expect(screen.queryByTestId("foods-empty")).toBeNull()
  expect(screen.queryByText("Couldn’t load your foods")).toBeNull()
})

test("an empty library is its real rows dimmed, with the step that fills it", async () => {
  mockRequest.mockResolvedValue({ data: [], count: 0 })
  show()
  expect(await screen.findByTestId("foods-empty")).toBeTruthy()
  expect(screen.getByText(/No saved foods yet/)).toBeTruthy()
  // Sample rows sit dimmed behind it, hidden from screen readers.
  expect(screen.queryByLabelText(/^Pick /)).toBeNull()
  expect(
    screen.getAllByLabelText(/^Pick /, { includeHiddenElements: true }).length,
  ).toBeGreaterThan(0)
  expect(screen.queryByLabelText("Loading foods")).toBeNull()
})

test("a failed read shows Try again, and Try again loads the foods", async () => {
  let fail = true
  mockRequest.mockImplementation(async (method: string, path: string) => {
    if (method !== "GET" || !path.startsWith("/nutrition/foods?")) return
    if (fail) throw new ApiError(500, "internal", "Server error")
    return { data: [chicken], count: 1 }
  })
  show()
  expect(await screen.findByText("Couldn’t load your foods")).toBeTruthy()
  fail = false
  await act(async () => {
    fireEvent.press(screen.getByText("Try again"))
  })
  expect(
    await screen.findByLabelText("Pick Chicken breast, grilled"),
  ).toBeTruthy()
  expect(screen.queryByText("Couldn’t load your foods")).toBeNull()
})

test("a 401 (an expired session) is an error with Try again, never an empty library", async () => {
  mockRequest.mockRejectedValue(
    new ApiError(401, "unauthorized", "Not signed in"),
  )
  show()
  expect(await screen.findByText("Couldn’t load your foods")).toBeTruthy()
  expect(screen.getByText("Try again")).toBeTruthy()
  expect(screen.queryByTestId("foods-empty")).toBeNull()
  expect(screen.queryByText(/No saved foods yet/)).toBeNull()
  expect(screen.queryByLabelText("Loading foods")).toBeNull()
})

test("a timeout settles as the error, not a skeleton left running", async () => {
  mockRequest.mockRejectedValue(new NetworkError("timeout"))
  show()
  expect(await screen.findByText("Couldn’t load your foods")).toBeTruthy()
  expect(screen.queryByLabelText("Loading foods")).toBeNull()
  // One retry, then it stops asking.
  expect(foodsCalls()).toHaveLength(2)
})
