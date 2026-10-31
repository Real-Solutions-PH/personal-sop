// One food's page in live mode: it loads with GET /nutrition/foods/{id},
// a food someone else added reads only, and its author's Save sends a
// PATCH with just the fields that changed, reporting the outcome either way.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react-native"
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
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
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

beforeEach(() => {
  mockRequest.mockReset()
  jest.mocked(toast.success).mockReset()
  jest.mocked(toast.error).mockReset()
})

test("loads the food and shows its numbers with separators", async () => {
  mockRequest.mockResolvedValue(food)
  show()
  expect(screen.getByLabelText("Loading food")).toBeTruthy()
  expect(await screen.findByDisplayValue("Skyr, vanilla")).toBeTruthy()
  expect(screen.getByDisplayValue("1,200")).toBeTruthy()
  expect(screen.getByDisplayValue("1,500")).toBeTruthy()
  expect(screen.queryByLabelText("Loading food")).toBeNull()
  expect(mockRequest).toHaveBeenCalledWith(
    "GET",
    "/nutrition/foods/f1",
    undefined,
    { timeoutMs: 8000 },
  )
})

test("a food another member added reads only, and says why", async () => {
  mockRequest.mockResolvedValue({ ...food, can_edit: false })
  show()
  expect(
    await screen.findByText("Added by another member — only they can edit it."),
  ).toBeTruthy()
  expect(screen.getByText("1,200 kcal")).toBeTruthy()
  expect(screen.getByText("1,500 mg")).toBeTruthy()
  expect(screen.queryByText("Save changes")).toBeNull()
  expect(screen.queryByDisplayValue("Skyr, vanilla")).toBeNull()
  expect(screen.queryByLabelText("Add food photo")).toBeNull()
})

test("Save sends only the changed fields and reports it", async () => {
  mockRequest.mockResolvedValue(food)
  show()
  await screen.findByDisplayValue("Skyr, vanilla")
  mockRequest.mockResolvedValue({ ...food, protein: 18, fiber: 2 })
  fireEvent.changeText(screen.getByLabelText("Protein (g)"), "18")
  fireEvent.changeText(screen.getByLabelText("Fiber (g) — optional"), "2")
  fireEvent.press(screen.getByText("Save changes"))
  expect(await screen.findByText("Saved")).toBeTruthy()
  expect(mockRequest).toHaveBeenCalledWith("PATCH", "/nutrition/foods/f1", {
    protein: 18,
    fiber: 2,
  })
  expect(toast.success).toHaveBeenCalledWith("Saved Skyr, vanilla")
})

test("nothing changed: Save stays off", async () => {
  mockRequest.mockResolvedValue(food)
  show()
  await screen.findByDisplayValue("Skyr, vanilla")
  fireEvent.press(screen.getByText("Save changes"))
  expect(mockRequest).toHaveBeenCalledTimes(1)
})

test("a refused save says why", async () => {
  mockRequest.mockResolvedValue(food)
  show()
  await screen.findByDisplayValue("Skyr, vanilla")
  mockRequest.mockRejectedValue(
    new ApiError(409, "food_name_taken", "Name taken"),
  )
  fireEvent.changeText(screen.getByLabelText("Name"), "Greek yogurt")
  fireEvent.press(screen.getByText("Save changes"))
  const why = "Another food already has that name. Pick a different one."
  expect(await screen.findByText(why)).toBeTruthy()
  expect(mockRequest).toHaveBeenLastCalledWith("PATCH", "/nutrition/foods/f1", {
    name: "Greek yogurt",
  })
  expect(toast.error).toHaveBeenCalledWith(why)
})

test("a missing food is not found, not a retry card", async () => {
  mockRequest.mockRejectedValue(new ApiError(404, "not_found", "Missing"))
  show()
  expect(await screen.findByText("Food not found")).toBeTruthy()
  expect(mockRequest).toHaveBeenCalledTimes(1)
})

test("a picked photo uploads, then PATCHes the food with its media id", async () => {
  const { pickPhoto } = require("../media")
  jest.mocked(pickPhoto).mockResolvedValue("data:image/jpeg;base64,AAAA")
  const put = jest.fn(async () => ({ ok: true, status: 200 }))
  const realFetch = global.fetch
  global.fetch = put as unknown as typeof fetch
  mockRequest.mockImplementation(async (method: string, path: string) => {
    if (path === "/media/uploads")
      return { id: "m1", upload_url: "https://store/put", headers: {} }
    if (path === "/media/m1/complete")
      return { id: "m1", kind: "image", mime: "image/jpeg", state: "ready" }
    if (method === "PATCH")
      return { ...food, photo_media_id: "m1", photo_url: "https://cdn/m1" }
    return food
  })
  try {
    show()
    fireEvent.press(await screen.findByLabelText("Add food photo"))
    expect(await screen.findByLabelText("Change food photo")).toBeTruthy()
    expect(put).toHaveBeenCalledWith(
      "https://store/put",
      expect.objectContaining({ method: "PUT" }),
    )
    expect(mockRequest).toHaveBeenCalledWith("PATCH", "/nutrition/foods/f1", {
      photo_media_id: "m1",
    })
    expect(toast.success).toHaveBeenCalledWith("Photo updated")
  } finally {
    global.fetch = realFetch
  }
})
