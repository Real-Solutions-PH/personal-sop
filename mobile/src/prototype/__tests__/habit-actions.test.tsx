import * as A from "@domain/habits/actions"
import { habitsStore } from "@domain/habits/store"
import { dayKey } from "@domain/lib/day"
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import { router } from "expo-router"
import { type ReactNode, useState } from "react"
import { Alert } from "react-native"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { toast } from "sonner-native"
import { HabitsList } from "../screens/habit-list"
import { HabitForm, HabitLog } from "../screens/habits"
import { HabitsCard } from "../screens/today"

const mockParams: { current: Record<string, string> } = { current: {} }
jest.mock("expo-router", () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: () => false,
  },
  useLocalSearchParams: () => mockParams.current,
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
jest.mock("react-native-gesture-handler/ReanimatedSwipeable", () => {
  const { View } = require("react-native")
  return ({ children }: { children: ReactNode }) => <View>{children}</View>
})
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
}))
const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 44, left: 0, right: 0, bottom: 34 },
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
)
const push = router.push as jest.Mock

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  mockParams.current = {}
  habitsStore.set((s) => ({ ...s, habits: [], logs: [], routines: [] }))
  jest.clearAllMocks()
  jest.useFakeTimers()
})
afterEach(() => jest.useRealTimers())
/** Sheet actions run once the sheet has left (iOS drops them before). */
const settle = () => act(() => jest.advanceTimersByTime(600))

const walk = () => A.createHabit({ name: "Walk", icon: "🚶" })
const screenHabit = () => {
  const h = A.createHabit({ name: "Phone", icon: "📱" })
  A.updateHabit(h.id, {
    rule: { kind: "screen_limit", groupId: "g1", maxMin: 60 },
  })
  return h
}

test("long-pressing a Today habit opens its actions; Edit opens the form", () => {
  const h = walk()
  render(<HabitsCard />, { wrapper })
  fireEvent(screen.getByText(/Walk/), "longPress")
  expect(screen.getAllByText("🚶 Walk")).toHaveLength(2)
  expect(screen.getByText("Edit habit")).toBeTruthy()
  expect(screen.getByText("Log…")).toBeTruthy()
  fireEvent.press(screen.getByText("Edit habit"))
  settle()
  expect(push).toHaveBeenCalledWith(`/habits/${h.id}/edit`)
})

test("a screen-time habit's actions have no Log", () => {
  screenHabit()
  render(<HabitsCard />, { wrapper })
  fireEvent(screen.getByText(/Phone/), "longPress")
  expect(screen.getByText("Edit habit")).toBeTruthy()
  expect(screen.queryByText("Log…")).toBeNull()
})

test("rows in Manage habits open the actions for that habit", () => {
  walk()
  const other = A.createHabit({ name: "Read", icon: "📖" })
  render(<HabitsList />, { wrapper })
  fireEvent(screen.getByText("Read"), "longPress")
  expect(screen.getByText("📖 Read")).toBeTruthy()
  fireEvent.press(screen.getByText("Edit habit"))
  settle()
  expect(push).toHaveBeenCalledWith(`/habits/${other.id}/edit`)
})

test("the row's actions are reachable without the gesture", () => {
  walk()
  render(<HabitsList />, { wrapper })
  const target = screen
    .getAllByRole("button")
    .find((b) =>
      b.props.accessibilityActions?.some(
        (a: { label: string }) => a.label === "Habit actions",
      ),
    )
  expect(target).toBeDefined()
  fireEvent(target as never, "accessibilityAction", {
    nativeEvent: { actionName: "longpress" },
  })
  expect(screen.getByText("Edit habit")).toBeTruthy()
})

test("the Log sheet offers Edit habit, which closes it and opens the form", () => {
  const h = walk()
  const onClose = jest.fn()
  function Host() {
    const [open, setOpen] = useState(true)
    return (
      <HabitLog
        habit={h}
        day={dayKey()}
        open={open}
        onClose={() => {
          onClose()
          setOpen(false)
        }}
      />
    )
  }
  render(<Host />, { wrapper })
  fireEvent.press(screen.getByText("Edit habit"))
  expect(push).not.toHaveBeenCalled()
  settle()
  expect(onClose).toHaveBeenCalled()
  expect(push).toHaveBeenCalledWith(`/habits/${h.id}/edit`)
})

test("Log… in the actions opens the Log sheet once the actions have left", () => {
  walk()
  render(<HabitsCard />, { wrapper })
  fireEvent(screen.getByText(/Walk/), "longPress")
  fireEvent.press(screen.getByText("Log…"))
  settle()
  expect(screen.getByText("Log Walk")).toBeTruthy()
})

test("Archive confirms, archives with an undo toast, and Undo restores", () => {
  const h = walk()
  const alert = jest
    .spyOn(Alert, "alert")
    .mockImplementation((_t, _m, buttons) => buttons?.[1]?.onPress?.())
  render(<HabitsCard />, { wrapper })
  fireEvent(screen.getByText(/Walk/), "longPress")
  fireEvent.press(screen.getByText("Archive"))
  settle()
  expect(alert).toHaveBeenCalled()
  expect(habitsStore.get().habits.find((x) => x.id === h.id)?.status).toBe(
    "archived",
  )
  const [message, options] = (toast as unknown as jest.Mock).mock.calls[0]
  expect(message).toBe("Habit archived")
  act(() => options.action.onClick())
  expect(habitsStore.get().habits.find((x) => x.id === h.id)?.status).toBe(
    "active",
  )
})

test("a paused habit offers Resume now, which resumes with a toast", () => {
  const h = walk()
  A.pauseHabit(h.id)
  render(<HabitsList />, { wrapper })
  fireEvent(screen.getByText("Walk"), "longPress")
  fireEvent.press(screen.getByText("Resume now"))
  settle()
  expect(habitsStore.get().habits.find((x) => x.id === h.id)?.status).toBe(
    "active",
  )
  expect(toast.success).toHaveBeenCalledWith("Resumed")
})

test("Pause… opens the habit's page with its pause sheet", () => {
  const h = walk()
  render(<HabitsList />, { wrapper })
  fireEvent(screen.getByText("Walk"), "longPress")
  fireEvent.press(screen.getByText("Pause…"))
  settle()
  expect(push).toHaveBeenCalledWith(`/habits/${h.id}?pause=1`)
})

test("a plain tap still opens details and the check still checks", () => {
  const h = walk()
  render(<HabitsCard />, { wrapper })
  fireEvent.press(screen.getByText(/Walk/))
  expect(push).toHaveBeenCalledWith(`/habits/${h.id}`)
  expect(screen.queryByText("Edit habit")).toBeNull()
  fireEvent.press(screen.getByRole("checkbox", { name: "Complete Walk" }))
  expect(
    habitsStore.get().logs.find((l) => l.habitId === h.id && l.day === dayKey())
      ?.status,
  ).toBe("done")
})

test("saving an edit toasts Habit saved; an invalid save does not", () => {
  const h = walk()
  render(<HabitForm id={h.id} />, { wrapper })
  fireEvent.changeText(screen.getByLabelText("Name"), "")
  fireEvent.press(screen.getByText("Save changes"))
  expect(toast.success).not.toHaveBeenCalled()
  fireEvent.changeText(screen.getByLabelText("Name"), "Long walk")
  fireEvent.press(screen.getByText("Save changes"))
  expect(toast.success).toHaveBeenCalledWith("Habit saved")
  expect(habitsStore.get().habits.find((x) => x.id === h.id)?.name).toBe(
    "Long walk",
  )
})
