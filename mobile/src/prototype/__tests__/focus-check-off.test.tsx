// The focused task or habit is checked off on the Focus page itself. The
// session keeps timing (time already focused stays on the item), the check
// plays its beat and offers Undo, and the pill then suggests the next item.

import * as A from "@domain/focus/actions"
import { DEFAULT_SETTINGS } from "@domain/focus/data"
import { focusStore } from "@domain/focus/store"
import * as HA from "@domain/habits/actions"
import type { Habit } from "@domain/habits/data"
import { habitsStore } from "@domain/habits/store"
import { dayKey } from "@domain/lib/day"
import { liveStore } from "@domain/lib/live"
import { configureStorage, resetAll } from "@domain/lib/store"
import * as TA from "@domain/tasks/actions"
import { tasksStore } from "@domain/tasks/store"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { toast } from "sonner-native"
import { MOTION } from "../motion"
import { OverlayHost, resetOverlay } from "../overlay"
import { FocusTimer } from "../screens/focus-timer"

jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  ...require("./reanimated-extras").extras,
  default: require("react-native").Animated,
  useSharedValue: (value: unknown) =>
    require("react").useRef({ value }).current,
  useAnimatedStyle: (get: () => unknown) => get(),
  withSpring: (value: unknown) => value,
  withTiming: (value: unknown) => value,
  withDelay: (_: number, value: unknown) => value,
  withSequence: (...values: unknown[]) => values[values.length - 1],
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
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
}))
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
  usePathname: () => "/focus",
  useFocusEffect: () => {},
}))
jest.mock("expo-audio", () => ({}))

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>
    {children}
    <OverlayHost />
  </SafeAreaProvider>
)
const T0 = new Date(2026, 9, 20, 9, 0, 0).getTime()
const at = (m: number) => jest.setSystemTime(T0 + m * 60_000)

beforeEach(() => {
  jest.useFakeTimers({ now: T0 })
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  resetOverlay()
  liveStore.set({ live: null })
  focusStore.set({
    sessions: [],
    segments: [],
    settings: { ...DEFAULT_SETTINGS, dailyGoalMin: 0 },
    settingsSaved: true,
  })
  habitsStore.set((s) => ({ ...s, habits: [], logs: [], routines: [] }))
  tasksStore.set((s) => ({ ...s, tasks: [], events: [] }))
  jest.clearAllMocks()
})
afterEach(() => jest.useRealTimers())

/** The press, then the check's commit beat. */
const check = (label: string) => {
  fireEvent.press(screen.getByLabelText(label))
  act(() => jest.advanceTimersByTime(MOTION.commit))
}
const lastUndo = () => {
  const calls = (toast as unknown as jest.Mock).mock.calls
  const [message, opts] = calls[calls.length - 1]
  return { message, run: opts.action.onClick as () => void }
}
const focusOn = (kind: "task" | "habit", id: string, title: string) => {
  A.startFocus({ preset: "25-5", item: { kind, id, title } })
  render(<FocusTimer />, { wrapper })
}
const todayLog = (id: string) =>
  habitsStore.get().logs.find((l) => l.habitId === id && l.day === dayKey())
const habit = (type: Habit["type"], extra: Partial<Habit> = {}) => {
  const h = HA.createHabit({ name: "Stretch", icon: "🧘" })
  HA.updateHabit(h.id, { type, ...extra })
  return h
}

it("a focused task is checked off on the page, and Undo reopens it", () => {
  const task = TA.createTask({ title: "Character designs for Fern" })
  focusOn("task", task.id, task.title)
  check("Complete Character designs for Fern")
  expect(TA.getTask(task.id)?.status).toBe("done")
  const u = lastUndo()
  expect(u.message).toBe("Task complete")
  // The session keeps timing, on the same item.
  const session = A.current(focusStore.get())
  expect(session).toBeTruthy()
  expect(session?.item?.id).toBe(task.id)
  // The pill now points at what comes next.
  expect(screen.getByText("Next")).toBeTruthy()
  act(() => u.run())
  expect(TA.getTask(task.id)?.status).toBe("open")
})

it("a done task can be reopened from the pill, without a toast", () => {
  const task = TA.createTask({ title: "Write brief" })
  TA.completeTask(task.id)
  focusOn("task", task.id, task.title)
  check("Reopen Write brief")
  expect(TA.getTask(task.id)?.status).toBe("open")
  expect(toast).not.toHaveBeenCalled()
})

it("a check habit is ticked and Undo clears it", () => {
  const h = habit("check")
  focusOn("habit", h.id, h.name)
  check("Complete Stretch")
  expect(todayLog(h.id)?.status).toBe("done")
  const u = lastUndo()
  expect(u.message).toBe("Stretch done")
  act(() => u.run())
  expect(todayLog(h.id)).toBeUndefined()
})

it("a count habit steps up from the pill and completes at its target", () => {
  const h = habit("count", { target: 2, step: 1, unit: "glasses" })
  focusOn("habit", h.id, h.name)
  fireEvent.press(screen.getByLabelText("Add 1 glasses"))
  expect(todayLog(h.id)).toMatchObject({ value: 1, status: "partial" })
  // A step short of the target is not a tick: no toast.
  expect(toast).not.toHaveBeenCalled()
  fireEvent.press(screen.getByLabelText("Add 1 glasses"))
  expect(todayLog(h.id)).toMatchObject({ value: 2, status: "done" })
  expect(lastUndo().message).toBe("Stretch · 2/2 glasses")
  // Done: nothing left to add.
  expect(screen.queryByLabelText("Add 1 glasses")).toBeNull()
  act(() => lastUndo().run())
  expect(todayLog(h.id)).toMatchObject({ value: 1 })
})

it("a timed habit logs the minutes focused on it today, never twice", () => {
  const h = habit("duration", { target: 30 })
  focusOn("habit", h.id, h.name)
  act(() => {
    at(12)
    jest.advanceTimersByTime(1000)
  })
  check("Complete Stretch")
  expect(todayLog(h.id)).toMatchObject({
    status: "done",
    value: 12,
    source: "timer",
  })
  expect(lastUndo().message).toBe("Stretch done · 12 min")
  // Undo, then check again: still 12, not 24.
  act(() => lastUndo().run())
  expect(todayLog(h.id)).toBeUndefined()
  check("Complete Stretch")
  expect(todayLog(h.id)?.value).toBe(12)
})

it("the item's title wraps instead of being cut off", () => {
  const title =
    "Character designs for Fern by Unfurl, with the wreath sprite and every mood"
  const task = TA.createTask({ title })
  focusOn("task", task.id, task.title)
  const text = screen.getByText(title)
  expect(text.props.numberOfLines ?? 0).toBe(0)
})

it("no check without an item, or for a habit screen time completes", () => {
  A.startFocus({ preset: "25-5" })
  const r = render(<FocusTimer />, { wrapper })
  expect(screen.queryByLabelText(/^Complete /)).toBeNull()
  r.unmount()
  A.stopFocus(true)
  const h = habit("check", {
    rule: { kind: "screen_limit", groupId: "g1", maxMin: 30 },
  })
  require("@domain/dash/store").dashStore.set(
    (s: { enabled: Record<string, boolean> }) => ({
      ...s,
      enabled: { ...s.enabled, screen: true },
    }),
  )
  focusOn("habit", h.id, h.name)
  expect(screen.queryByLabelText(/^Complete /)).toBeNull()
})
