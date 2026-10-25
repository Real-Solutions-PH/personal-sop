import {
  ageFrom,
  estimatePlan,
  type Plan,
  type PlanInputs,
  planGoalFor,
  planInputsFrom,
  planNotes,
} from "@domain/fitness/plan"
import { fitStore } from "@domain/fitness/store"

const A: PlanInputs = {
  sex: "male",
  age: 30,
  heightCm: 180,
  weightKg: 80,
  activity: "moderate",
  goal: "maintain",
}
const B: PlanInputs = {
  sex: "female",
  age: 25,
  heightCm: 165,
  weightKg: 60,
  bodyFatPct: 25,
  activity: "light",
  goal: "lose",
}
const C: PlanInputs = {
  sex: "male",
  age: 40,
  heightCm: 175,
  weightKg: 110,
  bodyFatPct: 35,
  activity: "sedentary",
  goal: "recomp",
}

test("Mifflin-St Jeor, maintain", () => {
  expect(estimatePlan(A)).toMatchObject({
    bmr: 1780,
    kcal: 2750,
    protein: 144,
    fat: 83,
    carbs: 357,
    fiberG: 39,
  })
  expect(estimatePlan(A).tdee).toBeCloseTo(2759)
})
test("Katch-McArdle when body fat known, lose", () => {
  expect(estimatePlan(B)).toMatchObject({
    bmr: 1342,
    kcal: 1500,
    protein: 132,
    fat: 45,
    carbs: 142,
    fiberG: 25,
  })
})
test("lean-mass protein at 30%+ body fat, recomp", () => {
  expect(estimatePlan(C)).toMatchObject({ kcal: 2200, protein: 186 })
})
test("build is a lean surplus", () => {
  expect(estimatePlan({ ...A, goal: "build" }).kcal).toBe(2950)
})
test("estimate never lands below BMR or the floor", () => {
  const small: PlanInputs = {
    sex: "female",
    age: 60,
    heightCm: 150,
    weightKg: 45,
    activity: "sedentary",
    goal: "lose",
  }
  const p = estimatePlan(small)
  expect(p.kcal).toBeGreaterThanOrEqual(Math.max(p.bmr, 1200))
})
test.each([
  A,
  B,
  C,
  { ...A, goal: "build" as const },
])("a fresh estimate carries no notes", (i) => {
  expect(planNotes(estimatePlan(i), i)).toEqual([])
})
test("each note fires", () => {
  const p = estimatePlan(A)
  const fields = (t: Partial<Plan>) =>
    planNotes({ ...p, ...t }, A).map((n) => n.field)
  expect(
    planNotes({ ...p, kcal: 1700 }, A).filter((n) => n.field === "kcal"),
  ).toHaveLength(1)
  expect(planNotes({ ...p, kcal: 1700 }, A)[0].text).toBe(
    "Below what your body burns at rest",
  )
  expect(
    planNotes({ ...p, kcal: 3700, carbs: 594 }, A).find(
      (n) => n.field === "kcal",
    )?.text,
  ).toBe("Faster than ~0.9 kg/week gain")
  expect(fields({ protein: 50, carbs: 451 })).toEqual(["protein"])
  expect(fields({ protein: 260, carbs: 236 })).toContain("protein")
  expect(fields({ fat: 40, carbs: 452 })).toContain("fat")
  expect(fields({ fiberG: 20 })).toEqual(["fiber"])
  expect(fields({ carbs: 200 })).toEqual(["totals"])
})
test("goal_direction wins over a stale plan_goal", () => {
  expect(planGoalFor({ goalDirection: "bulk", planGoal: "recomp" })).toBe(
    "build",
  )
  expect(planGoalFor({ goalDirection: "maintain", planGoal: "recomp" })).toBe(
    "recomp",
  )
  expect(planGoalFor({ goalDirection: "cut" })).toBe("lose")
})
test("ageFrom", () => expect(ageFrom(1996, new Date("2026-10-25"))).toBe(30))

test("planInputsFrom needs a complete profile and a weigh-in", () => {
  const s = fitStore.get()
  const settings = {
    ...s.settings,
    sex: "male" as const,
    birthYear: new Date().getFullYear() - 30,
    heightCm: 180,
    activity: "moderate" as const,
    goalDirection: "maintain" as const,
    planGoal: undefined,
  }
  const w = (
    id: string,
    at: string,
    weightKg: number,
    bodyFatPct?: number,
  ) => ({
    id,
    measuredAt: at,
    weightKg,
    bodyFatPct,
  })
  expect(planInputsFrom({ ...s, settings, weighIns: [] })).toBeNull()
  expect(
    planInputsFrom({
      ...s,
      settings: { ...settings, sex: undefined },
      weighIns: [w("a", "2026-01-01", 80)],
    }),
  ).toBeNull()
  expect(
    planInputsFrom({
      ...s,
      settings,
      weighIns: [w("a", "2026-01-02", 81, 20), w("b", "2026-01-01", 70)],
    }),
  ).toEqual({
    sex: "male",
    age: 30,
    heightCm: 180,
    weightKg: 81,
    bodyFatPct: 20,
    activity: "moderate",
    goal: "maintain",
  })
})

test("planInputsFrom takes body fat from the newest weigh-in that has one", () => {
  const s = fitStore.get()
  const settings = {
    ...s.settings,
    sex: "male" as const,
    birthYear: new Date().getFullYear() - 30,
    heightCm: 180,
    activity: "moderate" as const,
    goalDirection: "maintain" as const,
  }
  const w = (id: string, measuredAt: string, bodyFatPct?: number) => ({
    id,
    measuredAt,
    weightKg: 80,
    bodyFatPct,
  })
  expect(
    planInputsFrom({
      ...s,
      settings,
      weighIns: [w("a", "2026-01-02"), w("b", "2026-01-01", 25)],
    })?.bodyFatPct,
  ).toBe(25)
})

test("lose fat notes when the calorie floor lands above daily burn", () => {
  const small: PlanInputs = {
    sex: "female",
    age: 60,
    heightCm: 150,
    weightKg: 45,
    activity: "sedentary",
    goal: "lose",
  }
  const p = estimatePlan(small)
  expect(p.kcal).toBeGreaterThanOrEqual(p.tdee)
  expect(planNotes(p, small)).toContainEqual({
    field: "kcal",
    text: "At or above your daily burn, so this won't lose fat",
  })
})

test("very low note fires under the sex floor but above BMR", () => {
  const small: PlanInputs = {
    sex: "female",
    age: 60,
    heightCm: 150,
    weightKg: 45,
    activity: "sedentary",
    goal: "maintain",
  }
  const p = estimatePlan(small)
  expect(
    planNotes({ ...p, kcal: 1100 }, small).filter((n) => n.field === "kcal"),
  ).toEqual([
    { field: "kcal", text: "Very low — hard to get enough nutrients" },
  ])
})
