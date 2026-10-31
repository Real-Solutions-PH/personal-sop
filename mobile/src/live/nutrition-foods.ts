// Live reads of the person's food library (GET /nutrition/foods, ADR-0024).
// The library is server-owned (Fern saves foods it reads from labels), so it
// is read on demand rather than synced, through one keyed query.

import { keepPreviousData, useQuery } from "@tanstack/react-query"

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

export interface FoodsPage {
  data: LibraryFood[]
  count: number
}

/** A short list on a quiet screen: give up sooner than the default so a
 * stalled server shows the retry card instead of a long skeleton. */
const FOODS_TIMEOUT_MS = 8_000

/** Up to 100 foods, most used first; ``q`` narrows by name. Auth is loaded
 * lazily, so prototype mode never builds it. */
export async function fetchFoods(q = ""): Promise<FoodsPage> {
  const auth = require("./auth") as typeof import("./auth")
  const query = q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""
  return auth.http.request(
    "GET",
    `/nutrition/foods?limit=100${query}`,
    undefined,
    { timeoutMs: FOODS_TIMEOUT_MS },
  )
}

export const foodsKey = (q: string) => ["nutrition", "foods", q.trim()]

/** The library for ``q``. Off (never pending) outside live mode; while a
 * new search runs, the last answer stays on screen. A failure settles as
 * an error after one retry, never as a skeleton left running. */
export function useFoods(q: string, enabled: boolean) {
  return useQuery({
    queryKey: foodsKey(q),
    queryFn: () => fetchFoods(q),
    enabled,
    retry: 1,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  })
}
