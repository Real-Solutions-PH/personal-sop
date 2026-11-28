// One food's page in live mode, read first: it loads with GET
// /nutrition/foods/{id}; the amount stepper and unit chips recalculate
// every figure; the macros sit against today's targets; facts the food does
// not carry are left out; highlights come from its numbers; Log this logs
// it at the chosen amount; the person's history with it links each meal; a
// built-in food offers Copy to mine, an own food Edit.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { toast } from "sonner-native"

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
  usePathname: () => "/nutrition/foods/f1",
  useFocusEffect: () => {},
}))
jest.mock("expo-image", () => {
  const { View } = require("react-native")
  return { Image: (props: object) => <View {...props} /> }
})
jest.mock("../media", () => ({ pickPhoto: jest.fn() }))
jest.mock("@/live/config", () => ({
  liveMode: true,
  API_URL: "http://api.test",
  API_PREFIX: "/api/v1",
}))
const mockRequest = jest.fn()
jest.mock("@/live/auth", () => ({ http: { request: mockRequest } }))

const { FoodDetail } = require("../screens/nutrition-food-detail")
const { fitStore } = require("@domain/fitness/store")
const { ApiError } = require("@/live/http")

const food = {
  id: "f1",
  name: "Skyr, vanilla",
  aliases: ["skyr"],
  basis: "serving",
  unit_grams: 150,
  state: "as_sold",
  kcal: 1200,
  protein: 15,
  carbs: 10,
  fat: 0,
  fiber: null,
  sat_fat: null,
  sugar: 8,
  sodium: 1500,
  notes: null,
  source: "label",
  verified: true,
  use_count: 3,
  last_used_at: null,
  photo_media_id: null,
  photo_url: null,
  can_edit: true,
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
        <FoodDetail id="f1" />
      </QueryClientProvider>
    </SafeAreaProvider>,
  )
}

const target = {
  id: "t1",
  effectiveFrom: "2000-01-01",
  kcal: 2000,
  protein: 150,
  carbs: 200,
  fat: 65,
}

beforeEach(() => {
  mockRequest.mockReset()
  jest.mocked(toast.success).mockReset()
  jest.mocked(toast.error).mockReset()
  fitStore.set((s: object) => ({
    ...s,
    targets: [target],
    adjustments: [],
    meals: [],
  }))
})

test("loads, then reads first: header, amount, calories and facts", async () => {
  mockRequest.mockResolvedValue(food)
  show()
  expect(screen.getByLabelText("Loading food")).toBeTruthy()
  expect(await screen.findByText("Skyr, vanilla")).toBeTruthy()
  expect(screen.queryByLabelText("Loading food")).toBeNull()
  expect(mockRequest).toHaveBeenCalledWith(
    "GET",
    "/nutrition/foods/f1",
    undefined,
    { timeoutMs: 8000 },
  )
  expect(screen.getByText("Also called skyr")).toBeTruthy()
  expect(screen.getByText("1,200")).toBeTruthy()
  // 15 g protein × 4 = 60 and 10 g carbs × 4 = 40 of 100 macro kcal
  expect(screen.getByText("60%")).toBeTruthy()
  expect(screen.getByText("40%")).toBeTruthy()
  expect(screen.getByText("1,500 mg")).toBeTruthy()
  // 1,500 of the default 2,000 mg sodium limit
  expect(screen.getByText("75% of limit")).toBeTruthy()
  // No edit form on the read page.
  expect(screen.queryByDisplayValue("Skyr, vanilla")).toBeNull()
  expect(screen.queryByText("Save changes")).toBeNull()
})

test("the stepper and unit chips recalculate every figure", async () => {
  mockRequest.mockResolvedValue(food)
  show()
  expect(await screen.findByText("Log 1 serving")).toBeTruthy()
  fireEvent.press(screen.getByLabelText("Increase Amount"))
  // 1.5 servings × 1,200 = 1,800 kcal; × 1,500 mg = 2,250 mg
  expect(screen.getByText("Log 1.5 servings")).toBeTruthy()
  expect(screen.getByText("1,800")).toBeTruthy()
  expect(screen.getByText("2,250 mg")).toBeTruthy()
  expect(
    screen.getByText("1.5 servings = 225 g · values per serving"),
  ).toBeTruthy()
  fireEvent.press(screen.getByLabelText("In grams"))
  // 100 g of a 150 g serving: 800 kcal
  expect(screen.getByText("Log 100 g")).toBeTruthy()
  expect(screen.getByText("800")).toBeTruthy()
})

test("the macros sit against today's targets, with what is left", async () => {
  mockRequest.mockResolvedValue(food)
  show()
  await screen.findByText("Skyr, vanilla")
  // 1,200 of 2,000 kcal = 60%; 800 left. 15 of 150 g protein = 10%.
  expect(screen.getByText("60% of 2,000")).toBeTruthy()
  expect(screen.getByText("800 kcal left after this")).toBeTruthy()
  expect(screen.getByText("10% of 150")).toBeTruthy()
  expect(screen.queryByText("Set your daily targets")).toBeNull()
})

test("no targets: the bars dim behind a way to set them", async () => {
  fitStore.set((s: object) => ({ ...s, targets: [] }))
  mockRequest.mockResolvedValue(food)
  show()
  expect(await screen.findByText("Set your daily targets")).toBeTruthy()
})

test("a food with only kcal and three macros shows no 0 for the unknowns", async () => {
  mockRequest.mockResolvedValue({ ...food, sugar: null, sodium: null })
  show()
  expect(
    await screen.findByText(
      "Only calories and macros are known for this food.",
    ),
  ).toBeTruthy()
  expect(screen.queryByText("Sodium")).toBeNull()
  expect(screen.queryByText("0 mg")).toBeNull()
  expect(screen.queryByText("High sodium")).toBeNull()
})

test("its numbers earn a highlight, with the figure behind it", async () => {
  mockRequest.mockResolvedValue(food)
  show()
  // 1,500 mg in a 150 g serving = 1,000 mg per 100 g, over 600
  expect(await screen.findByText("High sodium")).toBeTruthy()
  expect(screen.getByText("  1,000 mg per 100 g")).toBeTruthy()
})

test("Log this logs the chosen amount, counts the use, and can be undone", async () => {
  mockRequest.mockResolvedValue(food)
  show()
  fireEvent.press(await screen.findByText("Log 1 serving"))
  const meals = fitStore.get().meals
  expect(meals).toHaveLength(1)
  expect(meals[0].items[0]).toMatchObject({
    name: "Skyr, vanilla",
    qty: 1,
    unit: "serving",
    kcal: 1200,
  })
  expect(
    screen.getByText(`Logged to ${meals[0].label} · 1,200 kcal`),
  ).toBeTruthy()
  expect(mockRequest).toHaveBeenCalledWith("POST", "/nutrition/foods/f1/use")
  // The history counts it at once.
  expect(screen.getByText("time logged")).toBeTruthy()
  fireEvent.press(screen.getByText("Undo"))
  expect(fitStore.get().meals).toHaveLength(0)
})

test("history counts the meals it was in and opens each", async () => {
  const { router } = require("expo-router")
  const eatenAt = new Date(Date.now() - 3 * 86400000).toISOString()
  fitStore.set((s: object) => ({
    ...s,
    meals: [
      {
        id: "m1",
        eatenAt,
        label: "breakfast",
        source: "manual",
        rawInput: "",
        status: "confirmed",
        items: [
          {
            id: "i1",
            name: "Skyr (150 g)",
            qty: 2,
            unit: "serving",
            kcal: 2400,
            protein: 30,
            carbs: 20,
            fat: 0,
          },
        ],
      },
    ],
  }))
  mockRequest.mockResolvedValue(food)
  show()
  expect(await screen.findByText("time logged")).toBeTruthy()
  expect(screen.queryByText("Not logged yet")).toBeNull()
  fireEvent.press(
    screen.getByLabelText(/breakfast, 2 servings, 2,400 kcal. Open meal/),
  )
  expect(router.push).toHaveBeenCalledWith("/nutrition/meals/m1")
})

test("never eaten: history dims behind Log this", async () => {
  mockRequest.mockResolvedValue(food)
  show()
  expect(await screen.findByText("Not logged yet")).toBeTruthy()
})

test("a built-in food reads only: marked, Copy to mine, no Edit", async () => {
  mockRequest.mockResolvedValue({ ...food, can_edit: false, is_global: true })
  show()
  expect(await screen.findByText("Built-in")).toBeTruthy()
  expect(screen.getByText("Copy to mine")).toBeTruthy()
  expect(screen.queryByText("Edit")).toBeNull()
})

test("an own food offers Edit, which opens the edit page", async () => {
  const { router } = require("expo-router")
  mockRequest.mockResolvedValue(food)
  show()
  expect(await screen.findByText("Yours")).toBeTruthy()
  expect(screen.queryByText("Built-in")).toBeNull()
  expect(screen.queryByText("Copy to mine")).toBeNull()
  fireEvent.press(screen.getByText("Edit"))
  expect(router.push).toHaveBeenCalledWith("/nutrition/foods/edit/f1")
})

test("Copy to mine copies it and opens the own copy", async () => {
  const { router } = require("expo-router")
  mockRequest.mockImplementation(async (method: string) =>
    method === "POST"
      ? { ...food, id: "f2", can_edit: true, is_global: false }
      : { ...food, can_edit: false, is_global: true },
  )
  show()
  fireEvent.press(await screen.findByText("Copy to mine"))
  await waitFor(() =>
    expect(router.replace).toHaveBeenCalledWith("/nutrition/foods/f2"),
  )
  expect(mockRequest).toHaveBeenCalledWith("POST", "/nutrition/foods/f1/copy")
  expect(toast.error).not.toHaveBeenCalled()
})

test("a failed copy says so", async () => {
  mockRequest.mockImplementation(async (method: string) => {
    if (method === "POST") throw new ApiError(500, "boom", "Boom")
    return { ...food, can_edit: false, is_global: true }
  })
  show()
  fireEvent.press(await screen.findByText("Copy to mine"))
  const why = "Couldn't copy this food. Please try again."
  expect(await screen.findByText(why)).toBeTruthy()
  expect(toast.error).toHaveBeenCalledWith(why)
})

test("an Open Food Facts product credits it and links its page", async () => {
  const { Linking } = require("react-native")
  const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true)
  const url = "https://world.openfoodfacts.org/product/4800016644290"
  mockRequest.mockResolvedValue({
    ...food,
    source: "off",
    verified: false,
    source_url: url,
    can_edit: false,
    is_global: true,
  })
  show()
  const credit = "From Open Food Facts, under the Open Database License (ODbL)"
  expect(await screen.findByText(credit)).toBeTruthy()
  fireEvent.press(screen.getByLabelText(`${credit}. Opens openfoodfacts.org`))
  expect(open).toHaveBeenCalledWith(url)
})

test("a USDA food says its values are lab-analysed, not from a label", async () => {
  mockRequest.mockResolvedValue({ ...food, source: "usda", can_edit: false })
  show()
  expect(await screen.findByText("Lab-analysed values")).toBeTruthy()
  expect(
    screen.getByText("From USDA FoodData Central (public domain)"),
  ).toBeTruthy()
})

test("a missing food is not found, not a retry card", async () => {
  mockRequest.mockRejectedValue(new ApiError(404, "not_found", "Missing"))
  show()
  expect(await screen.findByText("Food not found")).toBeTruthy()
  expect(mockRequest).toHaveBeenCalledTimes(1)
})

test("a failed load offers a retry, apart from loading and not found", async () => {
  mockRequest.mockRejectedValue(new ApiError(500, "boom", "Boom"))
  show()
  expect(
    await screen.findByText("Couldn’t load this food", {}, { timeout: 8000 }),
  ).toBeTruthy()
  expect(screen.getByText("Try again")).toBeTruthy()
}, 15_000)
