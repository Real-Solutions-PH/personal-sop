// Task tags: added from the task page (several at once with commas), kept
// trimmed and once, removed with a tap, and shown on the task's row.
import { configureStorage, resetAll } from "@domain/lib/store"
import { tasksStore } from "@domain/tasks/store"
import { fireEvent, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"

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
  interpolate: (_: number, __: number[], output: number[]) => output[0],
  interpolateColor: (_: number, __: number[], output: string[]) => output[0],
  runOnJS: (fn: unknown) => fn,
  useReducedMotion: () => true,
}))
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
}))
jest.mock("expo-audio", () => ({}))
jest.mock("../media", () => ({ exportCsv: jest.fn(), pickPhoto: jest.fn() }))

const { TaskDetail } =
  require("../screens/task-detail") as typeof import("../screens/task-detail")
const { TagChips } =
  require("../screens/tasks") as typeof import("../screens/tasks")

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
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
})

const tagsOf = (id: string) =>
  tasksStore.get().tasks.find((x) => x.id === id)?.tags

it("adds tags, keeps each once, and removes one with a tap", () => {
  const task = tasksStore.get().tasks[0]
  render(<TaskDetail id={task.id} />, { wrapper })
  fireEvent.press(screen.getByLabelText("Add tag"))
  const field = screen.getByLabelText("New tag")
  fireEvent.changeText(field, "work, #Errand ,WORK")
  fireEvent(field, "submitEditing")
  expect(tagsOf(task.id)).toEqual(["work", "Errand"])
  fireEvent.press(screen.getByLabelText("Remove tag work"))
  expect(tagsOf(task.id)).toEqual(["Errand"])
})

it("shows a task's tags as chips (the row draws these under its title)", () => {
  render(<TagChips tags={["coft", "work"]} />, { wrapper })
  expect(screen.getByText("#coft")).toBeTruthy()
  expect(screen.getByText("#work")).toBeTruthy()
})

it("draws nothing for a task without tags", () => {
  render(<TagChips tags={[]} />, { wrapper })
  expect(screen.queryByText(/^#/)).toBeNull()
})
