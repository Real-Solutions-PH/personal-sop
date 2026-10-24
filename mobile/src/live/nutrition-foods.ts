// Live reads of the person's food library (GET /nutrition/foods, ADR-0024).
// The library is server-owned (Fern saves foods it reads from labels), so it
// is read on demand rather than synced.

export interface LibraryFood {
  id: string
  name: string
  aliases: string[]
  basis: "100g" | "piece" | "serving" | string
  unit_grams: number | null
  kcal: number
  protein: number
  carbs: number
  fat: number
  fiber: number | null
  sat_fat: number | null
  sugar: number | null
  sodium: number | null
  source: string
  verified: boolean
  use_count: number
  last_used_at: string | null
}

/** Up to 100 foods, most used first; ``q`` narrows by name. Auth is loaded
 * lazily, so prototype mode never builds it. */
export async function fetchFoods(
  q = "",
): Promise<{ data: LibraryFood[]; count: number }> {
  const auth = require("./auth") as typeof import("./auth")
  const query = q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""
  return auth.http.request("GET", `/nutrition/foods?limit=100${query}`)
}
