import * as HA from "@domain/habits/actions"
import { habitsStore } from "@domain/habits/store"
import { dayKey } from "@domain/lib/day"
import { configureStorage, resetAll } from "@domain/lib/store"
import * as TA from "@domain/tasks/actions"
import { tasksStore } from "@domain/tasks/store"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import * as Haptics from "expo-haptics"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { toast } from "sonner-native"
import { AnimatedCheck, StreakChip } from "../motion"
import { TaskPlanPanel } from "../screens/plan"
import { TaskDetail } from "../screens/task-detail"
import { TaskRow } from "../screens/tasks"
import { HabitsCard } from "../screens/today"

const mockMotion = { reduced: false }
const mockStorage = new Map<string, string>()
jest.mock("../storage", () => ({
  prototypeStorage: () => ({
    getItem: (k: string) => mockStorage.get(k) ?? null,
    setItem: (k: string, v: string) => mockStorage.set(k, v),
    removeItem: (k: string) => mockStorage.delete(k),
  }),
}))
jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
  NotificationFeedbackType: { Success: "success", Warning: "warning" },
}))
jest.mock("expo-router", () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: () => false,
  },
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
  useAnimatedProps: (get: () => unknown) => get(),
  withSpring: (value: unknown) => value,
  withTiming: (value: unknown) => value,
  withSequence: (...values: unknown[]) => values[values.length - 1],
  withDelay: (_: number, value: unknown) => value,
  interpolate: (_: number, __: number[], output: number[]) => output[0],
  interpolateColor: (_: number, __: number[], output: string[]) => output[0],
  runOnJS: (fn: unknown) => fn,
  useReducedMotion: () => mockMotion.reduced,
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
  const { Pressable, View } = require("react-native")
  return ({
    children,
    onSwipeableOpen,
  }: {
    children: ReactNode
    onSwipeableOpen: (side: string) => void
  }) => (
    <View>
      <Pressable
        testID="swipe-complete"
        onPress={() => onSwipeableOpen("right")}
      />
      {children}
    </View>
  )
})
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
}))
const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 44, left: 0, right: 0, bottom: 34 },
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
)
const success = () =>
  (Haptics.notificationAsync as jest.Mock).mock.calls.filter(
    ([kind]) => kind === "success",
  ).length
const burst = () =>
  screen.queryAllByTestId("burst", { includeHiddenElements: true })

beforeEach(() => {
  jest.useFakeTimers()
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  habitsStore.set((s) => ({ ...s, habits: [], logs: [], routines: [] }))
  tasksStore.set((s) => ({ ...s, tasks: [], lists: [], events: [] }))
  mockMotion.reduced = false
  mockStorage.clear()
  jest.clearAllMocks()
})
afterEach(() => {
  jest.useRealTimers()
})

const check = (props: Partial<Parameters<typeof AnimatedCheck>[0]>) => (
  <AnimatedCheck
    checked={false}
    onToggle={() => {}}
    color="#22aa66"
    idle="#999999"
    label="Done"
    {...props}
  />
)

test("checking bursts with a success haptic; unchecking does neither", () => {
  const onToggle = jest.fn()
  const view = render(check({ onToggle }), { wrapper })
  fireEvent.press(screen.getByRole("checkbox"))
  expect(burst()).toHaveLength(1)
  expect(success()).toBe(1)
  act(() => jest.advanceTimersByTime(400))
  expect(onToggle).toHaveBeenCalledTimes(1)
  act(() => jest.advanceTimersByTime(400))
  expect(burst()).toHaveLength(0)
  view.rerender(check({ onToggle, checked: true }))
  fireEvent.press(screen.getByRole("checkbox"))
  expect(burst()).toHaveLength(0)
  expect(Haptics.impactAsync).toHaveBeenCalledWith("light")
  expect(success()).toBe(1)
})

test("celebrate plays the pop and burst without toggling", () => {
  const onToggle = jest.fn()
  const view = render(check({ onToggle, celebrate: 0 }), { wrapper })
  expect(burst()).toHaveLength(0)
  view.rerender(check({ onToggle, celebrate: 1 }))
  expect(burst()).toHaveLength(1)
  expect(screen.getByRole("checkbox").props.accessibilityState).toMatchObject({
    checked: true,
  })
  act(() => jest.advanceTimersByTime(1000))
  expect(onToggle).not.toHaveBeenCalled()
})

test("reduced motion: no burst, and the toggle commits at once", () => {
  mockMotion.reduced = true
  const onToggle = jest.fn()
  render(check({ onToggle }), { wrapper })
  fireEvent.press(screen.getByRole("checkbox"))
  expect(onToggle).toHaveBeenCalledTimes(1)
  expect(burst()).toHaveLength(0)
  expect(success()).toBe(1)
})

test("swiping a task complete bursts its check with one haptic", () => {
  const task = TA.createTask({ title: "Pay rent", source: "manual" })
  render(<TaskRow task={task} />, { wrapper })
  fireEvent.press(screen.getByTestId("swipe-complete"))
  expect(burst()).toHaveLength(1)
  // The swipe's own success buzz; the check stays quiet.
  expect(success()).toBe(1)
  act(() => jest.advanceTimersByTime(400))
  expect(tasksStore.get().tasks[0].status).toBe("done")
  expect(toast).toHaveBeenCalledWith("Task complete", expect.anything())
})

test("the streak chip bumps and counts up when the streak grows, not down", () => {
  const view = render(<StreakChip streak={4} />, { wrapper })
  expect(screen.getByText("4")).toBeTruthy()
  view.rerender(<StreakChip streak={5} />)
  act(() => jest.advanceTimersByTime(1000))
  expect(screen.getByLabelText("5-day streak")).toBeTruthy()
  view.rerender(<StreakChip streak={3} />)
  expect(screen.getByLabelText("3-day streak")).toBeTruthy()
})

test("completing the last habit shows the all-done moment once per day", () => {
  const a = HA.createHabit({ name: "Walk", icon: "🚶" })
  HA.createHabit({ name: "Read", icon: "📖" })
  HA.checkHabit(a.id)
  render(<HabitsCard />, { wrapper })
  expect(screen.queryByText("All habits done today")).toBeNull()
  fireEvent.press(screen.getByRole("checkbox", { name: "Complete Read" }))
  act(() => jest.advanceTimersByTime(400))
  expect(screen.getByText("All habits done today")).toBeTruthy()
  expect(mockStorage.get("sop:celebrated:habits")).toBeTruthy()
  act(() => jest.advanceTimersByTime(200))
  expect(Haptics.impactAsync).toHaveBeenCalledWith("medium")
  const buzz = success()
  // Reopen and redo the same day: the banner returns without replaying.
  fireEvent.press(screen.getByText("DONE · 2"))
  fireEvent.press(screen.getByRole("checkbox", { name: "Reopen Read" }))
  act(() => jest.advanceTimersByTime(400))
  expect(screen.queryByText("All habits done today")).toBeNull()
  fireEvent.press(screen.getByRole("checkbox", { name: "Complete Read" }))
  act(() => jest.advanceTimersByTime(400))
  expect(screen.getByText("All habits done today")).toBeTruthy()
  expect(success()).toBe(buzz + 1)
  expect(Haptics.impactAsync).toHaveBeenCalledTimes(2)
})

test("habits completed elsewhere (a pull) do not celebrate", () => {
  const a = HA.createHabit({ name: "Walk", icon: "🚶" })
  render(<HabitsCard />, { wrapper })
  act(() => jest.advanceTimersByTime(5000))
  act(() => {
    HA.checkHabit(a.id)
  })
  expect(screen.queryByText("All habits done today")).toBeNull()
  expect(mockStorage.get("sop:celebrated:habits")).toBeUndefined()
})

test("clearing today's last task pulses the ring once per day", () => {
  const task = TA.createTask({
    title: "Pay rent",
    source: "manual",
    dueDate: dayKey(),
  })
  render(<TaskPlanPanel />, { wrapper })
  expect(screen.queryByTestId("tasks-clear")).toBeNull()
  fireEvent.press(screen.getByRole("checkbox", { name: "Done" }))
  act(() => jest.advanceTimersByTime(400))
  expect(screen.getByTestId("tasks-clear")).toBeTruthy()
  expect(screen.getByText("Today's clear")).toBeTruthy()
  expect(mockStorage.get("sop:celebrated:tasks")).toBeTruthy()
  act(() => {
    TA.uncompleteTask(task.id)
  })
  act(() => {
    TA.completeTask(task.id)
  })
  expect(screen.queryByTestId("tasks-clear")).toBeNull()
})

test("task detail completes through an accessible animated check", () => {
  const task = TA.createTask({ title: "Pay rent", source: "manual" })
  render(<TaskDetail id={task.id} />, { wrapper })
  fireEvent.press(screen.getByRole("checkbox", { name: "Complete" }))
  expect(burst()).toHaveLength(1)
  act(() => jest.advanceTimersByTime(400))
  expect(tasksStore.get().tasks[0].status).toBe("done")
  expect(toast).toHaveBeenCalledWith("Task complete", expect.anything())
})
