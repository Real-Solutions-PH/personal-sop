// What a food's page works out from its numbers, kept pure so every figure
// is tested: each macro's share of the calories, an amount as a share of a
// daily target, the "derived" highlights (high protein, high sodium, ...)
// and the person's own history with the food from their logged meals.
//
// Highlight thresholds come from published labelling rules, never taste:
//  - Protein and fibre claims: EU Regulation (EC) No 1924/2006, Annex
//    ("Nutrition claims and conditions applying to them"). "Source of
//    protein": at least 12% of the energy from protein; "high protein": at
//    least 20%. "Source of fibre": at least 3 g per 100 g or 1.5 g per
//    100 kcal; "high fibre": at least 6 g per 100 g or 3 g per 100 kcal.
//  - "High" sodium, sugar and saturated fat per 100 g: UK Department of
//    Health / Food Standards Agency, "Guide to creating a front of pack
//    nutrition label for pre-packed products" (2016), the red band for
//    foods: salt over 1.5 g (sodium over 600 mg), sugars over 22.5 g,
//    saturates over 5 g per 100 g. (Drinks use half these; the library
//    cannot tell a drink from a food, so the food bands apply.)
//  - A food known only per serving (no weight to reach 100 g) is read per
//    serving with the US FDA's "5/20" rule for the Percent Daily Value
//    (21 CFR 101.9; FDA, "How to Understand and Use the Nutrition Facts
//    Label"): 20% DV or more in one serving is high. Daily Values: sodium
//    2,300 mg, added sugars 50 g, saturated fat 20 g.
// The library's ``sugar`` is added sugar; the per-100 g band was written
// for total sugars, so a food over it is high in added sugar a fortiori.
import type { Meal, MealItem } from "@domain/fitness/data"
import { foodLabel } from "./nutrient-insights"

/** Energy per gram (Atwater factors), as the rest of the app counts it. */
export const KCAL_PER_G = { protein: 4, carbs: 4, fat: 9 } as const
export type MacroKey = keyof typeof KCAL_PER_G
export const MACRO_KEYS: MacroKey[] = ["protein", "carbs", "fat"]

/** Each macro's share of the energy the three macros give, 0..1; all 0
 * when they give none. Shares of macro energy (not the label's kcal) so the
 * three always add up to the whole bar. */
export function macroSplit(m: Record<MacroKey, number>) {
  const e = {
    protein: Math.max(0, m.protein) * KCAL_PER_G.protein,
    carbs: Math.max(0, m.carbs) * KCAL_PER_G.carbs,
    fat: Math.max(0, m.fat) * KCAL_PER_G.fat,
  }
  const total = e.protein + e.carbs + e.fat
  if (!(total > 0)) return { protein: 0, carbs: 0, fat: 0 }
  return {
    protein: e.protein / total,
    carbs: e.carbs / total,
    fat: e.fat / total,
  }
}

/** Whole percentages for shares that add up to 100 (largest remainder),
 * so "31% · 41% · 28%" never reads 99% or 101%. All 0 for no energy. */
export function wholePercents(split: Record<MacroKey, number>) {
  const raw = MACRO_KEYS.map((k) => split[k] * 100)
  if (raw.every((v) => v === 0)) return { protein: 0, carbs: 0, fat: 0 }
  const floors = raw.map(Math.floor)
  let left = 100 - floors.reduce((a, b) => a + b, 0)
  const order = raw
    .map((v, i) => ({ i, rem: v - Math.floor(v) }))
    .sort((a, b) => b.rem - a.rem)
  for (const { i } of order) {
    if (left <= 0) break
    floors[i] += 1
    left -= 1
  }
  return { protein: floors[0], carbs: floors[1], fat: floors[2] }
}

/** ``amount`` as a share of ``target`` (0.21 is 21%); null when there is
 * no target to compare with, or the amount is unknown. */
export function shareOf(
  amount: number | null | undefined,
  target: number | null | undefined,
): number | null {
  if (amount === null || amount === undefined || !Number.isFinite(amount))
    return null
  if (!target || !(target > 0)) return null
  return amount / target
}

/** Grams in one of the food's basis units: 100 for a per-100 g food, the
 * piece or serving weight otherwise; null when that weight is unknown. */
export function gramsPerBasis(food: {
  basis: string
  unit_grams: number | null
}): number | null {
  if (food.basis === "100g") return 100
  return food.unit_grams && food.unit_grams > 0 ? food.unit_grams : null
}

/** A per-basis amount restated per 100 g; null when it cannot be. */
export function per100g(
  food: { basis: string; unit_grams: number | null },
  value: number | null | undefined,
): number | null {
  const g = gramsPerBasis(food)
  if (value === null || value === undefined || g === null) return null
  return (value * 100) / g
}

/** The FDA Daily Values the per-serving reading uses. */
export const DAILY_VALUE = { sodium: 2300, sugar: 50, sat_fat: 20 } as const

export const THRESHOLDS = {
  proteinSource: 0.12,
  proteinHigh: 0.2,
  fiberSourcePer100g: 3,
  fiberSourcePer100kcal: 1.5,
  fiberHighPer100g: 6,
  fiberHighPer100kcal: 3,
  sodiumHighPer100g: 600,
  sugarHighPer100g: 22.5,
  satFatHighPer100g: 5,
  /** 20% of the Daily Value in one serving. */
  highShareOfDv: 0.2,
} as const

export interface Highlight {
  key: "protein" | "fiber" | "sodium" | "sugar" | "sat_fat"
  /** Good to reach (protein, fiber) or one to watch (the limits). */
  tone: "good" | "watch"
  label: string
  /** The number behind it, as the reader can check it. */
  detail: string
}

export interface FactsFood {
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

const n1 = (v: number) =>
  v.toLocaleString("en-US", { maximumFractionDigits: 1 })
const pct = (v: number) => `${Math.round(v * 100)}%`

/** The quiet highlights a food's numbers earn, good ones first. A value
 * the food does not carry earns nothing (unknown is never read as 0). */
export function highlights(food: FactsFood): Highlight[] {
  const out: Highlight[] = []
  const perServing = food.basis === "100g" ? "" : ` per ${food.basis}`
  if (food.kcal > 0) {
    const share = (food.protein * KCAL_PER_G.protein) / food.kcal
    if (share >= THRESHOLDS.proteinHigh)
      out.push({
        key: "protein",
        tone: "good",
        label: "High protein",
        detail: `${pct(share)} of calories`,
      })
    else if (share >= THRESHOLDS.proteinSource)
      out.push({
        key: "protein",
        tone: "good",
        label: "Source of protein",
        detail: `${pct(share)} of calories`,
      })
  }
  if (food.fiber !== null && food.fiber > 0) {
    const g100 = per100g(food, food.fiber),
      k100 = food.kcal > 0 ? (food.fiber * 100) / food.kcal : null
    const meets = (byG: number, byK: number) =>
      (g100 !== null && g100 >= byG) || (k100 !== null && k100 >= byK)
    const detail =
      g100 !== null ? `${n1(g100)} g per 100 g` : `${n1(food.fiber)} g${perServing}`
    if (
      meets(THRESHOLDS.fiberHighPer100g, THRESHOLDS.fiberHighPer100kcal)
    )
      out.push({ key: "fiber", tone: "good", label: "High fiber", detail })
    else if (
      meets(THRESHOLDS.fiberSourcePer100g, THRESHOLDS.fiberSourcePer100kcal)
    )
      out.push({
        key: "fiber",
        tone: "good",
        label: "Good fiber source",
        detail,
      })
  }
  const limits = [
    {
      key: "sodium",
      label: "High sodium",
      band: THRESHOLDS.sodiumHighPer100g,
      unit: "mg",
    },
    {
      key: "sugar",
      label: "High added sugar",
      band: THRESHOLDS.sugarHighPer100g,
      unit: "g",
    },
    {
      key: "sat_fat",
      label: "High saturated fat",
      band: THRESHOLDS.satFatHighPer100g,
      unit: "g",
    },
  ] as const
  for (const l of limits) {
    const v = food[l.key]
    if (v === null || v <= 0) continue
    const g100 = per100g(food, v)
    if (g100 !== null) {
      if (g100 > l.band)
        out.push({
          key: l.key,
          tone: "watch",
          label: l.label,
          detail: `${n1(g100)} ${l.unit} per 100 g`,
        })
      continue
    }
    const dv = v / DAILY_VALUE[l.key]
    if (dv >= THRESHOLDS.highShareOfDv)
      out.push({
        key: l.key,
        tone: "watch",
        label: l.label,
        detail: `${pct(dv)} of a day's value${perServing}`,
      })
  }
  return out
}

/** How much one tap of − or + changes the amount: 10 g, or half a piece
 * or serving. */
export const stepFor = (unit: string) => (unit === "g" ? 10 : 0.5)

export interface FoodHistory {
  /** How many logged items were this food. */
  count: number
  /** The latest meal it was in. */
  last: { meal: Meal; item: MealItem } | null
  /** The amount logged most often (a tie goes to the latest). */
  usual: { qty: number; unit: string; times: number } | null
  /** The latest few, newest first, each to open its meal. */
  recent: { meal: Meal; item: MealItem }[]
}

const LIBRARY_NOTE = "From your food library: "
const fold = (s: string) => foodLabel(s).toLowerCase()

/** Whether a logged item is ``food``: picked from the library (its note
 * names the food), or written with the food's name or one of its other
 * names, a portion note aside ("Skyr (150 g)" is skyr). */
export function isThisFood(
  item: Pick<MealItem, "name" | "assumption">,
  food: { name: string; aliases: string[] },
): boolean {
  if (item.assumption === `${LIBRARY_NOTE}${food.name}`) return true
  const name = fold(item.name)
  if (!name) return false
  return name === fold(food.name) || food.aliases.some((a) => fold(a) === name)
}

/** The person's history with ``food`` across their logged meals; meals
 * still waiting for an estimate count for nothing, as everywhere else. */
export function foodHistory(
  meals: readonly Meal[],
  food: { name: string; aliases: string[] },
  keep = 5,
): FoodHistory {
  const hits: { meal: Meal; item: MealItem }[] = []
  for (const meal of meals) {
    if (meal.status === "pending_estimate") continue
    for (const item of meal.items)
      if (isThisFood(item, food)) hits.push({ meal, item })
  }
  hits.sort((a, b) => b.meal.eatenAt.localeCompare(a.meal.eatenAt))
  const tally = new Map<string, { qty: number; unit: string; times: number }>()
  // Newest first, so the first amount to reach the top count is the latest.
  let usual: FoodHistory["usual"] = null
  for (const { item } of hits) {
    const id = `${item.qty}|${item.unit.trim().toLowerCase()}`
    const row = tally.get(id) ?? { qty: item.qty, unit: item.unit, times: 0 }
    row.times += 1
    tally.set(id, row)
  }
  for (const { item } of hits) {
    const row = tally.get(`${item.qty}|${item.unit.trim().toLowerCase()}`)
    if (row && (!usual || row.times > usual.times)) usual = row
  }
  return {
    count: hits.length,
    last: hits[0] ?? null,
    usual,
    recent: hits.slice(0, keep),
  }
}

