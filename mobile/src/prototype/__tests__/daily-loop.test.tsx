// The daily loop's rewards and misses on screen: the day's big moments play
// once a day and only after a completion on this phone, the biggest wins
// when several land together, all habits done shows away from Today, a
// sealed day stamps; a streak that broke yesterday says so, milestones wear
// gold; yesterday's miss strip and the first week sit on Today; overdue and
// often-pushed tasks read in the bad colour.
import type { HabitLog } from "@domain/habits/data"
import { addDays } from "@domain/habits/logic"
import { habitsStore } from "@domain/habits/store"
import { dayKey } from "@domain/lib/day"
import { configureStorage, resetAll } from "@domain/lib/store"
import * as TA from "@domain/tasks/actions"
import { tasksStore } from "@domain/tasks/store"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"

type Ring = {
  due: number
  done: number
  per: { habits: { due: number; done: number } }
}
const mockMotion = { reduced: false }
const mockPath = { current: "/stats" }
const mockDay: {
  ring: Ring
  current: number
  logged: number
  series: { day: string; onTarget: boolean | null; done: number }[]
  misses: number
} = {
  ring: { due: 10, done: 5, per: { habits: { due: 4, done: 2 } } },
  current: 3,
  logged: 5,
  series: [],
  misses: 0,
}
jest.mock("@domain/dash/hooks", () => ({
  ...jest.requireActual("@domain/dash/hooks"),
  useTodayRing: () => mockDay.ring,
  useOnTarget: () => ({
    current: mockDay.current,
    logged: mockDay.logged,
    series: mockDay.series,
  }),
  useAllMisses: () =>
    Array.from({ length: mockDay.misses }, (_, i) => ({ id: i })),
}))
jest.mock("expo-router", () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: () => false,
  },
  useLocalSearchParams: () => ({}),
  usePathname: () => mockPath.current,
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
  runOnJS: (fn: unknown) => fn,
  useReducedMotion: () => mockMotion.reduced,
  isSharedValue: () => false,
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
  notificationAsync: jest.fn(async () => {}),
  impactAsync: jest.fn(async () => {}),
  selectionAsync: jest.fn(async () => {}),
  NotificationFeedbackType: {
    Success: "success",
    Warning: "warning",
    Error: "error",
  },
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
}))
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
}))
const mockStorage = new Map<string, string>()
jest.mock("../storage", () => ({
  prototypeStorage: () => ({
    getItem: (k: string) => mockStorage.get(k) ?? null,
    setItem: (k: string, v: string) => mockStorage.set(k, v),
    removeItem: (k: string) => mockStorage.delete(k),
  }),
}))

const { DayMomentWatcher, DAY_MS, announceSealed } =
  require("../day-moment") as typeof import("../day-moment")
const { markCompletion, StreakChip, claimDayMoment } =
  require("../motion") as typeof import("../motion")
const { OverlayHost, anchor, resetOverlay } =
  require("../overlay") as typeof import("../overlay")
const { momentSlot } = require("../moment") as typeof import("../moment")
const { rewardStore } = require("../rewards") as typeof import("../rewards")
const { FirstWeekStrip, YesterdayStrip } =
  require("../daily-strips") as typeof import("../daily-strips")
const { TaskRow } =
  require("../screens/tasks") as typeof import("../screens/tasks")
const Haptics = require("expo-haptics")

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 44, left: 0, right: 0, bottom: 34 },
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>
    {children}
    <OverlayHost />
  </SafeAreaProvider>
)
const card = () => screen.queryByTestId("day-moment")
const ring = (done: number, due = 10, habits = { due: 4, done: 2 }) => {
  mockDay.ring = { due, done, per: { habits } }
}

beforeEach(() => {
  jest.useFakeTimers()
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  resetOverlay()
  anchor.measure = (_, done) => done({ x: 0, y: 0, width: 0, height: 0 })
  rewardStore.set({ days: {} })
  mockStorage.clear()
  momentSlot.set({ holder: null })
  tasksStore.set((s) => ({ ...s, tasks: [], lists: [], events: [] }))
  mockMotion.reduced = false
  mockPath.current = "/stats"
  ring(5)
  mockDay.current = 3
  mockDay.logged = 5
  mockDay.series = []
  mockDay.misses = 0
  jest.clearAllMocks()
})
afterEach(() => {
  act(() => jest.runOnlyPendingTimers())
  jest.useRealTimers()
})

describe("the day's moments", () => {
  it("reaching the target right after a tick plays On target, with a burst of haptics", () => {
    const view = render(<DayMomentWatcher />, { wrapper })
    ring(8)
    markCompletion()
    view.rerender(<DayMomentWatcher />)
    expect(card()).toBeTruthy()
    expect(screen.getByText("On target")).toBeTruthy()
    expect(screen.getByText("8 of 10 done")).toBeTruthy()
    expect(Haptics.notificationAsync).toHaveBeenCalledWith("success")
    act(() => jest.advanceTimersByTime(200))
    expect(Haptics.impactAsync).toHaveBeenCalledWith("medium")
    act(() => jest.advanceTimersByTime(DAY_MS))
    expect(card()).toBeNull()
  })

  it("plays once a day: dipping below and back does not replay it", () => {
    const view = render(<DayMomentWatcher />, { wrapper })
    ring(8)
    markCompletion()
    view.rerender(<DayMomentWatcher />)
    act(() => jest.advanceTimersByTime(DAY_MS + 100))
    ring(7)
    view.rerender(<DayMomentWatcher />)
    ring(8)
    markCompletion()
    view.rerender(<DayMomentWatcher />)
    expect(card()).toBeNull()
  })

  it("a change from a pull (no completion here) plays nothing", () => {
    const view = render(<DayMomentWatcher />, { wrapper })
    jest.setSystemTime(Date.now() + 60_000)
    ring(8)
    view.rerender(<DayMomentWatcher />)
    expect(card()).toBeNull()
  })

  it("a widget tap (a log written here just now, no tap in the app) plays it", () => {
    const view = render(<DayMomentWatcher />, { wrapper })
    jest.setSystemTime(Date.now() + 60_000)
    const log = {
      id: "w1",
      habitId: "h1",
      day: dayKey(),
      status: "done",
      loggedAt: new Date().toISOString(),
      source: "tap",
    } as HabitLog
    act(() => habitsStore.set((s) => ({ ...s, logs: [...s.logs, log] })))
    ring(8)
    view.rerender(<DayMomentWatcher />)
    expect(screen.getByText("On target")).toBeTruthy()
  })

  it("a log stamped ahead of this clock does not hide a widget tap", () => {
    const view = render(<DayMomentWatcher />, { wrapper })
    jest.setSystemTime(Date.now() + 60_000)
    const at = (ms: number) => new Date(Date.now() + ms).toISOString()
    const base = { day: dayKey(), status: "done", source: "tap" } as const
    act(() =>
      habitsStore.set((s) => ({
        ...s,
        logs: [
          ...s.logs,
          { ...base, id: "f1", habitId: "h2", loggedAt: at(3_600_000) },
          { ...base, id: "w2", habitId: "h1", loggedAt: at(0) },
        ] as HabitLog[],
      })),
    )
    ring(8)
    view.rerender(<DayMomentWatcher />)
    expect(screen.getByText("On target")).toBeTruthy()
  })

  it("a pulled log stamped minutes ago plays nothing", () => {
    const view = render(<DayMomentWatcher />, { wrapper })
    jest.setSystemTime(Date.now() + 600_000)
    const log = {
      id: "p1",
      habitId: "h1",
      day: dayKey(),
      status: "done",
      loggedAt: new Date(Date.now() - 300_000).toISOString(),
      source: "tap",
    } as HabitLog
    act(() => habitsStore.set((s) => ({ ...s, logs: [...s.logs, log] })))
    ring(8)
    view.rerender(<DayMomentWatcher />)
    expect(card()).toBeNull()
  })

  it("opening the app already on target plays nothing", () => {
    ring(9)
    markCompletion()
    render(<DayMomentWatcher />, { wrapper })
    expect(card()).toBeNull()
  })

  it("straight to everything done plays Perfect day, and On target never follows", () => {
    const view = render(<DayMomentWatcher />, { wrapper })
    ring(10, 10, { due: 4, done: 4 })
    markCompletion()
    view.rerender(<DayMomentWatcher />)
    expect(screen.getByText("Perfect day")).toBeTruthy()
    expect(screen.queryByText("All habits done")).toBeNull()
    // Stronger than On target: a second impact follows the first.
    act(() => jest.advanceTimersByTime(500))
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(2)
    act(() => jest.advanceTimersByTime(DAY_MS + 100))
    expect(card()).toBeNull()
  })

  it("all habits done lands away from Today, once, sharing Today's key", () => {
    mockPath.current = "/habits"
    const view = render(<DayMomentWatcher />, { wrapper })
    ring(6, 10, { due: 4, done: 4 })
    markCompletion()
    view.rerender(<DayMomentWatcher />)
    expect(screen.getByText("All habits done")).toBeTruthy()
    expect(screen.getByText("4 of 4 done today")).toBeTruthy()
    // Today's own banner sees the day's moment already played.
    expect(claimDayMoment("sop:celebrated:habits")).toBe(false)
  })

  it("on Today, all habits done is left to Today's own banner", () => {
    mockPath.current = "/today"
    const view = render(<DayMomentWatcher />, { wrapper })
    ring(6, 10, { due: 4, done: 4 })
    markCompletion()
    view.rerender(<DayMomentWatcher />)
    expect(card()).toBeNull()
  })

  it("the first log ever lights day 1, once", () => {
    mockDay.logged = 0
    const view = render(<DayMomentWatcher />, { wrapper })
    mockDay.logged = 1
    ring(1)
    markCompletion()
    view.rerender(<DayMomentWatcher />)
    expect(screen.getByText("Your first log — day 1 is lit")).toBeTruthy()
    expect(rewardStore.get().days["first-log"]).toBe(dayKey())
  })

  it("sealing the day stamps it; off target says so", () => {
    render(<DayMomentWatcher />, { wrapper })
    act(() => announceSealed({ onTarget: false, done: 4, due: 10 }))
    expect(screen.getByText("Day sealed · off target")).toBeTruthy()
    expect(screen.getByText("Sealed below target")).toBeTruthy()
    // Short of target lands with a warning, never an impact.
    act(() => jest.advanceTimersByTime(200))
    expect(Haptics.notificationAsync).toHaveBeenCalledWith("warning")
    expect(Haptics.impactAsync).not.toHaveBeenCalled()
  })

  it("waits while another card holds the top", () => {
    act(() => momentSlot.set({ holder: "trophy" }))
    const view = render(<DayMomentWatcher />, { wrapper })
    ring(8)
    markCompletion()
    view.rerender(<DayMomentWatcher />)
    expect(card()).toBeNull()
    act(() => momentSlot.set({ holder: null }))
    expect(card()).toBeTruthy()
  })
})

describe("StreakChip", () => {
  it("says a streak broke yesterday, in the bad colour", () => {
    render(<StreakChip streak={0} lost={12} />, { wrapper })
    expect(screen.getByText("streak lost · was 12")).toBeTruthy()
    expect(screen.getByLabelText("Streak lost, was 12 days")).toBeTruthy()
  })
  it("is gone at 0 with no break", () => {
    render(<StreakChip streak={0} />, { wrapper })
    expect(screen.queryByTestId("streak-chip")).toBeNull()
    expect(screen.queryByTestId("streak-lost")).toBeNull()
  })
  it("wears gold on milestone days only, with a success tap as it is reached", () => {
    const view = render(<StreakChip streak={6} />, { wrapper })
    expect(screen.getByTestId("streak-chip")).toBeTruthy()
    view.rerender(<StreakChip streak={7} />)
    expect(screen.getByTestId("streak-milestone")).toBeTruthy()
    expect(Haptics.notificationAsync).toHaveBeenCalledWith("success")
    view.rerender(<StreakChip streak={8} />)
    expect(screen.getByTestId("streak-chip")).toBeTruthy()
  })
})

describe("Today strips", () => {
  const today = dayKey()
  const d = (n: number, onTarget: boolean | null, done = 1) => ({
    day: addDays(today, n),
    onTarget,
    done,
  })
  it("yesterday off target names the streak it ended and the misses", () => {
    mockDay.series = [d(-4, true), d(-3, true), d(-2, true), d(-1, false)]
    mockDay.misses = 4
    render(<YesterdayStrip />, { wrapper })
    expect(
      screen.getByText("Yesterday: off target · 3-day streak ended"),
    ).toBeTruthy()
    expect(
      screen.getByText(
        /^4 missed\. The 3 days still count; the next one starts today\./,
      ),
    ).toBeTruthy()
    // Fern consoles beside the cost, in place of the trend-down icon.
    expect(
      screen.getByTestId("fern-consoling", { includeHiddenElements: true }),
    ).toBeTruthy()
    fireEvent.press(screen.getByLabelText("Dismiss"))
    expect(screen.queryByTestId("yesterday-strip")).toBeNull()
  })
  it("says nothing after a good yesterday", () => {
    mockDay.series = [d(-1, true)]
    render(<YesterdayStrip />, { wrapper })
    expect(screen.queryByTestId("yesterday-strip")).toBeNull()
  })
  it("the first week lights the days logged and asks for today", () => {
    mockDay.series = [d(-2, null, 2), d(-1, null, 0), d(0, null, 0)]
    render(<FirstWeekStrip />, { wrapper })
    expect(screen.getByText("Day 3 of 7 · 1 lit")).toBeTruthy()
    expect(
      screen.getByText("Log one thing today to light up day 3."),
    ).toBeTruthy()
  })
})

describe("task misses", () => {
  const overdue = () =>
    TA.createTask({
      title: "Pay rent",
      source: "manual",
      dueDate: addDays(dayKey(), -2),
    })
  it("a compact row reads late in the bad colour; pushed 3× says so", () => {
    render(
      <TaskRow task={{ ...overdue(), rescheduleCount: 3 }} compact showDay />,
      { wrapper },
    )
    expect(screen.getByText("late 2d").props.style.color).toBe("#b03a2e")
    expect(screen.getByText("pushed 3×").props.style.color).toBe("#b03a2e")
  })
  it("pushed twice stays a quiet count", () => {
    render(
      <TaskRow task={{ ...overdue(), rescheduleCount: 2 }} compact showDay />,
      { wrapper },
    )
    expect(screen.getByText("2×").props.style.color).toBe("#94600e")
  })
  it("a full row leads its date with how late it is", () => {
    render(<TaskRow task={{ ...overdue(), rescheduleCount: 3 }} />, {
      wrapper,
    })
    const line = screen.getByText(/^late 2d · /)
    expect(line.props.style.color).toBe("#b03a2e")
    expect(screen.getByText(/pushed 3×/)).toBeTruthy()
  })
})
