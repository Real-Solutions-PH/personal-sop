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
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
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
import { NutrientDetail } from "../screens/nutrition-nutrient"

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
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
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
// The app's providers hold a QueryClient: Log meal's Eat again card reads
// the food library through it (off outside live mode, so never fetched).
const queries = new QueryClient()
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>
    <QueryClientProvider client={queries}>{children}</QueryClientProvider>
  </SafeAreaProvider>
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
    "screen",
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

test("the Nutrition page holds the overview, the day's meals, the chart and the links once", () => {
  fitStore.set((s) => ({
    ...s,
    targets: [target],
    meals: [meal("a", dayOffset(-1), 2000, 140)],
  }))
  render(<NutritionHome />, { wrapper })
  expect(screen.getByText("Nutrition")).toBeTruthy()
  expect(screen.getByText("Today's meals")).toBeTruthy()
  expect(screen.getByText("Calories by macro")).toBeTruthy()
  // One set of links, at the bottom; no second stats section, filter,
  // activity card or floating re-log row.
  expect(screen.getAllByText("Meal history")).toHaveLength(1)
  expect(screen.getAllByText("Food library")).toHaveLength(1)
  expect(screen.queryByText("Stats")).toBeNull()
  expect(screen.queryByText("7d")).toBeNull()
  expect(screen.queryByText("Activity")).toBeNull()
  expect(screen.queryByText("QUICK RE-LOG")).toBeNull()
  expect(screen.queryByText("Quick re-log")).toBeNull()
})

test("every ring and limit opens its breakdown for the page's day and period", () => {
  fitStore.set((s) => ({
    ...s,
    targets: [target],
    meals: [meal("a", dayKey(), 900, 60)],
  }))
  render(<NutritionHome />, { wrapper })
  fireEvent.press(screen.getByLabelText(/^Protein: 60 of 140 g\./))
  expect(router.push).toHaveBeenLastCalledWith(
    `/nutrition/nutrient/protein?day=${dayKey()}&range=1`,
  )
  fireEvent.press(screen.getByLabelText(/^Calories: 900 of 2,000 kcal\./))
  expect(router.push).toHaveBeenLastCalledWith(
    `/nutrition/nutrient/kcal?day=${dayKey()}&range=1`,
  )
  fireEvent.press(screen.getByLabelText(/^Sodium: not tracked yet/))
  expect(router.push).toHaveBeenLastCalledWith(
    `/nutrition/nutrient/sodium?day=${dayKey()}&range=1`,
  )
  fireEvent.press(screen.getByLabelText(/^Fiber: /))
  expect(router.push).toHaveBeenLastCalledWith(
    `/nutrition/nutrient/fiber?day=${dayKey()}&range=1`,
  )
  // The page's one filter travels with the breakdown.
  fireEvent.press(screen.getByText("7 days"))
  fireEvent.press(screen.getByLabelText(/^Fat: .* a day on average\./))
  expect(router.push).toHaveBeenLastCalledWith(
    `/nutrition/nutrient/fat?day=${dayKey()}&range=7`,
  )
})

test("a period shows daily averages over its settled days", () => {
  // Two settled days, 2,000 and 2,600 kcal; today, still open, is left out
  // of the average: (2,000 + 2,600) / 2 = 2,300.
  fitStore.set((s) => ({
    ...s,
    targets: [target],
    meals: [
      meal("a", dayOffset(-1), 2000, 140),
      meal("b", dayOffset(-2), 2600, 60),
      meal("c", dayKey(), 500, 20),
    ],
  }))
  render(<NutritionHome range="7" />, { wrapper })
  expect(screen.getByText("A day on average, over 2 logged days")).toBeTruthy()
  expect(
    screen.getByLabelText(/^Calories: 2,300 of 2,000 kcal a day on average\./),
  ).toBeTruthy()
  expect(screen.getByText("Stay under · daily average")).toBeTruthy()
})

test("each macro's target is a dashed line on the calories chart", () => {
  fitStore.set((s) => ({
    ...s,
    targets: [target],
    meals: [
      meal("a", dayOffset(-1), 2000, 70),
      meal("b", dayOffset(-2), 2000, 140),
    ],
  }))
  render(<NutritionHome range="7" />, { wrapper })
  expect(
    screen.getByLabelText(
      /^Calories by macro, 7 days to .*; targets protein 140 g, carbs 220 g, fat 60 g$/,
    ),
  ).toBeTruthy()
  // Stacked as the bars are: protein 560 kcal, then carbs to 1,440, then
  // fat to 1,980 (2,000 kcal target, within 5%).
  for (const key of ["protein", "carbs", "fat"])
    expect(screen.getByTestId(`macro-target-${key}`)).toBeTruthy()
  // Each macro's grams against its target sit under the chart.
  expect(screen.getByText("avg 105 / 140 g")).toBeTruthy()
  expect(screen.getByText("hit on 1 of 2 days")).toBeTruthy()
  expect(
    screen.getByLabelText(
      /^Carbs: avg 200 \/ 220 g · within 10% on 2 of 2 days\./,
    ),
  ).toBeTruthy()
  expect(
    screen.getByLabelText(/^Fat: avg 60 \/ 60 g · within 10% on 2 of 2 days\./),
  ).toBeTruthy()
})

test("macro targets that don't make the calorie target keep one calorie line", () => {
  fitStore.set((s) => ({
    ...s,
    targets: [{ ...target, kcal: 2600 }],
    meals: [meal("a", dayOffset(-1), 2000, 140)],
  }))
  render(<NutritionHome />, { wrapper })
  expect(screen.queryByTestId("macro-target-protein")).toBeNull()
  expect(screen.getByTestId("kcal-target")).toBeTruthy()
})

test("with nothing logged the page keeps its real displays", () => {
  fitStore.set((s) => ({ ...s, targets: [target], meals: [] }))
  render(<NutritionHome />, { wrapper })
  // The chart stays on the page, dimmed, under one card.
  expect(
    screen.getByText("Where your calories come from starts here"),
  ).toBeTruthy()
  expect(
    screen.getByText("Calories by macro", { includeHiddenElements: true }),
  ).toBeTruthy()
  // Every slot is there, and logs straight into itself.
  fireEvent.press(screen.getByLabelText("Log dinner"))
  expect(router.push).toHaveBeenLastCalledWith(
    `/nutrition/new?day=${dayKey()}&label=dinner`,
  )
})

test("a nutrient's breakdown ranks foods and meals, by amount or per calorie", () => {
  const day = dayOffset(-1)
  const m = (
    id: string,
    label: "lunch" | "dinner",
    items: [string, number, number][],
  ) => ({
    ...meal(id, day, 0, 0),
    label,
    items: items.map(([name, kcal, protein], i) => ({
      id: `${id}-${i}`,
      name,
      qty: 1,
      unit: "serving",
      kcal,
      protein,
      carbs: 10,
      fat: 5,
    })),
  })
  fitStore.set((s) => ({
    ...s,
    targets: [target],
    meals: [
      // Lunch 60 g in 800 kcal (7.5 g per 100); dinner 40 g in 300 kcal
      // (13 g per 100, whole from 10 up): lunch gives the most, dinner the most per calorie.
      m("l", "lunch", [
        ["Chicken", 500, 50],
        ["Rice", 300, 10],
      ]),
      m("d", "dinner", [["Tuna", 300, 40]]),
    ],
  }))
  render(<NutrientDetail nutrient="protein" day={day} period="1" />, {
    wrapper,
  })
  // The day's protein against the goal: 100 of 140 g.
  expect(screen.getByText("100 g")).toBeTruthy()
  expect(screen.getByText("40 g to go")).toBeTruthy()
  expect(screen.getByText("Top foods for protein")).toBeTruthy()
  expect(
    screen.getByLabelText(/^Chicken: 50 g protein, 50% of the total/),
  ).toBeTruthy()
  // Protein opens on per calorie.
  expect(screen.getByText("Most protein per calorie")).toBeTruthy()
  expect(screen.getByText("13 g")).toBeTruthy()
  fireEvent.press(screen.getByText("Most"))
  expect(screen.getByText("Meals with the most protein")).toBeTruthy()
  expect(screen.getByText("60 g")).toBeTruthy()
  expect(screen.getByTestId("nutrient-goal-line")).toBeTruthy()
})

test("an empty breakdown shows its real cards dimmed, with one way to fill it", () => {
  fitStore.set((s) => ({ ...s, targets: [target], meals: [] }))
  render(<NutrientDetail nutrient="sugar" period="7" />, { wrapper })
  expect(screen.getByText("Your sugar breakdown starts here")).toBeTruthy()
  expect(
    screen.getByText("Top foods for sugar", { includeHiddenElements: true }),
  ).toBeTruthy()
})

test("Log meal offers the meals eaten before, one tap with Undo", () => {
  fitStore.set((s) => ({
    ...s,
    targets: [target],
    meals: [meal("a", dayOffset(-1), 650, 40)],
  }))
  render(<ManualMeal />, { wrapper })
  expect(screen.getByText("Eat again")).toBeTruthy()
  fireEvent.press(screen.getByLabelText("Log Adobo again, 650 kcal"))
  // A copy of the same foods, wherever the business day's cut-off puts it.
  expect(fitStore.get().meals).toHaveLength(2)
  expect(fitStore.get().meals[1].items[0].name).toBe("Adobo")
  expect(router.replace).toHaveBeenLastCalledWith(`/nutrition?day=${dayKey()}`)
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
  // The app's providers hold a QueryClient; the library's query is off
  // outside live mode, so this never fetches.
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } })
      }
    >
      <FoodLibrary />
    </QueryClientProvider>,
    { wrapper },
  )
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
