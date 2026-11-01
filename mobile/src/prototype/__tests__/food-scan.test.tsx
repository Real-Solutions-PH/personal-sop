// Scanning a food barcode: found → set grams → logged as a meal; not found
// or offline → say so with a way forward; no camera access → ask for it.
import { fitStore } from "@domain/fitness/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import type { Product } from "../food-barcode"
import { FoodScan } from "../screens/food-scan"

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
    Gesture: chain,
    GestureDetector: ({ children }: { children: ReactNode }) => children,
    ScrollView: require("react-native").ScrollView,
  }
})
jest.mock("react-native-gesture-handler/ReanimatedSwipeable", () => {
  const { View } = require("react-native")
  return ({ children }: { children: ReactNode }) => <View>{children}</View>
})
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
}))
jest.mock("expo-router", () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: () => true,
  },
  useLocalSearchParams: () => ({}),
  usePathname: () => "/",
}))
jest.mock("expo-audio", () => ({}))
jest.mock("../media", () => ({ exportCsv: jest.fn(), pickPhoto: jest.fn() }))

let mockGranted = true
// A stand-in camera: a button that "sees" a barcode.
jest.mock("expo-camera", () => {
  const { Pressable, Text } = require("react-native")
  return {
    useCameraPermissions: () => [
      { granted: mockGranted, canAskAgain: true },
      jest.fn(),
    ],
    CameraView: ({
      onBarcodeScanned,
    }: {
      onBarcodeScanned?: (r: { data: string }) => void
    }) => (
      <Pressable onPress={() => onBarcodeScanned?.({ data: "4800016644443" })}>
        <Text>fake scan</Text>
      </Pressable>
    ),
  }
})
let mockResult: Product | null | "error" = null
jest.mock("../food-barcode", () => ({
  ...jest.requireActual("../food-barcode"),
  lookupBarcode: async () => mockResult,
}))

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
)
const chips: Product = {
  code: "4800016644443",
  name: "Potato chips",
  brand: "Crunchy Co",
  servingG: 30,
  per100: { kcal: 536, protein: 6.6, carbs: 53, fat: 34 },
}

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  fitStore.set((s) => ({ ...s, meals: [] }))
  mockGranted = true
  mockResult = chips
})

const scan = async () => {
  render(<FoodScan />, { wrapper })
  await act(async () => fireEvent.press(screen.getByText("fake scan")))
}

test("found: one serving by default, logged as a meal", async () => {
  await scan()
  expect(screen.getByText("Potato chips")).toBeTruthy()
  expect(screen.getByLabelText("Grams eaten").props.value).toBe("30")
  expect(screen.getByText("161 kcal · P 2 g · C 16 g · F 10 g")).toBeTruthy()
  fireEvent.changeText(screen.getByLabelText("Grams eaten"), "60")
  fireEvent.press(screen.getByText("Log it"))
  const [meal] = fitStore.get().meals
  expect(meal?.items[0]).toMatchObject({
    name: "Potato chips (Crunchy Co)",
    qty: 60,
    unit: "g",
    kcal: 322,
  })
  expect(meal?.rawInput).toBe("Barcode 4800016644443")
})

test("not in the database: say so, offer adding by hand", async () => {
  mockResult = null
  await scan()
  expect(screen.getByText("Not in the food database yet")).toBeTruthy()
  expect(screen.getByText("Add by hand")).toBeTruthy()
})

test("offline: try again", async () => {
  mockResult = "error"
  await scan()
  expect(screen.getByText("Couldn't look it up")).toBeTruthy()
  expect(screen.getByText("Try again")).toBeTruthy()
})

test("a barcode seen twice before the screen updates is looked up once", async () => {
  const lookup = jest.spyOn(require("../food-barcode"), "lookupBarcode")
  render(<FoodScan />, { wrapper })
  const cam = screen.getByText("fake scan")
  await act(async () => {
    fireEvent.press(cam)
    fireEvent.press(cam)
  })
  expect(lookup).toHaveBeenCalledTimes(1)
})

test("no camera access yet: ask for it, no camera", () => {
  mockGranted = false
  render(<FoodScan />, { wrapper })
  expect(screen.getByText("Allow camera")).toBeTruthy()
  expect(screen.queryByText("fake scan")).toBeNull()
})

test("an empty or zero amount can't be logged", async () => {
  await scan()
  fireEvent.changeText(screen.getByLabelText("Grams eaten"), "0")
  fireEvent.press(screen.getByText("Log it"))
  expect(fitStore.get().meals).toHaveLength(0)
})
