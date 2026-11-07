// The Cash flow page's monthly bars: in and out per budget month, the
// current month split into what happened and what is still scheduled.
import * as N from "@domain/finance/calc"
import type { FinRecord, FinState, PlannedItem } from "@domain/finance/data"
import { finStore } from "@domain/finance/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import {
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"

const mockParams: Record<string, string> = {}
jest.mock("expo-router", () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: () => false,
  },
  useLocalSearchParams: () => mockParams,
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
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
}))
jest.mock("expo-audio", () => ({}))
// The native date picker as a text box: typing a day picks it.
jest.mock("@react-native-community/datetimepicker", () => {
  const { TextInput } = require("react-native")
  return {
    __esModule: true,
    default: ({
      onChange,
    }: {
      onChange: (e: { type: string }, d: Date) => void
    }) => (
      <TextInput
        accessibilityLabel="Date picker"
        onChangeText={(v: string) =>
          onChange({ type: "set" }, new Date(`${v}T12:00:00`))
        }
      />
    ),
  }
})
jest.mock("../media", () => ({ exportCsv: jest.fn(), pickPhoto: jest.fn() }))

const { monthlyFlow, MonthlyFlowBars } =
  require("../screens/finance-monthly-flow") as typeof import("../screens/finance-monthly-flow")

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

// Stepping a year ahead re-renders the chart a dozen times.
jest.setTimeout(30000)

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
})

const rec = (
  id: string,
  type: "income" | "expense" | "transfer",
  amount: number,
  day: string,
  extra: Partial<FinRecord> = {},
): FinRecord => ({
  id,
  type,
  amount,
  accountId: "a1",
  at: `${day}T12:00:00`,
  source: "manual",
  status: "cleared",
  ...extra,
})
/** A state with only these records, months starting on the 1st and
 * nothing scheduled. */
const only = (records: FinRecord[]): FinState => {
  const s = finStore.get()
  return {
    ...s,
    records,
    planned: [],
    settings: { ...s.settings, monthStartDay: 1 },
  }
}

describe("monthlyFlow", () => {
  const records = [
    rec("i1", "income", 50_000, "2026-11-01"),
    rec("o1", "expense", 1_234.5, "2026-11-02"),
    rec("i2", "income", 48_000, "2026-10-15"),
    rec("o2", "expense", 30_000, "2026-10-31"),
    rec("o3", "expense", 9_999, "2026-06-30"),
    // Before the window, a transfer and an adjustment: none of them count.
    rec("o4", "expense", 777, "2026-05-31"),
    rec("t1", "transfer", 5_000, "2026-11-02", { toAccountId: "a2" }),
    rec("x1", "expense", 1_000, "2026-11-02", { isAdjustment: true }),
  ]
  const m = monthlyFlow(only(records), 6, "2026-11-04")

  it("returns the last six budget months, oldest first, ending this month", () => {
    expect(m.map((x) => x.key)).toEqual([
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
      "2026-11",
    ])
    expect(m.map((x) => x.current)).toEqual([
      false,
      false,
      false,
      false,
      false,
      true,
    ])
  })

  it("adds up each month's money in and out, by the day it happened", () => {
    expect(m.map((x) => [x.income, x.spend])).toEqual([
      [0, 9_999],
      [0, 0],
      [0, 0],
      [0, 0],
      [48_000, 30_000],
      [50_000, 1_234.5],
    ])
  })

  it("puts what is still scheduled on the current month only", () => {
    const s = finStore.get()
    const withPlans = { ...s, settings: { ...s.settings, monthStartDay: 1 } }
    const flow = monthlyFlow(withPlans)
    const [, to] = N.monthRange(N.monthOf(N.today(), 1), 1)
    const ahead = N.scheduledFlow(withPlans, to)
    expect(ahead.income + ahead.spend).toBeGreaterThan(0)
    expect(flow[5]).toMatchObject({
      aheadIn: ahead.income,
      aheadOut: ahead.spend,
    })
    for (const x of flow.slice(0, 5)) expect(x.aheadIn + x.aheadOut).toBe(0)
  })

  it("follows a budget month that starts on the 25th", () => {
    const s = only([rec("i", "income", 100, "2026-10-26")])
    const flow = monthlyFlow(
      { ...s, settings: { ...s.settings, monthStartDay: 25 } },
      2,
      "2026-11-04",
    )
    // 26 Oct falls in the budget month that runs 25 Oct – 24 Nov.
    expect(flow[flow.length - 1].income).toBe(100)
  })
})

const plan = (
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
  accountId: "a1",
  schedule,
  start: "2026-01-01",
  end: { kind: "never" },
  autoLog: false,
  isWhatIf: false,
  inProjection: true,
  archived: false,
  skipped: [],
  snoozed: {},
  ...extra,
})

describe("monthlyFlow into future months", () => {
  const s = (): FinState => ({
    ...only([rec("i1", "income", 1_000, "2026-11-01")]),
    planned: [
      plan("salary", "income", 50_000, { kind: "monthly", day: 15, every: 1 }),
      plan("rent", "expense", 12_000, { kind: "monthly", day: 5, every: 1 }),
      plan("gift", "expense", 3_000, { kind: "once", date: "2026-12-20" }),
      // A transfer moves money between accounts: neither in nor out.
      plan(
        "save",
        "transfer",
        5_000,
        { kind: "monthly", day: 16, every: 1 },
        { toAccountId: "a2" },
      ),
      // Skipped in January; a what-if never counts.
      plan(
        "gym",
        "expense",
        2_000,
        { kind: "monthly", day: 1, every: 1 },
        { skipped: ["2027-01-01"] },
      ),
      plan(
        "car",
        "expense",
        9_999,
        { kind: "monthly", day: 2, every: 1 },
        { isWhatIf: true },
      ),
    ],
  })

  it("shifts the six-month window to end a chosen number of months ahead", () => {
    const m = monthlyFlow(s(), 6, "2026-11-04", 2)
    expect(m.map((x) => x.key)).toEqual([
      "2026-08",
      "2026-09",
      "2026-10",
      "2026-11",
      "2026-12",
      "2027-01",
    ])
    expect(m.map((x) => x.future)).toEqual([
      false,
      false,
      false,
      false,
      true,
      true,
    ])
    expect(m.map((x) => x.current)).toEqual([
      false,
      false,
      false,
      true,
      false,
      false,
    ])
  })

  it("gives each future month what is scheduled in it, and nothing as happened", () => {
    const m = monthlyFlow(s(), 6, "2026-11-04", 2)
    // December: salary in; rent, the gift and the gym out.
    expect(m[4]).toMatchObject({
      income: 0,
      spend: 0,
      aheadIn: 50_000,
      aheadOut: 12_000 + 3_000 + 2_000,
    })
    // January: the gym is skipped.
    expect(m[5]).toMatchObject({
      income: 0,
      spend: 0,
      aheadIn: 50_000,
      aheadOut: 12_000,
    })
  })

  it("follows the month start day into the future", () => {
    const base = s()
    const m = monthlyFlow(
      { ...base, settings: { ...base.settings, monthStartDay: 10 } },
      2,
      "2026-11-04",
      1,
    )
    // 4 Nov is in the month that runs 10 Oct – 9 Nov; the next one runs
    // 10 Nov – 9 Dec: salary 15 Nov, gym 1 Dec, rent 5 Dec.
    expect(m.map((x) => x.key)).toEqual(["2026-10", "2026-11"])
    expect(m[1]).toMatchObject({ aheadIn: 50_000, aheadOut: 14_000 })
  })
})

describe("MonthlyFlowBars", () => {
  const months = () => monthlyFlow(finStore.get())

  it("opens on this month and shows a tapped month's numbers", () => {
    render(<MonthlyFlowBars s={finStore.get()} />, { wrapper })
    const detail = () => within(screen.getByTestId("monthly-flow-detail"))
    const m = months()
    const now = m[m.length - 1]
    expect(
      detail().getByText(new RegExp(`^${N.monthLabel(now.key, true)}`)),
    ).toBeTruthy()
    const past = m[m.length - 2]
    const bar = screen.getByRole("button", {
      name: new RegExp(`^${N.monthLabel(past.key, true)}: in `),
    })
    fireEvent.press(bar)
    expect(bar.props.accessibilityState).toEqual({ selected: true })
    expect(detail().getByText(N.monthLabel(past.key, true))).toBeTruthy()
    const all = (n: ReturnType<typeof screen.toJSON>): string[] =>
      !n
        ? []
        : Array.isArray(n)
          ? n.flatMap(all)
          : typeof n === "string"
            ? [n]
            : (n.children ?? []).flatMap((c) => all(c as never))
    const text = all(screen.getByTestId("monthly-flow-detail") as never).join(
      "",
    )
    // Amounts in pesos with thousands separators.
    expect(text).toMatch(/₱\d{1,3}(,\d{3})*(\.\d{2})?/)
    expect(text).not.toMatch(/scheduled/)
  })

  it("steps into future months and shows what each one expects", () => {
    render(<MonthlyFlowBars s={finStore.get()} />, { wrapper })
    const detail = () => within(screen.getByTestId("monthly-flow-detail"))
    const now = N.monthOf(N.today(), finStore.get().settings.monthStartDay)
    expect(screen.queryByLabelText("Earlier month")).toBeTruthy()
    for (let i = 1; i <= 2; i++) {
      fireEvent.press(screen.getByLabelText("Later month"))
      const key = N.addMonths(now, i)
      expect(
        detail().getByText(`${N.monthLabel(key, true)} · scheduled`),
      ).toBeTruthy()
      expect(detail().getByText("Expected net")).toBeTruthy()
      // The window follows: the picked future month has its own bar.
      const bar = screen.getByRole("button", {
        name: new RegExp(`^${N.monthLabel(key, true)}: in `),
      })
      expect(bar.props.accessibilityState).toEqual({ selected: true })
    }
    expect(screen.getAllByRole("button", { name: /: in ₱/ })).toHaveLength(6)
    // And back to this month.
    fireEvent.press(screen.getByLabelText("Earlier month"))
    fireEvent.press(screen.getByLabelText("Earlier month"))
    expect(
      detail().getByText(new RegExp(`^${N.monthLabel(now, true)}`)),
    ).toBeTruthy()
  })

  it("leaves the bars where they are when a month is tapped", () => {
    render(<MonthlyFlowBars s={finStore.get()} />, { wrapper })
    const now = N.monthOf(N.today(), finStore.get().settings.monthStartDay)
    fireEvent.press(screen.getByLabelText("Later month"))
    fireEvent.press(screen.getByLabelText("Later month"))
    const names = () =>
      screen
        .getAllByRole("button", { name: /: in ₱/ })
        .map((b) => b.props.accessibilityLabel.split(":")[0])
    const before = names()
    const next = N.monthLabel(N.addMonths(now, 1), true)
    fireEvent.press(
      screen.getByRole("button", { name: new RegExp(`^${next}: in `) }),
    )
    expect(names()).toEqual(before)
    expect(before[before.length - 1]).toBe(
      N.monthLabel(N.addMonths(now, 2), true),
    )
    expect(
      within(screen.getByTestId("monthly-flow-detail")).getByText(
        `${next} · scheduled`,
      ),
    ).toBeTruthy()
  })

  it("goes no further than a year ahead", () => {
    render(<MonthlyFlowBars s={finStore.get()} />, { wrapper })
    for (let i = 0; i < 12; i++)
      fireEvent.press(screen.getByLabelText("Later month"))
    expect(screen.queryByLabelText("Later month")).toBeNull()
  })

  it("draws a bar pair for each of the six months", () => {
    render(<MonthlyFlowBars s={finStore.get()} />, { wrapper })
    expect(screen.getAllByRole("button", { name: /: in ₱/ })).toHaveLength(6)
  })
})
