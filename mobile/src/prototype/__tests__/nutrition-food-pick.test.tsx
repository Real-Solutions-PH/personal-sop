// Logging a meal by hand from the food library: pick a saved food, say how
// much, and it joins the meal with the food's numbers scaled to that amount;
// the meal saves it like any other item and the food's use is counted.

import { fitStore } from "@domain/fitness/store"
import { configureStorage, resetAll } from "@domain/lib/store"
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
jest.mock("react-native-gesture-handler", () => {
  const chain: object = new Proxy({}, { get: () => () => chain })
  return {
    Gesture: new Proxy({}, { get: () => () => chain }),
    GestureDetector: ({ children }: { children: unknown }) => children,
    ScrollView: require("react-native").ScrollView,
  }
})
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
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
  fireEvent.press(screen.getByText("Pick from library"))
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
  const [meal] = fitStore.get().meals
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

test("an empty search says so instead of loading forever", async () => {
  mockRequest.mockResolvedValue({ data: [], count: 0 })
  show()
  fireEvent.press(screen.getByText("Pick from library"))
  expect(await screen.findByText(/No saved foods yet/)).toBeTruthy()
  expect(screen.queryByLabelText("Loading foods")).toBeNull()
})
