// The Tasks page: a long title wraps instead of being cut, and the Done
// view lists what was finished, by day, with its time; a tick reopens it.
import { configureStorage, resetAll } from "@domain/lib/store"
import type { Task } from "@domain/tasks/data"
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
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
}))
jest.mock("expo-audio", () => ({}))
jest.mock("../media", () => ({ exportCsv: jest.fn(), pickPhoto: jest.fn() }))

const { TaskPlanPanel } =
  require("../screens/plan") as typeof import("../screens/plan")

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 44, left: 0, right: 0, bottom: 34 },
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
)
const LONG =
  "Call the pharmacy about the refill for the blood pressure medicine before they close"

const task = (id: string, extra: Partial<Task>) =>
  ({
    id,
    title: `Task ${id}`,
    listId: null,
    dueDate: null,
    dueTime: null,
    remindAt: null,
    recurrence: null,
    notes: null,
    starred: false,
    status: "open",
    completedAt: null,
    deletedAt: null,
    clearedAt: null,
    createdAt: new Date().toISOString(),
    source: "manual",
    parseState: "parsed",
    originalDue: null,
    rescheduleCount: 0,
    order: 0,
    ...extra,
  }) as Task

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
})

it("a long title is shown whole", () => {
  const { dayKey } = require("@domain/lib/day")
  tasksStore.set((s) => ({
    ...s,
    tasks: [task("a", { title: LONG, dueDate: dayKey() })],
  }))
  render(<TaskPlanPanel />, { wrapper })
  const title = screen.getByText(LONG)
  expect(title.props.numberOfLines).toBeUndefined()
})

it("Done lists finished tasks with their time, and a tick reopens one", () => {
  const done = new Date()
  done.setHours(15, 42, 0, 0)
  tasksStore.set((s) => ({
    ...s,
    tasks: [
      task("d", {
        title: "Renew passport",
        status: "done",
        completedAt: done.toISOString(),
      }),
      task("o", { title: "Still open" }),
    ],
  }))
  render(<TaskPlanPanel />, { wrapper })
  fireEvent.press(screen.getByText("Done"))
  expect(screen.getByText("Renew passport")).toBeTruthy()
  expect(screen.queryByText("Still open")).toBeNull()
  expect(screen.getByText(/^Done 3:42/)).toBeTruthy()
  jest.useFakeTimers()
  fireEvent.press(screen.getByLabelText("Reopen task"))
  // The tick commits after its short animation beat.
  act(() => jest.runOnlyPendingTimers())
  jest.useRealTimers()
  expect(tasksStore.get().tasks.find((x) => x.id === "d")?.status).toBe("open")
})

it("Done with nothing finished shows the dimmed preview and a way back", () => {
  tasksStore.set((s) => ({ ...s, tasks: [task("o", { title: "Open one" })] }))
  render(<TaskPlanPanel />, { wrapper })
  fireEvent.press(screen.getByText("Done"))
  expect(screen.getByText("Nothing done in the last two weeks")).toBeTruthy()
  expect(screen.getByText("See today's tasks")).toBeTruthy()
})
