// The Transfer sheet: the From and To balances under their chips, and the
// 25% / 50% / Full chips that fill the amount from the From balance.

import { finStore } from "@domain/finance/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { fireEvent, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import {
  amountText,
  floorCents,
  overdraws,
  quickAmount,
} from "../transfer-amounts"

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
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
}))
jest.mock("expo-audio", () => ({}))
jest.mock("../media", () => ({ exportCsv: jest.fn(), pickPhoto: jest.fn() }))

const { RecordEditor } =
  require("../screens/finance") as typeof import("../screens/finance")

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 44, left: 0, right: 0, bottom: 34 },
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
)

describe("quick amounts", () => {
  test("shares of the balance round down to centavos", () => {
    expect(quickAmount(12345.67, 1)).toBe(12345.67)
    expect(quickAmount(12345.67, 0.5)).toBe(6172.83)
    expect(quickAmount(101.01, 0.25)).toBe(25.25)
    expect(floorCents(1.005)).toBe(1)
    expect(floorCents(0.1 + 0.2)).toBe(0.3)
  })
  test("Full leaves room for the fee; the shares are capped by it", () => {
    expect(quickAmount(1000, 1, 15)).toBe(985)
    expect(quickAmount(1000, 0.5, 15)).toBe(500)
    // A fee above half the balance caps 50% too.
    expect(quickAmount(100, 0.5, 60)).toBe(40)
  })
  test("nothing to offer for an empty, overdrawn or unknown balance", () => {
    expect(quickAmount(0, 1)).toBeNull()
    expect(quickAmount(-250, 0.5)).toBeNull()
    expect(quickAmount(undefined, 1)).toBeNull()
    expect(quickAmount(Number.NaN, 1)).toBeNull()
    expect(quickAmount(10, 1, 10)).toBeNull()
    expect(quickAmount(0.01, 0.25)).toBeNull()
  })
  test("overdraw counts the fee and ignores float noise", () => {
    expect(overdraws(1000, 985, 15)).toBe(false)
    expect(overdraws(1000, 985.01, 15)).toBe(true)
    expect(overdraws(0.3, 0.1 + 0.2)).toBe(false)
    expect(overdraws(undefined, 50)).toBe(false)
    expect(amountText(6172.83)).toBe("6172.83")
  })
})

describe("the Transfer sheet", () => {
  beforeEach(() => {
    configureStorage({
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    })
    resetAll()
    // Known balances: openings only, nothing recorded.
    const opening: Record<string, number> = {
      gcash: 12345.67,
      maya: 2500,
      cash: 0,
    }
    finStore.set((s) => ({
      ...s,
      records: [],
      accounts: s.accounts.map((a) => ({
        ...a,
        opening: opening[a.id] ?? 100,
      })),
    }))
  })
  const open = () =>
    render(
      <RecordEditor
        open
        onClose={() => {}}
        prefill={{ type: "transfer", accountId: "gcash", toAccountId: "maya" }}
      />,
      { wrapper },
    )

  test("shows the balance of the selected From and To accounts", () => {
    open()
    expect(screen.getByText("GCash balance: ₱12,345.67")).toBeTruthy()
    expect(screen.getByText("Maya balance: ₱2,500")).toBeTruthy()
    // Picking another From account shows its balance instead.
    fireEvent.press(screen.getAllByText("BPI Savings")[0])
    expect(screen.getByText("BPI Savings balance: ₱100")).toBeTruthy()
    expect(screen.queryByText("GCash balance: ₱12,345.67")).toBeNull()
  })

  test("50% and Full fill the amount; Full leaves room for the fee", () => {
    open()
    const amount = screen.getByLabelText("Amount ₱")
    fireEvent.press(screen.getByText("50%"))
    expect(amount.props.value).toBe("6,172.83")
    fireEvent.press(screen.getByText("Full"))
    expect(amount.props.value).toBe("12,345.67")
    fireEvent.changeText(screen.getByLabelText("Fee ₱ (optional)"), "15")
    fireEvent.press(screen.getByText("Full"))
    expect(amount.props.value).toBe("12,330.67")
    expect(screen.queryByText(/it will go below zero/)).toBeNull()
  })

  test("warns, without blocking, when amount and fee overdraw", () => {
    open()
    fireEvent.changeText(screen.getByLabelText("Amount ₱"), "12345.67")
    fireEvent.changeText(screen.getByLabelText("Fee ₱ (optional)"), "15")
    expect(
      screen.getByText(/fee is more than the ₱12,345.67 in GCash/),
    ).toBeTruthy()
    const count = finStore.get().records.length
    fireEvent.press(screen.getByText("Save"))
    // The transfer and its fee are both saved.
    expect(finStore.get().records.length).toBe(count + 2)
  })

  test("no quick chips for an account with nothing in it", () => {
    render(
      <RecordEditor
        open
        onClose={() => {}}
        prefill={{ type: "transfer", accountId: "cash", toAccountId: "maya" }}
      />,
      { wrapper },
    )
    expect(screen.getByText("Cash balance: ₱0")).toBeTruthy()
    expect(screen.queryByText("Full")).toBeNull()
    expect(screen.queryByText("50%")).toBeNull()
  })
})
