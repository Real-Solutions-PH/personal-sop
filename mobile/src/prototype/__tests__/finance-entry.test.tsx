// Typing money and recording it: the shared money field, recording a
// scheduled payment only on Save, the grouped category picker, the finance
// setup amounts, and the account and scheduled-payment labels.

import { finStore } from "@domain/finance/store"
import { derivedId } from "@domain/lib/ids"
import { configureStorage, resetAll } from "@domain/lib/store"
import { fireEvent, render, screen } from "@testing-library/react-native"
import { type ReactNode, useState } from "react"
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

const { MoneyInput } =
  require("../money-input") as typeof import("../money-input")
const { RecordEditor } =
  require("../screens/finance") as typeof import("../screens/finance")
const { FinanceSetup } =
  require("../screens/finance-setup") as typeof import("../screens/finance-setup")
const { accountColorKey, AccountCard } =
  require("../screens/finance-account-card") as typeof import("../screens/finance-account-card")
const { plannedWhere } =
  require("../screens/finance-planned") as typeof import("../screens/finance-planned")

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

test("the money field shows separators and hands back the exact amount", () => {
  const seen: string[] = []
  function Host() {
    const [v, setV] = useState("")
    return (
      <MoneyInput
        label="Amount"
        value={v}
        onChange={(d) => {
          seen.push(d)
          setV(d)
        }}
      />
    )
  }
  render(<Host />, { wrapper })
  const field = screen.getByLabelText("Amount")
  fireEvent.changeText(field, "36000.5")
  expect(field.props.value).toBe("36,000.5")
  fireEvent.changeText(field, "36,000.50")
  expect(field.props.value).toBe("36,000.50")
  // Typing over the grouped text keeps the value, never 3,600,050.
  expect(seen).toEqual(["36000.5", "36000.50"])
  expect(Number(seen[1])).toBe(36000.5)
})

test("a signed money field keeps an overdrawn balance's minus", () => {
  function Host() {
    const [v, setV] = useState("")
    return <MoneyInput label="Balance" value={v} onChange={setV} signed />
  }
  render(<Host />, { wrapper })
  const field = screen.getByLabelText("Balance")
  fireEvent.changeText(field, "-1708.64")
  expect(field.props.value).toBe("-1,708.64")
})

test("Pay now records nothing until Save, then links the record to the date", () => {
  const p = finStore.get().planned.find((x) => x.type === "expense")
  if (!p) throw new Error("demo data has an expense plan")
  const day = "2030-01-05",
    count = finStore.get().records.length
  render(
    <RecordEditor
      open
      onClose={() => {}}
      settles={{ plannedId: p.id, day }}
      prefill={{
        type: "expense",
        amount: p.amount,
        accountId: p.accountId,
        categoryId: p.categoryId,
        payee: p.name,
      }}
    />,
    { wrapper },
  )
  expect(screen.getByText(`Record ${p.name}`)).toBeTruthy()
  // Opening the editor wrote nothing.
  expect(finStore.get().records).toHaveLength(count)
  expect(screen.getByText(/^Expected ₱/)).toBeTruthy()
  fireEvent.changeText(screen.getByLabelText("Amount ₱"), "1,708.64")
  fireEvent.press(screen.getByText("Paid"))
  const r = finStore
    .get()
    .records.find((x) => x.id === derivedId("planned-record", p.id, day))
  expect(r).toMatchObject({
    amount: 1708.64,
    plannedId: p.id,
    plannedOn: day,
    source: "planned",
  })
  expect(finStore.get().records).toHaveLength(count + 1)
})

test("the category picker lists each sub-category under its own parent", () => {
  // The order the store happens to hold them in put Mobile plan first.
  finStore.set((s) => ({
    ...s,
    categories: [
      ...s.categories.filter((c) => c.id === "phone"),
      ...s.categories.filter((c) => c.id !== "phone"),
    ],
  }))
  render(<RecordEditor open onClose={() => {}} />, { wrapper })
  fireEvent.press(screen.getByLabelText("Choose category"))
  const names = screen
    .getAllByRole("button")
    .map((b) => b.props.accessibilityLabel as string | undefined)
    .filter((l): l is string => !!l)
  const bills = names.indexOf("Bills"),
    phone = names.indexOf("Mobile plan, under Bills")
  expect(bills).toBeGreaterThan(-1)
  expect(phone).toBeGreaterThan(bills)
})

test("a sub-category added from the picker is chosen for the transaction", () => {
  render(<RecordEditor open onClose={() => {}} />, { wrapper })
  fireEvent.press(screen.getByLabelText("Choose category"))
  fireEvent.press(screen.getByText("New sub-category"))
  fireEvent.changeText(screen.getByLabelText("Name"), "Pet food")
  fireEvent.press(screen.getByText("Save"))
  const added = finStore.get().categories.find((c) => c.name === "Pet food")
  expect(added?.parentId).toBeTruthy()
  expect(added?.kind).toBe("expense")
  // Back on the transaction, with the new sub-category picked.
  expect(screen.getByText(`${added?.icon} Pet food`)).toBeTruthy()
})

test("setup keeps the centavos of a salary and a balance", () => {
  finStore.set((s) => ({ ...s, accounts: [], planned: [] }))
  render(<FinanceSetup embedded onDone={() => {}} />, { wrapper })
  fireEvent.changeText(screen.getByLabelText("Cash balance"), "158.82")
  fireEvent.changeText(
    screen.getByLabelText("Salary per payday ₱ (15th & 30th)"),
    "27500.50",
  )
  fireEvent.press(screen.getByText(/^Add \d accounts$/))
  const s = finStore.get()
  expect(s.accounts.find((a) => a.name === "Cash")?.opening).toBe(158.82)
  expect(s.planned.find((p) => p.name === "Salary")?.amount).toBe(27500.5)
})

test("an account with no colour of its own gets a steady brand colour", () => {
  const a = { id: "acct-1", color: "fin" }
  expect(accountColorKey(a)).toMatch(
    /^acct-(blue|emerald|violet|orange|cyan|rose|green|red|slate)$/,
  )
  expect(accountColorKey(a)).toBe(accountColorKey({ ...a }))
  expect(accountColorKey({ id: "x", color: "var(--acct-rose)" })).toBe(
    "acct-rose",
  )
  expect(accountColorKey({ id: "x", color: "#1e88e5" })).toBe("#1e88e5")
})

test("an account card shows a balance's centavos", () => {
  const account = {
    ...finStore.get().accounts[0],
    name: "BPI",
    type: "bank" as const,
  }
  render(<AccountCard account={account} balance={1708.64} />, {
    wrapper,
  })
  expect(screen.getByText("₱1,708.64")).toBeTruthy()
})

test("a scheduled payment's chip names what is missing", () => {
  const accounts = [
      { id: "a", name: "Maya Black" },
      { id: "old", name: "Old wallet", archived: true },
    ],
    categories = [{ id: "bills", name: "Bills" }],
    base = finStore.get().planned[0]
  const where = (extra: object) =>
    plannedWhere({ ...base, ...extra }, accounts, categories)
  expect(where({ type: "expense", accountId: "a", categoryId: "gone" })).toBe(
    "Maya Black · No category",
  )
  expect(where({ type: "expense", accountId: "a", categoryId: "bills" })).toBe(
    "Maya Black · Bills",
  )
  // An archived destination is as good as gone; never "?" or "undefined".
  expect(where({ type: "transfer", accountId: "a", toAccountId: "old" })).toBe(
    "Maya Black → No account",
  )
})
