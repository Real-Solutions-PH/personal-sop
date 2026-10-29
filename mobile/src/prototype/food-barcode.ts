// A scanned food barcode, looked up in Open Food Facts (a free, open food
// database), and the meal item it makes for the grams eaten. Only the
// barcode leaves the phone.
import type { MealItem } from "@domain/fitness/data"

export interface Product {
  code: string
  name: string
  brand?: string
  /** Grams in one serving, when the label gives it. */
  servingG?: number
  /** Per 100 g; sodium in milligrams, the rest in grams (kcal for energy). */
  per100: {
    kcal: number
    protein: number
    carbs: number
    fat: number
    fiber?: number
    satFat?: number
    sugar?: number
    sodium?: number
  }
}

type Fetcher = (
  url: string,
  init?: { headers: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

// Open Food Facts asks every app to name itself.
const AGENT = "Unfurl/1.0 (https://github.com/Real-Solutions-PH)"
const FIELDS = "product_name,brands,serving_quantity,nutriments"

const num = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v)
    ? v
    : typeof v === "string" && v.trim() && Number.isFinite(Number(v))
      ? Number(v)
      : undefined

/** null: not a barcode, not in the database, or no calories on the label.
 * "error": offline or the server failed, worth trying again. */
export async function lookupBarcode(
  code: string,
  fetcher: Fetcher = fetch as unknown as Fetcher,
): Promise<Product | null | "error"> {
  if (!/^\d{8,14}$/.test(code)) return null
  let body: unknown
  try {
    const res = await fetcher(
      `https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=${FIELDS}`,
      { headers: { "User-Agent": AGENT } },
    )
    if (res.status === 404) return null
    if (!res.ok) return "error"
    body = await res.json()
  } catch {
    return "error"
  }
  const b = body as { status?: number; product?: Record<string, unknown> },
    p = b?.status ? b.product : undefined
  const n = (p?.nutriments ?? {}) as Record<string, unknown>,
    kcal = num(n["energy-kcal_100g"]),
    name = typeof p?.product_name === "string" ? p.product_name.trim() : ""
  if (!p || kcal === undefined || !name) return null
  const sodium = num(n.sodium_100g),
    brand =
      typeof p.brands === "string"
        ? p.brands.split(",")[0]?.trim() || undefined
        : undefined
  return {
    code,
    name,
    ...(brand && { brand }),
    ...(num(p.serving_quantity) && { servingG: num(p.serving_quantity) }),
    per100: {
      kcal,
      protein: num(n.proteins_100g) ?? 0,
      carbs: num(n.carbohydrates_100g) ?? 0,
      fat: num(n.fat_100g) ?? 0,
      ...(num(n.fiber_100g) !== undefined && { fiber: num(n.fiber_100g) }),
      ...(num(n["saturated-fat_100g"]) !== undefined && {
        satFat: num(n["saturated-fat_100g"]),
      }),
      ...(num(n.sugars_100g) !== undefined && { sugar: num(n.sugars_100g) }),
      ...(sodium !== undefined && { sodium: Math.round(sodium * 1000) }),
    },
  }
}

const r1 = (v: number) => Math.round(v * 10) / 10

/** The meal item for `grams` of the product. */
export function itemFor(p: Product, grams: number): Omit<MealItem, "id"> {
  const f = grams / 100,
    { per100: x } = p
  return {
    name: p.brand ? `${p.name} (${p.brand})` : p.name,
    qty: grams,
    unit: "g",
    kcal: Math.round(x.kcal * f),
    protein: Math.round(x.protein * f),
    carbs: Math.round(x.carbs * f),
    fat: Math.round(x.fat * f),
    ...(x.fiber !== undefined && { fiber: r1(x.fiber * f) }),
    ...(x.satFat !== undefined && { satFat: r1(x.satFat * f) }),
    ...(x.sugar !== undefined && { sugar: r1(x.sugar * f) }),
    ...(x.sodium !== undefined && { sodium: Math.round(x.sodium * f) }),
    assumption: "Open Food Facts, per 100 g label",
  }
}
