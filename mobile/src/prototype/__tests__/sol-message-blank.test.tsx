// While a reply streams, line breaks can arrive before any words; they must
// not draw blank lines (a tall gap above the steps) or the read/copy row.
import { configureStorage, resetAll } from "@domain/lib/store"
import { render, screen } from "@testing-library/react-native"

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
  usePathname: () => "/",
  useFocusEffect: () => {},
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
  withRepeat: (value: unknown) => value,
  interpolate: (_: number, __: number[], output: number[]) => output[0],
  interpolateColor: (_: number, __: number[], output: string[]) => output[0],
  runOnJS: (fn: unknown) => fn,
  useReducedMotion: () => true,
}))
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
}))
jest.mock("expo-audio", () => ({}))

const { SolMessage } =
  require("../companion/chat") as typeof import("../companion/chat")

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
})

const msg = (text: string) =>
  ({ id: "m1", role: "sol", text, at: new Date().toISOString() }) as never

it("draws nothing for a reply that is only line breaks so far", () => {
  render(<SolMessage m={msg("\n\n\n")} name="Fern" />)
  expect(screen.queryByLabelText("Copy reply")).toBeNull()
  expect(screen.queryByText(/^\s+$/)).toBeNull()
})

it("shows the words without the leading line breaks", () => {
  render(<SolMessage m={msg("\n\nAdded it first.")} name="Fern" />)
  expect(screen.getByText("Added it first.")).toBeTruthy()
  expect(screen.getByLabelText("Copy reply")).toBeTruthy()
})
