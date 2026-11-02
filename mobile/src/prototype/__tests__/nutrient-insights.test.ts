// Which foods gave the most of a nutrient, and which meals gave the most
// protein per calorie, worked out by hand below.
import type { Meal, MealItem } from "@domain/fitness/data"
import { bestMeals, topFoods } from "../nutrient-insights"

let n = 0
const item = (
  name: string,
  m: Partial<Omit<MealItem, "id" | "name">> = {},
): MealItem => ({
  id: `i${++n}`,
  name,
  qty: 1,
  unit: "serving",
  kcal: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
  ...m,
})
const meal = (
  id: string,
  at: string,
  items: MealItem[],
  status: Meal["status"] = "confirmed",
): Meal => ({
  id,
  label: "lunch",
  eatenAt: `2026-11-01T${at}:00`,
  source: "text",
  rawInput: id,
  status,
  items,
})

describe("topFoods", () => {
  test("ranks foods, not meals, adding up the same food across meals", () => {
    const r = topFoods(
      [
        meal("a", "08:00", [
          item("Iced coffee (large)", { sugar: 30 }),
          item("Pandesal", { sugar: 4 }),
        ]),
        meal("b", "15:00", [item("iced coffee", { sugar: 25 })]),
        meal("c", "20:00", [item("Leche flan (1 slice)", { sugar: 41 })]),
      ],
      "sugar",
    )
    // Iced coffee 30 + 25 = 55, leche flan 41, pandesal 4: total 100.
    expect(r.total).toBe(100)
    expect(
      r.rows.map((x) => [x.name, x.amount, x.share, x.count, x.mealId]),
    ).toEqual([
      // The name and the meal come from the latest time it was eaten.
      ["iced coffee", 55, 0.55, 2, "b"],
      ["Leche flan", 41, 0.41, 1, "c"],
      ["Pandesal", 4, 0.04, 1, "a"],
    ])
    expect(r.unknown).toBe(0)
  })

  test("foods with no value are counted apart, not as zero", () => {
    const r = topFoods(
      [
        meal("a", "08:00", [
          item("Rice", { satFat: 0.1 }),
          item("Fried chicken"),
          item("Fried chicken"),
          item("Gravy"),
        ]),
      ],
      "satFat",
    )
    expect(r.rows.map((x) => x.name)).toEqual(["Rice"])
    expect(r.total).toBeCloseTo(0.1)
    // Two distinct foods carry no sat fat value.
    expect(r.unknown).toBe(2)
    expect(r.known).toBe(1)
  })

  test("counts only the days that carry the value, for a fair average", () => {
    const on = (m: Meal, day: string) => ({
      ...m,
      eatenAt: `${day}T12:00:00`,
    })
    const r = topFoods(
      [
        on(meal("a", "12:00", [item("Cake", { sugar: 40 })]), "2026-10-30"),
        on(meal("b", "12:00", [item("Rice")]), "2026-10-31"),
        on(meal("c", "12:00", [item("Tea", { sugar: 0 })]), "2026-11-01"),
      ],
      "sugar",
    )
    // Oct 31 carries no sugar value, so it is not a day of zero sugar.
    expect(r.days).toBe(2)
  })

  test("macros are always known; zero amounts are not contributors", () => {
    const r = topFoods(
      [
        meal("a", "08:00", [
          item("Egg", { protein: 6, kcal: 70 }),
          item("Black coffee", { kcal: 2 }),
        ]),
      ],
      "protein",
    )
    expect(r.rows.map((x) => x.name)).toEqual(["Egg"])
    expect(r.unknown).toBe(0)
  })

  test("meals waiting for an estimate count towards nothing", () => {
    const r = topFoods(
      [meal("a", "08:00", [item("Cake", { sugar: 40 })], "pending_estimate")],
      "sugar",
    )
    expect(r).toEqual({ rows: [], total: 0, known: 0, unknown: 0, days: 0 })
  })

  test("a tie keeps the food eaten first", () => {
    const r = topFoods(
      [
        meal("a", "08:00", [item("Banana", { fiber: 3 })]),
        meal("b", "12:00", [item("Apple", { fiber: 3 })]),
      ],
      "fiber",
    )
    expect(r.rows.map((x) => x.name)).toEqual(["Banana", "Apple"])
  })
})

describe("bestMeals", () => {
  test("ranks meals by protein grams per 100 kcal, with their calorie split", () => {
    const r = bestMeals([
      // 40 g protein in 400 kcal = 10 g per 100 kcal.
      // Energy: protein 160, carbs 4 * 30 = 120, fat 9 * 13.33 = 120.
      meal("chicken", "13:00", [
        item("Half chicken", {
          kcal: 400,
          protein: 40,
          carbs: 30,
          fat: 120 / 9,
        }),
      ]),
      // 20 g in 800 kcal = 2.5 g per 100 kcal.
      meal("pasta", "19:00", [
        item("Carbonara", { kcal: 800, protein: 20, carbs: 100, fat: 32 }),
      ]),
      // 12 g in 300 kcal = 4 g per 100 kcal.
      meal("eggs", "07:00", [
        item("Eggs", { kcal: 210, protein: 12, fat: 15 }),
        item("Toast", { kcal: 90, carbs: 18 }),
      ]),
    ])
    expect(r.rows.map((x) => [x.meal.id, x.per100])).toEqual([
      ["chicken", 10],
      ["eggs", 4],
      ["pasta", 2.5],
    ])
    const top = r.rows[0]
    expect(top.kcal).toBe(400)
    expect(top.protein).toBe(40)
    expect(top.split.protein).toBeCloseTo(0.4)
    expect(top.split.carbs).toBeCloseTo(0.3)
    expect(top.split.fat).toBeCloseTo(0.3)
    expect(r.skipped).toBe(0)
  })

  test("small meals and drinks under 100 kcal are left out and counted", () => {
    const r = bestMeals([
      meal("shake", "10:00", [item("Whey", { kcal: 99, protein: 24 })]),
      meal("tea", "16:00", [item("Green tea", { kcal: 0 })]),
      meal("lunch", "12:00", [item("Rice bowl", { kcal: 500, protein: 15 })]),
      meal("wait", "18:00", [item("Soup", { kcal: 300 })], "pending_estimate"),
    ])
    expect(r.rows.map((x) => x.meal.id)).toEqual(["lunch"])
    expect(r.skipped).toBe(2)
  })

  test("a tie goes to the meal with more protein", () => {
    const r = bestMeals([
      meal("small", "08:00", [item("A", { kcal: 200, protein: 10 })]),
      meal("big", "12:00", [item("B", { kcal: 600, protein: 30 })]),
    ])
    expect(r.rows.map((x) => x.meal.id)).toEqual(["big", "small"])
  })

  test("the same meal eaten again is one row, counted, opening the latest", () => {
    const r = bestMeals([
      meal("shake1", "08:00", [
        item("Whey (1 scoop)", { kcal: 120, protein: 24 }),
      ]),
      meal("rice", "12:00", [item("Rice bowl", { kcal: 500, protein: 15 })]),
      meal("shake2", "16:00", [item("whey", { kcal: 130, protein: 25 })]),
    ])
    expect(r.rows.map((x) => [x.meal.id, x.count, x.kcal, x.protein])).toEqual([
      // Both shakes added: 49 g in 250 kcal = 19.6 g per 100 kcal.
      ["shake2", 2, 250, 49],
      ["rice", 1, 500, 15],
    ])
    expect(r.rows[0].per100).toBeCloseTo(19.6)
  })

  test("no meals, no rows", () => {
    expect(bestMeals([])).toEqual({ rows: [], skipped: 0 })
  })
})
