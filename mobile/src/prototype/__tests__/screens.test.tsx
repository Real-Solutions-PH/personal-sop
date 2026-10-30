import { startFresh } from "@domain/finance/actions"
import { finStore } from "@domain/finance/store"
import { startRoutine, startTimer } from "@domain/habits/actions"
import { habitsStore } from "@domain/habits/store"
import { dayKey } from "@domain/lib/day"
import { configureStorage, resetAll } from "@domain/lib/store"
import { tasksStore } from "@domain/tasks/store"
import {
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react-native"
import type { ReactNode } from "react"
import { StyleSheet } from "react-native"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { RecordEditor } from "../screens/finance"
import { FinanceHome } from "../screens/finance-home"
import { HabitForm } from "../screens/habits"
import { HabitsHome } from "../screens/habits-home"
import { TaskNew } from "../screens/task-new"
import { Tasks } from "../screens/tasks"
import { fonts } from "../theme"

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
  interpolate: (_: number, __: number[], output: number[]) => output[0],
  interpolateColor: (_: number, __: number[], output: string[]) => output[0],
  runOnJS: (fn: unknown) => fn,
  useReducedMotion: () => true,
}))
jest.mock("react-native-gesture-handler", () => {
  // Chainable no-op gesture builder; the detector just renders its child.
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
jest.mock("../media", () => ({ exportCsv: jest.fn(), pickPhoto: jest.fn() }))
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
test("the task form creates a task that can be completed from the native list", () => {
  const view = render(<TaskNew />, { wrapper })
  expect(screen.getByText("New task")).toBeTruthy()
  fireEvent.changeText(screen.getByLabelText("Task"), "Native test task")
  fireEvent.press(screen.getByRole("button", { name: "Add task" }))
  const task = tasksStore
    .get()
    .tasks.find((t) => t.title === "Native test task")
  expect(task).toMatchObject({ source: "manual", dueDate: null })
  view.unmount()
  const list = render(<Tasks />, { wrapper })
  fireEvent.press(screen.getByRole("button", { name: "Search and sort tasks" }))
  fireEvent.changeText(
    screen.getByLabelText("Search tasks"),
    "Native test task",
  )
  expect(screen.getByText("Native test task")).toBeTruthy()
  fireEvent.press(screen.getByRole("checkbox", { name: "Done" }))
  expect(tasksStore.get().tasks.find((t) => t.id === task?.id)?.status).toBe(
    "done",
  )
  list.unmount()
})
test("habit editor rejects an empty name and persists a named habit", () => {
  render(<HabitForm />, { wrapper })
  const count = habitsStore.get().habits.length
  fireEvent.press(screen.getByText("Create habit"))
  expect(habitsStore.get().habits).toHaveLength(count)
  fireEvent.changeText(screen.getByLabelText("Name"), "Native daily walk")
  fireEvent.press(screen.getByText("Create habit"))
  expect(
    habitsStore.get().habits.find((h) => h.name === "Native daily walk"),
  ).toBeDefined()
})
test("record editor does not save an invalid amount", () => {
  render(<RecordEditor open onClose={() => {}} />, { wrapper })
  const count = finStore.get().records.length
  fireEvent.changeText(screen.getByLabelText("Amount ₱"), "-50")
  fireEvent.press(screen.getByText("Save"))
  expect(finStore.get().records).toHaveLength(count)
})

test("Today's plan ticks an item done in one tap and hides completed setup", () => {
  jest.useFakeTimers({ now: new Date(`${dayKey()}T09:30:00`) })
  // Routines are weekday-specific; drop them so "next up" is a habit or
  // task on every day of the week.
  habitsStore.set((s) => ({ ...s, routines: [] }))
  const { Today } = require("../screens/today")
  const view = render(<Today />, { wrapper })
  expect(screen.queryByText("Finish setting up")).toBeNull()
  expect(screen.queryByText("Make this yours")).toBeNull()
  // Each habit and task on today's plan has its own done button.
  const [next] = screen.getAllByRole("button", { name: /^Mark .* done$/ })
  {
    const before =
      habitsStore.get().logs.filter((l) => l.status === "done").length +
      tasksStore.get().tasks.filter((t) => t.status === "done").length
    fireEvent.press(next)
    const after =
      habitsStore.get().logs.filter((l) => l.status === "done").length +
      tasksStore.get().tasks.filter((t) => t.status === "done").length
    expect(after).toBe(before + 1)
  }
  view.unmount()
  jest.useRealTimers()
})

test("Plan exposes the full overdue queue separately from today's preview", () => {
  const { TaskPlanPanel } = require("../screens/plan")
  const view = render(<TaskPlanPanel />, { wrapper })
  expect(screen.getByText(/more overdue/)).toBeTruthy()
  fireEvent.press(screen.getByRole("tab", { name: "overdue" }))
  expect(screen.queryByText(/more overdue/)).toBeNull()
  expect(screen.getByText(/slipped/)).toBeTruthy()
  view.unmount()
})

test("Stats area selection exposes the selected area metrics", () => {
  const { StatsHome } = require("../screens/stats-home")
  const view = render(<StatsHome />, { wrapper })
  fireEvent.press(
    screen.getByRole("button", { name: /^Routines:.*Show details$/ }),
  )
  expect(screen.getByText("Routines completed")).toBeTruthy()
  expect(screen.getByText("Runs finished")).toBeTruthy()
  view.unmount()
})

test("Stats miss tiles sit three to a row with one-line labels", () => {
  const { MissTiles } = require("../screens/stats-home")
  const keys = ["habits", "tasks", "fitness", "nutrition", "focus", "finance"]
  const view = render(
    <MissTiles tiles={keys.map((key, i) => ({ key, count: i }))} />,
    { wrapper },
  )
  const rows = screen.getAllByTestId("miss-row")
  expect(rows).toHaveLength(2)
  for (const row of rows)
    expect(within(row).getAllByLabelText(/: \d+ miss(es)?$/)).toHaveLength(3)
  const label = screen.getByText("Nutrition")
  expect(label.props.numberOfLines).toBe(1)
  expect(label.props.maxFontSizeMultiplier).toBeLessThanOrEqual(1.6)
  view.unmount()
  // A short last row keeps the same tile width via spacers.
  render(
    <MissTiles tiles={keys.slice(0, 4).map((key) => ({ key, count: 1 }))} />,
    { wrapper },
  )
  const [, last] = screen.getAllByTestId("miss-row")
  expect(within(last).getAllByLabelText(/: 1 miss$/)).toHaveLength(1)
  expect(within(last).getAllByTestId("miss-spacer")).toHaveLength(2)
})

test("a task added from a calendar day keeps that day, and an empty name is refused", () => {
  const view = render(<TaskNew day="2026-10-05" />, { wrapper })
  const before = tasksStore.get().tasks.length
  fireEvent.press(screen.getByRole("button", { name: "Add task" }))
  expect(screen.getByText("Give the task a name")).toBeTruthy()
  expect(tasksStore.get().tasks.length).toBe(before)
  fireEvent.changeText(screen.getByLabelText("Task"), "Calendar capture check")
  fireEvent.press(screen.getByRole("button", { name: "Add task" }))
  const task = tasksStore
    .get()
    .tasks.find((t) => t.title === "Calendar capture check")!
  expect(task.dueDate).toBe("2026-10-05")
  expect(task.listId).toBeNull()
  view.unmount()
  const inbox = render(<Tasks listId="inbox" />, { wrapper })
  expect(screen.getByText("Calendar capture check")).toBeTruthy()
  inbox.unmount()
  render(<Tasks listId="starred" />, { wrapper })
  expect(screen.queryByText("Calendar capture check")).toBeNull()
})

test("routine detail keeps compact duration controls and applies step changes", () => {
  const { RoutineDetail } = require("../screens/routines")
  render(<RoutineDetail id="r-morning" />, { wrapper })
  expect(screen.getByText("Completion 30d")).toBeTruthy()
  expect(screen.getByText("Pace vs plan")).toBeTruthy()
  const routine = habitsStore.get().routines.find((r) => r.id === "r-morning")!
  const step = routine.steps[0]
  const habit = habitsStore.get().habits.find((h) => h.id === step.habitId)!
  fireEvent.press(
    screen.getByRole("button", { name: `More time for ${habit.name}` }),
  )
  expect(
    habitsStore.get().routines.find((r) => r.id === routine.id)!.steps[0]
      .minutes,
  ).toBe(step.minutes + 1)
  fireEvent.press(screen.getByRole("button", { name: `Remove ${habit.name}` }))
  expect(
    habitsStore.get().routines.find((r) => r.id === routine.id)!.steps,
  ).toHaveLength(routine.steps.length - 1)
})

test("routine history summary honors the selected run", () => {
  const { RoutineSummary } = require("../screens/routines")
  const runs = habitsStore.get().runs.filter((r) => r.routineId === "r-morning")
  const selected = runs[0]
  render(<RoutineSummary id="r-morning" runId={selected.id} />, { wrapper })
  const date = new Date(`${selected.day}T12:00:00`).toLocaleDateString(
    "en-US",
    { weekday: "short", month: "short", day: "numeric" },
  )
  expect(screen.getByText(date)).toBeTruthy()
  expect(screen.getByText("Steps done")).toBeTruthy()
})

test("transaction editing preserves the local time and refund category", () => {
  const record = finStore.get().records.find((r) => r.type === "expense")!
  const at = new Date(`${dayKey()}T08:15:00`).toISOString()
  finStore.set((s) => ({
    ...s,
    records: s.records.map((r) =>
      r.id === record.id
        ? { ...r, type: "income", isRefund: true, categoryId: "food", at }
        : r,
    ),
  }))
  const refund = finStore.get().records.find((r) => r.id === record.id)!
  render(<RecordEditor open record={refund} onClose={() => {}} />, { wrapper })
  fireEvent.changeText(screen.getByLabelText("Amount ₱"), "125")
  fireEvent.press(screen.getByRole("button", { name: "Save" }))
  const saved = finStore.get().records.find((r) => r.id === record.id)!
  expect(saved).toMatchObject({
    type: "income",
    amount: 125,
    isRefund: true,
    categoryId: "food",
    at,
  })
})

test("new transactions require a category and reopening clears the draft", () => {
  const view = render(<RecordEditor open onClose={() => {}} />, { wrapper })
  const count = finStore.get().records.length
  fireEvent.changeText(screen.getByLabelText("Amount ₱"), "125")
  fireEvent.press(screen.getByRole("button", { name: "Save" }))
  expect(finStore.get().records).toHaveLength(count)
  expect(screen.getByText("Pick a category")).toBeTruthy()
  view.rerender(<RecordEditor open={false} onClose={() => {}} />)
  view.rerender(<RecordEditor open onClose={() => {}} />)
  expect(screen.getByLabelText("Amount ₱").props.value).toBe("")
})

test("finance with no accounts shows its real layout dimmed under one setup card", () => {
  startFresh()
  render(<FinanceHome />, { wrapper })
  expect(screen.getByText("Add your accounts")).toBeTruthy()
  expect(screen.getByRole("button", { name: "Set up Finance" })).toBeTruthy()
  // The page's own sections still render behind the card, hidden from
  // screen readers until there is data.
  expect(
    screen.getByText("Net worth", { includeHiddenElements: true }),
  ).toBeTruthy()
})
test("finance with accounts has no setup card", () => {
  render(<FinanceHome />, { wrapper })
  expect(screen.queryByText("Add your accounts")).toBeNull()
})
test("habits with none yet show the stats layout dimmed under one add card", () => {
  habitsStore.set((s) => ({ ...s, habits: [], logs: [] }))
  render(<HabitsHome />, { wrapper })
  expect(screen.getByText("No habits yet")).toBeTruthy()
  expect(screen.getByRole("button", { name: "Add a habit" })).toBeTruthy()
  expect(screen.getByText("Year", { includeHiddenElements: true })).toBeTruthy()
})

// iOS clips the tops of digits when a Text's lineHeight is at or below its
// font size; the big timer readouts had lineHeight 60 on a 60pt font.
test.each([
  ["habit timer", "HabitTimer", () => startTimer("h-meditate"), "h-meditate"],
  [
    "routine player",
    "RoutinePlayer",
    () => startRoutine("r-morning"),
    "r-morning",
  ],
])("the %s countdown has headroom and fits one line", (_, name, start, id) => {
  start()
  const Screen = require("../screens/habits")[name]
  render(<Screen id={id} />, { wrapper })
  const readout = screen.getByText(/^\+?(\d+:)?\d{2}:\d{2}$/)
  const style = StyleSheet.flatten(readout.props.style)
  expect(style.lineHeight).toBeGreaterThanOrEqual(style.fontSize * 1.2)
  expect(style.fontFamily).toBe(fonts.mono)
  expect(readout.props.numberOfLines).toBe(1)
  expect(readout.props.adjustsFontSizeToFit).toBe(true)
  expect(readout.props.maxFontSizeMultiplier).toBeLessThanOrEqual(1.5)
})
