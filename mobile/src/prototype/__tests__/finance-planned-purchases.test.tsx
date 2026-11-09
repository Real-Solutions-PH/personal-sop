// Planned purchases and the reports around them: a draft installment
// purchase made real takes its downpayment with it; a purchase saved this
// month lands on a day the Projection still counts, its first payment in
// the purchase month; the Projection lists every expense it can count, each
// with a switch; the Cash flow month lists what is still expected; the Net
// worth report draws its month-by-month, makeup and ahead charts.
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

const A =
  require("@domain/finance/actions") as typeof import("@domain/finance/actions")
const { Projection, purchaseDay } =
  require("../screens/finance-projection") as typeof import("../screens/finance-projection")
const { ProjectedExpenses, projectedExpenses } =
  require("../screens/finance-projected-manage") as typeof import("../screens/finance-projected-manage")
const { monthlyFlow, MonthlyFlowBars } =
  require("../screens/finance-monthly-flow") as typeof import("../screens/finance-monthly-flow")
const { monthlyNetWorth, NetWorthByMonth, NetWorthMakeup } =
  require("../screens/finance-networth-cards") as typeof import("../screens/finance-networth-cards")

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

jest.setTimeout(30000)

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  for (const k of Object.keys(mockParams)) delete mockParams[k]
})

const plannedBase = (
  name: string,
  extra: Partial<PlannedItem>,
): Omit<PlannedItem, "id" | "archived" | "skipped" | "snoozed" | "start"> => ({
  name,
  type: "expense",
  amount: 1000,
  estimated: false,
  accountId: finStore.get().accounts[0].id,
  categoryId: "shopping",
  schedule: { kind: "once", date: N.addDays(N.today(), 20) },
  end: { kind: "never" },
  autoLog: false,
  isWhatIf: false,
  inProjection: true,
  ...extra,
})

describe("a draft installment purchase made real", () => {
  const draftPair = () => {
    const start = N.addDays(N.today(), 5)
    const down = A.addPlanned(
      plannedBase(`Land${N.DOWNPAYMENT_SUFFIX}`, {
        amount: 50_000,
        schedule: { kind: "once", date: start },
        isWhatIf: true,
        inProjection: false,
      }),
    )
    const plan = A.addPlanned({
      ...plannedBase("Land", {
        amount: 36_000,
        schedule: { kind: "monthly", day: Number(start.slice(8)) },
        end: { kind: "count", n: 12 },
        isInstallment: true,
        isWhatIf: true,
        inProjection: false,
      }),
      start,
    })
    return { down, plan }
  }
  const get = (id: string) =>
    finStore.get().planned.find((p) => p.id === id) as PlannedItem

  it("pairs a plan with its downpayment both ways", () => {
    const { down, plan } = draftPair()
    expect(N.companionOf(finStore.get(), plan)?.id).toBe(down.id)
    expect(N.companionOf(finStore.get(), down)?.id).toBe(plan.id)
  })

  it("schedules the downpayment too, so the first month counts it", () => {
    const { down, plan } = draftPair()
    A.updatePlanned(plan.id, { isWhatIf: false, inProjection: true })
    expect(get(down.id)).toMatchObject({ isWhatIf: false, inProjection: true })
    const s = finStore.get()
    const months = N.project(s, { horizon: 2, includeUnplanned: false }).months
    const names = months
      .flatMap((m) => m.items)
      .map((x) => x.item.name)
      .slice(0, 50)
    expect(names).toContain(`Land${N.DOWNPAYMENT_SUFFIX}`)
  })

  it("makes the plan real when its downpayment is made real", () => {
    const { down, plan } = draftPair()
    A.updatePlanned(down.id, { isWhatIf: false, inProjection: true })
    expect(get(plan.id).isWhatIf).toBe(false)
  })

  it("leaves an unrelated item alone", () => {
    const { down } = draftPair()
    const other = A.addPlanned(plannedBase("Gym", { isWhatIf: true }))
    A.updatePlanned(other.id, { isWhatIf: false, inProjection: true })
    expect(get(down.id).isWhatIf).toBe(true)
  })
})

describe("purchaseDay", () => {
  it("is the 15th of a later month", () => {
    expect(purchaseDay("2026-12", "2026-11-09")).toBe("2026-12-15")
  })
  it("is the 15th of this month while it is still ahead", () => {
    expect(purchaseDay("2026-11", "2026-11-09")).toBe("2026-11-15")
  })
  it("is tomorrow once this month's 15th is today or gone", () => {
    expect(purchaseDay("2026-11", "2026-11-15")).toBe("2026-11-16")
    expect(purchaseDay("2026-11", "2026-11-20")).toBe("2026-11-21")
  })
  it("stays in the month on its last day", () => {
    expect(purchaseDay("2026-11", "2026-11-30")).toBe("2026-11-30")
  })
})

it("saves an installment purchase this month with the downpayment and first payment in it", () => {
  mockParams.whatif = "1"
  mockParams.amount = "36000"
  mockParams.month = N.monthOf(N.today(), 1)
  render(<Projection />, { wrapper })
  fireEvent.press(screen.getByText("Installments"))
  fireEvent.press(screen.getByText("6×"))
  fireEvent.changeText(screen.getByLabelText("Downpayment ₱"), "6000")
  const before = finStore.get().planned.length
  fireEvent.press(screen.getByText("Save as scheduled"))
  const s = finStore.get()
  const added = s.planned.slice(before)
  const first = N.project(s, { horizon: 1, includeUnplanned: false }).months[0]
  const ids = first.items.map((x) => x.item.id)
  expect(added).toHaveLength(2)
  // Both land in the purchase month the preview charged them to.
  for (const p of added) expect(ids).toContain(p.id)
})

describe("Projected expenses on the Projection", () => {
  it("lists money out, not income, with drafts after what is scheduled", () => {
    const s = finStore.get()
    const list = projectedExpenses(s)
    expect(list.length).toBeGreaterThan(0)
    expect(list.every((p) => p.type !== "income")).toBe(true)
    const firstDraft = list.findIndex((p) => p.isWhatIf)
    if (firstDraft >= 0)
      expect(list.slice(firstDraft).every((p) => p.isWhatIf)).toBe(true)
  })

  it("switching one off leaves it out of the projection, and back on counts it", () => {
    const p = A.addPlanned(plannedBase("Laptop", { amount: 45_000 }))
    render(<ProjectedExpenses />, { wrapper })
    const sw = screen.getByLabelText("Count Laptop in the projection")
    fireEvent.press(sw)
    const off = finStore.get().settings.projExcludedPlanned.includes(p.id)
    expect(off).toBe(true)
    fireEvent.press(screen.getByLabelText("Count Laptop in the projection"))
    expect(finStore.get().settings.projExcludedPlanned).not.toContain(p.id)
  })

  it("switching a draft on schedules it", () => {
    const p = A.addPlanned(
      plannedBase("Phone", { isWhatIf: true, inProjection: false }),
    )
    render(<ProjectedExpenses />, { wrapper })
    fireEvent.press(screen.getByLabelText("Count Phone in the projection"))
    expect(finStore.get().planned.find((x) => x.id === p.id)).toMatchObject({
      isWhatIf: false,
      inProjection: true,
    })
  })
})

describe("Cash flow lists what is still expected", () => {
  it("lists the items behind the scheduled totals", () => {
    const s = finStore.get()
    const flow = monthlyFlow({
      ...s,
      settings: { ...s.settings, monthStartDay: 1 },
    })
    const cur = flow[flow.length - 1]
    const sum = (type: string) =>
      cur.aheadItems
        .filter((o) => o.item.type === type)
        .reduce((a, o) => a + o.item.amount, 0)
    expect(cur.aheadItems.length).toBeGreaterThan(0)
    expect(sum("income")).toBeCloseTo(cur.aheadIn)
    expect(sum("expense")).toBeCloseTo(cur.aheadOut)
  })

  it("draws them under the month", () => {
    render(<MonthlyFlowBars s={finStore.get()} />, { wrapper })
    const list = screen.getByTestId("monthly-flow-scheduled")
    expect(within(list).getByText("Still expected this month")).toBeTruthy()
  })
})

describe("Net worth charts", () => {
  const only = (records: FinRecord[]): FinState => {
    const s = finStore.get()
    return {
      ...s,
      records,
      planned: [],
      accounts: s.accounts.map((a) => ({ ...a, opening: 0 })),
      settings: { ...s.settings, monthStartDay: 1 },
    }
  }
  const acct = () => finStore.get().accounts.find((a) => a.inNetWorth)?.id

  it("gives each month's change and where it ended", () => {
    const id = acct() as string
    const rec = (amount: number, day: string, type: "income" | "expense") =>
      ({
        id: `${day}-${amount}`,
        type,
        amount,
        accountId: id,
        at: `${day}T12:00:00`,
        source: "manual",
        status: "cleared",
      }) as FinRecord
    const m = monthlyNetWorth(
      only([
        rec(10_000, "2026-09-10", "income"),
        rec(4_000, "2026-10-05", "expense"),
        rec(1_000, "2026-11-02", "income"),
      ]),
      3,
      "2026-11-09",
    )
    expect(m.map((x) => [x.key, x.change, x.value])).toEqual([
      ["2026-09", 10_000, 10_000],
      ["2026-10", -4_000, 6_000],
      ["2026-11", 1_000, 7_000],
    ])
    expect(m[2].current).toBe(true)
  })

  it("draws a row per month and per account", () => {
    render(
      <>
        <NetWorthByMonth s={finStore.get()} />
        <NetWorthMakeup s={finStore.get()} />
      </>,
      { wrapper },
    )
    expect(screen.getByText("Change each month")).toBeTruthy()
    expect(screen.getByText("What it's made of")).toBeTruthy()
  })
})
