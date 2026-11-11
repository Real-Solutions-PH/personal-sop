// Quick-add syntax in the task fields: words set fields, chips show what
// each sets, and tapping a chip keeps the word as text.
import { configureStorage, resetAll } from "@domain/lib/store"
import * as A from "@domain/tasks/actions"
import type { TaskList } from "@domain/tasks/data"
import { tasksStore } from "@domain/tasks/store"
import { fireEvent, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { syncReady } from "@/live/ready"
import { TaskListPage } from "../screens/task-lists"
import { TaskNew } from "../screens/task-new"

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

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  tasksStore.set((s) => ({ ...s, lists: [], tasks: [], events: [] }))
  syncReady.setState({ ready: true })
  jest.clearAllMocks()
})

const list = (name: string, extra: Partial<TaskList> = {}): TaskList => ({
  ...A.createList({ name, kind: "standard", color: "tsk", icon: "list" }),
  ...extra,
})

const L = require("@domain/tasks/logic") as typeof import("@domain/tasks/logic")
const only = () => {
  const ts = tasksStore.get().tasks
  expect(ts).toHaveLength(1)
  return ts[0]
}

test("the list field sets date, time, priority and list from the words", () => {
  const work = list("Work")
  const home = list("Home")
  render(<TaskListPage id={work.id} />, { wrapper })
  const field = screen.getByLabelText("Add task")
  fireEvent.changeText(field, "Reply SOW tomorrow 3pm !high #home")
  // A chip per word, naming what it sets.
  expect(screen.getByText("Tomorrow")).toBeTruthy()
  expect(screen.getByText("3 PM")).toBeTruthy()
  expect(screen.getByText("High")).toBeTruthy()
  expect(screen.getByText("Home")).toBeTruthy()
  fireEvent(field, "submitEditing")
  expect(only()).toMatchObject({
    title: "Reply SOW",
    dueDate: L.addDays(L.today(), 1),
    dueTime: "15:00",
    priority: "high",
    listId: home.id,
  })
})

test("tapping a chip keeps its word as text and sets nothing", () => {
  const work = list("Work")
  render(<TaskListPage id={work.id} />, { wrapper })
  const field = screen.getByLabelText("Add task")
  fireEvent.changeText(field, "Watch tomorrow never dies !low")
  fireEvent.press(
    screen.getByRole("button", { name: /Tap to keep “tomorrow” as text/ }),
  )
  expect(screen.queryByText("Tomorrow")).toBeNull()
  fireEvent(field, "submitEditing")
  expect(only()).toMatchObject({
    title: "Watch tomorrow never dies",
    dueDate: null,
    priority: "low",
    listId: work.id,
  })
})

test("a line that is only syntax keeps its words as the title", () => {
  const work = list("Work")
  render(<TaskListPage id={work.id} />, { wrapper })
  const field = screen.getByLabelText("Add task")
  fireEvent.changeText(field, "tomorrow")
  fireEvent(field, "submitEditing")
  expect(only().title).toBe("tomorrow")
})

test("New task: the words fill the fields left unset", () => {
  const work = list("Work")
  render(<TaskNew />, { wrapper })
  fireEvent.changeText(
    screen.getByLabelText("Task"),
    "Ship deck fri !med #work",
  )
  expect(
    screen.getByRole("button", { name: /^Medium from “!med”/ }),
  ).toBeTruthy()
  fireEvent.press(screen.getByRole("button", { name: "Add task" }))
  const t = only()
  expect(t).toMatchObject({
    title: "Ship deck",
    priority: "medium",
    listId: work.id,
  })
  expect(new Date(`${t.dueDate}T12:00:00`).getDay()).toBe(5)
})

test("New task: a field set by hand wins and its word stays text", () => {
  render(<TaskNew />, { wrapper })
  fireEvent.changeText(screen.getByLabelText("Task"), "Ship deck !high")
  const chip = /^High from “!high”/
  expect(screen.getByRole("button", { name: chip })).toBeTruthy()
  fireEvent.press(screen.getByRole("button", { name: /^Low/ }))
  expect(screen.queryByRole("button", { name: chip })).toBeNull()
  fireEvent.press(screen.getByRole("button", { name: "Add task" }))
  expect(only()).toMatchObject({ title: "Ship deck !high", priority: "low" })
})

test("Return in the list field adds the task (the web types a newline)", () => {
  const work = list("Work")
  render(<TaskListPage id={work.id} />, { wrapper })
  fireEvent.changeText(screen.getByLabelText("Add task"), "Pay rent fri\n")
  expect(only()).toMatchObject({ title: "Pay rent", listId: work.id })
  expect(screen.getByLabelText("Add task").props.value ?? "").toBe("")
})

test("New task: typed words beat the day and list it was opened with", () => {
  const work = list("Work")
  const home = list("Home")
  render(<TaskNew listId={work.id} day={L.today()} />, { wrapper })
  fireEvent.changeText(screen.getByLabelText("Task"), "Call mom tomorrow #home")
  fireEvent.press(screen.getByRole("button", { name: "Add task" }))
  expect(only()).toMatchObject({
    title: "Call mom",
    dueDate: L.addDays(L.today(), 1),
    listId: home.id,
  })
})

test("New task: a line with no syntax saves exactly as typed", () => {
  render(<TaskNew />, { wrapper })
  fireEvent.changeText(screen.getByLabelText("Task"), "iPhone sign off on")
  fireEvent.press(screen.getByRole("button", { name: "Add task" }))
  expect(only().title).toBe("iPhone sign off on")
})
