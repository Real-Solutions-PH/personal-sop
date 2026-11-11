// The budgets on the Today finance card: every live budget's spent against
// its limit on one bar with today's pace marked, coloured by how it stands,
// each opening its budget; none at all draws the rows dimmed with the step.

import * as A from "@domain/finance/actions"
import { finStore } from "@domain/finance/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { fireEvent, render, screen } from "@testing-library/react-native"
import { router } from "expo-router"
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
jest.mock("expo-audio", () => ({}))
jest.mock("../media", () => ({ exportCsv: jest.fn(), pickPhoto: jest.fn() }))

const { TodayBudgets, budgetTone } =
  require("../screens/finance-today-budgets") as typeof import("../screens/finance-today-budgets")

const metrics = {
  frame: { x: 0, y: 0, width: 375, height: 812 },
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
  jest.clearAllMocks()
  // Start from no budgets; each test adds its own.
  for (const b of finStore.get().budgets) A.deleteBudget(b.id)
})

test("how a budget stands: fine, close to its limit or ahead of pace, over", () => {
  expect(budgetTone({ pct: 0.3, pace: 0.5 })).toBe("good")
  expect(budgetTone({ pct: 0.85, pace: 0.9 })).toBe("warn")
  expect(budgetTone({ pct: 0.6, pace: 0.4 })).toBe("warn")
  expect(budgetTone({ pct: 0.41, pace: 0.37 })).toBe("warn")
  expect(budgetTone({ pct: 1.02, pace: 0.5 })).toBe("bad")
})

test("each budget is a row that opens it, overall first", () => {
  const food = A.addBudget({
    name: "Food and groceries for the whole household",
    categoryIds: [finStore.get().categories[0].id],
    limit: 1234567,
    rollover: false,
  })
  const all = A.addBudget({
    name: "Monthly",
    categoryIds: null,
    limit: 50000,
    rollover: false,
  })
  render(<TodayBudgets />, { wrapper })
  const rows = screen.getAllByLabelText(/ budget: /)
  expect(
    rows.map((r) => r.props.accessibilityLabel.split(" budget:")[0]),
  ).toEqual([all.name, food.name])
  // Seven-digit limits keep their separators; the long name is not cut.
  expect(screen.getByText(food.name)).toBeTruthy()
  expect(rows[1].props.accessibilityLabel).toMatch(/of ₱1,234,567/)
  fireEvent.press(rows[1])
  expect(router.push).toHaveBeenCalledWith(`/finance/budgets/${food.id}`)
})

test("with no budget the rows are drawn dimmed with the one step to set one", () => {
  render(<TodayBudgets />, { wrapper })
  expect(screen.queryAllByLabelText(/ budget: /)).toHaveLength(0)
  expect(screen.getByTestId("today-budgets-empty")).toBeTruthy()
  expect(screen.getByText("Set budget")).toBeTruthy()
})
