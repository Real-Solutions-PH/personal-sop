// The logger's per-set comparison with the same set last time: more reps
// or more weight is a step up (in the set's own unit, kg or lb), a set with
// no last time is new, equal is the same, and fewer is honestly lower.
import { goalHitBy, meetsGoal, setProgress } from "../set-progress"

const LB = 0.45359237
const lb = (v: number) => Math.round(v * LB * 1000) / 1000

describe("setProgress", () => {
  test("one more rep at the same weight", () => {
    // 120 lb × 7 last time, 120 lb × 8 now: the screenshot's set 2.
    expect(
      setProgress(
        { weight: lb(120), reps: 8, unit: "lb" },
        { weight: lb(120), reps: 7, unit: "lb" },
        "kg",
      ),
    ).toEqual({ kind: "up", label: "+1 rep" })
    expect(
      setProgress({ weight: 60, reps: 10 }, { weight: 60, reps: 8 }, "kg"),
    ).toEqual({ kind: "up", label: "+2 reps" })
  })

  test("more weight, told in the set's own unit", () => {
    expect(
      setProgress({ weight: 62.5, reps: 8 }, { weight: 60, reps: 8 }, "kg"),
    ).toEqual({ kind: "up", label: "+2.5 kg" })
    expect(
      setProgress(
        { weight: lb(125), reps: 8, unit: "lb" },
        { weight: lb(120), reps: 8, unit: "lb" },
        "kg",
      ),
    ).toEqual({ kind: "up", label: "+5 lb" })
  })

  test("mixed units: last time in kg, this time in lb, compared by mass", () => {
    // 50 kg is 110.2 lb; 115 lb now is about +4.8 lb heavier.
    expect(
      setProgress(
        { weight: lb(115), reps: 8, unit: "lb" },
        { weight: 50, reps: 8, unit: "kg" },
        "kg",
      ),
    ).toEqual({ kind: "up", label: "+4.8 lb" })
    // The same plate entered as 120 lb or as its kilograms is the same set.
    expect(
      setProgress(
        { weight: lb(120), reps: 8, unit: "lb" },
        { weight: 54.431, reps: 8, unit: "kg" },
        "kg",
      ),
    ).toEqual({ kind: "same", label: "Same as last" })
  })

  test("a set with no last time is new", () => {
    expect(
      setProgress({ weight: lb(120), reps: 6, unit: "lb" }, undefined, "kg"),
    ).toEqual({
      kind: "new",
      label: "New set",
    })
  })

  test("fewer reps or less weight is honestly lower", () => {
    expect(
      setProgress({ weight: 60, reps: 7 }, { weight: 60, reps: 9 }, "kg"),
    ).toEqual({ kind: "down", label: "−2 reps" })
    expect(
      setProgress({ weight: 57.5, reps: 8 }, { weight: 60, reps: 8 }, "kg"),
    ).toEqual({ kind: "down", label: "−2.5 kg" })
  })

  test("weight against reps: the estimated max decides", () => {
    // +2.5 kg for one rep fewer is still a step up…
    expect(
      setProgress({ weight: 62.5, reps: 7 }, { weight: 60, reps: 8 }, "kg"),
    ).toEqual({ kind: "up", label: "+2.5 kg · −1 rep" })
    // …but +2.5 kg for four fewer is not.
    expect(
      setProgress({ weight: 62.5, reps: 4 }, { weight: 60, reps: 8 }, "kg"),
    ).toEqual({ kind: "down", label: "+2.5 kg · −4 reps" })
  })

  test("bodyweight sets compare reps", () => {
    expect(
      setProgress({ weight: 0, reps: 12 }, { weight: 0, reps: 10 }, "kg"),
    ).toEqual({ kind: "up", label: "+2 reps" })
  })

  test("a set with no unit of its own follows the settings unit", () => {
    expect(
      setProgress(
        { weight: lb(125), reps: 8 },
        { weight: lb(120), reps: 8 },
        "lb",
      ),
    ).toEqual({ kind: "up", label: "+5 lb" })
  })
})

describe("meetsGoal", () => {
  test("at least the goal weight for at least the goal reps", () => {
    const goal = { weight: lb(120), reps: 8 }
    expect(meetsGoal({ weight: lb(120), reps: 8 }, goal)).toBe(true)
    expect(meetsGoal({ weight: lb(125), reps: 9 }, goal)).toBe(true)
    expect(meetsGoal({ weight: lb(120), reps: 7 }, goal)).toBe(false)
    expect(meetsGoal({ weight: lb(115), reps: 10 }, goal)).toBe(false)
  })
})

describe("goalHitBy", () => {
  // Working sets today and last time, paired by position as the logger's
  // rows pair them. A "+1 rep" goal is the weakest set last time plus one,
  // aimed at every set (double progression).
  const at = "2026-11-24T10:00:00.000Z"
  const set = (reps: number, done = true, weight = 120) => ({
    weight,
    reps,
    ...(done ? { completedAt: at } : {}),
  })
  const reps9 = { kind: "reps" as const, weight: 120, reps: 9 }

  test("Leg Press: last 10/8, now 9/8 is not a hit", () => {
    // Set 1 reached 9 but dropped from 10; set 2 stayed at 8.
    expect(goalHitBy([set(9), set(8)], [set(10), set(8)], reps9)).toBeUndefined()
  })

  test("every set at the goal but one below its own last time is not a hit", () => {
    // 9/9 reaches 9 on every set, yet set 1 went down from 10.
    expect(goalHitBy([set(9), set(9)], [set(10), set(8)], reps9)).toBeUndefined()
  })

  test("last 10/8, now 10/9 is a hit, landed by the last set to tick", () => {
    const today = [
      { ...set(10), completedAt: "2026-11-24T10:00:00.000Z" },
      { ...set(9), completedAt: "2026-11-24T10:04:00.000Z" },
    ]
    expect(goalHitBy(today, [set(10), set(8)], reps9)).toBe(today[1])
  })

  test("a set not ticked yet keeps the goal a target", () => {
    expect(
      goalHitBy([set(10), set(9, false)], [set(10), set(8)], reps9),
    ).toBeUndefined()
  })

  test("fewer sets than last time is not a hit; an extra set does not block it", () => {
    expect(goalHitBy([set(11)], [set(10), set(8)], reps9)).toBeUndefined()
    expect(
      goalHitBy([set(10), set(9), set(6)], [set(10), set(8)], reps9),
    ).toBeDefined()
  })

  test("a +weight goal is hit when every set lifts the new weight for the rep floor", () => {
    // The plan trades reps for weight, so fewer reps than last time is fine.
    const goal = { kind: "weight" as const, weight: 122.5, reps: 8 }
    const last = [set(12), set(12)]
    expect(goalHitBy([set(8, true, 122.5), set(8, true, 122.5)], last, goal)).toBeDefined()
    expect(goalHitBy([set(8, true, 122.5), set(12)], last, goal)).toBeUndefined()
  })
})
