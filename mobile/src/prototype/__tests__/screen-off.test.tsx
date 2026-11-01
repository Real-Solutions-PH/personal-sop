// Screen time switched off: the switch follows the iOS permission (asked
// before it turns on, turned off on a deny or when no minutes arrive), and
// while it is off screen data shows nowhere and is used for nothing.

import { useGoals } from "@domain/dash/hooks"
import { dashStore, setEnabled } from "@domain/dash/store"
import { checkHabit } from "@domain/habits/actions"
import type { Habit } from "@domain/habits/data"
import { habitsStore } from "@domain/habits/store"
import { dayOffset } from "@domain/lib/day"
import { configureStorage, resetAll } from "@domain/lib/store"
import type { ScreenDay, ScreenGroup } from "@domain/screen/data"
import { screenStore } from "@domain/screen/store"
import { render, renderHook, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { toast } from "sonner-native"
import { syncReady } from "@/live/ready"
import * as ST from "../screen-time"

jest.mock("../screen-time", () => ({
  screenTimeAvailable: jest.fn(() => true),
  authorizationStatus: jest.fn(async () => "approved"),
  requestScreenTime: jest.fn(async () => "approved"),
  pickApps: jest.fn(async () => true),
  hasSelection: jest.fn(async () => false),
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
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
}))

const native = ST as jest.Mocked<typeof ST>
const AsyncStorage = require("@react-native-async-storage/async-storage")
const sync = require("../screen-sync") as typeof import("../screen-sync")
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider
    initialMetrics={{
      frame: { x: 0, y: 0, width: 390, height: 844 },
      insets: { top: 0, left: 0, right: 0, bottom: 0 },
    }}
  >
    {children}
  </SafeAreaProvider>
)

// 09:00 local on a Tuesday, well inside one app day.
const T0 = new Date(2026, 9, 20, 9, 0, 0).getTime()
const DAY = 86_400_000
const ALL: ScreenGroup = {
  id: "g-all",
  name: "All apps",
  kind: "all",
  budgetMin: 180,
  sortOrder: 0,
}
const row = (back: number): ScreenDay => ({
  id: `d-${back}`,
  groupId: ALL.id,
  day: dayOffset(-back),
  usedMin: 90,
  closed: true,
  updatedAt: new Date(T0).toISOString(),
})
const screenOn = () => dashStore.get().enabled.screen

beforeEach(async () => {
  jest.useFakeTimers({ now: T0 })
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  jest.clearAllMocks()
  await AsyncStorage.clear()
  native.screenTimeAvailable.mockReturnValue(true)
  native.authorizationStatus.mockResolvedValue("approved")
  native.requestScreenTime.mockResolvedValue("approved")
  native.readEvents.mockResolvedValue([])
  screenStore.set({ groups: [ALL], days: [] })
  setEnabled("screen", true)
  syncReady.setState({ ready: true })
})
afterEach(() => jest.useRealTimers())

describe("turning Screen time on", () => {
  test("turns on only once iOS approves", async () => {
    setEnabled("screen", false)
    await expect(sync.enableScreenTime()).resolves.toBe(true)
    expect(native.requestScreenTime).toHaveBeenCalledTimes(1)
    expect(screenOn()).toBe(true)
  })

  test("a deny keeps it off and says how to allow it", async () => {
    setEnabled("screen", false)
    native.requestScreenTime.mockResolvedValue("denied")
    await expect(sync.enableScreenTime()).resolves.toBe(false)
    expect(screenOn()).toBe(false)
    expect(toast).toHaveBeenCalledWith(sync.SCREEN_DENIED)
  })

  test("a build without Screen Time keeps it off and says no phone setting fixes it", async () => {
    setEnabled("screen", false)
    native.screenTimeAvailable.mockReturnValue(false)
    await expect(sync.enableScreenTime()).resolves.toBe(false)
    expect(native.requestScreenTime).not.toHaveBeenCalled()
    expect(screenOn()).toBe(false)
    expect(toast).toHaveBeenCalledWith(
      "This version of Unfurl doesn't include Screen Time, so there is nothing to turn on in your iPhone's Settings. It comes in an update.",
    )
  })

  test("an iOS that can't answer keeps it off and names the iOS version", async () => {
    setEnabled("screen", false)
    native.requestScreenTime.mockResolvedValue("unavailable")
    await expect(sync.enableScreenTime()).resolves.toBe(false)
    expect(screenOn()).toBe(false)
    expect(toast).toHaveBeenCalledWith(
      "Unfurl couldn't reach Screen Time here. It needs iOS 16 or later.",
    )
  })
})

describe("screenTimeState", () => {
  test.each([
    // No native module wins over whatever status was read.
    [false, null, "notInBuild"],
    [false, "unavailable", "notInBuild"],
    [false, "approved", "notInBuild"],
    [true, null, "checking"],
    [true, "approved", "connected"],
    [true, "denied", "denied"],
    [true, "notDetermined", "notAsked"],
    [true, "unavailable", "unsupported"],
  ] as const)("available=%s, auth=%s is %s", (available, auth, expected) => {
    expect(sync.screenTimeState(available, auth)).toBe(expected)
  })
})

describe("returning to the foreground", () => {
  let onChange: (s: string) => void
  let stop: () => void
  beforeEach(() => {
    const { AppState } = require("react-native")
    jest.spyOn(AppState, "addEventListener").mockImplementation((...a) => {
      onChange = a[1] as (s: string) => void
      return { remove: () => {} }
    })
  })
  afterEach(() => stop?.())

  test("re-reads the permission while Screen time is off", async () => {
    setEnabled("screen", false)
    native.authorizationStatus.mockResolvedValue("denied")
    stop = sync.startScreenSync()
    await sync.refreshScreenStatus()
    expect(sync.screenStatus.getState().auth).toBe("denied")

    // Allowed in iOS Settings while away.
    native.authorizationStatus.mockResolvedValue("approved")
    onChange("active")
    await jest.runAllTimersAsync()
    expect(sync.screenStatus.getState().auth).toBe("approved")
  })

  test("re-reads it before the account's state is known", async () => {
    syncReady.setState({ ready: false })
    native.authorizationStatus.mockResolvedValue("notDetermined")
    stop = sync.startScreenSync()
    native.authorizationStatus.mockResolvedValue("approved")
    onChange("active")
    await jest.runAllTimersAsync()
    expect(sync.screenStatus.getState().auth).toBe("approved")
  })

  test("leaving for the background reads nothing", async () => {
    setEnabled("screen", false)
    stop = sync.startScreenSync()
    native.authorizationStatus.mockClear()
    onChange("background")
    await jest.runAllTimersAsync()
    expect(native.authorizationStatus).not.toHaveBeenCalled()
  })
})

describe("the foreground check", () => {
  test("a revoked permission turns it off once, and monitoring stops", async () => {
    native.authorizationStatus.mockResolvedValue("approved")
    await AsyncStorage.setItem(sync.APPROVED_KEY, String(T0))
    await sync.syncScreenTime()
    expect(native.startMonitoring).toHaveBeenCalledTimes(1)

    native.authorizationStatus.mockResolvedValue("denied")
    await sync.syncScreenTime()
    expect(screenOn()).toBe(false)
    expect(native.stopMonitoring).toHaveBeenCalledTimes(1)
    expect(await AsyncStorage.getItem(sync.PLAN_KEY)).toBeNull()
    await sync.syncScreenTime()
    expect(jest.mocked(toast).mock.calls).toEqual([
      [
        "Screen Time access was turned off, so screen time is hidden from your stats.",
      ],
    ])
    expect(native.stopMonitoring).toHaveBeenCalledTimes(1)
  })

  test("a phone that can't read Screen Time keeps it on while recent minutes exist", async () => {
    native.screenTimeAvailable.mockReturnValue(false)
    screenStore.set({ groups: [ALL], days: [row(3)] })
    await sync.syncScreenTime()
    expect(screenOn()).toBe(true)

    screenStore.set({ groups: [ALL], days: [row(14)] })
    await sync.syncScreenTime()
    expect(screenOn()).toBe(false)
    expect(toast).not.toHaveBeenCalled()
  })

  test("an approved phone gets 14 days for its first minutes", async () => {
    await sync.syncScreenTime()
    expect(screenOn()).toBe(true)
    jest.setSystemTime(T0 + 13 * DAY)
    await sync.syncScreenTime()
    expect(screenOn()).toBe(true)
    jest.setSystemTime(T0 + 15 * DAY)
    await sync.syncScreenTime()
    expect(screenOn()).toBe(false)
  })

  test("an undetermined permission never turns it off by itself", async () => {
    native.authorizationStatus.mockResolvedValue("notDetermined")
    await sync.syncScreenTime()
    expect(screenOn()).toBe(true)
    native.authorizationStatus.mockResolvedValue("denied")
    await sync.syncScreenTime()
    expect(screenOn()).toBe(false)
  })

  test("does nothing before the account's state is known", async () => {
    syncReady.setState({ ready: false })
    native.authorizationStatus.mockResolvedValue("denied")
    await sync.syncScreenTime()
    expect(screenOn()).toBe(true)
  })

  test("while off it reads nothing and writes no rows", async () => {
    setEnabled("screen", false)
    await sync.syncScreenTime()
    expect(native.readEvents).not.toHaveBeenCalled()
    expect(native.authorizationStatus).not.toHaveBeenCalled()
  })
})

describe("screen data while off", () => {
  const ruleHabit: Habit = {
    id: "h-social",
    name: "Less social media",
    icon: "📵",
    type: "check",
    schedule: [{ days: [0, 1, 2, 3, 4, 5, 6] }],
    reminder: false,
    status: "active",
    pauses: [],
    linkWorkout: false,
    rule: { kind: "screen_limit", groupId: ALL.id, maxMin: 30 },
    createdAt: dayOffset(-30),
    sortOrder: 1,
  }
  const logsToday = () =>
    habitsStore
      .get()
      .logs.filter((l) => l.habitId === ruleHabit.id && l.day === dayOffset(0))

  test("a habit with a screen-time rule is ticked by hand like any habit", () => {
    habitsStore.set((s) => ({ ...s, habits: [ruleHabit], logs: [] }))
    checkHabit(ruleHabit.id, dayOffset(0))
    expect(logsToday()).toHaveLength(0)
    setEnabled("screen", false)
    checkHabit(ruleHabit.id, dayOffset(0))
    expect(logsToday()).toMatchObject([{ status: "done" }])
  })

  test("Screen time goals leave the goal list, and come back with it on", () => {
    dashStore.set((s) => ({
      ...s,
      goals: [
        ...s.goals,
        {
          id: "g-scr",
          metric: "screen:screen.used",
          label: "Screen time a day",
          target: 180,
          unit: "",
          comparator: "lte",
          period: "week",
          status: "active",
          createdAt: dayOffset(-5),
        },
      ],
    }))
    const { result: on } = renderHook(() => useGoals())
    expect(
      on.current.filter((g) => g.goal.metric.startsWith("screen:")),
    ).toHaveLength(1)
    setEnabled("screen", false)
    const { result: off } = renderHook(() => useGoals())
    expect(
      off.current.filter((g) => g.goal.metric.startsWith("screen:")),
    ).toHaveLength(0)
    expect(dashStore.get().goals.some((g) => g.id === "g-scr")).toBe(true)
  })

  test("Stats has no Screen corner, area or card", async () => {
    const { StatsHome } = require("../screens/stats-home")
    screenStore.set({ groups: [ALL], days: [row(1), row(2)] })
    const shown = render(<StatsHome />, { wrapper })
    // Shown once iOS answers that Screen Time is connected.
    expect(await screen.findByLabelText(/^Area hexagon: .*Screen/)).toBeTruthy()
    expect(screen.queryAllByText("Screen time").length).toBeGreaterThan(0)
    shown.unmount()

    setEnabled("screen", false)
    render(<StatsHome />, { wrapper })
    expect(
      screen.getByLabelText(/^Area hexagon: /).props.accessibilityLabel,
    ).not.toMatch(/Screen/)
    expect(screen.queryAllByText("Screen time")).toHaveLength(0)
  })
})
