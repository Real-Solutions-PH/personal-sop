// Nutrients read two ways. Protein, carbs and fiber are amounts to reach;
// saturated fat, sugar and sodium are amounts to stay under. The daily
// limits follow WHO guidance for a 2,000 kcal day: saturated fat under 10%
// of energy (~20 g), free sugars under 10% (~50 g), sodium under 2,000 mg.

export type LimitKey = "satFat" | "sugar" | "sodium"

export const DAILY_LIMITS: Record<LimitKey, number> = {
  satFat: 20,
  sugar: 50,
  sodium: 2000,
}
export const FIBER_GOAL = 25

export const LIMIT_LABEL: Record<LimitKey, { label: string; unit: string }> = {
  satFat: { label: "Sat fat", unit: "g" },
  sugar: { label: "Sugar", unit: "g" },
  sodium: { label: "Sodium", unit: "mg" },
}

/** How close an amount is to its limit: under (< 80%), near, or over. */
export function limitLevel(amount: number, limit: number) {
  const share = limit > 0 ? amount / limit : 0
  return {
    share,
    level:
      share > 1
        ? ("over" as const)
        : share >= 0.8
          ? ("near" as const)
          : ("under" as const),
  }
}

type Detail = {
  fiber?: number
  satFat?: number
  sugar?: number
  sodium?: number
}

/** Totals of the detail values the items carry; a key is present only
 * when at least one item knows it. */
export function detailTotals(items: readonly Detail[]) {
  const out: Detail = {}
  for (const key of ["fiber", "satFat", "sugar", "sodium"] as const) {
    const known = items.filter((i) => i[key] !== undefined)
    if (known.length) out[key] = known.reduce((a, i) => a + (i[key] ?? 0), 0)
  }
  return out
}
