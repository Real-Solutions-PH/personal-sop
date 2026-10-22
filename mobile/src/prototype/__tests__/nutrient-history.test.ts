// The Nutrition page's goal history: each day's amount against its goal,
// whether it hit, and the counts the headline reads.

import type { FitnessState, Meal } from "@domain/fitness/data"
import { nutrientHistory, statusOf } from "@domain/fitness/history"
import { dayOffset } from "@domain/lib/day"

const target = {
  id: "t",
  effectiveFrom: "2000-01-01",
  kcal: 2000,
  protein: 150,
  carbs: 200,
  fat: 70,
  sodiumMax: 2000,
}
const meal = (
  n: number,
  protein: number,
  extra: Partial<Meal["items"][number]> = {},
): Meal => ({
  id: `m${n}`,
  // Noon of that business day, so the test holds before 04:00 too.
  eatenAt: new Date(`${dayOffset(n)}T12:00:00`).toISOString(),
  label: "lunch",
  source: "text",
  rawInput: "",
  status: "confirmed",
  items: [
    {
      id: `i${n}`,
      name: "food",
      qty: 1,
      unit: "serving",
      kcal: 2000,
      protein,
      carbs: 200,
      fat: 70,
      ...extra,
    },
  ],
})
const state = (meals: Meal[]) =>
  ({ targets: [target], meals }) as unknown as FitnessState

describe("statusOf", () => {
  it("counts protein as reached from 90% of the goal", () => {
    expect(statusOf("reach", 135, 150)).toBe("hit")
    expect(statusOf("reach", 134, 150)).toBe("miss")
  })
  it("reads calories as on target within 10% either side", () => {
    expect(statusOf("near", 1800, 2000)).toBe("hit")
    expect(statusOf("near", 2200, 2000)).toBe("hit")
    expect(statusOf("near", 1799, 2000)).toBe("miss")
    expect(statusOf("near", 2201, 2000)).toBe("over")
  })
  it("reads a limit as over only past it", () => {
    expect(statusOf("under", 2000, 2000)).toBe("hit")
    expect(statusOf("under", 2001, 2000)).toBe("over")
  })
})

describe("nutrientHistory", () => {
  const s = state([meal(0, 140), meal(-1, 100), meal(-3, 150)])

  it("gives one point per day, oldest first, ending today", () => {
    const h = nutrientHistory(s, "protein", 7)
    expect(h.points).toHaveLength(7)
    expect(h.points[0].day).toBe(dayOffset(-6))
    expect(h.points[6].day).toBe(dayOffset(0))
  })

  it("judges logged days and leaves the rest empty", () => {
    const h = nutrientHistory(s, "protein", 7)
    const byDay = Object.fromEntries(h.points.map((p) => [p.day, p]))
    expect(byDay[dayOffset(0)]).toMatchObject({ value: 140, status: "hit" })
    expect(byDay[dayOffset(-1)]).toMatchObject({ value: 100, status: "miss" })
    expect(byDay[dayOffset(-2)]).toMatchObject({ value: null, status: "none" })
    expect(h.judged).toBe(3)
    expect(h.hit).toBe(2)
    // (140 + 100 + 150) / 3 over the logged days only.
    expect(h.avg).toBeCloseTo(130)
    expect(h.avgGoal).toBe(150)
  })

  it("leaves today open while protein is still short", () => {
    const h = nutrientHistory(state([meal(0, 90), meal(-1, 90)]), "protein", 7)
    const byDay = Object.fromEntries(h.points.map((p) => [p.day, p]))
    expect(byDay[dayOffset(0)].status).toBe("open")
    expect(byDay[dayOffset(-1)].status).toBe("miss")
    // Today isn't counted until it's settled; its amount still averages in.
    expect(h.judged).toBe(1)
    expect(h.avg).toBe(90)
  })

  it("judges today once a limit is already passed, and leaves it open under", () => {
    const over = nutrientHistory(
      state([meal(0, 150, { sodium: 2500 })]),
      "sodium",
      7,
    )
    expect(over.points.at(-1)?.status).toBe("over")
    const under = nutrientHistory(
      state([meal(0, 150, { sodium: 900 })]),
      "sodium",
      7,
    )
    expect(under.points.at(-1)?.status).toBe("open")
    expect(under.judged).toBe(0)
  })

  it("shows a 14-day window", () => {
    expect(nutrientHistory(s, "protein", 14).points).toHaveLength(14)
  })

  it("marks sodium over the day's limit, and unrecorded sodium as unknown", () => {
    const h = nutrientHistory(
      state([meal(0, 150, { sodium: 2500 }), meal(-1, 150)]),
      "sodium",
      7,
    )
    const byDay = Object.fromEntries(h.points.map((p) => [p.day, p]))
    expect(byDay[dayOffset(0)]).toMatchObject({
      value: 2500,
      goal: 2000,
      status: "over",
    })
    expect(byDay[dayOffset(-1)]).toMatchObject({ value: null, status: "none" })
    expect(h.judged).toBe(1)
    expect(h.hit).toBe(0)
  })
})
