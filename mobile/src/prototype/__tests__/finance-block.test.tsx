// Fern's money card (the ``finance`` block, sent with a reply about money):
// what was spent today, the month's budget with what is left, and the next
// seven days' bills. Figures below are written by hand from the records the
// test makes (₱250 + ₱100 spent today, a ₱15,000 budget, a ₱1,200 bill due
// tomorrow), never computed with the card's own calc.
import type { Budget, FinRecord, PlannedItem } from "@domain/finance/data"
import { finStore } from "@domain/finance/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { syncReady } from "@/live/ready"

const mockGo = jest.fn()
jest.mock("../navigation", () => ({
  ...jest.requireActual("../navigation"),
  go: (href: string) => mockGo(href),
}))
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
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
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
}))
jest.mock("expo-audio", () => ({}))

const { BlockView } =
  require("../companion/blocks") as typeof import("../companion/blocks")

/** 10:00 local on Fri 6 Nov 2026. */
const NOW = new Date(2026, 10, 6, 10, 0)
const TODAY = "2026-11-06"

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "setImmediate"] })
  syncReady.setState({ ready: true, failed: false })
  mockGo.mockClear()
})
afterEach(() => jest.useRealTimers())

const spend = (id: string, amount: number, at: Date): FinRecord => ({
  id,
  type: "expense",
  amount,
  accountId: "wallet",
  at: at.toISOString(),
  source: "manual",
  status: "cleared",
})
const budget: Budget = {
  id: "b1",
  name: "Monthly",
  categoryIds: null,
  period: "monthly",
  limit: 15000,
  rollover: false,
  startDate: "2020-01-01",
  archived: false,
}
const bill: PlannedItem = {
  id: "meralco",
  name: "Meralco electricity bill for the condo unit",
  type: "expense",
  amount: 1200,
  estimated: false,
  accountId: "wallet",
  schedule: { kind: "once", date: "2026-11-07" },
  start: "2026-11-07",
  end: { kind: "never" },
  autoLog: false,
  isWhatIf: false,
  inProjection: true,
  archived: false,
  skipped: [],
  snoozed: {},
}

function seed(extra: { budgets?: Budget[]; planned?: PlannedItem[] }) {
  const s = finStore.get()
  finStore.set({
    ...s,
    accounts: [{ ...s.accounts[0], id: "wallet", name: "GCash" }],
    records: [
      spend("r1", 250, new Date(2026, 10, 6, 8, 0)),
      spend("r2", 100, new Date(2026, 10, 6, 9, 30)),
      // Yesterday's spend is not today's.
      spend("r3", 999, new Date(2026, 10, 5, 12, 0)),
    ],
    budgets: extra.budgets ?? [],
    planned: extra.planned ?? [],
  })
}

const draw = () =>
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <BlockView block={{ t: "finance", day: TODAY }} />
    </SafeAreaProvider>,
  )
const text = () =>
  screen
    .getByTestId("finance-block")
    .findAll(() => true)
    .map((n) => n.props.children)
    .filter((c) => typeof c === "string")
    .join(" | ")

test("today's spend, the budget left and tomorrow's bill", () => {
  seed({ budgets: [budget], planned: [bill] })
  draw()
  const all = text()
  expect(all).toContain("MONEY · TODAY")
  expect(all).toContain("Spent today")
  expect(all).toMatch(/₱350(\.00)?\b/)
  expect(all).toContain("Safe to spend / day")
  // The name wraps whole, and the bill counts down.
  expect(all).toContain("Meralco electricity bill for the condo unit")
  expect(screen.getByText("Due tomorrow")).toBeTruthy()
  expect(screen.queryByTestId("finance-block-no-budget")).toBeNull()
  fireEvent.press(screen.getByLabelText("Open finance"))
  expect(mockGo).toHaveBeenCalledWith("/finance")
})

test("no budget yet: the bar is drawn dimmed with the step that fills it", () => {
  seed({})
  draw()
  expect(screen.getByTestId("finance-block-no-budget")).toBeTruthy()
  expect(screen.getByText("Set budget")).toBeTruthy()
  expect(screen.queryByText("Safe to spend / day")).toBeNull()
  expect(screen.getByText("Nothing due in the next 7 days")).toBeTruthy()
})

test("loading and a failed first sync are not drawn as an empty month", () => {
  syncReady.setState({ ready: false, failed: false })
  seed({ budgets: [budget] })
  draw()
  expect(screen.getByText("Loading your money…")).toBeTruthy()
  act(() => syncReady.setState({ ready: true, failed: true }))
  expect(screen.getByText(/Couldn't load your money/)).toBeTruthy()
  expect(screen.queryByTestId("finance-block")).toBeNull()
})
