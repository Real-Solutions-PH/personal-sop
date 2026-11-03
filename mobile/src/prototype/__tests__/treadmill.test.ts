// Walks and runs on a treadmill: no GPS, distance from the phone's motion
// data until the person enters the machine's reading, calories from that
// distance, the time and the incline, and comparisons only between
// sessions done the same way. Expected values are worked by hand.
import type { RunSession } from "@domain/fitness/data"
import * as RL from "@domain/fitness/run-live"
import * as R from "@domain/fitness/runs"
import { fitStore } from "@domain/fitness/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { runRecord } from "../body-rewards"

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  fitStore.set((s) => ({ ...s, weighIns: [], runs: [] }))
})

const t0 = Date.parse("2026-11-02T23:00:00.000Z")

const session = (over: Partial<RunSession> = {}): RunSession => ({
  id: "w1",
  kind: "walk",
  name: "Morning walk",
  startedAt: "2026-11-02T23:00:00.000Z",
  endedAt: "2026-11-02T23:40:00.000Z",
  movingSec: 2400,
  distanceM: 500,
  elevationGainM: 34,
  steps: 2075,
  kcal: 30,
  route: [
    [14.5, 121, 10, 0],
    [14.5001, 121, 44, 1200],
  ],
  splits: [],
  ...over,
})

describe("treadmill calories", () => {
  it("walks: 3 km in 40 min at 70 kg, flat and at 5% incline", () => {
    // 75 m/min. Flat: VO2 = 0.1 × 75 = 7.5 → 7.5 × 70 × 40 / 1000 × 5 = 105.
    expect(R.treadmillKcal(3000, 2400, 0, 70)).toBe(105)
    // 5%: 7.5 + 1.8 × 75 × 0.05 = 14.25 → 14.25 × 70 × 40 / 200 = 199.5 → 200.
    expect(R.treadmillKcal(3000, 2400, 5, 70)).toBe(200)
  })
  it("runs: 5 km in 30 min at 70 kg", () => {
    // 166.67 m/min, over 8 km/h: VO2 = 0.2 × 166.67 = 33.33 →
    // 33.33 × 70 × 30 / 200 = 350.
    expect(R.treadmillKcal(5000, 1800, 0, 70)).toBe(350)
  })
  it("no distance or no time is no estimate", () => {
    expect(R.treadmillKcal(0, 1800, 0, 70)).toBe(0)
    expect(R.treadmillKcal(3000, 0, 0, 70)).toBe(0)
  })
})

describe("a treadmill session in progress", () => {
  it("starts without GPS and saves the motion-sensor distance", () => {
    const a = RL.startRun("walk", t0, { indoor: true })
    expect(a.indoor).toBe(true)
    RL.setRunHealth({ steps: 3100, distanceM: 2340 })
    expect(R.liveDistanceM(RL.runLiveStore.get().active!)).toBe(2340)
    // 40 min, 2,340 m at 70 kg (no weigh-in): 58.5 m/min → VO2 5.85 →
    // 5.85 × 70 × 40 / 200 = 81.9 → 82.
    const done = RL.finishRun(t0 + 2_400_000)!
    expect(done).toMatchObject({
      indoor: true,
      distanceM: 2340,
      steps: 3100,
      route: [],
      splits: [],
      kcal: 82,
    })
    expect(done.elevationGainM).toBeUndefined()
  })
  it("an outdoor session ignores the motion distance", () => {
    RL.startRun("walk", t0)
    RL.setRunHealth({ distanceM: 999 })
    expect(R.liveDistanceM(RL.runLiveStore.get().active!)).toBe(0)
  })
})

describe("fixing a finished session", () => {
  it("switching to the treadmill drops the GPS route, splits and climb", () => {
    fitStore.set((s) => ({ ...s, runs: [session()] }))
    const before = RL.markTreadmill("w1")!
    expect(before.route).toHaveLength(2)
    const r = R.runsOf(fitStore.get())[0]
    expect(r).toMatchObject({
      indoor: true,
      route: [],
      splits: [],
      steps: 2075,
    })
    expect(r.elevationGainM).toBeUndefined()
    // Distance stays until the person enters the machine's: 500 m in 40 min
    // = 12.5 m/min → 1.25 × 70 × 40 / 200 = 17.5 → 18.
    expect(r.kcal).toBe(18)
    // Undo puts the original back.
    RL.restoreRun(before, true)
    expect(R.runsOf(fitStore.get())[0]).toEqual(before)
  })
  it("entering the machine's distance and incline re-estimates calories", () => {
    fitStore.set((s) => ({
      ...s,
      runs: [session({ indoor: true, route: [], elevationGainM: undefined })],
      weighIns: [
        {
          id: "w",
          measuredAt: "2026-11-01T00:00:00.000Z",
          weightKg: 80,
        } as never,
      ],
    }))
    RL.setTreadmillReadings("w1", { distanceM: 3000, inclinePct: 5 })
    const r = R.runsOf(fitStore.get())[0]
    // 75 m/min at 5% = 14.25 → 14.25 × 80 × 40 / 200 = 228.
    expect(r).toMatchObject({ distanceM: 3000, inclinePct: 5, kcal: 228 })
    RL.setTreadmillReadings("w1", { distanceM: 3000, inclinePct: null })
    expect(R.runsOf(fitStore.get())[0].inclinePct).toBeUndefined()
  })
})

describe("comparisons are like with like", () => {
  const outdoor = session({
    id: "o",
    distanceM: 1500,
    startedAt: "2026-10-01T23:00:00.000Z",
  })
  const indoorOld = session({
    id: "i0",
    indoor: true,
    route: [],
    distanceM: 3000,
    startedAt: "2026-10-05T23:00:00.000Z",
  })
  const indoorNew = session({
    id: "i1",
    indoor: true,
    route: [],
    distanceM: 3200,
  })
  it("the previous session is the last one done the same way", () => {
    const runs = [outdoor, indoorOld, indoorNew]
    expect(R.previousLike(runs, indoorNew)?.id).toBe("i0")
    expect(R.previousLike(runs, outdoor)).toBeUndefined()
    expect(R.previousLike([outdoor, indoorNew], indoorNew)).toBeUndefined()
  })
  it("a treadmill pace is never an outdoor record and the reverse", () => {
    // The GPS walk's 1,500 m in 40 min is slow; a treadmill walk beating
    // it is not a record when no other treadmill walk exists.
    expect(runRecord([outdoor, indoorNew], indoorNew)).toBeUndefined()
    // Against an earlier treadmill walk it is: 3,200 m beats 3,000 m in 40 min.
    expect(
      runRecord([outdoor, indoorOld, indoorNew], indoorNew)?.pace,
    ).toBeTruthy()
  })
})
