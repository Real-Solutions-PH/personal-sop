// The nutrition rings fit the width they get: full size on a wide card,
// smaller inside Fern's message, and the macros on their own row when even
// small rings would not fit beside the calorie ring.
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
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
  usePathname: () => "/",
}))
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
}))
jest.mock("expo-audio", () => ({}))
jest.mock("../media", () => ({ exportCsv: jest.fn(), pickPhoto: jest.fn() }))

const { ringLayout } =
  require("../screens/fitness-nutrition") as typeof import("../screens/fitness-nutrition")

const fits = (w: number) => {
  const { stacked, big, small } = ringLayout(w)
  const used = stacked
    ? Math.max(big, 3 * small + 16)
    : big + 16 + 3 * small + 16
  return used <= w
}

test("a wide card keeps the full-size rings side by side", () => {
  expect(ringLayout(358)).toEqual({ stacked: false, big: 112, small: 60 })
})

test("Fern's card on an iPhone 13 shrinks the rings so nothing overlaps", () => {
  const l = ringLayout(290)
  expect(l.stacked).toBe(false)
  expect(l.big).toBeLessThan(112)
  expect(fits(290)).toBe(true)
})

test("a very narrow card puts the macros on their own row", () => {
  expect(ringLayout(220).stacked).toBe(true)
  expect(fits(220)).toBe(true)
})

test("every width from a small phone up fits", () => {
  for (let w = 200; w <= 420; w += 2) expect(fits(w)).toBe(true)
})
