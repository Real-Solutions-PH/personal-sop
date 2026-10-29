// The controls on the active workout and routine screens: a label is shown
// only while it fits whole, otherwise the button keeps its icon, and every
// control is reachable by its full name with a 44pt touch target.
import * as A from "@domain/fitness/actions"
import { fitStore } from "@domain/fitness/store"
import * as H from "@domain/habits/actions"
import { habitsStore } from "@domain/habits/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { fireEvent, render, screen } from "@testing-library/react-native"
import { SkipForward } from "lucide-react-native"
import type { ReactNode } from "react"
import { StyleSheet } from "react-native"
import { SafeAreaProvider } from "react-native-safe-area-context"

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
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
}))
jest.mock("expo-audio", () => ({}))
jest.mock("../media", () => ({ exportCsv: jest.fn(), pickPhoto: jest.fn() }))

const { ToolButton } =
  require("../native-kit") as typeof import("../native-kit")
const { AppLauncher } =
  require("../app-launcher") as typeof import("../app-launcher")
const { WorkoutLogger } =
  require("../screens/fitness-logger") as typeof import("../screens/fitness-logger")
const { RoutinePlayer } =
  require("../screens/routine-player") as typeof import("../screens/routine-player")

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
})

const layout = (el: unknown, width: number) =>
  fireEvent(el as never, "layout", {
    nativeEvent: { layout: { x: 0, y: 0, width, height: 20 } },
  })
// The off-screen copy of a label that the button measures; hidden from
// screen readers, so only found when hidden elements are included. It is
// the button's last child, after any visible copy of the label.
const measurer = (label: string) =>
  screen.getAllByText(label, { includeHiddenElements: true }).at(-1)
const target = (name: string) => {
  const style = StyleSheet.flatten(screen.getByLabelText(name).props.style)
  return {
    width: Math.max(style.width ?? 0, style.minWidth ?? 0),
    height: Math.max(style.height ?? 0, style.minHeight ?? 0),
  }
}

describe("ToolButton", () => {
  it("shows its label only while the label fits whole", () => {
    const onPress = jest.fn()
    render(
      <ToolButton
        icon={SkipForward}
        label="Skip"
        name="Skip rest"
        max={56}
        onPress={onPress}
      />,
      { wrapper },
    )
    // Not measured yet: icon only, never a cut-off label.
    expect(screen.queryByText("Skip")).toBeNull()
    layout(measurer("Skip"), 30)
    expect(screen.getByText("Skip")).toBeTruthy()
    // A larger text size: 40pt of label plus padding no longer fits in 56.
    layout(measurer("Skip"), 40)
    expect(screen.queryByText("Skip")).toBeNull()
    fireEvent.press(screen.getByLabelText("Skip rest"))
    expect(onPress).toHaveBeenCalled()
    expect(target("Skip rest").width).toBeGreaterThanOrEqual(44)
    expect(target("Skip rest").height).toBeGreaterThanOrEqual(44)
  })

  it("fills its share of a row and measures that share", () => {
    render(
      <ToolButton
        icon={SkipForward}
        label="Resume"
        name="Resume routine"
        stacked
        keepIcon
        style={{ flex: 1 }}
        onPress={() => {}}
      />,
      { wrapper },
    )
    layout(measurer("Resume"), 50)
    layout(screen.getByLabelText("Resume routine"), 80)
    expect(screen.getByText("Resume")).toBeTruthy()
    layout(screen.getByLabelText("Resume routine"), 56)
    expect(screen.queryByText("Resume")).toBeNull()
  })
})

describe("active workout", () => {
  const start = () => {
    const ids = fitStore
      .get()
      .exercises.slice(0, 2)
      .map((e) => e.id)
    const res = A.startWorkout({ from: "empty" })
    if (!res.ok) throw new Error(res.reason)
    A.addExercises(res.workout.id, ids)
    return fitStore.get().exercises.find((e) => e.id === ids[0])!
  }

  it("runs the rest timer from its buttons", () => {
    start()
    render(<WorkoutLogger />, { wrapper })
    fireEvent.press(screen.getAllByLabelText("Complete set")[0])
    const rest = () => fitStore.get().rest
    const before = rest()!.durationSec
    fireEvent.press(screen.getByLabelText("Rest 15 seconds more"))
    expect(rest()!.durationSec).toBe(before + 15)
    fireEvent.press(screen.getByLabelText("Rest 15 seconds less"))
    expect(rest()!.durationSec).toBe(before)
    for (const name of [
      "Rest 15 seconds less",
      "Rest 15 seconds more",
      "Skip rest",
    ])
      expect(target(name).height).toBeGreaterThanOrEqual(44)
    fireEvent.press(screen.getByLabelText("Skip rest"))
    expect(rest()).toBeFalsy()
  })

  it("finishes from the header button", () => {
    start()
    render(<WorkoutLogger />, { wrapper })
    expect(target("Finish workout").width).toBeGreaterThanOrEqual(44)
    fireEvent.press(screen.getByLabelText("Finish workout"))
    // Planned sets are still open, so it asks what to do with them.
    expect(screen.getByText(/sets? not done/)).toBeTruthy()
  })

  it("reorders an exercise from its options menu", () => {
    const first = start()
    render(<WorkoutLogger />, { wrapper })
    fireEvent.press(screen.getByLabelText(`Options for ${first.name}`))
    fireEvent.press(screen.getByRole("button", { name: "Move down" }))
    const w = fitStore.get().workouts.find((x) => x.status === "in_progress")!
    expect(w.exercises[1].exerciseId).toBe(first.id)
  })
})

describe("active routine", () => {
  it("steps, pauses and extends from the control row", () => {
    const id = habitsStore.get().routines[0].id
    H.startRoutine(id)
    render(<RoutinePlayer id={id} />, { wrapper })
    const run = () =>
      habitsStore
        .get()
        .runs.find((r) => r.routineId === id && r.state === "in_progress")!
    for (const name of [
      "Previous step",
      "Skip step",
      "Pause routine",
      "Add a minute to this step",
      "Leave routine",
    ])
      expect(screen.getByLabelText(name)).toBeTruthy()
    fireEvent.press(screen.getByLabelText("Add a minute to this step"))
    expect(run().stepBonusSec).toBe(60)
    fireEvent.press(screen.getByLabelText("Pause routine"))
    expect(run().pausedAt).toBeTruthy()
    fireEvent.press(screen.getByLabelText("Resume routine"))
    expect(run().pausedAt).toBeFalsy()
    fireEvent.press(screen.getByLabelText("Skip step"))
    expect(run().current).toBe(1)
    fireEvent.press(screen.getByLabelText("Previous step"))
    expect(run().current).toBe(0)
  })
})

describe("app launcher", () => {
  it("names its tiles only while every name fits, else keeps icons", () => {
    render(<AppLauncher />, { wrapper })
    const names = [
      "Habits",
      "Tasks",
      "Fitness",
      "Nutrition",
      "Focus",
      "Finance",
      "Screen time",
      "Journal",
    ].filter((n) => screen.queryByLabelText(n))
    expect(names.length).toBeGreaterThan(2)
    layout(screen.getByTestId("app-launcher-row"), 343)
    for (const n of names) layout(measurer(n), 40)
    for (const n of names) expect(screen.getByText(n)).toBeTruthy()
    // One name grows past its tile at a larger text size: the whole row
    // drops to icons, and every tile is still reachable by its name.
    layout(measurer(names[0]), 90)
    for (const n of names) {
      expect(screen.queryByText(n)).toBeNull()
      expect(screen.getByLabelText(n)).toBeTruthy()
    }
  })
})
