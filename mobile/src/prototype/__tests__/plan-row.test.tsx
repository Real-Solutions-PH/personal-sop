// Me → Plan: the row says which plan the server reports (Free, or Plus with
// its renewal or end date) and opens the Unfurl Plus screen.

import { configureStorage, resetAll } from "@domain/lib/store"
import { fireEvent, render, screen } from "@testing-library/react-native"
import { router } from "expo-router"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { planStore } from "../plan"
import { Me } from "../screens/me"

jest.mock("expo-router", () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: () => false,
  },
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
  withSequence: (...values: unknown[]) => values[values.length - 1],
  interpolate: (_: number, __: number[], output: number[]) => output[0],
  interpolateColor: (_: number, __: number[], output: string[]) => output[0],
  runOnJS: (fn: unknown) => fn,
  useReducedMotion: () => true,
}))
jest.mock("react-native-gesture-handler", () => {
  const chain: object = new Proxy({}, { get: () => () => chain })
  return {
    Gesture: new Proxy({}, { get: () => () => chain }),
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
jest.mock("../media", () => ({ exportCsv: jest.fn(), pickPhoto: jest.fn() }))
const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 44, left: 0, right: 0, bottom: 34 },
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
)

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  ;(router.push as jest.Mock).mockClear()
})

test("a free account sees Free and the row opens the plan screen", () => {
  render(<Me />, { wrapper })
  expect(screen.getByText("Free · See Unfurl Plus")).toBeTruthy()
  fireEvent.press(screen.getByText("Plan"))
  expect(router.push).toHaveBeenCalledWith("/me/plan")
})

test("a Plus account sees Plus with its renewal date", () => {
  planStore.set({
    plan: "plus",
    plusUntil: "2099-11-09T12:00:00Z",
    willRenew: true,
    productId: "plus_yearly",
  })
  render(<Me />, { wrapper })
  expect(screen.getByText("Unfurl Plus · renews Nov 9, 2099")).toBeTruthy()
})

test("a Plus period that has ended shows Free", () => {
  planStore.set({
    plan: "plus",
    plusUntil: "2020-01-01T00:00:00Z",
    willRenew: false,
    productId: "plus_yearly",
  })
  render(<Me />, { wrapper })
  expect(screen.getByText("Free · See Unfurl Plus")).toBeTruthy()
})
