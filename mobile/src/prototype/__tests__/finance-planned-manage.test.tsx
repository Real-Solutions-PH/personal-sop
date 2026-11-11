// A scheduled payment's detail: History never shows a date before the plan
// starts, and every upcoming date can be changed on its own (amount, date),
// skipped and restored, without touching the plan's own rule.

import * as A from "@domain/finance/actions"
import type { PlannedItem } from "@domain/finance/data"
import { finStore } from "@domain/finance/store"
import * as C from "@domain/finance/calc"
import { dayKey } from "@domain/lib/day"
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, fireEvent, render, screen, within } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { toast } from "sonner-native"

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

const { RecordEditor } =
  require("../screens/finance") as typeof import("../screens/finance")
const { DueSheet, Planned } =
  require("../screens/finance-planned") as typeof import("../screens/finance-planned")

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 44, left: 0, right: 0, bottom: 34 },
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
)
const toastMock = toast as unknown as jest.Mock & {
  success: jest.Mock
  error: jest.Mock
}
beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  jest.clearAllMocks()
})

const today = dayKey()
function plan(extra: Partial<PlannedItem> = {}): PlannedItem {
  const s = finStore.get()
  return A.addPlanned({
    name: "BYD EM7",
    type: "expense",
    amount: 26667,
    estimated: false,
    accountId: s.accounts[0].id,
    categoryId: s.categories.find((c) => c.kind === "expense")?.id,
    schedule: { kind: "monthly", day: 8 },
    end: { kind: "count", n: 60 },
    autoLog: false,
    isWhatIf: false,
    isInstallment: true,
    inProjection: true,
    ...extra,
  })
}
const firstDates = (p: PlannedItem, n: number) =>
  C.occurrences(p, p.start, C.addDays(p.start, 400)).slice(0, n)

test("a plan that has not started shows no history dated before its start", () => {
  const p = plan({ start: C.addDays(today, 60) })
  render(<Planned id={p.id} />, { wrapper })
  const empty = within(screen.getByTestId("planned-history-empty"))
  // The dimmed sample never invents dates the plan cannot have had.
  // (Dimmed rows are hidden from screen readers, so look past that.)
  const hidden = { includeHiddenElements: true }
  for (const n of [1, 2, 3])
    expect(
      empty.queryByText(C.shortDate(C.addDays(today, -30 * n)), hidden),
    ).toBeNull()
  for (const d of firstDates(p, 3))
    expect(empty.getByText(C.shortDate(d), hidden)).toBeTruthy()
  const first = firstDates(p, 1)[0]
  expect(empty.getByText(new RegExp(`Starts ${C.dayLabel(first)}`))).toBeTruthy()
  // Nothing is recorded as paid for it.
  expect(screen.queryByText("Times paid")).toBeNull()
})
