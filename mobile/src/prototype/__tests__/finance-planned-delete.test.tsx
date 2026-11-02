// Deleting a scheduled payment: one Delete (no "End it" or "Archive")
// that removes it everywhere through sync, with Undo, paid history kept; and
// items ended before Delete existed stay off the list.

import * as A from "@domain/finance/actions"
import * as C from "@domain/finance/calc"
import type { PlannedItem } from "@domain/finance/data"
import { finStore } from "@domain/finance/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
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

const { Planned } =
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

function plan(extra: Partial<PlannedItem> = {}): PlannedItem {
  const s = finStore.get()
  return A.addPlanned({
    name: "Netflix",
    type: "expense",
    amount: 549,
    estimated: false,
    accountId: s.accounts[0].id,
    categoryId: s.categories.find((c) => c.kind === "expense")?.id,
    schedule: { kind: "monthly", day: 15 },
    end: { kind: "never" },
    autoLog: false,
    isWhatIf: false,
    inProjection: true,
    ...extra,
  })
}
const ids = () => finStore.get().planned.map((p) => p.id)

test("Delete removes a scheduled payment, with Undo, even once it was paid", () => {
  const p = plan()
  A.settleOccurrence(
    p.id,
    C.occurrences(p, "2000-01-01", C.today())[0] ?? C.today(),
    {
      amount: 549,
    },
  )
  const before = ids()
  render(<Planned id={p.id} />, { wrapper })
  expect(screen.queryByText("End it")).toBeNull()
  expect(screen.queryByText("Archive")).toBeNull()
  fireEvent.press(screen.getByText("Delete"))
  expect(ids()).not.toContain(p.id)
  // Its paid history stays, still linked.
  expect(finStore.get().records.some((r) => r.plannedId === p.id)).toBe(true)
  expect(toastMock).toHaveBeenCalledWith(
    "Deleted Netflix",
    expect.objectContaining({
      action: expect.objectContaining({ label: "Undo" }),
    }),
  )
  const undo = toastMock.mock.calls[0][1].action.onClick as () => void
  act(() => undo())
  expect(ids()).toEqual(before)
})

test("items that already ended are off the scheduled list", () => {
  const yesterday = C.addDays(C.today(), -1)
  plan({ name: "Old gym", end: { kind: "date", date: yesterday } })
  plan({ name: "Ended today", end: { kind: "date", date: C.today() } })
  plan({ name: "Spotify" })
  render(<Planned />, { wrapper })
  expect(screen.queryByText("Old gym")).toBeNull()
  expect(screen.queryByText("Ended today")).toBeNull()
  expect(screen.getAllByText("Spotify").length).toBeGreaterThan(0)
})
