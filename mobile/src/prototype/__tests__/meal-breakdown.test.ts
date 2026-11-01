// The day's meals by macro: per-meal numbers, shares of the day and the
// top meal for each macro, worked out by hand below.
import type { Meal } from "@domain/fitness/data"
import { mealBreakdown, mealName } from "../meal-breakdown"

const item = (kcal: number, protein: number, carbs: number, fat: number) => ({
  id: `i${kcal}`,
  name: "x",
  qty: 1,
  unit: "serving",
  kcal,
  protein,
  carbs,
  fat,
})
const meal = (
  id: string,
  label: Meal["label"],
  at: string,
  items: ReturnType<typeof item>[],
  status: Meal["status"] = "confirmed",
): Meal => ({
  id,
  label,
  eatenAt: `2026-11-01T${at}:00`,
  source: "text",
  rawInput: id,
  status,
  items,
})

test("each macro's top meal and its share of the day", () => {
  const b = mealBreakdown([
    // Out of order on purpose: rows come back by time.
    meal("dinner", "dinner", "19:00", [item(700, 50, 40, 30)]),
    meal("breakfast", "breakfast", "07:30", [item(400, 20, 60, 10)]),
    meal("lunch", "lunch", "12:30", [
      item(600, 30, 80, 20),
      item(100, 0, 20, 0),
    ]),
  ])
  expect(b.rows.map((r) => r.meal.id)).toEqual(["breakfast", "lunch", "dinner"])
  // kcal 400 + 700 + 700 = 1,800; protein 20 + 30 + 50 = 100;
  // carbs 60 + 100 + 40 = 200; fat 10 + 20 + 30 = 60.
  expect(b.totals).toEqual({ kcal: 1800, protein: 100, carbs: 200, fat: 60 })
  expect(b.rows[1].totals).toEqual({
    kcal: 700,
    protein: 30,
    carbs: 100,
    fat: 20,
  })
  expect(b.rows[1].share.carbs).toBeCloseTo(0.5)
  expect(b.top.protein).toEqual({ mealId: "dinner", share: 0.5 })
  expect(b.top.carbs).toEqual({ mealId: "lunch", share: 0.5 })
  expect(b.top.fat).toEqual({ mealId: "dinner", share: 0.5 })
  // Lunch and dinner tie on 700 kcal: the earlier meal is named.
  expect(b.top.kcal?.mealId).toBe("lunch")
})

test("a meal waiting for its estimate is listed but counts towards nothing", () => {
  const b = mealBreakdown([
    meal("lunch", "lunch", "12:30", [item(500, 25, 50, 20)]),
    meal("snap", "snack", "15:00", [], "pending_estimate"),
  ])
  expect(b.rows).toHaveLength(2)
  expect(b.rows[1].totals).toBeNull()
  expect(b.pending).toBe(1)
  expect(b.top.kcal).toEqual({ mealId: "lunch", share: 1 })
})

test("no meal gave any fat: no top meal for fat", () => {
  const b = mealBreakdown([
    meal("b", "breakfast", "08:00", [item(200, 5, 45, 0)]),
  ])
  expect(b.top.fat).toBeNull()
  expect(b.rows[0].share.fat).toBe(0)
})

test("two snacks are told apart by time", () => {
  const all = [
    meal("a", "snack", "10:00", []),
    meal("b", "snack", "15:40", []),
    meal("c", "lunch", "12:00", []),
  ]
  const time = (iso: string) => iso.slice(11, 16)
  expect(all.map((m) => mealName(m, all, time))).toEqual([
    "Snack 10:00",
    "Snack 15:40",
    "Lunch",
  ])
})
