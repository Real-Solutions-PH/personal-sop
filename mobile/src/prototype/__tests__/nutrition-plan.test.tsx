// The personalized-plan form: apply stays disabled until the profile is
// valid, then saves the profile, goal and weigh-in and hands back the estimate.
import { targetFor } from "@domain/fitness/calc"
import { ageFrom, estimatePlan } from "@domain/fitness/plan"
import { fitStore } from "@domain/fitness/store"
import { dayKey } from "@domain/lib/day"
import { configureStorage, resetAll } from "@domain/lib/store"
import { fireEvent, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { PlanForm } from "../screens/nutrition-plan"
import { MacroTargets } from "../screens/nutrition-targets"
import { NutritionStep } from "../screens/setup"

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
  // Chainable no-op gesture builder; the detector just renders its child.
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
const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 44, left: 0, right: 0, bottom: 34 },
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
)
const year = new Date().getFullYear()
beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  fitStore.set((s) => ({
    ...s,
    weighIns: [],
    settings: { ...s.settings, units: "kg", goalDirection: "maintain" },
  }))
})

const apply = () => screen.getByRole("button", { name: "Apply" })
const fill = (label: string, value: string) =>
  fireEvent.changeText(screen.getByLabelText(label), value)
// Case A of the estimator tests: male, 30, 180 cm, 80 kg, moderate.
const fillA = () => {
  fireEvent.press(screen.getByText("Male"))
  fill("Birth year", String(year - 30))
  fill("Height (cm)", "180")
  fill("Weight (kg)", "80")
  fireEvent.press(screen.getByText("Exercise 3–5 days/wk"))
}

test("apply is disabled until the profile is complete", () => {
  render(<PlanForm onApply={jest.fn()} />, { wrapper })
  expect(apply().props.accessibilityState?.disabled).toBe(true)
  fillA()
  expect(apply().props.accessibilityState?.disabled).toBe(false)
})

test("apply stays disabled until sex is chosen", () => {
  render(<PlanForm onApply={jest.fn()} />, { wrapper })
  fill("Birth year", String(year - 30))
  fill("Height (cm)", "180")
  fill("Weight (kg)", "80")
  fireEvent.press(screen.getByText("Exercise 3–5 days/wk"))
  expect(apply().props.accessibilityState?.disabled).toBe(true)
  fireEvent.press(screen.getByText("Male"))
  expect(apply().props.accessibilityState?.disabled).toBe(false)
})

test("partial profile opens with birth year blank until filled", () => {
  fitStore.set((s) => ({
    ...s,
    settings: {
      ...s.settings,
      sex: "male",
      heightCm: 180,
      activity: "moderate",
    },
    weighIns: [
      { id: "w1", measuredAt: "2026-01-01T06:00:00.000Z", weightKg: 80 },
    ],
  }))
  render(<PlanForm onApply={jest.fn()} />, { wrapper })
  expect(screen.getByLabelText("Birth year").props.value).toBe("")
  expect(apply().props.accessibilityState?.disabled).toBe(true)
  fill("Birth year", String(year - 30))
  expect(apply().props.accessibilityState?.disabled).toBe(false)
})

test.each([["99"], ["251"]])("height %s cm disables apply", (cm) => {
  render(<PlanForm onApply={jest.fn()} />, { wrapper })
  fillA()
  fill("Height (cm)", cm)
  expect(apply().props.accessibilityState?.disabled).toBe(true)
})

test.each([["2"], ["71"]])("body fat %s%% disables apply", (bf) => {
  render(<PlanForm onApply={jest.fn()} />, { wrapper })
  fillA()
  fill("Body fat % (optional)", bf)
  expect(apply().props.accessibilityState?.disabled).toBe(true)
})

test("lb mode converts ft/in to cm and a round-tripped weight is not new", () => {
  fitStore.set((s) => ({
    ...s,
    settings: { ...s.settings, units: "lb" },
    weighIns: [
      { id: "w1", measuredAt: "2026-01-01T06:00:00.000Z", weightKg: 80 },
    ],
  }))
  render(<PlanForm onApply={jest.fn()} />, { wrapper })
  fireEvent.press(screen.getByText("Male"))
  fill("Birth year", String(year - 30))
  fill("Height (ft)", "5")
  fill("Height (in)", "11")
  fill("Body fat % (optional)", "20")
  fireEvent.press(screen.getByText("Exercise 3–5 days/wk"))
  fireEvent.press(apply())
  expect(fitStore.get().settings.heightCm).toBe(180.3)
  const w = fitStore.get().weighIns
  expect(w).toHaveLength(1)
  expect(w[0]).toMatchObject({ id: "w1", bodyFatPct: 20 })
})

test("apply writes profile, both goal fields, and the estimate", () => {
  const onApply = jest.fn()
  render(<PlanForm onApply={onApply} />, { wrapper })
  fillA()
  fireEvent.press(screen.getByText("Recomp"))
  fireEvent.press(apply())
  const s = fitStore.get().settings
  expect(s).toMatchObject({
    sex: "male",
    birthYear: year - 30,
    heightCm: 180,
    activity: "moderate",
    planGoal: "recomp",
    goalDirection: "maintain",
  })
  expect(onApply).toHaveBeenCalledTimes(1)
  expect(ageFrom(s.birthYear!)).toBe(30)
})

test("apply passes the maintain estimate through", () => {
  const onApply = jest.fn()
  render(<PlanForm onApply={onApply} />, { wrapper })
  fillA()
  fireEvent.press(screen.getByText("Maintain"))
  fireEvent.press(apply())
  expect(onApply).toHaveBeenCalledWith(
    expect.objectContaining({ kcal: 2750 }),
    expect.anything(),
  )
})

test("no weigh-in yet: apply creates one with weight and body fat", () => {
  render(<PlanForm onApply={jest.fn()} />, { wrapper })
  fireEvent.press(screen.getByText("Female"))
  fill("Birth year", String(year - 25))
  fill("Height (cm)", "165")
  fill("Weight (kg)", "60")
  fill("Body fat % (optional)", "25")
  fireEvent.press(screen.getByText("Light exercise 1–3 days/wk"))
  fireEvent.press(apply())
  const w = fitStore.get().weighIns
  expect(w).toHaveLength(1)
  expect(w[0]).toMatchObject({ weightKg: 60, bodyFatPct: 25 })
})

test("same weight: body fat goes on the latest weigh-in, no new one", () => {
  fitStore.set((s) => ({
    ...s,
    weighIns: [
      { id: "w1", measuredAt: "2026-01-01T06:00:00.000Z", weightKg: 80 },
    ],
  }))
  render(<PlanForm onApply={jest.fn()} />, { wrapper })
  fireEvent.press(screen.getByText("Male"))
  fill("Birth year", String(year - 30))
  fill("Height (cm)", "180")
  fill("Body fat % (optional)", "20")
  fireEvent.press(screen.getByText("Exercise 3–5 days/wk"))
  expect(screen.getByLabelText("Weight (kg)").props.value).toBe("80")
  fireEvent.press(apply())
  const w = fitStore.get().weighIns
  expect(w).toHaveLength(1)
  expect(w[0]).toMatchObject({ id: "w1", bodyFatPct: 20 })
})

test("out-of-range age disables apply", () => {
  render(<PlanForm onApply={jest.fn()} />, { wrapper })
  fillA()
  fill("Birth year", String(year - 10))
  expect(apply().props.accessibilityState?.disabled).toBe(true)
})

const seePlan = () => {
  fillA()
  fireEvent.press(screen.getByText("Maintain"))
  fireEvent.press(screen.getByRole("button", { name: "See my plan" }))
}

test("setup nutrition step saves the estimated target", () => {
  const onDone = jest.fn()
  render(<NutritionStep onDone={onDone} />, { wrapper })
  seePlan()
  fireEvent.press(screen.getByText("Save targets"))
  expect(targetFor(fitStore.get(), dayKey())).toMatchObject({
    kcal: 2750,
    protein: 144,
  })
  expect(onDone).toHaveBeenCalled()
})

test("lowering kcal under BMR shows the note but still saves", () => {
  render(<NutritionStep onDone={jest.fn()} />, { wrapper })
  seePlan()
  expect(screen.queryByText("Below what your body burns at rest")).toBeNull()
  fireEvent.changeText(screen.getByLabelText("Calories"), "1700")
  expect(screen.getByText("Below what your body burns at rest")).toBeTruthy()
  fireEvent.press(screen.getByText("Save targets"))
  expect(targetFor(fitStore.get(), dayKey())).toMatchObject({ kcal: 1700 })
})

const profileA = () =>
  fitStore.set((s) => ({
    ...s,
    settings: {
      ...s.settings,
      sex: "male",
      birthYear: year - 30,
      heightCm: 180,
      activity: "moderate",
    },
    weighIns: [
      { id: "w1", measuredAt: "2026-01-01T06:00:00.000Z", weightKg: 80 },
    ],
  }))

test("Targets: suggest, use and save stores only target fields", () => {
  profileA()
  render(<MacroTargets />, { wrapper })
  fireEvent.press(screen.getByText("Suggest"))
  fireEvent.press(screen.getByRole("button", { name: "Get suggestion" }))
  fireEvent.press(screen.getByText("Use"))
  fireEvent.press(screen.getByText("Save · effective today"))
  const p = estimatePlan({
    sex: "male",
    age: 30,
    heightCm: 180,
    weightKg: 80,
    activity: "moderate",
    goal: "maintain",
  })
  const saved = targetFor(fitStore.get(), dayKey())
  expect(saved).toMatchObject({
    kcal: p.kcal,
    protein: p.protein,
    carbs: p.carbs,
    fat: p.fat,
    fiberGoal: p.fiberG,
  })
  for (const k of ["fiberG", "bmr", "tdee"]) expect(saved).not.toHaveProperty(k)
})

test("Targets: 600 kcal saves", () => {
  render(<MacroTargets />, { wrapper })
  fireEvent.changeText(screen.getByLabelText("Calories"), "600")
  fireEvent.press(screen.getByText("Save · effective today"))
  expect(targetFor(fitStore.get(), dayKey())).toMatchObject({ kcal: 600 })
})

test("body fat starts empty even when a weigh-in has one", () => {
  fitStore.set((s) => ({
    ...s,
    weighIns: [
      { id: "w2", measuredAt: "2026-01-02T06:00:00.000Z", weightKg: 80 },
      {
        id: "w1",
        measuredAt: "2026-01-01T06:00:00.000Z",
        weightKg: 81,
        bodyFatPct: 25,
      },
    ],
  }))
  render(<PlanForm onApply={jest.fn()} />, { wrapper })
  expect(screen.getByLabelText("Body fat % (optional)").props.value).toBe("")
  expect(screen.getByLabelText("Weight (kg)").props.value).toBe("80")
})

test("height switches between cm and ft/in, keeping the value", () => {
  render(<PlanForm onApply={jest.fn()} />, { wrapper })
  fill("Height (cm)", "180")
  fireEvent.press(screen.getByLabelText("ft units"))
  expect(screen.getByLabelText("Height (ft)").props.value).toBe("5")
  expect(screen.getByLabelText("Height (in)").props.value).toBe("11")
  fireEvent.press(screen.getByLabelText("cm units"))
  expect(screen.getByLabelText("Height (cm)").props.value).toBe("180.3")
})

test("weight switches between kg and lb, and saves kilograms", () => {
  const onApply = jest.fn()
  render(<PlanForm onApply={onApply} />, { wrapper })
  fillA()
  fireEvent.press(screen.getByLabelText("lb units"))
  expect(screen.getByLabelText("Weight (lb)").props.value).toBe("176.4")
  fireEvent.press(apply())
  expect(onApply.mock.calls[0][1].weightKg).toBeCloseTo(80, 1)
})

test("birth year takes digits only, so it is always an integer", () => {
  render(<PlanForm onApply={jest.fn()} />, { wrapper })
  fillA()
  fill("Birth year", "1995.5")
  expect(screen.getByLabelText("Birth year").props.value).toBe("19955")
  expect(apply().props.accessibilityState?.disabled).toBe(true)
})

test("weight of 500 kg or more disables apply", () => {
  render(<PlanForm onApply={jest.fn()} />, { wrapper })
  fillA()
  fill("Weight (kg)", "500")
  expect(apply().props.accessibilityState?.disabled).toBe(true)
  fill("Weight (kg)", "499")
  expect(apply().props.accessibilityState?.disabled).toBe(false)
})

test("chips expose a radio role with selected state", () => {
  render(<PlanForm onApply={jest.fn()} />, { wrapper })
  const male = () => screen.getByRole("radio", { name: "Male" })
  expect(male().props.accessibilityState).toMatchObject({ selected: false })
  fireEvent.press(screen.getByText("Male"))
  expect(male().props.accessibilityState).toMatchObject({ selected: true })
})

test("lb pre-fill carries rounded inches into feet", () => {
  fitStore.set((s) => ({
    ...s,
    settings: { ...s.settings, units: "lb", heightCm: 5.99 * 30.48 },
  }))
  render(<PlanForm onApply={jest.fn()} />, { wrapper })
  expect(screen.getByLabelText("Height (ft)").props.value).toBe("6")
  expect(screen.getByLabelText("Height (in)").props.value).toBe("0")
})

test("onApply also hands back the inputs it estimated with", () => {
  const onApply = jest.fn()
  render(<PlanForm onApply={onApply} />, { wrapper })
  fillA()
  fireEvent.press(apply())
  expect(onApply).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ weightKg: 80, age: 30, heightCm: 180 }),
  )
})

test("setup with a weigh-in hides the weight field and still applies", () => {
  profileA()
  render(<NutritionStep onDone={jest.fn()} />, { wrapper })
  expect(screen.queryByLabelText("Weight (kg)")).toBeNull()
  fireEvent.press(screen.getByRole("button", { name: "See my plan" }))
  expect(screen.getByText("Save targets")).toBeTruthy()
  expect(fitStore.get().weighIns).toHaveLength(1)
})

test("setup without a weigh-in asks for weight", () => {
  render(<NutritionStep onDone={jest.fn()} />, { wrapper })
  expect(screen.getByLabelText("Weight (kg)")).toBeTruthy()
})
