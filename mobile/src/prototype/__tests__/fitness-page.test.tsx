// The Fitness page leads with what to do now: today's training with its one
// Start (or Resume) button, a run or walk one tap away and the week against
// its target, in one card. Progress, the recent sessions (workouts and runs
// together) and the plan's links follow, and an empty account sees them
// dimmed under one card instead of a blank page.
import type { FitnessState, RunSession, Workout } from "@domain/fitness/data"
import { fitStore } from "@domain/fitness/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import { router } from "expo-router"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"

jest.mock("expo-router", () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: () => false,
  },
  useLocalSearchParams: () => ({}),
  usePathname: () => "/fitness",
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
  withDelay: (_: number, value: unknown) => value,
  withSequence: (...v: unknown[]) => v.at(-1),
  runOnJS: (fn: unknown) => fn,
  useReducedMotion: () => true,
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
jest.mock("expo-haptics", () => ({
  notificationAsync: jest.fn(async () => {}),
  impactAsync: jest.fn(async () => {}),
  selectionAsync: jest.fn(async () => {}),
  NotificationFeedbackType: { Success: "success", Warning: "warning" },
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
}))
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
}))
jest.mock("expo-audio", () => ({}))
jest.mock("../run-tracker", () => ({
  finishAndStop: jest.fn(),
  startTracking: jest.fn(),
  stopTracking: jest.fn(),
}))
// Health and the body section have their own suites.
// Each stands in as one marker line, so the page order can be read back.
jest.mock("../screens/steps-card", () => {
  const { Text } = require("react-native")
  return { StepsCard: () => <Text>STEPS CARD</Text> }
})
jest.mock("../screens/sleep-card", () => {
  const { Text } = require("react-native")
  return { SleepCard: () => <Text>SLEEP CARD</Text> }
})
jest.mock("../screens/fitness-body", () => {
  const { Text } = require("react-native")
  return { Body: () => <Text>BODY SECTION</Text> }
})

const { FitnessTrain } =
  require("../screens/fitness-train") as typeof import("../screens/fitness-train")

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
)

// Wednesday 4 Nov 2026, mid-morning: Monday and Tuesday are behind us.
const WED = new Date(2026, 10, 4, 10, 0)
const MON = new Date(2026, 10, 2, 10, 0)
const at = (d: Date, dayDelta: number, hour = 7) =>
  new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate() + dayDelta,
    hour,
  ).toISOString()

const workout = (id: string, startedAt: string, extra: Partial<Workout> = {}) =>
  ({
    id,
    name: `Workout ${id}`,
    startedAt,
    endedAt: new Date(new Date(startedAt).getTime() + 3600_000).toISOString(),
    status: "finished",
    exercises: [],
    ...extra,
  }) as unknown as Workout

const run = (id: string, startedAt: string): RunSession => ({
  id,
  kind: "run",
  name: `Morning run ${id}`,
  startedAt,
  endedAt: startedAt,
  movingSec: 1800,
  distanceM: 5234,
  route: [],
  splits: [],
})

const patch = (p: Partial<FitnessState>) =>
  act(() => fitStore.set((s) => ({ ...s, ...p })))

const show = () => render(<FitnessTrain />, { wrapper })

beforeEach(() => {
  jest.useFakeTimers({ now: WED })
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  jest.clearAllMocks()
})
afterEach(() => {
  act(() => jest.runOnlyPendingTimers())
  jest.useRealTimers()
})

const plan = () => {
  const tpl = fitStore.get().templates[0]
  // Mon, Tue, Wed, Fri planned.
  return {
    tpl,
    schedule: [tpl.id, tpl.id, tpl.id, null, tpl.id, null, null] as const,
  }
}

test("Start goes straight into today's scheduled routine", () => {
  const { tpl, schedule } = plan()
  patch({ schedule: [...schedule], workouts: [], activeId: null })
  show()
  expect(screen.getByText(tpl.name)).toBeTruthy()
  fireEvent.press(screen.getByText("Start"))
  // No chooser: the routine's workout is live and the logger opens.
  expect(screen.queryByText("Empty workout")).toBeNull()
  const s = fitStore.get(),
    live = s.workouts.find((w) => w.id === s.activeId)
  expect(live?.status).toBe("in_progress")
  expect(live?.templateId).toBe(tpl.id)
  expect(router.push).toHaveBeenLastCalledWith("/fitness/workout")
})

test("Choose another keeps the chooser one tap away", () => {
  const { schedule } = plan()
  patch({ schedule: [...schedule], workouts: [], activeId: null })
  show()
  fireEvent.press(screen.getByLabelText("Choose another workout"))
  expect(screen.getByText("Empty workout")).toBeTruthy()
  expect(fitStore.get().activeId).toBeNull()
})

test("with nothing scheduled, Start opens the chooser as before", () => {
  patch({
    schedule: [null, null, null, null, null, null, null],
    workouts: [],
    activeId: null,
  })
  show()
  fireEvent.press(screen.getByText("Start"))
  expect(screen.getByText("Empty workout")).toBeTruthy()
})

test("tapping today's workout anywhere but Start opens its routine to edit", () => {
  const { tpl, schedule } = plan()
  patch({ schedule: [...schedule], workouts: [], activeId: null })
  show()
  const edit = `/fitness/templates/${tpl.id}`
  fireEvent.press(screen.getByLabelText(`Edit ${tpl.name}`))
  expect(router.push).toHaveBeenLastCalledWith(edit)
  jest.mocked(router.push).mockClear()
  // The exercise list under it opens the same routine.
  fireEvent.press(screen.getByLabelText(`Edit ${tpl.name}'s exercises`))
  expect(router.push).toHaveBeenLastCalledWith(edit)
  jest.mocked(router.push).mockClear()
  // Start still starts the workout, not the editor.
  fireEvent.press(screen.getByText("Start"))
  expect(router.push).not.toHaveBeenCalledWith(edit)
  expect(router.push).toHaveBeenLastCalledWith("/fitness/workout")
})

test("a workout in progress is resumed, not started again", () => {
  const active = workout("live", at(WED, 0, 9), { status: "in_progress" })
  patch({ workouts: [active], activeId: "live" })
  show()
  expect(screen.getByText(/In progress/)).toBeTruthy()
  expect(screen.queryByText("Start")).toBeNull()
  fireEvent.press(screen.getAllByText("Resume")[0])
  expect(router.push).toHaveBeenCalledWith("/fitness/workout")
})

test("the week counts done days and marks planned days gone by as missed", () => {
  const { schedule } = plan()
  patch({
    schedule: [...schedule],
    workouts: [workout("mon", at(WED, -2))],
    activeId: null,
  })
  show()
  expect(screen.getByText("1 of 4 this week")).toBeTruthy()
  // Tuesday was planned and is gone with nothing logged.
  expect(screen.getByText("1 missed")).toBeTruthy()
})

test("Monday says last week fell short of the target", () => {
  jest.setSystemTime(MON)
  const { schedule } = plan()
  patch({
    schedule: [...schedule],
    settings: { ...fitStore.get().settings, weeklyTarget: 4 },
    workouts: [workout("a", at(MON, -5))],
    activeId: null,
  })
  show()
  expect(screen.getByTestId("fitness-last-week-short")).toBeTruthy()
  expect(screen.getByText(/Last week 1 of 4, 3 short/)).toBeTruthy()
})

test("recent sessions mix workouts and runs, newest first, each opening its record", () => {
  patch({
    workouts: [workout("old", at(WED, -3))],
    runs: [run("r1", at(WED, -1))],
    activeId: null,
  })
  show()
  const titles = screen
    .getAllByText(/^(Workout old|Morning run r1)$/)
    .map((n) => n.props.children)
  expect(titles).toEqual(["Morning run r1", "Workout old"])
  expect(screen.getByText("5.2 km")).toBeTruthy()
  fireEvent.press(screen.getByText("Morning run r1"))
  expect(router.push).toHaveBeenCalledWith("/fitness/runs/r1")
})

test("an empty account sees progress dimmed under one card, with no duplicate start", () => {
  patch({
    workouts: [],
    runs: [],
    weighIns: [],
    activeId: null,
    schedule: [null, null, null, null, null, null, null],
  })
  show()
  expect(screen.getByText("Your progress starts with one workout")).toBeTruthy()
  expect(screen.getByText("Browse templates")).toBeTruthy()
  // One start action on the page.
  expect(screen.getAllByText("Start")).toHaveLength(1)
  expect(screen.queryByText("Recent")).toBeNull()
})

test("the page runs today, steps, templates and exercises, then history and trends", () => {
  patch({
    workouts: [workout("w1", at(WED, -1))],
    runs: [],
    activeId: null,
  })
  show()
  const order = screen
    .getAllByText(
      /^(STEPS CARD|Templates|Exercises|Recent|Progress · 8 weeks|BODY SECTION|SLEEP CARD)$/,
    )
    .map((n) => n.props.children)
  expect(order).toEqual([
    "STEPS CARD",
    "Templates",
    "Exercises",
    "Recent",
    "Progress · 8 weeks",
    "BODY SECTION",
    "SLEEP CARD",
  ])
})

test("the exercise editor offers every muscle by region and saves a new one", () => {
  const { ExerciseEditor } =
    require("../screens/fitness") as typeof import("../screens/fitness")
  const onSaved = jest.fn()
  render(
    <ExerciseEditor
      open
      onClose={() => {}}
      initialName="Hip abduction"
      onSaved={onSaved}
    />,
    { wrapper },
  )
  // Region captions (Chest, Back… also name their broad muscle's chip).
  for (const region of ["Arms", "Legs", "Other"])
    expect(screen.getByText(region)).toBeTruthy()
  for (const label of [
    "Upper chest",
    "Front delts",
    "Side delts",
    "Rear delts",
    "Lats",
    "Traps / upper back",
    "Rhomboids",
    "Lower back",
    "Obliques",
    "Abductors",
    "Adductors",
    "Tibialis",
    "Hip flexors",
    "Neck",
  ])
    expect(screen.getByText(label)).toBeTruthy()
  fireEvent.press(screen.getByText("Abductors"))
  fireEvent.press(screen.getByText("Save exercise"))
  expect(onSaved).toHaveBeenCalledWith(
    expect.objectContaining({ name: "Hip abduction", muscle: "abductors" }),
  )
  expect(
    fitStore.get().exercises.find((e) => e.name === "Hip abduction")?.muscle,
  ).toBe("abductors")
})
