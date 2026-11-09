// The projection chart reads out a point: touch (here, the chart's
// adjustable action, as VoiceOver steps it) shows the date, the money
// expected with and without the planned purchase, their difference and a
// warning under the minimum; a touch elsewhere on the screen clears it.
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
jest.mock("react-native-gesture-handler", () => {
  const chain: object = new Proxy({}, { get: () => () => chain })
  return {
    Gesture: new Proxy({}, { get: () => () => chain }),
    GestureDetector: ({ children }: { children: ReactNode }) => children,
  }
})
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
}))
jest.mock("expo-audio", () => ({}))
jest.mock("../media", () => ({ exportCsv: jest.fn(), pickPhoto: jest.fn() }))

const { Projection } =
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

const chart = () => screen.getByLabelText("Chart")
const act = (name: "increment" | "decrement", times = 1) => {
  // The readout is placed by the chart's measured width.
  fireEvent(chart(), "layout", {
    nativeEvent: { layout: { x: 0, y: 0, width: 358, height: 190 } },
  })
  for (let k = 0; k < times; k++)
    fireEvent(chart(), "accessibilityAction", {
      nativeEvent: { actionName: name },
    })
}

it("reads a point off the chart: the date, both lines and their difference", () => {
  render(<Projection />, { wrapper })
  expect(screen.queryByText("baseline")).toBeNull()
  const diffs = () => screen.queryAllByText("−₱36,000").length
  const before = diffs()
  act("increment")
  expect(screen.getByText("Now")).toBeTruthy()
  // On to the last month: the planned ₱36,000 purchase is in by then.
  act("increment", 40)
  expect(screen.getByText(/^By [A-Z][a-z]+ \d{4}$/)).toBeTruthy()
  // The readout, and the legend's entry for the purchase line.
  expect(screen.getAllByText("With New laptop")).toHaveLength(2)
  expect(screen.getByText("baseline")).toBeTruthy()
  // ₱36,000 less than without it (whole pesos print without cents); the
  // purchase's own row says it too, so the readout adds one more.
  expect(diffs()).toBe(before + 1)
})

it("keeps the point after letting go, and a touch elsewhere puts it away", () => {
  render(<Projection />, { wrapper })
  act("increment", 3)
  // A touch on the chart itself stays on the chart.
  fireEvent(chart(), "touchStart", { stopPropagation: () => {} })
  expect(screen.getByText("baseline")).toBeTruthy()
  fireEvent(screen.getByText("Include average everyday spending"), "touchStart")
  expect(screen.queryByText("baseline")).toBeNull()
})
