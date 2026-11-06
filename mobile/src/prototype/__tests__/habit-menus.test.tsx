import * as A from "@domain/habits/actions"
import { habitsStore } from "@domain/habits/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react-native"
import { router } from "expo-router"
import { Archive, Pause, Play } from "lucide-react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { HabitForm } from "../screens/habits"

const mockParams: { current: Record<string, string> } = { current: {} }
jest.mock("expo-router", () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: () => false,
  },
  useLocalSearchParams: () => mockParams.current,
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
  withDelay: (_: number, value: unknown) => value,
  interpolate: (_: number, __: number[], output: number[]) => output[0],
  interpolateColor: (_: number, __: number[], output: string[]) => output[0],
  runOnJS: (fn: unknown) => fn,
  useReducedMotion: () => true,
}))
jest.mock("react-native-gesture-handler", () => {
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
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
}))
const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 44, left: 0, right: 0, bottom: 34 },
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
)
const push = router.push as jest.Mock

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  mockParams.current = {}
  habitsStore.set((s) => ({ ...s, habits: [], logs: [], routines: [] }))
  jest.clearAllMocks()
  jest.useFakeTimers()
})
afterEach(() => jest.useRealTimers())

/** A pressable's visible label, read from the text inside it. */
const textOf = (b: ReturnType<typeof screen.getByRole>) =>
  within(b)
    .queryAllByText(/./)
    .map((x) => x.props.children)
    .join("")

test("Edit habit: Pause first, Archive set apart below it, each with its icon", () => {
  const h = A.createHabit({ name: "Walk", icon: "🚶" })
  render(<HabitForm id={h.id} />, { wrapper })
  const manage = screen.getByTestId("habit-manage")
  const [pause, archive, ...rest] = within(manage).getAllByRole("button")
  expect(rest).toHaveLength(0)
  expect(textOf(pause)).toBe("Pause habit")
  expect(textOf(archive)).toBe("Archive habit")
  expect(pause.findAllByType(Pause).length).toBeGreaterThan(0)
  expect(archive.findAllByType(Archive).length).toBeGreaterThan(0)
  // Pausing flips the button to Resume with a play icon.
  fireEvent.press(pause)
  act(() => jest.advanceTimersByTime(10))
  const resume = within(screen.getByTestId("habit-manage")).getAllByRole(
    "button",
  )[0]
  expect(textOf(resume)).toBe("Resume habit")
  expect(resume.findAllByType(Play).length).toBeGreaterThan(0)
  expect(habitsStore.get().habits.find((x) => x.id === h.id)?.status).toBe(
    "paused",
  )
  void push
})
