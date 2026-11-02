// Two answers the Nutrition page gives from the logged meal items, counted
// here and never estimated: which foods gave the most of one nutrient (the
// same food eaten twice adds up), and which meals gave the most protein for
// their calories. Meals still waiting for an estimate count towards nothing,
// as in the day's totals.
import { mealDay, mealTotals, sumMacros } from "@domain/fitness/calc"
import type { Macros, Meal, MealItem } from "@domain/fitness/data"

/** The nutrients a person can rank foods by, the limits first. */
export const NUTRIENTS = [
  "sugar",
  "satFat",
  "sodium",
  "protein",
  "fiber",
  "fiberSoluble",
  "fiberInsoluble",
  "carbs",
  "fat",
  "kcal",
] as const
export type NutrientKey = (typeof NUTRIENTS)[number]

/** Detail values an item may not carry; macros are always there. */
const OPTIONAL = new Set<NutrientKey>([
  "sugar",
  "satFat",
  "sodium",
  "fiber",
  "fiberSoluble",
  "fiberInsoluble",
])

export interface FoodRow {
  /** As written the latest time it was eaten, without its portion note. */
  name: string
  amount: number
  /** Share of the total across foods that carry the value, 0..1. */
  share: number
  /** How many times it was logged. */
  count: number
  /** The latest meal it was in, to open. */
  mealId: string
}

const counted = (meals: readonly Meal[]) =>
  meals
    .filter((m) => m.status !== "pending_estimate")
    .sort((a, b) => a.eatenAt.localeCompare(b.eatenAt))

/** "Iced coffee (large)" and "iced coffee" are one food. */
export const foodLabel = (name: string) =>
  name
    .replace(/\s*\(.*\)/, "")
    .replace(/\s+/g, " ")
    .trim()

/** Foods ranked by how much of ``key`` they gave, biggest first (a tie
 * keeps the food eaten first). ``known`` and ``unknown`` count the
 * distinct foods that do and do not carry a value for it, so a missing
 * value is never read as zero; ``days`` is how many business days carry
 * one, the fair divisor for a daily average. */
export function topFoods(meals: readonly Meal[], key: NutrientKey) {
  const foods = new Map<
    string,
    { name: string; amount: number; count: number; mealId: string }
  >()
  const unknown = new Set<string>()
  const days = new Set<string>()
  for (const m of counted(meals))
    for (const i of m.items) {
      const label = foodLabel(i.name),
        id = label.toLowerCase(),
        v = (i as MealItem)[key]
      if (v === undefined) {
        if (OPTIONAL.has(key)) unknown.add(id)
        continue
      }
      days.add(mealDay(m))
      const f = foods.get(id)
      if (f)
        Object.assign(f, {
          name: label,
          amount: f.amount + v,
          count: f.count + 1,
          mealId: m.id,
        })
      else foods.set(id, { name: label, amount: v, count: 1, mealId: m.id })
    }
  // A food known somewhere in the range is not unknown.
  for (const id of foods.keys()) unknown.delete(id)
  const list = [...foods.values()].filter((f) => f.amount > 0)
  const total = list.reduce((a, f) => a + f.amount, 0)
  const rows: FoodRow[] = list
    .map((f) => ({ ...f, share: total > 0 ? f.amount / total : 0 }))
    // Array.sort is stable, so a tie stays in the order first eaten.
    .sort((a, b) => b.amount - a.amount)
  return {
    rows,
    total,
    known: foods.size,
    unknown: unknown.size,
    days: days.size,
  }
}

/** Under this a meal is a drink or a bite, and its ratio says little. */
export const MIN_MEAL_KCAL = 100

export interface MealRatio {
  /** The latest time it was eaten, to name and open. */
  meal: Meal
  /** How many times the same foods were logged as a meal. */
  count: number
  /** Across every time it was eaten. */
  kcal: number
  protein: number
  /** Protein grams per 100 kcal. */
  per100: number
  /** Each macro's share of the meal's macro energy (4 / 4 / 9 kcal a gram). */
  split: { protein: number; carbs: number; fat: number }
}

/** Meals ranked by protein per 100 kcal, most first (a tie goes to the
 * one with more protein). The same foods eaten again are one row with a
 * count, so a daily shake does not fill the list. Meals under
 * ``MIN_MEAL_KCAL`` are left out and counted in ``skipped``. */
export function bestMeals(meals: readonly Meal[]) {
  let skipped = 0
  const groups = new Map<string, { meal: Meal; count: number; t: Macros }>()
  for (const meal of counted(meals)) {
    const t = mealTotals(meal)
    if (t.kcal < MIN_MEAL_KCAL) {
      skipped++
      continue
    }
    const id = meal.items
      .map((i) => foodLabel(i.name).toLowerCase())
      .sort()
      .join("|")
    const g = groups.get(id)
    if (g) groups.set(id, { meal, count: g.count + 1, t: sumMacros([g.t, t]) })
    else groups.set(id, { meal, count: 1, t })
  }
  const rows: MealRatio[] = [...groups.values()].map(({ meal, count, t }) => {
    const p = t.protein * 4,
      c = t.carbs * 4,
      f = t.fat * 9,
      e = p + c + f
    return {
      meal,
      count,
      kcal: t.kcal,
      protein: t.protein,
      per100: (t.protein / t.kcal) * 100,
      split: e
        ? { protein: p / e, carbs: c / e, fat: f / e }
        : { protein: 0, carbs: 0, fat: 0 },
    }
  })
  rows.sort((a, b) => b.per100 - a.per100 || b.protein - a.protein)
  return { rows, skipped }
}

export interface MealRank {
  /** The latest time it was eaten, to name and open. */
  meal: Meal
  /** How many times the same foods were logged as a meal. */
  count: number
  /** Across every time it was eaten. */
  kcal: number
  protein: number
  amount: number
  /** ``key`` per 100 kcal. */
  per100: number
}

/** Meals ranked by one nutrient: the most of it each time eaten
 * (``"amount"``), or the most of it for their calories (``"per100"``,
 * which leaves out meals under ``MIN_MEAL_KCAL``, counted in ``skipped``).
 * The same foods eaten again are one row with a count. A meal none of
 * whose items carries an optional value is counted in ``unknown``, never
 * ranked as zero. */
export function rankMeals(
  meals: readonly Meal[],
  key: NutrientKey,
  by: "amount" | "per100",
) {
  let skipped = 0,
    unknown = 0
  const groups = new Map<
    string,
    { meal: Meal; count: number; t: Macros; amount: number }
  >()
  for (const meal of counted(meals)) {
    const t = mealTotals(meal)
    let amount: number
    if (OPTIONAL.has(key)) {
      const known = meal.items
        .map((i) => (i as MealItem)[key])
        .filter((v): v is number => v !== undefined)
      if (!known.length) {
        unknown++
        continue
      }
      amount = known.reduce((a, v) => a + v, 0)
    } else amount = t[key as keyof Macros]
    if (by === "per100" && t.kcal < MIN_MEAL_KCAL) {
      skipped++
      continue
    }
    const id = meal.items
      .map((i) => foodLabel(i.name).toLowerCase())
      .sort()
      .join("|")
    const g = groups.get(id)
    if (g)
      groups.set(id, {
        meal,
        count: g.count + 1,
        t: sumMacros([g.t, t]),
        amount: g.amount + amount,
      })
    else groups.set(id, { meal, count: 1, t, amount })
  }
  const rows: MealRank[] = [...groups.values()]
    .filter((g) => g.amount > 0)
    .map(({ meal, count, t, amount }) => ({
      meal,
      count,
      kcal: t.kcal,
      protein: t.protein,
      amount,
      per100: t.kcal ? (amount / t.kcal) * 100 : 0,
    }))
  rows.sort((a, b) =>
    by === "per100"
      ? b.per100 - a.per100 || b.amount - a.amount
      : b.amount / b.count - a.amount / a.count,
  )
  return { rows, skipped, unknown }
}
