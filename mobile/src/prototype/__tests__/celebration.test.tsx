// The finish celebration plays once per workout or run (a burst of leaves,
// a count-up and one success haptic), settles on every later visit, keeps
// playing through re-renders after its id is recorded, and drops the burst
// under Reduce Motion while keeping the haptic. The summaries put Share,
// Post (Community on) and Done first.
import * as FA from "@domain/fitness/actions"
import { fitStore } from "@domain/fitness/store"
import * as HA from "@domain/habits/actions"
import { habitsStore } from "@domain/habits/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"

const mockMotion = { reduced: false }
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
  runOnJS: (fn: unknown) => fn,
  useReducedMotion: () => mockMotion.reduced,
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
  NotificationFeedbackType: { Success: "success" },
  ImpactFeedbackStyle: { Light: "light" },
}))
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
}))
jest.mock("expo-audio", () => ({}))
jest.mock("../media", () => ({
  copyText: jest.fn(),
  exportCsv: jest.fn(),
  pickPhoto: jest.fn(),
}))

const { Celebration, celebrateStore, markCelebrated, useCelebrate } =
  require("../celebration") as typeof import("../celebration")
const { WorkoutDetail } =
  require("../screens/fitness-workouts") as typeof import("../screens/fitness-workouts")
const { RoutineSummary } =
  require("../screens/routines") as typeof import("../screens/routines")
const { setShown } = require("../extras") as typeof import("../extras")
const Haptics = require("expo-haptics")
const { router } = require("expo-router")
const { toast } = require("sonner-native")

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 44, left: 0, right: 0, bottom: 34 },
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
)
const hidden = { includeHiddenElements: true }
const leaves = () => screen.queryAllByTestId("celebration-leaf", hidden)

beforeEach(() => {
  jest.useFakeTimers()
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  mockMotion.reduced = false
  Haptics.notificationAsync.mockClear()
  router.push.mockClear()
  router.replace.mockClear()
  toast.success.mockClear()
})
afterEach(() => {
  act(() => jest.runOnlyPendingTimers())
  jest.useRealTimers()
})

function Hero({ id, note = "" }: { id: string; note?: string }) {
  const play = useCelebrate(id)
  return (
    <Celebration
      kind="workout"
      title={`Push A complete${note}`}
      subtitle="Today"
      stats={[{ label: "Sets", value: 12, format: (n) => String(n) }]}
      play={play}
    />
  )
}

describe("Celebration", () => {
  it("plays on the first showing: 18 leaves and one haptic", () => {
    render(<Hero id="w1" />, { wrapper })
    expect(leaves()).toHaveLength(18)
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("header").props.children).toBe("Push A complete")
    // The final value is readable from the first frame.
    expect(screen.getByLabelText("Sets 12")).toBeTruthy()
  })

  it("shows settled the second time: no leaves, no haptic", () => {
    render(<Hero id="w1" />, { wrapper }).unmount()
    Haptics.notificationAsync.mockClear()
    render(<Hero id="w1" />, { wrapper })
    expect(leaves()).toHaveLength(0)
    expect(Haptics.notificationAsync).not.toHaveBeenCalled()
  })

  it("under Reduce Motion drops the burst but keeps the haptic", () => {
    mockMotion.reduced = true
    render(<Hero id="w2" />, { wrapper })
    expect(leaves()).toHaveLength(0)
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1)
  })

  it("keeps the 50 most recent ids", () => {
    for (let i = 0; i < 55; i++) markCelebrated(`id-${i}`)
    const ids = celebrateStore.get().ids
    expect(ids).toHaveLength(50)
    expect(ids[0]).toBe("id-5")
    expect(ids.at(-1)).toBe("id-54")
  })

  it("keeps playing through a re-render after its id is recorded", () => {
    const r = render(<Hero id="w3" />, { wrapper })
    expect(celebrateStore.get().ids).toContain("w3")
    r.rerender(<Hero id="w3" note="!" />)
    act(() => jest.advanceTimersByTime(500))
    expect(leaves()).toHaveLength(18)
    r.unmount()
    render(<Hero id="w3" />, { wrapper })
    expect(leaves()).toHaveLength(0)
  })
})

const finished = (heavy: boolean) => {
  const res = FA.startWorkout({ from: "empty" })
  if (!res.ok) throw new Error(res.reason)
  const w = res.workout
  FA.addExercises(w.id, ["bench"])
  const we = fitStore.get().workouts.find((x) => x.id === w.id)!.exercises[0]
  for (const set of we.sets) {
    FA.updateSet(w.id, we.id, set.id, {
      weight: heavy ? 400 : 1,
      reps: 5,
    })
    FA.toggleSet(w.id, we.id, set.id)
  }
  FA.finishWorkout(w.id, { unfinished: "remove" })
  return w.id
}

describe("workout summary", () => {
  it("leads with Share, Post and Done; Share picks the PR card", () => {
    const id = finished(true)
    render(<WorkoutDetail id={id} summary />, { wrapper })
    expect(screen.getByTestId("celebration")).toBeTruthy()
    expect(leaves()).toHaveLength(18)
    fireEvent.press(screen.getByText("Share"))
    expect(router.push).toHaveBeenCalledWith(`/fitness/share/${id}?template=pr`)
    fireEvent.press(screen.getByText("Post"))
    expect(router.push).toHaveBeenCalledWith(
      `/fitness/share/${id}?template=pr&post=1`,
    )
    fireEvent.press(screen.getByText("Done"))
    expect(toast.success).toHaveBeenCalledWith("Workout saved")
    expect(router.replace).toHaveBeenCalledWith("/fitness")
  })

  it("hides Post with Community off", () => {
    setShown("social", false)
    const id = finished(false)
    render(<WorkoutDetail id={id} summary />, { wrapper })
    expect(screen.getByText("Share")).toBeTruthy()
    expect(screen.queryByText("Post")).toBeNull()
  })

  it("never celebrates on the history page", () => {
    const id = finished(true)
    render(<WorkoutDetail id={id} />, { wrapper })
    expect(screen.queryByTestId("celebration")).toBeNull()
    expect(celebrateStore.get().ids).not.toContain(id)
  })
})

describe("routine summary", () => {
  const routine = () => {
    const r = habitsStore.get().routines.find((x) => x.steps.length > 0)
    if (!r) throw new Error("seed has no routine")
    return r
  }
  const run = (id: string) => habitsStore.get().runs.find((x) => x.id === id)!

  it("celebrates a completed run", () => {
    const r = routine()
    const started = HA.startRoutine(r.id)
    if (!started) throw new Error("could not start")
    for (let i = 0; i < r.steps.length; i++) HA.stepDone(run(started.id))
    render(<RoutineSummary id={r.id} runId={started.id} />, { wrapper })
    expect(screen.getByTestId("celebration")).toBeTruthy()
    expect(screen.getByText(`${r.name} done!`)).toBeTruthy()
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1)
    expect(screen.getByText("Post")).toBeTruthy()
  })

  it("stays calm for a partial run", () => {
    const r = routine()
    const started = HA.startRoutine(r.id)
    if (!started) throw new Error("could not start")
    render(<RoutineSummary id={r.id} runId={started.id} />, { wrapper })
    expect(screen.queryByTestId("celebration")).toBeNull()
    expect(leaves()).toHaveLength(0)
    expect(Haptics.notificationAsync).not.toHaveBeenCalled()
  })
})
