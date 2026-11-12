// The task actions sheet: every action is an icon with a short word and a
// full accessible name, date actions share one colour, Delete sits apart,
// and Remove date shows only when the task has a date.
import { configureStorage, resetAll } from "@domain/lib/store"
import type { Task } from "@domain/tasks/data"
import { tasksStore } from "@domain/tasks/store"
import { fireEvent, render, screen } from "@testing-library/react-native"
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
const mockToast = jest.fn()
jest.mock("sonner-native", () => ({
  toast: Object.assign(mockToast, {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
}))
jest.mock("expo-audio", () => ({}))
const mockSuccess = jest.fn(() => Promise.resolve())
jest.mock("expo-haptics", () => ({
  notificationAsync: () => mockSuccess(),
  impactAsync: () => Promise.resolve(),
  selectionAsync: () => Promise.resolve(),
  NotificationFeedbackType: { Success: "success" },
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
}))
jest.mock("../media", () => ({ exportCsv: jest.fn(), pickPhoto: jest.fn() }))

const L = require("@domain/tasks/logic") as typeof import("@domain/tasks/logic")
const { TaskRow } =
  require("../screens/tasks") as typeof import("../screens/tasks")

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 44, left: 0, right: 0, bottom: 34 },
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
)

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

const NOW = new Date(2026, 10, 3, 15, 0, 0)
const get = (id: string) => tasksStore.get().tasks.find((x) => x.id === id)

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "setImmediate"] })
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  mockToast.mockClear()
  tasksStore.set((s) => ({
    ...s,
    tasks: [
      task("dated", {
        title: "Pay the plumber",
        dueDate: L.addDays(L.today(), 2),
        dueTime: "09:00",
        remindAt: new Date(2026, 10, 5, 8, 0).toISOString(),
      }),
      task("undated", { title: "Read a book" }),
      task("today", { title: "Call mom", dueDate: L.today() }),
    ],
  }))
})
afterEach(() => jest.useRealTimers())

const open = (id: string) => {
  const t = get(id) as Task
  render(<TaskRow task={t} compact showActions />, { wrapper })
  fireEvent.press(screen.getByLabelText(`Actions for ${t.title}`))
  expect(screen.getByText("Task actions")).toBeTruthy()
}
const action = (name: string) => screen.getByRole("button", { name })

it("names every action for screen readers", () => {
  open("dated")
  for (const name of [
    "Complete",
    "Star",
    "Duplicate",
    "Move to list",
    "Snooze 1 hour",
    "Tomorrow",
    "Remove date",
    "Delete",
  ])
    expect(action(name)).toBeTruthy()
})

it("Remove date clears the date, time and reminder and closes the sheet", () => {
  open("dated")
  fireEvent.press(action("Remove date"))
  expect(get("dated")).toMatchObject({
    dueDate: null,
    dueTime: null,
    remindAt: null,
  })
  expect(screen.queryByText("Task actions")).toBeNull()
})

it("a task with no date offers no Remove date", () => {
  open("undated")
  expect(screen.queryByRole("button", { name: "Remove date" })).toBeNull()
  expect(action("Tomorrow")).toBeTruthy()
})

it("a task due today offers Remove date", () => {
  open("today")
  expect(action("Remove date")).toBeTruthy()
})

it.each([
  ["Star", { starred: true }],
  ["Complete", { status: "done" }],
  ["Duplicate", {}],
  ["Delete", { status: "deleted" }],
] as const)("%s acts on the task", (name, after) => {
  open("undated")
  fireEvent.press(action(name))
  expect(get("undated")).toMatchObject(after)
  if (name === "Duplicate")
    expect(
      tasksStore.get().tasks.filter((x) => x.title === "Read a book"),
    ).toHaveLength(2)
})

it("Move to list swaps the sheet to the list chooser", () => {
  open("undated")
  fireEvent.press(action("Move to list"))
  expect(screen.getByText("Move to list")).toBeTruthy()
  expect(screen.getByText("Inbox")).toBeTruthy()
})

it("Remove date on a repeating task drops the repeat too", () => {
  tasksStore.set((s) => ({
    ...s,
    tasks: s.tasks.map((x) =>
      x.id === "dated"
        ? { ...x, recurrence: { rule: { kind: "daily" }, mode: "fixed" } }
        : x,
    ),
  }))
  open("dated")
  fireEvent.press(action("Remove date"))
  expect(get("dated")).toMatchObject({ dueDate: null, recurrence: null })
})
