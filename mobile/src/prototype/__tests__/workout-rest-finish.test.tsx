// The in-progress workout's rest timer is pinned under the header, outside
// the scrolling list, so it is never scrolled away; and finishing a workout
// lands on its summary rather than the Fitness home.
import * as A from "@domain/fitness/actions"
import { fitStore } from "@domain/fitness/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { ScrollView, Text } from "react-native"
import { SafeAreaProvider } from "react-native-safe-area-context"

const mockParams: { edit?: string } = {}
jest.mock("expo-router", () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: () => false,
  },
  useLocalSearchParams: () => mockParams,
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
  withTiming: (value: unknown, _: unknown, done?: (ok: boolean) => void) => {
    done?.(true)
    return value
  },
  runOnJS: (fn: unknown) => fn,
  useReducedMotion: () => false,
  isSharedValue: () => false,
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
jest.mock("expo-audio", () => ({}))
jest.mock("../media", () => ({
  copyText: jest.fn(),
  exportCsv: jest.fn(),
  pickPhoto: jest.fn(),
}))
jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: "undetermined" })),
  requestPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  scheduleNotificationAsync: jest.fn(async () => "id"),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  SchedulableTriggerInputTypes: { DATE: "date" },
}))

const { Screen } = require("../ui") as typeof import("../ui")
const { WorkoutLogger } =
  require("../screens/fitness-logger") as typeof import("../screens/fitness-logger")
const { router } = require("expo-router")
const { toast } = require("sonner-native")

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 44, left: 0, right: 0, bottom: 34 },
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
)

beforeEach(() => {
  jest.useFakeTimers()
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  delete mockParams.edit
  router.replace.mockClear()
  toast.success.mockClear()
})
afterEach(() => {
  act(() => jest.runOnlyPendingTimers())
  jest.useRealTimers()
})

const start = (exercises: string[] = []) => {
  const res = A.startWorkout({ from: "empty" })
  if (!res.ok) throw new Error(res.reason)
  if (exercises.length) A.addExercises(res.workout.id, exercises)
  return res.workout
}
const sets = (id: string) =>
  fitStore
    .get()
    .workouts.find((x) => x.id === id)
    ?.exercises.flatMap((we) => we.sets.map((s) => ({ we: we.id, set: s }))) ??
  []
/** Whether ``node`` sits anywhere inside ``root``. */
const inside = (node: { parent: unknown }, root: unknown) => {
  let p = node.parent as { parent?: unknown } | null
  while (p) {
    if (p === root) return true
    p = p.parent as typeof p
  }
  return false
}

describe("Screen pinned slot", () => {
  it("renders pinned content outside the scrolling page", () => {
    render(
      <Screen title="Page" pinned={<Text>Pinned</Text>}>
        <Text>Body</Text>
      </Screen>,
      { wrapper },
    )
    const scroller = screen.UNSAFE_getByType(ScrollView)
    expect(inside(screen.getByText("Pinned"), scroller)).toBe(false)
    expect(inside(screen.getByText("Body"), scroller)).toBe(true)
  })
  it("renders nothing when there is no pinned content", () => {
    render(
      <Screen title="Page" pinned={null}>
        <Text>Body</Text>
      </Screen>,
      { wrapper },
    )
    expect(screen.queryByTestId("screen-pinned")).toBeNull()
  })
})

describe("pinned rest timer", () => {
  it("shows once, outside the scrolling list", () => {
    start()
    A.startRest(120)
    render(<WorkoutLogger />, { wrapper })
    const skip = screen.getAllByLabelText("Skip rest")
    expect(skip).toHaveLength(1)
    expect(inside(skip[0], screen.UNSAFE_getByType(ScrollView))).toBe(false)
    expect(screen.getByText("Rest · 120s")).toBeTruthy()
  })

  it("−15 and +15 move the pinned countdown", () => {
    start()
    A.startRest(120)
    render(<WorkoutLogger />, { wrapper })
    fireEvent.press(screen.getByLabelText("Rest 15 seconds more"))
    expect(screen.getByText("Rest · 135s")).toBeTruthy()
    fireEvent.press(screen.getByLabelText("Rest 15 seconds less"))
    fireEvent.press(screen.getByLabelText("Rest 15 seconds less"))
    expect(screen.getByText("Rest · 105s")).toBeTruthy()
    expect(fitStore.get().rest?.durationSec).toBe(105)
  })

  it("turns into an OK once rest is over, and OK removes it", () => {
    start()
    A.startRest(30)
    render(<WorkoutLogger />, { wrapper })
    act(() => jest.advanceTimersByTime(32_000))
    expect(screen.getByText("Rest over — next set")).toBeTruthy()
    expect(screen.queryByLabelText("Skip rest")).toBeNull()
    fireEvent.press(screen.getByLabelText("Dismiss rest timer"))
    expect(screen.queryByLabelText("Dismiss rest timer")).toBeNull()
    expect(screen.queryByTestId("screen-pinned")).toBeNull()
  })

  it("is not pinned in edit mode", () => {
    const w = start()
    mockParams.edit = w.id
    A.startRest(120)
    render(<WorkoutLogger />, { wrapper })
    expect(screen.queryByLabelText("Skip rest")).toBeNull()
    expect(screen.queryByTestId("screen-pinned")).toBeNull()
  })

  it("pins nothing with no rest running", () => {
    start()
    render(<WorkoutLogger />, { wrapper })
    expect(screen.queryByTestId("screen-pinned")).toBeNull()
  })

  it("makes the current length the default, and says so", () => {
    start()
    A.startRest(150)
    render(<WorkoutLogger />, { wrapper })
    fireEvent.press(screen.getByText("Make 150s my default"))
    expect(fitStore.get().settings.restSec).toBe(150)
    expect(toast.success).toHaveBeenCalledWith("Default rest set to 150s")
  })
})

describe("finishing a workout", () => {
  it("with every set done, lands on its summary", () => {
    const w = start(["bench"])
    for (const { we, set } of sets(w.id)) A.toggleSet(w.id, we, set.id)
    render(<WorkoutLogger />, { wrapper })
    fireEvent.press(screen.getByLabelText("Finish workout"))
    expect(router.replace).toHaveBeenCalledWith(
      `/fitness/workouts/${w.id}/summary`,
    )
  })

  it.each([
    "Remove them & finish",
    "Mark all done & finish",
  ])("with unfinished sets, %s lands on its summary", (choice) => {
    const w = start(["bench"])
    render(<WorkoutLogger />, { wrapper })
    fireEvent.press(screen.getByLabelText("Finish workout"))
    fireEvent.press(screen.getByText(choice))
    expect(router.replace).toHaveBeenCalledWith(
      `/fitness/workouts/${w.id}/summary`,
    )
  })

  it("in edit mode, Done still goes back to the workout", () => {
    const w = start(["bench"])
    mockParams.edit = w.id
    render(<WorkoutLogger />, { wrapper })
    fireEvent.press(screen.getByLabelText("Done editing"))
    expect(router.replace).toHaveBeenCalledWith(`/fitness/workouts/${w.id}`)
    expect(toast.success).toHaveBeenCalledWith(
      "Workout updated — PRs recomputed",
    )
  })
})
