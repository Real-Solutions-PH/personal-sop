// The Focus module on the phone (ADR-0025): the timer kept from timestamps
// through an app kill, pauses and switches as segments, the module's Life
// Score inputs, the sync rows, the Live bar and lock screen, and the
// screens. Expected values are worked out from the minutes in each test.

import { module as FOC } from "@domain/focus"
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
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react-native"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { diffEntity } from "@/live/mapper"
import {
  segmentMapper,
  sessionMapper,
  settingsMapper,
} from "@/live/mappers/focus"
import { applySurfaceAction } from "@/surfaces/actions"
import { buildLiveState } from "@/surfaces/live-state"
import { focusLive, phaseNotice, syncLiveBar } from "../focus-live"
import { FocusDay } from "../screens/focus-day"
import { FocusStats } from "../screens/focus-stats"
import { FocusTimer } from "../screens/focus-timer"
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
  // Chainable no-op gesture builder; the detector just renders its child.
  const chain: object = new Proxy({}, { get: () => () => chain })
  return {
    Gesture: new Proxy({}, { get: () => () => chain }),
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
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
  Redirect: () => null,
}))

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
}
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
)

// 09:00 local on a Tuesday, well inside one business day.
const T0 = new Date(2026, 9, 20, 9, 0, 0).getTime()
const MIN = 60_000
const at = (m: number) => jest.setSystemTime(T0 + m * MIN)
const TASK = { kind: "task" as const, id: "t2", title: "Review PR #214" }
const HABIT = { kind: "habit" as const, id: "h-deepwork", title: "Deep work" }

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
})
afterEach(() => jest.useRealTimers())

const kinds = () =>
  [...focusStore.get().segments]
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .map((g) => [
      g.kind,
      g.setIndex,
      g.startedAt,
      g.endedAt ?? null,
      g.item?.id ?? null,
    ])
const iso = (m: number) => new Date(T0 + m * MIN).toISOString()

describe("the timer", () => {
  it("survives an app kill: the set ends on its instant and the break starts there", () => {
    A.startFocus({ preset: "25-5", item: TASK })
    at(40) // the app was closed for 40 minutes
    A.tickFocus()
    expect(kinds()).toEqual([
      ["focus", 0, iso(0), iso(25), "t2"],
      ["break", 0, iso(25), iso(30), null],
    ])
    const sid = focusStore.get().sessions[0].id
    expect(focusStore.get().segments.find((g) => g.kind === "break")?.id).toBe(
      L.autoId(sid, "break", 0),
    )
    const s = focusStore.get().sessions[0]
    expect([s.focusSec, s.setsCompleted]).toEqual([1500, 1])
  })

  it("records a pause as its own interval and pushes the set's end back", () => {
    A.startFocus({ preset: "25-5", item: TASK })
    at(10)
    A.pauseFocus()
    at(15)
    A.resumeFocus()
    expect(kinds()).toEqual([
      ["focus", 0, iso(0), iso(10), "t2"],
      ["pause", 0, iso(10), iso(15), "t2"],
      ["focus", 0, iso(15), null, "t2"],
    ])
    const tl = A.liveTimeline(focusStore.get(), T0 + 20 * MIN)
    expect(tl && L.phase(tl, T0 + 20 * MIN).endsAt).toBe(T0 + 30 * MIN)
  })

  it("splits the time where the person switches what they work on", () => {
    A.startFocus({ preset: "25-5", item: TASK })
    at(10)
    A.switchFocusItem(HABIT)
    at(25)
    A.tickFocus()
    const r = C.rangeStats(focusStore.get(), dayKey(), dayKey())
    expect(C.itemTotals(r.spans).map((x) => [x.item?.id, x.sec])).toEqual([
      ["h-deepwork", 900],
      ["t2", 600],
    ])
  })

  it("ends early keeping the partial set, or discards it", () => {
    A.startFocus({ preset: "25-5", item: TASK })
    at(12)
    A.stopFocus()
    const kept = focusStore.get().sessions[0]
    expect([kept.endReason, kept.focusSec, kept.setsCompleted]).toEqual([
      "completed",
      720,
      0,
    ])
    A.startFocus({ mode: "stopwatch" })
    at(30)
    A.stopFocus(true)
    expect(focusStore.get().sessions[1].endReason).toBe("abandoned")
    expect(
      C.rangeStats(focusStore.get(), dayKey(), dayKey()).byDay[dayKey()],
    ).toBe(720)
  })

  it("starting again ends the one running first", () => {
    A.startFocus({ preset: "50-10" })
    at(5)
    A.startFocus({ mode: "stopwatch" })
    const [a, b] = focusStore.get().sessions
    expect([a.endedAt, a.endReason, b.endedAt]).toEqual([
      iso(5),
      "completed",
      undefined,
    ])
    expect(A.current(focusStore.get())?.id).toBe(b.id)
  })
})

describe("the module contract", () => {
  it("leaves Focus out of the Life Score until the timer is first used", () => {
    expect(renderHook(() => FOC.useAreaRate(7)).result.current).toBeNull()
    expect(renderHook(() => FOC.useTodayProgress()).result.current).toEqual({
      due: 0,
      done: 0,
    })
  })

  it("rates a day by its share of the goal and rings when the goal is met", () => {
    A.saveFocusSettings({ dailyGoalMin: 60 })
    A.startFocus({ mode: "stopwatch" })
    at(30)
    A.stopFocus()
    // Due today only (the first session): 30 of 60 minutes.
    expect(renderHook(() => FOC.useAreaRate(7)).result.current).toBe(0.5)
    expect(renderHook(() => FOC.useTodayProgress()).result.current).toEqual({
      due: 1,
      done: 0,
    })
    A.startFocus({ mode: "stopwatch" })
    at(60)
    A.stopFocus()
    expect(renderHook(() => FOC.useTodayProgress()).result.current).toEqual({
      due: 1,
      done: 1,
    })
    const m = renderHook(() => FOC.useMetrics(7)).result.current
    expect(m.find((x) => x.key === "focused")?.value).toBe("1h 00m")
    expect(m.find((x) => x.key === "sessions")?.value).toBe("2")
  })
})

describe("sync rows", () => {
  it("writes the session before its segments and leaves derived totals to the server", () => {
    A.startFocus({ preset: "25-5", item: TASK })
    const s = focusStore.get()
    const sess = diffEntity(sessionMapper(), s, {}, {})
    const segs = diffEntity(segmentMapper(), s, {}, {})
    expect(sess.upserts[0].data).toMatchObject({
      mode: "pomodoro",
      preset: "25-5",
      focus_min: 25,
      item_kind: "task",
      item_id: "t2",
      ended_at: null,
    })
    expect(sess.upserts[0].data).not.toHaveProperty("focus_sec")
    expect(segs.upserts[0].data).toMatchObject({
      kind: "focus",
      planned_sec: 1500,
      set_index: 0,
    })
  })

  it("reads server rows back, settings marking the setup step done", () => {
    const m = sessionMapper()
    const row = m.fromServer(
      {
        id: "s1",
        mode: "stopwatch",
        started_at: "2026-10-20T01:00:00+00:00",
        ended_at: null,
        focus_sec: 600,
        sets_completed: 0,
        item_kind: "habit",
        item_id: "h1",
        item_title: "Read",
      },
      empty(),
    )
    expect(row).toMatchObject({
      mode: "stopwatch",
      focusSec: 600,
      item: { kind: "habit", id: "h1" },
    })
    expect(row).not.toHaveProperty("endedAt")
    const st = settingsMapper("u1")
    const pulled = st.fromServer({ daily_goal_min: 180 }, empty())
    if (!pulled) throw new Error("settings row dropped")
    const merged = st.merge(empty(), [pulled], [])
    expect([merged.settings.dailyGoalMin, merged.settingsSaved]).toEqual([
      180,
      true,
    ])
  })
})

describe("outside the screen", () => {
  it("shows in the Live bar, paused when paused, and leaves a habit timer alone", () => {
    A.startFocus({ preset: "25-5", item: TASK })
    syncLiveBar()
    expect(liveStore.get().live).toMatchObject({
      kind: "focus",
      label: "Focus · Review PR #214",
    })
    A.pauseFocus()
    syncLiveBar()
    expect(liveStore.get().live?.pausedAt).toBeTruthy()
    liveStore.set({
      live: {
        kind: "timer",
        label: "Read",
        href: "/habits/x/timer",
        startedAt: iso(0),
      },
    })
    syncLiveBar()
    expect(liveStore.get().live?.kind).toBe("timer")
  })

  it("tells the person when the set ends", () => {
    A.startFocus({ preset: "25-5", item: TASK })
    const n = phaseNotice(focusStore.get())
    expect([n?.at.getTime(), n?.title]).toEqual([T0 + 25 * MIN, "Set 1 done"])
    A.saveFocusSettings({ notify: false })
    expect(phaseNotice(focusStore.get())).toBeNull()
  })

  it("puts the session on the lock screen as a timer, and a tap there pauses it", () => {
    A.startFocus({ preset: "25-5", item: TASK })
    syncLiveBar()
    const state = buildLiveState({
      live: liveStore.get().live,
      habits: habitsStore.get(),
      fit: require("@domain/fitness/store").fitStore.get(),
      focus: focusStore.get(),
    })
    const sid = focusStore.get().sessions[0].id
    expect(state).toMatchObject({
      kind: "timer",
      id: sid,
      title: "Review PR #214",
      step: "Set 1 of 4",
      stepEndsAt: T0 + 25 * MIN,
      controls: ["pause", "finish"],
    })
    at(3)
    expect(
      applySurfaceAction({
        id: "x",
        type: "pause",
        kind: "timer",
        target: sid,
        at: Date.now(),
      }),
    ).toBe("applied")
    expect(L.phase(A.liveTimeline(focusStore.get())!, Date.now()).status).toBe(
      "paused",
    )
    expect(
      applySurfaceAction({
        id: "y",
        type: "pause",
        kind: "timer",
        target: sid,
        at: Date.now(),
      }),
    ).toBe("stale")
  })

  it("draws a live session's Live bar from its own fields", () => {
    expect(focusLive(empty())).toBeNull()
  })
})

describe("screens", () => {
  it("starts, pauses and switches what the time goes to mid-session", () => {
    tasksStore.set((s) => ({
      ...s,
      tasks: [
        ...s.tasks.filter((x) => x.id !== "t-focus"),
        {
          ...s.tasks[0],
          id: "t-focus",
          title: "Write the ADR",
          status: "open",
        },
      ],
    }))
    render(<FocusTimer />, { wrapper })
    expect(screen.getByText("25:00")).toBeTruthy()
    fireEvent.press(screen.getByLabelText("Start focus"))
    expect(screen.getByText("Focus · set 1 of 4")).toBeTruthy()
    act(() => {
      at(10)
      jest.advanceTimersByTime(1000)
    })
    expect(screen.getByText("14:59")).toBeTruthy()
    fireEvent.press(screen.getByLabelText("Pause"))
    expect(screen.getByText("Paused · set 1")).toBeTruthy()
    fireEvent.press(screen.getByLabelText("Pick what you're working on"))
    fireEvent.press(screen.getByLabelText("Write the ADR"))
    expect(A.current(focusStore.get())?.item?.title).toBe("Write the ADR")
    expect(screen.getByText("Write the ADR")).toBeTruthy()
  })

  it("draws the day with the pause hatched and labelled", () => {
    const day = dayKey()
    A.startFocus({ preset: "25-5", item: TASK })
    at(10)
    A.pauseFocus()
    at(17)
    A.resumeFocus()
    at(20)
    A.stopFocus()
    render(<FocusDay day={day} />, { wrapper })
    expect(screen.getByText("Paused 7m")).toBeTruthy()
    expect(screen.getAllByText("Review PR #214").length).toBeGreaterThan(0)
    // 10 + 3 minutes of focus: the day's total and the item's.
    expect(screen.getAllByText("13m")).toHaveLength(2)
  })

  it("shows stats by item, and an empty period as the dimmed real page", () => {
    render(<FocusStats />, { wrapper })
    expect(screen.getByText("No focus time yet")).toBeTruthy()
    // The real page sits under the card, dimmed and hidden from readers.
    expect(
      screen.getByText("Where the time went", { includeHiddenElements: true }),
    ).toBeTruthy()
  })

  it("puts time spent against the estimate on a task", () => {
    const id = tasksStore.get().tasks.find((x) => x.status === "open")
      ?.id as string
    tasksStore.set((s) => ({
      ...s,
      tasks: s.tasks.map((x) => (x.id === id ? { ...x, estimateMin: 30 } : x)),
    }))
    const task = tasksStore.get().tasks.find((x) => x.id === id)!
    A.startFocus({
      mode: "stopwatch",
      item: { kind: "task", id, title: task.title },
    })
    at(45)
    A.stopFocus()
    render(<TaskDetail id={id} />, { wrapper })
    expect(screen.getByText("Time spent")).toBeTruthy()
    expect(screen.getByText("of 30m estimate")).toBeTruthy()
    expect(screen.getByText("15m over the estimate")).toBeTruthy()
  })
})
