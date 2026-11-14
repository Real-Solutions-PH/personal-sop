// A habit with two reminder times shows twice in the Plan tab's timelines,
// once in each part of the day its reminder sits in, and each row ticks its
// own share of the count with the tick toast (habits/slots).

import { createHabit } from "@domain/habits/actions"
import { EVERY_DAY } from "@domain/habits/data"
import { lk, logIndex } from "@domain/habits/logic"
import { habitsStore } from "@domain/habits/store"
import { dayKey } from "@domain/lib/day"
import { configureStorage, resetAll } from "@domain/lib/store"
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

const { HabitPlanPanel, CalendarPanel } =
  require("../screens/plan") as typeof import("../screens/plan")

const metrics = {
  frame: { x: 0, y: 0, width: 375, height: 812 },
  insets: { top: 44, left: 0, right: 0, bottom: 34 },
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
)
const toastMock = toast as unknown as jest.Mock
const TWICE = [
  { days: EVERY_DAY, time: "08:00" },
  { days: EVERY_DAY, time: "20:00" },
]
const beat = () => act(() => jest.advanceTimersByTime(MOTION.commit + 40))
const logOf = (id: string) =>
  logIndex(habitsStore.get().logs).get(lk(id, dayKey()))
const skinCare = () =>
  createHabit({
    name: "Skin care",
    icon: "🧴",
    type: "count",
    target: 2,
    step: 1,
    schedule: TWICE,
  })

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  habitsStore.set((s) => ({ ...s, habits: [], logs: [], routines: [] }))
  tasksStore.set((s) => ({ ...s, tasks: [] }))
  jest.clearAllMocks()
  jest.useFakeTimers()
})
afterEach(() => jest.useRealTimers())

describe("Calendar segment", () => {
  it("shows the habit in the morning and at night", () => {
    skinCare()
    render(<CalendarPanel />, { wrapper })
    expect(screen.getAllByText("🧴 Skin care")).toHaveLength(2)
    expect(screen.getAllByLabelText("Complete Skin care")).toHaveLength(2)
  })
  it("ticking the morning row logs 1 of 2 and leaves the night row open", () => {
    const h = skinCare()
    render(<CalendarPanel />, { wrapper })
    fireEvent.press(screen.getAllByLabelText("Complete Skin care")[0])
    beat()
    expect(logOf(h.id)).toMatchObject({ value: 1, status: "partial" })
    expect(toastMock).toHaveBeenCalledWith(
      "Skin care 1 of 2 done",
      expect.objectContaining({
        action: expect.objectContaining({ label: "Undo" }),
      }),
    )
    expect(screen.getByLabelText("Reopen Skin care")).toBeTruthy()
    expect(screen.getByLabelText("Complete Skin care")).toBeTruthy()
  })
  it("one reminder: one row, as before", () => {
    createHabit({
      name: "Stretch",
      schedule: [{ days: EVERY_DAY, time: "08:00" }],
    })
    render(<CalendarPanel />, { wrapper })
    expect(screen.getAllByLabelText("Complete Stretch")).toHaveLength(1)
  })
})

describe("Habits segment", () => {
  it("lists the habit at each time, each ticked on its own", () => {
    const h = skinCare()
    render(<HabitPlanPanel />, { wrapper })
    expect(screen.getAllByLabelText("Complete Skin care")).toHaveLength(2)
    expect(screen.getByText("8am")).toBeTruthy()
    expect(screen.getByText("8pm")).toBeTruthy()
    fireEvent.press(screen.getAllByLabelText("Complete Skin care")[1])
    beat()
    // The night row is the target's second share: both are done.
    expect(logOf(h.id)).toMatchObject({ value: 2, status: "done" })
    expect(screen.getAllByLabelText("Reopen Skin care")).toHaveLength(2)
  })
})
