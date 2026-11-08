// More goals (Kai, 2026-11-08): goals a person can take in one tap, across
// habits, tasks, focus, training, food and money. Every one must be
// computable from data the app already has: on the device (the metric book)
// and on the server (the same key in that module's statistics).
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { MODULE_KEYS } from "@domain/dash/data"
import { GOAL_IDEAS, goalIdeas, ideaGoal } from "@domain/dash/goal-ideas"
import { useMetricBook } from "@domain/dash/hooks"
import { dashStore, saveGoal } from "@domain/dash/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react-native"
import { SafeAreaProvider } from "react-native-safe-area-context"
import type { ReactNode } from "react"

const mockParams: Record<string, string> = {}
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
}))
jest.mock("../media", () => ({
  exportCsv: jest.fn(),
  pickPhoto: jest.fn(),
  copyText: jest.fn(),
}))


beforeEach(() => {
  configureStorage({ getItem: () => null, setItem: () => {}, removeItem: () => {} })
  resetAll()
})

const allOn = Object.fromEntries(MODULE_KEYS.map((k) => [k, true])) as Record<
  (typeof MODULE_KEYS)[number],
  boolean
>

test("ideas span every area the app tracks, several each", () => {
  for (const area of ["habits", "tasks", "focus", "fitness", "nutrition", "finance"])
    expect(GOAL_IDEAS.filter((i) => i.area === area).length).toBeGreaterThanOrEqual(3)
  expect(new Set(GOAL_IDEAS.map((i) => `${i.metric}|${i.period}`)).size).toBe(
    GOAL_IDEAS.length,
  )
})

test("every idea reads as a number in the metric book", () => {
  const { result } = renderHook(() => useMetricBook())
  for (const i of GOAL_IDEAS) {
    const entry = result.current[i.period].get(i.metric)
    expect({ metric: i.metric, found: !!entry }).toEqual({ metric: i.metric, found: true })
    expect({ metric: i.metric, n: typeof entry?.n }).toEqual({
      metric: i.metric,
      n: "number",
    })
    // The unit the goal is written in is the unit its value is read in.
    expect({ metric: i.metric, unit: entry?.unit }).toEqual({ metric: i.metric, unit: i.unit })
  }
})

test("every module idea is a metric the server computes too", () => {
  const backend = join(__dirname, "../../../../backend/app/modules")
  for (const i of GOAL_IDEAS) {
    if (i.area === "life") continue
    const key = i.metric.split(":")[1]
    const src =
      readFileSync(join(backend, i.area, "stats.py"), "utf8") +
      (i.area === "tasks" ? readFileSync(join(backend, "tasks", "logic.py"), "utf8") : "")
    expect({ metric: i.metric, onServer: src.includes(`"${key}"`) }).toEqual({
      metric: i.metric,
      onServer: true,
    })
  }
})

test("an idea already in play, or for a part switched off, is not offered", () => {
  const goal = saveGoal(ideaGoal(GOAL_IDEAS.find((i) => i.metric === "tasks:tasks.done")!))
  const offered = goalIdeas(dashStore.get().goals, { ...allOn, nutrition: false })
  expect(offered.some((i) => i.metric === goal.metric)).toBe(false)
  expect(offered.some((i) => i.area === "nutrition")).toBe(false)
  expect(offered.some((i) => i.area === "focus")).toBe(true)
})

describe("on screen", () => {
  const metrics = {
    frame: { x: 0, y: 0, width: 390, height: 844 },
    insets: { top: 47, left: 0, right: 0, bottom: 34 },
  }
  const wrap = (ui: import("react").ReactElement) => (
    <SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>
  )

  test("Goals lists more goals by area; a tap makes one a goal", () => {
    const { Goals } = require("../screens/dash-goals") as typeof import("../screens/dash-goals")
    delete mockParams.t
    render(wrap(<Goals />))
    expect(screen.getByTestId("goal-ideas")).toBeTruthy()
    const before = dashStore.get().goals.length
    act(() => {
      fireEvent.press(screen.getByLabelText("Add goal: Tasks done ≥ 20 / week"))
    })
    expect(dashStore.get().goals.length).toBe(before + 1)
    expect(dashStore.get().goals[0]).toMatchObject({
      metric: "tasks:tasks.done",
      target: 20,
      period: "week",
      status: "active",
    })
    // Taken: no longer offered.
    expect(screen.queryByLabelText("Add goal: Tasks done ≥ 20 / week")).toBeNull()
  })

  test("the Goal hit card: pick a goal in play, or take a new one onto it", () => {
    const { ShareCard } = require("../screens/dash-share") as typeof import("../screens/dash-share")
    mockParams.t = "goal"
    render(wrap(<ShareCard />))
    expect(screen.getByTestId("goal-choice")).toBeTruthy()
    // Choose the last goal in play first, so the card is not on a default.
    const radios = screen.getAllByRole("radio")
    act(() => {
      fireEvent.press(radios[radios.length - 1])
    })
    expect(
      screen.getAllByRole("radio").at(-1)?.props.accessibilityState,
    ).toEqual({ selected: true })
    act(() => {
      fireEvent.press(screen.getByText("More goals to choose from"))
    })
    act(() => {
      fireEvent.press(screen.getByLabelText("Add goal: Focus sessions ≥ 10 / week"))
    })
    const made = dashStore.get().goals.find((g) => g.metric === "focus:sessions")
    expect(made).toBeTruthy()
    // The new goal is the chosen one (its label is the metric's own).
    expect(
      screen.getByLabelText("Put Sessions on the card").props.accessibilityState,
    ).toEqual({ selected: true })
    const others = screen
      .getAllByRole("radio")
      .filter((r) => r.props.accessibilityLabel !== "Put Sessions on the card")
    expect(others.length).toBeGreaterThan(0)
    for (const r of others)
      expect(r.props.accessibilityState).toEqual({ selected: false })
  })
})
