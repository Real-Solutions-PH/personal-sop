// Planning a purchase on installments: besides the 3/6/12/24 chips, any
// number of months can be typed, kept between 2 and 60; a downpayment and an
// add-on interest rate (per month or per year, 0% allowed) change the
// monthly amount, the interest and the total.
import * as C from "@domain/finance/calc"
import { finStore } from "@domain/finance/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { fireEvent, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({ whatif: "1", amount: "36000" }),
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

const { Projection, clampTerm } =
  require("../screens/finance-projection") as typeof import("../screens/finance-projection")

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
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
})

it("keeps a typed term between 2 and 60 months", () => {
  expect(clampTerm(1)).toBe(2)
  expect(clampTerm(36)).toBe(36)
  expect(clampTerm(99)).toBe(60)
})

it("plans a typed number of months", () => {
  render(<Projection />, { wrapper })
  fireEvent.press(screen.getByText("Installments"))
  // The last "Custom" is the term chip; the first is the range switch.
  fireEvent.press(screen.getAllByText("Custom").slice(-1)[0])
  fireEvent.changeText(screen.getByLabelText("Months to pay"), "36")
  // 36,000 over 36 months.
  expect(screen.getByText(/1,000\/mo × 36 on/)).toBeTruthy()
})

it("plans 60 months when more are typed, and says so", () => {
  render(<Projection />, { wrapper })
  fireEvent.press(screen.getByText("Installments"))
  // The last "Custom" is the term chip; the first is the range switch.
  fireEvent.press(screen.getAllByText("Custom").slice(-1)[0])
  fireEvent.changeText(screen.getByLabelText("Months to pay"), "72")
  expect(screen.getByText(/600\/mo × 60 on/)).toBeTruthy()
  expect(screen.getByText(/up to 60 months/)).toBeTruthy()
})

// Hand-computed: 36,000 - 6,000 down = 30,000 financed; 1.5% a month for 12
// months is 30,000 x 0.015 x 12 = 5,400 interest; (30,000 + 5,400) / 12 =
// 2,950 a month; 36,000 + 5,400 = 41,400 in all.
it("a downpayment and a monthly rate give the monthly, interest and total", () => {
  render(<Projection />, { wrapper })
  fireEvent.press(screen.getByText("Installments"))
  fireEvent.press(screen.getByText("12×"))
  fireEvent.changeText(screen.getByLabelText("Downpayment ₱"), "6000")
  fireEvent.changeText(screen.getByLabelText("Interest"), "1.5")
  const plan = screen.getByTestId("installment-plan")
  expect(plan).toHaveTextContent(/₱2,950\/mo × 12 on/)
  expect(plan).toHaveTextContent(/₱5,400 interest/)
  expect(plan).toHaveTextContent(/₱41,400 in all · ₱6,000 down in/)
  // 18% a year is the same 1.5% a month.
  fireEvent.press(screen.getByText("/ month"))
  fireEvent.changeText(screen.getByLabelText("Interest"), "18")
  fireEvent.press(screen.getByText("/ year"))
  expect(screen.getByTestId("installment-plan")).toHaveTextContent(
    /₱5,400 interest/,
  )
})

it("0% says no interest, and saving schedules the downpayment and the payments", () => {
  render(<Projection />, { wrapper })
  fireEvent.press(screen.getByText("Installments"))
  fireEvent.press(screen.getByText("12×"))
  fireEvent.changeText(screen.getByLabelText("Downpayment ₱"), "6000")
  expect(screen.getByTestId("installment-plan")).toHaveTextContent(
    /No interest/,
  )
  fireEvent.changeText(screen.getByLabelText("Interest"), "1.5")
  const before = finStore.get().planned.length
  fireEvent.press(screen.getByText("Save as scheduled"))
  const added = finStore.get().planned.slice(before)
  const down = added.find((p) => p.type === "expense"),
    inst = added.find((p) => p.isInstallment)
  expect(down).toMatchObject({ amount: 6000, schedule: { kind: "once" } })
  expect(inst).toMatchObject({
    amount: 2950,
    type: "transfer",
    end: { kind: "count", n: 12 },
  })
})

describe("installmentPlan", () => {
  const plan = (x: Partial<Parameters<typeof C.installmentPlan>[0]>) =>
    C.installmentPlan({
      priceMinor: 4_500_000,
      downMinor: 500_000,
      months: 12,
      rateHundredths: 0,
      per: "month",
      ...x,
    })
  it("0%: the financed amount split, nothing added", () => {
    // 40,000.00 / 12 = 3,333.333… -> 3,333.33
    expect(plan({})).toEqual({
      financedMinor: 4_000_000,
      monthlyMinor: 333_333,
      interestMinor: 0,
      totalMinor: 4_500_000,
    })
  })
  it("add-on interest, per month or per year", () => {
    // 40,000 x 1.5% x 12 = 7,200; (40,000 + 7,200) / 12 = 3,933.333…
    const m = plan({ rateHundredths: 150 })
    expect(m).toEqual({
      financedMinor: 4_000_000,
      monthlyMinor: 393_333,
      interestMinor: 720_000,
      totalMinor: 5_220_000,
    })
    expect(plan({ rateHundredths: 1800, per: "year" })).toEqual(m)
  })
  it("rounds once, half up", () => {
    // 10.00 x 1.25% = 0.125 -> 0.13; (10.00 + 0.125) / 1 -> 10.13
    expect(
      C.installmentPlan({
        priceMinor: 1000,
        downMinor: 0,
        months: 1,
        rateHundredths: 125,
        per: "month",
      }),
    ).toMatchObject({ interestMinor: 13, monthlyMinor: 1013 })
    // 2.00 / 3 = 0.666… -> 0.67
    expect(
      C.installmentPlan({
        priceMinor: 200,
        downMinor: 0,
        months: 3,
        rateHundredths: 0,
        per: "month",
      }).monthlyMinor,
    ).toBe(67)
  })
  it("a downpayment over the price finances nothing", () => {
    expect(plan({ downMinor: 9_000_000, rateHundredths: 150 })).toMatchObject({
      financedMinor: 0,
      monthlyMinor: 0,
      interestMinor: 0,
      totalMinor: 4_500_000,
    })
  })
})

it("the projection takes the downpayment in the purchase month, then the payments", () => {
  const s = finStore.get(),
    cur = C.monthOf(C.today(), 1),
    month = C.addMonths(cur, 2),
    base = { horizon: 6, includeUnplanned: false }
  const without = C.project(s, base),
    withIt = C.project(s, {
      ...base,
      whatIf: {
        amount: 36000,
        month,
        installments: 3,
        down: 6000,
        monthly: 11000,
      },
    })
  const cost = withIt.months.map((m, i) => without.months[i].end - m.end)
  // Cumulative: nothing before, 6,000 + 11,000, then +11,000 twice, then flat.
  expect(cost.map(Math.round)).toEqual([0, 0, 17000, 28000, 39000, 39000])
})
