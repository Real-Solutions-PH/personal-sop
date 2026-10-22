// The meal card shows each item's detail, and reads saturated fat, sugar
// and sodium as a share of a daily limit (near it: a percentage; past it:
// "over"), not as goals to hit.
import type { RecordCard } from "@domain/capture/data"
import { configureStorage, resetAll } from "@domain/lib/store"
import { render, screen } from "@testing-library/react-native"
import { CaptureSummary } from "../screens/capture-summary"

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

const card = (items: object[]): RecordCard =>
  ({
    t: "record",
    id: "c1",
    target: "fitness",
    tier: "confirm",
    state: "proposed",
    confidence: 0.8,
    payload: {
      kind: "meal",
      raw: "",
      label: "breakfast",
      items,
      confidence: 0.8,
    },
  }) as unknown as RecordCard

const base = { qty: 1, unit: "plate", protein: 20, carbs: 40, fat: 15 }

test("each item lists its nutrients; limits read as a share of the day", () => {
  render(
    <CaptureSummary
      card={card([
        {
          ...base,
          name: "Longsilog",
          kcal: 650,
          fiber: 2,
          satFat: 9,
          sugar: 6,
          sodium: 1700,
        },
        { ...base, name: "Iced tea", kcal: 120, sugar: 30, sodium: 600 },
      ])}
    />,
  )
  expect(
    screen.getByText(
      "P 20g · C 40g · F 15g · Fiber 2g · Sat fat 9g · Sugar 6g · Sodium 1,700 mg",
    ),
  ).toBeTruthy()
  expect(screen.getByText("STAY UNDER · SHARE OF DAILY MAX")).toBeTruthy()
  // 9 of 20 g saturated fat; 36 of 50 g sugar (72%); 2,300 of 2,000 mg sodium.
  expect(screen.getByText("9 / 20 g · 45% of max")).toBeTruthy()
  expect(screen.getByText("36 / 50 g · 72% of max")).toBeTruthy()
  expect(screen.getByText("2,300 / 2,000 mg · 300 mg over")).toBeTruthy()
  expect(
    screen.getByLabelText(
      /Sodium: 2,300 mg of a 2,000 mg daily limit, over the limit/,
    ),
  ).toBeTruthy()
})

test("a meal without nutrient detail shows no limits section", () => {
  render(<CaptureSummary card={card([{ ...base, name: "Rice", kcal: 205 }])} />)
  expect(screen.queryByText("STAY UNDER · SHARE OF DAILY MAX")).toBeNull()
  expect(screen.getByText("P 20g · C 40g · F 15g")).toBeTruthy()
})
