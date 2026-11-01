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
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
}))
jest.mock("expo-audio", () => ({}))
jest.mock("../media", () => ({ exportCsv: jest.fn(), pickPhoto: jest.fn() }))

const { AccountCard, accountColorKey, readableShade, shade } =
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
    />,
  )
  expect(screen.getByText("Maya Black")).toBeTruthy()
  expect(screen.getByText("CREDIT CARD")).toBeTruthy()
  expect(screen.getByText("owed")).toBeTruthy()
  expect(screen.getByText("40% of limit used")).toBeTruthy()
})

test("an everyday account shows what is available, never a statement nudge", () => {
  render(
    <AccountCard
      account={account({ name: "GCash", type: "ewallet" })}
      balance={2500}
    />,
  )
  expect(screen.getByText("available")).toBeTruthy()
  expect(screen.getByText("Kept up as you log")).toBeTruthy()
  expect(screen.queryByText(/match/i)).toBeNull()
  expect(
    screen.getByLabelText(/GCash, E-wallet, ₱2,500\. Kept up as you log/),
  ).toBeTruthy()
})

test("cash is kept up as you log", () => {
  render(
    <AccountCard
      account={account({ name: "Wallet", type: "cash" })}
      balance={800}
    />,
  )
  expect(screen.getByText("Kept up as you log")).toBeTruthy()
})

// The brand's account colours (shared/prototype/design/tokens.ts).
const TOKENS: Record<string, string> = {
  blue: "#175dfc",
  emerald: "#00bc7c",
  violet: "#7f22fe",
  orange: "#f54900",
  cyan: "#0092b9",
  rose: "#a50035",
  green: "#00a63d",
  red: "#c10003",
  slate: "#62748e",
}
// WCAG contrast of white on ``hex``, computed here rather than borrowed.
const whiteOn = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16)
  const lin = (v: number) =>
    v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4
  const l =
    0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
  return 1.05 / (l + 0.05)
}

test("every account colour is darkened just enough for white text", () => {
  for (const [name, hex] of Object.entries(TOKENS)) {
    const k = readableShade(hex)
    expect([name, whiteOn(shade(hex, k)) >= 4.5]).toEqual([name, true])
    // One step less would not be readable (the least darkening, not more).
    if (k > 0) expect(whiteOn(shade(hex, k - 0.02))).toBeLessThan(4.5)
  }
  for (const name of ["red", "rose", "violet"])
    expect(readableShade(TOKENS[name])).toBeLessThanOrEqual(0.1)
})

test("an account's colour: its token, its hex, else one from its id", () => {
  const key = (color: string, id = "a1") => accountColorKey({ id, color })
  expect(key("var(--acct-rose)")).toBe("acct-rose")
  expect(key("#123abc")).toBe("#123abc")
  // Unresolvable: the server default, nothing, an unknown token, a short hex.
  for (const bad of ["fin", "", "var(--acct-pink)", "#fff"])
    expect(key(bad)).toMatch(/^acct-[a-z]+$/)
  // The same account always gets the same colour; many accounts spread out.
  expect(key("fin", "x")).toBe(key("", "x"))
  const spread = new Set(
    Array.from({ length: 40 }, (_, i) => key("fin", `acct-${i}`)),
  )
  expect(spread.size).toBeGreaterThanOrEqual(6)
  for (const k of spread) expect(Object.keys(TOKENS)).toContain(k.slice(5))
})

test("a card with no colour of its own is filled with a real hex", () => {
  render(
    <AccountCard
      account={account({ name: "Legacy", type: "bank", color: "fin" })}
      balance={100}
    />,
  )
  const json = JSON.stringify(screen.toJSON())
  const bg = [...json.matchAll(/"backgroundColor":"([^"]+)"/g)].map((m) => m[1])
  expect(bg.length).toBeGreaterThan(0)
  expect(bg[0]).toMatch(/^#[0-9a-f]{6}$/)
})
