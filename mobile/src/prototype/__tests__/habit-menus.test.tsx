import * as A from "@domain/habits/actions"
import { habitsStore } from "@domain/habits/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react-native"
import { router } from "expo-router"
import {
  Archive,
  Info,
  Pause,
  Pencil,
  PenLine,
  Play,
  RotateCcw,
  Timer,
} from "lucide-react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
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
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
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

/** A pressable's visible label, read from the text inside it. */
const textOf = (b: ReturnType<typeof screen.getByRole>) =>
  within(b)
    .queryAllByText(/./)
    .map((x) => x.props.children)
    .join("")

test("Edit habit: Pause first, Archive set apart below it, each with its icon", () => {
  const h = A.createHabit({ name: "Walk", icon: "🚶" })
  render(<HabitForm id={h.id} />, { wrapper })
  const manage = screen.getByTestId("habit-manage")
  const [pause, archive, ...rest] = within(manage).getAllByRole("button")
  expect(rest).toHaveLength(0)
  expect(textOf(pause)).toBe("Pause habit")
  expect(textOf(archive)).toBe("Archive habit")
  expect(pause.findAllByType(Pause).length).toBeGreaterThan(0)
  expect(archive.findAllByType(Archive).length).toBeGreaterThan(0)
  // Pausing flips the button to Resume with a play icon.
  fireEvent.press(pause)
  act(() => jest.advanceTimersByTime(10))
  const resume = within(screen.getByTestId("habit-manage")).getAllByRole(
    "button",
  )[0]
  expect(textOf(resume)).toBe("Resume habit")
  expect(resume.findAllByType(Play).length).toBeGreaterThan(0)
  expect(habitsStore.get().habits.find((x) => x.id === h.id)?.status).toBe(
    "paused",
  )
})

/** Each group's buttons as [label, has its icon]. */
const group = (id: string, icons: unknown[]) =>
  within(screen.getByTestId(id))
    .getAllByRole("button")
    .map((b, i) => [textOf(b), b.findAllByType(icons[i] as never).length > 0])

test("Home's ⋯ opens the actions menu: today, then edit, then Archive apart", () => {
  A.createHabit({ name: "Walk", icon: "🚶" })
  render(<HabitsCard />, { wrapper })
  fireEvent.press(screen.getByLabelText("More actions for Walk"))
  expect(group("habit-actions-today", [PenLine, Info])).toEqual([
    ["Log…", true],
    ["Open details", true],
  ])
  expect(group("habit-actions-edit", [Pencil, Pause])).toEqual([
    ["Edit habit", true],
    ["Pause…", true],
  ])
  expect(group("habit-actions-danger", [Archive])).toEqual([["Archive", true]])
  // Archive is the last button in the menu.
  const all = screen.getAllByRole("button").map(textOf)
  expect(all.indexOf("Archive")).toBeGreaterThan(all.indexOf("Pause…"))
  expect(all.indexOf("Pause…")).toBeGreaterThan(all.indexOf("Log…"))
})

test("a timed habit's menu offers Start timer among today's actions", () => {
  const h = A.createHabit({ name: "Read", icon: "📖", type: "duration" })
  render(<HabitsCard />, { wrapper })
  fireEvent.press(screen.getByLabelText("More actions for Read"))
  expect(group("habit-actions-today", [PenLine, Timer, Info])).toEqual([
    ["Log…", true],
    ["Start timer", true],
    ["Open details", true],
  ])
  fireEvent.press(screen.getByText("Start timer"))
  act(() => jest.advanceTimersByTime(600))
  expect(push).toHaveBeenCalledWith(`/habits/${h.id}/timer`)
})

test("the Log sheet shows the day's entry first, with Reset beside it", () => {
  const h = A.createHabit({ name: "Walk", icon: "🚶" })
  A.checkHabit(h.id, "2026-01-01")
  render(<HabitLog habit={h} day="2026-01-01" open onClose={() => {}} />, {
    wrapper,
  })
  expect(group("habit-log-more", [Pencil])).toEqual([["Edit habit", true]])
  expect(group("habit-log-entry", [RotateCcw])).toEqual([["Reset", true]])
  // Above the day's fields: before the Today shortcut and Edit habit.
  const body = screen.getAllByRole("button").map(textOf)
  expect(body.indexOf("Reset")).toBeLessThan(body.indexOf("Today"))
  expect(body.indexOf("Reset")).toBeLessThan(body.indexOf("Edit habit"))
})

test("Edit habit in the Log sheet opened from the menu opens the form", () => {
  const h = A.createHabit({ name: "Walk", icon: "🚶" })
  render(<HabitsCard />, { wrapper })
  fireEvent.press(screen.getByLabelText("More actions for Walk"))
  fireEvent.press(screen.getByText("Log…"))
  act(() => jest.advanceTimersByTime(600))
  fireEvent.press(screen.getByText("Edit habit"))
  act(() => jest.advanceTimersByTime(600))
  expect(push).toHaveBeenCalledWith(`/habits/${h.id}/edit`)
})
