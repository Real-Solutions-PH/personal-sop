// Apple Pay quick-add: the Shortcuts link is untrusted, so it is parsed
// strictly and only ever prefills an editor the user confirms.
import type { Account } from "@domain/finance/data"
import { finStore } from "@domain/finance/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { toast } from "sonner-native"
import { cardAccount, parseAmount, quickAdd } from "../quick-add"

let mockParams: Record<string, string | string[]> = {}
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
jest.mock("../media", () => ({
  copyText: jest.fn(),
  exportCsv: jest.fn(),
  pickPhoto: jest.fn(),
}))

const { FinanceQuickAdd } =
  require("../screens/finance-apple-pay") as typeof import("../screens/finance-apple-pay")

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
  mockParams = {}
  jest.clearAllMocks()
})

test.each([
  ["₱1,234.50", 1234.5],
  ["1234.50", 1234.5],
  ["1234,50", 1234.5],
  ["1.234,50", 1234.5],
  ["PHP 1,234", 1234],
  ["1 234,5 PHP", 1234.5],
  ["₱89", 89],
  ["12.345", 12345],
  ["1,234.567", 1234.57],
])("amount %p reads as %p", (raw, n) => {
  expect(parseAmount(raw)).toBe(n)
})

test.each([
  undefined,
  "",
  "0",
  "0.00",
  "-50",
  "abc",
  "1e5",
  "Infinity",
  "NaN",
  "12;drop",
  "<script>1</script>",
  "1000000000",
  ".",
])("amount %p is rejected", (raw) => {
  expect(parseAmount(raw)).toBeUndefined()
})

const acct = (id: string, name: string, archived = false) =>
  ({ ...finStore.get().accounts[0], id, name, archived }) as Account

test("a card picks the account named like it, ignoring case and archived ones", () => {
  const accounts = [
    acct("old", "BPI Visa", true),
    acct("bpi", "BPI Visa"),
    acct("gc", "GCash"),
  ]
  expect(cardAccount(accounts, "bpi visa")).toBe("bpi")
  expect(cardAccount(accounts, "BPI Visa Signature")).toBe("bpi")
  expect(cardAccount(accounts, "Metrobank Mastercard")).toBeUndefined()
  expect(cardAccount(accounts, undefined)).toBeUndefined()
})

test("a link prefills an expense with payee, category and the card's account", () => {
  const s = finStore.get(),
    account = s.accounts.find((a) => !a.archived) as Account,
    q = quickAdd(s, {
      amount: "₱289.00",
      merchant: "  JOLLIBEE FOODS CORP\n",
      card: account.name.toUpperCase(),
    })
  expect(q.error).toBeUndefined()
  expect(q.prefill).toMatchObject({
    type: "expense",
    amount: 289,
    payee: "Jollibee",
    accountId: account.id,
    categoryId: "dining",
  })
})

test("hostile params are cleaned, capped and never trusted", () => {
  const q = quickAdd(finStore.get(), {
    amount: ["50", "999999"],
    merchant: `‮Evil\u0000 ${"x".repeat(500)}`,
    card: "nothing matches this",
  })
  expect(q.prefill.amount).toBe(50)
  expect(q.prefill.payee).toHaveLength(120)
  expect(q.prefill.payee?.startsWith("Evil x")).toBe(true)
  // No match: the editor falls back to the last-used or default account.
  expect(q.prefill.accountId).toBeUndefined()
})

test("a missing or bad amount gives an empty expense and an error", () => {
  for (const amount of [undefined, "free", "-1"]) {
    const q = quickAdd(finStore.get(), { amount, merchant: "Jollibee" })
    expect(q.prefill).toEqual({ type: "expense" })
    expect(q.error).toBeTruthy()
  }
})

test("the quick-add route opens the editor prefilled and saves nothing", () => {
  const count = finStore.get().records.length
  mockParams = { amount: "1,234.50", merchant: "Jollibee", card: "" }
  render(<FinanceQuickAdd />, { wrapper })
  expect(screen.getByText("New transaction")).toBeTruthy()
  expect(screen.getByLabelText("Amount ₱").props.value).toMatch(/1,?234\.5/)
  expect(screen.getByLabelText("Payee").props.value).toBe("Jollibee")
  expect(finStore.get().records).toHaveLength(count)
  expect(toast.error).not.toHaveBeenCalled()
})

test("the quick-add route with a bad amount opens empty with a toast", () => {
  mockParams = { amount: "lots", merchant: "Jollibee" }
  render(<FinanceQuickAdd />, { wrapper })
  expect(screen.getByLabelText("Amount ₱").props.value).toBe("")
  expect(screen.getByLabelText("Payee").props.value).toBe("")
  expect(toast.error).toHaveBeenCalled()
})
