import { configureStorage, resetAll } from "@domain/lib/store"
import * as A from "@domain/tasks/actions"
import type { TaskList } from "@domain/tasks/data"
import { tasksStore } from "@domain/tasks/store"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { toast } from "sonner-native"
import { syncReady } from "@/live/ready"
import { TaskLists } from "../screens/task-lists"
import { TaskNew } from "../screens/task-new"
import { TaskRow } from "../screens/tasks"

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
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
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

const names = () => tasksStore.get().lists.map((l) => l.name)
const list = (name: string, extra: Partial<TaskList> = {}): TaskList => ({
  ...A.createList({ name, kind: "standard", color: "tsk", icon: "list" }),
  ...extra,
})

test("no lists: a dimmed preview of the three and one button that adds them", () => {
  render(<TaskLists />, { wrapper })
  // Dimmed and hidden from VoiceOver: the preview is not a control.
  const hidden = { includeHiddenElements: true }
  expect(screen.queryByText("Work")).toBeNull()
  expect(screen.getByText("Work", hidden)).toBeTruthy()
  expect(screen.getByText("Groceries", hidden)).toBeTruthy()
  fireEvent.press(screen.getByText("Add Work, Life and Groceries"))
  expect(names()).toEqual(["Work", "Life", "Groceries"])
  expect(tasksStore.get().lists[2].kind).toBe("shopping")
  expect(toast.success).toHaveBeenCalledWith("Lists added")
})

test("the starter button waits for the first pull", () => {
  syncReady.setState({ ready: false })
  render(<TaskLists />, { wrapper })
  expect(screen.queryByText("Add Work, Life and Groceries")).toBeNull()
  act(() => syncReady.setState({ ready: true }))
  expect(screen.getByText("Add Work, Life and Groceries")).toBeTruthy()
})

test("starter lists skip a name already taken, in any case", () => {
  const work = list("work")
  A.setListArchived(work.id, true)
  A.addStarterLists()
  expect(names()).toEqual(["work", "Life", "Groceries"])
})

test("Move to list moves the task, toasts, and Undo puts it back", () => {
  const life = list("Life")
  const task = A.createTask({ title: "Pay rent", source: "manual" })
  render(<TaskRow task={task} />, { wrapper })
  fireEvent(screen.getByText("Pay rent"), "longPress")
  fireEvent.press(screen.getByText("Move to list…"))
  expect(
    screen.getByRole("radio", { name: "Inbox" }).props.accessibilityState,
  ).toMatchObject({ selected: true })
  fireEvent.press(screen.getByRole("radio", { name: "Life" }))
  expect(tasksStore.get().tasks[0].listId).toBe(life.id)
  const [message, options] = (toast as unknown as jest.Mock).mock.calls[0]
  expect(message).toBe("Moved to Life")
  act(() => options.action.onClick())
  expect(tasksStore.get().tasks[0].listId).toBeNull()
})

test("a list deleted elsewhere while choosing leaves the task where it was", () => {
  const life = list("Life")
  const task = A.createTask({ title: "Pay rent", source: "manual" })
  render(<TaskRow task={task} />, { wrapper })
  fireEvent(screen.getByText("Pay rent"), "longPress")
  fireEvent.press(screen.getByText("Move to list…"))
  act(() => A.deleteList(life.id, "inbox"))
  // The chooser re-renders without it; a stale press still fails safely.
  expect(screen.queryByRole("radio", { name: "Life" })).toBeNull()
  expect(tasksStore.get().tasks[0].listId).toBeNull()
})

test("New task shows the list picker with no lists, and New list…", () => {
  render(<TaskNew />, { wrapper })
  expect(screen.getByText("Inbox")).toBeTruthy()
  fireEvent.press(screen.getByText("New list…"))
  fireEvent.changeText(screen.getByLabelText("List name"), "Side hustle")
  fireEvent.press(screen.getByText("Create list"))
  expect(names()).toEqual(["Side hustle"])
  fireEvent.changeText(screen.getByLabelText("Task"), "Invoice client")
  fireEvent.press(screen.getByRole("button", { name: "Add task" }))
  const made = tasksStore.get().tasks.find((t) => t.title === "Invoice client")
  expect(made?.listId).toBe(tasksStore.get().lists[0].id)
})

test("capture routes by list name when list ids are server ids", () => {
  const groceries = A.createList({
    name: "Groceries",
    kind: "shopping",
    color: "fit",
    icon: "cart",
  })
  const work = list("Work")
  A.captureTasks("buy eggs, email client")
  const by = Object.fromEntries(
    tasksStore.get().tasks.map((t) => [t.title.toLowerCase(), t.listId]),
  )
  expect(groceries.id).not.toBe("groceries")
  expect(by.eggs).toBe(groceries.id)
  expect(by["email client"]).toBe(work.id)
})

test("groceries falls back to the first shopping list", () => {
  const shop = A.createList({
    name: "Market",
    kind: "shopping",
    color: "fit",
    icon: "cart",
  })
  expect(A.listKeys(tasksStore.get().lists)).toEqual({ groceries: shop.id })
})
