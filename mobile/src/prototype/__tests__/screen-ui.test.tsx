// Screen time on the phone's screens (spec 2026-10-29-screen-time-design,
// "Mobile surfaces"): a habit driven by screen time shows its ring and a
// lower-bound label but nothing to tick; the settings screen without the
// native module is a locked preview and with permission denied offers a
// retry; the habit editor writes the rule; the foreground sync reconciles
// the extension's events and reschedules only when the plan changed.

import type { Habit, HabitLog } from "@domain/habits/data"
import { habitsStore } from "@domain/habits/store"
import { dayOffset } from "@domain/lib/day"
import { configureStorage, resetAll } from "@domain/lib/store"
import type { NativeEvent, ScreenDay, ScreenGroup } from "@domain/screen/data"
import { windowFor } from "@domain/screen/logic"
import { screenStore } from "@domain/screen/store"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import * as ST from "../screen-time"

jest.mock("../screen-time", () => ({
  screenTimeAvailable: jest.fn(() => false),
  authorizationStatus: jest.fn(async () => "unavailable"),
  requestScreenTime: jest.fn(async () => "approved"),
  pickApps: jest.fn(async () => true),
  hasSelection: jest.fn(async () => true),
  startMonitoring: jest.fn(async () => {}),
  stopMonitoring: jest.fn(async () => {}),
  readEvents: jest.fn(async () => []),
}))
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
)
jest.mock("expo-router", () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: () => false,
  },
  useLocalSearchParams: () => ({}),
  usePathname: () => "/",
  useFocusEffect: () => {},
  Redirect: () => null,
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
  withDelay: (_: number, value: unknown) => value,
  withSequence: (...values: unknown[]) => values[values.length - 1],
  withRepeat: (value: unknown) => value,
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

const native = ST as jest.Mocked<typeof ST>
const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
)

// 09:00 local on a Tuesday, well inside one app day.
const T0 = new Date(2026, 9, 20, 9, 0, 0).getTime()
const AUTO = "Completes automatically from screen time"

const ALL: ScreenGroup = {
  id: "g-all",
  name: "All apps",
  kind: "all",
  budgetMin: 180,
  sortOrder: 0,
}
const SOCIAL: ScreenGroup = {
  id: "g-social",
  name: "Social",
  kind: "custom",
  budgetMin: 60,
  sortOrder: 1,
}
const today = (usedMin: number, groupId = SOCIAL.id): ScreenDay => ({
  id: `d-${groupId}`,
  groupId,
  day: dayOffset(0),
  usedMin,
  closed: false,
  updatedAt: new Date(T0).toISOString(),
})
const ruleHabit = (maxMin: number, over: Partial<Habit> = {}): Habit => ({
  id: "h-social",
  name: "Less social media",
  icon: "📵",
  type: "check",
  schedule: [{ days: [0, 1, 2, 3, 4, 5, 6] }],
  reminder: false,
  status: "active",
  pauses: [],
  linkWorkout: false,
  rule: { kind: "screen_limit", groupId: SOCIAL.id, maxMin },
  createdAt: dayOffset(-30),
  sortOrder: 1,
  ...over,
})
const seed = (habit: Habit, days: ScreenDay[], logs: HabitLog[] = []) => {
  screenStore.set({ groups: [ALL, SOCIAL], days })
  habitsStore.set((s) => ({
    ...s,
    habits: [habit],
    logs,
    routines: [],
    runs: [],
    timer: null,
  }))
}

beforeEach(() => {
  jest.useFakeTimers({ now: T0 })
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  jest.clearAllMocks()
  native.screenTimeAvailable.mockReturnValue(false)
  native.authorizationStatus.mockResolvedValue("unavailable")
  native.hasSelection.mockResolvedValue(true)
  native.readEvents.mockResolvedValue([])
})
afterEach(() => jest.useRealTimers())

describe("a habit driven by screen time", () => {
  const HabitRow = (p: { habit: Habit }) =>
    require("../screens/habits").HabitRow(p)
  const HabitsCard = () => require("../screens/today").HabitsCard()

  it("shows its ring and the lower bound, with nothing to tick", () => {
    seed(ruleHabit(30), [today(15)])
    for (const ui of [
      <HabitRow key="row" habit={ruleHabit(30)} />,
      <HabitsCard key="today" />,
    ]) {
      const view = render(ui, { wrapper })
      expect(screen.queryByRole("checkbox")).toBeNull()
      expect(screen.getByLabelText(AUTO)).toBeTruthy()
      expect(screen.getByText("≥ 15 of 30 min")).toBeTruthy()
      expect(
        screen.queryByLabelText("More options for Less social media"),
      ).toBeNull()
      view.unmount()
    }
  })

  it("reads None yet on a zero limit with nothing used", () => {
    seed(ruleHabit(0), [today(0)])
    render(<HabitRow habit={ruleHabit(0)} />, { wrapper })
    expect(screen.getByText("None yet")).toBeTruthy()
  })

  it("shows how far over once the limit is crossed", () => {
    seed(ruleHabit(30), [today(45)])
    render(<HabitsCard />, { wrapper })
    expect(screen.getByText("Over by ≥ 15 min")).toBeTruthy()
    expect(screen.queryByRole("checkbox")).toBeNull()
  })

  it("says Not tracked for a day screen time didn't observe", () => {
    seed(ruleHabit(30), [])
    render(<HabitRow habit={ruleHabit(30)} />, { wrapper })
    expect(screen.getByText("Not tracked")).toBeTruthy()
  })

  it("offers no manual check on its detail page", () => {
    seed(ruleHabit(30), [today(15)])
    const { HabitDetail } = require("../screens/habit-detail")
    render(<HabitDetail id="h-social" />, { wrapper })
    expect(screen.queryByText("Mark done today")).toBeNull()
    expect(screen.queryByText("Log…")).toBeNull()
    expect(screen.getByText("≥ 15 of 30 min")).toBeTruthy()
  })
})

describe("the screen-time settings", () => {
  const ScreenSettings = () =>
    require("../screens/screen-settings").ScreenSettings()

  it("without the native module shows the groups dimmed under a locked preview", async () => {
    screenStore.set({ groups: [ALL, SOCIAL], days: [] })
    render(<ScreenSettings />, { wrapper })
    expect(
      await screen.findByText("Screen Time isn't available here"),
    ).toBeTruthy()
    // The real list, dimmed underneath.
    expect(
      screen.getByText("Social", { includeHiddenElements: true }),
    ).toBeTruthy()
    expect(native.requestScreenTime).not.toHaveBeenCalled()
  })

  it("with permission denied explains and retries", async () => {
    native.screenTimeAvailable.mockReturnValue(true)
    native.authorizationStatus.mockResolvedValue("denied")
    native.requestScreenTime.mockResolvedValue("approved")
    screenStore.set({ groups: [ALL, SOCIAL], days: [] })
    render(<ScreenSettings />, { wrapper })
    const retry = await screen.findByRole("button", { name: "Try again" })
    expect(screen.getByText(/turned off/)).toBeTruthy()
    await act(async () => fireEvent.press(retry))
    expect(native.requestScreenTime).toHaveBeenCalledTimes(1)
  })
})

describe("the habit editor", () => {
  const HabitForm = (p: { id?: string }) =>
    require("../screens/habit-form").HabitForm(p)

  it("writes the rule and hides the target fields", () => {
    screenStore.set({ groups: [ALL, SOCIAL], days: [] })
    habitsStore.set((s) => ({ ...s, habits: [], logs: [] }))
    render(<HabitForm />, { wrapper })
    fireEvent.changeText(screen.getByLabelText("Name"), "Less social")
    fireEvent.press(
      screen.getByRole("switch", { name: "Completes from screen time" }),
    )
    expect(screen.queryByText("◷ Timed")).toBeNull()
    expect(screen.queryByLabelText("Target")).toBeNull()
    expect(
      screen.queryByRole("switch", { name: "Link to workouts" }),
    ).toBeNull()
    fireEvent.press(screen.getByText("Social"))
    fireEvent.press(screen.getByText("A minute limit"))
    for (let i = 0; i < 2; i++)
      fireEvent.press(screen.getByLabelText("Increase Daily limit"))
    fireEvent.press(screen.getByText("Create habit"))
    const h = habitsStore.get().habits.find((x) => x.name === "Less social")
    expect(h?.type).toBe("check")
    expect(h?.target).toBeUndefined()
    expect(h?.rule).toEqual({
      kind: "screen_limit",
      groupId: SOCIAL.id,
      maxMin: 40,
    })
  })

  it("removing the option makes the habit manual again", () => {
    seed(ruleHabit(30), [])
    render(<HabitForm id="h-social" />, { wrapper })
    fireEvent.press(
      screen.getByRole("switch", { name: "Completes from screen time" }),
    )
    fireEvent.press(screen.getByText("Save changes"))
    expect(habitsStore.get().habits[0].rule).toBeUndefined()
  })
})

describe("syncScreenTime", () => {
  const syncScreenTime = (): Promise<void> =>
    require("../screen-sync").syncScreenTime()
  const AsyncStorage = require("@react-native-async-storage/async-storage")

  // Yesterday's whole window (worked out under the fake clock): 15 minutes
  // crossed on Social, then the window closed.
  const yesterdayEvents = (): NativeEvent[] => {
    const w = windowFor(dayOffset(-1), 4)
    return [
      {
        kind: "start",
        groupId: SOCIAL.id,
        at: w.startMs + 1000,
        hasSelection: true,
      },
      {
        kind: "rung",
        groupId: SOCIAL.id,
        at: w.startMs + 3 * 3600_000,
        rungMin: 15,
      },
      { kind: "end", groupId: SOCIAL.id, at: w.endMs },
    ]
  }

  beforeEach(async () => {
    await AsyncStorage.clear()
  })

  it("applies what reconcile makes and reschedules only on a changed plan", async () => {
    native.screenTimeAvailable.mockReturnValue(true)
    native.authorizationStatus.mockResolvedValue("approved")
    native.readEvents.mockResolvedValue(yesterdayEvents())
    seed(ruleHabit(30), [])
    const yesterday = dayOffset(-1)
    await syncScreenTime()
    const row = screenStore
      .get()
      .days.find((d) => d.groupId === SOCIAL.id && d.day === yesterday)
    expect(row).toMatchObject({ usedMin: 15, closed: true })
    expect(
      habitsStore
        .get()
        .logs.find((l) => l.habitId === "h-social" && l.day === yesterday),
    ).toMatchObject({ status: "done", source: "screen" })
    expect(native.startMonitoring).toHaveBeenCalledTimes(1)
    const [plan, hour] = native.startMonitoring.mock.calls[0]
    expect(hour).toBe(4)
    expect(plan.map((p) => p.groupId).sort()).toEqual([ALL.id, SOCIAL.id])
    expect(plan.find((p) => p.groupId === SOCIAL.id)?.rungs).toContain(31)

    await syncScreenTime()
    expect(native.startMonitoring).toHaveBeenCalledTimes(1)

    // A changed limit changes the plan: one more schedule.
    habitsStore.set((s) => ({ ...s, habits: [ruleHabit(45)] }))
    await syncScreenTime()
    expect(native.startMonitoring).toHaveBeenCalledTimes(2)
  })

  it("leaves a group without picked apps out of the plan", async () => {
    native.screenTimeAvailable.mockReturnValue(true)
    native.authorizationStatus.mockResolvedValue("approved")
    native.hasSelection.mockResolvedValue(false)
    seed(ruleHabit(30), [])
    await syncScreenTime()
    const [plan] = native.startMonitoring.mock.calls[0]
    expect(plan.map((p) => p.groupId)).toEqual([ALL.id])
  })

  it("does nothing and never throws when Screen Time is unavailable or fails", async () => {
    await expect(syncScreenTime()).resolves.toBeUndefined()
    expect(native.readEvents).not.toHaveBeenCalled()
    native.screenTimeAvailable.mockReturnValue(true)
    native.authorizationStatus.mockResolvedValue("denied")
    await expect(syncScreenTime()).resolves.toBeUndefined()
    expect(native.readEvents).not.toHaveBeenCalled()
    native.authorizationStatus.mockResolvedValue("approved")
    native.readEvents.mockRejectedValue(new Error("boom"))
    await expect(syncScreenTime()).resolves.toBeUndefined()
  })
})
