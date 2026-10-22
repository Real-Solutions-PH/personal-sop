// Where a dragged routine step lands: half a row is enough to move one
// place, and it never goes past either end.
jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  ...require("./reanimated-extras").extras,
  default: require("react-native").Animated,
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

const { dropIndex } =
  require("../screens/routines") as typeof import("../screens/routines")

it("moves by whole rows, from half a row", () => {
  // Fix the bed, last of four 66pt rows, dragged up three rows to the top.
  expect(dropIndex(3, -3 * 66, 66, 4)).toBe(0)
  expect(dropIndex(1, 34, 66, 4)).toBe(2)
  expect(dropIndex(1, 32, 66, 4)).toBe(1)
})

it("stays within the list", () => {
  expect(dropIndex(0, -500, 66, 4)).toBe(0)
  expect(dropIndex(2, 900, 66, 4)).toBe(3)
})
