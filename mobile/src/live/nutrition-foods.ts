// Live reads and edits of the food library (GET/PATCH /nutrition/foods,
// ADR-0024). The library is server-owned and shared by every member (Fern
// saves foods it reads from labels), so it is read on demand rather than
// synced, through keyed queries under ``["nutrition", "foods"]``.

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { ApiError, NetworkError } from "./http"
import { MediaRejected, uploadMedia } from "./media"

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
  /** Raw, cooked or as sold; null when not said. */
  state?: "raw" | "cooked" | "as_sold" | null
  notes?: string | null
  photo_media_id?: string | null
  /** A short-lived link to the photo, or null. */
  photo_url?: string | null
  /** Whether the signed-in member may edit it (its author, or an admin). */
  can_edit?: boolean
}

/** A PATCH body: only the fields that changed. */
export type FoodPatch = Partial<
  Pick<
    LibraryFood,
    | "name"
    | "aliases"
    | "basis"
    | "unit_grams"
    | "state"
    | "kcal"
    | "protein"
    | "carbs"
    | "fat"
    | "fiber"
    | "sat_fat"
    | "sugar"
    | "sodium"
    | "notes"
    | "photo_media_id"
  >
>

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

export const foodKey = (id: string) => ["nutrition", "foods", "id", id]

const auth = () => require("./auth") as typeof import("./auth")

export async function fetchFood(id: string): Promise<LibraryFood> {
  return auth().http.request(
    "GET",
    `/nutrition/foods/${encodeURIComponent(id)}`,
    undefined,
    { timeoutMs: FOODS_TIMEOUT_MS },
  )
}

/** One food. Off outside live mode; a missing food (404) is not retried. */
export function useFood(id: string, enabled: boolean) {
  return useQuery({
    queryKey: foodKey(id),
    queryFn: () => fetchFood(id),
    enabled,
    retry: (n, error) =>
      !(error instanceof ApiError && error.status === 404) && n < 1,
  })
}

export async function patchFood(
  id: string,
  body: FoodPatch,
): Promise<LibraryFood> {
  return auth().http.request(
    "PATCH",
    `/nutrition/foods/${encodeURIComponent(id)}`,
    body,
  )
}

/** Uploads a picked photo (a data or file URI) and sets it on the food. */
export async function setFoodPhoto(
  id: string,
  uri: string,
): Promise<LibraryFood> {
  const media = await uploadMedia(
    { kind: "image", uri, mime: "image/jpeg" },
    { http: auth().http, fetch: (input, init) => fetch(input, init) },
  )
  return patchFood(id, { photo_media_id: media.id })
}

/** Counts one use of a library food (it was logged into a meal). Nothing
 * waits on it, and a failure is not the person's problem. */
export function markFoodUsed(id: string): void {
  try {
    void auth()
      .http.request("POST", `/nutrition/foods/${encodeURIComponent(id)}/use`)
      .catch(() => {})
  } catch {
    // Auth not built (prototype): nothing to count.
  }
}

/** The edits to one food: a field save and a photo change. Each answer
 * replaces the cached food and refreshes the lists. */
export function useFoodEdits(id: string) {
  const client = useQueryClient()
  const done = (food: LibraryFood) => {
    client.setQueryData(foodKey(id), food)
    void client.invalidateQueries({ queryKey: ["nutrition", "foods"] })
  }
  return {
    save: useMutation({
      mutationFn: (body: FoodPatch) => patchFood(id, body),
      onSuccess: done,
    }),
    photo: useMutation({
      mutationFn: (uri: string) => setFoodPhoto(id, uri),
      onSuccess: done,
    }),
  }
}

/** What to tell the person when a food edit fails. */
export function foodEditError(error: unknown): string {
  if (error instanceof NetworkError)
    return "You're offline. Nothing was saved — try again when you're back."
  if (error instanceof MediaRejected)
    return "That image couldn't be used. Try another photo."
  if (error instanceof ApiError) {
    // The server's envelope carries the route's own code (catalog_read_only).
    const code = error.code
    if (error.status === 403 || code === "catalog_read_only")
      return "Only the person who added this food (or an admin) can change it."
    if (error.status === 409 || code === "food_name_taken")
      return "Another food already has that name. Pick a different one."
    if (code === "media_not_ready")
      return "The photo is still processing. Try again in a moment."
    if (error.status === 404) return "This food no longer exists."
  }
  return "Couldn't save this food. Please try again."
}
