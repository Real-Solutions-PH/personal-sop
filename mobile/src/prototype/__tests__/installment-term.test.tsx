// Planning a purchase on 0% installments: besides the 3/6/12/24 chips, any
// number of months can be typed, kept between 2 and 60.
import { configureStorage, resetAll } from "@domain/lib/store"
import { fireEvent, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({ whatif: "1", amount: "36000" }),
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
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
}))
jest.mock("expo-audio", () => ({}))
jest.mock("../media", () => ({ exportCsv: jest.fn(), pickPhoto: jest.fn() }))

const { Projection, clampTerm } =
  require("../screens/finance-projection") as typeof import("../screens/finance-projection")

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
})

it("keeps a typed term between 2 and 60 months", () => {
  expect(clampTerm(1)).toBe(2)
  expect(clampTerm(36)).toBe(36)
  expect(clampTerm(99)).toBe(60)
})

it("plans a typed number of months", () => {
  render(<Projection />, { wrapper })
  fireEvent.press(screen.getByText("0% installments"))
  fireEvent.press(screen.getByText("Custom"))
  fireEvent.changeText(screen.getByLabelText("Months to pay"), "36")
  // 36,000 over 36 months.
  expect(screen.getByText(/1,000\/mo on/)).toBeTruthy()
})

it("plans 60 months when more are typed, and says so", () => {
  render(<Projection />, { wrapper })
  fireEvent.press(screen.getByText("0% installments"))
  fireEvent.press(screen.getByText("Custom"))
  fireEvent.changeText(screen.getByLabelText("Months to pay"), "72")
  expect(screen.getByText(/600\/mo on/)).toBeTruthy()
  expect(screen.getByText(/up to 60 months/)).toBeTruthy()
})
