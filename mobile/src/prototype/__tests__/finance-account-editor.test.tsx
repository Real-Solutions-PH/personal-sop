// Editing an account's balance sets it to the amount typed: an account with
// history gets an adjustment record for the difference (its past stays
// true); one with no history just gets a new opening balance.
import { balanceOf } from "@domain/finance/calc"
import type { Account, FinRecord } from "@domain/finance/data"
import { finStore } from "@domain/finance/store"
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

const { AccountEditor } =
  require("../screens/finance-account-editor") as typeof import("../screens/finance-account-editor")

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

const acct = (extra: Partial<Account> = {}): Account => ({
  id: "acc",
  name: "GoTyme",
  type: "bank",
  opening: 1_000,
  openingDate: "2026-10-01",
  color: "var(--acct-blue)",
  inNetWorth: true,
  inProjection: true,
  archived: false,
  order: 0,
  ...extra,
})
const rec = (id: string, type: "income" | "expense", amount: number) =>
  ({
    id,
    type,
    amount,
    accountId: "acc",
    at: "2026-10-15T12:00:00",
    source: "manual",
    status: "cleared",
  }) as FinRecord

const seed = (a: Account, records: FinRecord[]) =>
  finStore.set((s) => ({ ...s, accounts: [a], records }))
const current = () => finStore.get().accounts.find((a) => a.id === "acc")!
const edit = (typed?: string) => {
  render(<AccountEditor account={current()} open onClose={() => {}} />, {
    wrapper,
  })
  if (typed !== undefined)
    fireEvent.changeText(screen.getByLabelText(/balance/i), typed)
  fireEvent.press(screen.getByText("Save"))
}

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
})

test("an account with history shows its balance now, and the typed amount becomes it", () => {
  // Opened at 1,000, then +500 and -200: 1,300 today.
  seed(acct(), [rec("r1", "income", 500), rec("r2", "expense", 200)])
  render(<AccountEditor account={current()} open onClose={() => {}} />, {
    wrapper,
  })
  expect(screen.getByLabelText(/balance/i).props.value).toBe("1,300")
  fireEvent.changeText(screen.getByLabelText(/balance/i), "2000")
  fireEvent.press(screen.getByText("Save"))
  const s = finStore.get()
  expect(balanceOf(s, current())).toBe(2_000)
  // The opening balance and the history are untouched; one adjustment
  // record carries the difference.
  expect(current().opening).toBe(1_000)
  const adj = s.records.filter((r) => r.isAdjustment)
  expect(adj).toHaveLength(1)
  expect(adj[0]).toMatchObject({ type: "income", amount: 700 })
})

test("a lower balance is recorded as an adjustment out", () => {
  seed(acct(), [rec("r1", "income", 500)])
  edit("1200.25")
  expect(balanceOf(finStore.get(), current())).toBe(1_200.25)
  const adj = finStore.get().records.filter((r) => r.isAdjustment)
  expect(adj).toEqual([
    expect.objectContaining({ type: "expense", amount: 299.75 }),
  ])
})

test("saving without changing the balance records nothing", () => {
  seed(acct(), [rec("r1", "income", 500)])
  edit()
  expect(finStore.get().records).toHaveLength(1)
  expect(balanceOf(finStore.get(), current())).toBe(1_500)
})

test("an account with no history takes the amount as its opening balance", () => {
  seed(acct(), [])
  edit("4500")
  expect(current().opening).toBe(4_500)
  expect(finStore.get().records).toHaveLength(0)
})

test("a card's balance owed is typed positive and becomes the debt", () => {
  seed(acct({ type: "credit", opening: -1_000, inProjection: false }), [
    rec("r1", "expense", 500),
  ])
  render(<AccountEditor account={current()} open onClose={() => {}} />, {
    wrapper,
  })
  expect(screen.getByLabelText(/balance owed/i).props.value).toBe("1,500")
  fireEvent.changeText(screen.getByLabelText(/balance owed/i), "3000")
  fireEvent.press(screen.getByText("Save"))
  expect(balanceOf(finStore.get(), current())).toBe(-3_000)
  expect(current().opening).toBe(-1_000)
})

test("an overpaid card saved untouched keeps its credit and records nothing", () => {
  // Owed 1,000, then paid 1,200: the bank owes the person 200.
  seed(acct({ type: "credit", opening: -1_000, inProjection: false }), [
    rec("r1", "income", 1_200),
  ])
  render(<AccountEditor account={current()} open onClose={() => {}} />, {
    wrapper,
  })
  expect(screen.getByLabelText(/balance owed/i).props.value).toBe("-200")
  fireEvent.press(screen.getByText("Save"))
  expect(finStore.get().records).toHaveLength(1)
  expect(balanceOf(finStore.get(), current())).toBe(200)
})

test("switching a card to another type keeps the balance, not the number", () => {
  // Owes 1,500: as a bank account that is a balance of −1,500.
  seed(acct({ type: "credit", opening: -1_000, inProjection: false }), [
    rec("r1", "expense", 500),
  ])
  render(<AccountEditor account={current()} open onClose={() => {}} />, {
    wrapper,
  })
  expect(screen.getByLabelText(/balance owed/i).props.value).toBe("1,500")
  fireEvent.press(screen.getByText("Bank"))
  expect(screen.getByLabelText(/balance now/i).props.value).toBe("-1,500")
  fireEvent.press(screen.getByText("Credit card"))
  expect(screen.getByLabelText(/balance owed/i).props.value).toBe("1,500")
  fireEvent.press(screen.getByText("Bank"))
  fireEvent.press(screen.getByText("Save"))
  // Reclassified, same money: no adjustment.
  expect(finStore.get().records).toHaveLength(1)
  expect(current().type).toBe("bank")
  expect(balanceOf(finStore.get(), current())).toBe(-1_500)
})
