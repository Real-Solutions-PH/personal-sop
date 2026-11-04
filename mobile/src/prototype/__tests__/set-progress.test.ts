// The logger's per-set comparison with the same set last time: more reps
// or more weight is a step up (in the set's own unit, kg or lb), a set with
// no last time is new, equal is the same, and fewer is honestly lower.
import { meetsGoal, setProgress } from "../set-progress"

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
