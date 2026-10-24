// The personalized-plan form: apply stays disabled until the profile is
// valid, then saves the profile, goal and weigh-in and hands back the estimate.
import { ageFrom } from "@domain/fitness/plan"
import { fitStore } from "@domain/fitness/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { fireEvent, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { PlanForm } from "../screens/nutrition-plan"

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
  expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ kcal: 2750 }))
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
