// The Exercises screen's merge: the sheet offers only same-type exercises,
// the confirm moves the history and lands on the survivor, and the
// duplicate card's "Not duplicates" hides a pair for good.
import * as A from "@domain/fitness/actions"
import { dupesStore } from "@domain/fitness/dupes"
import { fitStore } from "@domain/fitness/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import { router } from "expo-router"
import type { ReactNode } from "react"
import { Alert, type AlertButton } from "react-native"
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
// The animated close runs to its end at once, as on a phone with motion on.
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
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
}))
jest.mock("expo-audio", () => ({}))
jest.mock("../media", () => ({
  copyText: jest.fn(),
  exportCsv: jest.fn(),
  pickPhoto: jest.fn(),
}))
const mockN = {
  getPermissionsAsync: jest.fn(async () => ({ status: "undetermined" })),
  requestPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  scheduleNotificationAsync: jest.fn(async () => "id"),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  SchedulableTriggerInputTypes: { DATE: "date" },
}
jest.mock("expo-notifications", () => mockN)

const { Exercises } =
  require("../screens/fitness-exercises") as typeof import("../screens/fitness-exercises")

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
  jest.clearAllMocks()
  fitStore.set((s) => ({ ...s, exercises: [], templates: [], workouts: [] }))
})
afterEach(() => {
  act(() => jest.runOnlyPendingTimers())
  jest.useRealTimers()
})

function library() {
  A.upsertExercise({ id: "a", name: "Bench press" })
  A.upsertExercise({ id: "b", name: "Barbell Bench Press" })
  A.upsertExercise({ id: "c", name: "Overhead Press", muscle: "shoulders" })
  A.upsertExercise({ id: "p", name: "Plank", loadType: "time" })
  A.upsertTemplate({ name: "Push", items: [{ exerciseId: "a", sets: 3 }] })
}

it("the merge sheet lists same-type exercises; confirming lands on the survivor", () => {
  library()
  const alert = jest.spyOn(Alert, "alert")
  render(<Exercises id="a" />, { wrapper })
  fireEvent.press(screen.getByText("Merge into another exercise"))
  expect(screen.getByLabelText("Merge into Barbell Bench Press")).toBeTruthy()
  expect(screen.getByLabelText("Merge into Overhead Press")).toBeTruthy()
  // Another type shows, dimmed and not pickable.
  expect(screen.getByText("Plank")).toBeTruthy()
  expect(screen.queryByLabelText("Merge into Plank")).toBeNull()
  expect(screen.getByText("Different type")).toBeTruthy()

  fireEvent.press(screen.getByLabelText("Merge into Barbell Bench Press"))
  act(() => jest.runOnlyPendingTimers())
  expect(alert).toHaveBeenCalledTimes(1)
  const [title, message, buttons] = alert.mock.calls[0]
  expect(title).toBe("Merge into Barbell Bench Press?")
  expect(message).toContain("0 sessions and 1 template slot move")
  act(() => (buttons as AlertButton[])[1].onPress?.())

  expect(fitStore.get().templates[0].items[0].exerciseId).toBe("b")
  expect(toast.success).not.toHaveBeenCalled()
  expect(router.replace).toHaveBeenCalledWith("/fitness/exercises/b")
})

it("the list suggests the pair, and Not duplicates hides it", () => {
  library()
  render(<Exercises />, { wrapper })
  expect(screen.getByText("Possible duplicates")).toBeTruthy()
  expect(screen.getByText("Bench press → Barbell Bench Press")).toBeTruthy()
  fireEvent.press(screen.getByText("Not duplicates"))
  expect(toast).not.toHaveBeenCalled()
  expect(dupesStore.get().dismissed).toEqual(["a|b"])
  expect(screen.queryByText("Possible duplicates")).toBeNull()
})

it("a survivor shows its former names", () => {
  library()
  A.mergeExercises("a", "b")
  render(<Exercises id="b" />, { wrapper })
  expect(screen.getByText("Also called: Bench press")).toBeTruthy()
})
