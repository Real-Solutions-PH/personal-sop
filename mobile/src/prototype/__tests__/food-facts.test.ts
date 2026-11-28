// The food page's figures, each worked out by hand in its comment: serving
// math, each macro's share of calories, a share of a daily target, the
// labelling-rule highlights, and a person's history with a food.
import type { Meal, MealItem } from "@domain/fitness/data"
import { scaleFood } from "@/live/food-scale"
import {
  type FactsFood,
  foodHistory,
  gramsPerBasis,
  highlights,
  isThisFood,
  macroSplit,
  per100g,
  shareOf,
  stepFor,
  wholePercents,
} from "../food-facts"

const food = (over: Partial<FactsFood> = {}): FactsFood => ({
  basis: "100g",
  unit_grams: null,
  kcal: 100,
  protein: 0,
  carbs: 0,
  fat: 0,
  fiber: null,
  sat_fat: null,
  sugar: null,
  sodium: null,
  ...over,
})

describe("serving math", () => {
  const chicken = food({ kcal: 165, protein: 31, carbs: 0, fat: 3.6 })
  test("150 g of a per-100 g food is 1.5 times its numbers", () => {
    // 165 × 1.5 = 247.5; 31 × 1.5 = 46.5; 3.6 × 1.5 = 5.4
    const s = scaleFood(chicken, 150, "g")
    expect(s).toMatchObject({ kcal: 247.5, protein: 46.5, fat: 5.4 })
  })
  test("pieces of a per-100 g food go through the piece weight", () => {
    // 2 pieces × 120 g = 240 g → 2.4 × 165 = 396
    const s = scaleFood({ ...chicken, unit_grams: 120 }, 2, "piece")
    expect(s?.kcal).toBe(396)
  })
  test("grams of a per-serving food go through the serving weight", () => {
    // 85 g of a 170 g serving is half: 100 / 2 = 50 kcal
    const s = scaleFood(
      food({ basis: "serving", unit_grams: 170, kcal: 100 }),
      85,
      "g",
    )
    expect(s?.kcal).toBe(50)
  })
  test("grams of a serving with no weight cannot be scaled", () => {
    expect(scaleFood(food({ basis: "serving" }), 50, "g")).toBeNull()
  })
  test("an unknown nutrient stays unknown at any amount", () => {
    expect(scaleFood(chicken, 200, "g")?.fiber).toBeNull()
  })
  test("one tap steps 10 g, or half a piece or serving", () => {
    expect(stepFor("g")).toBe(10)
    expect(stepFor("serving")).toBe(0.5)
    expect(stepFor("piece")).toBe(0.5)
  })
})

describe("% of calories", () => {
  test("shares of the macros' energy at 4 / 4 / 9 kcal a gram", () => {
    // 31 g × 4 = 124; 0; 3.6 × 9 = 32.4; total 156.4
    const s = macroSplit({ protein: 31, carbs: 0, fat: 3.6 })
    expect(s.protein).toBeCloseTo(124 / 156.4, 10)
    expect(s.fat).toBeCloseTo(32.4 / 156.4, 10)
    expect(s.carbs).toBe(0)
  })
  test("no macro energy is all zero, not NaN", () => {
    expect(macroSplit({ protein: 0, carbs: 0, fat: 0 })).toEqual({
      protein: 0,
      carbs: 0,
      fat: 0,
    })
  })
  test("whole percentages always add up to 100", () => {
    // 1 g each: 4, 4, 9 of 17 kcal = 23.53%, 23.53%, 52.94% → floors
    // 23, 23, 52 (98); the two largest remainders (.94, then .53) get one.
    const p = wholePercents(macroSplit({ protein: 1, carbs: 1, fat: 1 }))
    expect(p.protein + p.carbs + p.fat).toBe(100)
    expect(p).toEqual({ protein: 24, carbs: 23, fat: 53 })
  })
})

describe("% of target", () => {
  test("an amount over its target", () => {
    expect(shareOf(31, 150)).toBeCloseTo(0.2067, 4)
  })
  test("no target, a zero target or an unknown amount gives null", () => {
    expect(shareOf(31, undefined)).toBeNull()
    expect(shareOf(31, 0)).toBeNull()
    expect(shareOf(null, 150)).toBeNull()
  })
  test("per 100 g needs a weight", () => {
    expect(gramsPerBasis(food())).toBe(100)
    expect(gramsPerBasis(food({ basis: "piece", unit_grams: 50 }))).toBe(50)
    expect(gramsPerBasis(food({ basis: "serving" }))).toBeNull()
    // 300 mg in a 50 g piece = 600 mg per 100 g
    expect(per100g(food({ basis: "piece", unit_grams: 50 }), 300)).toBe(600)
  })
})

describe("highlights", () => {
  const keys = (f: FactsFood) =>
    highlights(f).map((h) => `${h.label}: ${h.detail}`)

  test("protein at 20% of calories is high, 12% a source, under none", () => {
    // 5 g × 4 = 20 kcal of 100
    expect(keys(food({ protein: 5 }))).toEqual([
      "High protein: 20% of calories",
    ])
    // 3 g × 4 = 12 of 100
    expect(keys(food({ protein: 3 }))).toEqual([
      "Source of protein: 12% of calories",
    ])
    // 2.9 g × 4 = 11.6 of 100
    expect(keys(food({ protein: 2.9 }))).toEqual([])
  })

  test("fiber: 6 g per 100 g high, 3 g a source", () => {
    expect(keys(food({ kcal: 400, fiber: 6 }))).toEqual([
      "High fiber: 6 g per 100 g",
    ])
    // 400 kcal: 3 g per 100 g (source); 0.75 g per 100 kcal (not high)
    expect(keys(food({ kcal: 400, fiber: 3 }))).toEqual([
      "Good fiber source: 3 g per 100 g",
    ])
    expect(keys(food({ kcal: 400, fiber: 2.9 }))).toEqual([])
  })

  test("fiber per 100 kcal counts where the grams fall short", () => {
    // 50 kcal, 2 g per 100 g → 4 g per 100 kcal: high by the kcal rule
    expect(keys(food({ kcal: 50, fiber: 2 }))).toEqual([
      "High fiber: 2 g per 100 g",
    ])
  })

  test("a serving with no weight is read per 100 kcal for fiber", () => {
    // 1.5 g in a 100 kcal serving = 1.5 g per 100 kcal: a source
    expect(keys(food({ basis: "serving", fiber: 1.5 }))).toEqual([
      "Good fiber source: 1.5 g per serving",
    ])
  })

  test("sodium over 600 mg per 100 g is high; 600 exactly is not", () => {
    expect(keys(food({ sodium: 601 }))).toEqual([
      "High sodium: 601 mg per 100 g",
    ])
    expect(keys(food({ sodium: 600 }))).toEqual([])
  })

  test("sugar over 22.5 g and saturated fat over 5 g per 100 g", () => {
    expect(keys(food({ sugar: 23, sat_fat: 5.1 }))).toEqual([
      "High added sugar: 23 g per 100 g",
      "High saturated fat: 5.1 g per 100 g",
    ])
    expect(keys(food({ sugar: 22.5, sat_fat: 5 }))).toEqual([])
  })

  test("a piece with a weight is read per 100 g", () => {
    // 330 mg in a 50 g piece = 660 mg per 100 g
    expect(keys(food({ basis: "piece", unit_grams: 50, sodium: 330 }))).toEqual(
      ["High sodium: 660 mg per 100 g"],
    )
  })

  test("a serving with no weight uses 20% of the FDA Daily Value", () => {
    // 460 / 2,300 = 20%; 459 is under
    expect(keys(food({ basis: "serving", sodium: 460 }))).toEqual([
      "High sodium: 20% of a day's value per serving",
    ])
    expect(keys(food({ basis: "serving", sodium: 459 }))).toEqual([])
    // 10 / 50 g added sugar = 20%; 4 / 20 g sat fat = 20%
    expect(keys(food({ basis: "serving", sugar: 10, sat_fat: 4 }))).toEqual([
      "High added sugar: 20% of a day's value per serving",
      "High saturated fat: 20% of a day's value per serving",
    ])
  })

  test("unknown values earn nothing, and only kcal + 3 macros is fine", () => {
    expect(highlights(food({ kcal: 0 }))).toEqual([])
    expect(keys(food({ kcal: 250, protein: 2, carbs: 50, fat: 3 }))).toEqual([])
  })

  test("good highlights come before the ones to watch", () => {
    const h = highlights(food({ protein: 10, sodium: 900 }))
    expect(h.map((x) => x.tone)).toEqual(["good", "watch"])
  })
})

describe("history", () => {
  let n = 0
  const item = (name: string, m: Partial<MealItem> = {}): MealItem => ({
    id: `i${++n}`,
    name,
    qty: 1,
    unit: "serving",
    kcal: 100,
    protein: 0,
    carbs: 0,
    fat: 0,
    ...m,
  })
  const meal = (
    eatenAt: string,
    items: MealItem[],
    status: Meal["status"] = "confirmed",
  ): Meal => ({
    id: `m${eatenAt}`,
    eatenAt,
    label: "lunch",
    source: "manual",
    rawInput: "",
    status,
    items,
  })
  const skyr = { name: "Skyr, vanilla", aliases: ["skyr"] }

  test("an item matches by its name, an alias, a portion note or the library note", () => {
    expect(isThisFood({ name: "skyr, VANILLA" }, skyr)).toBe(true)
    expect(isThisFood({ name: "Skyr (150 g)" }, skyr)).toBe(true)
    expect(
      isThisFood(
        { name: "yogurt", assumption: "From your food library: Skyr, vanilla" },
        skyr,
      ),
    ).toBe(true)
    expect(isThisFood({ name: "Skyr bar" }, skyr)).toBe(false)
  })

  test("counts, the latest and the usual amount, newest first", () => {
    const meals = [
      meal("2026-11-01T08:00:00Z", [item("Skyr", { qty: 1 })]),
      meal("2026-11-03T08:00:00Z", [item("Skyr", { qty: 2 }), item("Rice")]),
      meal("2026-11-05T08:00:00Z", [item("Skyr, vanilla", { qty: 1 })]),
      meal("2026-11-06T08:00:00Z", [item("Skyr")], "pending_estimate"),
    ]
    const h = foodHistory(meals, skyr)
    expect(h.count).toBe(3)
    expect(h.last?.meal.eatenAt).toBe("2026-11-05T08:00:00Z")
    expect(h.usual).toEqual({ qty: 1, unit: "serving", times: 2 })
    expect(h.recent.map((r) => r.meal.eatenAt)).toEqual([
      "2026-11-05T08:00:00Z",
      "2026-11-03T08:00:00Z",
      "2026-11-01T08:00:00Z",
    ])
  })

  test("a tie in amounts goes to the latest one", () => {
    const meals = [
      meal("2026-11-01T08:00:00Z", [item("Skyr", { qty: 1 })]),
      meal("2026-11-02T08:00:00Z", [item("Skyr", { qty: 2 })]),
    ]
    expect(foodHistory(meals, skyr).usual?.qty).toBe(2)
  })

  test("never eaten: zero, nothing latest, no usual", () => {
    expect(foodHistory([], skyr)).toEqual({
      count: 0,
      last: null,
      usual: null,
      recent: [],
    })
  })
})
