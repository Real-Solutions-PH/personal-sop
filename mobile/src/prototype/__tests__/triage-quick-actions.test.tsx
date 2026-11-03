// Triage: every overdue row carries one-tap Done, Today and Tomorrow, and a
// More that opens the rest of its actions. Delete and picking a date stay
// inside More, never in the quick row. Each tap acts at once with an Undo.
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

const { TaskPlanPanel } =
  require("../screens/plan") as typeof import("../screens/plan")
const L = require("@domain/tasks/logic") as typeof import("@domain/tasks/logic")
const { TaskRow } =
  require("../screens/tasks") as typeof import("../screens/tasks")
const { completedRecently } = require("../motion") as typeof import("../motion")

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 44, left: 0, right: 0, bottom: 34 },
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
)
const LONG =
  "Renew the car registration at the LTO office before the late fee kicks in next month"

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
const lateDay = () => L.addDays(L.today(), -3)

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "setImmediate"] })
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  mockToast.mockClear()
  mockSuccess.mockClear()
  tasksStore.set((s) => ({
    ...s,
    tasks: [
      task("a", { title: LONG, dueDate: lateDay(), dueTime: "09:00" }),
      task("b", { title: "Pay the plumber", dueDate: lateDay() }),
    ],
  }))
})
afterEach(() => jest.useRealTimers())

const openTriage = () => {
  render(<TaskPlanPanel />, { wrapper })
  fireEvent.press(screen.getByText("Triage"))
}
const quick = (verb: string, title: string) =>
  screen.getByRole("button", { name: `${verb}: ${title}` })
const lastUndo = () => {
  const call = mockToast.mock.calls.at(-1)
  return call?.[1]?.action as { label: string; onClick: () => void }
}

it("each overdue row offers Done, Today, Tomorrow and More, one tap each", () => {
  openTriage()
  for (const title of [LONG, "Pay the plumber"])
    for (const verb of ["Done", "Today", "Tomorrow", "More actions"])
      expect(quick(verb, title)).toBeTruthy()
})

it("the quick row has no Delete and no date picker", () => {
  openTriage()
  expect(screen.queryByRole("button", { name: /^Delete/ })).toBeNull()
  expect(screen.queryByRole("button", { name: /date/i })).toBeNull()
})

it("a long title is shown whole", () => {
  openTriage()
  for (const node of screen.getAllByText(LONG))
    expect(node.props.numberOfLines).toBeUndefined()
})

it("Done completes it at once and the row leaves, with Undo", () => {
  openTriage()
  fireEvent.press(quick("Done", "Pay the plumber"))
  expect(get("b")?.status).toBe("done")
  expect(
    screen.queryByRole("button", { name: "Done: Pay the plumber" }),
  ).toBeNull()
  expect(lastUndo().label).toBe("Undo")
  act(() => lastUndo().onClick())
  expect(get("b")?.status).toBe("open")
})

it("Today moves it by the today rule (a past time is dropped), with Undo", () => {
  openTriage()
  fireEvent.press(quick("Today", LONG))
  expect(get("a")).toMatchObject({ dueDate: L.today(), dueTime: null })
  expect(L.isOverdue(get("a") as Task)).toBe(false)
  act(() => lastUndo().onClick())
  expect(get("a")).toMatchObject({ dueDate: lateDay(), dueTime: "09:00" })
})

it("Tomorrow moves it, with Undo", () => {
  openTriage()
  fireEvent.press(quick("Tomorrow", "Pay the plumber"))
  expect(get("b")?.dueDate).toBe(L.addDays(L.today(), 1))
  act(() => lastUndo().onClick())
  expect(get("b")?.dueDate).toBe(lateDay())
})

it("More opens the task's full actions, Delete included", () => {
  openTriage()
  fireEvent.press(quick("More actions", "Pay the plumber"))
  expect(screen.getByText("Task actions")).toBeTruthy()
  expect(screen.getByText("Delete")).toBeTruthy()
})

it("Done buzzes once and counts toward an all-done moment; a second tap does nothing", () => {
  openTriage()
  const done = quick("Done", "Pay the plumber")
  // Both presses before React re-renders, as two fast taps would land.
  act(() => {
    fireEvent.press(done)
    fireEvent.press(done)
  })
  expect(mockSuccess).toHaveBeenCalledTimes(1)
  expect(
    mockToast.mock.calls.filter((c) => c[0] === "Task complete"),
  ).toHaveLength(1)
  expect(completedRecently()).toBe(true)
})

it("Today keeps a time still ahead today", () => {
  tasksStore.set((s) => ({
    ...s,
    tasks: [
      task("c", { title: "Call mum", dueDate: lateDay(), dueTime: "19:00" }),
    ],
  }))
  openTriage()
  fireEvent.press(quick("Today", "Call mum"))
  expect(get("c")).toMatchObject({ dueDate: L.today(), dueTime: "19:00" })
})

it("rows outside triage keep their actions button and no quick row", () => {
  const t = get("b") as Task
  render(<TaskRow task={t} compact showActions />, { wrapper })
  expect(screen.getByLabelText("Actions for Pay the plumber")).toBeTruthy()
  expect(
    screen.queryByRole("button", { name: "Done: Pay the plumber" }),
  ).toBeNull()
})

it("the actions sheet's Tomorrow now has an Undo too", () => {
  const t = get("b") as Task
  render(<TaskRow task={t} compact showActions />, { wrapper })
  fireEvent.press(screen.getByLabelText("Actions for Pay the plumber"))
  fireEvent.press(screen.getByText("Tomorrow"))
  expect(get("b")?.dueDate).toBe(L.addDays(L.today(), 1))
  expect(mockToast).toHaveBeenCalledWith(
    "Moved to tomorrow",
    expect.objectContaining({
      action: expect.objectContaining({ label: "Undo" }),
    }),
  )
})
