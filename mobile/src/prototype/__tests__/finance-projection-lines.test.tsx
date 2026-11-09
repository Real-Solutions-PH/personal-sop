// Kai's projection and cash-flow feedback: a second line with no projected
// expenses over the baseline, every projected item listed by month, and
// the balance each month ends on in Cash flow.
import { addDays, monthOf, monthRange, project } from "@domain/finance/calc"
import type { FinRecord, FinState, PlannedItem } from "@domain/finance/data"
import { balancesAtEnd, forecast } from "@domain/finance/forecast"
import { finStore } from "@domain/finance/store"
import { dayKey } from "@domain/lib/day"
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
const { MonthlyFlowBars, monthlyFlow } =
  require("../screens/finance-monthly-flow") as typeof import("../screens/finance-monthly-flow")
const { router } = require("expo-router") as {
  router: { push: jest.Mock }
}

jest.setTimeout(30000)

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
  router.push.mockClear()
})

const today = dayKey()
const cur = monthOf(today, 1)
const [, curEnd] = monthRange(cur, 1)
/** The 20th of the month ``i`` months after the current one. */
const day20 = (i: number) => {
  const [y, m] = cur.split("-").map(Number)
  const d = new Date(y, m - 1 + i, 20)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-20`
}
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
  start: addDays(today, -400),
  end: { kind: "never" },
  autoLog: false,
  isWhatIf: false,
  inProjection: true,
  archived: false,
  skipped: [],
  snoozed: {},
  ...extra,
})
const rec = (
  id: string,
  type: FinRecord["type"],
  amount: number,
  day: string,
  extra: Partial<FinRecord> = {},
): FinRecord => ({
  id,
  type,
  amount,
  accountId: "wallet",
  at: `${day}T12:00:00`,
  source: "manual",
  status: "cleared",
  ...extra,
})

function state(
  planned: PlannedItem[],
  records: FinRecord[] = [],
  includeUnplanned = false,
): FinState {
  const s = finStore.get()
  const base = s.accounts[0]
  const acct = (id: string, opening: number, inProjection = true) => ({
    ...base,
    id,
    opening,
    openingDate: addDays(today, -400),
    inProjection,
    inNetWorth: true,
    archived: false,
    type: "bank" as const,
  })
  return {
    ...s,
    records,
    settings: {
      ...s.settings,
      monthStartDay: 1,
      includeUnplanned,
      projExcludedPlanned: [],
      safetyFloor: 0,
      horizon: 6,
    },
    accounts: [acct("wallet", 40000), acct("invest", 5000, false)],
    planned,
  }
}

// Salary on the 20th; rent on the 20th; a one-off laptop next month and a
// transfer out to the uncounted account every month.
const plans = () => [
  item("salary", "income", 30000, { kind: "monthly", day: 20, every: 1 }),
  item("rent", "expense", 12000, { kind: "monthly", day: 20, every: 1 }),
  item(
    "laptop",
    "expense",
    45000,
    { kind: "once", date: day20(1) },
    {
      name: "A new laptop for work with a very long name that must wrap",
    },
  ),
  item(
    "invest",
    "transfer",
    2000,
    { kind: "monthly", day: 20, every: 1 },
    { toAccountId: "invest" },
  ),
]

describe("project: the line with no projected expenses", () => {
  it("counts income only, and the gap is every planned peso out", () => {
    const p = project(state(plans()), { horizon: 6, includeUnplanned: false })
    let out = 0
    for (const m of p.months) {
      out += m.planned
      // Every peso the baseline loses to planned spending, and nothing else.
      expect(m.endNoPlanned - m.endBase).toBeCloseTo(out)
    }
    // Next month carries the laptop: the gap jumps by 45,000 + rent + the
    // transfer out.
    expect(p.months[1].planned).toBe(45000 + 12000 + 2000)
    expect(p.months.at(-1)?.endNoPlanned).toBe(
      40000 + p.months.reduce((a, m) => a + m.inflow, 0),
    )
  })

  it("still takes off everyday spending when that is included", () => {
    const mk = cur
    const spend = [1, 2, 3].map((i) => {
      const [y, m] = mk.split("-").map(Number)
      const d = new Date(y, m - 1 - i, 10)
      return rec(
        `r${i}`,
        "expense",
        9000,
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-10`,
      )
    })
    const s = state(plans(), spend, true)
    const p = project(s, { horizon: 6, includeUnplanned: true })
    const start = p.start
    const last = p.months.at(-1)
    expect(last?.endNoPlanned).toBeCloseTo(
      start + p.months.reduce((a, m) => a + m.inflow - m.unplanned, 0),
    )
    expect(p.months[2].unplanned).toBeCloseTo(9000)
  })

  it("lists each counted occurrence by day, signed, and records logged ahead", () => {
    const ahead = rec("prepaid", "expense", 999, day20(2), { payee: "Dentist" })
    const p = project(state(plans(), [ahead]), {
      horizon: 6,
      includeUnplanned: false,
    })
    const next = p.months[1]
    expect(next.items.map((x) => [x.item.id, x.amount])).toEqual(
      expect.arrayContaining([
        ["salary", 30000],
        ["rent", -12000],
        ["laptop", -45000],
        ["invest", -2000],
      ]),
    )
    expect(next.items).toHaveLength(4)
    // Out before in on the same day, so the list reads biggest bills first.
    expect(next.items[0].item.id).toBe("laptop")
    expect(p.months[2].logged.map((r) => r.id)).toEqual(["prepaid"])
    // Already in today's balance: it moves nothing.
    expect(p.start).toBe(40000 - 999)
  })

  it("leaves out paid, skipped and excluded occurrences from the list", () => {
    const s = state([
      ...plans(),
      item(
        "gym",
        "expense",
        1500,
        { kind: "monthly", day: 20, every: 1 },
        {
          skipped: [day20(1)],
        },
      ),
    ])
    const p = project(s, {
      horizon: 3,
      includeUnplanned: false,
      excludedPlanned: ["rent"],
    })
    const ids = p.months[1].items.map((x) => x.item.id)
    expect(ids).not.toContain("gym")
    expect(ids).not.toContain("rent")
    expect(p.months[2].items.map((x) => x.item.id)).toContain("gym")
  })
})

describe("forecast: the same line on a custom range", () => {
  it("runs a no-planned balance beside the balance, day by day", () => {
    const s = state(plans())
    const f = forecast(s, today, addDays(today, 70), {
      includeUnplanned: false,
    })
    const last = f.days.at(-1)
    expect(last?.noPlanned).toBe(f.start + f.income)
    expect((last?.noPlanned ?? 0) - (last?.balance ?? 0)).toBe(f.bills)
  })
})

describe("balancesAtEnd: the balance a month ends on", () => {
  it("is what the records say for a day already past", () => {
    const s = state(
      [],
      [
        rec("a", "income", 1000, addDays(today, -40)),
        rec("b", "expense", 300, addDays(today, -10)),
        // Not a counted account: never part of the balance.
        rec("c", "income", 7777, addDays(today, -40), { accountId: "invest" }),
      ],
    )
    expect(
      balancesAtEnd(s, [
        addDays(today, -41),
        addDays(today, -20),
        addDays(today, -1),
      ]),
    ).toEqual([40000, 41000, 40700])
  })

  it("is the forecast from today on, on the Projection's own settings", () => {
    const s = state(plans())
    const end = addDays(today, 90)
    const [v] = balancesAtEnd(s, [end])
    expect(v).toBe(forecast(s, today, end, { includeUnplanned: false }).atTo)
    // Excluding an item in the Projection's assumptions moves it here too.
    const without: FinState = {
      ...s,
      settings: { ...s.settings, projExcludedPlanned: ["rent"] },
    }
    expect(balancesAtEnd(without, [end])[0]).toBeGreaterThan(v)
  })

  it("puts the balance on every Cash flow month: actual before, expected after", () => {
    const s = state(plans(), [rec("a", "income", 500, addDays(today, -45))])
    const m = monthlyFlow(s, 6, today, 2)
    const [, endNow] = monthRange(cur, 1)
    expect(m.find((x) => x.current)?.balance).toBe(
      forecast(s, today, endNow, { includeUnplanned: false }).atTo,
    )
    const past = m.find((x) => !x.current && !x.future)
    if (!past) throw new Error("no past month")
    const [, pastEnd] = monthRange(past.key, 1)
    expect(past.balance).toBe(balancesAtEnd(s, [pastEnd])[0])
  })
})

describe("Projection screen", () => {
  const seed = () => finStore.set(() => state(plans()))

  it("draws and names the line with no projected expenses", () => {
    seed()
    render(<Projection />, { wrapper })
    expect(screen.getByText("No projected expenses")).toBeTruthy()
    expect(screen.getByText("Baseline")).toBeTruthy()
    expect(screen.getByText("Minimum balance")).toBeTruthy()
  })

  it("reads both values off the chart for a month, with the gap", () => {
    seed()
    render(<Projection />, { wrapper })
    const chart = screen.getByLabelText("Chart")
    fireEvent(chart, "layout", {
      nativeEvent: { layout: { x: 0, y: 0, width: 358, height: 190 } },
    })
    for (let k = 0; k < 3; k++)
      fireEvent(chart, "accessibilityAction", {
        nativeEvent: { actionName: "increment" },
      })
    expect(screen.getByText("no projected expenses")).toBeTruthy()
    expect(screen.getByText(/^Planned spending −/)).toBeTruthy()
  })

  it("lists the current month's projected items and opens one on tap", () => {
    seed()
    render(<Projection />, { wrapper })
    // The current month starts open; next month opens on tap.
    expect(
      screen.queryByText(
        "A new laptop for work with a very long name that must wrap",
      ),
    ).toBeNull()
    fireEvent.press(screen.getAllByLabelText(/Show what is projected/)[0])
    const laptop = screen.getByText(
      "A new laptop for work with a very long name that must wrap",
    )
    // Titles wrap: never clipped to a line.
    expect(laptop.props.numberOfLines).toBeUndefined()
    expect(screen.getAllByText("−₱45,000").length).toBeGreaterThan(0)
    fireEvent.press(
      screen.getByLabelText(/^A new laptop.*Open the planned item$/),
    )
    expect(router.push).toHaveBeenCalledWith("/finance/planned/laptop")
  })

  it("opens a record logged ahead from its month", () => {
    finStore.set(() =>
      state(plans(), [
        rec("prepaid", "expense", 999, curEnd > today ? curEnd : day20(0), {
          payee: "Dentist",
        }),
      ]),
    )
    render(<Projection />, { wrapper })
    const row = screen.queryByLabelText(/^Dentist, logged for/)
    // Only when the month still has a day after today to log it on.
    if (curEnd > today) {
      expect(row).toBeTruthy()
      if (row) fireEvent.press(row)
      expect(router.push).toHaveBeenCalledWith("/finance/records/prepaid")
    }
  })
})

describe("Cash flow month detail", () => {
  it("says the balance the picked month ends on", () => {
    const s = state(plans(), [rec("a", "income", 500, addDays(today, -45))])
    render(<MonthlyFlowBars s={s} />, { wrapper })
    expect(screen.getByText("Expected balance at month end")).toBeTruthy()
    fireEvent.press(screen.getByLabelText("Earlier month"))
    fireEvent.press(screen.getByLabelText("Earlier month"))
    expect(screen.getByText("Balance at month end")).toBeTruthy()
  })
})
