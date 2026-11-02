// Until a reply's words arrive, a line says what Fern is doing: never a bare
// "Thinking" for the whole wait. Live thinking and running steps show their
// own progress, so the line steps aside for them.
import { configureStorage, resetAll } from "@domain/lib/store"
import { render, screen } from "@testing-library/react-native"
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

type Block = Record<string, unknown>
const reply = (blocks?: Block[]) =>
  ({ id: "m1", role: "sol", at: new Date().toISOString(), blocks }) as never
const step = (running: boolean) => ({
  t: "steps",
  items: [
    {
      id: "s1",
      tool: "nutrition_status",
      label: "Checking today's macros",
      running,
      ...(running ? {} : { ok: true, summary: "53 kcal left" }),
    },
  ],
})

beforeEach(() => answering.setState({ id: "m1" }))

it("before anything arrives it says it is reading the message", () => {
  render(<SolMessage m={reply()} name="Fern" />)
  expect(screen.getByText("Reading your message")).toBeTruthy()
  expect(screen.queryByText("Thinking")).toBeNull()
})

it("after its steps ran it says it is putting the answer together", () => {
  render(<SolMessage m={reply([step(false)])} name="Fern" />)
  expect(screen.getByText("53 kcal left")).toBeTruthy()
  expect(screen.getByText("Putting it together")).toBeTruthy()
})

it("a running step shows its own progress, with no second line", () => {
  render(<SolMessage m={reply([step(true)])} name="Fern" />)
  expect(screen.getByText("Checking today's macros…")).toBeTruthy()
  expect(screen.queryByText("Putting it together")).toBeNull()
  expect(screen.queryByText("Reading your message")).toBeNull()
})

it("live thinking shows its latest line, with no second line", () => {
  const thought = {
    t: "thinking",
    text: "They want their macros.",
    done: false,
  }
  render(<SolMessage m={reply([thought])} name="Fern" />)
  expect(screen.getByText("They want their macros.")).toBeTruthy()
  expect(screen.queryByText("Reading your message")).toBeNull()
  expect(screen.queryByText("Putting it together")).toBeNull()
})

it("once the thinking is done and nothing else shows, the line comes back", () => {
  const thought = { t: "thinking", text: "They want their macros.", done: true }
  render(<SolMessage m={reply([thought])} name="Fern" />)
  expect(screen.getByText("Putting it together")).toBeTruthy()
})

it("a finished reply has no stage line", () => {
  answering.setState({ id: null })
  render(<SolMessage m={reply([step(false)])} name="Fern" />)
  expect(screen.queryByText("Putting it together")).toBeNull()
})
