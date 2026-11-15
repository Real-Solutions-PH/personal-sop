// Quick add on the Plan day view: each block's "+ Add" row opens a field
// that adds a task or a habit to the selected day, at the block's time,
// with the task quick-add words; it stays open for the next one.
import { habitsStore } from "@domain/habits/store"
import { dayKey } from "@domain/lib/day"
import { configureStorage, resetAll } from "@domain/lib/store"
import * as L from "@domain/tasks/logic"
import { tasksStore } from "@domain/tasks/store"
import { fireEvent, render, screen } from "@testing-library/react-native"
import { router } from "expo-router"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { toast } from "sonner-native"

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

const { CalendarPanel, partTime } =
  require("../screens/plan") as typeof import("../screens/plan")

const metrics = {
  frame: { x: 0, y: 0, width: 375, height: 812 },
  insets: { top: 44, left: 0, right: 0, bottom: 34 },
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
)
const toastMock = toast as unknown as jest.Mock & { success: jest.Mock }

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  habitsStore.set((s) => ({ ...s, habits: [], logs: [], routines: [] }))
  tasksStore.set((s) => ({ ...s, tasks: [], lists: [] }))
  jest.clearAllMocks()
})

const monday = (d: string) =>
  L.addDays(d, -((new Date(`${d}T12:00:00`).getDay() + 6) % 7))

/** The calendar in week view on a day `weeks` away, that week's Wednesday. */
function openDay(weeks: number) {
  render(<CalendarPanel />, { wrapper })
  fireEvent.press(screen.getByRole("tab", { name: "W" }))
  const step = weeks > 0 ? "Next" : "Previous"
  for (let i = 0; i < Math.abs(weeks); i++)
    fireEvent.press(screen.getByLabelText(step))
  const day = L.addDays(monday(dayKey()), weeks * 7 + 2)
  fireEvent.press(screen.getByLabelText(`Select ${day}`))
  return day
}
const field = (noun = "task") => screen.getByLabelText(`Quick add ${noun}`)
const type = (text: string, noun = "task") => {
  fireEvent.changeText(field(noun), text)
  fireEvent(field(noun), "submitEditing")
}
const tasks = () => tasksStore.get().tasks
const habits = () => habitsStore.get().habits

test("a task added from Anytime lands on the selected day with no time", () => {
  const day = openDay(1)
  fireEvent.press(screen.getByLabelText("Add to Anytime"))
  type("Buy stamps")
  expect(tasks()).toHaveLength(1)
  expect(tasks()[0]).toMatchObject({
    title: "Buy stamps",
    dueDate: day,
    dueTime: null,
  })
  // In the list at once, and no success toast.
  expect(screen.getByText("Buy stamps")).toBeTruthy()
  expect(toastMock).not.toHaveBeenCalled()
  expect(toastMock.success).not.toHaveBeenCalled()
})

test("a task added from a block takes that block's time on that day", () => {
  const day = openDay(1)
  fireEvent.press(screen.getByLabelText("Add to Morning"))
  type("Call the bank !high")
  expect(tasks()[0]).toMatchObject({
    title: "Call the bank",
    dueDate: day,
    dueTime: "09:00",
    priority: "high",
  })
  expect(screen.getByText("Call the bank")).toBeTruthy()
})

test("typed words beat the block: a time word and a date word", () => {
  openDay(1)
  fireEvent.press(screen.getByLabelText("Add to Afternoon"))
  type("Dentist 4:30pm")
  type("Pay rent tomorrow")
  expect(tasks()[0]).toMatchObject({ title: "Dentist", dueTime: "16:30" })
  expect(tasks()[1]).toMatchObject({
    title: "Pay rent",
    dueDate: L.addDays(dayKey(), 1),
    dueTime: "14:00",
  })
})

test("rapid adds: each Return adds one and the field stays open and empty", () => {
  const day = openDay(1)
  fireEvent.press(screen.getByLabelText("Add to Anytime"))
  type("One")
  type("Two")
  type("Three")
  expect(tasks().map((t) => [t.title, t.dueDate])).toEqual([
    ["One", day],
    ["Two", day],
    ["Three", day],
  ])
  expect(field().props.value ?? "").toBe("")
  for (const title of ["One", "Two", "Three"])
    expect(screen.getByText(title)).toBeTruthy()
})

test("a habit added from Night is a daily check habit at that time", () => {
  openDay(1)
  fireEvent.press(screen.getByLabelText("Add to Night"))
  fireEvent.press(screen.getByRole("tab", { name: "Habit" }))
  type("Stretch", "habit")
  expect(tasks()).toHaveLength(0)
  expect(habits()).toHaveLength(1)
  expect(habits()[0]).toMatchObject({
    name: "Stretch",
    type: "check",
    schedule: [{ days: [0, 1, 2, 3, 4, 5, 6], time: "20:00" }],
    status: "active",
    createdAt: dayKey(),
  })
  expect(screen.getByText("✅ Stretch")).toBeTruthy()
})

test("a habit's typed time beats the block; priority words stay in its name", () => {
  openDay(1)
  fireEvent.press(screen.getByLabelText("Add to Afternoon"))
  fireEvent.press(screen.getByRole("tab", { name: "Habit" }))
  type("Read 7am", "habit")
  type("Floss !high", "habit")
  expect(habits()[0]).toMatchObject({
    name: "Read",
    schedule: [{ days: [0, 1, 2, 3, 4, 5, 6], time: "07:00" }],
  })
  expect(habits()[1].name).toBe("Floss !high")
})

test("a habit added on a past day starts that day and shows there", () => {
  const day = openDay(-1)
  fireEvent.press(screen.getByLabelText("Add to Anytime"))
  fireEvent.press(screen.getByRole("tab", { name: "Habit" }))
  type("Journal", "habit")
  expect(habits()[0]).toMatchObject({ name: "Journal", createdAt: day })
  expect(habits()[0].schedule).toEqual([{ days: [0, 1, 2, 3, 4, 5, 6] }])
  expect(screen.getByText("✅ Journal")).toBeTruthy()
})

test("a task added on a past day is due that day", () => {
  const day = openDay(-1)
  fireEvent.press(screen.getByLabelText("Add to Morning"))
  type("Log receipts")
  expect(tasks()[0]).toMatchObject({ dueDate: day, dueTime: "09:00" })
})

test("Escape folds the field away without adding", () => {
  openDay(1)
  fireEvent.press(screen.getByLabelText("Add to Anytime"))
  fireEvent.changeText(field(), "Half typed")
  fireEvent(field(), "keyPress", { nativeEvent: { key: "Escape" } })
  expect(screen.queryByLabelText("Quick add task")).toBeNull()
  expect(screen.getByLabelText("Add to Anytime")).toBeTruthy()
  expect(tasks()).toHaveLength(0)
})

test("one block's field is open at a time", () => {
  openDay(1)
  fireEvent.press(screen.getByLabelText("Add to Morning"))
  fireEvent.press(screen.getByLabelText("Add to Night"))
  expect(screen.getAllByLabelText("Quick add task")).toHaveLength(1)
  type("Late one")
  expect(tasks()[0].dueTime).toBe("20:00")
})

test("More options opens the full task screen with the day, time and line", () => {
  const day = openDay(1)
  fireEvent.press(screen.getByLabelText("Add to Morning"))
  fireEvent.changeText(field(), "Ship deck !high")
  fireEvent.press(screen.getByLabelText("More task options"))
  expect(router.push).toHaveBeenCalledWith(
    `/tasks/new?title=${encodeURIComponent("Ship deck !high")}&day=${day}&time=09:00`,
  )
  expect(tasks()).toHaveLength(0)
})

test("More options opens the full habit screen with its name and time", () => {
  openDay(1)
  fireEvent.press(screen.getByLabelText("Add to Night"))
  fireEvent.press(screen.getByRole("tab", { name: "Habit" }))
  fireEvent.changeText(field("habit"), "Meditate 9pm")
  fireEvent.press(screen.getByLabelText("More habit options"))
  expect(router.push).toHaveBeenCalledWith(
    "/habits/new?name=Meditate&time=21:00",
  )
})

test("partTime: the part's usual hour, or the coming hour while it runs", () => {
  const morning = { from: 8, to: 12, at: 9 }
  expect(partTime(morning)).toBe("09:00")
  expect(partTime(morning, { hour: 10, min: 15 })).toBe("11:00")
  expect(partTime(morning, { hour: 8, min: 10 })).toBe("09:00")
  // Too late in the part for a later hour: its usual one.
  expect(partTime(morning, { hour: 11, min: 30 })).toBe("09:00")
  expect(partTime(morning, { hour: 15, min: 0 })).toBe("09:00")
  // Past midnight in Night (hours run on to 28).
  expect(partTime({ from: 18, to: 28, at: 20 }, { hour: 25, min: 5 })).toBe(
    "02:00",
  )
})
