// Limits read as amounts to stay under: the day says how much room is left,
// a range says the daily average and the days that went over, and a value
// no logged item carries says so instead of showing zero.
import {
  DAILY_LIMITS,
  dayDetail,
  fiberGoalFor,
  limitAverages,
  limitsFor,
} from "@domain/fitness/limits"
import { render, screen } from "@testing-library/react-native"
import { LimitList } from "../screens/nutrient-limits"

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

const meal = (
  status: string,
  items: { satFat?: number; sugar?: number; sodium?: number }[],
) => ({ status, items })

test("a day's detail skips meals still waiting for an estimate", () => {
  expect(
    dayDetail([
      meal("confirmed", [{ satFat: 5, sodium: 800 }, { satFat: 3 }]),
      meal("pending_estimate", [{ satFat: 50 }]),
    ]),
  ).toEqual({ satFat: 8, sodium: 800 })
})

test("averages count only the days that carry the value", () => {
  const { avg, over } = limitAverages([
    [meal("confirmed", [{ satFat: 30, sugar: 10 }])],
    [meal("confirmed", [{ satFat: 10 }])],
  ])
  expect(avg).toEqual({ satFat: 20, sugar: 10 })
  expect(over).toEqual({ satFat: 1, sugar: 0 })
})

test("today: room left, over, and not tracked", () => {
  render(<LimitList detail={{ satFat: 8, sodium: 2300 }} />)
  expect(screen.getByText("STAY UNDER · TODAY")).toBeTruthy()
  expect(screen.getByText("8 / 20 g · 12 g room")).toBeTruthy()
  expect(screen.getByText("2,300 / 2,000 mg · 300 mg over")).toBeTruthy()
  expect(screen.getByText("not tracked yet · under 50 g")).toBeTruthy()
  expect(
    screen.getByLabelText(
      "Sat fat: 8 g of a 20 g daily limit, 12 g of room left",
    ),
  ).toBeTruthy()
})

test("a range: the average and the days over", () => {
  render(
    <LimitList
      scope="average"
      detail={{ satFat: 14, sugar: 30, sodium: 2100 }}
      overDays={{ satFat: 0, sugar: 1, sodium: 3 }}
    />,
  )
  expect(screen.getByText("avg 14 / 20 g · never over")).toBeTruthy()
  expect(screen.getByText("avg 30 / 50 g · over on 1 day")).toBeTruthy()
  expect(screen.getByText("avg 2,100 / 2,000 mg · over on 3 days")).toBeTruthy()
})

test("a target's own limits replace the defaults key by key", () => {
  expect(limitsFor(undefined)).toEqual(DAILY_LIMITS)
  expect(limitsFor({ satFatMax: 13, sugarMax: 26 })).toEqual({
    satFat: 13,
    sugar: 26,
    sodium: 2000,
  })
  expect(fiberGoalFor({ fiberGoal: 27 })).toBe(27)
  expect(fiberGoalFor(undefined)).toBe(25)
})

test("the user's own limits set the cap and the days over", () => {
  const own = { satFat: 13, sugar: 26, sodium: 2000 }
  const { over } = limitAverages(
    [[meal("confirmed", [{ satFat: 15, sugar: 20 }])]],
    own,
  )
  expect(over).toEqual({ satFat: 1, sugar: 0 })
  render(<LimitList detail={{ satFat: 8, sugar: 30 }} limits={own} />)
  expect(screen.getByText("8 / 13 g · 5 g room")).toBeTruthy()
  expect(screen.getByText("30 / 26 g · 4 g over")).toBeTruthy()
})
