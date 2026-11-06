// Pomodoro ⇄ stopwatch (ADR-0025): picking the mode when a focus starts from
// a task or habit, and switching while it runs without losing or double
// counting the time. Expected values are worked out from the minutes in
// each test against the rule on `switchMode` in shared/prototype/focus/logic.ts.

import * as A from "@domain/focus/actions"
import * as C from "@domain/focus/calc"
import { DEFAULT_SETTINGS, type FocusState } from "@domain/focus/data"
import * as L from "@domain/focus/logic"
import { focusStore } from "@domain/focus/store"
import { habitsStore } from "@domain/habits/store"
import { dayKey } from "@domain/lib/day"
import { liveStore } from "@domain/lib/live"
import { configureStorage, resetAll } from "@domain/lib/store"
import { tasksStore } from "@domain/tasks/store"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { diffEntity, type Mapper, type Payload } from "@/live/mapper"
import { segmentMapper, sessionMapper } from "@/live/mappers/focus"
import { FocusTimer } from "../screens/focus-timer"
import { HabitDetail } from "../screens/habit-detail"
import { TaskDetail } from "../screens/task-detail"

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
  withRepeat: (value: unknown) => value,
  interpolate: (_: number, __: number[], output: number[]) => output[0],
  runOnJS: (fn: unknown) => fn,
  useReducedMotion: () => true,
}))
jest.mock("react-native-gesture-handler", () => {
  const chain: object = new Proxy({}, { get: () => () => chain })
  return {
    Gesture: new Proxy({}, { get: () => () => chain }),
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
    ScrollView: require("react-native").ScrollView,
  }
})
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
}))
const mockPush = jest.fn()
jest.mock("expo-router", () => ({
  router: {
    push: (...a: unknown[]) => mockPush(...a),
    replace: jest.fn(),
    back: jest.fn(),
  },
  useLocalSearchParams: () => ({}),
  usePathname: () => "/tasks",
  useFocusEffect: () => {},
  Redirect: () => null,
}))

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
}
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
)

const T0 = new Date(2026, 9, 20, 9, 0, 0).getTime()
const MIN = 60_000
const at = (m: number) => jest.setSystemTime(T0 + m * MIN)
const iso = (m: number) => new Date(T0 + m * MIN).toISOString()
const TASK = { kind: "task" as const, id: "t2", title: "Review PR #214" }

const empty = (): FocusState => ({
  sessions: [],
  segments: [],
  settings: { ...DEFAULT_SETTINGS },
  settingsSaved: false,
})

beforeEach(() => {
  jest.useFakeTimers({ now: T0 })
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  focusStore.set(empty())
  liveStore.set({ live: null })
  mockPush.mockClear()
})
afterEach(() => jest.useRealTimers())

/** [kind, set, start, end, planned] in time order. */
const segs = () =>
  [...focusStore.get().segments]
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .map((g) => [
      g.kind,
      g.setIndex,
      g.startedAt,
      g.endedAt ?? null,
      g.plannedSec ?? null,
    ])
const session = () => focusStore.get().sessions[0]
const phaseAt = (m: number) => {
  const tl = A.liveTimeline(focusStore.get(), T0 + m * MIN)
  return tl ? L.phase(tl, T0 + m * MIN) : null
}
const byItem = () =>
  C.itemTotals(C.rangeStats(focusStore.get(), dayKey(), dayKey()).spans).map(
    (x) => [x.item?.id ?? null, x.sec],
  )

describe("switching mode while it runs", () => {
  it("Pomodoro → stopwatch keeps the block: it counts up from the 10 minutes done", () => {
    A.startFocus({ preset: "25-5", item: TASK })
    at(10)
    A.switchFocusMode("stopwatch")
    expect(session().mode).toBe("stopwatch")
    // One segment, never split or copied; it just lost its planned length.
    expect(segs()).toEqual([["focus", 0, iso(0), null, null]])
    expect(phaseAt(10)).toMatchObject({ elapsed: 600, remaining: null })
    at(40) // past where the Pomodoro would have ended: nothing ended it
    A.tickFocus()
    expect(phaseAt(40)).toMatchObject({ status: "running", elapsed: 2400 })
    A.stopFocus()
    expect([session().focusSec, session().setsCompleted]).toEqual([2400, 0])
    expect(byItem()).toEqual([["t2", 2400]])
  })

  it("stopwatch → Pomodoro under the length continues the set from the elapsed time", () => {
    A.startFocus({ mode: "stopwatch", item: TASK })
    at(10)
    A.switchFocusMode("pomodoro")
    expect(phaseAt(10)).toMatchObject({
      kind: "focus",
      setIndex: 0,
      plannedSec: 1500,
      remaining: 900,
    })
    at(27)
    A.tickFocus()
    // The set ends 25 minutes in and the break auto-starts there.
    expect(segs()).toEqual([
      ["focus", 0, iso(0), iso(25), 1500],
      ["break", 0, iso(25), null, 300],
    ])
    expect([session().focusSec, session().setsCompleted]).toEqual([1500, 1])
    expect(byItem()).toEqual([["t2", 1500]])
  })

  it("stopwatch → Pomodoro past the length starts a new full set now, not crediting the old block", () => {
    A.startFocus({ mode: "stopwatch", item: TASK })
    at(30)
    A.switchFocusMode("pomodoro")
    expect(segs()).toEqual([
      ["focus", 0, iso(0), iso(30), null],
      ["focus", 1, iso(30), null, 1500],
    ])
    expect(phaseAt(30)).toMatchObject({ setIndex: 1, remaining: 1500 })
    at(40)
    A.stopFocus()
    // 30 + 10 minutes, counted once; no finished set.
    expect([session().focusSec, session().setsCompleted]).toEqual([2400, 0])
    expect(byItem()).toEqual([["t2", 2400]])
  })

  it("switching on a break ends it and starts a stopwatch block now", () => {
    A.startFocus({ preset: "25-5", item: TASK })
    at(27) // two minutes into the auto-started break
    A.switchFocusMode("stopwatch")
    expect(segs()).toEqual([
      ["focus", 0, iso(0), iso(25), 1500],
      ["break", 0, iso(25), iso(27), 300],
      ["focus", 1, iso(27), null, null],
    ])
    at(37)
    A.stopFocus()
    // The finished Pomodoro set is kept as one after the switch.
    expect([session().focusSec, session().setsCompleted]).toEqual([2100, 1])
  })

  it("a paused block stays paused across a switch, and resumes in the new mode", () => {
    A.startFocus({ mode: "stopwatch", item: TASK })
    at(10)
    A.pauseFocus()
    at(12)
    A.switchFocusMode("pomodoro")
    expect(phaseAt(12)).toMatchObject({ status: "paused", remaining: 900 })
    at(15)
    A.resumeFocus()
    expect(phaseAt(15)).toMatchObject({ status: "running", remaining: 900 })
    at(31)
    A.switchFocusMode("stopwatch")
    // The set ran out at 30 (10 + 15 minutes of focus) and its break
    // auto-started; the stopwatch then starts at 31.
    at(35)
    A.stopFocus()
    // 25 + 4 minutes of focus; the pause and the break count nowhere.
    expect([session().focusSec, session().setsCompleted]).toEqual([1740, 1])
    expect(byItem()).toEqual([["t2", 1740]])
  })

  it("switching to the mode it already runs, or after it ended, changes nothing", () => {
    A.startFocus({ preset: "25-5", item: TASK })
    const before = focusStore.get()
    A.switchFocusMode("pomodoro")
    expect(focusStore.get()).toBe(before)
  })

  it("syncs the switch as plain field writes: the session's mode and the block's planned length", () => {
    A.startFocus({ preset: "25-5", item: TASK })
    const base = focusStore.get()
    at(10)
    A.switchFocusMode("stopwatch")
    const s = focusStore.get()
    const known = <T extends { id: string }>(
      rows: T[],
      m: Mapper<FocusState, T>,
    ): Record<string, Payload> =>
      Object.fromEntries(rows.map((r) => [r.id, m.toServer(r, base)]))
    const sess = diffEntity(
      sessionMapper(),
      s,
      known(base.sessions, sessionMapper()),
      {},
    )
    const seg = diffEntity(
      segmentMapper(),
      s,
      known(base.segments, segmentMapper()),
      {},
    )
    expect(sess.upserts).toHaveLength(1)
    expect(sess.upserts[0].data).toMatchObject({ mode: "stopwatch" })
    expect(seg.upserts).toHaveLength(1)
    expect(seg.upserts[0].data).toMatchObject({ planned_sec: null })
  })
})

describe("screens", () => {
  it("the running timer switches between Pomodoro and Stopwatch, keeping the time", () => {
    A.startFocus({ preset: "25-5", item: TASK })
    render(<FocusTimer />, { wrapper })
    act(() => {
      at(10)
      jest.advanceTimersByTime(1000)
    })
    expect(screen.getByText("Focus · set 1 of 4")).toBeTruthy()
    fireEvent.press(screen.getByLabelText("Stopwatch"))
    expect(session().mode).toBe("stopwatch")
    expect(screen.getAllByText("Stopwatch").length).toBeGreaterThan(1)
    // Counts up from the time already focused.
    expect(screen.getByText(/^10:0\d$/)).toBeTruthy()
    fireEvent.press(screen.getByLabelText("Pomodoro"))
    expect(screen.getByText("Focus · set 1 of 4")).toBeTruthy()
    expect(screen.getByText(/^1[45]:\d\d$/)).toBeTruthy()
  })

  it("starting from a task asks Pomodoro or Stopwatch; one tap starts it and is remembered", () => {
    const task = tasksStore.get().tasks.find((x) => x.status === "open")!
    render(<TaskDetail id={task.id} />, { wrapper })
    fireEvent.press(screen.getByLabelText(`Start focusing on ${task.title}`))
    expect(screen.getByText("How do you want to focus?")).toBeTruthy()
    // The default mode is the highlighted one.
    expect(
      screen.getByLabelText("Start Pomodoro").props.accessibilityState,
    ).toMatchObject({ selected: true })
    fireEvent.press(screen.getByLabelText("Start Stopwatch"))
    const cur = A.current(focusStore.get())
    expect(cur?.mode).toBe("stopwatch")
    expect(cur?.item).toEqual({ kind: "task", id: task.id, title: task.title })
    expect(focusStore.get().settings.mode).toBe("stopwatch")
    act(() => jest.advanceTimersByTime(1000))
    expect(mockPush).toHaveBeenCalledWith("/focus")
  })

  it("starting from a habit highlights the last choice", () => {
    focusStore.set((s) => ({
      ...s,
      settings: { ...s.settings, mode: "stopwatch" },
    }))
    const h = habitsStore.get().habits[0]
    render(<HabitDetail id={h.id} />, { wrapper })
    fireEvent.press(screen.getByLabelText(`Start focusing on ${h.name}`))
    expect(
      screen.getByLabelText("Start Stopwatch").props.accessibilityState,
    ).toMatchObject({ selected: true })
    fireEvent.press(screen.getByLabelText("Start Pomodoro"))
    const cur = A.current(focusStore.get())
    expect(cur?.mode).toBe("pomodoro")
    expect(cur?.item).toMatchObject({ kind: "habit", id: h.id })
  })
})
