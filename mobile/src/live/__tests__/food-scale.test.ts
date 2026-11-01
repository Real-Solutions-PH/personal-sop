// A library food scaled to an amount, the server's sum: the factor from
// the amount and the food's basis, then each known nutrient times it,
// rounded to one decimal the way Python's round() does.

import { round1, scaleFactor, scaleFood } from "../food-scale"

const per100 = {
  basis: "100g",
  unit_grams: null as number | null,
  kcal: 165,
  protein: 31,
  carbs: 0,
  fat: 3.6,
  fiber: null,
  sat_fat: 1,
  sugar: null,
  sodium: 74,
}
const perPiece = { ...per100, basis: "piece", unit_grams: 50, kcal: 70 }

describe("scaleFactor", () => {
  test("no amount, or a negative one, scales to nothing", () => {
    expect(scaleFactor(per100, 0, "g")).toBeNull()
    expect(scaleFactor(per100, -5, "g")).toBeNull()
  })
  test("grams of a per-100 g food", () => {
    expect(scaleFactor(per100, 150, "g")).toBe(1.5)
    for (const u of ["gram", "grams", "gm", "gms", " G "])
      expect(scaleFactor(per100, 50, u)).toBe(0.5)
  })
  test("grams of a per-piece food need its unit weight", () => {
    expect(scaleFactor(perPiece, 100, "g")).toBe(2)
    expect(scaleFactor({ ...perPiece, unit_grams: null }, 100, "g")).toBeNull()
  })
  test("pieces of a per-100 g food need its unit weight", () => {
    expect(scaleFactor(per100, 2, "piece")).toBeNull()
    expect(scaleFactor({ ...per100, unit_grams: 60 }, 2, "pcs")).toBe(1.2)
  })
  test("a count of a per-piece or per-serving food is the count", () => {
    for (const u of ["", "pc", "serving", "x", "eggs", "slice", "cups"])
      expect(scaleFactor(perPiece, 3, u)).toBe(3)
    expect(scaleFactor({ ...perPiece, basis: "serving" }, 2, "servings")).toBe(
      2,
    )
  })
  test("an unknown unit scales to nothing", () => {
    expect(scaleFactor(per100, 1, "tbsp")).toBeNull()
    expect(scaleFactor(perPiece, 1, "kg")).toBeNull()
  })
})

describe("scaleFood", () => {
  test("every known nutrient times the factor; unknown stays unknown", () => {
    expect(scaleFood(per100, 150, "g")).toEqual({
      factor: 1.5,
      kcal: 247.5,
      protein: 46.5,
      carbs: 0,
      fat: 5.4,
      fiber: null,
      sat_fat: 1.5,
      sugar: null,
      sodium: 111,
    })
  })
  test("null when the amount cannot be scaled", () => {
    expect(scaleFood(per100, 1, "piece")).toBeNull()
  })
  test("rounds to one decimal", () => {
    expect(scaleFood(per100, 33, "g")?.kcal).toBe(54.5) // 165 × 0.33 = 54.45
    expect(scaleFood(per100, 33, "g")?.fat).toBe(1.2) // 1.188
  })
})

describe("round1 matches Python's round(x, 1)", () => {
  test.each([
    [0.25, 0.2],
    [0.75, 0.8],
    [1.25, 1.2],
    [2.5, 2.5],
    [0.35, 0.3],
    [0.45, 0.5],
    [2.675, 2.7],
    [1.05, 1.1],
    [54.45, 54.5],
    [111, 111],
  ])("round(%p, 1) == %p", (x, want) => {
    expect(round1(x)).toBe(want)
  })
})
