// Nutrition as its own module (ADR-0024): its own area, metrics and ring,
// training-only Fitness, old saved state brought forward, and the Nutrition
// page and food library rendering.

import { seed as dashSeed } from "@domain/dash/data"
import { upgradeDash } from "@domain/dash/store"
import { module as FIT } from "@domain/fitness"
import * as C from "@domain/fitness/calc"
import { fitStore } from "@domain/fitness/store"
import { dayKey, dayOffset } from "@domain/lib/day"
import { configureStorage, createStore, resetAll } from "@domain/lib/store"
import { modules } from "@domain/modules"
import { module as NUT } from "@domain/nutrition"
import {
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react-native"
import { router } from "expo-router"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { FoodLibrary } from "../screens/nutrition-foods"
import { NutritionHome } from "../screens/nutrition-home"
import { ManualMeal } from "../screens/nutrition-meals"
import { NutritionTrend } from "../screens/nutrition-trend"

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
  interpolate: (_: number, __: number[], output: number[]) => output[0],
  runOnJS: (fn: unknown) => fn,
  useReducedMotion: () => true,
}))
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
}))
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
  usePathname: () => "/nutrition",
  useFocusEffect: () => {},
  Redirect: () => null,
}))

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
}
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
)

const target = {
  id: "t1",
  effectiveFrom: "2020-01-01",
  kcal: 2000,
  protein: 140,
  carbs: 220,
  fat: 60,
}
const meal = (id: string, day: string, kcal: number, protein: number) => ({
  id,
  eatenAt: new Date(`${day}T12:00:00`).toISOString(),
  label: "lunch" as const,
  source: "text" as const,
  rawInput: "adobo",
  status: "confirmed" as const,
  items: [
    {
      id: `${id}-i`,
      name: "Adobo",
      qty: 1,
      unit: "plate",
      kcal,
      protein,
      carbs: 200,
      fat: 60,
    },
  ],
})

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
})

test("Nutrition is a module of its own, after Fitness", () => {
  expect(modules.map((m) => m.key)).toEqual([
    "habits",
    "tasks",
    "fitness",
    "nutrition",
    "focus",
    "finance",
  ])
  expect(NUT.href).toBe("/nutrition")
})

test("nothing logged leaves Nutrition out of the Life Score", () => {
  fitStore.set((s) => ({ ...s, targets: [target], meals: [] }))
  expect(renderHook(() => NUT.useAreaRate(14)).result.current).toBeNull()
})

test("the Nutrition rate averages calories on target and protein hit", () => {
  // Two closed days: one on target with protein hit (2,000 kcal, 140 g), one
  // over calories with protein short (2,600 kcal, 60 g). By hand: calories
  // 1 of 2, protein 1 of 2, so (0.5 + 0.5) / 2 = 0.5.
  fitStore.set((s) => ({
    ...s,
    targets: [target],
    meals: [
      meal("a", dayOffset(-1), 2000, 140),
      meal("b", dayOffset(-2), 2600, 60),
    ],
  }))
  expect(renderHook(() => NUT.useAreaRate(7)).result.current).toBe(0.5)
  const m = renderHook(() => NUT.useMetrics(7)).result.current
  expect(m.map((x) => x.key)).toEqual(["calories", "protein", "kcal", "logged"])
  expect(m.find((x) => x.key === "kcal")?.value).toBe("2,300 kcal")
  expect(m.find((x) => x.key === "logged")?.value).toBe("2")
  const misses = renderHook(() => NUT.useMisses(dayOffset(-7), dayKey())).result
    .current
  expect(misses).toEqual([
    {
      id: `nut-over-${dayOffset(-2)}`,
      day: dayOffset(-2),
      title: "Over calories by 30%",
      module: "nutrition",
      href: `/nutrition?day=${dayOffset(-2)}`,
    },
  ])
})

test("Fitness counts training only", () => {
  fitStore.set((s) => ({
    ...s,
    targets: [target],
    meals: [meal("b", dayOffset(-2), 2600, 60)],
  }))
  const s = fitStore.get()
  expect(renderHook(() => FIT.useAreaRate(14)).result.current).toBe(
    C.periodSummary(s, 14).sessionRate,
  )
  const keys = renderHook(() => FIT.useMetrics(14)).result.current.map(
    (x) => x.key,
  )
  expect(keys).not.toContain("protein")
  expect(keys).not.toContain("calories")
  const misses = renderHook(() => FIT.useMisses(dayOffset(-30), dayKey()))
    .result.current
  expect(misses.some((x) => x.title.startsWith("Over calories"))).toBe(false)
})

test("the protein target is Nutrition's ring item, not Fitness's", () => {
  fitStore.set((s) => ({
    ...s,
    targets: [target],
    meals: [meal("t", dayKey(), 1500, 150)],
  }))
  expect(renderHook(() => NUT.useTodayProgress()).result.current).toEqual({
    due: 1,
    done: 1,
  })
  fitStore.set((s) => ({ ...s, targets: [] }))
  expect(renderHook(() => NUT.useTodayProgress()).result.current).toEqual({
    due: 0,
    done: 0,
  })
})

describe("state saved before the split", () => {
  const old = () => {
    const s = dashSeed()
    const { nutrition: _e, ...enabled } = s.enabled
    const { nutrition: _w, ...weights } = s.weights
    return {
      ...s,
      enabled: { ...enabled, fitness: false },
      weights,
      goals: [
        { ...s.goals[0], id: "g-protein", metric: "fitness:protein" },
        { ...s.goals[0], id: "g-sessions", metric: "fitness:sessions" },
      ],
    } as unknown as ReturnType<typeof dashSeed>
  }

  test("Nutrition's switch follows Fitness's, at the default weight", () => {
    const up = upgradeDash(old())
    expect(up.enabled.nutrition).toBe(false)
    expect(up.weights.nutrition).toBe(2)
    expect(up.goals.map((g) => g.metric)).toEqual([
      "nutrition:protein",
      "fitness:sessions",
    ])
  })

  test("current state passes through untouched", () => {
    const s = dashSeed()
    expect(upgradeDash(s)).toBe(s)
  })

  test("a store applies the upgrade to what it loads", () => {
    const saved = JSON.stringify(old())
    configureStorage({
      getItem: (k) => (k === "sop-proto:dash-upgrade-test" ? saved : null),
      setItem: () => {},
      removeItem: () => {},
    })
    const store = createStore("dash-upgrade-test", dashSeed, {
      upgrade: upgradeDash,
    })
    expect(store.get().enabled.nutrition).toBe(false)
    expect(store.get().goals[0].metric).toBe("nutrition:protein")
  })
})

test("the Nutrition page holds the day, the stats and the links", () => {
  fitStore.set((s) => ({
    ...s,
    targets: [target],
    meals: [meal("a", dayOffset(-1), 2000, 140)],
  }))
  render(<NutritionHome />, { wrapper })
  expect(screen.getByText("Nutrition")).toBeTruthy()
  expect(screen.getByText("CALORIES BY MACRO")).toBeTruthy()
  expect(screen.getByText("Average calories")).toBeTruthy()
  expect(screen.getByText("Meal history")).toBeTruthy()
  expect(screen.getByText("Food library")).toBeTruthy()
})

test("with nothing logged the stats show dimmed, under one card", () => {
  fitStore.set((s) => ({ ...s, targets: [target], meals: [] }))
  render(<NutritionHome />, { wrapper })
  expect(screen.getByText("Your nutrition stats start here")).toBeTruthy()
  // The real tiles stay on the page, dimmed.
  expect(
    screen.getByText("Calories on target", { includeHiddenElements: true }),
  ).toBeTruthy()
})

test("the empty goal history's Log a meal opens the meal form", () => {
  // The card sits on /nutrition itself, so linking back there did nothing.
  fitStore.set((s) => ({ ...s, targets: [target], meals: [] }))
  render(<NutritionTrend />, { wrapper })
  fireEvent.press(screen.getByText("Log a meal"))
  expect(router.push).toHaveBeenCalledWith("/nutrition/new")
})

test("Log meal offers the barcode scanner", () => {
  render(<ManualMeal />, { wrapper })
  fireEvent.press(screen.getByLabelText("Scan"))
  expect(router.push).toHaveBeenCalledWith(`/nutrition/scan?day=${dayKey()}`)
})

test("a meal saved as a recipe logs again as one serving", () => {
  fitStore.set((s) => ({ ...s, targets: [target], meals: [], recipes: [] }))
  render(<ManualMeal />, { wrapper })
  // Coffee 5 kcal + milk 60 kcal, entered as custom items.
  for (const [name, kcal] of [
    ["Black coffee 7g", "5"],
    ["Milk 100g", "60"],
  ]) {
    fireEvent.changeText(screen.getByLabelText("Custom item name"), name)
    fireEvent.changeText(screen.getAllByLabelText("kcal")[0], kcal)
    fireEvent.press(screen.getByText("Add custom item"))
  }
  fireEvent.changeText(screen.getByLabelText("Recipe name"), "Iced coffee")
  fireEvent.press(screen.getByText("Save recipe"))
  const [recipe] = fitStore.get().recipes
  expect(recipe.name).toBe("Iced coffee")
  expect(recipe.items.map((i) => i.name)).toEqual([
    "Black coffee 7g",
    "Milk 100g",
  ])

  fireEvent.press(screen.getByLabelText("Add Iced coffee"))
  expect(screen.getByText("Save meal · 130 kcal")).toBeTruthy()
})

test("the food library lists the built-in foods offline", () => {
  render(<FoodLibrary />, { wrapper })
  expect(screen.getByText("Food library")).toBeTruthy()
  expect(screen.getByText("BUILT-IN FOODS")).toBeTruthy()
  expect(screen.getByText("Garlic rice (sinangag)")).toBeTruthy()
})

test("steppers group thousands and still read what was typed", () => {
  const { grouped, parseAmount } = require("../fitness-controls")
  expect(grouped(2100)).toBe("2,100")
  expect(grouped(102.5)).toBe("102.5")
  expect(parseAmount("2,100")).toBe(2100)
  expect(parseAmount("12,000,5")).toBe(12000.5)
  expect(parseAmount("2,5")).toBe(2.5)
  expect(parseAmount("72.5")).toBe(72.5)
})
