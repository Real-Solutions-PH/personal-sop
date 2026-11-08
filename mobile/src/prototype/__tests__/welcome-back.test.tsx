// The way back: after two or more empty days, Fern opens with a catch-up.
// One sentence fills in the gap through capture (hint catch_up with the
// gap's first day), streaks are paused across the gap, then "Here's where
// you are", Fern's review and an offer of the daily check-in.
import { captureStore } from "@domain/capture/store"
import { dashStore } from "@domain/dash/store"
import { finStore } from "@domain/finance/store"
import { fitStore } from "@domain/fitness/store"
import type { Habit, HabitLog } from "@domain/habits/data"
import { addDays } from "@domain/habits/logic"
import { habitsStore } from "@domain/habits/store"
import { dayKey } from "@domain/lib/day"
import { configureStorage, resetAll } from "@domain/lib/store"
import { tasksStore } from "@domain/tasks/store"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"

jest.mock("expo-speech-recognition", () => ({
  ExpoSpeechRecognitionModule: {
    addListener: () => ({ remove: () => {} }),
    start: jest.fn(),
    stop: jest.fn(),
  },
}))
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
  usePathname: () => "/today/welcome-back",
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
  withDelay: (_: number, value: unknown) => value,
  withSequence: (...values: unknown[]) => values[values.length - 1],
  withRepeat: (value: unknown) => value,
  interpolate: (_: number, __: number[], output: number[]) => output[0],
  interpolateColor: (_: number, __: number[], output: string[]) => output[0],
  runOnJS: (fn: unknown) => fn,
  useReducedMotion: () => true,
  cancelAnimation: () => {},
  Easing: new Proxy({}, { get: () => () => () => 0 }),
}))
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
}))
jest.mock("expo-audio", () => ({
  AudioModule: { requestRecordingPermissionsAsync: jest.fn() },
  RecordingPresets: { HIGH_QUALITY: {} },
  setAudioModeAsync: jest.fn(),
  useAudioRecorder: () => ({}),
  useAudioRecorderState: () => ({}),
}))
jest.mock("../media", () => ({ exportCsv: jest.fn(), pickPhoto: jest.fn() }))

const { WelcomeBack, wayBackNow } =
  require("../screens/welcome-back") as typeof import("../screens/welcome-back")

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      {children}
    </SafeAreaProvider>
  </QueryClientProvider>
)

const today = dayKey()
const last = addDays(today, -4)
const gym: Habit = {
  id: "gym",
  name: "Gym",
  icon: "✅",
  type: "check",
  schedule: [{ days: [0, 1, 2, 3, 4, 5, 6] }],
  reminder: false,
  status: "active",
  pauses: [],
  linkWorkout: false,
  createdAt: addDays(today, -20),
  sortOrder: 0,
}
const logs: HabitLog[] = Array.from({ length: 8 }, (_, i) => {
  const day = addDays(last, -i)
  return {
    id: `g${i}`,
    habitId: "gym",
    day,
    status: "done",
    loggedAt: `${day}T08:00:00`,
    source: "tap",
  }
})

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  habitsStore.set((s) => ({ ...s, habits: [gym], logs }))
  captureStore.set((s) => ({ ...s, captures: [], journal: [] }))
  dashStore.set((s) => ({ ...s, wayBackSeenFor: "" }))
  tasksStore.set((s) => ({ ...s, tasks: [], events: [] }))
  finStore.set((s) => ({ ...s, records: [] }))
  fitStore.set((s) => ({ ...s, workouts: [], runs: [], meals: [] }))
})

describe("wayBackNow", () => {
  it("finds the gap since the last active day", () => {
    const w = wayBackNow(today, {
      logs,
      taskEvents: [],
      records: [],
      workouts: [],
      runs: [],
      meals: [],
      journal: [],
      captures: [],
    })
    expect(w.last).toBe(last)
    expect(w.gap).toEqual({
      from: addDays(last, 1),
      to: addDays(today, -1),
      days: 3,
    })
    expect(w.show).toBe(true)
  })
})

describe("WelcomeBack", () => {
  const show = () =>
    render(<WelcomeBack onDone={jest.fn()} />, {
      wrapper,
    })

  it("says how long they were away, with no blame", () => {
    show()
    expect(screen.getByText("Welcome back.")).toBeTruthy()
    expect(screen.getByText(/You were away 3 days/)).toBeTruthy()
    expect(screen.getByText("Start from today")).toBeTruthy()
    expect(screen.queryByText(/lost|failed|broke/i)).toBeNull()
  })

  it("start from today pauses streaks, marks the gap seen and leaves", () => {
    const onDone = jest.fn()
    render(<WelcomeBack onDone={onDone} />, { wrapper })
    fireEvent.press(screen.getByText("Start from today"))
    expect(onDone).toHaveBeenCalled()
    expect(habitsStore.get().habits[0].pauses).toEqual([
      { from: addDays(last, 1), to: addDays(today, -1), reason: "way_back" },
    ])
    expect(dashStore.get().wayBackSeenFor).toBe(last)
  })

  it("catch-up sends one capture for the gap, then shows where you are", () => {
    jest.useFakeTimers()
    show()
    fireEvent.changeText(
      screen.getByLabelText("Capture message"),
      "skipped gym, ate takeaway most nights",
    )
    fireEvent.press(screen.getByLabelText("Send"))
    const cap = captureStore.get().captures.at(-1)
    expect(cap?.hint).toBe("catch_up")
    expect(cap?.rangeFrom).toBe(addDays(last, 1))
    expect(habitsStore.get().habits[0].pauses).toHaveLength(1)
    act(() => {
      jest.runOnlyPendingTimers()
    })
    expect(screen.getByText("Here's where you are")).toBeTruthy()
    expect(
      screen.getByText("Gym: 3 days missed · streak paused at 8"),
    ).toBeTruthy()
    expect(screen.getByTestId("fern-review")).toBeTruthy()
    jest.useRealTimers()
  })

  it("offers the daily check-in after the catch-up", () => {
    show()
    fireEvent.changeText(screen.getByLabelText("Capture message"), "fine")
    fireEvent.press(screen.getByLabelText("Send"))
    fireEvent.press(screen.getByLabelText("Want Fern to ask each evening?"))
    expect(dashStore.get().push.checkin).toBe("21:00")
  })

  it("writes nothing when left without a button", () => {
    const view = show()
    view.unmount()
    expect(habitsStore.get().habits[0].pauses).toEqual([])
    expect(dashStore.get().wayBackSeenFor).toBe("")
  })
})

describe("maybeOpenWayBack", () => {
  it("opens the way back once per app session when due", () => {
    const { maybeOpenWayBack } =
      require("../screens/welcome-back") as typeof import("../screens/welcome-back")
    const open = jest.fn()
    maybeOpenWayBack(open)
    maybeOpenWayBack(open)
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith("/today/welcome-back")
  })
})
