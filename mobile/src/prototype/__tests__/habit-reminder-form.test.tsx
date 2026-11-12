// The habit form's schedule and reminder: a day can sit in several time
// slots (08:00 and 20:00 every day), the Every day / Weekdays shortcuts keep
// the times already picked, and the Reminder switch never sits on with no
// time to fire at.

import { EVERY_DAY, type ScheduleSlot } from "@domain/habits/data"
import { habitsStore } from "@domain/habits/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { HabitForm, Schedule } from "../screens/habits"

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
  withDelay: (_: number, value: unknown) => value,
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
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
}))
jest.mock("../reminders", () => ({
  ...jest.requireActual("../reminders"),
  askForReminders: jest.fn(async () => true),
}))

const metrics = {
  frame: { x: 0, y: 0, width: 375, height: 812 },
  insets: { top: 44, left: 0, right: 0, bottom: 34 },
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
)

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  habitsStore.set((s) => ({ ...s, habits: [], logs: [], routines: [] }))
})

function renderSchedule(value: ScheduleSlot[]) {
  const onChange = jest.fn()
  render(<Schedule value={value} onChange={onChange} />, { wrapper })
  return onChange
}

describe("schedule slots", () => {
  test("picking a day in one slot leaves it in the other slots", () => {
    const onChange = renderSchedule([
      { days: [1, 2], time: "08:00" },
      { days: [2], time: "20:00" },
    ])
    // The second slot's Monday.
    fireEvent.press(screen.getAllByText("Mon")[1])
    expect(onChange).toHaveBeenLastCalledWith([
      { days: [1, 2], time: "08:00" },
      { days: [2, 1], time: "20:00" },
    ])
  })

  test("Every day keeps each slot's time", () => {
    const onChange = renderSchedule([
      { days: [1], time: "08:00" },
      { days: [3], time: "20:00" },
    ])
    fireEvent.press(screen.getByText("Every day"))
    expect(onChange).toHaveBeenLastCalledWith([
      { days: EVERY_DAY, time: "08:00" },
      { days: EVERY_DAY, time: "20:00" },
    ])
  })

  test("Weekdays keeps the time", () => {
    const onChange = renderSchedule([{ days: EVERY_DAY, time: "07:30" }])
    fireEvent.press(screen.getByText("Weekdays"))
    expect(onChange).toHaveBeenLastCalledWith([
      { days: [1, 2, 3, 4, 5], time: "07:30" },
    ])
  })

  test("another time starts on the same days as the slot above it", () => {
    const onChange = renderSchedule([{ days: EVERY_DAY, time: "08:00" }])
    fireEvent.press(screen.getByText("Add another time"))
    expect(onChange).toHaveBeenLastCalledWith([
      { days: EVERY_DAY, time: "08:00" },
      { days: EVERY_DAY },
    ])
  })

  test("no more than seven times, the most the server keeps", () => {
    renderSchedule(
      Array.from({ length: 7 }, (_, i) => ({
        days: EVERY_DAY,
        time: `0${i + 1}:00`,
      })),
    )
    expect(screen.queryByText("Add another time")).toBeNull()
  })
})

describe("the Reminder switch needs a time", () => {
  test("turning it on with no time opens the schedule and asks for one", () => {
    render(<HabitForm />, { wrapper })
    const sw = screen.getByRole("switch", { name: "Reminder" })
    // Every day, any time: nothing to fire at, so it shows off.
    expect(sw.props.accessibilityState.checked).toBe(false)
    expect(screen.getByText("Set a time to get a reminder")).toBeTruthy()
    fireEvent.press(sw)
    expect(screen.getByText("Pick a time for the reminder.")).toBeTruthy()
  })

  test("a habit saved with no time is saved with the reminder off", () => {
    render(<HabitForm />, { wrapper })
    fireEvent.changeText(screen.getByLabelText("Name"), "Skin care")
    act(() => {
      fireEvent.press(screen.getByText("Create habit"))
    })
    const h = habitsStore.get().habits.find((x) => x.name === "Skin care")
    expect(h?.reminder).toBe(false)
  })
})
