// Account cards: filled with the account's colour (darkened so white text
// stays readable), with what the balance means and how fresh it is.
import type { Account } from "@domain/finance/data"
import { finStore } from "@domain/finance/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { render, screen } from "@testing-library/react-native"

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
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
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
}))
jest.mock("expo-audio", () => ({}))
jest.mock("../media", () => ({ exportCsv: jest.fn(), pickPhoto: jest.fn() }))

const { AccountCard, shade } =
  require("../screens/finance-account-card") as typeof import("../screens/finance-account-card")

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
})

const account = (extra: Partial<Account>): Account => ({
  ...finStore.get().accounts[0],
  lastReconciled: undefined,
  manual: false,
  ...extra,
})

test("shade darkens toward black and leaves other colours alone", () => {
  expect(shade("#00bc7c", 0.5)).toBe("#005e3e")
  expect(shade("#ffffff", 0)).toBe("#ffffff")
  expect(shade("rebeccapurple", 0.3)).toBe("rebeccapurple")
})

test("a credit card says what is owed and how much of the limit is used", () => {
  render(
    <AccountCard
      account={account({ name: "Maya Black", type: "credit", limit: 50000 })}
      balance={-20000}
      nudgeDays={14}
    />,
  )
  expect(screen.getByText("Maya Black")).toBeTruthy()
  expect(screen.getByText("CREDIT CARD")).toBeTruthy()
  expect(screen.getByText("owed")).toBeTruthy()
  expect(screen.getByText("40% of limit used")).toBeTruthy()
})

test("an everyday account shows what is available and when it was matched", () => {
  render(
    <AccountCard
      account={account({ name: "GCash", type: "ewallet" })}
      balance={2500}
      nudgeDays={14}
    />,
  )
  expect(screen.getByText("available")).toBeTruthy()
  expect(screen.getByText("Not matched yet")).toBeTruthy()
  expect(
    screen.getByLabelText(/GCash, E-wallet, ₱2,500\. Not matched yet/),
  ).toBeTruthy()
})
