import * as A from "@domain/habits/actions"
import { habitsStore } from "@domain/habits/store"
import { dayKey } from "@domain/lib/day"
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import { router } from "expo-router"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { toast } from "sonner-native"
import { HabitsHome } from "../screens/habits-home"
import { HabitsCard } from "../screens/today"

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

const longName =
  "Stretch hamstrings, calves and hips slowly before the first coffee"

test("the Habits page keeps its statistics and lists today's habits below them", () => {
  A.createHabit({ name: "Walk", icon: "🚶" })
  A.createHabit({ name: longName, icon: "🧘" })
  render(<HabitsHome />, { wrapper })
  // The overview statistics are still there…
  expect(screen.getByText("completion")).toBeTruthy()
  expect(screen.getByText("7-day rolling completion")).toBeTruthy()
  // …and today's habits sit below them, each with its own tick.
  expect(screen.getByTestId("habits-page-today")).toBeTruthy()
  expect(screen.getByRole("checkbox", { name: "Complete Walk" })).toBeTruthy()
  // A long title wraps: it is never cut to a line.
  const title = screen.getByText(`🧘 ${longName}`)
  expect(title.props.numberOfLines).toBeUndefined()
})

test("ticking a habit on the Habits page logs it and offers Undo, as on Home", () => {
  const h = A.createHabit({ name: "Walk", icon: "🚶" })
  render(<HabitsHome />, { wrapper })
  fireEvent.press(screen.getByRole("checkbox", { name: "Complete Walk" }))
  act(() => jest.advanceTimersByTime(1000))
  const log = () =>
    habitsStore.get().logs.find((l) => l.habitId === h.id && l.day === dayKey())
  expect(log()?.status).toBe("done")
  expect(toast).toHaveBeenCalledWith(
    "Habit checked",
    expect.objectContaining({
      action: expect.objectContaining({ label: "Undo" }),
    }),
  )
  // Undo puts the day back as it was.
  const [, opts] = (toast as unknown as jest.Mock).mock.calls.at(-1)
  act(() => opts.action.onClick())
  expect(log()).toBeUndefined()
})

test("the same tick on Home and on the Habits page produces the same toast", () => {
  A.createHabit({ name: "Walk", icon: "🚶" })
  const calls: unknown[] = []
  for (const ui of [<HabitsCard key="home" />, <HabitsHome key="page" />]) {
    habitsStore.set((s) => ({ ...s, logs: [] }))
    ;(toast as unknown as jest.Mock).mockClear()
    const view = render(ui, { wrapper })
    fireEvent.press(screen.getByRole("checkbox", { name: "Complete Walk" }))
    act(() => jest.advanceTimersByTime(1000))
    calls.push((toast as unknown as jest.Mock).mock.calls.map((c) => c[0]))
    view.unmount()
  }
  expect(calls[0]).toEqual(["Habit checked"])
  expect(calls[1]).toEqual(calls[0])
})

test("every routine due today can be started from the Habits page", () => {
  const walk = A.createHabit({ name: "Walk", icon: "🚶" })
  const read = A.createHabit({ name: "Read", icon: "📖" })
  // Two routines at opposite ends of the day: Home shows only the one whose
  // part of the day it is, the Habits page shows both.
  const morning = A.createRoutine({
    name: "Morning",
    schedule: [{ days: [0, 1, 2, 3, 4, 5, 6], time: "06:00" }],
    steps: [{ habitId: walk.id, minutes: 10 }],
  })
  const evening = A.createRoutine({
    name: "Evening",
    schedule: [{ days: [0, 1, 2, 3, 4, 5, 6], time: "21:00" }],
    steps: [{ habitId: read.id, minutes: 10 }],
  })
  render(<HabitsHome />, { wrapper })
  fireEvent.press(screen.getByRole("button", { name: "Start Morning" }))
  expect(push).toHaveBeenLastCalledWith(`/habits/routines/${morning.id}/play`)
  fireEvent.press(screen.getByRole("button", { name: "Start Evening" }))
  expect(push).toHaveBeenLastCalledWith(`/habits/routines/${evening.id}/play`)
})
