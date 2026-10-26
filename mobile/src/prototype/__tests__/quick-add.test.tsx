// Apple Pay quick-add: the Shortcuts link is untrusted, so it is parsed
// strictly and saves on its own only when the card's account is certain.
import type { Account } from "@domain/finance/data"
import { finStore } from "@domain/finance/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { fireEvent, render, screen } from "@testing-library/react-native"
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
  const s = { accounts, settings: finStore.get().settings }
  expect(cardAccount(s, "bpi visa")).toEqual({ id: "bpi", sure: true })
  expect(cardAccount(s, "BPI Visa Signature")?.id).toBe("bpi")
  expect(cardAccount(s, "Metrobank Mastercard")).toBeUndefined()
  expect(cardAccount(s, undefined)).toBeUndefined()
})

test("a card tied to an account wins over names, unless that account is archived", () => {
  const accounts = [acct("bpi", "BPI Visa"), acct("gc", "GCash")],
    settings = {
      ...finStore.get().settings,
      cardAccounts: { "bpi visa": "gc" },
    }
  expect(cardAccount({ accounts, settings }, "BPI Visa")).toEqual({
    id: "gc",
    sure: true,
  })
  accounts[1] = acct("gc", "GCash", true)
  expect(cardAccount({ accounts, settings }, "BPI Visa")).toEqual({
    id: "bpi",
    sure: true,
  })
})

test("a card named like more than one account is a guess", () => {
  const accounts = [
      acct("ubd", "UnionBank Debit"),
      acct("ubv", "UnionBank Visa"),
    ],
    s = { accounts, settings: finStore.get().settings }
  expect(cardAccount(s, "UnionBank")).toEqual({ id: "ubd", sure: false })
  expect(cardAccount(s, "UnionBank Visa")).toEqual({ id: "ubv", sure: true })
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

test("a new card opens the editor prefilled and saves nothing", () => {
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

test("saving a new card's expense remembers its account; the next tap saves on its own", () => {
  const count = finStore.get().records.length
  mockParams = { amount: "289", merchant: "Jollibee", card: "My Card" }
  const first = render(<FinanceQuickAdd />, { wrapper })
  expect(finStore.get().settings.cardAccounts).toBeUndefined()
  fireEvent.press(screen.getByText("Save"))
  expect(finStore.get().records).toHaveLength(count + 1)
  const tied = finStore.get().settings.cardAccounts?.["my card"]
  expect(tied).toBeTruthy()
  first.unmount()

  mockParams = { amount: "150", merchant: "Jollibee", card: "MY CARD" }
  render(<FinanceQuickAdd />, { wrapper })
  expect(screen.queryByText("New transaction")).toBeNull()
  const s = finStore.get(),
    r = s.records.find((r) => r.amount === 150)
  expect(s.records).toHaveLength(count + 2)
  expect(r).toMatchObject({
    type: "expense",
    accountId: tied,
    payee: "Jollibee",
    categoryId: "dining",
    source: "quick-add",
  })
  // Undo takes it back.
  const [, opts] = (toast as unknown as jest.Mock).mock.calls.at(-1)
  opts.action.onClick()
  expect(finStore.get().records).toHaveLength(count + 1)
})

test("a tied card with an uncategorised merchant still asks", () => {
  const account = finStore.get().accounts.find((a) => !a.archived) as Account,
    count = finStore.get().records.length
  finStore.set((s) => ({
    ...s,
    settings: { ...s.settings, cardAccounts: { "my card": account.id } },
  }))
  mockParams = { amount: "99", merchant: "Zqx Unknown Shop", card: "My Card" }
  render(<FinanceQuickAdd />, { wrapper })
  expect(screen.getByText("New transaction")).toBeTruthy()
  expect(finStore.get().records).toHaveLength(count)
})

test("a first tap saves straight away to the one account named like the card", () => {
  const s = finStore.get(),
    account = s.accounts.find(
      (a) => !a.archived && cardAccount(s, a.name)?.sure,
    ) as Account,
    count = finStore.get().records.length
  mockParams = { amount: "289", merchant: "Jollibee", card: account.name }
  render(<FinanceQuickAdd />, { wrapper })
  expect(screen.queryByText("New transaction")).toBeNull()
  expect(finStore.get().records).toHaveLength(count + 1)
  expect(finStore.get().records.find((r) => r.amount === 289)?.accountId).toBe(
    account.id,
  )
})

test("a first tap with a card named like two accounts asks", () => {
  const base = finStore.get().accounts[0] as Account,
    count = finStore.get().records.length
  finStore.set((s) => ({
    ...s,
    accounts: [
      ...s.accounts,
      { ...base, id: "ubd", name: "UnionBank Debit", archived: false },
      { ...base, id: "ubv", name: "UnionBank Visa", archived: false },
    ],
  }))
  mockParams = { amount: "289", merchant: "Jollibee", card: "UnionBank" }
  render(<FinanceQuickAdd />, { wrapper })
  expect(screen.getByText("New transaction")).toBeTruthy()
  expect(finStore.get().records).toHaveLength(count)
})
