// A library food scaled to an amount, the same sum the server does when a
// meal names a saved food: a factor from the amount and the food's basis,
// then every known nutrient times that factor, rounded to one decimal.

export const GRAM_UNITS = ["g", "gram", "grams", "gm", "gms"] as const
export const COUNT_UNITS = [
  "",
  "pc",
  "pcs",
  "piece",
  "pieces",
  "serving",
  "servings",
  "x",
  "egg",
  "eggs",
  "slice",
  "slices",
  "pack",
  "packs",
  "bar",
  "bars",
  "can",
  "cans",
  "bottle",
  "bottles",
  "cup",
  "cups",
] as const

export const NUTRIENTS = [
  "kcal",
  "protein",
  "carbs",
  "fat",
  "fiber",
  "sat_fat",
  "sugar",
  "sodium",
] as const
export type Nutrient = (typeof NUTRIENTS)[number]

export interface Scalable {
  basis: string
  unit_grams: number | null
  kcal: number
  protein: number
  carbs: number
  fat: number
  fiber: number | null
  sat_fat: number | null
  sugar: number | null
  sodium: number | null
}

export type Scaled = {
  factor: number
  kcal: number
  protein: number
  carbs: number
  fat: number
  fiber: number | null
  sat_fat: number | null
  sugar: number | null
  sodium: number | null
}

const grams = new Set<string>(GRAM_UNITS)
const counts = new Set<string>(COUNT_UNITS)

/** How many of the food's basis ``qty`` ``unit`` is, or null when the
 * amount cannot be turned into one (no unit weight, an unknown unit). */
export function scaleFactor(
  food: Pick<Scalable, "basis" | "unit_grams">,
  qty: number,
  unit: string,
): number | null {
  if (!(qty > 0)) return null
  const u = unit.trim().toLowerCase()
  const per100 = food.basis === "100g"
  if (grams.has(u)) {
    if (per100) return qty / 100
    return food.unit_grams ? qty / food.unit_grams : null
  }
  if (counts.has(u)) {
    if (per100) return food.unit_grams ? (qty * food.unit_grams) / 100 : null
    return qty
  }
  return null
}

/** Python's ``round(x, 1)``: the exact binary value rounded to one decimal,
 * an exact tie (x.x5 is only exact at .25 and .75) going to the even digit. */
export function round1(x: number): number {
  const quarters = x * 4
  if (Number.isInteger(quarters) && quarters % 2 !== 0) {
    const tenths = x * 10
    const down = Math.floor(tenths)
    return (down % 2 === 0 ? down : down + 1) / 10
  }
  return Number(x.toFixed(1))
}

/** ``food``'s nutrients for ``qty`` ``unit``; an unknown nutrient stays
 * null. Null when the amount cannot be scaled. */
export function scaleFood(
  food: Scalable,
  qty: number,
  unit: string,
): Scaled | null {
  const factor = scaleFactor(food, qty, unit)
  if (factor === null) return null
  const out = { factor } as Scaled
  for (const k of NUTRIENTS) {
    const v = food[k]
    ;(out as Record<Nutrient, number | null>)[k] =
      v === null || v === undefined ? null : round1(v * factor)
  }
  return out
}
