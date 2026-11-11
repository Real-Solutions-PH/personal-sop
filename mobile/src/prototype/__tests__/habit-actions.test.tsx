import { dashStore } from "@domain/dash/store"
import * as A from "@domain/habits/actions"
import * as HL from "@domain/habits/logic"
import { habitsStore } from "@domain/habits/store"
import { dayKey, dayOffset } from "@domain/lib/day"
import { configureStorage, resetAll } from "@domain/lib/store"
import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react-native"
import { router } from "expo-router"
import { type ReactNode, useState } from "react"
import { Alert } from "react-native"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { toast } from "sonner-native"
import { statColumns } from "../screens/habit-detail"
import { HabitsList } from "../screens/habit-list"
import { HabitDetail, HabitForm, HabitLog } from "../screens/habits"
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

const screenTime = (on: boolean) =>
  dashStore.set((s) => ({ ...s, enabled: { ...s.enabled, screen: on } }))

test("a screen-time habit's actions have no Log", () => {
  screenTime(true)
  screenHabit()
  render(<HabitsCard />, { wrapper })
  fireEvent(screen.getByText(/Phone/), "longPress")
  expect(screen.getByText("Edit habit")).toBeTruthy()
  expect(screen.queryByText("Log…")).toBeNull()
})

test("with Screen time off, a screen-time habit is logged by hand everywhere", () => {
  screenTime(false)
  const h = screenHabit()
  // The actions offer Log, as for any habit.
  const card = render(<HabitsCard />, { wrapper })
  fireEvent(screen.getByText(/Phone/), "longPress")
  expect(screen.getByText("Log…")).toBeTruthy()
  card.unmount()
  // The Habits list's Today view shows a check and says why.
  const list = render(<HabitsList />, { wrapper })
  fireEvent.press(screen.getByText("Today"))
  expect(screen.getByRole("checkbox", { name: "Check Phone" })).toBeTruthy()
  expect(screen.getByText(/Screen Time off · log it yourself/)).toBeTruthy()
  list.unmount()
  // Its page offers Mark done instead of the automatic ring.
  render(<HabitDetail id={h.id} />, { wrapper })
  expect(screen.getByText("Mark done")).toBeTruthy()
  expect(screen.getByText("Screen Time off · log it yourself")).toBeTruthy()
})

test("with Screen time on, the list and the page keep it automatic", () => {
  screenTime(true)
  const h = screenHabit()
  const list = render(<HabitsList />, { wrapper })
  fireEvent.press(screen.getByText("Today"))
  expect(screen.queryByRole("checkbox", { name: "Check Phone" })).toBeNull()
  list.unmount()
  render(<HabitDetail id={h.id} />, { wrapper })
  expect(screen.queryByText("Mark done")).toBeNull()
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

test("Archive confirms and archives, without a toast", () => {
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
  // Restoring lives in Archived, as the confirmation says.
  expect(toast).not.toHaveBeenCalled()
})

test("a paused habit offers Resume now, which resumes without a toast", () => {
  const h = walk()
  A.pauseHabit(h.id)
  render(<HabitsList />, { wrapper })
  fireEvent(screen.getByText("Walk"), "longPress")
  fireEvent.press(screen.getByText("Resume now"))
  settle()
  expect(habitsStore.get().habits.find((x) => x.id === h.id)?.status).toBe(
    "active",
  )
  expect(toast.success).not.toHaveBeenCalled()
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
  // Commits after the check's celebration beat.
  settle()
  expect(
    habitsStore.get().logs.find((l) => l.habitId === h.id && l.day === dayKey())
      ?.status,
  ).toBe("done")
})

test("an edit saves itself without a toast; an invalid draft is not saved", () => {
  const h = walk()
  render(<HabitForm id={h.id} />, { wrapper })
  expect(screen.queryByText("Save changes")).toBeNull()
  fireEvent.changeText(screen.getByLabelText("Name"), "")
  settle()
  expect(habitsStore.get().habits.find((x) => x.id === h.id)?.name).toBe(h.name)
  // The header says why it is not saved.
  expect(screen.getByText("Name it to save")).toBeTruthy()
  fireEvent.changeText(screen.getByLabelText("Name"), "Long walk")
  settle()
  expect(toast.success).not.toHaveBeenCalled()
  expect(habitsStore.get().habits.find((x) => x.id === h.id)?.name).toBe(
    "Long walk",
  )
  expect(screen.getByLabelText("Saved")).toBeTruthy()
})

test("the detail page shows the streak as a number with its unit, and Log by icon and name", () => {
  const h = walk()
  A.checkHabit(h.id)
  render(<HabitDetail id={h.id} />, { wrapper })
  expect(screen.getByLabelText("Current streak, 1 day")).toBeTruthy()
  expect(screen.queryByText(/-day$/)).toBeNull()
  expect(
    within(screen.getByTestId("current-streak")).getByText("day"),
  ).toBeTruthy()
  expect(screen.getByText("Done · undo")).toBeTruthy()
  expect(screen.getByRole("button", { name: "Log a day" })).toBeTruthy()
})

test("the stats grid drops columns before a figure can collide with its neighbour", () => {
  // Inner widths of the stats card at 320, 375, 390 and 430pt phones.
  const widths = [254, 309, 324, 364]
  for (const width of widths)
    for (let chars = 1; chars <= 12; chars++)
      for (const scale of [1, 1.35, 2, 3.1]) {
        const cols = statColumns(width, chars, scale),
          need = Math.max(chars * 24 * 0.62, 72) * Math.min(scale, 2)
        // Each cell keeps 12pt clear on its right; a single column wraps.
        expect(cols === 1 || width / cols - 12 >= need).toBe(true)
        expect(cols).toBeGreaterThanOrEqual(1)
        expect(cols).toBeLessThanOrEqual(3)
      }
  // Short figures stay three across even on a 320pt phone.
  expect(statColumns(254, 4)).toBe(3)
  // A seven-digit figure ("1,234,567") gets its own room.
  expect(statColumns(254, 9)).toBe(1)
  expect(statColumns(364, 9)).toBe(2)
  // Before the first layout: two columns, never zero.
  expect(statColumns(0, 4)).toBe(2)
})

/** What the detail page derives from the logs: streaks (grace use
 * included), the 30-day stats and the cell each day shows. */
const derived = (id: string) => {
  const h = habitsStore.get().habits.find((x) => x.id === id)
  if (!h) throw new Error("no habit")
  const idx = HL.logIndex(habitsStore.get().logs),
    today = dayKey(),
    st = HL.streaks(h, idx, today)
  return {
    current: st.current,
    best: st.best,
    broken: st.broken,
    stats: HL.habitStats(h, idx, dayOffset(-29), today, today),
    cells: Array.from({ length: 8 }, (_, i) =>
      HL.cellFor(h, dayOffset(-i), idx, today),
    ),
  }
}

test("a wrongly ticked day resets from the Calendar and every stat returns", () => {
  // Mid-month, so the days below are all in the Calendar's month.
  jest.setSystemTime(new Date("2026-06-15T12:00:00"))
  const h = walk()
  habitsStore.set((s) => ({
    ...s,
    habits: s.habits.map((x) =>
      x.id === h.id ? { ...x, createdAt: dayOffset(-7) } : x,
    ),
  }))
  // A run with one miss in it (2 days ago), so grace and streaks matter.
  for (const n of [-7, -6, -5, -4, -3, -1]) A.checkHabit(h.id, dayOffset(n))
  const before = derived(h.id)
  // Ticked by mistake.
  const wrong = dayOffset(-2)
  A.checkHabit(h.id, wrong)
  expect(derived(h.id)).not.toEqual(before)
  render(<HabitDetail id={h.id} />, { wrapper })
  fireEvent.press(screen.getByLabelText(`${wrong}: done`))
  // The sheet opens on that day's entry, with Reset beside it.
  expect(screen.getByTestId("habit-log-entry")).toBeTruthy()
  fireEvent.press(screen.getByRole("button", { name: /^Reset/ }))
  expect(derived(h.id)).toEqual(before)
  // The outcome shows in place; no toast (toasts are for ticks only).
  expect(screen.getByText("Not logged")).toBeTruthy()
  expect(screen.queryByRole("button", { name: /^Reset/ })).toBeNull()
  expect(toast).not.toHaveBeenCalled()
  expect(toast.success).not.toHaveBeenCalled()
  // The footer now only closes: tapping it cannot write the tick back.
  expect(screen.queryByText("Save log")).toBeNull()
  fireEvent.press(screen.getByText("Done"))
  expect(derived(h.id)).toEqual(before)
  // Ticking the day again later counts it once more.
  A.checkHabit(h.id, wrong)
  expect(
    habitsStore.get().logs.filter((l) => l.habitId === h.id && l.day === wrong),
  ).toHaveLength(1)
  A.clearLog(h.id, wrong)
  expect(derived(h.id)).toEqual(before)
})

test("editing a field after Reset brings Save log back", () => {
  const h = walk()
  A.checkHabit(h.id)
  render(<HabitLog habit={h} day={dayKey()} open onClose={() => {}} />, {
    wrapper,
  })
  fireEvent.press(screen.getByRole("button", { name: /^Reset/ }))
  fireEvent.press(screen.getByText("Yesterday"))
  expect(screen.getByText("Save log")).toBeTruthy()
})

test("a screen-time habit's Calendar day still opens the day page", () => {
  screenTime(true)
  const h = screenHabit()
  render(<HabitDetail id={h.id} />, { wrapper })
  fireEvent.press(screen.getByLabelText(new RegExp(`^${dayKey()}:`)))
  expect(push).toHaveBeenCalledWith(`/habits/day/${dayKey()}`)
  expect(screen.queryByTestId("habit-log-entry")).toBeNull()
})

test("a count habit's day resets to nothing logged", () => {
  const h = A.createHabit({
    name: "Water",
    icon: "💧",
    type: "count",
    target: 8,
  })
  A.incrementCount(h.id, 3)
  render(<HabitLog habit={h} day={dayKey()} open onClose={() => {}} />, {
    wrapper,
  })
  fireEvent.press(screen.getByRole("button", { name: /^Reset/ }))
  expect(habitsStore.get().logs.filter((l) => l.habitId === h.id)).toHaveLength(
    0,
  )
  expect(screen.getByText("Not logged")).toBeTruthy()
  // The amount field goes back to the target, ready for a fresh entry.
  expect(screen.getByDisplayValue("8")).toBeTruthy()
})
