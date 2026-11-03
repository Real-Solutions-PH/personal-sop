// A late task moves to today in one tap, from its actions sheet or all at
// once from triage. Its time of day stays when it is still ahead; a time
// already past today is dropped (with its reminder) rather than leaving the
// task late again the moment it arrives.
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
jest.mock("../media", () => ({ exportCsv: jest.fn(), pickPhoto: jest.fn() }))

const { TaskRow } =
  require("../screens/tasks") as typeof import("../screens/tasks")
const A =
  require("@domain/tasks/actions") as typeof import("@domain/tasks/actions")
const L = require("@domain/tasks/logic") as typeof import("@domain/tasks/logic")

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

// 3 PM local: a 9 AM time today has passed, a 6 PM one has not.
const NOW = new Date(2026, 10, 3, 15, 0, 0)
const get = (id: string) => tasksStore.get().tasks.find((x) => x.id === id)
const late = (extra: Partial<Task> = {}) =>
  task("late", { dueDate: L.addDays(L.today(), -3), ...extra })

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "setImmediate"] })
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  mockToast.mockClear()
})
afterEach(() => jest.useRealTimers())

describe("moveToToday", () => {
  it("dates a late task today and counts it as pushed, like Tomorrow", () => {
    tasksStore.set((s) => ({ ...s, tasks: [late()] }))
    A.moveToToday("late")
    expect(get("late")?.dueDate).toBe(L.today())
    expect(get("late")?.rescheduleCount).toBe(1)
    expect(L.isOverdue(get("late") as Task)).toBe(false)
  })

  it("keeps a time still ahead today, and its reminder at the same clock time", () => {
    const old = L.addDays(L.today(), -3)
    tasksStore.set((s) => ({
      ...s,
      tasks: [late({ dueTime: "18:00", remindAt: L.isoAt(old, "17:45") })],
    }))
    A.moveToToday("late")
    expect(get("late")?.dueTime).toBe("18:00")
    expect(get("late")?.remindAt).toBe(L.isoAt(L.today(), "17:45"))
  })

  it("drops a time already past today, and its reminder", () => {
    const old = L.addDays(L.today(), -3)
    tasksStore.set((s) => ({
      ...s,
      tasks: [late({ dueTime: "09:00", remindAt: L.isoAt(old, "08:45") })],
    }))
    A.moveToToday("late")
    expect(get("late")?.dueDate).toBe(L.today())
    expect(get("late")?.dueTime).toBeNull()
    expect(get("late")?.remindAt).toBeNull()
  })

  it("drops a reminder already past even when the time is ahead", () => {
    const old = L.addDays(L.today(), -3)
    tasksStore.set((s) => ({
      ...s,
      tasks: [late({ dueTime: "18:00", remindAt: L.isoAt(old, "10:00") })],
    }))
    A.moveToToday("late")
    expect(get("late")?.dueTime).toBe("18:00")
    expect(get("late")?.remindAt).toBeNull()
  })

  it("moves a reminder on a task with no time", () => {
    const old = L.addDays(L.today(), -3)
    tasksStore.set((s) => ({
      ...s,
      tasks: [late({ remindAt: L.isoAt(old, "17:45") })],
    }))
    A.moveToToday("late")
    expect(get("late")?.dueTime).toBeNull()
    expect(get("late")?.remindAt).toBe(L.isoAt(L.today(), "17:45"))
  })

  it("keeps a reminder still ahead (a snooze) exactly as it is", () => {
    const snoozed = new Date(NOW.getTime() + 30 * 60000 + 17000).toISOString()
    tasksStore.set((s) => ({ ...s, tasks: [late({ remindAt: snoozed })] }))
    A.moveToToday("late")
    expect(get("late")?.remindAt).toBe(snoozed)
  })

  it("an after-midnight time belongs to tonight, so it is still ahead", () => {
    const old = L.addDays(L.today(), -3)
    tasksStore.set((s) => ({
      ...s,
      tasks: [late({ dueTime: "01:30", remindAt: L.isoAt(old, "01:15") })],
    }))
    A.moveToToday("late")
    expect(get("late")?.dueTime).toBe("01:30")
    const r = new Date(get("late")?.remindAt ?? "")
    expect(r.getDate()).toBe(NOW.getDate() + 1)
    expect(r.getHours()).toBe(1)
  })

  it("just after midnight, the day's evening is past and the small hours are not", () => {
    // 02:00 still belongs to the previous app day.
    jest.setSystemTime(new Date(2026, 10, 4, 2, 0, 0))
    tasksStore.set((s) => ({
      ...s,
      tasks: [
        task("eve", { dueDate: L.addDays(L.today(), -2), dueTime: "23:00" }),
        task("small", { dueDate: L.addDays(L.today(), -2), dueTime: "03:00" }),
      ],
    }))
    A.moveToToday("eve")
    A.moveToToday("small")
    expect(get("eve")).toMatchObject({ dueDate: L.today(), dueTime: null })
    expect(get("small")).toMatchObject({ dueDate: L.today(), dueTime: "03:00" })
  })

  it("move all to today follows the same rule for every late task", () => {
    tasksStore.set((s) => ({
      ...s,
      tasks: [
        task("a", { dueDate: L.addDays(L.today(), -1), dueTime: "09:00" }),
        task("b", { dueDate: L.addDays(L.today(), -2), dueTime: "20:00" }),
      ],
    }))
    expect(A.moveAllOverdueToToday()).toBe(2)
    expect(get("a")).toMatchObject({ dueDate: L.today(), dueTime: null })
    expect(get("b")).toMatchObject({ dueDate: L.today(), dueTime: "20:00" })
  })
})

describe("the task actions sheet", () => {
  const open = (t: Task) => {
    tasksStore.set((s) => ({ ...s, tasks: [t] }))
    render(<TaskRow task={t} />, { wrapper })
    fireEvent.press(screen.getByLabelText(`Actions for ${t.title}`))
  }

  // The row itself reads "Today" when that is its date, and its pressable
  // (the one with the long-press hint) matches that name: skip it.
  const action = (name: string) =>
    screen
      .queryAllByRole("button", { name: new RegExp(`^${name}$`) })
      .find((b) => !b.props.accessibilityHint) ?? null

  it("offers Today before Tomorrow for a late task", () => {
    open(late())
    const buttons = screen.getAllByRole("button")
    const at = (name: string) => buttons.indexOf(action(name) as never)
    expect(at("Today")).toBeGreaterThan(-1)
    expect(at("Today")).toBeLessThan(at("Tomorrow"))
  })

  it("Today moves it, with an Undo that puts the old date back", () => {
    const old = L.addDays(L.today(), -3)
    const remindAt = L.isoAt(old, "08:45")
    open(late({ dueTime: "09:00", remindAt }))
    fireEvent.press(action("Today") as never)
    expect(get("late")).toMatchObject({ dueDate: L.today(), dueTime: null })
    expect(mockToast).toHaveBeenCalledWith(
      "Moved to today",
      expect.objectContaining({
        action: expect.objectContaining({ label: "Undo" }),
      }),
    )
    act(() => mockToast.mock.calls[0][1].action.onClick())
    expect(get("late")).toMatchObject({
      dueDate: old,
      dueTime: "09:00",
      remindAt,
    })
  })

  // Only a late task: moving a later or undated one to today and undoing it
  // would count a push (or set an original date) that never happened. Those
  // use the Today chip on the task's date sheet.
  it.each([
    ["later", { dueDate: "LATER" }],
    ["undated", {}],
    ["done", { dueDate: "LATE", status: "done" }],
  ] as const)("does not offer Today for a %s task", (_, extra) => {
    const dueDate =
      "dueDate" in extra
        ? extra.dueDate === "LATER"
          ? L.addDays(L.today(), 4)
          : L.addDays(L.today(), -2)
        : null
    open(task("x", { ...extra, dueDate } as Partial<Task>))
    expect(action("Today")).toBeNull()
  })

  it("does not offer Today for a task already due today", () => {
    open(task("now", { dueDate: L.today() }))
    expect(action("Today")).toBeNull()
    expect(action("Tomorrow")).toBeTruthy()
  })
})
