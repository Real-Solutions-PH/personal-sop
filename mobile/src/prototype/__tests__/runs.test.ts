// Runs and walks: distance, splits, pauses, pace, calories, and the
// session in progress. Expected values are worked by hand in the comments,
// never taken from the functions under test.
import * as A from "@domain/fitness/actions"
import type { RunPoint, Workout } from "@domain/fitness/data"
import * as RL from "@domain/fitness/run-live"
import * as R from "@domain/fitness/runs"
import { fitStore } from "@domain/fitness/store"
import { configureStorage, resetAll } from "@domain/lib/store"

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  fitStore.set((s) => ({ ...s, weighIns: [], runs: [] }))
})

// 0.001° of latitude = 6,371,000 × π / 180 × 0.001 = 111.195 m.
const STEP_M = 111.195
/** Due north, one 0.001° step every `dt` seconds, flat at 10 m. */
const north = (n: number, dt = 30): RunPoint[] =>
  Array.from({ length: n }, (_, i) => [14 + i * 0.001, 121, 10, i * dt])

it("measures great-circle distance", () => {
  expect(R.haversineM([14, 121, null, 0], [14.001, 121, null, 1])).toBeCloseTo(
    STEP_M,
    1,
  )
})

it("closes a kilometre where it is crossed", () => {
  // 9 steps = 1,000.76 m. 1 km falls 1000 / 111.195 = 8.993 steps in, at
  // 8.993 × 30 = 269.8 s, so the split reads 270 s.
  const s = R.summarize(north(10), [])
  expect(s.distanceM).toBeCloseTo(9 * STEP_M, 0)
  expect(s.splits).toEqual([{ km: 1, sec: 270, elevM: 0 }])
  expect(s.elevationGainM).toBe(0)
})

it("leaves paused stretches out of distance and moving time", () => {
  // Paused 100–160 s: the segments 90–120, 120–150 and 150–180 touch it,
  // so 9 − 3 = 6 steps count.
  const pauses: R.Pause[] = [[100, 160]]
  expect(R.summarize(north(10), pauses).distanceM).toBeCloseTo(6 * STEP_M, 0)
  // 270 s on the clock, 60 of them paused.
  expect(R.movingAt(pauses, 270)).toBe(210)
  expect(R.movingAt([[100, null]], 130)).toBe(100)
})

it("counts climb in steps past GPS noise", () => {
  // 10 → 12 (noise) → 15 (+5) → 14 → 20 (+5) → 16 (drop, new base) → 21 (+5)
  const alts = [10, 12, 15, 14, 20, 16, 21]
  const pts: RunPoint[] = alts.map((a, i) => [14 + i * 0.0001, 121, a, i * 5])
  expect(R.summarize(pts, []).elevationGainM).toBe(15)
  expect(
    R.summarize(
      pts.map((p) => [p[0], p[1], null, p[3]]),
      [],
    ).elevationGainM,
  ).toBeNull()
})

it("drops blurry fixes and impossible jumps", () => {
  const a: RunPoint = [14, 121, null, 0]
  // 111 m in 10 s = 11.1 m/s: a sprint, fine for a run, not a walk.
  const b: RunPoint = [14.001, 121, null, 10]
  expect(R.acceptFix(a, b, 5, "run")).toBe(true)
  expect(R.acceptFix(a, b, 5, "walk")).toBe(false)
  expect(R.acceptFix(a, b, 45, "run")).toBe(false)
  expect(R.acceptFix(undefined, a, 10, "walk")).toBe(true)
})

it("works out pace", () => {
  // 1,800 s over 5,000 m = 360 s/km.
  expect(R.paceSecPerKm(1800, 5000)).toBe(360)
  expect(R.paceSecPerKm(10, 5)).toBeNull()
  expect(R.fmtPace(331)).toBe("5:31")
  expect(R.fmtPace(null)).toBe("–:––")
  expect(R.fmtClock(3735)).toBe("1:02:15")
  expect(R.fmtClock(427)).toBe("7:07")
  expect(R.fmtKm(5423)).toBe("5.42")
  // 7,580 s = 126.3 min → 2 h 6 min; 2,820 s = 47 min.
  expect(R.hoursFigure(7580)).toEqual(["2:06", "h"])
  expect(R.hoursFigure(2820)).toEqual(["47", "min"])
  // The last 30 s of a steady track: 1 step per 30 s = 30 / 0.111195 km.
  expect(R.currentPace(north(5), [])).toBeCloseTo(30 / (STEP_M / 1000), 0)
  // The last fix is at 120 s: still "now" at 130 s, stale at 140 s.
  expect(R.currentPace(north(5), [], 30, 130)).not.toBeNull()
  expect(R.currentPace(north(5), [], 30, 140)).toBeNull()
})

it("estimates a walk's active calories with the ACSM equation", () => {
  // 100 m/min (6 km/h) is a walk: VO2 = 0.1 × 100 = 10 ml/kg/min.
  // 10 min at 70 kg: 10 × 70 × 10 / 1000 × 5 = 35 kcal.
  expect(R.footVo2(100)).toBe(10)
  const pts: RunPoint[] = Array.from({ length: 11 }, (_, i) => [
    14 + (i * 100) / 111_195,
    121,
    null,
    i * 60,
  ])
  expect(R.runKcal(pts, [], 70)).toBe(35)
  // 200 m/min (12 km/h) runs: 0.2 × 200 = 40; at 5% grade + 0.9 × 200 × 0.05 = 49.
  expect(R.footVo2(200, 0.05)).toBe(49)
})

const wk = (over: Partial<Workout>): Workout => ({
  id: "w",
  name: "Push",
  startedAt: "2026-10-01T10:00:00.000Z",
  endedAt: "2026-10-01T10:45:00.000Z",
  status: "finished",
  clientId: "c",
  exercises: [],
  ...over,
})
const sets = (n: number, extra = {}) =>
  Array.from({ length: n }, (_, i) => ({
    id: `s${i}`,
    reps: 8,
    weight: 60,
    kind: "working" as const,
    completedAt: "2026-10-01T10:10:00.000Z",
    ...extra,
  }))
const weighIn = (kg: number, at = "2026-09-30T06:00:00.000Z") => [
  { id: "wi", measuredAt: at, weightKg: kg },
]

it("estimates a lifting session from its time, density and weight", () => {
  // 45 min, 12 working sets: 12 / 45 × 10 = 2.67 per 10 min < 3, MET 3.5.
  // (3.5 − 1) × 80 kg × 0.75 h = 150 kcal.
  const w = wk({
    exercises: [{ id: "e", exerciseId: "bench", sets: sets(12) }],
  })
  expect(R.workoutKcal({ weighIns: weighIn(80) }, w)).toBe(150)
  // 15 working sets: 3.33 per 10 min, MET 5: 4 × 80 × 0.75 = 240.
  const dense = wk({
    exercises: [{ id: "e", exerciseId: "bench", sets: sets(15) }],
  })
  expect(R.workoutKcal({ weighIns: weighIn(80) }, dense)).toBe(240)
})

it("counts a timed walk set with the walking equation", () => {
  // A 20-min set at 6 km/h (100 m/min): 10 × 80 × 20 / 1000 × 5 = 80.
  // The other 30 of 50 min at MET 3.5: 2.5 × 80 × 0.5 = 100. Total 180.
  const w = wk({
    endedAt: "2026-10-01T10:50:00.000Z",
    exercises: [
      {
        id: "e",
        exerciseId: "walk",
        sets: sets(1, { durationSec: 1200, speedKmh: 6, reps: 0 }),
      },
    ],
  })
  expect(R.workoutKcal({ weighIns: weighIn(80) }, w)).toBe(180)
})

it("assumes 70 kg without a weigh-in, and nothing done is nothing burned", () => {
  // 2.5 × 70 × 0.75 = 131.25 → 131.
  const w = wk({
    exercises: [{ id: "e", exerciseId: "bench", sets: sets(12) }],
  })
  expect(R.workoutKcal({ weighIns: [] }, w)).toBe(131)
  expect(R.weightAt({ weighIns: [] }, w.startedAt)).toEqual({
    kg: 70,
    assumed: true,
  })
  expect(R.workoutKcal({ weighIns: weighIn(80) }, wk({}))).toBe(0)
})

it("a chat-logged workout counts 2.5 minutes a working set", () => {
  // 12 sets × 2.5 = 30 min; 4 per 10 min ≥ 3, MET 5: 4 × 80 × 0.5 = 160.
  const w = wk({
    source: "chat",
    exercises: [{ id: "e", exerciseId: "bench", sets: sets(12) }],
  })
  expect(R.workoutKcal({ weighIns: weighIn(80) }, w)).toBe(160)
})

it("finishing a workout stores its estimate", () => {
  const start = A.startWorkout({ from: "empty" })
  expect(start.ok).toBe(true)
  const id = fitStore.get().activeId as string
  const done = A.finishWorkout(id)
  expect(done?.kcal).toBe(0)
})

describe("a session in progress", () => {
  const t0 = Date.parse("2026-10-01T06:00:00.000Z")
  const fix = (i: number, at: number) => ({
    lat: 14 + i * 0.001,
    lng: 121,
    alt: 10,
    accuracy: 5,
    at,
  })

  it("records, pauses and saves to history", () => {
    RL.startRun("run", t0)
    RL.addFixes([0, 1, 2, 3].map((i) => fix(i, t0 + i * 30_000)))
    RL.pauseRun(t0 + 100_000)
    // Ignored while paused.
    RL.addFixes([fix(9, t0 + 120_000)])
    RL.resumeRun(t0 + 160_000)
    RL.addFixes([4, 5].map((i) => fix(i, t0 + 160_000 + (i - 3) * 30_000)))
    const active = RL.runLiveStore.get().active!
    expect(active.points).toHaveLength(6)
    expect(RL.isPaused(active)).toBe(false)
    // 280 s on the clock (finish at +280 s), 60 paused.
    const done = RL.finishRun(t0 + 280_000)!
    expect(done.movingSec).toBe(220)
    // Steps 0–3 (3) and 4–5 (1); 3→4 spans the pause and is left out.
    expect(done.distanceM).toBe(Math.round(4 * STEP_M))
    expect(done.name).toMatch(/run$/)
    expect(RL.runLiveStore.get().active).toBeNull()
    expect(R.runsOf(fitStore.get()).map((r) => r.id)).toEqual([done.id])
  })

  it("starting twice keeps the first", () => {
    const a = RL.startRun("walk", t0)
    expect(RL.startRun("run", t0 + 1000).id).toBe(a.id)
  })

  it("an open pause ends at the finish", () => {
    RL.startRun("walk", t0)
    RL.pauseRun(t0 + 60_000)
    expect(RL.finishRun(t0 + 120_000)!.movingSec).toBe(60)
  })
})

it("thins a long route evenly and keeps both ends", () => {
  const pts = north(12_000, 1)
  const out = R.thin(pts)
  expect(out).toHaveLength(5000)
  expect(out[0]).toBe(pts[0])
  expect(out.at(-1)).toBe(pts.at(-1))
})
