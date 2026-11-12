// The Plan tab acts, not just shows: habits and tasks tick off on every
// segment with Today's feedback (the tick toast with Undo), the day lists
// what has no time first, and a bill due that day is paid or skipped in
// place, with Undo, and no toast.

import * as FA from "@domain/finance/actions"
import type { PlannedItem } from "@domain/finance/data"
import { finStore } from "@domain/finance/store"
import { createHabit } from "@domain/habits/actions"
import { lk, logIndex } from "@domain/habits/logic"
import { habitsStore } from "@domain/habits/store"
import { dayKey } from "@domain/lib/day"
import { configureStorage, resetAll } from "@domain/lib/store"
import type { Task } from "@domain/tasks/data"
import { tasksStore } from "@domain/tasks/store"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { toast } from "sonner-native"
import { MOTION } from "../motion"

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
  Toaster: () => null,
}))
jest.mock("expo-audio", () => ({}))
jest.mock("../media", () => ({ exportCsv: jest.fn(), pickPhoto: jest.fn() }))

const { TaskPlanPanel, HabitPlanPanel, CalendarPanel } =
  require("../screens/plan") as typeof import("../screens/plan")

const metrics = {
  frame: { x: 0, y: 0, width: 375, height: 812 },
  insets: { top: 44, left: 0, right: 0, bottom: 34 },
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
)
const toastMock = toast as unknown as jest.Mock
const EVERY_DAY = [{ days: [0, 1, 2, 3, 4, 5, 6], time: "09:00" }]
const ANY_DAY = [{ days: [0, 1, 2, 3, 4, 5, 6] }]
const beat = () => act(() => jest.advanceTimersByTime(MOTION.commit + 40))
const logOf = (id: string) =>
  logIndex(habitsStore.get().logs).get(lk(id, dayKey()))

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

function bill(extra: Partial<PlannedItem> = {}): PlannedItem {
  const s = finStore.get()
  return FA.addPlanned({
    name: "Electric bill",
    type: "expense",
    amount: 2450,
    estimated: false,
    accountId: s.accounts[0].id,
    categoryId: s.categories.find((c) => c.kind === "expense")?.id,
    schedule: { kind: "once", date: dayKey() },
    end: { kind: "never" },
    autoLog: false,
    isWhatIf: false,
    inProjection: true,
    ...extra,
  })
}

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  habitsStore.set((s) => ({ ...s, habits: [], logs: [], routines: [] }))
  tasksStore.set((s) => ({ ...s, tasks: [] }))
  finStore.set((s) => ({ ...s, planned: [] }))
  jest.clearAllMocks()
  jest.useFakeTimers()
})
afterEach(() => jest.useRealTimers())

describe("Tasks segment", () => {
  it("lists open tasks with no date under Anytime in the Today view", () => {
    tasksStore.set((s) => ({
      ...s,
      tasks: [
        task("a", { title: "Buy stamps" }),
        task("b", { title: "Due one", dueDate: dayKey() }),
        task("c", { title: "Done long ago", status: "done" }),
      ],
    }))
    render(<TaskPlanPanel />, { wrapper })
    expect(screen.getByText("Anytime · 1")).toBeTruthy()
    expect(screen.getByText("Buy stamps")).toBeTruthy()
    expect(screen.queryByText("Done long ago")).toBeNull()
  })
})

describe("Habits segment", () => {
  it("ticks today's habit in place, with the tick toast and Undo", () => {
    const h = createHabit({ name: "Stretch", icon: "🧘", schedule: EVERY_DAY })
    render(<HabitPlanPanel />, { wrapper })
    fireEvent.press(screen.getByLabelText("Complete Stretch"))
    beat()
    expect(logOf(h.id)?.status).toBe("done")
    expect(toastMock).toHaveBeenCalledWith(
      "Habit checked",
      expect.objectContaining({
        action: expect.objectContaining({ label: "Undo" }),
      }),
    )
    act(() => toastMock.mock.calls[0][1].action.onClick())
    expect(logOf(h.id)).toBeUndefined()
  })
})

describe("Calendar segment", () => {
  it("shows the Anytime block first in the day", () => {
    createHabit({ name: "Journal", schedule: ANY_DAY })
    createHabit({ name: "Run", schedule: EVERY_DAY })
    render(<CalendarPanel />, { wrapper })
    const order = screen
      .getAllByText(/^(Anytime|Early morning|Morning|Afternoon|Night)$/)
      .map((n) => n.props.children)
    expect(order[0]).toBe("Anytime")
    expect(order).toContain("Morning")
  })
  it("ticks a habit and a task from the day list", () => {
    const h = createHabit({ name: "Run", schedule: EVERY_DAY })
    tasksStore.set((s) => ({
      ...s,
      tasks: [task("t", { title: "Send invoice", dueDate: dayKey() })],
    }))
    render(<CalendarPanel />, { wrapper })
    fireEvent.press(screen.getByLabelText("Complete Run"))
    beat()
    expect(logOf(h.id)?.status).toBe("done")
    fireEvent.press(screen.getByLabelText("Complete Send invoice"))
    beat()
    expect(tasksStore.get().tasks.find((x) => x.id === "t")?.status).toBe(
      "done",
    )
    expect(toastMock.mock.calls.map((c) => c[0])).toEqual([
      "Habit checked",
      "Task complete",
    ])
  })
  it("a count habit steps by one from the day list", () => {
    const h = createHabit({
      name: "Water",
      type: "count",
      target: 2,
      step: 1,
      unit: "glasses",
      schedule: EVERY_DAY,
    })
    render(<CalendarPanel />, { wrapper })
    fireEvent.press(screen.getByLabelText("Add 1 glasses"))
    expect(logOf(h.id)?.value).toBe(1)
    expect(toastMock).not.toHaveBeenCalled()
    fireEvent.press(screen.getByLabelText("Add 1 glasses"))
    expect(logOf(h.id)?.status).toBe("done")
    expect(toastMock).toHaveBeenCalledWith("Water done", expect.anything())
  })
  it("a bill due today sits in Anytime and is skipped in place, with Undo", () => {
    const p = bill()
    render(<CalendarPanel />, { wrapper })
    expect(screen.getByText("Electric bill")).toBeTruthy()
    expect(screen.queryByText(/^Bills & paydays/)).toBeNull()
    fireEvent.press(screen.getByLabelText("Skip Electric bill"))
    expect(finStore.get().planned.find((x) => x.id === p.id)?.skipped).toEqual([
      dayKey(),
    ])
    expect(screen.getByText("Electric bill")).toBeTruthy()
    fireEvent.press(screen.getByLabelText("Undo skip of Electric bill"))
    expect(finStore.get().planned.find((x) => x.id === p.id)?.skipped).toEqual(
      [],
    )
    expect(toastMock).not.toHaveBeenCalled()
  })
  it("Paid opens the record editor for that date; a paid bill shows Undo", () => {
    const p = bill()
    render(<CalendarPanel />, { wrapper })
    fireEvent.press(screen.getByLabelText("Mark Electric bill paid"))
    expect(screen.getByText("Record Electric bill")).toBeTruthy()
    // The editor's own save, the last "Paid" on screen.
    fireEvent.press(screen.getAllByText("Paid").at(-1)!)
    act(() => jest.runOnlyPendingTimers())
    expect(
      finStore.get().records.filter((r) => r.plannedId === p.id),
    ).toHaveLength(1)
    expect(screen.getByLabelText("Undo paid of Electric bill")).toBeTruthy()
    fireEvent.press(screen.getByLabelText("Undo paid of Electric bill"))
    expect(finStore.get().records.some((r) => r.plannedId === p.id)).toBe(false)
    expect(toastMock).not.toHaveBeenCalled()
  })
})

test("a row's spoken name drops its emoji, variation selector and all", () => {
  const { spoken } =
    require("../screens/plan-day") as typeof import("../screens/plan-day")
  expect(spoken("🏋️ Morning workout")).toBe("Morning workout")
  expect(spoken("👩‍💻 Deep work")).toBe("Deep work")
  expect(spoken("Call Mama")).toBe("Call Mama")
})
