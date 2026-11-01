// Editing a task title: an older title arriving through sync while you
// type must not put deleted text back, and the edit is saved after a pause.

import { configureStorage, resetAll } from "@domain/lib/store"
import { tasksStore } from "@domain/tasks/store"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
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
jest.mock("../media", () => ({ exportCsv: jest.fn(), pickPhoto: jest.fn() }))

const { TaskDetail } =
  require("../screens/task-detail") as typeof import("../screens/task-detail")

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 44, left: 0, right: 0, bottom: 34 },
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
)

beforeEach(() => {
  jest.useFakeTimers()
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
})
afterEach(() => jest.useRealTimers())

const titleOf = (id: string) =>
  tasksStore.get().tasks.find((x) => x.id === id)?.title

it("keeps what you typed when an older title comes back mid-edit", () => {
  const task = tasksStore.get().tasks[0]
  render(<TaskDetail id={task.id} />, { wrapper })
  const field = screen.getByLabelText("Title")
  fireEvent(field, "focus")
  fireEvent.changeText(field, "Upgrade the workflow")
  // A sync pull lands with the title from before the edit.
  act(() => {
    tasksStore.set((s) => ({
      ...s,
      tasks: s.tasks.map((x) =>
        x.id === task.id ? { ...x, title: `${task.title} pH` } : x,
      ),
    }))
  })
  expect(screen.getByLabelText("Title").props.value).toBe(
    "Upgrade the workflow",
  )
  // Saved after a pause in typing.
  act(() => {
    jest.advanceTimersByTime(700)
  })
  expect(titleOf(task.id)).toBe("Upgrade the workflow")
})

it("saves on leaving the field, and an empty title keeps the old one", () => {
  const task = tasksStore.get().tasks[0]
  render(<TaskDetail id={task.id} />, { wrapper })
  const field = screen.getByLabelText("Title")
  fireEvent(field, "focus")
  fireEvent.changeText(field, "   ")
  fireEvent(field, "blur")
  expect(titleOf(task.id)).toBe(task.title)
  fireEvent(field, "focus")
  fireEvent.changeText(field, "Fix the bed")
  fireEvent(field, "blur")
  expect(titleOf(task.id)).toBe("Fix the bed")
})
