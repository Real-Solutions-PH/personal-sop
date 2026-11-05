// What the body actions earn and cost: a set that beats the record badges
// its row mid-workout (and a lighter one after it does not), a run's finish
// is celebrated with its record, a meal that carries the day over a line
// warns instead of cheering, a weigh-in says its step toward the goal, a
// lock-screen finish lands as the workout card, and Monday says when last
// week fell short.

import * as FA from "@domain/fitness/actions"
import type { MacroTarget, RunSession } from "@domain/fitness/data"
import { fitStore } from "@domain/fitness/store"
import { habitsStore } from "@domain/habits/store"
import { dayKey } from "@domain/lib/day"
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { AppState } from "react-native"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { anchor, OverlayHost, resetOverlay } from "../overlay"

const mockPath = { current: "/today" }
jest.mock("expo-router", () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: () => false,
  },
  useLocalSearchParams: () => ({}),
  usePathname: () => mockPath.current,
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
  withSequence: (...v: unknown[]) => v.at(-1),
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
jest.mock("../media", () => ({
  copyText: jest.fn(),
  exportCsv: jest.fn(),
  pickPhoto: jest.fn(),
}))
jest.mock("../run-tracker", () => ({
  finishAndStop: jest.fn(),
  startTracking: jest.fn(),
  stopTracking: jest.fn(),
}))

const R = require("../body-rewards") as typeof import("../body-rewards")
const { mealSaved, mealFlash, goalDays } =
  require("../body-moments") as typeof import("../body-moments")
const { tickSet, setPrStore } =
  require("../screens/fitness-logger") as typeof import("../screens/fitness-logger")
const { RunDetail } =
  require("../screens/fitness-runs") as typeof import("../screens/fitness-runs")
const { FinishWatcher, finishingHere } =
  require("../routine-done") as typeof import("../routine-done")
const { celebrateStore } =
  require("../celebration") as typeof import("../celebration")
const { momentSlot } = require("../moment") as typeof import("../moment")
const { applySurfaceAction } =
  require("@/surfaces/actions") as typeof import("@/surfaces/actions")
const Haptics = require("expo-haptics")

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 44, left: 0, right: 0, bottom: 34 },
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>
    {children}
    <OverlayHost />
  </SafeAreaProvider>
)
const hidden = { includeHiddenElements: true }

beforeEach(() => {
  jest.useFakeTimers()
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  resetOverlay()
  anchor.measure = (_, done) => done({ x: 0, y: 0, width: 40, height: 40 })
  // The demo seed's own finishes were announced long ago. Seeded on the
  // business day, one can end inside the watcher's six-hour window at some
  // hours (a live workout at 19:32 UTC, for a run at 00:31 UTC) and take
  // the card's slot ahead of the finish under test.
  celebrateStore.set({
    ids: [
      ...habitsStore.get().runs.map((r) => r.id),
      ...fitStore.get().workouts.map((w) => w.id),
    ],
  })
  momentSlot.set({ holder: null })
  setPrStore.set({ sets: {} })
  mockPath.current = "/today"
  jest.clearAllMocks()
  jest
    .spyOn(AppState, "addEventListener")
    .mockImplementation(
      () =>
        ({ remove: () => {} }) as ReturnType<typeof AppState.addEventListener>,
    )
})
afterEach(() => {
  act(() => jest.runOnlyPendingTimers())
  jest.useRealTimers()
  jest.restoreAllMocks()
})

// ------------------------------------------------------------------ PRs

/** A finished bench workout of three sets of 5 at ``kg``. */
function benchDone(kg: number) {
  const res = FA.startWorkout({ from: "empty" })
  if (!res.ok) throw new Error(res.reason)
  FA.addExercises(res.workout.id, ["bench"])
  const we = fitStore.get().workouts.find((x) => x.id === res.workout.id)!
    .exercises[0]
  for (const set of we.sets) {
    FA.updateSet(res.workout.id, we.id, set.id, { weight: kg, reps: 5 })
    FA.toggleSet(res.workout.id, we.id, set.id)
  }
  FA.finishWorkout(res.workout.id, { unfinished: "remove" })
}
/** A new bench workout in progress, with its sets at ``kgs``. */
function benchLive(kgs: number[]) {
  const res = FA.startWorkout({ from: "empty" })
  if (!res.ok) throw new Error(res.reason)
  const id = res.workout.id
  FA.addExercises(id, ["bench"])
  let we = fitStore.get().workouts.find((x) => x.id === id)!.exercises[0]
  while (we.sets.length < kgs.length) {
    FA.addSet(id, we.id)
    we = fitStore.get().workouts.find((x) => x.id === id)!.exercises[0]
  }
  we.sets.forEach((set, i) => {
    FA.updateSet(id, we.id, set.id, { weight: kgs[i] ?? kgs[0], reps: 5 })
  })
  return { id, we: we.id, sets: we.sets.map((x) => x.id) }
}

describe("a set that beats the record mid-workout", () => {
  // Only this test's history: the demo seed has bench sets of its own.
  beforeEach(() =>
    fitStore.set((s) => ({ ...s, workouts: [], activeId: null, rest: null })),
  )
  it("is a PR on the tick that beats it, and only that tick", () => {
    benchDone(60)
    const live = benchLive([50, 70, 65])
    // Lighter than the record: no PR.
    expect(tickSet(live.id, live.we, live.sets[0])).toBeUndefined()
    // Heavier than every finished set: a PR, badged, with a firm tap.
    const pr = tickSet(live.id, live.we, live.sets[1])
    expect(pr?.exerciseId).toBe("bench")
    expect(setPrStore.get().sets[live.sets[1]]).toBeDefined()
    act(() => jest.advanceTimersByTime(200))
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(1)
    // 65 kg beats the old 60 but not the 70 ticked a moment ago.
    expect(tickSet(live.id, live.we, live.sets[2])).toBeUndefined()
    expect(setPrStore.get().sets[live.sets[2]]).toBeUndefined()
  })

  it("loses its badge when the set is unticked", () => {
    benchDone(60)
    const live = benchLive([80])
    expect(tickSet(live.id, live.we, live.sets[0])).toBeDefined()
    expect(tickSet(live.id, live.we, live.sets[0])).toBeUndefined()
    expect(setPrStore.get().sets[live.sets[0]]).toBeUndefined()
  })
})

// ------------------------------------------------------------------ runs

const day = (n: number) =>
  new Date(Date.now() - n * 86400000 - 3600000).toISOString()
const session = (
  id: string,
  ago: number,
  distanceM: number,
  movingSec: number,
  splits: number[],
): RunSession => ({
  id,
  kind: "run",
  name: "Morning run",
  startedAt: day(ago),
  endedAt: day(ago),
  movingSec,
  distanceM,
  route: [],
  splits: splits.map((sec, i) => ({ km: i + 1, sec, elevM: null })),
})

describe("runRecord", () => {
  const old = session("a", 3, 5000, 1800, [370, 360, 355, 360, 355])
  it("names a best average pace", () => {
    const now = session("b", 0, 5000, 1650, [335, 330, 325, 330, 330])
    expect(R.runRecord([old, now], now)?.pace).toEqual({ sec: 330, prev: 360 })
  })
  it("names a fastest kilometre when the average is not a best", () => {
    const now = session("b", 0, 5000, 1850, [340, 380, 380, 380, 370])
    const rec = R.runRecord([old, now], now)
    expect(rec?.pace).toBeUndefined()
    expect(rec?.split?.split.km).toBe(1)
  })
  it("sets nothing on the first run, or on a short one", () => {
    const first = session("b", 0, 5000, 1500, [300])
    expect(R.runRecord([first], first)).toBeUndefined()
    const short = session("c", 0, 600, 120, [])
    expect(R.runRecord([old, short], short)).toBeUndefined()
  })
})

describe("the run summary", () => {
  it("celebrates the run with its distance, pace, time and record", () => {
    fitStore.set((s) => ({
      ...s,
      runs: [
        session("r1", 3, 5000, 1800, [360, 360, 360, 360, 360]),
        session("r2", 0, 5000, 1650, [330, 330, 330, 330, 330]),
      ],
    }))
    render(<RunDetail id="r2" summary />, { wrapper })
    expect(screen.getByTestId("celebration")).toBeTruthy()
    expect(screen.getByLabelText("Distance 5.00 km")).toBeTruthy()
    expect(screen.getByLabelText("Pace 5:30/km")).toBeTruthy()
    expect(screen.getByLabelText("Time 27:30")).toBeTruthy()
    expect(
      screen
        .getByTestId("celebration-record")
        .findByType(require("react-native").Text).props.children,
    ).toBe("Best pace yet · 5:30 /km")
    // It plays: the burst draws and one success tap lands.
    expect(
      screen.queryAllByTestId("celebration-leaf", hidden).length,
    ).toBeGreaterThan(0)
    expect(Haptics.notificationAsync).toHaveBeenCalledWith("success")
    expect(celebrateStore.get().ids).toContain("r2")
  })

  it("plays again when opened again, without a second haptic", () => {
    fitStore.set((s) => ({
      ...s,
      runs: [session("r3", 0, 3000, 1000, [330, 330, 340])],
    }))
    render(<RunDetail id="r3" summary />, { wrapper }).unmount()
    Haptics.notificationAsync.mockClear()
    render(<RunDetail id="r3" summary />, { wrapper })
    expect(
      screen.queryAllByTestId("celebration-leaf", hidden).length,
    ).toBeGreaterThan(0)
    expect(Haptics.notificationAsync).not.toHaveBeenCalled()
  })
})

// ------------------------------------------------------------------ meals

const target = {
  id: "t",
  kcal: 2000,
  protein: 120,
  carbs: 200,
  fat: 70,
  effectiveFrom: "2000-01-01",
} as MacroTarget

describe("crossings", () => {
  const before = { kcal: 1900, protein: 100, sodium: 1800, sugar: 10 }
  it("says how far a save carried the day past each line", () => {
    const after = { kcal: 2180, protein: 125, sodium: 2400, sugar: 20 }
    expect(R.crossings(before, after, target)).toEqual([
      { key: "kcal", over: 180, text: "+180 kcal over" },
      { key: "sodium", over: 400, text: "+400 mg over" },
    ])
  })
  it("stays quiet for a day already over, or one still under", () => {
    expect(
      R.crossings(
        { kcal: 2100, protein: 0 },
        { kcal: 2400, protein: 0 },
        target,
      ),
    ).toEqual([])
    expect(
      R.crossings(
        { kcal: 100, protein: 0 },
        { kcal: 2000, protein: 0 },
        target,
      ),
    ).toEqual([])
  })
  it("holds a limit with no target to the default max", () => {
    expect(
      R.crossings(
        { kcal: 0, protein: 0, satFat: 19.5 },
        { kcal: 0, protein: 0, satFat: 20.8 },
        undefined,
      ).map((x) => x.text),
    ).toEqual(["+0.8 g over"])
  })
  it("reports goals reached on the save that reaches them", () => {
    expect(
      R.goalsReached(
        { kcal: 0, protein: 110, fiber: 20 },
        { kcal: 0, protein: 121, fiber: 26 },
        target,
      ),
    ).toEqual(["protein", "fiber"])
    expect(
      R.goalsReached(
        { kcal: 0, protein: 121 },
        { kcal: 0, protein: 140 },
        target,
      ),
    ).toEqual([])
  })
})

describe("saving a meal", () => {
  const today = dayKey()
  const log = (kcal: number, protein = 0) =>
    FA.logMeal({
      items: [
        { name: "Rice", qty: 1, unit: "cup", kcal, protein, carbs: 0, fat: 0 },
      ],
      eatenAt: new Date().toISOString(),
    })
  beforeEach(() => {
    fitStore.set((s) => ({ ...s, meals: [], targets: [target] }))
    goalDays.set({ protein: "", fiber: "" })
  })

  it("warns, not cheers, when it carries the day over", () => {
    log(1900)
    const before = R.dayIntake(fitStore.get(), today)
    log(280)
    mealSaved(before, today)
    expect(Haptics.notificationAsync).toHaveBeenCalledWith("warning")
    expect(Haptics.notificationAsync).not.toHaveBeenCalledWith("success")
    expect(mealFlash.get().over.map((x) => x.text)).toContain("+180 kcal over")
  })

  it("cheers a meal inside the budget, and a goal once a day", () => {
    const before = R.dayIntake(fitStore.get(), today)
    log(600, 130)
    mealSaved(before, today)
    expect(Haptics.notificationAsync).toHaveBeenCalledWith("success")
    expect(mealFlash.get().goals).toEqual(["protein"])
    // A second dip under and back over the goal the same day: no replay.
    const again = { ...R.dayIntake(fitStore.get(), today), protein: 100 }
    mealSaved(again, today)
    expect(mealFlash.get().goals).toEqual([])
  })
})

// ------------------------------------------------------------------ weight

describe("weighStep", () => {
  const at = (n: number) => new Date(Date.UTC(2026, 9, n, 7)).toISOString()
  const state = (goal?: number) => ({
    weighIns: [{ id: "w", measuredAt: at(1), weightKg: 80.4 }],
    settings: {
      ...fitStore.get().settings,
      goalDirection: "cut" as const,
      goalWeight: goal,
    },
  })
  it("says the step toward the goal", () => {
    expect(R.weighStep(state(76), 80.1, at(2))).toMatchObject({
      deltaKg: -0.3,
      toward: true,
      reached: false,
      text: "▼0.3 kg toward goal",
    })
  })
  it("says a step away in its own words", () => {
    expect(R.weighStep(state(76), 80.6, at(2))?.text).toBe(
      "▲0.2 kg away from goal",
    )
  })
  it("marks the weigh-in that reaches the goal", () => {
    expect(R.weighStep(state(80.2), 80.1, at(2))?.reached).toBe(true)
  })
  it("has nothing to compare on the first weigh-in", () => {
    expect(R.weighStep(state(76), 80, at(1))).toBeUndefined()
  })
})

// ------------------------------------------------------------------ weeks

describe("lastWeekShort", () => {
  const monday = "2026-11-02"
  it("on Monday, says how far last week fell short", () => {
    const s = fitStore.get()
    const target = s.settings.weeklyTarget
    const r = R.lastWeekShort(
      {
        ...s,
        workouts: [
          {
            id: "x",
            name: "Push",
            startedAt: "2026-10-28T09:00:00.000Z",
            endedAt: "2026-10-28T10:00:00.000Z",
            status: "finished",
            exercises: [],
            clientId: "c",
          },
        ],
      },
      monday,
    )
    expect(r).toEqual({ count: 1, target })
  })
  it("says nothing on other days", () => {
    expect(R.lastWeekShort(fitStore.get(), "2026-11-03")).toBeUndefined()
  })
})

// ------------------------------------------------------------------ cards

describe("a workout finished from the lock screen", () => {
  function live() {
    const l = benchLive([40])
    FA.toggleSet(l.id, l.we, l.sets[0])
    return l.id
  }
  it("lands as the workout card", () => {
    render(<FinishWatcher />, { wrapper })
    let id = ""
    act(() => {
      id = live()
    })
    act(() => {
      applySurfaceAction({
        id: "a1",
        kind: "workout",
        type: "finish",
        target: id,
        at: Date.now(),
      })
    })
    expect(screen.getByTestId("workout-done", hidden)).toBeTruthy()
    expect(celebrateStore.get().ids).toContain(id)
  })
  it("leaves one finished in the logger to its summary", () => {
    render(<FinishWatcher />, { wrapper })
    let id = ""
    act(() => {
      id = live()
    })
    act(() => {
      finishingHere(id)
      FA.finishWorkout(id)
    })
    expect(screen.queryByTestId("workout-done", hidden)).toBeNull()
  })
})
