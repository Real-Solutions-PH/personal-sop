// The macro share cards: the Nutrition page's Day / 7 days / 30 days views
// and its "Calories by macro" chart with fiber as a fourth target line.
// Each renders in every size and background, normal and long values, with
// the share-card anatomy (no accent bar, the flat lockup, the motif except
// on a photo or sticker); the data builders read the page's own numbers.

import type { FitnessState, Meal } from "@domain/fitness/data"
import { dayKey, dayOffset } from "@domain/lib/day"
import { configureStorage, resetAll } from "@domain/lib/store"
import { render } from "@testing-library/react-native"
import type { ReactElement, ReactNode } from "react"
import { StyleSheet, Text } from "react-native"
import {
  MacroCard,
  type MacroCardData,
  macroData,
  StackCard,
  type StackCardData,
  stackData,
  windowOf,
} from "../screens/nutrition-share"
import type { CardBackdrop, CardFormat, CardLook } from "../share-kit"

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
jest.mock("react-native-gesture-handler", () => {
  const chain: object = new Proxy({}, { get: () => () => chain })
  return {
    Gesture: new Proxy({}, { get: () => () => chain }),
    GestureDetector: ({ children }: { children: ReactNode }) => children,
    ScrollView: require("react-native").ScrollView,
  }
})
jest.mock("react-native-view-shot", () => ({ captureRef: jest.fn() }))
jest.mock("expo-sharing", () => ({
  isAvailableAsync: jest.fn(),
  shareAsync: jest.fn(),
}))
jest.mock("../media", () => ({ copyText: jest.fn(), pickPhoto: jest.fn() }))

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
})

const FORMATS: CardFormat[] = ["9:16", "4:5", "1:1"]
const BACKDROPS: CardBackdrop[] = ["photo", "fern", "dark", "light", "sticker"]

function macros(long: boolean, period: "1" | "7" | "30"): MacroCardData {
  const k = long ? 1000 : 1
  return {
    period,
    window: period === "1" ? "Sun 8 Nov" : "2–8 Nov",
    days: period === "1" ? 1 : long ? 29 : 5,
    totals: { kcal: 1840 * k, protein: 120 * k, carbs: 210 * k, fat: 70 * k },
    target: { kcal: 2000, protein: 140, carbs: 220, fat: 60 },
    fiber: { value: long ? 25000 : 18, goal: 25 },
    limits: [
      { key: "satFat", amount: 17 * k, limit: 13 },
      { key: "sugar", amount: 20, limit: 26 },
      { key: "sodium", amount: 2450 * k, limit: 2000 },
    ],
    kcalDays: { hit: 3, judged: long ? 29 : 5 },
    proteinDays: { hit: 2, judged: long ? 29 : 5 },
    amounts: long,
  }
}

function stack(long: boolean, n: number): StackCardData {
  const k = long ? 1000 : 1
  return {
    period: n === 30 ? "30" : "7",
    window: "2–8 Nov",
    days: Array.from({ length: n }, (_, i) => ({
      day: dayOffset(i - n + 1),
      parts: i % 4 === 0 ? [0, 0, 0, 0] : [480 * k, 700, 80, 600],
    })),
    lines: [
      { key: "protein", at: 560 },
      { key: "carbs", at: 1340 },
      { key: "fiber", at: 1440 },
      { key: "fat", at: 2000 },
    ],
    kcal: 2000,
    split: { protein: 0.26, carbs: 0.43, fat: 0.31 },
    avgKcal: long ? 1_840_000 : 1840,
    kcalDays: { hit: 3, judged: 6 },
    amounts: long,
  }
}

type Make = (look: CardLook, long: boolean) => ReactElement
const CARDS: [string, Make][] = [
  ...(["1", "7", "30"] as const).map((p): [string, Make] => [
    `macros ${p}`,
    (look, long) => (
      <MacroCard width={300} look={look} data={macros(long, p)} />
    ),
  ]),
  ...[7, 30].map((n): [string, Make] => [
    `calories by macro ${n}`,
    (look, long) => <StackCard width={300} look={look} data={stack(long, n)} />,
  ]),
]

const nested = (t: { parent: unknown }) => {
  let p = t.parent as { type?: unknown; parent?: unknown } | null
  while (p) {
    if (p.type === Text || p.type === "Text") return true
    p = p.parent as typeof p
  }
  return false
}

describe.each(CARDS)("%s card", (_, make) => {
  test.each(
    FORMATS.flatMap((f) => BACKDROPS.map((b) => [f, b] as const)),
  )("renders %s on %s with normal and long values", (format, backdrop) => {
    for (const long of [false, true]) {
      const look = { format, backdrop, photo: null }
      const r = render(make(look, long))
      const text = r.UNSAFE_getAllByType(Text)
      const words = text.map((t) => [t.props.children].flat(Infinity).join(""))
      expect(words.join(" ")).not.toMatch(/\d{5,}/)
      for (const t of text)
        if (t.props.numberOfLines === undefined) expect(nested(t)).toBe(true)
      for (const t of text) {
        if (nested(t)) continue
        const s = StyleSheet.flatten(t.props.style)
        if (s.lineHeight !== undefined)
          expect(s.lineHeight).toBeGreaterThanOrEqual(s.fontSize * 1.1 - 0.01)
      }
      expect(r.queryAllByTestId("card-accent")).toHaveLength(0)
      expect(r.getAllByTestId("card-lockup")).toHaveLength(1)
      expect(r.queryAllByTestId("card-deco")).toHaveLength(
        backdrop === "sticker" || backdrop === "photo" ? 0 : 1,
      )
      r.unmount()
    }
  })
})

test("percent of goal until amounts are turned on", () => {
  const look: CardLook = { format: "9:16", backdrop: "dark", photo: null }
  const off = render(
    <MacroCard width={300} look={look} data={macros(false, "1")} />,
  )
  // 1,840 of 2,000 kcal; protein 120 of 140 g is 86%.
  expect(off.getByText("92")).toBeTruthy()
  expect(off.getByText("86%")).toBeTruthy()
  expect(off.getByText("131% of limit")).toBeTruthy()
  expect(off.queryByText(/kcal/)).toBeNull()
  off.unmount()
  const on = render(
    <MacroCard
      width={300}
      look={look}
      data={{ ...macros(false, "1"), amounts: true }}
    />,
  )
  expect(on.getByText("160")).toBeTruthy()
  expect(on.getByText("120 g")).toBeTruthy()
  expect(on.getByText("2,450 / 2,000 mg")).toBeTruthy()
})

test("the chart names its four target lines", () => {
  const look: CardLook = { format: "4:5", backdrop: "fern", photo: null }
  const r = render(<StackCard width={300} look={look} data={stack(false, 7)} />)
  const svg = JSON.stringify(r.toJSON())
  for (const name of ["Protein", "Carbs", "Fiber", "Fat"])
    expect(svg).toContain(`"${name}"`)
})

describe("data", () => {
  const target = {
    id: "t",
    effectiveFrom: "2020-01-01",
    kcal: 2000,
    protein: 140,
    carbs: 220,
    fat: 60,
  }
  const meal = (
    id: string,
    day: string,
    m: { protein: number; carbs: number; fat: number; fiber?: number },
  ): Meal => ({
    id,
    eatenAt: new Date(`${day}T12:00:00`).toISOString(),
    label: "lunch",
    source: "manual",
    rawInput: "",
    status: "confirmed",
    items: [
      {
        id: `${id}-i`,
        name: "Food",
        qty: 1,
        unit: "plate",
        kcal: m.protein * 4 + m.carbs * 4 + m.fat * 9,
        ...m,
      },
    ],
  })
  const state = (meals: Meal[]) =>
    ({
      ...require("@domain/fitness/store").fitStore.get(),
      targets: [target],
      adjustments: [],
      meals,
    }) as FitnessState

  test("the stack carves fiber out of carbs, so the bar keeps its height", () => {
    // Yesterday: protein 100 g (400 kcal), carbs 200 g of which fiber 30 g
    // (680 + 120 kcal), fat 50 g (450 kcal).
    const s = state([
      meal("a", dayOffset(-1), {
        protein: 100,
        carbs: 200,
        fat: 50,
        fiber: 30,
      }),
    ])
    const d = stackData(s, dayKey(), "7", false)
    expect(d.days).toHaveLength(7)
    expect(d.days.at(-2)?.parts).toEqual([400, 680, 120, 450])
    // Targets 140/220/60 make 560 + 880 + 540 = 1,980 kcal, within 5% of
    // 2,000: four lines, fiber's 25 g default carved from carbs' 880 kcal.
    expect(d.lines).toEqual([
      { key: "protein", at: 560 },
      { key: "carbs", at: 1340 },
      { key: "fiber", at: 1440 },
      { key: "fat", at: 1980 },
    ])
    // A day reads the 7 days to it, as the page does.
    expect(stackData(s, dayKey(), "1", false).days).toHaveLength(7)
    expect(stackData(s, dayKey(), "30", false).days).toHaveLength(30)
  })

  test("targets that don't make the calorie target keep one calorie line", () => {
    const s = {
      ...state([]),
      targets: [{ ...target, kcal: 3000 }],
    } as FitnessState
    const d = stackData(s, dayKey(), "7", false)
    expect(d.lines).toEqual([])
    expect(d.kcal).toBe(3000)
  })

  test("macros average the settled logged days of the period", () => {
    // Two settled days and today; today never counts in a range.
    const s = state([
      meal("a", dayOffset(-1), { protein: 100, carbs: 200, fat: 50 }),
      meal("b", dayOffset(-2), { protein: 140, carbs: 240, fat: 70 }),
      meal("c", dayKey(), { protein: 10, carbs: 10, fat: 10 }),
    ])
    const week = macroData(s, dayKey(), "7", false)
    expect(week.days).toBe(2)
    expect(week.totals.protein).toBe(120)
    expect(week.totals.carbs).toBe(220)
    const today = macroData(s, dayKey(), "1", false)
    expect(today.days).toBe(1)
    expect(today.totals.protein).toBe(10)
  })

  test("the window says the days it covers", () => {
    expect(windowOf("2026-11-08", 7)).toBe("2–8 Nov")
    expect(windowOf("2026-11-08", 30)).toBe("10 Oct – 8 Nov")
    expect(windowOf("2026-11-08", 1)).toBe("Sun 8 Nov")
  })
})
