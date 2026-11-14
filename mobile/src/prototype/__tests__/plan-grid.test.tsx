// The Plan tab's hour grid (its layout is tested in plan-grid-layout): a
// moved item shows where it was and resets with a tap; the screen-reader
// adjust actions move it a quarter hour (the drag's alternative).
import type { CalendarItem } from "@domain/contract"
import { configureStorage, resetAll } from "@domain/lib/store"
import { withOverrides } from "@domain/schedule/logic"
import { scheduleStore } from "@domain/schedule/store"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { DayGrid } from "../screens/plan-grid"

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

// A move reports itself in place (the block lands, the mark appears),
// never with a toast: toasts are for ticking habits and tasks.
jest.mock("sonner-native", () => {
  const toast = Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
  })
  return { toast, Toaster: () => null }
})

const DAY = "2026-11-12"
const habit = (id: string, time: string): CalendarItem => ({
  id: `habit-${id}-${DAY}`,
  day: DAY,
  time,
  title: `Habit ${id}`,
  module: "habits",
  href: `/habits/${id}`,
})

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
})

function Grid() {
  const overrides = scheduleStore.use((s) => s.overrides)
  return <DayGrid items={withOverrides([habit("a", "09:00")], overrides)} />
}

test("adjusting moves it a quarter hour for the day; the mark resets it", () => {
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <Grid />
    </SafeAreaProvider>,
  )
  // Lay out the grid so blocks render.
  act(() => {
    fireEvent(screen.getByTestId("plan-day-grid"), "layout", {
      nativeEvent: { layout: { width: 360, height: 800 } },
    })
  })
  const block = screen.getByLabelText("Habit a, 9 AM")
  act(() => {
    fireEvent(block, "accessibilityAction", {
      nativeEvent: { actionName: "increment" },
    })
  })
  expect(scheduleStore.get().overrides.map((o) => o.time)).toEqual(["09:15"])
  expect(
    screen.getByLabelText("Habit a, 9:15 AM, moved for this day"),
  ).toBeTruthy()
  act(() => {
    fireEvent.press(
      screen.getByLabelText("Moved for this day from 9 AM. Reset"),
    )
  })
  expect(scheduleStore.get().overrides).toEqual([])
  expect(screen.getByLabelText("Habit a, 9 AM")).toBeTruthy()
  const { toast } = jest.requireMock("sonner-native")
  expect(toast).not.toHaveBeenCalled()
  expect(toast.success).not.toHaveBeenCalled()
})
