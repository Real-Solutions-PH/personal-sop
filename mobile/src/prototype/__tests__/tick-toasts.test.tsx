// The one success toast: ticking off a habit or a task, with Undo. Taking
// the tick back says nothing (the row changing is the feedback), and errors
// still toast.
import * as HA from "@domain/habits/actions"
import { habitsStore } from "@domain/habits/store"
import { dayKey } from "@domain/lib/day"
import { configureStorage, resetAll } from "@domain/lib/store"
import * as TA from "@domain/tasks/actions"
import { tasksStore } from "@domain/tasks/store"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { toast } from "sonner-native"
import { HabitRow } from "../screens/habits"
import { HabitsHome } from "../screens/habits-home"
import { TaskRow } from "../screens/tasks"

let mockParams: Record<string, string> = {}
jest.mock("expo-router", () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: () => false,
  },
  useLocalSearchParams: () => mockParams,
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
jest.mock("expo-audio", () => ({}))
jest.mock("../media", () => ({
  copyText: jest.fn(),
  exportCsv: jest.fn(),
  pickPhoto: jest.fn(),
}))

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 44, left: 0, right: 0, bottom: 34 },
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
)
const toastMock = toast as unknown as jest.Mock & {
  error: jest.Mock
  success: jest.Mock
  warning: jest.Mock
}
/** The press, then the check's commit beat. */
const tick = (name: string) => {
  fireEvent.press(screen.getByRole("checkbox", { name }))
  act(() => jest.advanceTimersByTime(1000))
}
const lastToast = () => {
  const [message, opts] = toastMock.mock.calls.at(-1) as [
    string,
    { action: { label: string; onClick: () => void } },
  ]
  return { message, label: opts.action.label, undo: opts.action.onClick }
}

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  mockParams = {}
  habitsStore.set((s) => ({ ...s, habits: [], logs: [], routines: [] }))
  tasksStore.set((s) => ({ ...s, lists: [], tasks: [], events: [] }))
  jest.clearAllMocks()
  jest.useFakeTimers()
})
afterEach(() => jest.useRealTimers())

test("ticking off a habit toasts with Undo; Undo takes the tick back", () => {
  const h = HA.createHabit({ name: "Walk", icon: "🚶" })
  const log = () =>
    habitsStore.get().logs.find((l) => l.habitId === h.id && l.day === dayKey())
  render(<HabitsHome />, { wrapper })
  tick("Complete Walk")
  expect(log()?.status).toBe("done")
  expect(toastMock).toHaveBeenCalledTimes(1)
  const t = lastToast()
  expect(t).toMatchObject({ message: "Habit checked", label: "Undo" })
  act(() => t.undo())
  expect(log()).toBeUndefined()
})

test("unticking a habit says nothing", () => {
  const h = HA.createHabit({ name: "Walk", icon: "🚶" })
  HA.checkHabit(h.id, dayKey())
  render(<HabitRow habit={h} day={dayKey()} />, { wrapper })
  tick("Clear Walk")
  expect(
    habitsStore
      .get()
      .logs.find((l) => l.habitId === h.id && l.day === dayKey()),
  ).toBeUndefined()
  expect(toastMock).not.toHaveBeenCalled()
  expect(toastMock.success).not.toHaveBeenCalled()
})

test("ticking off a task toasts with Undo; Undo reopens it", () => {
  const task = TA.createTask({ title: "Pay rent", source: "manual" })
  render(<TaskRow task={task} />, { wrapper })
  tick("Done")
  expect(TA.getTask(task.id)?.status).toBe("done")
  expect(toastMock).toHaveBeenCalledTimes(1)
  const t = lastToast()
  expect(t).toMatchObject({ message: "Task complete", label: "Undo" })
  act(() => t.undo())
  expect(TA.getTask(task.id)?.status).toBe("open")
})

test("reopening a done task says nothing", () => {
  const task = TA.createTask({ title: "Pay rent", source: "manual" })
  TA.completeTask(task.id)
  render(<TaskRow task={TA.getTask(task.id) ?? task} />, { wrapper })
  tick("Reopen task")
  expect(TA.getTask(task.id)?.status).toBe("open")
  expect(toastMock).not.toHaveBeenCalled()
})

test("an error still toasts", () => {
  const { FinanceQuickAdd } =
    require("../screens/finance-apple-pay") as typeof import("../screens/finance-apple-pay")
  mockParams = { amount: "lots", merchant: "Jollibee" }
  render(<FinanceQuickAdd />, { wrapper })
  expect(toastMock.error).toHaveBeenCalledTimes(1)
  expect(toastMock).not.toHaveBeenCalled()
})
