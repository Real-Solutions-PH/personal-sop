// Estimated monthly net: recurring income minus recurring bills, each turned
// into a monthly amount; one-offs, what-ifs, archived and ended items are
// left out, and an empty schedule shows a dimmed sample with a way to start.
import { addDays, recurringMonth } from "@domain/finance/calc"
import type { FinState, PlannedItem } from "@domain/finance/data"
import { finStore } from "@domain/finance/store"
import { dayKey } from "@domain/lib/day"
import { configureStorage, resetAll } from "@domain/lib/store"
import { render, screen } from "@testing-library/react-native"

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

const { MonthlyNet } =
  require("../screens/finance-monthly-net") as typeof import("../screens/finance-monthly-net")

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
})

const today = dayKey()
const item = (
  id: string,
  type: PlannedItem["type"],
  amount: number,
  schedule: PlannedItem["schedule"],
  extra: Partial<PlannedItem> = {},
): PlannedItem => ({
  id,
  name: id,
  type,
  amount,
  estimated: false,
  accountId: "wallet",
  schedule,
  start: addDays(today, -60),
  end: { kind: "never" },
  autoLog: false,
  isWhatIf: false,
  inProjection: true,
  archived: false,
  skipped: [],
  snoozed: {},
  ...extra,
})
const state = (planned: PlannedItem[]): FinState => ({
  ...finStore.get(),
  planned,
})

test("recurring income minus recurring bills, per month", () => {
  const m = recurringMonth(
    state([
      // 15th and 30th: 2 × 25,000
      item("salary", "income", 25000, { kind: "semimonthly", days: [15, 30] }),
      item("rent", "expense", 12000, { kind: "monthly", day: 5 }),
      // every 2 weeks: 1,200 × 52 / 12 / 2 = 2,600
      item("groceries", "expense", 1200, {
        kind: "weekly",
        every: 2,
        anchor: today,
      }),
      item(
        "phone",
        "transfer",
        3000,
        { kind: "monthly", day: 3 },
        {
          isInstallment: true,
        },
      ),
      // A move to savings is not money spent.
      item("to savings", "transfer", 5000, { kind: "monthly", day: 16 }),
    ]),
    today,
  )
  expect([m.income, m.out, m.net]).toEqual([50000, 17600, 32400])
  expect(m.outItems.map((p) => p.id)).toEqual(["rent", "groceries", "phone"])
})

test("one-offs, what-ifs, archived and ended items are left out", () => {
  const monthly = { kind: "monthly", day: 10 } as const
  const m = recurringMonth(
    state([
      item("bonus", "income", 30000, { kind: "once", date: addDays(today, 5) }),
      item("dream car", "expense", 20000, monthly, { isWhatIf: true }),
      item("old gym", "expense", 1500, monthly, { archived: true }),
      item("ended", "expense", 900, monthly, {
        end: { kind: "date", date: addDays(today, -1) },
      }),
      item("paid off", "expense", 2000, monthly, {
        end: { kind: "count", n: 1 },
      }),
      item("netflix", "expense", 549, monthly),
    ]),
    today,
  )
  expect([m.income, m.out, m.net]).toEqual([0, 549, -549])
})

test("the card shows the net, and a dimmed sample when nothing repeats", () => {
  const { unmount } = render(
    <MonthlyNet
      s={state([
        item("salary", "income", 40000, { kind: "monthly", day: 15 }),
        item("rent", "expense", 15000, { kind: "monthly", day: 5 }),
      ])}
    />,
  )
  expect(screen.getByText("+₱25,000")).toBeTruthy()
  expect(screen.getByText("Recurring income · 1 item")).toBeTruthy()
  unmount()
  render(<MonthlyNet s={state([])} />)
  expect(screen.getByText("See your monthly net")).toBeTruthy()
})
