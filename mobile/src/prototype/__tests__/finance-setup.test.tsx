// The finance step of first-run setup: no Skip there, salary and rent
// never dropped, a default account, no duplicate accounts.

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
jest.mock("react-native-gesture-handler/ReanimatedSwipeable", () => {
  const { View } = require("react-native")
  return ({ children }: { children: ReactNode }) => <View>{children}</View>
})
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
}))
jest.mock("expo-audio", () => ({}))
jest.mock("../media", () => ({ exportCsv: jest.fn(), pickPhoto: jest.fn() }))

const { FinanceSetup } =
  require("../screens/finance-setup") as typeof import("../screens/finance-setup")
const { RecordEditor } =
  require("../screens/finance") as typeof import("../screens/finance")
const { toast } = require("sonner-native") as {
  toast: jest.Mock & { error: jest.Mock }
}

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
  // A fresh account: nothing set up yet.
  finStore.set((s) => ({
    ...s,
    accounts: [],
    planned: [],
    records: [],
    settings: { ...s.settings, defaultAccountId: "" },
  }))
  jest.clearAllMocks()
})
const include = (name: string) =>
  fireEvent.press(screen.getByLabelText(`Include ${name}`))

test("first-run setup offers no Skip; setup run later does", () => {
  const view = render(<FinanceSetup embedded canSkip={false} />, { wrapper })
  expect(screen.queryByText("Skip")).toBeNull()
  view.unmount()
  render(<FinanceSetup embedded />, { wrapper })
  expect(screen.getByText("Skip")).toBeTruthy()
})

test("salary lands in Cash when the bank is left out", () => {
  render(<FinanceSetup embedded onDone={() => {}} />, { wrapper })
  for (const n of ["GCash", "Maya", "BPI Savings"]) include(n)
  fireEvent.changeText(
    screen.getByLabelText("Salary per payday ₱ (15th & 30th)"),
    "27500.50",
  )
  fireEvent.changeText(
    screen.getByLabelText("Rent ₱ (5th of the month)"),
    "12000.75",
  )
  fireEvent.press(screen.getByText("Add 1 account"))
  const s = finStore.get(),
    cash = s.accounts.find((a) => a.name === "Cash")
  expect(s.planned.find((p) => p.name === "Salary")).toMatchObject({
    amount: 27500.5,
    accountId: cash?.id,
  })
  expect(s.planned.find((p) => p.name === "Rent")?.amount).toBe(12000.75)
  // The default account is Cash, so the first transaction can be saved.
  expect(s.settings.defaultAccountId).toBe(cash?.id)
  expect(toast).toHaveBeenCalledWith(
    "1 account added, salary and rent scheduled",
  )
})

test("rent with only a credit card is refused, not dropped", () => {
  render(<FinanceSetup embedded onDone={() => {}} />, { wrapper })
  for (const n of ["Cash", "GCash", "Maya", "BPI Savings", "Credit card"])
    include(n)
  fireEvent.changeText(
    screen.getByLabelText("Rent ₱ (5th of the month)"),
    "12000",
  )
  fireEvent.press(screen.getByText("Add 1 account"))
  expect(
    screen.getByText("Add an account for your salary and rent to land in"),
  ).toBeTruthy()
  expect(finStore.get().accounts).toHaveLength(0)
  expect(finStore.get().planned).toHaveLength(0)
})

test("a name that is already an account is refused, naming it", () => {
  const { addAccount } = require("@domain/finance/actions")
  addAccount({
    name: "Wallet",
    type: "cash",
    opening: 0,
    color: "var(--acct-green)",
    inNetWorth: true,
    inProjection: true,
  })
  render(<FinanceSetup embedded onDone={() => {}} />, { wrapper })
  fireEvent.changeText(screen.getByLabelText("cash account name"), "wallet")
  fireEvent.press(screen.getByText("Add 4 accounts"))
  expect(toast.error).toHaveBeenCalledWith(
    "You already have an account called “wallet”",
  )
  expect(finStore.get().accounts).toHaveLength(1)
})

test("an account that syncs in while the step is open drops its row", () => {
  render(<FinanceSetup embedded onDone={() => {}} />, { wrapper })
  expect(screen.getByLabelText("Include Maya")).toBeTruthy()
  act(() => {
    require("@domain/finance/actions").addAccount({
      name: "Maya",
      type: "ewallet",
      opening: 0,
      color: "var(--acct-emerald)",
      inNetWorth: true,
      inProjection: true,
    })
  })
  expect(screen.queryByLabelText("Include Maya")).toBeNull()
})

test("the credit limit field is labelled", () => {
  render(<FinanceSetup embedded onDone={() => {}} />, { wrapper })
  include("Credit card")
  expect(screen.getByLabelText("Credit limit")).toBeTruthy()
})

test("saving a transaction with no account says so", () => {
  render(<RecordEditor open onClose={() => {}} />, { wrapper })
  fireEvent.changeText(screen.getByLabelText("Amount ₱"), "50")
  fireEvent.press(screen.getByText("Save"))
  expect(screen.getByText("Add an account first")).toBeTruthy()
})

test("a salary alone is scheduled into an existing account, not dropped", () => {
  require("@domain/finance/actions").addAccount({
    name: "BDO",
    type: "bank",
    opening: 0,
    color: "var(--acct-blue)",
    inNetWorth: true,
    inProjection: true,
  })
  render(<FinanceSetup embedded onDone={() => {}} />, { wrapper })
  for (const n of ["Cash", "GCash", "Maya", "BPI Savings"]) include(n)
  fireEvent.changeText(
    screen.getByLabelText("Salary per payday ₱ (15th & 30th)"),
    "30000",
  )
  expect(screen.queryByText("Continue")).toBeNull()
  fireEvent.press(screen.getByText("Schedule"))
  const s = finStore.get(),
    bdo = s.accounts.find((a) => a.name === "BDO")
  expect(s.planned.find((p) => p.name === "Salary")?.accountId).toBe(bdo?.id)
  expect(toast).toHaveBeenCalledWith("Salary scheduled")
})
