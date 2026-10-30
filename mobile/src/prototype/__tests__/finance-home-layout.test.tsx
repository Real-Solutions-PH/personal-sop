// The Finance home in one fixed order with no period switcher; the Reports
// screen with its periods plus a custom range; the projection with a custom
// From–To range alongside its months.
import { addDays } from "@domain/finance/calc"
import { finStore } from "@domain/finance/store"
import { dayKey } from "@domain/lib/day"
import { privacyStore } from "@domain/lib/privacy"
import { configureStorage, resetAll } from "@domain/lib/store"
import { fireEvent, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { toast } from "sonner-native"

let mockParams: Record<string, string> = {}
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
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
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

const { FinanceHome } =
  require("../screens/finance-home") as typeof import("../screens/finance-home")
const { Reports } =
  require("../screens/finance-reports") as typeof import("../screens/finance-reports")
const { Projection } =
  require("../screens/finance-projection") as typeof import("../screens/finance-projection")
const actions =
  require("@domain/finance/actions") as typeof import("@domain/finance/actions")

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
  mockParams = {}
  jest.clearAllMocks()
})
jest.setTimeout(30000)

/** Every rendered string, in render order. */
function texts(node: ReturnType<typeof screen.toJSON>): string[] {
  if (!node) return []
  if (Array.isArray(node)) return node.flatMap(texts)
  if (typeof node === "string") return [node]
  return (node.children ?? []).flatMap((c) =>
    texts(c as ReturnType<typeof screen.toJSON>),
  )
}
const allText = () => texts(screen.toJSON()).join("\n")
/** Picks a day in the date field with this label. */
function pickDay(label: string, day: string) {
  fireEvent.press(screen.getByRole("button", { name: label }))
  fireEvent.changeText(
    screen.getAllByLabelText("Date picker").slice(-1)[0],
    day,
  )
}

test("the home's sections come in the agreed order", () => {
  render(<FinanceHome />, { wrapper })
  const all = allText()
  const order = [
    "Net worth",
    "What if?",
    "BUDGETS",
    "CASH FLOW, ",
    "Savings projection",
    "Transactions",
    "Savings rate",
    "Spend by category",
    "Expected vs actual net worth",
    "Budget history",
    "Top payees",
    "Day-of-week spend",
    "RECENT",
  ]
  const at = order.map((x) => all.indexOf(x))
  expect(at.every((i) => i >= 0)).toBe(true)
  expect(at).toEqual([...at].sort((a, b) => a - b))
})

test("the home has no rest-of-month section, period switcher or accounts carousel", () => {
  render(<FinanceHome />, { wrapper })
  const all = allText()
  expect(all).not.toMatch(/REST OF/i)
  expect(all).not.toMatch(/Last month|3 months|Custom/)
  expect(all).not.toMatch(/ACCOUNTS\n/)
})

test("the category donut shows the top category's icon, never the word top", () => {
  render(<FinanceHome />, { wrapper })
  expect(screen.queryByText("top")).toBeNull()
  expect(screen.getByLabelText(/^Most spent on /)).toBeTruthy()
})

test("budgets show what is left, with a minus when over", () => {
  const view = render(<FinanceHome />, { wrapper })
  expect(screen.getByText("Left")).toBeTruthy()
  expect(allText()).not.toMatch(/−₱[\d,]+\nLeft\n/)
  view.unmount()
  finStore.set((x) => ({
    ...x,
    budgets: x.budgets.map((b) =>
      b.categoryIds === null ? { ...b, limit: 1 } : b,
    ),
  }))
  render(<FinanceHome />, { wrapper })
  expect(allText()).toMatch(/−₱[\d,]+\nLeft\n/)
})

test("with amounts hidden no peso figure shows on the home", () => {
  privacyStore.set(() => ({ hidden: true }))
  render(<FinanceHome />, { wrapper })
  expect(allText()).not.toMatch(/₱\s?\d/)
})

test("Reports keeps its periods and the income vs expense card", () => {
  render(<Reports />, { wrapper })
  for (const l of ["This month", "Last month", "3 months", "Custom"])
    expect(screen.getByText(l)).toBeTruthy()
  expect(screen.getByText("Income vs expense")).toBeTruthy()
})

test("a custom report range applies with a toast and travels in card links", () => {
  const { router } = require("expo-router")
  render(<Reports />, { wrapper })
  fireEvent.press(screen.getByText("Custom"))
  const t = dayKey()
  pickDay("From", addDays(t, -9))
  pickDay("To", t)
  fireEvent.press(screen.getByRole("button", { name: "Apply" }))
  expect(toast).toHaveBeenCalledWith(expect.stringMatching(/^Showing /))
  fireEvent.press(screen.getByRole("button", { name: "Spend by category" }))
  expect(router.push).toHaveBeenCalledWith(
    `/finance/reports/category?from=${addDays(t, -9)}&to=${t}`,
  )
})

test("a report range over 400 days is refused and the sheet stays open", () => {
  render(<Reports />, { wrapper })
  fireEvent.press(screen.getByText("Custom"))
  pickDay("From", addDays(dayKey(), -500))
  fireEvent.press(screen.getByRole("button", { name: "Apply" }))
  expect(toast.error).toHaveBeenCalledWith("Pick a range of up to 400 days")
  expect(screen.getByRole("button", { name: "Apply" })).toBeTruthy()
})

test("projection Custom opens on today to month end and quick chips move the end", () => {
  const spy = jest.spyOn(actions, "updateSettings")
  render(<Projection />, { wrapper })
  fireEvent.press(screen.getByText("Custom"))
  expect(spy).not.toHaveBeenCalled()
  expect(screen.getByRole("button", { name: "From" })).toBeTruthy()
  const before = allText().match(/Available money on\s+[^\n]+/)?.[0]
  fireEvent.press(screen.getByText("Next 90 days"))
  const after = allText().match(/Available money on\s+[^\n]+/)?.[0]
  expect(after).not.toBe(before)
  expect(screen.queryByText("What if I buy…")).toBeTruthy()
  expect(screen.queryByText("Plan a purchase")).toBeNull()
  fireEvent.press(screen.getByText("12 mo"))
  expect(spy).toHaveBeenCalledWith({ horizon: 12 })
})

test("an end date before the start is refused and the range stays", () => {
  const t = dayKey()
  mockParams = { from: addDays(t, 40), to: addDays(t, 60) }
  render(<Projection />, { wrapper })
  const before = allText().match(/Available money on\s+[^\n]+/)?.[0]
  expect(before).toBeTruthy()
  fireEvent.press(screen.getByText("End of month"))
  expect(toast.error).toHaveBeenCalledWith(
    "Pick an end date after the start date",
  )
  expect(allText().match(/Available money on\s+[^\n]+/)?.[0]).toBe(before)
})
