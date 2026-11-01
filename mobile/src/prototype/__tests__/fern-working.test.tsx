// While Fern works her orb is in the design's thinking state, from the
// first moment until the reply ends, not only until its first words.
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, render, screen } from "@testing-library/react-native"
import { answering, thinking } from "../companion/store"

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
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
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
  thinking.setState({ on: false })
  answering.setState({ id: null })
})

const msg = (text?: string) =>
  ({ id: "m1", role: "sol", text, at: new Date().toISOString() }) as never
const orb = () => screen.getByRole("image", { name: "Fern" })

it("a reply with no words yet says Fern is thinking, its orb working", () => {
  answering.setState({ id: "m1" })
  render(<SolMessage m={msg()} name="Fern" />)
  expect(screen.getByText("Thinking")).toBeTruthy()
  expect(orb().props.accessibilityState).toMatchObject({ busy: true })
})

it("the orb keeps working while the words stream, and rests when they end", () => {
  answering.setState({ id: "m1" })
  render(<SolMessage m={msg("Logged your breakfast")} name="Fern" />)
  expect(orb().props.accessibilityState).toMatchObject({ busy: true })
  expect(screen.queryByText("Thinking")).toBeNull()
  expect(screen.queryByLabelText("Copy reply")).toBeNull()
  act(() => answering.setState({ id: null }))
  expect(orb().props.accessibilityState).toMatchObject({ busy: false })
  expect(screen.getByLabelText("Copy reply")).toBeTruthy()
})

it("another reply being written leaves this one at rest", () => {
  answering.setState({ id: "m2" })
  render(<SolMessage m={msg("Earlier answer")} name="Fern" />)
  expect(orb().props.accessibilityState).toMatchObject({ busy: false })
})
