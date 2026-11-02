// Non-money numbers read with at most one decimal, no trailing ".0" and
// thousands separators, whichever formatter draws them. The Focus delta used
// to show minutes as seconds / 60 unrounded ("613.0166666666667").

import * as A from "@domain/focus/actions"
import { DEFAULT_SETTINGS } from "@domain/focus/data"
import { focusStore } from "@domain/focus/store"
import { absNum, num, signedNum } from "@domain/lib/num"
import { configureStorage, resetAll } from "@domain/lib/store"
import { render, screen } from "@testing-library/react-native"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { MetricDetail } from "../screens/dash-metric"
import { compact, fmt, group, pct, signed } from "../share-format"

jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  ...require("./reanimated-extras").extras,
  default: require("react-native").Animated,
  useSharedValue: (value: unknown) =>
    require("react").useRef({ value }).current,
  useAnimatedStyle: (get: () => unknown) => get(),
  withSpring: (value: unknown) => value,
  withTiming: (value: unknown) => value,
  withDelay: (_: number, value: unknown) => value,
  withSequence: (...values: unknown[]) => values[values.length - 1],
  withRepeat: (value: unknown) => value,
  interpolate: (_: number, __: number[], output: number[]) => output[0],
  runOnJS: (fn: unknown) => fn,
  useReducedMotion: () => true,
}))
jest.mock("react-native-gesture-handler", () => {
  const chain: object = new Proxy({}, { get: () => () => chain })
  return {
    Gesture: new Proxy({}, { get: () => () => chain }),
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
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
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({ range: "7" }),
  usePathname: () => "/stats/metric",
  useFocusEffect: () => {},
  Redirect: () => null,
  Link: ({ children }: { children: React.ReactNode }) => children,
}))

// Long floats of the kind division by 60, 7 or 3 leaves behind.
const FLOATS = [
  613.0166666666667,
  0.1 + 0.2,
  1234567.891,
  -42.04999,
  99.95,
  1 / 3,
  2 / 3,
  60.000000001,
  -0.04,
  1e7 / 7,
]
// Grouped digits, then at most one decimal that is not zero.
const SHAPE = /^[+−]?\d{1,3}(,\d{3})*(\.[1-9])?$/

describe("num", () => {
  it.each(FLOATS)("draws %p with at most one decimal and grouping", (n) => {
    for (const s of [num(n), signedNum(n), absNum(n)]) expect(s).toMatch(SHAPE)
  })

  it("rounds to tenths and drops a trailing .0", () => {
    expect(num(613.0166666666667)).toBe("613")
    expect(num(1234567.891)).toBe("1,234,567.9")
    expect(num(0.1 + 0.2)).toBe("0.3")
    expect(num(-42.04999)).toBe("−42")
    expect(num(-0.04)).toBe("0")
    expect(num(Number.NaN)).toBe("—")
    expect(num(null)).toBe("—")
    expect(signedNum(1.25)).toBe("+1.3")
    expect(signedNum(-3)).toBe("−3")
    expect(signedNum(0.01)).toBe("0")
    expect(absNum(-613.0166666666667)).toBe("613")
  })
})

describe("share-card formatters", () => {
  it.each(FLOATS)("draw %p without a long float", (n) => {
    for (const s of [group(n), group(n, 1), fmt(n), compact(n), signed(n)])
      expect(s).not.toMatch(/\.\d{2,}/)
    expect(pct(n / 1e6)).not.toMatch(/\.\d/)
  })
})

describe("the Focus delta", () => {
  const T0 = new Date(2026, 9, 20, 9, 0, 0).getTime()

  beforeEach(() => {
    jest.useFakeTimers({ now: T0 })
    configureStorage({
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    })
    resetAll()
    focusStore.set({
      sessions: [],
      segments: [],
      settings: { ...DEFAULT_SETTINGS },
      settingsSaved: false,
    })
  })
  afterEach(() => jest.useRealTimers())

  it("shows whole minutes, not seconds / 60", () => {
    // 12 min 1 s focused today and nothing the week before: a change of
    // 721 / 60 = 12.0166… minutes.
    A.startFocus({ mode: "stopwatch" })
    jest.setSystemTime(T0 + 721_000)
    A.stopFocus()
    render(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 0, left: 0, right: 0, bottom: 0 },
        }}
      >
        <MetricDetail metric="focus:focused" />
      </SafeAreaProvider>,
    )
    expect(screen.getByText("↑ 12")).toBeTruthy()
    expect(screen.queryByText(/12\.0/)).toBeNull()
  })
})
