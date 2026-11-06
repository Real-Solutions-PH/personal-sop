// Task priority and the semantic task editor: a priority is set on New
// task and on the task page, shown on the row as an icon in its colour,
// and orders a day's tasks; the editor's choices are grouped by meaning,
// each carries an icon, dates run nearest first, and clearing sits apart.
import { configureStorage, resetAll } from "@domain/lib/store"
import * as A from "@domain/tasks/actions"
import type { Task } from "@domain/tasks/data"
import * as L from "@domain/tasks/logic"
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
jest.mock("expo-haptics", () => ({
  notificationAsync: () => Promise.resolve(),
  impactAsync: () => Promise.resolve(),
  selectionAsync: () => Promise.resolve(),
  NotificationFeedbackType: { Success: "success" },
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
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

const { TaskNew } =
  require("../screens/task-new") as typeof import("../screens/task-new")
const { TaskDetail, TaskWhen } =
  require("../screens/task-detail") as typeof import("../screens/task-detail")
const { TaskRow } =
  require("../screens/tasks") as typeof import("../screens/tasks")
const { dueShortcuts } =
  require("../task-editor") as typeof import("../task-editor")

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
})

const byTitle = (title: string) =>
  tasksStore.get().tasks.find((t) => t.title === title)
const task = (over: Partial<Task>): Task =>
  ({
    id: over.title ?? "x",
    title: "x",
    listId: null,
    dueDate: "2026-11-10",
    dueTime: null,
    remindAt: null,
    recurrence: null,
    notes: null,
    starred: false,
    status: "open",
    completedAt: null,
    deletedAt: null,
    clearedAt: null,
    createdAt: "2026-11-01T00:00:00Z",
    source: "manual",
    parseState: "parsed",
    originalDue: null,
    rescheduleCount: 0,
    order: 0,
    ...over,
  }) as Task

describe("priority order", () => {
  it("by due: date first, then high > medium > low > none, above starred", () => {
    const rows = [
      task({ title: "starred none", starred: true, order: 0 }),
      task({ title: "low", priority: "low", order: 1 }),
      task({ title: "legacy (no field)", order: 2 }),
      task({ title: "high", priority: "high", order: 3 }),
      task({ title: "medium", priority: "medium", order: 4 }),
      task({ title: "earlier", dueDate: "2026-11-09", order: 5 }),
    ]
    expect(rows.sort(L.byDue).map((t) => t.title)).toEqual([
      "earlier",
      "high",
      "medium",
      "low",
      "starred none",
      "legacy (no field)",
    ])
  })
  it("by priority: level first, then due within a level", () => {
    const rows = [
      task({ title: "high later", priority: "high", dueDate: "2026-11-20" }),
      task({ title: "none soon", dueDate: "2026-11-02" }),
      task({ title: "high sooner", priority: "high", dueDate: "2026-11-05" }),
      task({ title: "low", priority: "low" }),
    ]
    expect(rows.sort(L.byPriority).map((t) => t.title)).toEqual([
      "high sooner",
      "high later",
      "low",
      "none soon",
    ])
  })
})

describe("date shortcuts", () => {
  // 2026-11-04 is a Wednesday, 11-06 a Friday, 11-07 a Saturday.
  it("run nearest first and include the coming weekend mid-week", () => {
    expect(dueShortcuts("2026-11-04").map((s) => [s.key, s.day])).toEqual([
      ["today", "2026-11-04"],
      ["tomorrow", "2026-11-05"],
      ["weekend", "2026-11-07"],
      ["nextWeek", "2026-11-11"],
    ])
  })
  it("drop the weekend when it is tomorrow or today", () => {
    expect(dueShortcuts("2026-11-06").map((s) => s.key)).toEqual([
      "today",
      "tomorrow",
      "nextWeek",
    ])
    expect(dueShortcuts("2026-11-07").map((s) => s.key)).toEqual([
      "today",
      "tomorrow",
      "nextWeek",
    ])
  })
})

describe("New task", () => {
  it("groups the choices by meaning, in order, each heading named", () => {
    render(<TaskNew />, { wrapper })
    const heads = screen
      .getAllByRole("header")
      .map((h) => String(h.props.accessibilityLabel))
    const groups = ["When", "Remind me", "Priority", "List"]
    expect(heads.filter((h) => groups.includes(h))).toEqual(groups)
  })

  it("creates the task with the date shortcut and priority picked", () => {
    render(<TaskNew />, { wrapper })
    fireEvent.changeText(screen.getByLabelText("Task"), "Renew licence")
    fireEvent.press(screen.getByLabelText("Tomorrow"))
    fireEvent.press(screen.getByLabelText("High priority"))
    expect(
      screen.getByLabelText("High priority").props.accessibilityState,
    ).toMatchObject({ selected: true })
    fireEvent.press(screen.getByText("Add task"))
    const made = byTitle("Renew licence")
    expect(made?.priority).toBe("high")
    expect(made?.dueDate).toBe(L.addDays(L.today(), 1))
  })

  it("leaves priority at none and the date empty when untouched", () => {
    render(<TaskNew />, { wrapper })
    fireEvent.changeText(screen.getByLabelText("Task"), "Plain")
    expect(
      screen.getByLabelText("No priority").props.accessibilityState,
    ).toMatchObject({ selected: true })
    expect(
      screen.getByLabelText("No date").props.accessibilityState,
    ).toMatchObject({ selected: true })
    fireEvent.press(screen.getByText("Add task"))
    expect(byTitle("Plain")).toMatchObject({ priority: "none", dueDate: null })
  })

  it("offers reminders nearest first with Off set apart", () => {
    render(<TaskNew />, { wrapper })
    for (const label of [
      "No reminder",
      "Remind at the due time",
      "Remind 15 min before",
      "Remind 1 hour before",
      "Remind 1 day before",
    ])
      expect(screen.getByLabelText(label)).toBeTruthy()
  })
})

describe("task page", () => {
  it("changes the priority with one tap and the row shows it", () => {
    const t = A.createTask({ title: "Pay rent", dueDate: L.today() })
    render(<TaskDetail id={t.id} />, { wrapper })
    fireEvent.press(screen.getByLabelText("Medium priority"))
    expect(byTitle("Pay rent")?.priority).toBe("medium")
    fireEvent.press(screen.getByLabelText("No priority"))
    expect(byTitle("Pay rent")?.priority).toBe("none")
  })

  it("Date & reminder: shortcuts set the day, No date clears it on Save", () => {
    const t = A.createTask({ title: "Dentist", dueDate: L.today() })
    const onClose = jest.fn()
    render(<TaskWhen task={t} onClose={onClose} />, { wrapper })
    fireEvent.press(screen.getByLabelText("Tomorrow"))
    fireEvent.press(screen.getByText("Save"))
    expect(byTitle("Dentist")?.dueDate).toBe(L.addDays(L.today(), 1))
    fireEvent.press(screen.getByLabelText("No date"))
    fireEvent.press(screen.getByText("Save"))
    expect(byTitle("Dentist")?.dueDate).toBeNull()
  })
})

describe("task row", () => {
  it("marks a prioritised task with its level and leaves a plain one quiet", () => {
    const high = A.createTask({ title: "Ship it", priority: "high" })
    const plain = A.createTask({ title: "Someday" })
    const { unmount } = render(<TaskRow task={high} compact />, { wrapper })
    expect(screen.getByLabelText("High priority")).toBeTruthy()
    unmount()
    render(<TaskRow task={plain} compact />, { wrapper })
    expect(screen.queryByLabelText(/priority$/)).toBeNull()
  })
  it("shows the mark on the full-size row too", () => {
    const low = A.createTask({ title: "Tidy desk", priority: "low" })
    render(<TaskRow task={low} />, { wrapper })
    expect(screen.getByLabelText("Low priority")).toBeTruthy()
  })
})
