// Fern's nutrition card draws the day's food the way the Today card does:
// rings for the goals and the "Stay under" bars for the limits, for the day
// the reply named.
import { fitStore } from "@domain/fitness/store"
import { dayKey } from "@domain/lib/day"
import { configureStorage, resetAll } from "@domain/lib/store"
import { render, screen } from "@testing-library/react-native"
import { BlockView } from "../companion/blocks"

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
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
}))
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
  usePathname: () => "/",
}))

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
})

test("Fern's nutrition card shows today's rings and limits", () => {
  const day = dayKey()
  fitStore.set((s) => ({
    ...s,
    targets: [
      {
        id: "t1",
        effectiveFrom: "2020-01-01",
        kcal: 2000,
        protein: 140,
        carbs: 220,
        fat: 60,
      },
    ],
    meals: [
      {
        id: "m1",
        eatenAt: new Date().toISOString(),
        label: "lunch",
        source: "text",
        rawInput: "adobo",
        status: "confirmed",
        items: [
          {
            id: "i1",
            name: "Adobo",
            qty: 1,
            unit: "plate",
            kcal: 600,
            protein: 40,
            carbs: 50,
            fat: 25,
            satFat: 8,
            sodium: 2300,
          },
        ],
      },
    ],
  }))
  render(<BlockView block={{ t: "nutrition", day }} />)
  expect(screen.getByText("NUTRITION · TODAY")).toBeTruthy()
  expect(screen.getByText("1400")).toBeTruthy() // kcal left
  expect(screen.getByText("STAY UNDER · TODAY")).toBeTruthy()
  expect(screen.getByText("2,300 / 2,000 mg · 300 mg over")).toBeTruthy()
})
