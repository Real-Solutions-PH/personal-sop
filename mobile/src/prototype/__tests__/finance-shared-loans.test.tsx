// Loans in Finance: an empty Shared section is a dimmed sample loan, the
// borrower accepts an invite, the lender confirms a sent payment into an
// account, and the numbers (remaining, overdue) read with separators.

import * as L from "@domain/finance/loans"
import { finStore } from "@domain/finance/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
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
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
}))
jest.mock("expo-audio", () => ({}))
jest.mock("../media", () => ({ exportCsv: jest.fn(), pickPhoto: jest.fn() }))

const { LoanDetail, SharedSection } =
  require("../screens/finance-shared") as typeof import("../screens/finance-shared")

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
  jest.clearAllMocks()
})

const LOAN = "44444444-4444-4444-8444-444444444444"

function loan(role: L.LoanRole, extra: Partial<L.Loan> = {}): L.Loan {
  const l: L.Loan = {
    id: `m-${role}`,
    loanId: LOAN,
    role,
    status: "active",
    lender: { id: "kai", name: "Kai" },
    borrower: { id: "mia", name: "Mia" },
    principal: 1_200_000,
    interest: 0,
    total: 1_200_000,
    currency: "PHP",
    purpose: "Phone",
    schedule: { kind: "monthly", count: 6, start: "2020-01-15", day: 15 },
    installments: L.monthlyInstallments(1_200_000, 6, "2020-01-15", 15),
    payments: [],
    events: [],
    createdAt: "2020-01-01T00:00:00.000Z",
    ...extra,
  }
  L.sharedStore.set({ ...L.EMPTY_SHARED, loans: [l] })
  return l
}

test("an empty Shared section shows a dimmed sample loan and the way in", () => {
  render(<SharedSection />, { wrapper })
  expect(screen.getByTestId("shared-empty")).toBeTruthy()
  expect(screen.getByText("New loan")).toBeTruthy()
})

test("the section sums what is owed with thousands separators", () => {
  loan("lender")
  render(<SharedSection />, { wrapper })
  expect(screen.getByText("Owed to you")).toBeTruthy()
  expect(screen.getByText("₱12,000")).toBeTruthy()
})

test("the borrower accepts an invite", () => {
  loan("borrower", { status: "invited" })
  render(<LoanDetail loanId={LOAN} />, { wrapper })
  fireEvent.press(screen.getByText("Accept"))
  expect(L.sharedStore.get().loans[0].status).toBe("active")
})

test("an old schedule with nothing paid shows what is overdue", () => {
  loan("borrower")
  render(<LoanDetail loanId={LOAN} />, { wrapper })
  // Every installment of 2020 is past due.
  expect(screen.getAllByText("₱12,000 overdue").length).toBeGreaterThan(0)
  expect(screen.getByText("Pay")).toBeTruthy()
})

test("the lender confirms a sent payment into an account", () => {
  const acct = finStore.get().accounts[0]
  loan("lender", {
    payments: [
      {
        id: "p1",
        kind: "transfer",
        status: "sent",
        amount: 200_000,
        paidOn: "2020-01-15",
        byId: "mia",
        note: "GCash ref 1234",
        createdAt: "2020-01-15T04:00:00.000Z",
      },
    ],
  })
  render(<LoanDetail loanId={LOAN} />, { wrapper })
  expect(screen.getByText("Sent, awaiting confirmation")).toBeTruthy()
  fireEvent.press(screen.getByText("Review"))
  fireEvent.press(screen.getByText(acct.name))
  act(() => {
    fireEvent.press(screen.getByText("Confirm it arrived"))
  })
  const p = L.sharedStore.get().loans[0].payments[0]
  expect(p.status).toBe("accepted")
  expect(p.accountId).toBe(acct.id)
  expect(L.loanSummary(L.sharedStore.get().loans[0], "2020-01-16").paid).toBe(
    200_000,
  )
})
