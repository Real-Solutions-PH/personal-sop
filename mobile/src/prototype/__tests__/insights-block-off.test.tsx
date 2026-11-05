// Fern's insights card leaves out a module that is switched off.
import { setEnabled } from "@domain/dash/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import type { Task } from "@domain/tasks/data"
import { tasksStore } from "@domain/tasks/store"
import { render, screen } from "@testing-library/react-native"
import { BlockView } from "../companion/blocks"

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
  runOnJS: (fn: unknown) => fn,
  useReducedMotion: () => true,
}))
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
}))
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
  usePathname: () => "/",
}))

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  tasksStore.set((s) => ({
    ...s,
    tasks: [
      {
        id: "late",
        title: "Old one",
        status: "open",
        dueDate: "2020-01-01",
      } as Task,
    ],
  }))
})

const insights = () => render(<BlockView block={{ t: "insights" }} />)

test("all on: the workouts and overdue-task insights show", () => {
  insights()
  expect(screen.getByText(/workouts? this week/)).toBeTruthy()
  expect(screen.getByText(/overdue task/)).toBeTruthy()
})

test("Fitness off: no workouts insight", () => {
  setEnabled("fitness", false)
  insights()
  expect(screen.queryByText(/workouts? this week/)).toBeNull()
})

test("Tasks off: no overdue-task insight", () => {
  setEnabled("tasks", false)
  insights()
  expect(screen.queryByText(/overdue task/)).toBeNull()
})
