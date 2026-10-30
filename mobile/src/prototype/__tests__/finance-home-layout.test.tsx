// The Finance home reads top to bottom as one story: net worth, actions,
// budgets left, this month's cash flow with what is still scheduled, the
// savings projection, shortcuts, the statistics, then recent records. Every
// forecast has a date picker that changes the figures it shows.
import { finStore } from "@domain/finance/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { fireEvent, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"

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
  useAnimatedProps: (get: () => unknown) => get(),
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
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
}))
jest.mock("expo-audio", () => ({}))
jest.mock("../media", () => ({ exportCsv: jest.fn(), pickPhoto: jest.fn() }))

const { FinanceHome } =
  require("../screens/finance-home") as typeof import("../screens/finance-home")

const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider
    initialMetrics={{
      frame: { x: 0, y: 0, width: 390, height: 844 },
      insets: { top: 44, left: 0, right: 0, bottom: 34 },
    }}
  >
    {children}
  </SafeAreaProvider>
)

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
})

/** Every rendered string, in render order. */
function texts(node: ReturnType<typeof screen.toJSON>): string[] {
  if (!node) return []
  if (Array.isArray(node)) return node.flatMap(texts)
  if (typeof node === "string") return [node]
  return (node.children ?? []).flatMap((c) =>
    texts(c as ReturnType<typeof screen.toJSON>),
  )
}

test("sections come in the agreed order, with one cash flow section", () => {
  render(<FinanceHome />, { wrapper })
  const all = texts(screen.toJSON()).join("\n")
  const order = [
    "Net worth",
    "Available",
    "Owed on cards",
    "What if?",
    "BUDGETS REMAINING",
    "CASH FLOW",
    "SAVINGS PROJECTION",
    "Transactions",
    "Savings rate",
    "Spend by category",
    "Cash flow vs expected",
    "Budget history",
    "Top payees",
    "Day-of-week spend",
    "RECENT",
  ]
  const at = order.map((x) => all.indexOf(x))
  expect(at.every((i) => i >= 0)).toBe(true)
  expect(at).toEqual([...at].sort((a, b) => a - b))
  // the old separate "Rest of <month>" section is gone
  expect(all).not.toMatch(/REST OF/)
})

test("spend by category shows the top category's icon in the middle", () => {
  render(<FinanceHome />, { wrapper })
  expect(screen.queryByText("top")).toBeNull()
  expect(screen.getByLabelText(/^Top: /)).toBeTruthy()
})

test("picking a forecast range changes the date the figures are for", () => {
  render(<FinanceHome />, { wrapper })
  expect(screen.getAllByText(/^On hand by /)).toHaveLength(1)
  const before = String(screen.getByText(/^On hand by /).props.children)
  fireEvent.press(screen.getAllByRole("radio", { name: "1 yr" })[0])
  const after = String(screen.getByText(/^On hand by /).props.children)
  expect(after).not.toBe(before)
  expect(finStore.get().settings).toBeTruthy()
})

test("picking a date shows a date field for the forecast", () => {
  render(<FinanceHome />, { wrapper })
  fireEvent.press(screen.getAllByRole("radio", { name: "Pick date" })[0])
  expect(screen.getByLabelText("Up to")).toBeTruthy()
})
