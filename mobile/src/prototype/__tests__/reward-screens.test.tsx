// The money moments on screen: the record editor warns before and after a
// save that breaks a budget (with a warning haptic, never a toast of its
// own), and the budget list cheers last month's kept budgets once.
import { palette } from "@domain/design/tokens"
import type { Budget, FinRecord } from "@domain/finance/data"
import { finStore } from "@domain/finance/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { anchor, OverlayHost, resetOverlay } from "../overlay"

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
  runOnJS: (fn: unknown) => fn,
  useReducedMotion: () => false,
  isSharedValue: () => false,
}))
jest.mock("react-native-gesture-handler", () => {
  const chain: object = new Proxy({}, { get: () => () => chain })
  return {
    Gesture: new Proxy({}, { get: () => () => chain }),
    GestureDetector: ({ children }: { children: ReactNode }) => children,
    ScrollView: require("react-native").ScrollView,
  }
})
jest.mock("expo-haptics", () => ({
  notificationAsync: jest.fn(async () => {}),
  impactAsync: jest.fn(async () => {}),
  selectionAsync: jest.fn(async () => {}),
  NotificationFeedbackType: { Success: "success", Warning: "warning" },
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
}))
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
}))
jest.mock("expo-audio", () => ({}))
jest.mock("@react-native-community/datetimepicker", () => () => null)

const { RecordEditor } =
  require("../screens/finance-record-editor") as typeof import("../screens/finance-record-editor")
const { Budgets } =
  require("../screens/finance-budgets") as typeof import("../screens/finance-budgets")
const Haptics = require("expo-haptics")
const { toast } = require("sonner-native")

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 44, left: 0, right: 0, bottom: 34 },
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>
    {children}
    <OverlayHost />
  </SafeAreaProvider>
)
const hidden = { includeHiddenElements: true }

const budget = (id: string, limit: number, cats: string[]): Budget => ({
  id,
  name: id,
  categoryIds: cats,
  period: "monthly",
  limit,
  rollover: false,
  startDate: "2020-01-01",
  archived: false,
})
const spend = (id: string, amount: number, cat: string, day: string) =>
  ({
    id,
    type: "expense",
    amount,
    accountId: finStore.get().accounts[0].id,
    categoryId: cat,
    at: new Date(`${day}T12:00:00`).toISOString(),
    source: "manual",
    status: "cleared",
  }) as FinRecord

beforeEach(() => {
  jest.useFakeTimers()
  jest.setSystemTime(new Date(2026, 10, 10, 12))
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  resetOverlay()
  anchor.measure = (_, done) => done({ x: 0, y: 0, width: 100, height: 100 })
  Haptics.notificationAsync.mockClear()
  ;(toast as jest.Mock).mockClear()
  finStore.set((s) => ({
    ...s,
    settings: { ...s.settings, monthStartDay: 1 },
    records: [],
    budgets: [],
  }))
})
afterEach(() => jest.useRealTimers())

it("warns beside the amount before a save breaks a budget", () => {
  finStore.set((s) => ({
    ...s,
    budgets: [budget("Food", 5000, ["food"])],
    records: [spend("a", 4600, "food", "2026-11-05")],
  }))
  render(
    <RecordEditor
      open
      prefill={{ type: "expense", amount: 820, categoryId: "food" }}
      onClose={() => {}}
    />,
    { wrapper },
  )
  expect(
    screen.getByText("Saving this puts Food budget over by ₱420", {
      exact: false,
    }),
  ).toBeTruthy()
})

it("after Save & add another: the warning stays, a warning haptic, Undo toast", () => {
  finStore.set((s) => ({
    ...s,
    budgets: [budget("Food", 5000, ["food"])],
    records: [spend("a", 4600, "food", "2026-11-05")],
  }))
  render(
    <RecordEditor
      open
      prefill={{ type: "expense", amount: 820, categoryId: "food" }}
      onClose={() => {}}
    />,
    { wrapper },
  )
  fireEvent.press(screen.getByText("Save & add another"))
  expect(Haptics.notificationAsync).toHaveBeenCalledWith("warning")
  expect(
    screen.getByText("Food budget now over by ₱420", { exact: false }),
  ).toBeTruthy()
  const [msg, opts] = (toast as jest.Mock).mock.calls[0]
  expect(msg).toContain("Food budget now over by ₱420")
  expect(opts.action.label).toBe("Undo")
})

it("cheers last month's kept budgets once, and names the one that went over", () => {
  finStore.set((s) => ({
    ...s,
    budgets: [
      budget("Groceries", 5000, ["food"]),
      budget("Taxi", 100, ["transport"]),
    ],
    records: [
      spend("a", 1000, "food", "2026-10-05"),
      spend("b", 300, "transport", "2026-10-06"),
    ],
  }))
  const first = render(<Budgets />, { wrapper })
  expect(screen.getByTestId("budget-kept", hidden)).toBeTruthy()
  expect(screen.getByText("1 of 2 budgets kept in October 2026")).toBeTruthy()
  expect(screen.getByText("Taxi over by ₱200")).toBeTruthy()
  act(() => jest.advanceTimersByTime(5000))
  expect(screen.queryByTestId("budget-kept", hidden)).toBeNull()
  first.unmount()
  render(<Budgets />, { wrapper })
  expect(screen.queryByTestId("budget-kept", hidden)).toBeNull()
})

it("a budget reads spent / left, and an overage in the bad colour", () => {
  finStore.set((s) => ({
    ...s,
    budgets: [
      budget("Food", 12000, ["food"]),
      budget("Taxi", 1000, ["transport"]),
    ],
    records: [
      spend("a", 1234.5, "food", "2026-11-05"),
      spend("b", 1500, "transport", "2026-11-06"),
    ],
  }))
  render(<Budgets />, { wrapper })
  const [taxi, food] = screen.getAllByTestId("budget-spent-left")
  expect(food).toHaveTextContent("₱1,234.50 / ₱10,765.50")
  expect(taxi).toHaveTextContent("₱1,500 / −₱500")
  // The overage alone carries the bad colour; the spent figure does not.
  expect(screen.getByText("−₱500")).toHaveStyle({ color: palette.light.bad })
  expect(screen.getByText("over budget")).toBeTruthy()
})
